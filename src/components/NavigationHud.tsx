import { useState } from "react";
import { formatClock, formatDistance, formatDuration } from "../lib/format";
import { instructionText, maneuverIcon, roadName } from "../lib/instructions";
import { REPORT_META } from "../lib/reports";
import { officialAsReport } from "../lib/official";
import { acceptSuggestion, dismissSuggestion, formatDelta, setFollowing, stopNavigation } from "../services/navigation";
import { setState, useStore, useT } from "../store";
import { IconList, IconLocate, IconVolume, IncidentIcon } from "./Icons";
import { ManeuverArrow } from "./Icons";

export function NavigationHud() {
  const t = useT();
  const nav = useStore((s) => s.nav);
  const route = useStore((s) => s.routes.find((r) => r.id === s.selectedRouteId));
  const lang = useStore((s) => s.lang);
  const now = useStore((s) => s.now);
  const voice = useStore((s) => s.voice);
  const userPos = useStore((s) => s.userPos);
  const alertReport = useStore((s) => {
    const id = s.nav?.alertAhead?.reportId;
    if (!id) return undefined;
    if (id.startsWith("tt:")) {
      const o = s.officialIncidents[id.slice(3)];
      return o ? officialAsReport(o, s.now) : undefined;
    }
    return s.reports[id];
  });
  const trafficAware = useStore((s) => s.routeResponse?.traffic_aware ?? false);
  const [showSteps, setShowSteps] = useState(false);
  if (!nav || !route) return null;

  const step = route.steps[nav.stepIndex] ?? route.steps[route.steps.length - 1];
  const next = route.steps[nav.stepIndex + 1];
  const eta = new Date(now + nav.remainingDuration * 1000);
  const road = step ? roadName(step) : "";

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-30 lg:start-4 lg:end-auto lg:top-4 lg:w-[400px]" aria-live="polite">
        <div className="maneuver px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-4 lg:pt-4">
          {nav.arrived ? (
            <p className="text-2xl font-bold">{t("nav.arrived")}</p>
          ) : nav.rerouting ? (
            <p className="text-xl font-bold">{t("nav.rerouting")}</p>
          ) : step ? (
            <div className="flex items-center gap-4">
              <ManeuverArrow icon={maneuverIcon(step)} size={64} />
              <div className="min-w-0">
                <p className="maneuver__distance tabular">{formatDistance(nav.distanceToStep, lang)}</p>
                <p className="maneuver__road truncate">{road || instructionText(step, lang)}</p>
                {road && <p className="truncate text-sm opacity-85">{instructionText(step, lang)}</p>}
              </div>
            </div>
          ) : null}
          {next && !nav.arrived && !nav.rerouting && (
            <p className="mt-2 flex items-center gap-2 border-t border-white/25 pt-2 text-sm">
              <span className="opacity-80">{t("nav.then")}</span>
              <ManeuverArrow icon={maneuverIcon(next)} size={20} />
              <span className="truncate">{instructionText(next, lang)}</span>
            </p>
          )}
        </div>

        {nav.offRoute && !nav.rerouting && (
          <p className="mx-3 mt-2 rounded-xl bg-[#F2B705] px-3 py-2 font-bold text-[#17212B]">{t("nav.offRoute")}</p>
        )}
        {userPos && userPos.accuracy > 80 && (
          <p className="surface mx-3 mt-2 rounded-xl px-3 py-2 text-sm">{t("nav.gpsWeak")} · {t("geo.accuracy", { m: formatDistance(userPos.accuracy, lang) })}</p>
        )}
        {alertReport && nav.alertAhead && (
          <div className="surface shadow-float mx-4 mt-3 flex items-center gap-3 rounded-[14px] border-s-[5px] px-3.5 py-2.5" style={{ borderColor: REPORT_META[alertReport.type].color }} role="alert">
            <IncidentIcon type={alertReport.type} size={26} />
            <span className="font-bold">
              {t("nav.alertAhead", { type: t(`report.type.${alertReport.type}`), d: formatDistance(nav.alertAhead.distance, lang) })}
            </span>
          </div>
        )}
        {nav.suggestion && (
          <div className="surface mx-3 mt-2 rounded-xl p-3 shadow-lg" role="alert">
            <p className="font-bold">{t("nav.betterRoute", { n: nav.suggestion.avoided })}</p>
            <p className="muted text-sm">{t("nav.betterRouteDelta", { delta: formatDelta(nav.suggestion.deltaSeconds) })}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="bg-accent h-10 flex-1 rounded-lg font-bold text-white" onClick={acceptSuggestion}>{t("nav.take")}</button>
              <button type="button" className="h-10 flex-1 rounded-lg border hairline font-bold" onClick={dismissSuggestion}>{t("nav.keep")}</button>
            </div>
          </div>
        )}
      </div>

      {/* Limitation de vitesse (TomTom) et vitesse actuelle */}
      {!nav.arrived && (nav.speedLimit != null || (userPos?.speed != null && userPos.speed > 0.5)) && (
        <div className="fixed start-3 bottom-[calc(env(safe-area-inset-bottom)+108px)] z-30 flex items-end gap-2 lg:start-[424px] lg:bottom-8" aria-live="off">
          {nav.speedLimit != null && (
            <div className="grid h-[58px] w-[58px] place-items-center rounded-full border-[6px] border-[#D7262E] bg-white text-[22px] font-extrabold text-[#14202B] shadow-float"
              role="img" aria-label={t("nav.speedLimit", { v: nav.speedLimit })}>
              {nav.speedLimit}
            </div>
          )}
          {userPos?.speed != null && userPos.speed > 0.5 && (() => {
            const kmh = Math.round(userPos.speed * 3.6);
            const over = nav.speedLimit != null && kmh > nav.speedLimit + 3;
            return (
              <div className={`surface shadow-float grid h-[50px] min-w-[50px] place-items-center rounded-2xl px-2 leading-none ${over ? "!bg-[#D7262E] text-white" : ""}`}
                aria-label={t("nav.currentSpeed", { v: kmh })}>
                <span className="tabular text-[20px] font-extrabold">{kmh}</span>
                <span className="text-[10px] font-bold opacity-80">km/h</span>
              </div>
            );
          })()}
        </div>
      )}

      {!nav.following && (
        <button type="button" onClick={() => setFollowing(true)} className="map-btn fixed end-4 bottom-32 z-30 !w-auto gap-2 px-4 font-bold lg:bottom-28">
          <span className="flex items-center gap-2"><IconLocate size={20} /> {t("map.recenter")}</span>
        </button>
      )}

      <div className="surface fixed inset-x-0 bottom-0 z-30 border-t hairline px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] lg:start-4 lg:end-auto lg:bottom-4 lg:w-[400px] lg:rounded-2xl lg:border">
        {showSteps && (
          <ol className="mb-3 max-h-[40vh] overflow-auto border-b hairline pb-2" aria-label={t("nav.steps")}>
            {route.steps.slice(nav.stepIndex).map((s, i) => (
              <li key={i} className="flex items-center gap-3 py-1.5">
                <span className="accent shrink-0"><ManeuverArrow icon={maneuverIcon(s)} size={24} /></span>
                <span className="min-w-0 flex-1 truncate">{instructionText(s, lang)}</span>
                <span className="muted tabular text-sm">{formatDistance(s.distance, lang)}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="tabular text-[28px] font-bold leading-8">{t("nav.eta", { time: formatClock(eta, lang) })}</p>
            <p className="muted tabular mt-1 text-sm">
              {formatDuration(nav.remainingDuration, lang)} · {t("nav.remaining", { d: formatDistance(nav.remainingDistance, lang) })}
            </p>
          </div>
          <button type="button" aria-pressed={showSteps} aria-label={t("nav.steps")} onClick={() => setShowSteps((v) => !v)} className="grid h-12 w-12 place-items-center rounded-full border hairline">
            <IconList />
          </button>
          <button type="button" aria-label={voice ? t("nav.voiceOn") : t("nav.voiceOff")} aria-pressed={voice} onClick={() => setState({ voice: !voice })} className="grid h-12 w-12 place-items-center rounded-full border hairline">
            <IconVolume off={!voice} />
          </button>
          <button type="button" onClick={stopNavigation} className="btn btn-danger">
            {t("nav.stop")}
          </button>
        </div>
        <p className="muted mt-1 text-[11px]">
          {trafficAware ? t("route.durationLive") : `${t("route.durationNetwork")}${route.measuredDelay != null ? "" : ` — ${t("route.durationNetworkHelp")}`}`}
        </p>
      </div>
    </>
  );
}
