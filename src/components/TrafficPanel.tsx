import { formatAge, formatDuration } from "../lib/format";
import { availability, displayLevel, segmentDelay, TRAFFIC_COLORS, TRAFFIC_LEVELS } from "../lib/traffic";
import { focusMap, useStore, useT } from "../store";

export function TrafficLegend() {
  const t = useT();
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label={t("traffic.title")}>
      {TRAFFIC_LEVELS.map((l) => (
        <li key={l} className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-5 rounded-full" style={{ background: TRAFFIC_COLORS[l] }} aria-hidden />
          {t(`traffic.level.${l}`)}
        </li>
      ))}
    </ul>
  );
}

export function TrafficPanel() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const status = useStore((s) => s.trafficStatus);
  const segments = useStore((s) => s.trafficSegments);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const state = availability(status, now, settings.staleAfterMinutes);
  const congested = segments
    .map((s) => ({ s, level: displayLevel(s, now, settings.staleAfterMinutes) }))
    .filter((x) => x.level === "heavy" || x.level === "jam" || x.level === "slow")
    .sort((a, b) => segmentDelay(b.s) - segmentDelay(a.s));
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Africa/Casablanca" }).format(now));
  const [from, to] = settings.traffic.active_hours;
  const outsideHours = hour < from || hour >= to;

  return (
    <section aria-labelledby="traffic-title" className="flex flex-col gap-2">
      <h2 id="traffic-title" className="text-lg font-bold">{t("traffic.title")}</h2>

      {state === "unavailable" && (
        <div className="surface-2 rounded-xl p-3" role="status">
          <p className="font-bold">{t("traffic.unavailable")}</p>
          <p className="muted text-sm">{t("traffic.unavailableHelp")}</p>
        </div>
      )}
      {state === "stale" && (
        <div className="surface-2 rounded-xl p-3" role="status">
          <p className="font-bold">{t("traffic.stale")}</p>
          <p className="muted text-sm">{t("traffic.staleHelp", { age: formatAge(status?.last_success_at, now, lang) })}</p>
          {outsideHours && <p className="muted text-sm">{t("traffic.outsideHours", { from, to })}</p>}
        </div>
      )}
      {state === "live" && (
        <p className="text-sm">
          <strong>{t("traffic.live")}</strong>{" "}
          <span className="muted">
            {t("traffic.updated", { age: formatAge(status?.last_success_at, now, lang) })} · {t("traffic.source", { provider: status?.provider ?? "—" })}
          </span>
        </p>
      )}

      <TrafficLegend />

      {state !== "unavailable" && (
        <div className="mt-1">
          <h3 className="text-sm font-bold">{t("traffic.congested")}</h3>
          {congested.length === 0 ? (
            <p className="muted text-sm">{t("traffic.noneCongested")}</p>
          ) : (
            <ul className="mt-1 flex flex-col">
              {congested.slice(0, 6).map(({ s, level }) => (
                <li key={s.point_id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start hover:bg-[var(--surface-2)]"
                    onClick={() => focusMap(s.geometry.coordinates[Math.floor(s.geometry.coordinates.length / 2)], 14)}
                  >
                    <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: TRAFFIC_COLORS[level] }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{s.name}</span>
                      <span className="muted block text-sm">
                        {t(`traffic.level.${level}`)}
                        {s.current_speed != null && s.free_flow_speed != null && ` · ${t("traffic.speed", { v: Math.round(s.current_speed), f: Math.round(s.free_flow_speed) })}`}
                      </span>
                    </span>
                    {segmentDelay(s) > 30 && <span className="tabular text-sm font-bold">{t("traffic.delay", { d: formatDuration(segmentDelay(s), lang) })}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
