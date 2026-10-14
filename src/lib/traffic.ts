// Niveaux de circulation : mêmes seuils que supabase/functions/traffic/index.ts
export type TrafficLevel = "fluid" | "slow" | "heavy" | "jam" | "unknown";

export const TRAFFIC_COLORS: Record<TrafficLevel, string> = {
  fluid: "#2E9E5B",
  slow: "#F08C1A",
  heavy: "#D7262E",
  jam: "#7A0F14",
  unknown: "#8C96A3",
};

export const TRAFFIC_LEVELS: TrafficLevel[] = ["fluid", "slow", "heavy", "jam", "unknown"];

export function classify(current: number | null | undefined, freeFlow: number | null | undefined, closure = false): TrafficLevel {
  if (closure) return "jam";
  if (!current || !freeFlow || freeFlow <= 0) return "unknown";
  const r = current / freeFlow;
  if (r >= 0.85) return "fluid";
  if (r >= 0.65) return "slow";
  if (r >= 0.4) return "heavy";
  return "jam";
}

export interface TrafficSegment {
  point_id: string;
  name: string;
  city: string;
  level: TrafficLevel;
  current_speed: number | null;
  free_flow_speed: number | null;
  current_travel_time: number | null;
  free_flow_travel_time: number | null;
  confidence: number | null;
  road_closure: boolean;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  provider: string;
  observed_at: string;
}

export interface TrafficStatus {
  provider: string | null;
  available: boolean;
  message: string;
  last_success_at: string | null;
  last_attempt_at: string | null;
}

/** Une mesure est périmée au-delà de `staleAfterMinutes` : elle est alors affichée en gris. */
export function isStale(observedAt: string | null | undefined, now: number, staleAfterMinutes: number): boolean {
  if (!observedAt) return true;
  return now - new Date(observedAt).getTime() > staleAfterMinutes * 60_000;
}

/** Niveau réellement affiché : jamais de couleur si la donnée est périmée. */
export function displayLevel(seg: Pick<TrafficSegment, "level" | "observed_at">, now: number, staleAfterMinutes: number): TrafficLevel {
  return isStale(seg.observed_at, now, staleAfterMinutes) ? "unknown" : seg.level;
}

/** Retard estimé (secondes) sur un segment mesuré, jamais négatif. */
export function segmentDelay(seg: Pick<TrafficSegment, "current_travel_time" | "free_flow_travel_time">): number {
  if (seg.current_travel_time == null || seg.free_flow_travel_time == null) return 0;
  return Math.max(0, seg.current_travel_time - seg.free_flow_travel_time);
}

export type TrafficAvailability = "live" | "stale" | "unavailable";

export function availability(status: TrafficStatus | null, now: number, staleAfterMinutes: number): TrafficAvailability {
  if (!status || !status.available) return "unavailable";
  return isStale(status.last_success_at, now, staleAfterMinutes) ? "stale" : "live";
}
