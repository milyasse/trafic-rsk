import { describe, expect, it } from "vitest";
import { formatCoords, pickNearestPoi } from "./geocode";
import type { LngLat } from "./geo";

const TAP: LngLat = [-6.8352, 34.0209]; // gare Rabat-Ville

describe("choix sur la carte", () => {
  it("formate le point exact en lat, lng à 5 décimales (≈ 1 m)", () => {
    expect(formatCoords(TAP)).toBe("34.02090, -6.83520");
  });
  it("retient le POI nommé le plus proche", () => {
    const poi = pickNearestPoi(TAP, [
      { name: "Café loin", lngLat: [-6.8370, 34.0225] },
      { name: "Gare Rabat Ville", lngLat: [-6.8354, 34.0210], kind: "station" },
      { lngLat: [-6.8352, 34.0209] }, // sans nom : ignoré
    ]);
    expect(poi?.name).toBe("Gare Rabat Ville");
    expect(poi!.distance).toBeLessThan(30);
  });
  it("ignore les POI au-delà du rayon", () => {
    expect(pickNearestPoi(TAP, [{ name: "Kénitra", lngLat: [-6.58, 34.26] }], 250)).toBeNull();
  });
});
