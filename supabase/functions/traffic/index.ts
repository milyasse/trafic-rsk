// Trafic RSK — actualisation centralisée du trafic
// Les navigateurs appellent cette fonction (au chargement puis toutes les quelques minutes),
// mais le fournisseur externe n'est interrogé que lorsque la base l'autorise
// (claim_traffic_refresh : fréquence, heures actives, budget journalier, verrou anti-doublon).
// Les nouvelles mesures sont écrites dans traffic_segments et diffusées par Supabase Realtime.
//
// Le même cycle récupère aussi les incidents officiels TomTom (Traffic Incidents, 4 zones) dans
// official_incidents. Quotas gratuits TomTom (par mois) : Flow 20 000, Incidents 2 500 ; avec
// 32 axes + 4 zones toutes les heures de 6 h à 22 h : ≈ 15 400 + 1 900 requêtes/mois.
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

// ------------------------------------------------------- incidents officiels
// Zones de moins de 10 000 km² (limite de l'API) couvrant les zones habitées de la région :
// Rabat-Salé-Témara-Skhirat, couloir de Kénitra, axe A2 vers Khémisset/Tiflet, Sidi Kacem/Sidi Slimane.
const INCIDENT_BOXES: [number, number, number, number][] = [
  [-7.35, 33.55, -6.55, 34.15],
  [-6.85, 34.15, -6.10, 34.60],
  [-6.55, 33.55, -5.75, 34.15],
  [-6.10, 34.10, -5.35, 34.95],
];
const INCIDENT_FIELDS =
  "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity}}}";

// deno-lint-ignore no-explicit-any
async function fetchIncidents(box: [number, number, number, number], key: string): Promise<any[]> {
  const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(key)}` +
    `&bbox=${box.join(",")}&fields=${encodeURIComponent(INCIDENT_FIELDS)}&language=fr-FR&timeValidityFilter=present`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`tomtom_incidents_http_${res.status}`);
  return (await res.json()).incidents ?? [];
}

// deno-lint-ignore no-explicit-any
function incidentRow(inc: any, observedAt: string) {
  const p = inc.properties ?? {};
  const g = inc.geometry;
  if (!p.id || !g?.coordinates) return null;
  const coords: [number, number][] = g.type === "Point" ? [g.coordinates] : g.coordinates;
  if (!coords.length) return null;
  const mid = coords[Math.floor(coords.length / 2)];
  // deno-lint-ignore no-explicit-any
  const descriptions = [...new Set(((p.events ?? []) as any[]).map((e) => e.description).filter(Boolean))];
  return {
    id: String(p.id).slice(0, 200),
    provider: "tomtom",
    category: Number(p.iconCategory ?? 0),
    magnitude: Number(p.magnitudeOfDelay ?? 0),
    description: descriptions.join(" · ").slice(0, 500) || null,
    from_name: p.from ? String(p.from).slice(0, 200) : null,
    to_name: p.to ? String(p.to).slice(0, 200) : null,
    road_numbers: Array.isArray(p.roadNumbers) ? p.roadNumbers.map(String).slice(0, 10) : [],
    length_m: typeof p.length === "number" ? Math.round(p.length) : null,
    delay_s: typeof p.delay === "number" ? Math.round(p.delay) : null,
    start_time: p.startTime ?? null,
    end_time: p.endTime ?? null,
    geometry: { type: g.type === "Point" ? "Point" : "LineString", coordinates: g.coordinates },
    lat: mid[1],
    lng: mid[0],
    active: true,
    observed_at: observedAt,
  };
}

async function refreshIncidents(key: string, observedAt: string, errors: string[]): Promise<number> {
  const results = await Promise.allSettled(INCIDENT_BOXES.map((b) => fetchIncidents(b, key)));
  // deno-lint-ignore no-explicit-any
  const byId = new Map<string, any>();
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failed++;
      errors.push(`incidents box ${i}: ${String(r.reason)}`);
      return;
    }
    for (const inc of r.value) {
      const row = incidentRow(inc, observedAt);
      if (row) byId.set(row.id, row);
    }
  });
  // Si une zone a échoué, on ne retire rien (on ne sait pas ce qui a disparu).
  const rows = [...byId.values()];
  if (rows.length) {
    const { error } = await admin.from("official_incidents").upsert(rows, { onConflict: "id" });
    if (error) { errors.push(`incidents db: ${error.message}`); return 0; }
  }
  if (failed === 0) {
    const { data: current, error: selErr } = await admin.from("official_incidents").select("id").eq("active", true);
    if (selErr) errors.push(`incidents read: ${selErr.message}`);
    const gone = (current ?? []).map((r: { id: string }) => r.id).filter((id: string) => !byId.has(id));
    for (let i = 0; i < gone.length; i += 100) {
      const { error } = await admin.from("official_incidents").update({ active: false }).in("id", gone.slice(i, i + 100));
      if (error) errors.push(`incidents close: ${error.message}`);
    }
  }
  return rows.length;
}

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

  const { data: claim } = await admin.rpc("claim_traffic_refresh", { p_points: points.length + INCIDENT_BOXES.length });
  if (!claim?.claimed) return json(req, { refreshed: false, reason: claim?.reason ?? "unknown" });

  const observedAt = new Date().toISOString();
  const errors: string[] = [];
  const [results, incidentCount] = await Promise.all([
    mapLimit(points as Point[], CONCURRENCY, (p) => provider.fetchPoint(p, key)),
    providerName === "tomtom" ? refreshIncidents(key, observedAt, errors) : Promise.resolve(0),
  ]);
  const rows = [];
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
  return json(req, { refreshed: ok, segments: rows.length, incidents: incidentCount, errors: errors.length });
});
