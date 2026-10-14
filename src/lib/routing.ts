import { cumulativeDistances, inBBox, lineBBox, snapToLine, type LngLat } from "./geo";
import { isLive, REPORT_META, type Report } from "./reports";
import { isStale, segmentDelay, type TrafficSegment } from "./traffic";
import type { Step } from "./instructions";

/** Tronçon ralenti sur un itinéraire calculé avec le trafic (distances en m depuis le départ). */
export interface TrafficSection { from: number; to: number; category: string; delay: number; magnitude: number; speed: number | null }
export interface SpeedLimit { from: number; to: number; kmh: number }

export interface ProviderRoute {
  id: string;
  distance: number;
  /** Durée prévue ; avec un fournisseur « traffic_aware », elle inclut déjà le trafic du moment. */
  duration: number;
  has_tolls: boolean;
  geometry: { type: "LineString"; coordinates: LngLat[] };
  steps: Step[];
  /** Fournisseur avec trafic (TomTom) : retard dû au trafic en direct, inclus dans duration. */
  traffic_delay?: number;
  no_traffic_duration?: number;
  traffic_sections?: TrafficSection[];
  speed_limits?: SpeedLimit[];
}

export interface RouteResponse {
  provider: string;
  attribution: string;
  traffic_aware: boolean;
  computed_at: string;
  routes: ProviderRoute[];
}

export interface RouteIncident {
  report: Report;
  along: number;
  distanceFromRoute: number;
}

export interface AnnotatedRoute extends ProviderRoute {
  cumulative: number[];
  incidents: RouteIncident[];
  /** Pénalité indicative (s) due aux incidents signalés. */
  incidentPenalty: number;
  /** Retard mesuré par le fournisseur de trafic (s), null si aucun segment mesuré sur le trajet. */
  measuredDelay: number | null;
  usesMotorway: boolean;
  isFastest: boolean;
  isRecommended: boolean;
}

const INCIDENT_MAX_DISTANCE = 60; // m
const SEGMENT_MAX_DISTANCE = 40; // m

export function usesMotorway(steps: Step[]): boolean {
  return steps.some((s) => /^A\s?\d/i.test(s.ref ?? "") || /autoroute|motorway|الطريق السيار/i.test(s.name ?? ""));
}

export function incidentsOnLine(line: LngLat[], cumulative: number[], reports: Report[], now: number): RouteIncident[] {
  if (line.length < 2) return [];
  const box = lineBBox(line, INCIDENT_MAX_DISTANCE * 2);
  const out: RouteIncident[] = [];
  for (const r of reports) {
    if (!isLive(r, now)) continue;
    const p: LngLat = [r.lng, r.lat];
    if (!inBBox(p, box)) continue;
    const snap = snapToLine(p, line, cumulative);
    if (snap.distance <= INCIDENT_MAX_DISTANCE) out.push({ report: r, along: snap.along, distanceFromRoute: snap.distance });
  }
  return out.sort((a, b) => a.along - b.along);
}

export function measuredDelayOnLine(
  line: LngLat[], cumulative: number[], segments: TrafficSegment[], now: number, staleAfterMinutes: number,
): number | null {
  if (line.length < 2) return null;
  const box = lineBBox(line, SEGMENT_MAX_DISTANCE * 2);
  let matched = false;
  let delay = 0;
  for (const seg of segments) {
    if (isStale(seg.observed_at, now, staleAfterMinutes)) continue;
    const coords = seg.geometry.coordinates;
    if (coords.length < 2) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    if (!inBBox(mid, box)) continue;
    if (snapToLine(mid, line, cumulative).distance <= SEGMENT_MAX_DISTANCE) {
      matched = true;
      delay += segmentDelay(seg);
    }
  }
  return matched ? delay : null;
}

/** Limitation de vitesse (km/h) à une distance donnée du départ, si le fournisseur la donne. */
export function speedLimitAt(route: Pick<ProviderRoute, "speed_limits">, along: number): number | null {
  for (const l of route.speed_limits ?? []) if (along >= l.from && along <= l.to) return l.kmh;
  return null;
}

/**
 * Annote les itinéraires : incidents sur le trajet, pénalité indicative, retard mesuré.
 * `trafficAware` : les durées incluent déjà le trafic et les incidents officiels (identifiants « tt: »),
 * qui ne sont donc pas comptés une seconde fois.
 */
export function annotateRoutes(
  routes: ProviderRoute[], reports: Report[], segments: TrafficSegment[], now: number, staleAfterMinutes: number,
  trafficAware = false,
): AnnotatedRoute[] {
  const annotated = routes.map((r): AnnotatedRoute => {
    const line = r.geometry.coordinates;
    const cumulative = cumulativeDistances(line);
    const incidents = incidentsOnLine(line, cumulative, reports, now);
    const incidentPenalty = incidents.reduce((s, i) =>
      trafficAware && i.report.id.startsWith("tt:") ? s : s + REPORT_META[i.report.type].routeImpact * 60 * (i.report.severity / 2), 0);
    return {
      ...r,
      cumulative,
      incidents,
      incidentPenalty,
      measuredDelay: trafficAware ? null : measuredDelayOnLine(line, cumulative, segments, now, staleAfterMinutes),
      usesMotorway: usesMotorway(r.steps),
      isFastest: false,
      isRecommended: false,
    };
  });
  if (annotated.length) {
    const score = (r: AnnotatedRoute) => r.duration + (r.measuredDelay ?? 0) + r.incidentPenalty;
    let fastest = 0, recommended = 0;
    annotated.forEach((r, i) => {
      if (r.duration < annotated[fastest].duration) fastest = i;
      if (score(r) < score(annotated[recommended])) recommended = i;
    });
    annotated[fastest].isFastest = true;
    annotated[recommended].isRecommended = true;
  }
  return annotated;
}

/** Ordre d'affichage : recommandé d'abord, puis par durée. */
export function orderRoutes(routes: AnnotatedRoute[]): AnnotatedRoute[] {
  return [...routes].sort((a, b) => Number(b.isRecommended) - Number(a.isRecommended) || a.duration - b.duration);
}

export class RouteError extends Error {
  constructor(public code: "rate_limited" | "invalid_coordinates" | "routing_unavailable" | "network", message?: string) {
    super(message ?? code);
  }
}

export async function fetchRoutes(
  functionsUrl: string, apiKey: string, coordinates: LngLat[], signal?: AbortSignal,
): Promise<RouteResponse> {
  let res: Response;
  try {
    res = await fetch(`${functionsUrl}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ coordinates }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new RouteError("network");
  }
  if (res.status === 429) throw new RouteError("rate_limited");
  if (res.status === 400) throw new RouteError("invalid_coordinates");
  if (!res.ok) throw new RouteError("routing_unavailable");
  return (await res.json()) as RouteResponse;
}
