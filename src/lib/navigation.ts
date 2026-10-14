// Logique de guidage pure (testée) : progression le long du tracé, étape suivante, sortie de route.
import { snapToLine, type LngLat } from "./geo";
import type { AnnotatedRoute } from "./routing";

export interface Prepared {
  routeId: string;
  line: LngLat[];
  cumulative: number[];
  total: number;
  /** Distance le long du tracé à laquelle chaque manœuvre a lieu. */
  stepAlong: number[];
}

export function prepare(route: AnnotatedRoute): Prepared {
  const line = route.geometry.coordinates;
  const cumulative = route.cumulative;
  const total = cumulative[cumulative.length - 1] ?? 0;
  const stepAlong: number[] = [];
  let prev = 0;
  for (const s of route.steps) {
    const along = Math.max(prev, snapToLine(s.location, line, cumulative).along);
    stepAlong.push(along);
    prev = along;
  }
  return { routeId: route.id, line, cumulative, total, stepAlong };
}

export interface Progress {
  offset: number;
  along: number;
  remaining: number;
  remainingDuration: number;
  stepIndex: number;
  distanceToStep: number;
}

export function progress(prep: Prepared, routeDuration: number, pos: LngLat, minAlong = 0): Progress {
  const snap = snapToLine(pos, prep.line, prep.cumulative);
  // On ne recule pas sur le tracé (évite les sauts d'étape dus au bruit GPS)
  const along = Math.max(snap.along, minAlong - 30);
  const remaining = Math.max(0, prep.total - along);
  const remainingDuration = prep.total > 0 ? routeDuration * (remaining / prep.total) : 0;
  let stepIndex = prep.stepAlong.findIndex((a) => a > along + 5);
  if (stepIndex === -1) stepIndex = prep.stepAlong.length - 1;
  const distanceToStep = Math.max(0, (prep.stepAlong[stepIndex] ?? prep.total) - along);
  return { offset: snap.distance, along, remaining, remainingDuration, stepIndex, distanceToStep };
}

/** Seuil de sortie de route, adapté à la précision GPS. */
export function offRouteThreshold(accuracy: number): number {
  return Math.max(45, Math.min(accuracy * 1.5, 120));
}

export const ARRIVAL_DISTANCE = 35;

/** Distances d'annonce vocale selon la vitesse (m/s). */
export function announceDistances(speed: number | null): { far: number; near: number } {
  const v = speed ?? 0;
  return v > 20 ? { far: 1500, near: 300 } : v > 12 ? { far: 800, near: 200 } : { far: 400, near: 80 };
}
