// Trafic RSK — actualisation centralisée du trafic
// Les navigateurs appellent cette fonction (au chargement puis toutes les quelques minutes),
// mais le fournisseur externe n'est interrogé que lorsque la base l'autorise
// (claim_traffic_refresh : fréquence, heures actives, budget journalier, verrou anti-doublon).
// Les nouvelles mesures sont écrites dans traffic_segments et diffusées par Supabase Realtime.
//
// Fournisseurs : TomTom Traffic Flow (secret TOMTOM_API_KEY). Sans clé, l'état reste
// « no_provider » et l'application affiche « Trafic en temps réel indisponible ».
// Ajouter un fournisseur = ajouter un adaptateur dans PROVIDERS.

import { createClient } from "npm:@supabase/supabase-js@2";

const RATE_LIMIT = { max: 12, windowSeconds: 60 };
const TIMEOUT_MS = 8_000;
const CONCURRENCY = 4;

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://milyasse.github.io,http://localhost:5173,http://localhost:4173").split(",").map((s) => s.trim());

type Level = "fluid" | "slow" | "heavy" | "jam" | "unknown";
interface Point { id: string; name: string; city: string; lat: number; lng: number }
interface Measure {
  current_speed: number | null; free_flow_speed: number | null;
  current_travel_time: number | null; free_flow_travel_time: number | null;
  confidence: number | null; road_closure: boolean; coordinates: [number, number][];
}

// Seuils identiques à src/lib/traffic.ts (testés côté frontend)
export function classify(current: number | null, freeFlow: number | null, closure: boolean): Level {
  if (closure) return "jam";
  if (!current || !freeFlow || freeFlow <= 0) return "unknown";
  const r = current / freeFlow;
  if (r >= 0.85) return "fluid";
  if (r >= 0.65) return "slow";
  if (r >= 0.4) return "heavy";
  return "jam";
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
}
function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return keys.default ?? Object.values(keys)[0] as string;
  } catch {
    return "";
  }
}
const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), { auth: { persistSession: false } });

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------- adaptateurs
const PROVIDERS: Record<string, { envKey: string; fetchPoint: (p: Point, key: string) => Promise<Measure> }> = {
  tomtom: {
    envKey: "TOMTOM_API_KEY",
    async fetchPoint(p, key) {
      const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json` +
        `?key=${encodeURIComponent(key)}&point=${p.lat},${p.lng}&unit=KMPH`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`tomtom_http_${res.status}`);
      const d = (await res.json()).flowSegmentData;
      return {
        current_speed: d.currentSpeed ?? null,
        free_flow_speed: d.freeFlowSpeed ?? null,
        current_travel_time: d.currentTravelTime ?? null,
        free_flow_travel_time: d.freeFlowTravelTime ?? null,
        confidence: d.confidence ?? null,
        road_closure: !!d.roadClosure,
        // deno-lint-ignore no-explicit-any
        coordinates: (d.coordinates?.coordinate ?? []).map((c: any) => [c.longitude, c.latitude]),
      };
    },
  },
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = { status: "fulfilled", value: await fn(items[idx]) };
      } catch (e) {
        out[idx] = { status: "rejected", reason: e };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const { data: allowed } = await admin.rpc("hit_rate_limit", {
    p_key: `traffic:${clientIp(req)}`, p_max: RATE_LIMIT.max, p_window_seconds: RATE_LIMIT.windowSeconds,
  });
  if (allowed === false) return json(req, { error: "rate_limited" }, 429);

  const providerName = Deno.env.get("TRAFFIC_PROVIDER") ?? "tomtom";
  const provider = PROVIDERS[providerName];
  const key = provider ? Deno.env.get(provider.envKey) : undefined;

  if (!provider || !key) {
    await admin.rpc("finish_traffic_refresh", {
      p_provider: "none", p_available: false, p_message: "no_provider", p_success: false,
    });
    return json(req, { refreshed: false, available: false, reason: "no_provider" });
  }

  const { data: points, error: pErr } = await admin.from("traffic_points")
    .select("id,name,city,lat,lng").eq("enabled", true);
  if (pErr || !points?.length) return json(req, { refreshed: false, reason: "no_points" });

  const { data: claim } = await admin.rpc("claim_traffic_refresh", { p_points: points.length });
  if (!claim?.claimed) return json(req, { refreshed: false, reason: claim?.reason ?? "unknown" });

  const observedAt = new Date().toISOString();
  const results = await mapLimit(points as Point[], CONCURRENCY, (p) => provider.fetchPoint(p, key));
  const rows = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    const p = points[i] as Point;
    if (r.status === "rejected") {
      errors.push(`${p.id}: ${String(r.reason)}`);
      return;
    }
    const m = r.value;
    if (m.coordinates.length < 2) {
      errors.push(`${p.id}: no_geometry`);
      return;
    }
    rows.push({
      point_id: p.id, name: p.name, city: p.city,
      level: classify(m.current_speed, m.free_flow_speed, m.road_closure),
      current_speed: m.current_speed, free_flow_speed: m.free_flow_speed,
      current_travel_time: m.current_travel_time, free_flow_travel_time: m.free_flow_travel_time,
      confidence: m.confidence, road_closure: m.road_closure,
      geometry: { type: "LineString", coordinates: m.coordinates },
      provider: providerName, observed_at: observedAt,
    });
  });

  if (rows.length) {
    const { error } = await admin.from("traffic_segments").upsert(rows, { onConflict: "point_id" });
    if (error) errors.push(`db: ${error.message}`);
  }
  const ok = rows.length > 0;
  await admin.rpc("finish_traffic_refresh", {
    p_provider: providerName, p_available: ok, p_message: ok ? "ok" : "provider_error", p_success: ok,
  });
  await admin.rpc("record_service_call", {
    p_service: "traffic", p_provider: providerName, p_ok: errors.length === 0,
    p_error: errors.length ? errors.slice(0, 5).join(" | ") : null,
  });
  return json(req, { refreshed: ok, segments: rows.length, errors: errors.length });
});
