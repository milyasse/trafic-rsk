import { describe, expect, it } from "vitest";
import { backoffDelay } from "./backoff";
import { matchCities } from "./cities";
import { formatAge, formatDistance, formatDuration } from "./format";
import { dedupe, photonToPlace } from "./geocode";
import { DEFAULT_FILTERS, errorCode, isLive, matchesFilters, type Report } from "./reports";
import { translate } from "../i18n";

const base: Report = {
  id: "1", type: "jam", severity: 2, description: null, lat: 34.02, lng: -6.83, city: "Rabat", status: "active",
  confirmations: 0, resolutions: 0, source: "community",
  created_at: "2026-10-14T11:00:00Z", updated_at: "2026-10-14T11:00:00Z", expires_at: "2026-10-14T13:00:00Z",
};
const NOW = Date.parse("2026-10-14T12:00:00Z");

describe("signalements", () => {
  it("statut en cours / terminé", () => {
    expect(isLive(base, NOW)).toBe(true);
    expect(isLive({ ...base, status: "confirmed" }, NOW)).toBe(true);
    expect(isLive({ ...base, status: "resolved" }, NOW)).toBe(false);
    expect(isLive({ ...base, expires_at: "2026-10-14T11:59:00Z" }, NOW)).toBe(false);
  });
  it("filtres ville, type et gravité", () => {
    expect(matchesFilters(base, DEFAULT_FILTERS)).toBe(true);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, city: "Kénitra" })).toBe(false);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, type: "accident" })).toBe(false);
    expect(matchesFilters(base, { ...DEFAULT_FILTERS, minSeverity: 3 })).toBe(false);
    expect(matchesFilters({ ...base, city: null }, { ...DEFAULT_FILTERS, city: "Autre" })).toBe(true);
  });
  it("traduit les erreurs serveur en codes connus", () => {
    expect(errorCode({ message: "rate_limited" })).toBe("rate_limited");
    expect(errorCode(new Error("anonymous_disabled: Anonymous sign-ins are disabled"))).toBe("anonymous_disabled");
    expect(errorCode("boom")).toBe("generic");
  });
});

describe("formats", () => {
  it("distances", () => {
    expect(formatDistance(42)).toBe("40 m");
    expect(formatDistance(430)).toBe("450 m");
    expect(formatDistance(47012)).toMatch(/^47 km$/);
    expect(formatDistance(1500)).toMatch(/^1[,.]5 km$/);
  });
  it("durées", () => {
    expect(formatDuration(30)).toBe("1 min");
    expect(formatDuration(40 * 60)).toBe("40 min");
    expect(formatDuration(95 * 60)).toBe("1 h 35");
  });
  it("âge des données", () => {
    expect(formatAge(null, NOW)).toBe("—");
    expect(formatAge("2026-10-14T11:55:00Z", NOW)).toMatch(/5/);
  });
});

describe("géocodage", () => {
  it("convertit un résultat Photon en lieu lisible", () => {
    const p = photonToPlace({
      geometry: { coordinates: [-6.8352, 34.0209] },
      properties: { osm_type: "N", osm_id: 1, name: "Gare Rabat-Ville", street: "Avenue Mohammed V", city: "Rabat", osm_value: "station" },
    });
    expect(p.label).toBe("Gare Rabat-Ville");
    expect(p.detail).toContain("Avenue Mohammed V");
    expect(p.detail).toContain("Rabat");
  });
  it("supprime les doublons", () => {
    const a = { id: "a", label: "Salé", detail: "", lngLat: [-6.7985, 34.0531] as [number, number], kind: "city" };
    expect(dedupe([a, { ...a, id: "b" }])).toHaveLength(1);
  });
  it("recherche locale des villes, sans accents", () => {
    expect(matchCities("kenitra")[0].name).toBe("Kénitra");
    expect(matchCities("tem")[0].name).toBe("Témara");
    expect(matchCities("x")).toHaveLength(0);
  });
});

describe("reconnexion", () => {
  it("délai exponentiel plafonné à 30 s (± gigue)", () => {
    expect(backoffDelay(0, () => 0.5)).toBe(1000);
    expect(backoffDelay(3, () => 0.5)).toBe(8000);
    expect(backoffDelay(20, () => 0.5)).toBe(30000);
    expect(backoffDelay(20, () => 1)).toBeLessThanOrEqual(37500);
  });
});

describe("traductions", () => {
  it("remplace les variables et retombe sur le français", () => {
    expect(translate("fr", "report.confirmations", { n: 3 })).toBe("3 confirmation(s)");
    expect(translate("en", "traffic.unavailable")).toBe("Live traffic unavailable");
    expect(translate("ar", "account.deleteConfirm")).toBe(translate("fr", "account.deleteConfirm"));
    expect(translate("fr", "traffic.unavailable")).toBe("Trafic en temps réel indisponible");
  });
});
