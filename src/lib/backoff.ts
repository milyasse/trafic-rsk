/** Délai de reconnexion exponentiel plafonné, avec gigue : 1 s, 2 s, 4 s… jusqu'à 30 s. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + random() * 0.5));
}
