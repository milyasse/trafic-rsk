import { BASEMAPS } from "../config";
import { availability } from "../lib/traffic";
import { formatAge } from "../lib/format";
import { savePreference } from "../services/data";
import { setState, useStore, useT, type ThemePref } from "../store";
import { IconClose } from "./Icons";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+72px)] z-[60] flex flex-col items-center gap-2 px-3 lg:top-4 lg:start-[420px] lg:items-start" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" || t.tone === "alert" ? "alert" : "status"}
          className={`pointer-events-auto max-w-md rounded-xl px-4 py-3 font-bold shadow-lg ${
            t.tone === "error" ? "bg-[var(--color-alerte)] text-white"
              : t.tone === "alert" ? "bg-[#F2B705] text-[#17212B]"
                : t.tone === "success" ? "bg-[#1E6B43] text-white" : "surface"
          }`}
        >
          {t.text}
          {t.action && <button type="button" className="ms-3 underline" onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

/** Pastille d'état : connexion temps réel + disponibilité du trafic. */
export function StatusPill() {
  const t = useT();
  const rt = useStore((s) => s.rtStatus);
  const lastSync = useStore((s) => s.lastSync);
  const now = useStore((s) => s.now);
  const lang = useStore((s) => s.lang);
  const status = useStore((s) => s.trafficStatus);
  const stale = useStore((s) => s.settings.staleAfterMinutes);
  const traffic = availability(status, now, stale);
  const dot = rt === "connected" ? "#2E9E5B" : rt === "offline" ? "#B3261E" : "#F08C1A";
  const rtLabel = rt === "connected" ? t("rt.connected") : rt === "offline" ? t("rt.offline") : rt === "reconnecting" ? t("rt.reconnecting") : t("rt.connecting");
  return (
    <div className="surface shadow-float inline-flex max-w-full items-center gap-2 rounded-full px-3.5 py-2 text-[14px] lg:shadow-none lg:border hairline" role="status">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />
      <span className="truncate">
        <strong>{rtLabel}</strong>
        {rt !== "connected" && lastSync && <span className="muted"> · {t("rt.lastSync", { age: formatAge(new Date(lastSync).toISOString(), now, lang) })}</span>}
        <span className="muted"> · {traffic === "unavailable" ? t("traffic.unavailable") : traffic === "stale" ? t("traffic.stale") : t("traffic.live")}</span>
      </span>
    </div>
  );
}

export function LayerMenu() {
  const t = useT();
  const open = useStore((s) => s.layerMenu);
  const basemap = useStore((s) => s.basemap);
  const theme = useStore((s) => s.themePref);
  const showTraffic = useStore((s) => s.showTraffic);
  const showReports = useStore((s) => s.showReports);
  if (!open) return null;
  const close = () => setState({ layerMenu: false });
  const maps = BASEMAPS;
  const themes: ThemePref[] = ["auto", "light", "dark"];
  return (
    <div className="fixed inset-0 z-50" onClick={close}>
      <div
        role="dialog"
        aria-label={t("map.layers")}
        className="surface absolute end-3 top-[calc(env(safe-area-inset-top)+128px)] w-72 rounded-2xl border hairline p-4 shadow-2xl lg:top-16"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">{t("map.layers")}</h2>
          <button type="button" onClick={close} aria-label={t("common.close")} className="muted grid h-9 w-9 place-items-center rounded-full"><IconClose size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {maps.map((m) => (
            <button key={m} type="button" aria-pressed={basemap === m} onClick={() => void savePreference("basemap", m)}
              className={`h-10 rounded-lg border-2 text-sm font-bold ${basemap === m ? "border-[var(--accent)] bg-accent-soft" : "hairline"}`}>
              {t(`map.layer.${m}`)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2 text-[15px]">
          <label className="flex items-center justify-between">{t("map.showTraffic")}
            <input type="checkbox" className="h-5 w-5" checked={showTraffic} onChange={(e) => setState({ showTraffic: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between">{t("map.showReports")}
            <input type="checkbox" className="h-5 w-5" checked={showReports} onChange={(e) => setState({ showReports: e.target.checked })} />
          </label>
        </div>
        <fieldset className="mt-3">
          <legend className="text-sm font-bold">{t("map.theme")}</legend>
          <div className="mt-1 flex rounded-xl border hairline p-1">
            {themes.map((th) => (
              <button key={th} type="button" aria-pressed={theme === th} onClick={() => void savePreference("themePref", th)}
                className={`h-9 flex-1 rounded-lg text-sm font-bold ${theme === th ? "bg-accent text-white" : ""}`}>
                {t(`map.theme.${th}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="muted mt-3 text-[11px]">© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles{basemap === "satellite" || basemap === "hybrid" ? " · Imagerie © Esri, Maxar, Earthstar Geographics" : ""}</p>
      </div>
    </div>
  );
}
