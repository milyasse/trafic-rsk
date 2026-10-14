import { formatClock, formatDistance, formatDuration } from "../lib/format";
import type { AnnotatedRoute } from "../lib/routing";
import { startNavigation } from "../services/navigation";
import { clearRoutes, computeRoutes, startPick } from "../services/routes";
import { setState, useStore, useT, type Favorite } from "../store";
import { haversine } from "../lib/geo";
import { FavoriteStar } from "./Favorites";
import { SearchBox } from "./SearchBox";
import { IconBriefcase, IconHome, IconStar, IncidentIcon } from "./Icons";

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
      className={`w-full rounded-2xl px-[18px] py-3.5 text-start transition-colors ${selected ? "bg-accent-soft border-2 border-[var(--accent)]" : "surface border hairline hover:bg-[var(--surface-2)]"}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="tabular text-[28px] leading-8 font-bold">{formatDuration(route.duration, lang)}</span>
        <span className="muted tabular text-sm">{formatDistance(route.distance, lang)} · {t("route.arrival", { time: formatClock(eta, lang) })}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {route.isRecommended && <span className="accent font-bold">{t("route.recommended")}</span>}
        {route.isFastest && !route.isRecommended && <span className="font-bold">{t("route.fastest")}</span>}
        {route.traffic_delay != null && (route.traffic_delay >= 60 ? (
          <span className="font-bold text-[#C2410C]">{t("route.trafficDelay", { d: formatDuration(route.traffic_delay, lang) })}</span>
        ) : (
          <span className="font-bold text-[#2E7D4F]">{t("route.trafficFree")}</span>
        ))}
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
            {route.incidents.slice(0, 4).map((i) => <span key={i.report.id} className="me-0.5 inline-block align-middle"><IncidentIcon type={i.report.type} size={16} /></span>)}{" "}
            {t("route.incidents", { n: route.incidents.length })}
          </span>
        ) : (
          <span className="muted">{t("route.noIncidents")}</span>
        )}
      </div>
    </button>
  );
}

/** Départ en un toucher : ma position ou un de mes favoris. */
function OriginFavorites() {
  const t = useT();
  const favorites = useStore((s) => s.favorites);
  const origin = useStore((s) => s.origin);
  const destination = useStore((s) => s.destination);
  const list = favorites.filter((f) => !destination || haversine([f.lng, f.lat], destination.lngLat) > 30);
  if (!list.length) return null;
  const isOrigin = (f: Favorite) => origin != null && haversine([f.lng, f.lat], origin.lngLat) < 30;
  return (
    <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1" aria-label={t("favorites.title")}>
      <button type="button" className={`chip shrink-0 border-2 ${origin == null ? "border-[var(--accent)]" : "border-transparent"}`}
        aria-pressed={origin == null} onClick={() => { setState({ origin: null }); void computeRoutes(); }}>
        {t("route.myPosition")}
      </button>
      {list.map((f) => (
        <button key={f.id} type="button" aria-pressed={isOrigin(f)}
          className={`chip shrink-0 border-2 ${isOrigin(f) ? "border-[var(--accent)]" : "border-transparent"}`}
          onClick={() => { setState({ origin: { label: f.label, lngLat: [f.lng, f.lat] } }); void computeRoutes(); }}>
          {f.kind === "home" ? <IconHome size={16} /> : f.kind === "work" ? <IconBriefcase size={16} /> : <IconStar size={16} />}
          <span className="max-w-[140px] truncate">{f.label}</span>
        </button>
      ))}
    </div>
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
      <div className="flex items-start gap-2">
        <h2 id="route-title" className="min-w-0 flex-1 text-lg font-bold leading-tight">{destination.label}</h2>
        <FavoriteStar className="shrink-0" label={destination.label.split(",")[0].slice(0, 80)} address={destination.label} lngLat={destination.lngLat} />
      </div>
      <div>
        <span className="muted mb-1 block text-sm">{t("route.from")}</span>
        <SearchBox target="origin" />
        <OriginFavorites />
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
          <div className="flex flex-col gap-2.5" role="list">
            {routes.map((r) => (
              <RouteRow key={r.id} route={r} selected={r.id === selectedRouteId} onSelect={() => setState({ selectedRouteId: r.id })} />
            ))}
          </div>
          <p className="muted text-xs leading-snug">
            {response?.traffic_aware
              ? <strong>{t("route.durationLive")}</strong>
              : <><strong>{t("route.durationNetwork")}.</strong> {t("route.durationNetworkHelp")}</>}
          </p>
          {response && <p className="muted text-[11px]">{response.attribution}</p>}
          {/* Actions toujours visibles en bas du panneau, quelle que soit sa hauteur */}
          <div className="surface sticky bottom-0 z-10 -mx-4 -mb-6 flex gap-2 border-t hairline px-4 pt-3 pb-4">
            <button type="button" className="btn btn-primary flex-1" onClick={startNavigation}>
              {t("route.start")}
            </button>
            <button type="button" className="btn btn-secondary" onClick={clearRoutes}>
              {t("route.cancel")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
