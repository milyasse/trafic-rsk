import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatAge, formatClock, formatDistance, formatDuration } from "../lib/format";
import { formatCoords, reverseGeocode } from "../lib/geocode";
import { haversine } from "../lib/geo";
import { INCIDENT_ICONS } from "../lib/icons";
import { isLive, matchesFilters, sortByRecency } from "../lib/reports";
import { officialColor, officialSeverity, officialStretch, officialType, type OfficialIncident } from "../lib/official";
import { voteReport } from "../services/data";
import { cancelPickChoice, commitPick, computeRoutes } from "../services/routes";
import { getState, selectOfficial, selectReport, setState, toast, tr, useStore, useT } from "../store";
import { hasKey } from "../i18n";
import { useBottomInset } from "./BottomSheet";
import { FavoriteStar } from "./Favorites";
import { IconClose, IconSide, IncidentBadge } from "./Icons";

function Floating({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useBottomInset(ref, true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="card-sheet surface fixed inset-x-0 bottom-0 z-30 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+16px)]
        lg:inset-x-auto lg:start-[424px] lg:bottom-6 lg:w-[400px] lg:pt-4"
    >
      <span className="mx-auto mb-2 block h-1.5 w-11 rounded-full bg-[var(--line)] lg:hidden" aria-hidden />
      <button type="button" onClick={onClose} aria-label={t("common.close")} className="icon-btn muted absolute end-2 top-3 lg:top-2">
        <IconClose size={22} />
      </button>
      {children}
    </div>
  );
}

/** Incidents parcourus par « précédent / suivant » : ceux de la liste (en cours, filtres appliqués). */
function useReportSequence(id: string | null): { index: number; ids: string[] } {
  const reports = useStore((s) => s.reports);
  const filters = useStore((s) => s.filters);
  const now = useStore((s) => s.now);
  const ids = Object.values(reports).filter((r) => isLive(r, now) && matchesFilters(r, filters)).sort(sortByRecency).map((r) => r.id);
  return { index: id ? ids.indexOf(id) : -1, ids };
}

export function ReportCard() {
  const t = useT();
  const id = useStore((s) => s.selectedReportId);
  const report = useStore((s) => (s.selectedReportId ? s.reports[s.selectedReportId] : undefined));
  const mine = useStore((s) => (id ? s.myReportIds.includes(id) : false));
  const road = useStore((s) => (s.reportRoad && s.reportRoad.reportId === s.selectedReportId ? s.reportRoad : null));
  const userPos = useStore((s) => s.userPos);
  const lang = useStore((s) => s.lang);
  const now = useStore((s) => s.now);
  const { index, ids } = useReportSequence(id);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setState({ selectedReportId: null, reportRoad: null }), []);

  useEffect(() => {
    if (!id || ids.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
      if (e.key === "ArrowRight" && index < ids.length - 1) selectReport(ids[index + 1]);
      if (e.key === "ArrowLeft" && index > 0) selectReport(ids[index - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, index, ids]);

  if (!id || !report) return null;
  const live = isLive(report, now);
  const color = INCIDENT_ICONS[report.type].color;
  const distance = userPos ? haversine(userPos.lngLat, [report.lng, report.lat]) : null;
  const vote = async (v: "confirm" | "gone" | "abuse") => {
    setBusy(true);
    await voteReport(report.id, v);
    setBusy(false);
  };
  return (
    <Floating label={t(`report.type.${report.type}`)} onClose={close}>
      <div className="flex items-center gap-3 pe-12">
        <IncidentBadge type={report.type} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-bold leading-tight" style={{ color }}>{t(`report.type.${report.type}`)}</h2>
          <p className="truncate text-[15px] font-bold">
            {road?.name ?? report.city ?? t("report.unknownRoad")}
          </p>
          {road?.name && report.city && <p className="muted truncate text-sm">{report.city}</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className="chip" style={report.severity === 3 ? { background: "#FDE8E8", color: "#9B1C1C" } : undefined}>
          {t("report.severity")} : {t(`report.severity.${report.severity}`)}
        </span>
        <span className="chip">{formatAge(report.created_at, now, lang)}</span>
        {distance != null && <span className="chip">{t("report.distanceFromYou", { d: formatDistance(distance, lang) })}</span>}
        {report.confirmations > 0 && <span className="chip">✓ {report.confirmations}</span>}
        {!live && <span className="chip">{t(`report.status.${report.status}`)}</span>}
      </div>

      {road && (
        <p className="mt-3 flex items-center gap-2 text-sm">
          <span aria-hidden className="inline-block h-1.5 w-7 rounded-full" style={{
            background: report.type === "road_closed" ? `repeating-linear-gradient(90deg, ${color} 0 6px, transparent 6px 10px)` : color,
          }} />
          {t(report.type === "road_closed" ? "report.roadClosedShown" : "report.roadShown")}
        </p>
      )}

      {report.description && <p className="mt-3 text-[17px]">« {report.description} »</p>}

      {live && (
        <div className="mt-4 flex gap-2">
          {!mine && (
            <button type="button" disabled={busy} onClick={() => vote("confirm")} className="btn btn-primary flex-1">
              {t("report.stillThere")}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => vote("gone")} className="btn btn-secondary flex-1">
            {t("report.gone")}
          </button>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <p className="muted min-w-0 flex-1 text-xs leading-snug">
          {mine ? t("report.yours") : report.source === "admin" ? t("report.official") : t("report.community")}
          {live && ` · ${t("report.expires", { time: formatClock(new Date(report.expires_at), lang) })}`}
          {report.type === "police" && ` — ${t("report.policeNote")}`}
          {!mine && (
            <>
              {" · "}
              <button type="button" disabled={busy} onClick={() => vote("abuse")} className="underline underline-offset-2">
                {t("report.abuse")}
              </button>
            </>
          )}
        </p>
        {ids.length > 1 && index >= 0 && (
          <div className="flex shrink-0 items-center" aria-label={t("report.browse")}>
            <button type="button" className="icon-btn" disabled={index === 0} onClick={() => selectReport(ids[index - 1])} aria-label={t("report.previous")}>
              <IconSide dir="prev" size={22} />
            </button>
            <span className="tabular muted text-sm font-bold">{index + 1}/{ids.length}</span>
            <button type="button" className="icon-btn" disabled={index === ids.length - 1} onClick={() => selectReport(ids[index + 1])} aria-label={t("report.next")}>
              <IconSide dir="next" size={22} />
            </button>
          </div>
        )}
      </div>
    </Floating>
  );
}

/** Ordre des incidents officiels : les plus gênants d'abord. */
export function sortOfficial(a: OfficialIncident, b: OfficialIncident): number {
  return officialSeverity(b) - officialSeverity(a) || (b.delay_s ?? 0) - (a.delay_s ?? 0) || (b.length_m ?? 0) - (a.length_m ?? 0);
}

export function officialTitle(t: ReturnType<typeof useT>, category: number): string {
  const key = `official.cat.${category}`;
  return hasKey(key) ? t(key as Parameters<typeof t>[0]) : t("official.cat.0");
}

/** Fiche d'un incident publié par TomTom : pas de vote, source et horaires affichés. */
export function OfficialCard() {
  const t = useT();
  const id = useStore((s) => s.selectedOfficialId);
  const o = useStore((s) => (s.selectedOfficialId ? s.officialIncidents[s.selectedOfficialId] : undefined));
  const all = useStore((s) => s.officialIncidents);
  const userPos = useStore((s) => s.userPos);
  const lang = useStore((s) => s.lang);
  const now = useStore((s) => s.now);
  const close = useCallback(() => setState({ selectedOfficialId: null }), []);
  const ids = Object.values(all).sort(sortOfficial).map((x) => x.id);
  const index = id ? ids.indexOf(id) : -1;

  useEffect(() => {
    if (!id || ids.length < 2) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
      if (e.key === "ArrowRight" && index < ids.length - 1) selectOfficial(ids[index + 1]);
      if (e.key === "ArrowLeft" && index > 0) selectOfficial(ids[index - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, index, ids]);

  if (!id || !o) return null;
  const title = officialTitle(t, o.category);
  const color = officialColor(o);
  const stretch = officialStretch(o);
  const distance = userPos ? haversine(userPos.lngLat, [o.lng, o.lat]) : null;
  const magKey = `official.mag.${o.magnitude}`;
  return (
    <Floating label={title} onClose={close}>
      <div className="flex items-center gap-3 pe-12">
        <IncidentBadge type={officialType(o.category)} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-bold leading-tight" style={{ color }}>{title}</h2>
          {stretch && <p className="line-clamp-2 text-[15px] font-bold" dir="auto">{stretch}</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {hasKey(magKey) && o.magnitude > 0 && (
          <span className="chip" style={officialSeverity(o) === 3 ? { background: "#FDE8E8", color: "#9B1C1C" } : undefined}>
            {t(magKey as Parameters<typeof t>[0])}
          </span>
        )}
        {o.delay_s != null && o.delay_s >= 60 && <span className="chip">{t("official.delay", { d: formatDuration(o.delay_s, lang) })}</span>}
        {o.length_m != null && o.length_m > 0 && <span className="chip">{t("official.length", { d: formatDistance(o.length_m, lang) })}</span>}
        {distance != null && <span className="chip">{t("report.distanceFromYou", { d: formatDistance(distance, lang) })}</span>}
      </div>

      {o.description && o.description !== title && <p className="mt-3 text-[17px]">{o.description}</p>}

      <p className="muted mt-3 text-sm">
        {o.start_time && t("official.since", { age: formatAge(o.start_time, now, lang) })}
        {o.end_time && ` · ${t("official.until", { time: formatClock(new Date(o.end_time), lang) })}`}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <p className="muted min-w-0 flex-1 text-xs leading-snug">
          {t("official.source", { age: formatAge(o.observed_at, now, lang) })}
        </p>
        {ids.length > 1 && index >= 0 && (
          <div className="flex shrink-0 items-center" aria-label={t("report.browse")}>
            <button type="button" className="icon-btn" disabled={index === 0} onClick={() => selectOfficial(ids[index - 1])} aria-label={t("report.previous")}>
              <IconSide dir="prev" size={22} />
            </button>
            <span className="tabular muted text-sm font-bold">{index + 1}/{ids.length}</span>
            <button type="button" className="icon-btn" disabled={index === ids.length - 1} onClick={() => selectOfficial(ids[index + 1])} aria-label={t("report.next")}>
              <IconSide dir="next" size={22} />
            </button>
          </div>
        )}
      </div>
    </Floating>
  );
}

export function PickedCard() {
  const t = useT();
  const picked = useStore((s) => s.pickedPoint);
  const lang = useStore((s) => s.lang);
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    setAddress(null);
    if (!picked) return;
    const ctrl = new AbortController();
    void reverseGeocode(picked, lang, ctrl.signal).then((a) => { if (!ctrl.signal.aborted) setAddress(a); });
    return () => ctrl.abort();
  }, [picked, lang]);
  if (!picked) return null;
  const label = address ? `${formatCoords(picked)} — ${address}` : formatCoords(picked);
  return (
    <Floating label={t("map.pickedPoint")} onClose={() => setState({ pickedPoint: null })}>
      <h2 className="pe-10 text-lg font-bold">{t("map.pickedPoint")}</h2>
      <p className="tabular font-bold">{formatCoords(picked)}</p>
      <p className="muted text-sm">{address ?? t("common.loading")}</p>
      <FavoriteStar className="mt-2" label={address?.split(",")[0] ?? formatCoords(picked)} address={label} lngLat={picked} />
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-primary flex-1"
          onClick={() => { setState({ pickedPoint: null }); void computeRoutes({ label, lngLat: picked }); }}>
          {t("map.goHere")}
        </button>
        <button type="button" className="btn btn-secondary flex-1"
          onClick={() => {
            setState({ origin: { label, lngLat: picked }, pickedPoint: null });
            if (getState().destination) void computeRoutes();
            else setState({ panel: "search", sheet: "half" });
          }}>
          {t("route.fromHere")}
        </button>
      </div>
      <button type="button" className="btn btn-secondary mt-2 w-full"
        onClick={() => setState({ reportSheet: { at: picked, source: "picked" }, pickedPoint: null })}>
        {t("map.reportHere")}
      </button>
    </Floating>
  );
}

/** Après un toucher en mode sélection : point exact (X,Y) ou lieu nommé le plus proche. */
export function PickChoiceCard() {
  const t = useT();
  const c = useStore((s) => s.pickChoice);
  const lang = useStore((s) => s.lang);
  if (!c) return null;
  const coords = formatCoords(c.point);
  const title = t(c.target === "origin" ? "pick.chosenOrigin" : c.target === "favorite" ? "pick.chosenFavorite" : "pick.chosenDestination");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coords);
      toast(tr("pick.copied"), "success", undefined, 2500);
    } catch { /* presse-papiers indisponible */ }
  };
  return (
    <Floating label={title} onClose={cancelPickChoice}>
      <h2 className="pe-10 text-lg font-bold">{title}</h2>
      <p className="muted mt-1 text-sm">{t("pick.coords")}</p>
      <div className="flex items-center gap-2">
        <span className="tabular text-lg font-bold">{coords}</span>
        <button type="button" onClick={copy} className="accent text-sm font-bold underline-offset-4 hover:underline">{t("pick.copy")}</button>
      </div>
      {c.address && <p className="muted text-sm">{t("pick.near", { address: c.address })}</p>}

      <button type="button" onClick={() => void commitPick("exact")} className="btn btn-primary mt-3 w-full">
        {t(c.target === "favorite" ? "pick.useForFavorite" : "pick.useExact")}
      </button>

      <p className="muted mt-3 text-sm">{t("pick.poiTitle")}</p>
      {c.poi ? (
        <button type="button" onClick={() => void commitPick("poi")} className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-[var(--accent)] px-3 font-bold">
          <span className="truncate">{t("pick.usePoi", { name: c.poi.name, d: formatDistance(c.poi.distance, lang) })}</span>
        </button>
      ) : (
        <p className="text-sm">{c.loading ? t("pick.searching") : t("pick.noPoi")}</p>
      )}
    </Floating>
  );
}
