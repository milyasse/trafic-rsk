// Valeurs publiques (fournies au build). Aucune clé secrète ne doit apparaître dans le frontend.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "";
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
export const CONFIG_OK = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const MAP_STYLES = {
  liberty: "https://tiles.openfreemap.org/styles/liberty",
  bright: "https://tiles.openfreemap.org/styles/bright",
  positron: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;
export type VectorBasemap = keyof typeof MAP_STYLES;
/** Fonds disponibles : vectoriels OpenFreeMap + imagerie satellite (seule ou avec routes et noms). */
export type Basemap = VectorBasemap | "satellite" | "hybrid";
export const BASEMAPS: Basemap[] = ["liberty", "bright", "positron", "dark", "satellite", "hybrid"];

/** Imagerie satellite Esri World Imagery (attribution obligatoire, affichée sur la carte). */
export const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const SATELLITE_ATTRIBUTION =
  "Imagerie © Esri, Maxar, Earthstar Geographics et la communauté des utilisateurs SIG";

export const INITIAL_VIEW = { center: [-6.83, 34.0] as [number, number], zoom: 10.5 };
/** Limites de navigation de la carte : région élargie (extension future au reste du Maroc possible). */
export const MAX_BOUNDS: [[number, number], [number, number]] = [[-9.5, 32.3], [-4.0, 35.9]];

/** Fréquences (voir docs/ARCHITECTURE.md) */
export const TRAFFIC_PING_MS = 5 * 60_000; // demande au serveur s'il faut rafraîchir le trafic
export const UI_TICK_MS = 30_000; // recalcul de l'âge des données / expirations à l'écran
export const STALE_REFETCH_MS = 60_000; // resynchronisation au retour sur l'onglet
