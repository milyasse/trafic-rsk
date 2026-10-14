import { fr, type Key } from "./fr";
import { en } from "./en";
import { ar } from "./ar";

export type Lang = "fr" | "en" | "ar";
export type { Key };

const dictionaries: Record<Lang, Partial<Record<Key, string>>> = { fr, en, ar };

export const LANGS: { code: Lang; label: string; dir: "ltr" | "rtl" }[] = [
  { code: "fr", label: "Français", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "en", label: "English", dir: "ltr" },
];

export type Vars = Record<string, string | number>;

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const template = dictionaries[lang][key] ?? fr[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export function hasKey(key: string): key is Key {
  return key in fr;
}
