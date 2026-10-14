// Trafic RSK — calcul d'itinéraires (proxy serveur)
// - TomTom Routing si le secret TOMTOM_API_KEY est défini : durées avec le trafic en direct
//   (traffic_aware=true), retard dû au trafic, tronçons ralentis, limitations de vitesse.
//   Plafond journalier (TOMTOM_ROUTING_DAILY, 600 par défaut ; offre gratuite : 20 000/mois).
// - sinon, plafond atteint ou échec : openrouteservice (ORS_API_KEY), puis serveur public OSRM
// - réponse normalisée, identique quel que soit le fournisseur ; clés jamais exposées au navigateur
// - limitation de débit par adresse IP, petit cache mémoire, journal d'état des services

import { createClient } from "npm:@supabase/supabase-js@2";

const MOROCCO = { minLng: -17.5, minLat: 20.5, maxLng: -0.9, maxLat: 36.0 };
const RATE_LIMIT = { max: 20, windowSeconds: 60 };
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 3 * 60_000; // court : les durées TomTom dépendent du trafic du moment
const USER_AGENT = "trafic-rsk/1.0 (+https://github.com/milyasse/trafic-rsk)";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://milyasse.github.io,http://localhost:5173,http://localhost:4173").split(",").map((s) => s.trim());

type LngLat = [number, number];
interface Step {
  type: string; modifier?: string; exit?: number; name: string; ref?: string;
  distance: number; duration: number; location: LngLat; text?: string;
}
interface TrafficSection { from: number; to: number; category: string; delay: number; magnitude: number; speed: number | null }
interface SpeedLimit { from: number; to: number; kmh: number }
interface Route {
  id: string; distance: number; duration: number; has_tolls: boolean;
  geometry: { type: "LineString"; coordinates: LngLat[] }; steps: Step[];
  /** TomTom uniquement : retard dû au trafic (déjà inclus dans duration), durée sans trafic. */
  traffic_delay?: number; no_traffic_duration?: number;
  /** Tronçons ralentis et limitations de vitesse, en mètres depuis le départ. */
  traffic_sections?: TrafficSection[]; speed_limits?: SpeedLimit[];
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

// ---------------------------------------------------------------- TomTom
const TOMTOM_DAILY = Number(Deno.env.get("TOMTOM_ROUTING_DAILY") ?? "600");
const TT_MANEUVERS: Record<string, { type: string; modifier?: string }> = {
  DEPART: { type: "depart" }, ARRIVE: { type: "arrive" },
  ARRIVE_LEFT: { type: "arrive", modifier: "left" }, ARRIVE_RIGHT: { type: "arrive", modifier: "right" },
  STRAIGHT: { type: "continue", modifier: "straight" }, FOLLOW: { type: "continue", modifier: "straight" },
  KEEP_RIGHT: { type: "fork", modifier: "slight right" }, BEAR_RIGHT: { type: "turn", modifier: "slight right" },
  TURN_RIGHT: { type: "turn", modifier: "right" }, SHARP_RIGHT: { type: "turn", modifier: "sharp right" },
  KEEP_LEFT: { type: "fork", modifier: "slight left" }, BEAR_LEFT: { type: "turn", modifier: "slight left" },
  TURN_LEFT: { type: "turn", modifier: "left" }, SHARP_LEFT: { type: "turn", modifier: "sharp left" },
  MAKE_UTURN: { type: "continue", modifier: "uturn" }, TRY_MAKE_UTURN: { type: "continue", modifier: "uturn" },
  ENTER_MOTORWAY: { type: "on ramp", modifier: "slight right" }, ENTER_FREEWAY: { type: "on ramp", modifier: "slight right" },
  ENTER_HIGHWAY: { type: "on ramp", modifier: "slight right" }, ENTRANCE_RAMP: { type: "on ramp", modifier: "slight right" },
  TAKE_EXIT: { type: "off ramp", modifier: "slight right" },
  MOTORWAY_EXIT_LEFT: { type: "off ramp", modifier: "slight left" }, MOTORWAY_EXIT_RIGHT: { type: "off ramp", modifier: "slight right" },
  ROUNDABOUT_CROSS: { type: "roundabout" }, ROUNDABOUT_RIGHT: { type: "roundabout" },
  ROUNDABOUT_LEFT: { type: "roundabout" }, ROUNDABOUT_BACK: { type: "roundabout" },
  SWITCH_PARALLEL_ROAD: { type: "continue" }, SWITCH_MAIN_ROAD: { type: "continue" },
  TAKE_FERRY: { type: "continue" }, WAYPOINT_LEFT: { type: "continue" }, WAYPOINT_RIGHT: { type: "continue" },
  WAYPOINT_REACHED: { type: "continue" },
};

function haversine(a: LngLat, b: LngLat): number {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

async function routeTomTom(coords: LngLat[], key: string): Promise<Route[]> {
  const path = coords.map(([lng, lat]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join(":");
  const params = new URLSearchParams({
    key, traffic: "true", travelMode: "car", routeType: "fastest", language: "fr-FR",
    instructionsType: "text", computeTravelTimeFor: "all", routeRepresentation: "polyline",
    maxAlternatives: coords.length === 2 ? "2" : "0",
  });
  for (const st of ["traffic", "speedLimit", "toll"]) params.append("sectionType", st);
  const res = await fetchWithTimeout(`https://api.tomtom.com/routing/1/calculateRoute/${path}/json?${params}`);
  if (!res.ok) throw new Error(`tomtom_http_${res.status}`);
  const data = await res.json();
  // deno-lint-ignore no-explicit-any
  return (data.routes ?? []).map((r: any, i: number): Route => {
    const line: LngLat[] = [];
    for (const leg of r.legs ?? []) {
      for (const p of leg.points ?? []) {
        const pt: LngLat = [p.longitude, p.latitude];
        const last = line[line.length - 1];
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) line.push(pt);
      }
    }
    const cum = [0];
    for (let k = 1; k < line.length; k++) cum.push(cum[k - 1] + haversine(line[k - 1], line[k]));
    const at = (idx: number) => cum[Math.max(0, Math.min(cum.length - 1, idx ?? 0))];

    // deno-lint-ignore no-explicit-any
    const instructions: any[] = r.guidance?.instructions ?? [];
    const steps: Step[] = instructions.map((ins, k) => {
      const next = instructions[k + 1];
      const m = TT_MANEUVERS[ins.maneuver] ?? { type: "continue" };
      return {
        type: m.type, modifier: m.modifier,
        exit: ins.roundaboutExitNumber ?? undefined,
        name: ins.street ?? "",
        ref: Array.isArray(ins.roadNumbers) && ins.roadNumbers.length ? String(ins.roadNumbers[0]) : undefined,
        distance: next ? Math.max(0, next.routeOffsetInMeters - ins.routeOffsetInMeters) : 0,
        duration: next ? Math.max(0, next.travelTimeInSeconds - ins.travelTimeInSeconds) : 0,
        location: [ins.point?.longitude ?? line[0][0], ins.point?.latitude ?? line[0][1]],
        text: ins.message ?? undefined,
      };
    });

    const traffic: TrafficSection[] = [];
    const limits: SpeedLimit[] = [];
    let tolls = false;
    for (const sec of r.sections ?? []) {
      const from = at(sec.startPointIndex), to = at(sec.endPointIndex);
      if (sec.sectionType === "TRAFFIC") {
        traffic.push({
          from, to, category: String(sec.simpleCategory ?? "OTHER"),
          delay: Math.round(sec.delayInSeconds ?? 0), magnitude: Number(sec.magnitudeOfDelay ?? 0),
          speed: typeof sec.effectiveSpeedInKmh === "number" ? sec.effectiveSpeedInKmh : null,
        });
      } else if (sec.sectionType === "SPEED_LIMIT" && typeof sec.maxSpeedLimitInKmh === "number") {
        limits.push({ from, to, kmh: sec.maxSpeedLimitInKmh });
      } else if (sec.sectionType === "TOLL_ROAD" || sec.sectionType === "TOLL") {
        tolls = true;
      }
    }
    const sm = r.summary ?? {};
    return {
      id: `tomtom-${i}`, distance: sm.lengthInMeters, duration: sm.travelTimeInSeconds, has_tolls: tolls,
      geometry: { type: "LineString", coordinates: line }, steps,
      traffic_delay: sm.trafficDelayInSeconds ?? 0,
      no_traffic_duration: sm.noTrafficTravelTimeInSeconds ?? undefined,
      traffic_sections: traffic, speed_limits: limits,
    };
  });
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
  const ttKey = Deno.env.get("TOMTOM_API_KEY");
  let routes: Route[] | null = null;
  let provider = "";
  const errors: string[] = [];

  if (ttKey) {
    // Plafond journalier partagé par tous les utilisateurs (fenêtre de 24 h)
    const { data: underBudget } = await admin.rpc("hit_rate_limit", {
      p_key: "provider:tomtom-routing", p_max: TOMTOM_DAILY, p_window_seconds: 86_400,
    });
    if (underBudget !== false) {
      try {
        routes = await routeTomTom(coords, ttKey);
        if (!routes.length) throw new Error("tomtom_no_route");
        provider = "tomtom";
        await logService(provider, true);
      } catch (e) {
        routes = null;
        errors.push(String(e));
        await logService("tomtom", false, String(e));
      }
    } else {
      errors.push("tomtom_daily_budget");
    }
  }
  if (!routes && orsKey) {
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
    attribution: provider === "tomtom"
      ? "Itinéraires et trafic © TomTom"
      : provider === "osrm"
      ? "Itinéraires © OSRM — données © contributeurs OpenStreetMap (ODbL)"
      : "Itinéraires © openrouteservice.org / HeiGIT — données © contributeurs OpenStreetMap (ODbL)",
    traffic_aware: provider === "tomtom",
    computed_at: new Date().toISOString(),
    routes,
  };
  cache.set(cacheKey, { at: Date.now(), body });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return json(req, body);
});
