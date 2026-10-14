import { describe, expect, it } from "vitest";
import { officialAsReport, officialSeverity, officialStretch, officialType, type OfficialIncident } from "./official";

const base: OfficialIncident = {
  id: "abc", provider: "tomtom", category: 8, magnitude: 4, description: "Route fermée",
  from_name: "Avenue A", to_name: "Avenue B", road_numbers: ["N1"], length_m: 470, delay_s: null,
  start_time: "2026-10-14T08:00:00Z", end_time: null,
  geometry: { type: "LineString", coordinates: [[-6.8, 34.0], [-6.79, 34.0]] },
  lat: 34.0, lng: -6.795, active: true, observed_at: "2026-10-14T15:00:00Z",
};

describe("incidents officiels", () => {
  it("associe les catégories TomTom aux pictogrammes de l'application", () => {
    expect(officialType(1)).toBe("accident");
    expect(officialType(6)).toBe("jam");
    expect(officialType(8)).toBe("road_closed");
    expect(officialType(9)).toBe("roadworks");
    expect(officialType(11)).toBe("flood");
    expect(officialType(4)).toBe("danger");
    expect(officialType(99)).toBe("other");
  });
  it("une fermeture est toujours de gravité forte", () => {
    expect(officialSeverity({ category: 8, magnitude: 0 })).toBe(3);
    expect(officialSeverity({ category: 6, magnitude: 2 })).toBe(2);
    expect(officialSeverity({ category: 6, magnitude: 1 })).toBe(1);
  });
  it("décrit le tronçon concerné", () => {
    expect(officialStretch(base)).toBe("N1 · Avenue A → Avenue B");
    expect(officialStretch({ from_name: "X", to_name: "X", road_numbers: [] })).toBe("X");
  });
  it("forme signalement : préfixe tt:, active, expiration future", () => {
    const now = Date.parse("2026-10-14T16:00:00Z");
    const r = officialAsReport(base, now);
    expect(r.id).toBe("tt:abc");
    expect(r.type).toBe("road_closed");
    expect(r.severity).toBe(3);
    expect(Date.parse(r.expires_at)).toBeGreaterThan(now);
  });
});
