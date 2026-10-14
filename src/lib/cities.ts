import { haversine, type LngLat } from "./geo";

/** Villes de la région (identiques à la table public.cities). */
export const CITIES: { name: string; lngLat: LngLat }[] = [
  { name: "Rabat", lngLat: [-6.8326, 34.0132] },
  { name: "Salé", lngLat: [-6.7985, 34.0531] },
  { name: "Témara", lngLat: [-6.9063, 33.9287] },
  { name: "Skhirat", lngLat: [-7.0322, 33.8527] },
  { name: "Kénitra", lngLat: [-6.5802, 34.261] },
  { name: "Sidi Kacem", lngLat: [-5.7078, 34.2214] },
  { name: "Sidi Slimane", lngLat: [-5.9264, 34.2597] },
  { name: "Khémisset", lngLat: [-6.0663, 33.824] },
  { name: "Tiflet", lngLat: [-6.3065, 33.8947] },
  { name: "Sidi Yahya El Gharb", lngLat: [-6.3058, 34.305] },
  { name: "Mehdia", lngLat: [-6.6546, 34.2569] },
  { name: "Bouknadel", lngLat: [-6.7445, 34.1253] },
  { name: "Aïn Aouda", lngLat: [-6.7924, 33.8114] },
  { name: "Rommani", lngLat: [-6.6078, 33.5272] },
  { name: "Souk El Arbaa", lngLat: [-5.9849, 34.6855] },
  { name: "Sidi Allal El Bahraoui", lngLat: [-6.5233, 33.9817] },
  { name: "Harhoura", lngLat: [-6.933, 33.95] },
  { name: "Sidi Taibi", lngLat: [-6.6831, 34.1906] },
];

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function matchCities(query: string): { name: string; lngLat: LngLat }[] {
  const q = strip(query);
  if (q.length < 2) return [];
  return CITIES.filter((c) => strip(c.name).startsWith(q) || strip(c.name).includes(` ${q}`)).slice(0, 3);
}

/** Ville de la région la plus proche (à moins de `maxMeters`), pour situer un incident sans ville. */
export function nearestCity(p: LngLat, maxMeters = 15_000): string | null {
  let best: { name: string; d: number } | null = null;
  for (const c of CITIES) {
    const d = haversine(p, c.lngLat);
    if (d <= maxMeters && (!best || d < best.d)) best = { name: c.name, d };
  }
  return best?.name ?? null;
}
