import { describe, expect, it } from "vitest";
import { initialStyle, keepForHybrid, satelliteStyle } from "./basemaps";

describe("fonds satellite", () => {
  it("style satellite : imagerie raster avec attribution et polices pour les étiquettes", () => {
    const s = satelliteStyle();
    const src = s.sources.satellite as { type: string; attribution: string; tiles: string[] };
    expect(src.type).toBe("raster");
    expect(src.attribution).toMatch(/Esri/);
    expect(src.tiles[0]).toMatch(/World_Imagery/);
    expect(s.glyphs).toMatch(/openfreemap/);
  });
  it("mode hybride : garde routes et noms, retire les surfaces", () => {
    expect(keepForHybrid({ id: "road_motorway", type: "line" })).toBe(true);
    expect(keepForHybrid({ id: "highway-name-major", type: "symbol" })).toBe(true);
    expect(keepForHybrid({ id: "landcover_wood", type: "fill" })).toBe(false);
    expect(keepForHybrid({ id: "water", type: "fill" })).toBe(false);
    expect(keepForHybrid({ id: "waterway_river", type: "line" })).toBe(false);
  });
  it("les fonds vectoriels restent des URL OpenFreeMap", () => {
    expect(initialStyle("liberty")).toBe("https://tiles.openfreemap.org/styles/liberty");
    expect(typeof initialStyle("hybrid")).toBe("object");
  });
});
