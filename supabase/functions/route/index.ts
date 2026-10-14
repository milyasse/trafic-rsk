// Trafic RSK — calcul d'itinéraires (proxy serveur)
// - openrouteservice si le secret ORS_API_KEY est défini (clé jamais exposée au navigateur)
// - sinon, ou en cas d'échec : serveur public OSRM (best effort, sans garantie)
// - réponse normalisée, identique quel que soit le fournisseur
// - limitation de débit par adresse IP, petit cache mémoire, journal d'état des services
// Aucun des deux fournisseurs ne tient compte du trafic en direct : traffic_aware=false.

import { createClient } from "npm:@supabase/supabase-js@2";

const MOROCCO = { minLng: -17.5, minLat: 20.5, maxLng: -0.9, maxLat: 36.0 };
const RATE_LIMIT = { max: 20, windowSeconds: 60 };
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;
const USER_AGENT = "trafic-rsk/1.0 (+https://github.com/milyasse/trafic-rsk)";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://milyasse.github.io,http://localhost:5173,http://localhost:4173").split(",").map((s) => s.trim());

type LngLat = [number, number];
interface Step {
  type: string; modifier?: string; exit?: number; name: string; ref?: string;
  distance: number; duration: number; location: LngLat; text?: string;
}
interface Route {
  id: string; distance: number; duration: number; has_tolls: boolean;
  geometry: { type: "LineString"; coordinates: LngLat[] }; steps: Step[];
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
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

const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
  auth: { persistSession: false },
});

const cache = new Map<string, { at: number; body: unknown }>();

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") || "unknown";
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function validCoords(input: unknown): LngLat[] | null {
  if (!Array.isArray(input) || input.length < 2 || input.length > 5) return null;
  const out: LngLat[] = [];
  for (const c of input) {
    if (!Array.isArray(c) || c.length !== 2) return null;
    const [lng, lat] = c.map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (lng < MOROCCO.minLng || lng > MOROCCO.maxLng || lat < MOROCCO.minLat || lat > MOROCCO.maxLat) return null;
    out.push([lng, lat]);
  }
  return out;
}

// ---------------------------------------------------------------- OSRM
async function routeOsrm(coords: LngLat[]): Promise<Route[]> {
  const path = coords.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${path}` +
    `?alternatives=${coords.length === 2 ? 2 : "false"}&steps=true&geometries=geojson&overview=full`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`osrm_http_${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok") throw new Error(`osrm_${data.code}`);
  // deno-lint-ignore no-explicit-any
  return data.routes.map((r: any, i: number): Route => {
    const steps: Step[] = [];
    let hasTolls = false;
    for (const leg of r.legs) {
      for (const s of leg.steps) {
        // deno-lint-ignore no-explicit-any
        if (s.intersections?.some((x: any) => x.classes?.includes("toll"))) hasTolls = true;
        steps.push({
          type: s.maneuver.type,
          modifier: s.maneuver.modifier,
          exit: s.maneuver.exit,
          name: s.name ?? "",
          ref: s.ref || undefined,
          distance: s.distance,
          duration: s.duration,
          location: s.maneuver.location,
        });
      }
    }
    return {
      id: `osrm-${i}`, distance: r.distance, duration: r.duration, has_tolls: hasTolls,
      geometry: r.geometry, steps,
    };
  });
}

// ------------------------------------------------------- openrouteservice
const ORS_TYPES: Record<number, { type: string; modifier?: string }> = {
  0: { type: "turn", modifier: "left" }, 1: { type: "turn", modifier: "right" },
  2: { type: "turn", modifier: "sharp left" }, 3: { type: "turn", modifier: "sharp right" },
  4: { type: "turn", modifier: "slight left" }, 5: { type: "turn", modifier: "slight right" },
  6: { type: "continue", modifier: "straight" }, 7: { type: "roundabout" },
  8: { type: "exit roundabout" }, 9: { type: "continue", modifier: "uturn" },
  10: { type: "arrive" }, 11: { type: "depart" },
  12: { type: "fork", modifier: "slight left" }, 13: { type: "fork", modifier: "slight right" },
};

async function routeOrs(coords: LngLat[], key: string): Promise<Route[]> {
  const call = async (alternatives: boolean) => {
    const body: Record<string, unknown> = {
      coordinates: coords, instructions: true, language: "fr", units: "m", extra_info: ["tollways"],
    };
    if (alternatives) body.alternative_routes = { target_count: 3, share_factor: 0.6, weight_factor: 1.4 };
    return await fetchWithTimeout("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify(body),
    });
  };
  let res = await call(coords.length === 2);
  // Les itinéraires alternatifs d'ORS sont limités en distance : nouvel essai sans alternatives.
  if (!res.ok && coords.length === 2) res = await call(false);
  if (!res.ok) throw new Error(`ors_http_${res.status}`);
  const data = await res.json();
  // deno-lint-ignore no-explicit-any
  return data.features.map((f: any, i: number): Route => {
    const coordsLine: LngLat[] = f.geometry.coordinates;
    const steps: Step[] = [];
    for (const seg of f.properties.segments ?? []) {
      for (const s of seg.steps ?? []) {
        const m = ORS_TYPES[s.type] ?? { type: "continue" };
        steps.push({
          type: m.type, modifier: m.modifier, exit: s.exit_number, name: s.name === "-" ? "" : (s.name ?? ""),
          distance: s.distance, duration: s.duration, location: coordsLine[s.way_points?.[0] ?? 0], text: s.instruction,
        });
      }
    }
    // deno-lint-ignore no-explicit-any
    const tolls = f.properties.extras?.tollways?.values?.some((v: any) => v[2] === 1) ?? false;
    return {
      id: `ors-${i}`, distance: f.properties.summary.distance, duration: f.properties.summary.duration,
      has_tolls: tolls, geometry: f.geometry, steps,
    };
  });
}

async function logService(provider: string, ok: boolean, error?: string) {
  try {
    await admin.rpc("record_service_call", { p_service: "routing", p_provider: provider, p_ok: ok, p_error: error ?? null });
  } catch (_) { /* journalisation best effort */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const { data: allowed } = await admin.rpc("hit_rate_limit", {
    p_key: `route:${clientIp(req)}`, p_max: RATE_LIMIT.max, p_window_seconds: RATE_LIMIT.windowSeconds,
  });
  if (allowed === false) return json(req, { error: "rate_limited" }, 429);

  let payload: { coordinates?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json(req, { error: "invalid_json" }, 400);
  }
  const coords = validCoords(payload.coordinates);
  if (!coords) return json(req, { error: "invalid_coordinates" }, 400);

  const cacheKey = coords.map(([a, b]) => `${a.toFixed(4)},${b.toFixed(4)}`).join(";");
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return json(req, { ...(hit.body as object), cached: true });

  const orsKey = Deno.env.get("ORS_API_KEY");
  let routes: Route[] | null = null;
  let provider = "";
  const errors: string[] = [];

  if (orsKey) {
    try {
      routes = await routeOrs(coords, orsKey);
      provider = "openrouteservice";
      await logService(provider, true);
    } catch (e) {
      errors.push(String(e));
      await logService("openrouteservice", false, String(e));
    }
  }
  if (!routes) {
    try {
      routes = await routeOsrm(coords);
      provider = "osrm";
      await logService(provider, true);
    } catch (e) {
      errors.push(String(e));
      await logService("osrm", false, String(e));
    }
  }
  if (!routes || routes.length === 0) return json(req, { error: "routing_unavailable", details: errors }, 502);

  const body = {
    provider,
    attribution: provider === "osrm"
      ? "Itinéraires © OSRM — données © contributeurs OpenStreetMap (ODbL)"
      : "Itinéraires © openrouteservice.org / HeiGIT — données © contributeurs OpenStreetMap (ODbL)",
    traffic_aware: false,
    computed_at: new Date().toISOString(),
    routes,
  };
  cache.set(cacheKey, { at: Date.now(), body });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return json(req, body);
});
