// Calcul, annotation et rafraîchissement des itinéraires proposés.
import { FUNCTIONS_URL, SUPABASE_KEY } from "../config";
import { COVERAGE, inBBox, type LngLat } from "../lib/geo";
import { formatCoords, nearestPoi, reverseGeocode, type NearbyPoi } from "../lib/geocode";
import { annotateRoutes, fetchRoutes, orderRoutes, RouteError, type AnnotatedRoute, type ProviderRoute } from "../lib/routing";
import { getState, setState, subscribe, toast, tr, type Place } from "../store";
import { waitForPosition } from "./geolocation";

let controller: AbortController | null = null;

export function annotate(routes: ProviderRoute[]): AnnotatedRoute[] {
  const s = getState();
  return orderRoutes(annotateRoutes(routes, Object.values(s.reports), s.trafficSegments, Date.now(), s.settings.staleAfterMinutes));
}

export async function requestRoutes(from: LngLat, to: LngLat, signal?: AbortSignal) {
  const res = await fetchRoutes(FUNCTIONS_URL, SUPABASE_KEY, [from, to], signal);
  return { response: res, routes: annotate(res.routes) };
}

export async function computeRoutes(destination?: Place): Promise<void> {
  if (destination) setState({ destination });
  const s = getState();
  const dest = s.destination;
  if (!dest) return;
  controller?.abort();
  controller = new AbortController();
  setState({ routeLoading: true, routeError: null, routes: [], selectedRouteId: null, panel: "search", sheet: "half" });

  let from = s.origin?.lngLat ?? s.userPos?.lngLat ?? null;
  if (!from) {
    const ok = await waitForPosition(10000);
    from = getState().userPos?.lngLat ?? null;
    if (!ok || !from) {
      setState({ routeLoading: false, routeError: "route.needPosition" });
      return;
    }
  }
  try {
    const { response, routes } = await requestRoutes(from, dest.lngLat, controller.signal);
    const rec = routes.find((r) => r.isRecommended) ?? routes[0];
    setState({ routeResponse: response, routes, selectedRouteId: rec?.id ?? null, routeLoading: false });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    setState({
      routeLoading: false,
      routeError: e instanceof RouteError && e.code === "rate_limited" ? "route.rateLimited" : "route.error",
    });
  }
}

export function clearRoutes(): void {
  controller?.abort();
  setState({ destination: null, origin: null, routes: [], routeResponse: null, selectedRouteId: null, routeError: null, routeLoading: false });
}

/** Ré-annoter les itinéraires affichés quand les incidents ou le trafic changent (hors navigation). */
let lastReports = getState().reports;
let lastSegments = getState().trafficSegments;
let timer: ReturnType<typeof setTimeout> | null = null;
subscribe(() => {
  const s = getState();
  if (s.reports === lastReports && s.trafficSegments === lastSegments) return;
  lastReports = s.reports;
  lastSegments = s.trafficSegments;
  if (!s.routes.length || timer) return;
  timer = setTimeout(() => {
    timer = null;
    const cur = getState();
    if (!cur.routes.length) return;
    const selected = cur.selectedRouteId;
    const routes = annotate(cur.routes);
    setState({ routes, selectedRouteId: routes.some((r) => r.id === selected) ? selected : routes[0]?.id ?? null });
  }, 1500);
});

/** Démarre le mode « choisir sur la carte ». */
export function startPick(target: "destination" | "origin"): void {
  setState({ pickMode: target, pickedPoint: null, selectedReportId: null, sheet: "peek" });
}

export function cancelPick(): void {
  setState({ pickMode: null });
}

/**
 * Point touché sur la carte en mode sélection. On garde la coordonnée exacte (X,Y) et on propose
 * en plus le lieu nommé (POI) le plus proche : celui affiché sur la carte s'il y en a un, sinon Photon.
 */
export async function applyPick(p: LngLat, renderedPoi: NearbyPoi | null = null): Promise<void> {
  const target = getState().pickMode;
  if (!target) return;
  if (!inBBox(p, COVERAGE)) {
    toast(tr("map.outOfCoverage"), "info");
    return;
  }
  setState({ pickMode: null, pickChoice: { target, point: p, address: null, poi: renderedPoi, loading: true } });
  const lang = getState().lang;
  const [address, poi] = await Promise.all([
    reverseGeocode(p, lang),
    renderedPoi ? Promise.resolve(renderedPoi) : nearestPoi(p, lang),
  ]);
  const cur = getState().pickChoice;
  if (!cur || cur.point !== p) return; // un autre point a été choisi entre-temps
  setState({ pickChoice: { ...cur, address, poi, loading: false } });
}

/** Valide le choix : « exact » = coordonnées touchées, « poi » = position du lieu le plus proche. */
export async function commitPick(choice: "exact" | "poi"): Promise<void> {
  const c = getState().pickChoice;
  if (!c) return;
  const place: Place = choice === "poi" && c.poi
    ? { label: c.poi.name, lngLat: c.poi.lngLat }
    : { label: c.address ? `${formatCoords(c.point)} — ${c.address}` : formatCoords(c.point), lngLat: c.point };
  setState({ pickChoice: null });
  if (c.target === "origin") {
    setState({ origin: place });
    if (getState().destination) await computeRoutes();
    else setState({ panel: "search", sheet: "half" });
  } else {
    await computeRoutes(place);
  }
}

export function cancelPickChoice(): void {
  setState({ pickChoice: null });
}
