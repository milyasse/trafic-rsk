// Géolocalisation : uniquement au premier plan et après action de l'utilisateur
// (bouton « Me localiser », calcul d'itinéraire, navigation). Rien n'est envoyé au serveur.
import { getState, setState } from "../store";
import type { Key } from "../i18n";

let watchId: number | null = null;

function errorKey(err: GeolocationPositionError): Key {
  if (err.code === err.PERMISSION_DENIED) return "geo.denied";
  if (err.code === err.TIMEOUT) return "geo.timeout";
  return "geo.unavailable";
}

export function startWatch(): void {
  if (watchId !== null) return;
  if (!("geolocation" in navigator)) {
    setState({ geoError: "geo.unavailable" });
    return;
  }
  if (!window.isSecureContext) {
    setState({ geoError: "geo.insecure" });
    return;
  }
  setState({ watching: true });
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      setState({
        geoError: null,
        userPos: {
          lngLat: [p.coords.longitude, p.coords.latitude],
          accuracy: p.coords.accuracy,
          heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
          speed: p.coords.speed,
          ts: p.timestamp,
        },
      });
    },
    (err) => {
      setState({ geoError: errorKey(err) });
      if (err.code === err.PERMISSION_DENIED) stopWatch();
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 },
  );
}

export function stopWatch(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  setState({ watching: false });
}

/** Attend une première position (ou abandonne après `timeoutMs`). */
export function waitForPosition(timeoutMs = 10000): Promise<boolean> {
  if (getState().userPos) return Promise.resolve(true);
  startWatch();
  return new Promise((resolve) => {
    const started = Date.now();
    const iv = setInterval(() => {
      const s = getState();
      if (s.userPos) { clearInterval(iv); resolve(true); }
      else if (s.geoError === "geo.denied" || s.geoError === "geo.insecure" || Date.now() - started > timeoutMs) {
        clearInterval(iv);
        resolve(false);
      }
    }, 250);
  });
}
