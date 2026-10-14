import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap, type MapGeoJSONFeature, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Point } from "geojson";
import { INITIAL_VIEW, MAX_BOUNDS, type Basemap } from "../config";
import { initialStyle, resolveStyle } from "../lib/basemaps";
import { COVERAGE, inBBox, lineBBox, type LngLat } from "../lib/geo";
import { isLive, REPORT_TYPES, type Report } from "../lib/reports";
import { INCIDENT_ICONS } from "../lib/icons";
import { displayLevel, TRAFFIC_COLORS } from "../lib/traffic";
import { setFollowing } from "../services/navigation";
import { applyPick } from "../services/routes";
import { pickNearestPoi, type NearbyPoi } from "../lib/geocode";
import { getState, setState, toast, tr, useStore } from "../store";

const ROUTE_BLUE = "#1D5FA6";
const ROUTE_CASING = "#0B3563";
const ROUTE_ALT = "#8FAED3";

type FC = FeatureCollection;
const emptyFC = (): FC => ({ type: "FeatureCollection", features: [] });

function drawReportIcon(type: (typeof REPORT_TYPES)[number]): ImageData {
  const size = 72;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const icon = INCIDENT_ICONS[type];
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = icon.color;
  ctx.stroke();
  // Pictogramme vectoriel (repère 24×24) centré, ~38 px
  const scale = 38 / 24;
  ctx.save();
  ctx.translate(size / 2 - 12 * scale, size / 2 - 12 * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = icon.color;
  ctx.fillStyle = icon.color;
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of icon.strokes) ctx.stroke(new Path2D(d));
  for (const d of icon.fills ?? []) ctx.fill(new Path2D(d));
  ctx.restore();
  return ctx.getImageData(0, 0, size, size);
}

function firstSymbolLayer(map: MLMap): string | undefined {
  return map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
}

function setupLayers(map: MLMap) {
  for (const t of REPORT_TYPES) {
    const id = `rep-${t}`;
    if (!map.hasImage(id)) map.addImage(id, drawReportIcon(t), { pixelRatio: 2 });
  }
  const before = firstSymbolLayer(map);
  if (!map.getSource("traffic")) map.addSource("traffic", { type: "geojson", data: emptyFC() });
  if (!map.getSource("routes")) map.addSource("routes", { type: "geojson", data: emptyFC() });
  if (!map.getSource("accuracy")) map.addSource("accuracy", { type: "geojson", data: emptyFC() });
  if (!map.getSource("reports")) {
    map.addSource("reports", { type: "geojson", data: emptyFC(), cluster: true, clusterMaxZoom: 12, clusterRadius: 42 });
  }

  if (!map.getLayer("traffic-casing")) {
    map.addLayer({
      id: "traffic-casing", type: "line", source: "traffic",
      layout: { "line-cap": "round", "line-join": "round", visibility: getState().showTraffic ? "visible" : "none" },
      paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 4, 15, 11], "line-opacity": 0.85 },
    }, before);
    map.addLayer({
      id: "traffic-line", type: "line", source: "traffic",
      layout: { "line-cap": "round", "line-join": "round", visibility: getState().showTraffic ? "visible" : "none" },
      paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 15, 7] },
    }, before);
  }
  if (!map.getLayer("route-alt")) {
    map.addLayer({
      id: "route-alt", type: "line", source: "routes", filter: ["!=", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ROUTE_ALT, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 4, 16, 9], "line-opacity": 0.9 },
    }, before);
    map.addLayer({
      id: "route-casing", type: "line", source: "routes", filter: ["==", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ROUTE_CASING, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 7, 16, 14] },
    }, before);
    map.addLayer({
      id: "route-main", type: "line", source: "routes", filter: ["==", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ROUTE_BLUE, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 4.5, 16, 10] },
    }, before);
  }
  if (!map.getLayer("accuracy")) {
    map.addLayer({
      id: "accuracy", type: "fill", source: "accuracy",
      paint: { "fill-color": ROUTE_BLUE, "fill-opacity": 0.12 },
    });
  }
  if (!map.getLayer("report-clusters")) {
    const vis = getState().showReports ? "visible" : "none";
    map.addLayer({
      id: "report-clusters", type: "circle", source: "reports", filter: ["has", "point_count"],
      layout: { visibility: vis },
      paint: {
        "circle-color": "#ffffff", "circle-stroke-color": "#B91C1C", "circle-stroke-width": 3,
        "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 30, 24],
      },
    });
    map.addLayer({
      id: "report-cluster-count", type: "symbol", source: "reports", filter: ["has", "point_count"],
      layout: {
        visibility: vis, "text-field": ["get", "point_count_abbreviated"], "text-size": 13,
        "text-font": ["Noto Sans Bold"], "text-allow-overlap": true,
      },
      paint: { "text-color": "#7F1D1D" },
    });
    map.addLayer({
      id: "report-points", type: "symbol", source: "reports", filter: ["!", ["has", "point_count"]],
      layout: {
        visibility: vis,
        "icon-image": ["concat", "rep-", ["get", "type"]],
        "icon-size": ["match", ["get", "severity"], 3, 1.15, 2, 1, 0.85],
        "icon-allow-overlap": true, "icon-ignore-placement": true,
      },
    });
  }
}

/** POI nommé affiché sur la carte le plus proche du point touché (couche « poi » OpenMapTiles). */
function renderedPoiNear(map: MLMap, px: { x: number; y: number }, p: LngLat): NearbyPoi | null {
  const r = 48;
  let features: MapGeoJSONFeature[] = [];
  try {
    features = map.queryRenderedFeatures([[px.x - r, px.y - r], [px.x + r, px.y + r]]);
  } catch {
    return null;
  }
  const candidates = features
    .filter((f) => f.layer.type === "symbol" && f.sourceLayer === "poi" && f.geometry.type === "Point")
    .map((f) => ({
      name: (f.properties?.["name:fr"] ?? f.properties?.name ?? f.properties?.["name:latin"]) as string | undefined,
      lngLat: (f.geometry as Point).coordinates as LngLat,
      kind: String(f.properties?.subclass ?? f.properties?.class ?? "poi"),
    }));
  return pickNearestPoi(p, candidates, 250);
}

function circlePolygon(center: LngLat, radiusM: number): Feature {
  const pts: LngLat[] = [];
  const latR = radiusM / 111_320;
  const lngR = radiusM / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    pts.push([center[0] + lngR * Math.cos(a), center[1] + latR * Math.sin(a)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } };
}

function makeEl(className: string, html = ""): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  el.innerHTML = html;
  return el;
}

export function MapView({ dark }: { dark: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const userMarker = useRef<maplibregl.Marker | null>(null);
  const destMarker = useRef<maplibregl.Marker | null>(null);
  const pickedMarker = useRef<maplibregl.Marker | null>(null);
  const lastFitKey = useRef("");
  /** Fond réellement appliqué (évite un rechargement inutile, et force la mise à niveau hybride). */
  const appliedBasemap = useRef<Basemap | null>(null);

  const basemap = useStore((s) => s.basemap);
  const reports = useStore((s) => s.reports);
  const segments = useStore((s) => s.trafficSegments);
  const staleAfter = useStore((s) => s.settings.staleAfterMinutes);
  const now = useStore((s) => s.now);
  const routes = useStore((s) => s.routes);
  const selectedRouteId = useStore((s) => s.selectedRouteId);
  const userPos = useStore((s) => s.userPos);
  const destination = useStore((s) => s.destination);
  const picked = useStore((s) => s.pickedPoint);
  const showTraffic = useStore((s) => s.showTraffic);
  const showReports = useStore((s) => s.showReports);
  const nav = useStore((s) => s.nav);
  const mapCommand = useStore((s) => s.mapCommand);
  const pickMode = useStore((s) => s.pickMode);
  const pickChoice = useStore((s) => s.pickChoice);
  const choiceMarkers = useRef<maplibregl.Marker[]>([]);

  const effectiveBasemap: Basemap = dark && basemap === "liberty" ? "dark" : basemap;

  // ------------------------------------------------------------ création
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: initialStyle(effectiveBasemap),
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      maxBounds: MAX_BOUNDS,
      attributionControl: { compact: true },
      dragRotate: true,
      pitchWithRotate: true,
      cooperativeGestures: false,
    });
    mapRef.current = map;
    appliedBasemap.current = effectiveBasemap === "hybrid" ? "satellite" : effectiveBasemap;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("moveend", () => {
      const c = map.getCenter();
      currentCenter = [c.lng, c.lat];
    });
    map.on("style.load", () => {
      setupLayers(map);
      ready.current = true;
      map.fire("trafic:refresh");
    });

    const pick = (lngLat: maplibregl.LngLat) => {
      const p: LngLat = [lngLat.lng, lngLat.lat];
      if (!inBBox(p, COVERAGE)) {
        toast(tr("map.outOfCoverage"), "info");
        return;
      }
      setState({ pickedPoint: p, selectedReportId: null });
    };
    map.on("contextmenu", (e) => pick(e.lngLat));
    // Appui long sur écran tactile
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    map.on("touchstart", (e) => {
      if (e.originalEvent.touches.length !== 1) return;
      const ll = e.lngLat;
      pressTimer = setTimeout(() => pick(ll), 550);
    });
    const cancelPress = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
    map.on("touchend", cancelPress);
    map.on("touchmove", cancelPress);
    map.on("dragstart", (e) => {
      cancelPress();
      if ((e as unknown as { originalEvent?: Event }).originalEvent) setFollowing(false);
    });

    // Mode « choisir sur la carte » : un simple toucher choisit le point
    map.on("click", (e) => {
      if (!getState().pickMode) return;
      const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
      void applyPick(p, renderedPoiNear(map, e.point, p));
    });
    map.on("click", "report-points", (e: MapLayerMouseEvent) => {
      if (getState().pickMode) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) setState({ selectedReportId: id, pickedPoint: null });
    });
    map.on("click", "report-clusters", async (e: MapLayerMouseEvent) => {
      if (getState().pickMode) return;
      const f = e.features?.[0];
      if (!f) return;
      const src = map.getSource("reports") as GeoJSONSource;
      const zoom = await src.getClusterExpansionZoom(f.properties?.cluster_id as number);
      map.easeTo({ center: (f.geometry as Point).coordinates as LngLat, zoom });
    });
    map.on("click", "route-alt", (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id && !getState().nav && !getState().pickMode) setState({ selectedRouteId: id });
    });
    for (const layer of ["report-points", "report-clusters", "route-alt"]) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }

    return () => {
      ready.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------ fond de carte
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedBasemap.current === effectiveBasemap) return;
    let cancelled = false;
    void resolveStyle(effectiveBasemap).then((style) => {
      if (cancelled) return;
      ready.current = false;
      appliedBasemap.current = effectiveBasemap;
      map.setStyle(style, { diff: false });
    });
    return () => { cancelled = true; };
  }, [effectiveBasemap]);

  // ------------------------------------------------------------ données → sources
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!ready.current) return;
      const t = Date.now();
      const trafficFC: FC = {
        type: "FeatureCollection",
        features: segments.map((s) => ({
          type: "Feature",
          properties: { id: s.point_id, color: TRAFFIC_COLORS[displayLevel(s, t, staleAfter)] },
          geometry: s.geometry,
        })),
      };
      (map.getSource("traffic") as GeoJSONSource | undefined)?.setData(trafficFC);

      const visible = Object.values(reports).filter((r: Report) => isLive(r, t)).slice(0, 600);
      const reportsFC: FC = {
        type: "FeatureCollection",
        features: visible.map((r) => ({
          type: "Feature",
          properties: { id: r.id, type: r.type, severity: r.severity },
          geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        })),
      };
      (map.getSource("reports") as GeoJSONSource | undefined)?.setData(reportsFC);

      const routesFC: FC = {
        type: "FeatureCollection",
        features: [...routes]
          .sort((a) => (a.id === selectedRouteId ? 1 : -1))
          .map((r) => ({ type: "Feature", properties: { id: r.id, selected: r.id === selectedRouteId }, geometry: r.geometry })),
      };
      (map.getSource("routes") as GeoJSONSource | undefined)?.setData(routesFC);

      const acc = userPos && userPos.accuracy > 15 && userPos.accuracy < 2000
        ? { type: "FeatureCollection", features: [circlePolygon(userPos.lngLat, userPos.accuracy)] } as FC
        : emptyFC();
      (map.getSource("accuracy") as GeoJSONSource | undefined)?.setData(acc);

      const vis = (on: boolean) => (on ? "visible" : "none");
      for (const id of ["traffic-casing", "traffic-line"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis(showTraffic));
      for (const id of ["report-clusters", "report-cluster-count", "report-points"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis(showReports));
    };
    apply();
    map.on("trafic:refresh", apply);
    return () => { map.off("trafic:refresh", apply); };
  }, [segments, reports, routes, selectedRouteId, userPos, staleAfter, now, showTraffic, showReports]);

  // ------------------------------------------------------------ marqueurs
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!userPos) {
      userMarker.current?.remove();
      userMarker.current = null;
      return;
    }
    if (!userMarker.current) {
      const el = makeEl("user-dot", '<span class="user-dot__heading"></span><span class="user-dot__core"></span>');
      el.setAttribute("aria-label", tr("route.myPosition"));
      userMarker.current = new maplibregl.Marker({ element: el, rotationAlignment: "map" }).setLngLat(userPos.lngLat).addTo(map);
    }
    userMarker.current.setLngLat(userPos.lngLat);
    const el = userMarker.current.getElement();
    el.classList.toggle("user-dot--heading", userPos.heading != null && (userPos.speed ?? 0) > 1);
    userMarker.current.setRotation(userPos.heading ?? 0);
  }, [userPos]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    destMarker.current?.remove();
    destMarker.current = null;
    if (destination) {
      const el = makeEl("dest-pin", '<svg viewBox="0 0 32 44" width="32" height="44" aria-hidden="true"><path d="M16 0C7.2 0 0 7 0 15.7 0 27.5 16 44 16 44s16-16.5 16-28.3C32 7 24.8 0 16 0z" fill="#B3261E"/><circle cx="16" cy="16" r="6.5" fill="#fff"/></svg>');
      destMarker.current = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(destination.lngLat).addTo(map);
    }
  }, [destination]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pickedMarker.current?.remove();
    pickedMarker.current = null;
    if (picked) {
      pickedMarker.current = new maplibregl.Marker({ element: makeEl("picked-dot") }).setLngLat(picked).addTo(map);
    }
  }, [picked]);

  // ------------------------------------------------------------ cadrage
  useEffect(() => {
    const map = mapRef.current;
    if (!map || nav || !routes.length) return;
    const key = routes.map((r) => r.id + r.distance).join("|");
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;
    const all = routes.flatMap((r) => r.geometry.coordinates);
    const b = lineBBox(all);
    const wide = window.innerWidth >= 1024;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
      padding: wide ? { top: 80, bottom: 60, left: 460, right: 80 } : { top: 110, bottom: Math.round(window.innerHeight * 0.45), left: 40, right: 40 },
      duration: 700, maxZoom: 15,
    });
  }, [routes, nav]);

  // Suivi pendant la navigation
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !nav?.following || !userPos) return;
    const moving = (userPos.speed ?? 0) > 2 && userPos.heading != null;
    map.easeTo({
      center: userPos.lngLat,
      zoom: Math.max(map.getZoom(), 16),
      bearing: moving ? userPos.heading! : map.getBearing(),
      pitch: 50,
      duration: 900,
      padding: { top: window.innerHeight * 0.35, bottom: 40, left: 0, right: 0 },
    });
  }, [userPos, nav?.following]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!nav) map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
  }, [nav == null]);

  useEffect(() => {
    const map = mapRef.current;
    choiceMarkers.current.forEach((m) => m.remove());
    choiceMarkers.current = [];
    if (!map || !pickChoice) return;
    choiceMarkers.current.push(new maplibregl.Marker({ element: makeEl("picked-dot") }).setLngLat(pickChoice.point).addTo(map));
    if (pickChoice.poi) {
      choiceMarkers.current.push(new maplibregl.Marker({ element: makeEl("poi-ring") }).setLngLat(pickChoice.poi.lngLat).addTo(map));
    }
  }, [pickChoice]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapCommand) return;
    map.flyTo({ center: mapCommand.center, zoom: mapCommand.zoom ?? Math.max(map.getZoom(), 15), duration: 900 });
  }, [mapCommand]);

  return <div ref={container} style={{ position: "absolute", inset: 0 }} role="application" aria-label="Carte" />;
}

/** Centre courant de la carte (pour « signaler au centre de la carte »). */
let currentCenter: LngLat = INITIAL_VIEW.center;
export function mapCenter(): LngLat {
  return currentCenter;
}
