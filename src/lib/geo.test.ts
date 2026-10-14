import { describe, expect, it } from "vitest";
import { bearing, COVERAGE, cumulativeDistances, haversine, inBBox, lineLength, snapToLine, type LngLat } from "./geo";

const RABAT: LngLat = [-6.8326, 34.0132];
const SALE: LngLat = [-6.7985, 34.0531];
const KENITRA: LngLat = [-6.5802, 34.261];
const TEMARA: LngLat = [-6.9063, 33.9287];

describe("haversine", () => {
  it("mesure Rabat ↔ Kénitra à vol d'oiseau (≈ 36 km)", () => {
    expect(haversine(RABAT, KENITRA) / 1000).toBeGreaterThan(34);
    expect(haversine(RABAT, KENITRA) / 1000).toBeLessThan(38);
  });
  it("mesure Rabat ↔ Salé (≈ 5,4 km) et Rabat ↔ Témara (≈ 11,5 km)", () => {
    expect(haversine(RABAT, SALE)).toBeGreaterThan(5000);
    expect(haversine(RABAT, SALE)).toBeLessThan(6000);
    expect(haversine(RABAT, TEMARA)).toBeGreaterThan(10500);
    expect(haversine(RABAT, TEMARA)).toBeLessThan(12500);
  });
  it("est nulle pour un même point", () => {
    expect(haversine(RABAT, RABAT)).toBe(0);
  });
});

describe("snapToLine", () => {
  const line: LngLat[] = [RABAT, SALE, KENITRA];
  const cum = cumulativeDistances(line);
  it("renvoie une distance quasi nulle pour un point du tracé", () => {
    const s = snapToLine(SALE, line, cum);
    expect(s.distance).toBeLessThan(1);
    expect(Math.abs(s.along - cum[1])).toBeLessThan(1);
  });
  it("calcule la distance parcourue pour un point à mi-segment", () => {
    const mid: LngLat = [(RABAT[0] + SALE[0]) / 2, (RABAT[1] + SALE[1]) / 2];
    const s = snapToLine(mid, line, cum);
    expect(s.distance).toBeLessThan(5);
    expect(s.along / cum[1]).toBeGreaterThan(0.45);
    expect(s.along / cum[1]).toBeLessThan(0.55);
  });
  it("mesure l'écart d'un point hors tracé", () => {
    const off: LngLat = [RABAT[0] + 0.01, RABAT[1]]; // ≈ 920 m à l'est
    expect(snapToLine(off, line, cum).distance).toBeGreaterThan(400);
  });
  it("lineLength = dernier cumul", () => {
    expect(lineLength(line)).toBeCloseTo(cum[cum.length - 1], 6);
  });
});

describe("bearing / bbox", () => {
  it("Rabat → Kénitra est orienté nord-est", () => {
    const b = bearing(RABAT, KENITRA);
    expect(b).toBeGreaterThan(20);
    expect(b).toBeLessThan(60);
  });
  it("la zone couverte contient les villes prioritaires et exclut Casablanca", () => {
    for (const p of [RABAT, SALE, KENITRA, TEMARA, [-5.7078, 34.2214] as LngLat, [-6.0663, 33.824] as LngLat]) {
      expect(inBBox(p, COVERAGE)).toBe(true);
    }
    expect(inBBox([-7.59, 33.57], COVERAGE)).toBe(false);
  });
});
