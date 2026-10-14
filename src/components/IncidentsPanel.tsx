import { useState } from "react";
import { formatAge } from "../lib/format";
import { isLive, matchesFilters, REPORT_META, REPORT_TYPES, sortByRecency, type Report, type ReportType } from "../lib/reports";
import { focusMap, setState, useStore, useT } from "../store";

export function ReportRow({ r, onClick }: { r: Report; onClick?: () => void }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const now = useStore((s) => s.now);
  const live = isLive(r, now);
  return (
    <button
      type="button"
      onClick={onClick ?? (() => { setState({ selectedReportId: r.id, pickedPoint: null }); focusMap([r.lng, r.lat], 15); })}
      className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start hover:bg-[var(--surface-2)] ${live ? "" : "opacity-70"}`}
    >
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-[3px] bg-white text-lg"
        style={{ borderColor: REPORT_META[r.type].color }}
        aria-hidden
      >
        {REPORT_META[r.type].glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">
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
        <h2 id="incidents-title" className="text-lg font-bold">{t("incidents.title")}</h2>
        <span className="muted text-sm">{t("incidents.count", { n: activeCount })}</span>
      </div>

      {byType.size > 0 && (
        <p className="text-sm" aria-label={t("incidents.summary")}>
          {[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, n]) => (
            <span key={type} className="me-3 inline-block">{REPORT_META[type].glyph} {n} {t(`report.type.${type}`)}</span>
          ))}
        </p>
      )}

      <div className="flex rounded-xl border hairline p-1 text-sm font-bold" role="tablist">
        {(["active", "history"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            type="button"
            onClick={() => setView(v)}
            className={`h-9 flex-1 rounded-lg ${view === v ? "bg-accent text-white" : ""}`}
          >
            {t(v === "active" ? "incidents.active" : "incidents.history")}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <label>
          <span className="muted block">{t("incidents.filterCity")}</span>
          <select className="surface h-10 w-full rounded-lg border hairline px-2" value={filters.city}
            onChange={(e) => setState({ filters: { ...filters, city: e.target.value } })}>
            <option value="all">{t("incidents.all")}</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>
          <span className="muted block">{t("incidents.filterType")}</span>
          <select className="surface h-10 w-full rounded-lg border hairline px-2" value={filters.type}
            onChange={(e) => setState({ filters: { ...filters, type: e.target.value as ReportType | "all" } })}>
            <option value="all">{t("incidents.allTypes")}</option>
            {REPORT_TYPES.map((ty) => <option key={ty} value={ty}>{t(`report.type.${ty}`)}</option>)}
          </select>
        </label>
        <label>
          <span className="muted block">{t("incidents.filterSeverity")}</span>
          <select className="surface h-10 w-full rounded-lg border hairline px-2" value={filters.minSeverity}
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
