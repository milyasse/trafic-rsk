import { describe, expect, it } from "vitest";
import { availability, classify, displayLevel, isStale, segmentDelay } from "./traffic";

describe("classify", () => {
  it("classe selon le rapport vitesse actuelle / vitesse habituelle", () => {
    expect(classify(90, 100)).toBe("fluid");
    expect(classify(70, 100)).toBe("slow");
    expect(classify(50, 100)).toBe("heavy");
    expect(classify(20, 100)).toBe("jam");
  });
  it("route fermée = embouteillage important", () => {
    expect(classify(80, 100, true)).toBe("jam");
  });
  it("données absentes = inconnu (jamais une couleur inventée)", () => {
    expect(classify(null, 100)).toBe("unknown");
    expect(classify(50, 0)).toBe("unknown");
    expect(classify(undefined, undefined)).toBe("unknown");
  });
});

describe("fraîcheur", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  it("une mesure de plus de N minutes est périmée", () => {
    expect(isStale("2026-10-14T11:30:00Z", now, 75)).toBe(false);
    expect(isStale("2026-10-14T10:00:00Z", now, 75)).toBe(true);
    expect(isStale(null, now, 75)).toBe(true);
  });
  it("une mesure périmée s'affiche en gris", () => {
    expect(displayLevel({ level: "jam", observed_at: "2026-10-14T09:00:00Z" }, now, 75)).toBe("unknown");
    expect(displayLevel({ level: "jam", observed_at: "2026-10-14T11:50:00Z" }, now, 75)).toBe("jam");
  });
  it("état global : indisponible / ancien / en direct", () => {
    expect(availability(null, now, 75)).toBe("unavailable");
    expect(availability({ provider: "none", available: false, message: "no_provider", last_success_at: null, last_attempt_at: null }, now, 75)).toBe("unavailable");
    expect(availability({ provider: "tomtom", available: true, message: "ok", last_success_at: "2026-10-14T08:00:00Z", last_attempt_at: null }, now, 75)).toBe("stale");
    expect(availability({ provider: "tomtom", available: true, message: "ok", last_success_at: "2026-10-14T11:45:00Z", last_attempt_at: null }, now, 75)).toBe("live");
  });
  it("retard jamais négatif", () => {
    expect(segmentDelay({ current_travel_time: 300, free_flow_travel_time: 200 })).toBe(100);
    expect(segmentDelay({ current_travel_time: 150, free_flow_travel_time: 200 })).toBe(0);
    expect(segmentDelay({ current_travel_time: null, free_flow_travel_time: 200 })).toBe(0);
  });
});
