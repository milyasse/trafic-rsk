import { useState } from "react";
import { formatClock, formatDistance, formatDuration } from "../lib/format";
import { REPORT_META } from "../lib/reports";
import type { AnnotatedRoute } from "../lib/routing";
import { saveFavorite } from "../services/data";
import { startNavigation } from "../services/navigation";
import { clearRoutes, computeRoutes, startPick } from "../services/routes";
import { setState, useStore, useT } from "../store";
import { SearchBox } from "./SearchBox";

function RouteRow({ route, selected, onSelect }: { route: AnnotatedRoute; selected: boolean; onSelect: () => void }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const now = useStore((s) => s.now);
  const eta = new Date(now + (route.duration + (route.measuredDelay ?? 0)) * 1000);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative w-full rounded-xl px-4 py-3 text-start transition-colors ${selected ? "bg-accent-soft" : "hover:bg-[var(--surface-2)]"}`}
    >
      {selected && <span className="bg-accent absolute inset-y-2 start-0 w-1.5 rounded-full" aria-hidden />}
      <div className="flex items-baseline justify-between gap-3">
        <span className="tabular text-2xl font-bold">{formatDuration(route.duration, lang)}</span>
        <span className="muted tabular text-sm">{formatDistance(route.distance, lang)} · {t("route.arrival", { time: formatClock(eta, lang) })}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {route.isRecommended && <span className="accent font-bold">{t("route.recommended")}</span>}
        {route.isFastest && !route.isRecommended && <span className="font-bold">{t("route.fastest")}</span>}
        {route.measuredDelay != null && route.measuredDelay > 30 && (
          <span className="font-bold text-[#C2410C]">{t("route.withTraffic", { d: formatDuration(route.duration + route.measuredDelay, lang) })}</span>
        )}
        <span className="muted">
          {route.has_tolls ? t("route.toll") : route.usesMotorway ? t("route.motorway") : t("route.noToll")}
        </span>
      </div>
      <div className="mt-1 text-sm">
        {route.incidents.length > 0 ? (
          <span className="text-[var(--color-alerte)]">
            {route.incidents.slice(0, 4).map((i) => REPORT_META[i.report.type].glyph).join(" ")}{" "}
            {t("route.incidents", { n: route.incidents.length })}
          </span>
        ) : (
          <span className="muted">{t("route.noIncidents")}</span>
        )}
      </div>
    </button>
  );
}

function SaveFavorite() {
  const t = useT();
  const destination = useStore((s) => s.destination);
  const profile = useStore((s) => s.profile);
  const session = useStore((s) => s.session);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"home" | "work" | "other">("other");
  const [label, setLabel] = useState(destination?.label ?? "");
  if (!destination || !profile || session?.user.is_anonymous) return null;
  if (!open) {
    return (
      <button type="button" className="accent text-sm font-bold underline-offset-4 hover:underline" onClick={() => { setLabel(destination.label.slice(0, 80)); setOpen(true); }}>
        {t("route.saveFavorite")}
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await saveFavorite(kind, label.trim() || destination.label, destination.label, destination.lngLat)) setOpen(false);
      }}
    >
      <label className="text-sm">
        <span className="muted block">{t("account.favoriteKind")}</span>
        <select className="surface h-10 rounded-lg border hairline px-2" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="home">{t("search.home")}</option>
          <option value="work">{t("search.work")}</option>
          <option value="other">{t("account.other")}</option>
        </select>
      </label>
      <label className="min-w-40 flex-1 text-sm">
        <span className="muted block">{t("account.favoriteLabel")}</span>
        <input className="surface h-10 w-full rounded-lg border hairline px-2" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <button type="submit" className="bg-accent h-10 rounded-lg px-4 font-bold text-white">{t("account.save")}</button>
    </form>
  );
}

export function RoutePanel() {
  const t = useT();
  const destination = useStore((s) => s.destination);
  const routes = useStore((s) => s.routes);
  const selectedRouteId = useStore((s) => s.selectedRouteId);
  const loading = useStore((s) => s.routeLoading);
  const error = useStore((s) => s.routeError);
  const response = useStore((s) => s.routeResponse);
  if (!destination) return null;

  return (
    <section aria-labelledby="route-title" className="flex flex-col gap-3">
      <div>
        <h2 id="route-title" className="text-lg font-bold leading-tight">{destination.label}</h2>
      </div>
      <div>
        <span className="muted mb-1 block text-sm">{t("route.from")}</span>
        <SearchBox target="origin" />
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold">
          <button type="button" className="accent underline-offset-4 hover:underline" onClick={() => startPick("origin")}>{t("pick.origin")}</button>
          <button type="button" className="accent underline-offset-4 hover:underline" onClick={() => startPick("destination")}>{t("pick.destination")}</button>
        </div>
      </div>

      {loading && <p className="muted py-4" aria-live="polite">{t("route.computing")}</p>}
      {error && (
        <div className="rounded-xl border border-[var(--color-alerte)]/40 p-3 text-sm" role="alert">
          <p>{t(error)}</p>
          <button type="button" className="accent mt-2 font-bold" onClick={() => void computeRoutes()}>{t("route.retry")}</button>
        </div>
      )}

      {routes.length > 0 && (
        <>
          <div className="flex flex-col gap-1" role="list">
            {routes.map((r) => (
              <RouteRow key={r.id} route={r} selected={r.id === selectedRouteId} onSelect={() => setState({ selectedRouteId: r.id })} />
            ))}
          </div>
          <p className="muted text-xs leading-snug">
            <strong>{t("route.durationNetwork")}.</strong> {response?.traffic_aware ? "" : t("route.durationNetworkHelp")}
          </p>
          <div className="flex gap-2">
            <button type="button" className="bg-accent h-12 flex-1 rounded-xl text-lg font-bold text-white" onClick={startNavigation}>
              {t("route.start")}
            </button>
            <button type="button" className="h-12 rounded-xl border hairline px-5 font-bold" onClick={clearRoutes}>
              {t("route.cancel")}
            </button>
          </div>
          <SaveFavorite />
          {response && <p className="muted text-[11px]">{response.attribution}</p>}
        </>
      )}
    </section>
  );
}
