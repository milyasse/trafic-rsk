import { useState } from "react";
import { formatAge, formatDistance } from "../lib/format";
import { haversine } from "../lib/geo";
import { isLive, matchesFilters, REPORT_TYPES, sortByRecency, type Report, type ReportType } from "../lib/reports";
import { selectOfficial, selectReport, setState, useStore, useT } from "../store";
import { nearestCity } from "../lib/cities";
import { officialSeverity, officialStretch, officialType, type OfficialIncident } from "../lib/official";
import { officialTitle, sortOfficial } from "./ReportCard";
import { IconSide, IncidentBadge, IncidentIcon } from "./Icons";

export function ReportRow({ r, onClick }: { r: Report; onClick?: () => void }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const now = useStore((s) => s.now);
  const userPos = useStore((s) => s.userPos);
  const selected = useStore((s) => s.selectedReportId === r.id);
  const live = isLive(r, now);
  const d = userPos ? haversine(userPos.lngLat, [r.lng, r.lat]) : null;
  return (
    <button
      type="button"
      onClick={onClick ?? (() => selectReport(r.id))}
      aria-label={`${t(`report.type.${r.type}`)} — ${t("incidents.showOnMap")}`}
      className={`flex min-h-[60px] w-full items-center gap-3 rounded-xl px-2 py-2 text-start hover:bg-[var(--surface-2)] ${selected ? "bg-accent-soft" : ""} ${live ? "" : "opacity-70"}`}
    >
      <IncidentBadge type={r.type} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-bold">
          {t(`report.type.${r.type}`)}
          {r.severity === 3 && <span className="text-[var(--color-alerte)]"> · {t("report.severity.3")}</span>}
        </span>
        <span className="muted block truncate text-sm">
          {r.city ?? "—"} · {formatAge(r.created_at, now, lang)}
          {r.confirmations > 0 && ` · ${t("report.confirmations", { n: r.confirmations })}`}
          {!live && ` · ${t(`report.status.${r.status}`)}`}
        </span>
      </span>
      {d != null && <span className="tabular muted shrink-0 text-sm font-bold">{formatDistance(d, lang)}</span>}
      <IconSide dir="next" size={18} className="muted shrink-0" />
    </button>
  );
}

function OfficialRow({ o }: { o: OfficialIncident }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const userPos = useStore((s) => s.userPos);
  const selected = useStore((s) => s.selectedOfficialId === o.id);
  const d = userPos ? haversine(userPos.lngLat, [o.lng, o.lat]) : null;
  const city = nearestCity([o.lng, o.lat]);
  const stretch = officialStretch(o);
  return (
    <button type="button" onClick={() => selectOfficial(o.id)}
      className={`flex min-h-[60px] w-full items-center gap-3 rounded-xl px-2 py-2 text-start hover:bg-[var(--surface-2)] ${selected ? "bg-accent-soft" : ""}`}>
      <IncidentBadge type={officialType(o.category)} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-bold">
          {officialTitle(t, o.category)}
          {officialSeverity(o) === 3 && o.category !== 8 && <span className="text-[var(--color-alerte)]"> · {t("report.severity.3")}</span>}
        </span>
        <span className="muted block truncate text-sm" dir="auto">
          {[city, stretch].filter(Boolean).join(" · ")}
          {o.delay_s != null && o.delay_s >= 60 && ` · +${Math.round(o.delay_s / 60)} min`}
        </span>
      </span>
      {d != null && <span className="tabular muted shrink-0 text-sm font-bold">{formatDistance(d, lang)}</span>}
      <IconSide dir="next" size={18} className="muted shrink-0" />
    </button>
  );
}

export function IncidentsPanel() {
  const t = useT();
  const reports = useStore((s) => s.reports);
  const filters = useStore((s) => s.filters);
  const cities = useStore((s) => s.cities);
  const now = useStore((s) => s.now);
  const [view, setView] = useState<"active" | "history">("active");

  const all = Object.values(reports).filter((r) => matchesFilters(r, filters)).sort(sortByRecency);
  const list = view === "active" ? all.filter((r) => isLive(r, now)) : all;
  const activeCount = Object.values(reports).filter((r) => isLive(r, now)).length;

  const officialAll = useStore((s) => s.officialIncidents);
  const officials = Object.values(officialAll).filter((o) =>
    (filters.type === "all" || officialType(o.category) === filters.type) &&
    officialSeverity(o) >= filters.minSeverity &&
    (filters.city === "all" || nearestCity([o.lng, o.lat]) === filters.city)).sort(sortOfficial);

  const byType = new Map<ReportType, number>();
  for (const r of Object.values(reports)) if (isLive(r, now)) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  for (const o of Object.values(officialAll)) { const ty = officialType(o.category); byType.set(ty, (byType.get(ty) ?? 0) + 1); }

  return (
    <section aria-labelledby="incidents-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="incidents-title" className="panel-title">{t("incidents.title")}</h2>
        <span className="muted text-sm">{t("incidents.count", { n: activeCount + Object.keys(officialAll).length })}</span>
      </div>

      {byType.size > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label={t("incidents.summary")}>
          {[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, n]) => {
            const on = filters.type === type;
            return (
              <button key={type} type="button" aria-pressed={on}
                onClick={() => setState({ filters: { ...filters, type: on ? "all" : type } })}
                className={`chip shrink-0 border-2 ${on ? "border-[var(--accent)]" : "border-transparent"}`}>
                <IncidentIcon type={type} size={18} /> {n} {t(`report.type.${type}`)}
              </button>
            );
          })}
        </div>
      )}

      <div className="segment" role="tablist">
        {(["active", "history"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            type="button"
            onClick={() => setView(v)}
            className="segment-item"
          >
            {t(v === "active" ? "incidents.active" : "incidents.history")}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label>
          <span className="field-label">{t("incidents.filterCity")}</span>
          <select className="field text-[15px]" value={filters.city}
            onChange={(e) => setState({ filters: { ...filters, city: e.target.value } })}>
            <option value="all">{t("incidents.all")}</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>
          <span className="field-label">{t("incidents.filterType")}</span>
          <select className="field text-[15px]" value={filters.type}
            onChange={(e) => setState({ filters: { ...filters, type: e.target.value as ReportType | "all" } })}>
            <option value="all">{t("incidents.allTypes")}</option>
            {REPORT_TYPES.map((ty) => <option key={ty} value={ty}>{t(`report.type.${ty}`)}</option>)}
          </select>
        </label>
        <label>
          <span className="field-label">{t("incidents.filterSeverity")}</span>
          <select className="field text-[15px]" value={filters.minSeverity}
            onChange={(e) => setState({ filters: { ...filters, minSeverity: Number(e.target.value) as 1 | 2 | 3 } })}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{t(`report.severity.${n as 1 | 2 | 3}`)}</option>)}
          </select>
        </label>
      </div>

      <h3 className="mt-1 text-[15px] font-bold">{t("incidents.communityTitle")} <span className="muted">({list.length})</span></h3>
      {list.length === 0 ? (
        <p className="muted py-1 text-sm">{t(view === "active" ? "incidents.empty" : "incidents.emptyHistory")}</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {list.slice(0, 150).map((r) => <li key={r.id}><ReportRow r={r} /></li>)}
        </ul>
      )}

      {view === "active" && officials.length > 0 && (
        <>
          <div className="mt-1">
            <h3 className="text-[15px] font-bold">{t("incidents.officialTitle")} <span className="muted">({officials.length})</span></h3>
            <p className="muted text-xs">{t("incidents.officialHelp")}</p>
          </div>
          <ul className="-mx-2 flex flex-col">
            {officials.slice(0, 200).map((o) => <li key={o.id}><OfficialRow o={o} /></li>)}
          </ul>
        </>
      )}
    </section>
  );
}
