// Construction des styles de carte : vectoriels (URL OpenFreeMap) ou satellite (style construit ici).
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { MAP_STYLES, SATELLITE_ATTRIBUTION, SATELLITE_TILES, type Basemap } from "../config";

const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

export function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      satellite: { type: "raster", tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: 19, attribution: SATELLITE_ATTRIBUTION },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#1b2a1b" } },
      { id: "satellite", type: "raster", source: "satellite" },
    ],
  };
}

/** Couches de la carte vectorielle conservées par-dessus l'imagerie : routes, ponts, tunnels, noms et POI. */
export function keepForHybrid(layer: Pick<LayerSpecification, "id" | "type">): boolean {
  if (layer.type === "symbol") return true;
  if (layer.type !== "line") return false;
  return /road|highway|bridge|tunnel|motorway|transportation|railway|aeroway|boundary/i.test(layer.id);
}

let hybridCache: StyleSpecification | null = null;

/** Satellite + routes et noms OpenStreetMap (style « liberty » filtré, posé sur l'imagerie). */
export async function hybridStyle(): Promise<StyleSpecification> {
  if (hybridCache) return hybridCache;
  const base = (await fetch(MAP_STYLES.liberty).then((r) => r.json())) as StyleSpecification;
  const sat = satelliteStyle();
  hybridCache = {
    ...base,
    sources: { ...base.sources, ...sat.sources },
    layers: [
      ...sat.layers,
      ...base.layers.filter(keepForHybrid).map((l) =>
        l.type === "line" ? { ...l, paint: { ...(l.paint ?? {}), "line-opacity": 0.75 } } as LayerSpecification : l),
    ],
  };
  return hybridCache;
}

/** Style utilisable immédiatement (le mode hybride commence par l'imagerie seule). */
export function initialStyle(b: Basemap): string | StyleSpecification {
  if (b === "satellite" || b === "hybrid") return satelliteStyle();
  return MAP_STYLES[b];
}

export async function resolveStyle(b: Basemap): Promise<string | StyleSpecification> {
  if (b === "hybrid") {
    try {
      return await hybridStyle();
    } catch {
      return satelliteStyle();
    }
  }
  return initialStyle(b);
}
