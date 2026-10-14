// Navigation GPS : suivi de position, étapes, recalcul hors trajet, alertes, itinéraire alternatif.
import { formatDistance, formatDuration } from "../lib/format";
import type { LngLat } from "../lib/geo";
import { instructionText, spokenInstruction } from "../lib/instructions";
import { ARRIVAL_DISTANCE, announceDistances, offRouteThreshold, prepare, progress, type Prepared } from "../lib/navigation";
import { REPORT_META } from "../lib/reports";
import { incidentsOnLine, speedLimitAt, type AnnotatedRoute } from "../lib/routing";
import { getState, setState, subscribe, toast, tr } from "../store";
import { addHistory } from "./data";
import { startWatch } from "./geolocation";
import { requestRoutes, routeHazards } from "./routes";
import { keepScreenOn, silence, speak } from "./voice";

let prep: Prepared | null = null;
let lastAlong = 0;
let offCount = 0;
let lastReroute = 0;
let lastSuggestionCheck = 0;
let spoken = new Set<string>();
let unsub: (() => void) | null = null;
let lastPosTs = 0;

function currentRoute(): AnnotatedRoute | undefined {
  const s = getState();
  return s.routes.find((r) => r.id === s.selectedRouteId);
}

export function startNavigation(): void {
  const s = getState();
  const route = currentRoute();
  if (!route || !s.destination) return;
  prep = prepare(route);
  lastAlong = 0;
  offCount = 0;
  spoken = new Set();
  lastSuggestionCheck = Date.now();
  setState({
    nav: {
      routeId: route.id, stepIndex: 0, distanceToStep: route.steps[0]?.distance ?? 0,
      remainingDistance: route.distance, remainingDuration: route.duration,
      offRoute: false, rerouting: false, arrived: false, following: true, alertAhead: null, suggestion: null,
      speedLimit: speedLimitAt(route, 0),
    },
    sheet: "peek",
    selectedReportId: null,
    selectedOfficialId: null,
  });
  startWatch();
  void keepScreenOn(true);
  void addHistory(s.destination.label, s.destination.lngLat);
  const first = route.steps[1] ?? route.steps[0];
  if (first) speak(instructionText(first, s.lang));
  unsub?.();
  unsub = subscribe(onStoreChange);
}

export function stopNavigation(): void {
  unsub?.();
  unsub = null;
  prep = null;
  silence();
  void keepScreenOn(false);
  setState({ nav: null });
}

function onStoreChange() {
  const s = getState();
  if (!s.nav || !s.userPos || s.userPos.ts === lastPosTs) return;
  lastPosTs = s.userPos.ts;
  onPosition(s.userPos.lngLat, s.userPos.accuracy, s.userPos.speed);
}

function onPosition(pos: LngLat, accuracy: number, speed: number | null) {
  const s = getState();
  const nav = s.nav;
  const route = currentRoute();
  if (!nav || !route || !prep || nav.arrived) return;
  if (prep.routeId !== route.id) {
    prep = prepare(route);
    lastAlong = 0;
  }

  const p = progress(prep, route.duration + (route.measuredDelay ?? 0), pos, lastAlong);

  // Sortie de trajet → recalcul (après 3 positions consécutives hors tracé)
  const off = p.offset > offRouteThreshold(accuracy);
  offCount = off ? offCount + 1 : 0;
  if (offCount >= 3 && !nav.rerouting && Date.now() - lastReroute > 15000) {
    void reroute(pos);
    return;
  }
  if (!off) lastAlong = p.along;

  // Arrivée
  if (p.remaining <= ARRIVAL_DISTANCE) {
    speak(tr("nav.arrived"));
    setState({ nav: { ...nav, arrived: true, remainingDistance: 0, remainingDuration: 0, distanceToStep: 0 } });
    setTimeout(() => { if (getState().nav?.arrived) stopNavigation(); }, 12000);
    return;
  }

  // Annonces vocales
  const step = route.steps[p.stepIndex];
  if (step) {
    const { far, near } = announceDistances(speed);
    const keyFar = `${route.id}:${p.stepIndex}:far`;
    const keyNear = `${route.id}:${p.stepIndex}:near`;
    if (p.distanceToStep <= near && !spoken.has(keyNear)) {
      spoken.add(keyNear).add(keyFar);
      speak(instructionText(step, s.lang));
    } else if (p.distanceToStep <= far && p.distanceToStep > near * 1.5 && !spoken.has(keyFar)) {
      spoken.add(keyFar);
      speak(spokenInstruction(step, formatDistance(p.distanceToStep, s.lang), s.lang));
    }
  }

  // Incident signalé devant soi
  const ahead = incidentsOnLine(prep.line, prep.cumulative, routeHazards(), Date.now())
    .filter((i) => i.along > p.along && i.along - p.along <= Math.max(2000, s.alertRadius));
  const next = ahead[0];
  const alertAhead = next ? { reportId: next.report.id, distance: next.along - p.along } : null;
  if (next && alertAhead && alertAhead.distance < 800 && !spoken.has(`r:${next.report.id}`)) {
    spoken.add(`r:${next.report.id}`);
    speak(tr("nav.alertAhead", { type: tr(`report.type.${next.report.type}`), d: formatDistance(alertAhead.distance, s.lang) }));
  }

  setState({
    nav: {
      ...nav, stepIndex: p.stepIndex, distanceToStep: p.distanceToStep,
      remainingDistance: p.remaining, remainingDuration: p.remainingDuration,
      offRoute: off, alertAhead, speedLimit: speedLimitAt(route, p.along),
    },
  });

  // Itinéraire alternatif si un incident gênant est signalé devant
  const blocking = ahead.filter((i) => REPORT_META[i.report.type].routeImpact >= 5);
  if (blocking.length && !nav.suggestion && Date.now() - lastSuggestionCheck > 120_000) {
    lastSuggestionCheck = Date.now();
    void checkAlternative(pos, p.remainingDuration, blocking.length);
  }
}

async function reroute(pos: LngLat) {
  const s = getState();
  if (!s.nav || !s.destination) return;
  lastReroute = Date.now();
  offCount = 0;
  setState({ nav: { ...s.nav, rerouting: true } });
  speak(tr("nav.rerouting"));
  try {
    const { response, routes } = await requestRoutes(pos, s.destination.lngLat);
    const best = routes.find((r) => r.isRecommended) ?? routes[0];
    if (!best) throw new Error("no_route");
    prep = prepare(best);
    lastAlong = 0;
    spoken = new Set();
    const cur = getState();
    if (!cur.nav) return;
    setState({
      routeResponse: response, routes, selectedRouteId: best.id,
      nav: { ...cur.nav, routeId: best.id, rerouting: false, offRoute: false, suggestion: null },
    });
    const first = best.steps[1] ?? best.steps[0];
    if (first) speak(instructionText(first, cur.lang));
  } catch {
    const cur = getState();
    if (cur.nav) setState({ nav: { ...cur.nav, rerouting: false } });
    toast(tr("route.error"), "error");
  }
}

async function checkAlternative(pos: LngLat, currentRemaining: number, blockingAhead: number) {
  const s = getState();
  if (!s.destination) return;
  try {
    const { routes } = await requestRoutes(pos, s.destination.lngLat);
    const current = currentRoute();
    if (!current) return;
    const currentPenalty = current.incidentPenalty;
    const candidates = routes.filter((r) =>
      r.incidents.filter((i) => REPORT_META[i.report.type].routeImpact >= 5).length < blockingAhead);
    const best = candidates.sort((a, b) => a.duration + a.incidentPenalty - (b.duration + b.incidentPenalty))[0];
    if (!best) return;
    const delta = best.duration - currentRemaining;
    if (best.duration + best.incidentPenalty < currentRemaining + currentPenalty - 60) {
      const cur = getState();
      if (!cur.nav) return;
      const avoided = blockingAhead - best.incidents.filter((i) => REPORT_META[i.report.type].routeImpact >= 5).length;
      setState({ nav: { ...cur.nav, suggestion: { route: best, avoided, deltaSeconds: delta } } });
      speak(tr("nav.betterRoute", { n: avoided }));
    }
  } catch { /* pas d'alternative pour l'instant */ }
}

export function acceptSuggestion(): void {
  const s = getState();
  const sug = s.nav?.suggestion;
  if (!s.nav || !sug) return;
  const routes = [sug.route, ...s.routes.filter((r) => r.id !== sug.route.id)];
  prep = prepare(sug.route);
  lastAlong = 0;
  spoken = new Set();
  setState({ routes, selectedRouteId: sug.route.id, nav: { ...s.nav, routeId: sug.route.id, suggestion: null } });
  const first = sug.route.steps[1] ?? sug.route.steps[0];
  if (first) speak(instructionText(first, s.lang));
}

export function dismissSuggestion(): void {
  const s = getState();
  if (s.nav) setState({ nav: { ...s.nav, suggestion: null } });
}

export function setFollowing(following: boolean): void {
  const s = getState();
  if (s.nav && s.nav.following !== following) setState({ nav: { ...s.nav, following } });
}

export function formatDelta(seconds: number): string {
  const lang = getState().lang;
  const sign = seconds >= 0 ? "+" : "−";
  return `${sign}${formatDuration(Math.abs(seconds), lang)}`;
}
