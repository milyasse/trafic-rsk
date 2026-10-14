// Petit magasin d'état global (useSyncExternalStore), sans dépendance externe.
import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Basemap } from "./config";
import type { Lang, Key, Vars } from "./i18n";
import { translate } from "./i18n";
import type { LngLat } from "./lib/geo";
import { DEFAULT_FILTERS, type Report, type ReportFilters } from "./lib/reports";
import type { AnnotatedRoute, RouteResponse } from "./lib/routing";
import type { TrafficSegment, TrafficStatus } from "./lib/traffic";

export type ThemePref = "auto" | "light" | "dark";
export type Panel = "search" | "incidents" | "account";
export type RtStatus = "connecting" | "connected" | "reconnecting" | "offline";

export interface Place { label: string; lngLat: LngLat }
export interface UserPosition { lngLat: LngLat; accuracy: number; heading: number | null; speed: number | null; ts: number }
export interface Profile { id: string; role: "user" | "admin"; display_name: string | null; preferences: Record<string, unknown>; history_consent: boolean }
export interface Favorite { id: string; kind: "home" | "work" | "other"; label: string; address: string | null; lat: number; lng: number }
export interface HistoryItem { id: string; label: string; lat: number; lng: number; created_at: string }
export interface Toast { id: number; text: string; tone: "info" | "success" | "error" | "alert"; action?: { label: string; run: () => void } }

export interface NavState {
  routeId: string;
  stepIndex: number;
  distanceToStep: number;
  remainingDistance: number;
  remainingDuration: number;
  offRoute: boolean;
  rerouting: boolean;
  arrived: boolean;
  following: boolean;
  alertAhead: { reportId: string; distance: number } | null;
  suggestion: { route: AnnotatedRoute; avoided: number; deltaSeconds: number } | null;
}

export interface Settings {
  staleAfterMinutes: number;
  traffic: { enabled: boolean; refresh_minutes: number; active_hours: [number, number]; daily_budget: number; stale_after_minutes: number };
}

export interface State {
  lang: Lang;
  themePref: ThemePref;
  basemap: Basemap;
  showTraffic: boolean;
  showReports: boolean;
  voice: boolean;
  alertRadius: number;

  session: Session | null;
  profile: Profile | null;
  favorites: Favorite[];
  history: HistoryItem[];

  reports: Record<string, Report>;
  myReportIds: string[];
  trafficSegments: TrafficSegment[];
  trafficStatus: TrafficStatus | null;
  settings: Settings;
  cities: string[];

  rtStatus: RtStatus;
  lastSync: number | null;
  now: number;

  userPos: UserPosition | null;
  geoError: Key | null;
  watching: boolean;

  origin: Place | null; // null = ma position
  destination: Place | null;
  routeResponse: RouteResponse | null;
  routes: AnnotatedRoute[];
  selectedRouteId: string | null;
  routeLoading: boolean;
  routeError: Key | null;
  nav: NavState | null;

  filters: ReportFilters;
  panel: Panel;
  sheetExpanded: boolean;
  selectedReportId: string | null;
  pickedPoint: LngLat | null;
  reportSheet: { at: LngLat | null; source: "position" | "center" | "picked" } | null;
  layerMenu: boolean;
  /** Mode « choisir sur la carte » : le prochain toucher sur la carte définit ce point. */
  pickMode: "destination" | "origin" | null;
  /** Point touché en mode sélection, en attente du choix : point exact (X,Y) ou POI le plus proche. */
  pickChoice: {
    target: "destination" | "origin";
    point: LngLat;
    address: string | null;
    poi: { name: string; lngLat: LngLat; distance: number; kind: string } | null;
    loading: boolean;
  } | null;
  mapCommand: { id: number; center: LngLat; zoom?: number } | null;
  toasts: Toast[];
}

const PREF_KEY = "trafic-rsk:prefs";

function loadPrefs(): Partial<State> {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const browserLang = (): Lang => {
  if (typeof navigator === "undefined") return "fr";
  const l = navigator.language?.slice(0, 2);
  return l === "ar" ? "ar" : l === "en" ? "en" : "fr";
};

const prefs = typeof window !== "undefined" ? loadPrefs() : {};

let state: State = {
  lang: browserLang(),
  themePref: "auto",
  basemap: "liberty",
  showTraffic: true,
  showReports: true,
  voice: true,
  alertRadius: 2000,
  ...prefs,

  session: null,
  profile: null,
  favorites: [],
  history: [],
  reports: {},
  myReportIds: [],
  trafficSegments: [],
  trafficStatus: null,
  settings: {
    staleAfterMinutes: 75,
    traffic: { enabled: true, refresh_minutes: 30, active_hours: [6, 22], daily_budget: 600, stale_after_minutes: 75 },
  },
  cities: [],
  rtStatus: "connecting",
  lastSync: null,
  now: Date.now(),
  userPos: null,
  geoError: null,
  watching: false,
  origin: null,
  destination: null,
  routeResponse: null,
  routes: [],
  selectedRouteId: null,
  routeLoading: false,
  routeError: null,
  nav: null,
  filters: DEFAULT_FILTERS,
  panel: "search",
  sheetExpanded: false,
  selectedReportId: null,
  pickedPoint: null,
  reportSheet: null,
  layerMenu: false,
  pickMode: null,
  pickChoice: null,
  mapCommand: null,
  toasts: [],
};

const listeners = new Set<() => void>();
const PERSISTED: (keyof State)[] = ["lang", "themePref", "basemap", "showTraffic", "showReports", "voice", "alertRadius"];

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  if (PERSISTED.some((k) => k in p)) {
    try {
      const out: Record<string, unknown> = {};
      for (const k of PERSISTED) out[k] = state[k];
      localStorage.setItem(PREF_KEY, JSON.stringify(out));
    } catch { /* stockage indisponible : préférences non conservées */ }
  }
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

export function useT() {
  const lang = useStore((s) => s.lang);
  return (key: Key, vars?: Vars) => translate(lang, key, vars);
}

export function tr(key: Key, vars?: Vars): string {
  return translate(state.lang, key, vars);
}

let toastId = 0;
export function toast(text: string, tone: Toast["tone"] = "info", action?: Toast["action"], ms = 5000): void {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone, action }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ms);
}

export function upsertReports(rows: Report[]): void {
  setState((s) => {
    const next = { ...s.reports };
    for (const r of rows) next[r.id] = r;
    return { reports: next };
  });
}

export function focusMap(center: LngLat, zoom?: number): void {
  setState((s) => ({ mapCommand: { id: (s.mapCommand?.id ?? 0) + 1, center, zoom } }));
}
