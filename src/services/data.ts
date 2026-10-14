// Chargement des données, abonnement temps réel, actions utilisateur.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { FUNCTIONS_URL, SUPABASE_KEY, STALE_REFETCH_MS, TRAFFIC_PING_MS } from "../config";
import { backoffDelay } from "../lib/backoff";
import { haversine, type LngLat } from "../lib/geo";
import { errorCode, REPORT_COLUMNS, type Report, type ReportType } from "../lib/reports";
import type { TrafficSegment, TrafficStatus } from "../lib/traffic";
import { ensureSession, supabase } from "../lib/supabase";
import { formatDistance } from "../lib/format";
import { getState, setState, toast, tr, upsertReports, type Favorite, type Profile, type Settings } from "../store";
import { hasKey } from "../i18n";

const SEGMENT_COLUMNS =
  "point_id,name,city,level,current_speed,free_flow_speed,current_travel_time,free_flow_travel_time,confidence,road_closure,geometry,provider,observed_at";
const STATUS_COLUMNS = "provider,available,message,last_success_at,last_attempt_at";

function pickReport(row: Record<string, unknown>): Report {
  const r = {} as Record<string, unknown>;
  for (const c of REPORT_COLUMNS.split(",")) r[c] = row[c];
  return r as unknown as Report;
}

// ------------------------------------------------------------------ chargement
export async function loadSettings(): Promise<void> {
  const [{ data: settings }, { data: cities }] = await Promise.all([
    supabase.from("app_settings").select("key,value"),
    supabase.from("cities").select("name,priority").order("priority").order("name"),
  ]);
  if (settings) {
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    const traffic = map.traffic as Settings["traffic"] | undefined;
    if (traffic) setState({ settings: { staleAfterMinutes: traffic.stale_after_minutes ?? 75, traffic } });
  }
  if (cities) setState({ cities: [...cities.map((c) => c.name as string), "Autre"] });
}

export async function loadReports(): Promise<void> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data, error } = await supabase
    .from("reports")
    .select(REPORT_COLUMNS)
    .or(`status.in.(active,confirmed),created_at.gte.${since}`)
    .order("created_at", { ascending: false })
    .limit(800);
  if (error) throw error;
  const fresh: Record<string, Report> = {};
  for (const r of (data ?? []) as unknown as Report[]) fresh[r.id] = r;
  setState({ reports: fresh });
}

export async function loadTraffic(): Promise<void> {
  const [{ data: segs }, { data: status }] = await Promise.all([
    supabase.from("traffic_segments").select(SEGMENT_COLUMNS),
    supabase.from("traffic_status").select(STATUS_COLUMNS).eq("id", 1).maybeSingle(),
  ]);
  setState({
    trafficSegments: (segs ?? []) as unknown as TrafficSegment[],
    trafficStatus: (status ?? null) as TrafficStatus | null,
  });
}

export async function syncAll(): Promise<void> {
  try {
    await Promise.all([loadReports(), loadTraffic()]);
    setState({ lastSync: Date.now() });
  } catch {
    // les données affichées restent celles de la dernière synchronisation ; l'âge est visible
  }
}

/** Demande au serveur s'il est temps d'interroger le fournisseur de trafic (il décide). */
export async function pingTraffic(): Promise<void> {
  try {
    await fetch(`${FUNCTIONS_URL}/traffic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: "{}",
    });
  } catch { /* hors ligne : on réessaiera au prochain intervalle */ }
}

// ------------------------------------------------------------------ temps réel
let channel: RealtimeChannel | null = null;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function onReportChange(eventType: string, row: Record<string, unknown> | null, old: Record<string, unknown> | null) {
  if (eventType === "DELETE") {
    const id = old?.id as string | undefined;
    if (id) setState((s) => { const next = { ...s.reports }; delete next[id]; return { reports: next }; });
    return;
  }
  if (!row) return;
  const report = pickReport(row);
  if (report.status === "hidden") {
    setState((s) => { const next = { ...s.reports }; delete next[report.id]; return { reports: next }; });
    return;
  }
  upsertReports([report]);
  const s = getState();
  if (eventType === "INSERT" && s.userPos && !s.myReportIds.includes(report.id)) {
    const d = haversine(s.userPos.lngLat, [report.lng, report.lat]);
    if (d <= s.alertRadius) {
      toast(tr("report.newNearby", { type: tr(`report.type.${report.type}`), d: formatDistance(d, s.lang) }), "alert");
    }
  }
}

function subscribeChannel() {
  if (channel) void supabase.removeChannel(channel);
  setState({ rtStatus: attempt === 0 ? "connecting" : "reconnecting" });
  channel = supabase
    .channel("trafic-rsk-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "reports" }, (p) =>
      onReportChange(p.eventType, p.new as Record<string, unknown>, p.old as Record<string, unknown>))
    .on("postgres_changes", { event: "*", schema: "public", table: "traffic_segments" }, (p) => {
      const row = p.new as TrafficSegment;
      if (!row?.point_id) return;
      setState((s) => ({ trafficSegments: [...s.trafficSegments.filter((x) => x.point_id !== row.point_id), row] }));
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "traffic_status" }, (p) => {
      const row = p.new as TrafficStatus;
      setState({ trafficStatus: row });
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        const wasReconnecting = attempt > 0;
        attempt = 0;
        setState({ rtStatus: "connected" });
        // Rattraper ce qui a pu être manqué pendant la coupure
        if (wasReconnecting) void syncAll();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (!navigator.onLine) setState({ rtStatus: "offline" });
        scheduleReconnect();
      }
    });
}

function scheduleReconnect() {
  if (retryTimer) return;
  const delay = backoffDelay(attempt++);
  setState({ rtStatus: navigator.onLine ? "reconnecting" : "offline" });
  retryTimer = setTimeout(() => {
    retryTimer = null;
    subscribeChannel();
  }, delay);
}

export function startLiveData(): () => void {
  if (started) return () => {};
  started = true;
  void loadSettings();
  void syncAll();
  void pingTraffic();
  subscribeChannel();

  const pingTimer = setInterval(() => void pingTraffic(), TRAFFIC_PING_MS);
  const onOnline = () => {
    attempt = 0;
    void syncAll();
    subscribeChannel();
  };
  const onOffline = () => setState({ rtStatus: "offline" });
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    const last = getState().lastSync ?? 0;
    if (Date.now() - last > STALE_REFETCH_MS) {
      void syncAll();
      void pingTraffic();
    }
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    started = false;
    clearInterval(pingTimer);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    if (channel) void supabase.removeChannel(channel);
  };
}

// ------------------------------------------------------------------ compte
export async function loadUserData(): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const user = sess.session?.user;
  if (!user) {
    setState({ profile: null, favorites: sortFavorites(readLocalFavorites()), history: [], myReportIds: [] });
    return;
  }
  const [{ data: profile }, { data: favorites }, { data: history }, { data: mine }] = await Promise.all([
    supabase.from("profiles").select("id,role,display_name,preferences,history_consent").eq("id", user.id).maybeSingle(),
    supabase.from("favorites").select("id,kind,label,address,lat,lng").order("created_at"),
    supabase.from("destination_history").select("id,label,lat,lng,created_at").order("created_at", { ascending: false }).limit(15),
    supabase.rpc("my_report_ids"),
  ]);
  const p = profile as Profile | null;
  let favs = (favorites ?? []) as Favorite[];
  if (user.is_anonymous || !p) {
    favs = readLocalFavorites();
  } else if (await migrateLocalFavorites(favs)) {
    const { data } = await supabase.from("favorites").select("id,kind,label,address,lat,lng").order("created_at");
    favs = (data ?? []) as Favorite[];
  }
  setState({
    profile: p,
    favorites: sortFavorites(favs),
    history: (history ?? []) as { id: string; label: string; lat: number; lng: number; created_at: string }[],
    myReportIds: ((mine ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : String(Object.values(x as object)[0]))),
  });
  // Préférences enregistrées sur le compte (prioritaires sur celles du navigateur)
  const prefs = p?.preferences ?? {};
  const patch: Record<string, unknown> = {};
  for (const k of ["lang", "voice", "alertRadius", "basemap", "themePref"]) if (k in prefs) patch[k] = prefs[k];
  if (Object.keys(patch).length) setState(patch);
}

export async function savePreference(key: "lang" | "voice" | "alertRadius" | "basemap" | "themePref", value: unknown) {
  setState({ [key]: value } as never);
  const p = getState().profile;
  if (!p) return;
  const preferences = { ...p.preferences, [key]: value };
  const { error } = await supabase.from("profiles").update({ preferences }).eq("id", p.id);
  if (!error) setState({ profile: { ...p, preferences } });
}

// ------------------------------------------------------------------ signalements
export async function createReport(type: ReportType, severity: 1 | 2 | 3, at: LngLat, description: string): Promise<boolean> {
  try {
    await ensureSession();
    const { data, error } = await supabase.rpc("create_report", {
      p_type: type, p_severity: severity, p_lat: at[1], p_lng: at[0], p_description: description || null,
    });
    if (error) throw error;
    const res = data as { id: string; merged: boolean };
    setState((s) => ({ myReportIds: res.merged ? s.myReportIds : [...s.myReportIds, res.id] }));
    toast(tr(res.merged ? "report.merged" : "report.sent"), "success");
    // Recharger la ligne au cas où l'événement temps réel tarderait
    const { data: row } = await supabase.from("reports").select(REPORT_COLUMNS).eq("id", res.id).maybeSingle();
    if (row) upsertReports([row as unknown as Report]);
    return true;
  } catch (e) {
    const code = errorCode(e);
    const key = `report.error.${code}`;
    toast(hasKey(key) ? tr(key) : tr("report.error.generic"), "error");
    return false;
  }
}

export async function voteReport(id: string, vote: "confirm" | "gone" | "abuse"): Promise<void> {
  try {
    await ensureSession();
    const { data, error } = await supabase.rpc("vote_report", { p_report_id: id, p_vote: vote });
    if (error) throw error;
    const res = data as { status: Report["status"]; confirmations: number; resolutions: number; expires_at: string };
    setState((s) => {
      const r = s.reports[id];
      if (!r) return {};
      return { reports: { ...s.reports, [id]: { ...r, ...res } } };
    });
    toast(tr("report.voted"), "success");
  } catch (e) {
    const key = `report.error.${errorCode(e)}`;
    toast(hasKey(key) ? tr(key) : tr("report.error.generic"), "error");
  }
}

// ------------------------------------------------------------------ favoris / historique
// Avec un compte : favoris enregistrés sur le serveur (privés, RLS). Sans compte : sur cet appareil
// uniquement ; ils sont transférés sur le compte à la première connexion.
const LOCAL_FAV_KEY = "trafic-rsk:favorites";

export function hasAccount(): boolean {
  const s = getState();
  return Boolean(s.session && !s.session.user.is_anonymous && s.profile);
}

function readLocalFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(LOCAL_FAV_KEY);
    const list = raw ? (JSON.parse(raw) as Favorite[]) : [];
    return Array.isArray(list) ? list.filter((f) => f && typeof f.lat === "number" && typeof f.lng === "number") : [];
  } catch {
    return [];
  }
}

function writeLocalFavorites(list: Favorite[]): void {
  try {
    if (list.length) localStorage.setItem(LOCAL_FAV_KEY, JSON.stringify(list));
    else localStorage.removeItem(LOCAL_FAV_KEY);
  } catch { /* stockage indisponible : favoris gardés pour cette session seulement */ }
}

/** Ordre d'affichage : Domicile, Travail, puis les autres par ordre d'ajout. */
function sortFavorites(list: Favorite[]): Favorite[] {
  const rank = (f: Favorite) => (f.kind === "home" ? 0 : f.kind === "work" ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

export async function saveFavorite(kind: Favorite["kind"], label: string, address: string, at: LngLat): Promise<boolean> {
  const clean = label.trim().slice(0, 80) || tr("favorites.unnamed");
  const addr = address.slice(0, 200);
  if (!hasAccount()) {
    let list = readLocalFavorites();
    if (kind !== "other") list = list.filter((f) => f.kind !== kind);
    list.push({ id: `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, kind, label: clean, address: addr, lat: at[1], lng: at[0] });
    writeLocalFavorites(list);
    setState({ favorites: sortFavorites(list) });
    toast(tr("favorites.savedLocal"), "success");
    return true;
  }
  if (kind !== "other") {
    const existing = getState().favorites.find((f) => f.kind === kind);
    if (existing) await supabase.from("favorites").delete().eq("id", existing.id);
  }
  const { error } = await supabase.from("favorites").insert({ kind, label: clean, address: addr, lat: at[1], lng: at[0] });
  if (error) {
    toast(tr("account.error", { msg: error.message }), "error");
    return false;
  }
  await loadUserData();
  toast(tr("favorites.saved"), "success");
  return true;
}

export async function renameFavorite(id: string, label: string): Promise<void> {
  const clean = label.trim().slice(0, 80);
  if (!clean) return;
  if (id.startsWith("local-")) {
    const list = readLocalFavorites().map((f) => (f.id === id ? { ...f, label: clean } : f));
    writeLocalFavorites(list);
  } else {
    const { error } = await supabase.from("favorites").update({ label: clean }).eq("id", id);
    if (error) { toast(tr("account.error", { msg: error.message }), "error"); return; }
  }
  setState((s) => ({ favorites: s.favorites.map((f) => (f.id === id ? { ...f, label: clean } : f)) }));
}

export async function deleteFavorite(id: string): Promise<void> {
  if (id.startsWith("local-")) writeLocalFavorites(readLocalFavorites().filter((f) => f.id !== id));
  else await supabase.from("favorites").delete().eq("id", id);
  setState((s) => ({ favorites: s.favorites.filter((f) => f.id !== id) }));
}

/** Transfère les favoris de l'appareil vers le compte qui vient de se connecter. */
async function migrateLocalFavorites(server: Favorite[]): Promise<boolean> {
  const local = readLocalFavorites();
  if (!local.length) return false;
  const rows = local
    .filter((f) => f.kind === "other" || !server.some((x) => x.kind === f.kind))
    .map((f) => ({ kind: f.kind, label: f.label, address: f.address, lat: f.lat, lng: f.lng }));
  if (rows.length) {
    const { error } = await supabase.from("favorites").insert(rows);
    if (error) return false;
  }
  writeLocalFavorites([]);
  toast(tr("favorites.migrated", { n: rows.length }), "success");
  return true;
}

export async function addHistory(label: string, at: LngLat): Promise<void> {
  const p = getState().profile;
  if (!p?.history_consent) return;
  await supabase.from("destination_history").insert({ label: label.slice(0, 200), lat: at[1], lng: at[0] });
}

export async function setHistoryConsent(value: boolean): Promise<void> {
  const p = getState().profile;
  if (!p) return;
  const { error } = await supabase.from("profiles").update({ history_consent: value }).eq("id", p.id);
  if (!error) setState({ profile: { ...p, history_consent: value } });
}

export async function clearHistory(): Promise<void> {
  const p = getState().profile;
  if (!p) return;
  await supabase.from("destination_history").delete().eq("user_id", p.id);
  setState({ history: [] });
}

export async function deleteAccount(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  const res = await fetch(`${FUNCTIONS_URL}/delete-account`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) return false;
  await supabase.auth.signOut();
  setState({ profile: null, favorites: [], history: [], myReportIds: [] });
  return true;
}
