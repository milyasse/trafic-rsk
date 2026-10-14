import { useEffect, useState, type ReactNode } from "react";
import { formatAge, formatClock } from "../lib/format";
import { reverseGeocode } from "../lib/geocode";
import { isLive, REPORT_META } from "../lib/reports";
import { voteReport } from "../services/data";
import { computeRoutes } from "../services/routes";
import { setState, useStore, useT } from "../store";
import { IconClose } from "./Icons";

function Floating({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  const t = useT();
  return (
    <div
      role="dialog"
      aria-label={label}
      className="surface fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+92px)] z-40 rounded-2xl border hairline p-4 shadow-2xl lg:inset-x-auto lg:start-[424px] lg:bottom-6 lg:w-[380px]"
    >
      <button type="button" onClick={onClose} aria-label={t("common.close")} className="muted absolute end-2 top-2 grid h-10 w-10 place-items-center rounded-full hover:bg-[var(--surface-2)]">
        <IconClose size={20} />
      </button>
      {children}
    </div>
  );
}

export function ReportCard() {
  const t = useT();
  const id = useStore((s) => s.selectedReportId);
  const report = useStore((s) => (s.selectedReportId ? s.reports[s.selectedReportId] : undefined));
  const mine = useStore((s) => (id ? s.myReportIds.includes(id) : false));
  const lang = useStore((s) => s.lang);
  const now = useStore((s) => s.now);
  const [busy, setBusy] = useState(false);
  if (!id || !report) return null;
  const live = isLive(report, now);
  const close = () => setState({ selectedReportId: null });
  const vote = async (v: "confirm" | "gone" | "abuse") => {
    setBusy(true);
    await voteReport(report.id, v);
    setBusy(false);
  };
  return (
    <Floating label={t(`report.type.${report.type}`)} onClose={close}>
      <div className="flex items-start gap-3 pe-10">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-[3px] bg-white text-2xl" style={{ borderColor: REPORT_META[report.type].color }} aria-hidden>
          {REPORT_META[report.type].glyph}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-tight">{t(`report.type.${report.type}`)}</h2>
          <p className="muted text-sm">
            {report.city ?? "—"} · {t(`report.severity.${report.severity}`)} · {t(`report.status.${report.status}`)}
          </p>
        </div>
      </div>
      {report.description && <p className="mt-3">{report.description}</p>}
      <p className="muted mt-2 text-sm">
        {t("report.reported", { age: formatAge(report.created_at, now, lang) })}
        {live && ` · ${t("report.expires", { time: formatClock(new Date(report.expires_at), lang) })}`}
      </p>
      <p className="muted text-sm">
        {t("report.confirmations", { n: report.confirmations })} · {t("report.resolutions", { n: report.resolutions })}
      </p>
      <p className="muted mt-1 text-xs">
        {mine ? t("report.yours") : report.source === "admin" ? t("report.official") : t("report.community")}
        {report.type === "police" && ` — ${t("report.policeNote")}`}
      </p>
      {live && (
        <div className="mt-3 flex gap-2">
          {!mine && (
            <button type="button" disabled={busy} onClick={() => vote("confirm")} className="bg-accent h-11 flex-1 rounded-xl font-bold text-white disabled:opacity-60">
              {t("report.stillThere")}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => vote("gone")} className="h-11 flex-1 rounded-xl border hairline font-bold disabled:opacity-60">
            {t("report.gone")}
          </button>
        </div>
      )}
      {!mine && (
        <button type="button" disabled={busy} onClick={() => vote("abuse")} className="muted mt-2 text-sm underline-offset-4 hover:underline">
          {t("report.abuse")}
        </button>
      )}
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
  const label = address ?? `${picked[1].toFixed(5)}, ${picked[0].toFixed(5)}`;
  return (
    <Floating label={t("map.pickedPoint")} onClose={() => setState({ pickedPoint: null })}>
      <h2 className="pe-10 text-lg font-bold">{t("map.pickedPoint")}</h2>
      <p className="muted text-sm">{address ?? t("common.loading")}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="bg-accent h-11 flex-1 rounded-xl font-bold text-white"
          onClick={() => { setState({ pickedPoint: null }); void computeRoutes({ label, lngLat: picked }); }}>
          {t("map.goHere")}
        </button>
        <button type="button" className="h-11 flex-1 rounded-xl border hairline font-bold"
          onClick={() => setState({ reportSheet: { at: picked, source: "picked" }, pickedPoint: null })}>
          {t("map.reportHere")}
        </button>
      </div>
    </Floating>
  );
}
