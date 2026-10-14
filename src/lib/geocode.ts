// Recherche d'adresses : Photon (OpenStreetMap, sans clé, autocomplétion) avec repli sur
// Nominatim pour une recherche validée. Usage raisonnable : requêtes regroupées (debounce),
// limitées à la région, mises en cache côté navigateur.
import { COVERAGE, type LngLat } from "./geo";

export interface Place {
  id: string;
  label: string;
  detail: string;
  lngLat: LngLat;
  kind: string;
}

const CENTER: LngLat = [-6.83, 34.02];
const cache = new Map<string, Place[]>();

// deno-lint-ignore no-explicit-any
type PhotonFeature = { geometry: { coordinates: LngLat }; properties: Record<string, any> };

export function photonToPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const label = p.name ?? (street || p.city || p.county || "Lieu");
  const detailParts = [
    p.name && street ? street : null,
    p.district ?? p.locality ?? null,
    p.city ?? p.county ?? null,
  ].filter((x, i, arr): x is string => !!x && x !== label && arr.indexOf(x) === i);
  return {
    id: `${p.osm_type ?? "x"}${p.osm_id ?? Math.random()}`,
    label,
    detail: detailParts.join(", "),
    lngLat: f.geometry.coordinates,
    kind: p.osm_value ?? p.type ?? "place",
  };
}

function insideCoverage([lng, lat]: LngLat): boolean {
  return lng >= COVERAGE[0] - 0.3 && lng <= COVERAGE[2] + 0.3 && lat >= COVERAGE[1] - 0.3 && lat <= COVERAGE[3] + 0.3;
}

export function dedupe(places: Place[]): Place[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    const k = `${p.label}|${p.lngLat[0].toFixed(3)}|${p.lngLat[1].toFixed(3)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function searchPlaces(query: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const key = `${lang}|${q.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const bias = near ?? CENTER;
  const params = new URLSearchParams({
    q,
    limit: "8",
    lang: lang === "en" ? "en" : "fr",
    lat: String(bias[1]),
    lon: String(bias[0]),
    bbox: `${COVERAGE[0] - 0.3},${COVERAGE[1] - 0.3},${COVERAGE[2] + 0.3},${COVERAGE[3] + 0.3}`,
  });
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`photon_${res.status}`);
  const data = await res.json();
  const places = dedupe((data.features as PhotonFeature[]).map(photonToPlace).filter((p) => insideCoverage(p.lngLat)));
  cache.set(key, places);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return places;
}

/** Repli (validation par Entrée) : Nominatim, 1 requête max par action utilisateur. */
export async function searchNominatim(query: string, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({
    q: query, format: "jsonv2", limit: "6", countrycodes: "ma", "accept-language": "fr",
    viewbox: `${COVERAGE[0]},${COVERAGE[3]},${COVERAGE[2]},${COVERAGE[1]}`, bounded: "1",
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal });
  if (!res.ok) throw new Error(`nominatim_${res.status}`);
  const data = (await res.json()) as { place_id: number; display_name: string; name?: string; lat: string; lon: string; type: string }[];
  return data.map((d) => {
    const parts = d.display_name.split(", ");
    return {
      id: `n${d.place_id}`,
      label: d.name || parts[0],
      detail: parts.slice(1, 3).join(", "),
      lngLat: [Number(d.lon), Number(d.lat)] as LngLat,
      kind: d.type,
    };
  });
}

export async function reverseGeocode(p: LngLat, lang: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${p[0]}&lat=${p[1]}&lang=${lang === "en" ? "en" : "fr"}`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const f = data.features?.[0] as PhotonFeature | undefined;
    if (!f) return null;
    const place = photonToPlace(f);
    return [place.label, place.detail].filter(Boolean).join(", ");
  } catch {
    return null;
  }
}
