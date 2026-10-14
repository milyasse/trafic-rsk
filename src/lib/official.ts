// Incidents officiels du fournisseur de trafic (TomTom Traffic Incidents).
// Ils ne se votent pas : ils sont publiés et retirés par le fournisseur.
import type { LngLat } from "./geo";
import type { Report, ReportType } from "./reports";

export interface OfficialIncident {
  id: string;
  provider: string;
  /** Catégorie TomTom (iconCategory) : 1 accident, 6 bouchon, 8 route fermée, 9 travaux… */
  category: number;
  /** 0 inconnu, 1 faible, 2 modéré, 3 important, 4 indéterminé (fermetures). */
  magnitude: number;
  description: string | null;
  from_name: string | null;
  to_name: string | null;
  road_numbers: string[];
  length_m: number | null;
  delay_s: number | null;
  start_time: string | null;
  end_time: string | null;
  geometry: { type: "LineString"; coordinates: LngLat[] } | { type: "Point"; coordinates: LngLat };
  lat: number;
  lng: number;
  active: boolean;
  observed_at: string;
}

export const OFFICIAL_COLUMNS =
  "id,provider,category,magnitude,description,from_name,to_name,road_numbers,length_m,delay_s,start_time,end_time,geometry,lat,lng,active,observed_at";

/** Catégories TomTom connues (les autres sont affichées comme « autre événement »). */
export const OFFICIAL_CATEGORIES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14] as const;

/** Pictogramme de l'application utilisé pour chaque catégorie TomTom. */
export function officialType(category: number): ReportType {
  switch (category) {
    case 1: return "accident";
    case 6: return "jam";
    case 7: return "obstacle";
    case 8: return "road_closed";
    case 9: return "roadworks";
    case 11: return "flood";
    case 14: return "breakdown";
    case 2: case 3: case 4: case 5: case 10: return "danger";
    default: return "other";
  }
}

/** Gravité sur l'échelle de l'application (1 à 3). Les fermetures sont toujours « forte ». */
export function officialSeverity(o: Pick<OfficialIncident, "category" | "magnitude">): 1 | 2 | 3 {
  if (o.category === 8 || o.magnitude >= 3) return 3;
  if (o.magnitude === 2) return 2;
  return 1;
}

/** Couleur du tracé selon l'importance du retard (mêmes teintes que le trafic). */
export function officialColor(o: Pick<OfficialIncident, "category" | "magnitude">): string {
  if (o.category === 8) return "#7A0F14";
  if (o.category === 9 || o.category === 7) return "#B45309";
  switch (o.magnitude) {
    case 1: return "#F08C1A";
    case 2: return "#D7262E";
    case 3: case 4: return "#7A0F14";
    default: return "#8C96A3";
  }
}

export function officialLine(o: OfficialIncident): LngLat[] {
  return o.geometry.type === "LineString" ? o.geometry.coordinates : [o.geometry.coordinates];
}

/** Libellé d'itinéraire « de … à … » avec numéros de route. */
export function officialStretch(o: Pick<OfficialIncident, "from_name" | "to_name" | "road_numbers">): string {
  const roads = o.road_numbers.length ? `${o.road_numbers.join(", ")} · ` : "";
  if (o.from_name && o.to_name && o.from_name !== o.to_name) return `${roads}${o.from_name} → ${o.to_name}`;
  return `${roads}${o.from_name ?? o.to_name ?? ""}`.replace(/ · $/, "");
}

/**
 * Forme « signalement » d'un incident officiel, pour réutiliser l'analyse des itinéraires et les
 * alertes de navigation. Identifiant préfixé « tt: » ; jamais votable.
 */
export function officialAsReport(o: OfficialIncident, now: number): Report {
  const expires = o.end_time && new Date(o.end_time).getTime() > now
    ? o.end_time
    : new Date(now + 2 * 3600_000).toISOString();
  return {
    id: `tt:${o.id}`,
    type: officialType(o.category),
    severity: officialSeverity(o),
    description: o.description,
    lat: o.lat,
    lng: o.lng,
    city: null,
    status: "active",
    confirmations: 0,
    resolutions: 0,
    source: "admin",
    created_at: o.start_time ?? o.observed_at,
    updated_at: o.observed_at,
    expires_at: expires,
  };
}

export function isOfficialId(id: string): boolean {
  return id.startsWith("tt:");
}
