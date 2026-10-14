import { useEffect, useRef, useState } from "react";
import { COVERAGE, inBBox, type LngLat } from "../lib/geo";
import { REPORT_TYPES, type ReportType } from "../lib/reports";
import { createReport } from "../services/data";
import { setState, toast, tr, useStore, useT } from "../store";
import { IconClose, IncidentIcon } from "./Icons";
import { mapCenter } from "./MapView";

export function ReportSheet() {
  const t = useT();
  const sheet = useStore((s) => s.reportSheet);
  const userPos = useStore((s) => s.userPos);
  const [type, setType] = useState<ReportType | null>(null);
  const [severity, setSeverity] = useState<1 | 2 | 3>(2);
  const [description, setDescription] = useState("");
  const [where, setWhere] = useState<"position" | "center" | "picked">("position");
  const [sending, setSending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sheet) return;
    setType(null);
    setSeverity(2);
    setDescription("");
    setWhere(sheet.source === "picked" ? "picked" : userPos ? "position" : "center");
    setTimeout(() => dialogRef.current?.querySelector<HTMLButtonElement>("button[data-type]")?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  if (!sheet) return null;
  const close = () => setState({ reportSheet: null });
  const point: LngLat | null =
    where === "picked" ? sheet.at : where === "position" ? userPos?.lngLat ?? null : mapCenter();

  const send = async () => {
    if (!type || !point) return;
    if (!inBBox(point, COVERAGE)) {
      toast(tr("map.outOfCoverage"), "error");
      return;
    }
    setSending(true);
    const ok = await createReport(type, severity, point, description.trim());
    setSending(false);
    if (ok) close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 lg:items-center" onClick={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="surface max-h-[92vh] w-full overflow-auto rounded-t-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] lg:max-w-lg lg:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") close(); }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="report-title" className="text-xl font-bold">{t("report.title")}</h2>
          <button type="button" onClick={close} aria-label={t("common.close")} className="muted grid h-10 w-10 place-items-center rounded-full hover:bg-[var(--surface-2)]">
            <IconClose />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5" role="radiogroup" aria-label={t("incidents.filterType")}>
          {REPORT_TYPES.map((ty) => (
            <button
              key={ty}
              data-type={ty}
              type="button"
              role="radio"
              aria-checked={type === ty}
              onClick={() => setType(ty)}
              className={`flex h-[92px] flex-col items-center justify-center gap-1.5 rounded-[14px] px-1 text-center text-[13px] leading-4 font-bold ${type === ty ? "border-2 border-[var(--accent)] bg-accent-soft" : "border-[1.5px] hairline"}`}
            >
              <IncidentIcon type={ty} size={28} />
              {t(`report.type.${ty}`)}
            </button>
          ))}
        </div>
        {type === "police" && <p className="muted mt-2 text-xs">{t("report.policeNote")}</p>}

        <fieldset className="mt-4">
          <legend className="text-sm font-bold">{t("report.severity")}</legend>
          <div className="mt-1 flex rounded-[14px] border-[1.5px] hairline p-1">
            {([1, 2, 3] as const).map((n) => (
              <button key={n} type="button" aria-pressed={severity === n} onClick={() => setSeverity(n)}
                className={`h-11 flex-1 rounded-[10px] font-bold ${severity === n ? "bg-accent text-white" : ""}`}>
                {t(`report.severity.${n}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-sm font-bold">{t("report.where")}</legend>
          <div className="mt-1 flex flex-col gap-1 text-[15px]">
            {sheet.source === "picked" && (
              <label className="flex items-center gap-2"><input type="radio" checked={where === "picked"} onChange={() => setWhere("picked")} /> {t("report.wherePicked")}</label>
            )}
            <label className={`flex items-center gap-2 ${userPos ? "" : "opacity-50"}`}>
              <input type="radio" disabled={!userPos} checked={where === "position"} onChange={() => setWhere("position")} /> {t("report.whereMyPosition")}
            </label>
            <label className="flex items-center gap-2"><input type="radio" checked={where === "center"} onChange={() => setWhere("center")} /> {t("report.whereMapCenter")}</label>
          </div>
        </fieldset>

        <label className="mt-4 block">
          <span className="text-sm font-bold">{t("report.description")}</span>
          <input
            className="surface mt-1 h-11 w-full rounded-xl border hairline px-3"
            maxLength={280}
            placeholder={t("report.descriptionPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <button
          type="button"
          disabled={!type || !point || sending}
          onClick={send}
          className="btn btn-danger mt-5 w-full"
        >
          {sending ? t("common.loading") : t("report.send")}
        </button>
      </div>
    </div>
  );
}
