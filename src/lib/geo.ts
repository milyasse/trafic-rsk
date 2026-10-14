// Outils géométriques légers (pas de dépendance) : distances en mètres sur la sphère,
// projection d'un point sur une polyligne, distance parcourue le long d'un tracé.

export type LngLat = [number, number];

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function lineLength(line: LngLat[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += haversine(line[i - 1], line[i]);
  return d;
}

/** Cap (degrés, 0 = nord) de a vers b. */
export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface Snap {
  /** Distance du point au tracé (m). */
  distance: number;
  /** Distance parcourue depuis le début du tracé jusqu'au point projeté (m). */
  along: number;
  /** Index du segment [i, i+1] le plus proche. */
  index: number;
  point: LngLat;
}

/**
 * Projette un point sur une polyligne. Projection équirectangulaire locale par segment :
 * précise à quelques centimètres près à l'échelle d'une ville.
 */
export function snapToLine(p: LngLat, line: LngLat[], cumulative?: number[]): Snap {
  const cum = cumulative ?? cumulativeDistances(line);
  let best: Snap = { distance: Infinity, along: 0, index: 0, point: line[0] };
  const kx = Math.cos(toRad(p[1])) * (Math.PI / 180) * R;
  const ky = (Math.PI / 180) * R;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
    const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (d < best.distance) {
      const segLen = cum[i + 1] - cum[i];
      best = {
        distance: d,
        along: cum[i] + t * segLen,
        index: i,
        point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
      };
    }
  }
  return best;
}

export function cumulativeDistances(line: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversine(line[i - 1], line[i]));
  return out;
}

/** Portion d'une polyligne comprise entre deux distances curvilignes (m). */
export function sliceAlong(line: LngLat[], from: number, to: number): LngLat[] {
  if (line.length < 2) return line.slice();
  const cum = cumulativeDistances(line);
  const total = cum[cum.length - 1];
  const a = Math.max(0, Math.min(from, total));
  const b = Math.max(a, Math.min(to, total));
  const at = (d: number): LngLat => {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < d) i++;
    const seg = cum[i + 1] - cum[i];
    const t = seg > 0 ? (d - cum[i]) / seg : 0;
    return [line[i][0] + t * (line[i + 1][0] - line[i][0]), line[i][1] + t * (line[i + 1][1] - line[i][1])];
  };
  const out: LngLat[] = [at(a)];
  for (let i = 0; i < line.length; i++) if (cum[i] > a && cum[i] < b) out.push(line[i]);
  out.push(at(b));
  return out;
}

export interface RoadCandidate { line: LngLat[]; name: string | null; kind: string }
export interface RoadMatch { line: LngLat[]; name: string | null; kind: string; distance: number }

/**
 * Tronçon de route concerné par un incident : la voie la plus proche du point (à moins de `maxDistance` m),
 * coupée à `metersEach` m de part et d'autre du point projeté.
 */
export function roadAround(p: LngLat, candidates: RoadCandidate[], metersEach: number, maxDistance = 60): RoadMatch | null {
  let best: { c: RoadCandidate; snap: Snap } | null = null;
  for (const c of candidates) {
    if (c.line.length < 2) continue;
    const snap = snapToLine(p, c.line);
    if (!best || snap.distance < best.snap.distance) best = { c, snap };
  }
  if (!best || best.snap.distance > maxDistance) return null;
  const line = sliceAlong(best.c.line, best.snap.along - metersEach, best.snap.along + metersEach);
  return { line, name: best.c.name, kind: best.c.kind, distance: best.snap.distance };
}

export type BBox = [number, number, number, number]; // minLng, minLat, maxLng, maxLat

export function lineBBox(line: LngLat[], padMeters = 0): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of line) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const padLat = padMeters / 111_320;
  const padLng = padMeters / (111_320 * Math.cos(toRad((minY + maxY) / 2)));
  return [minX - padLng, minY - padLat, maxX + padLng, maxY + padLat];
}

export function inBBox(p: LngLat, b: BBox): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

/** Zone couverte par l'application (région Rabat-Salé-Kénitra), identique au paramètre serveur. */
export const COVERAGE: BBox = [-7.35, 33.35, -5.35, 34.95];
