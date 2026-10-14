import { describe, expect, it } from "vitest";
import { lineLength, roadAround, sliceAlong, type LngLat } from "./geo";

// Ligne droite est-ouest d'environ 2 km le long de la latitude 34°.
const LINE: LngLat[] = [[-6.85, 34.0], [-6.84, 34.0], [-6.83, 34.0]];

describe("sliceAlong", () => {
  it("coupe la portion demandée", () => {
    const part = sliceAlong(LINE, 200, 700);
    expect(lineLength(part)).toBeGreaterThan(495);
    expect(lineLength(part)).toBeLessThan(505);
  });
  it("borne aux extrémités du tracé", () => {
    const total = lineLength(LINE);
    expect(lineLength(sliceAlong(LINE, -100, 1e6))).toBeCloseTo(total, 0);
  });
});

describe("roadAround", () => {
  const near: LngLat = [-6.84, 34.0002]; // ~22 m au nord
  it("choisit la voie la plus proche et garde ±m autour", () => {
    const other = { line: [[-6.85, 34.003], [-6.83, 34.003]] as LngLat[], name: "Loin", kind: "minor" };
    const m = roadAround(near, [other, { line: LINE, name: "Avenue Test", kind: "primary" }], 150);
    expect(m?.name).toBe("Avenue Test");
    expect(lineLength(m!.line)).toBeGreaterThan(295);
    expect(lineLength(m!.line)).toBeLessThan(305);
  });
  it("ne renvoie rien si aucune voie n'est assez proche", () => {
    expect(roadAround([-6.84, 34.01], [{ line: LINE, name: null, kind: "x" }], 150)).toBeNull();
  });
});
