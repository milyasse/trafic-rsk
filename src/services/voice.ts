import { getState } from "../store";

const VOICE_LANG = { fr: "fr-FR", en: "en-GB", ar: "ar-SA" } as const;

export function speak(text: string): void {
  const s = getState();
  if (!s.voice || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = VOICE_LANG[s.lang];
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  } catch { /* synthèse vocale indisponible */ }
}

export function silence(): void {
  try { window.speechSynthesis?.cancel(); } catch { /* rien */ }
}

// Garder l'écran allumé pendant la navigation (si le navigateur le permet)
let wakeLock: { release: () => Promise<void> } | null = null;
export async function keepScreenOn(on: boolean): Promise<void> {
  try {
    if (on && !wakeLock && "wakeLock" in navigator) {
      // deno-lint-ignore no-explicit-any
      wakeLock = await (navigator as any).wakeLock.request("screen");
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* refusé par le navigateur : sans incidence */ }
}
