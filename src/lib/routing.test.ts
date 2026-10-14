import { describe, expect, it } from "vitest";
import type { LngLat } from "./geo";
import { prepare, progress, offRouteThreshold } from "./navigation";
import type { Report } from "./reports";
import { annotateRoutes, orderRoutes, usesMotorway, type ProviderRoute } from "./routing";
import type { TrafficSegment } from "./traffic";

const NOW = Date.parse("2026-10-14T12:00:00Z");

// Deux trajets Rabat → Salé simplifiés : A par le pont Hassan II, B plus à l'est
const A: LngLat[] = [[-6.8326, 34.0132], [-6.8226, 34.0249], [-6.7985, 34.0531]];
const B: LngLat[] = [[-6.8326, 34.0132], [-6.80, 34.015], [-6.79, 34.03], [-6.7985, 34.0531]];

function route(id: string, line: LngLat[], duration: number, extra: Partial<ProviderRoute> = {}): ProviderRoute {
  return {
    id, distance: 6000, duration, has_tolls: false,
    geometry: { type: "LineString", coordinates: line },
    steps: [
      { type: "depart", name: "Avenue Hassan II", distance: 1500, duration: 120, location: line[0] },
      { type: "turn", modifier: "right", name: "Pont Hassan II", distance: 4000, duration: 300, location: line[1] },
      { type: "arrive", name: "", distance: 0, duration: 0, location: line[line.length - 1] },
    ],
    ...extra,
  };
}

function report(p: Partial<Report>): Report {
  return {
    id: "r1", type: "accident", severity: 3, description: null, lat: 34.0249, lng: -6.8226, city: "Rabat",
    status: "active", confirmations: 0, resolutions: 0, source: "community",
    created_at: "2026-10-14T11:50:00Z", updated_at: "2026-10-14T11:50:00Z", expires_at: "2026-10-14T13:50:00Z", ...p,
  };
}

describe("annotateRoutes", () => {
  it("le plus rapide est recommandé quand aucun incident n'est signalé", () => {
    const r = annotateRoutes([route("a", A, 600), route("b", B, 700)], [], [], NOW, 75);
    expect(r[0].isFastest && r[0].isRecommended).toBe(true);
    expect(r[0].incidents).toHaveLength(0);
    expect(r[0].measuredDelay).toBeNull();
  });

  it("un accident grave sur le trajet le plus rapide fait recommander l'alternative", () => {
    const r = annotateRoutes([route("a", A, 600), route("b", B, 700)], [report({})], [], NOW, 75);
    const a = r.find((x) => x.id === "a")!;
    const b = r.find((x) => x.id === "b")!;
    expect(a.incidents).toHaveLength(1);
    expect(a.isFastest).toBe(true);
    expect(b.isRecommended).toBe(true);
    expect(orderRoutes(r)[0].id).toBe("b");
  });

  it("ignore les incidents expirés ou résolus", () => {
    const r = annotateRoutes([route("a", A, 600)], [
      report({ id: "x", status: "resolved" }),
      report({ id: "y", expires_at: "2026-10-14T11:00:00Z" }),
    ], [], NOW, 75);
    expect(r[0].incidents).toHaveLength(0);
  });

  it("ajoute le retard mesuré d'un segment récent situé sur le trajet, pas d'un segment périmé", () => {
    const seg = (observed_at: string): TrafficSegment => ({
      point_id: "p", name: "Pont Hassan II", city: "Rabat", level: "heavy",
      current_speed: 20, free_flow_speed: 50, current_travel_time: 400, free_flow_travel_time: 160,
      confidence: 1, road_closure: false, provider: "tomtom", observed_at,
      geometry: { type: "LineString", coordinates: [[-6.8240, 34.0233], [-6.8226, 34.0249], [-6.8210, 34.0268]] },
    });
    const fresh = annotateRoutes([route("a", A, 600)], [], [seg("2026-10-14T11:40:00Z")], NOW, 75);
    expect(fresh[0].measuredDelay).toBe(240);
    const stale = annotateRoutes([route("a", A, 600)], [], [seg("2026-10-14T08:00:00Z")], NOW, 75);
    expect(stale[0].measuredDelay).toBeNull();
  });

  it("détecte l'usage d'une autoroute", () => {
    expect(usesMotorway([{ type: "on ramp", name: "", ref: "A1", distance: 1, duration: 1, location: [0, 0] }])).toBe(true);
    expect(usesMotorway([{ type: "turn", name: "Avenue Annakhil", distance: 1, duration: 1, location: [0, 0] }])).toBe(false);
  });
});

describe("progression de navigation", () => {
  const [annotated] = annotateRoutes([route("a", A, 600)], [], [], NOW, 75);
  const prep = prepare(annotated);

  it("au départ, la prochaine manœuvre est le virage", () => {
    const p = progress(prep, 600, A[0]);
    expect(p.stepIndex).toBe(1);
    expect(p.offset).toBeLessThan(1);
    expect(p.remaining).toBeCloseTo(prep.total, 0);
  });

  it("après le virage, il reste l'arrivée et la durée diminue proportionnellement", () => {
    const after: LngLat = [-6.81, 34.039];
    const p = progress(prep, 600, after);
    expect(p.stepIndex).toBe(2);
    expect(p.remainingDuration).toBeLessThan(600);
    expect(p.remainingDuration).toBeGreaterThan(0);
  });

  it("un point éloigné est hors trajet", () => {
    const far: LngLat = [-6.86, 34.0];
    const p = progress(prep, 600, far);
    expect(p.offset).toBeGreaterThan(offRouteThreshold(10));
  });

  it("le seuil de sortie de route s'adapte à la précision GPS", () => {
    expect(offRouteThreshold(5)).toBe(45);
    expect(offRouteThreshold(60)).toBe(90);
    expect(offRouteThreshold(500)).toBe(120);
  });
});
