import type { Lang } from "../i18n";

const locales: Record<Lang, string> = { fr: "fr-MA", en: "en-GB", ar: "ar-MA" };

export function formatDistance(m: number, lang: Lang = "fr"): string {
  const nf = new Intl.NumberFormat(locales[lang], { maximumFractionDigits: m < 10_000 ? 1 : 0 });
  if (m < 950) {
    const rounded = m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50;
    return `${rounded} m`;
  }
  return `${nf.format(m / 1000)} km`;
}

export function formatDuration(seconds: number, lang: Lang = "fr"): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return lang === "ar" ? `${min} د` : `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  if (lang === "ar") return r ? `${h} س ${r} د` : `${h} س`;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

export function formatClock(date: Date, lang: Lang = "fr"): string {
  return new Intl.DateTimeFormat(locales[lang], {
    hour: "2-digit", minute: "2-digit", timeZone: "Africa/Casablanca",
  }).format(date);
}

export function formatDateTime(date: Date, lang: Lang = "fr"): string {
  return new Intl.DateTimeFormat(locales[lang], {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Casablanca",
  }).format(date);
}

/** Âge d'une donnée, en clair : « il y a 3 min ». */
export function formatAge(iso: string | null | undefined, now: number, lang: Lang = "fr"): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locales[lang], { numeric: "auto", style: "short" });
  if (s < 45) return rtf.format(0, "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
}
