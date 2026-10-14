import { useState } from "react";
import { formatAge } from "../lib/format";
import { isLive, matchesFilters, REPORT_TYPES, sortByRecency, type Report, type ReportType } from "../lib/reports";
import { focusMap, setState, useStore, useT } from "../store";
import { IncidentBadge, IncidentIcon } from "./Icons";

export function ReportRow({ r, onClick }: { r: Report; onClick?: () => void }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const now = useStore((s) => s.now);
  const live = isLive(r, now);
  return (
    <button
      type="button"
      onClick={onClick ?? (() => { setState({ selectedReportId: r.id, pickedPoint: null }); focusMap([r.lng, r.lat], 15); })}
      className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start hover:bg-[var(--surface-2)] ${live ? "" : "opacity-70"}`}
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

  const byType = new Map<ReportType, number>();
  for (const r of Object.values(reports)) if (isLive(r, now)) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);

  return (
    <section aria-labelledby="incidents-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="incidents-title" className="panel-title">{t("incidents.title")}</h2>
        <span className="muted text-sm">{t("incidents.count", { n: activeCount })}</span>
      </div>

      {byType.size > 0 && (
        <p className="text-sm" aria-label={t("incidents.summary")}>
          {[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, n]) => (
            <span key={type} className="me-3 inline-flex items-center gap-1.5 align-middle"><IncidentIcon type={type} size={18} /> {n} {t(`report.type.${type}`)}</span>
          ))}
        </p>
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

      {list.length === 0 ? (
        <p className="muted py-2 text-sm">{t(view === "active" ? "incidents.empty" : "incidents.emptyHistory")}</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {list.slice(0, 150).map((r) => <li key={r.id}><ReportRow r={r} /></li>)}
        </ul>
      )}
    </section>
  );
}
