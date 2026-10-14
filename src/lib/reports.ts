import type { LngLat } from "./geo";

export const REPORT_TYPES = [
  "jam", "accident", "road_closed", "roadworks", "breakdown",
  "obstacle", "flood", "danger", "police", "other",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportStatus = "active" | "confirmed" | "resolved" | "expired" | "hidden";

export interface Report {
  id: string;
  type: ReportType;
  severity: 1 | 2 | 3;
  description: string | null;
  lat: number;
  lng: number;
  city: string | null;
  status: ReportStatus;
  confirmations: number;
  resolutions: number;
  flags?: number;
  source: "community" | "admin";
  created_at: string;
  updated_at: string;
  expires_at: string;
}

/** Colonnes lues côté client : jamais d'information sur l'auteur. */
export const REPORT_COLUMNS =
  "id,type,severity,description,lat,lng,city,status,confirmations,resolutions,source,created_at,updated_at,expires_at";

/** Pictogramme + couleur (couleurs distinctes de la palette trafic). */
export const REPORT_META: Record<ReportType, { glyph: string; color: string; routeImpact: number }> = {
  jam:         { glyph: "🚗", color: "#C2410C", routeImpact: 5 },
  accident:    { glyph: "💥", color: "#B91C1C", routeImpact: 8 },
  road_closed: { glyph: "⛔", color: "#7F1D1D", routeImpact: 30 },
  roadworks:   { glyph: "🚧", color: "#B45309", routeImpact: 3 },
  breakdown:   { glyph: "🔧", color: "#6D28D9", routeImpact: 2 },
  obstacle:    { glyph: "⚠️", color: "#A16207", routeImpact: 1 },
  flood:       { glyph: "🌊", color: "#1D4ED8", routeImpact: 15 },
  danger:      { glyph: "❗", color: "#9D174D", routeImpact: 1 },
  police:      { glyph: "👮", color: "#1E3A8A", routeImpact: 0 },
  other:       { glyph: "📍", color: "#475569", routeImpact: 0 },
};

export function isLive(r: Pick<Report, "status" | "expires_at">, now: number): boolean {
  return (r.status === "active" || r.status === "confirmed") && new Date(r.expires_at).getTime() > now;
}

export interface ReportFilters {
  city: string | "all";
  type: ReportType | "all";
  minSeverity: 1 | 2 | 3;
}

export const DEFAULT_FILTERS: ReportFilters = { city: "all", type: "all", minSeverity: 1 };

export function matchesFilters(r: Report, f: ReportFilters): boolean {
  if (f.city !== "all" && (r.city ?? "Autre") !== f.city) return false;
  if (f.type !== "all" && r.type !== f.type) return false;
  return r.severity >= f.minSeverity;
}

export function sortByRecency(a: Report, b: Report): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export function reportPoint(r: Pick<Report, "lng" | "lat">): LngLat {
  return [r.lng, r.lat];
}

/** Code d'erreur métier renvoyé par les fonctions SQL (raise exception 'xxx'). */
export function errorCode(err: unknown): string {
  const msg = typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err);
  const known = ["auth_required", "rate_limited", "out_of_coverage", "own_report", "report_closed", "not_found", "anonymous_disabled"];
  return known.find((k) => msg.includes(k)) ?? (/anonymous/i.test(msg) ? "anonymous_disabled" : "generic");
}
