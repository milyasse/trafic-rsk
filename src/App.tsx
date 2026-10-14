import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { CONFIG_OK, UI_TICK_MS } from "./config";
import { LANGS } from "./i18n";
import { supabase } from "./lib/supabase";
import { loadUserData, startLiveData } from "./services/data";
import { startWatch } from "./services/geolocation";
import { cancelPick, startPick } from "./services/routes";
import { focusMap, getState, setState, toast, tr, useStore, useT, type Panel } from "./store";
import { AccountPanel } from "./components/AccountPanel";
import { BottomSheet, useIsWide } from "./components/BottomSheet";
import { IconAlert, IconLayers, IconList, IconLocate, IconPin, IconRoute, IconUser } from "./components/Icons";
import { FavoriteSheet, FavoritesSection } from "./components/Favorites";
import { IncidentsPanel } from "./components/IncidentsPanel";
import { MapView } from "./components/MapView";
import { NavigationHud } from "./components/NavigationHud";
import { LayerMenu, StatusPill, Toasts, TrafficLegend } from "./components/Overlays";
import { OfficialCard, PickChoiceCard, PickedCard, ReportCard } from "./components/ReportCard";
import { ReportSheet } from "./components/ReportSheet";
import { RoutePanel } from "./components/RoutePanel";
import { SearchBox } from "./components/SearchBox";
import { TrafficPanel } from "./components/TrafficPanel";

const AdminPage = lazy(() => import("./pages/Admin"));

function useDark(): boolean {
  const pref = useStore((s) => s.themePref);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return pref === "dark" || (pref === "auto" && systemDark);
}

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function PickButton({ target }: { target: "destination" | "origin" }) {
  const t = useT();
  return (
    <button type="button" onClick={() => startPick(target)}
      className="accent flex h-11 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--accent)] font-bold">
      <IconPin size={18} /> {t(target === "origin" ? "pick.origin" : "pick.destination")}
    </button>
  );
}

function PickBanner() {
  const t = useT();
  const mode = useStore((s) => s.pickMode);
  if (!mode) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 top-[calc(env(safe-area-inset-top)+10px)] z-40 flex justify-center lg:start-[416px]">
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-[var(--color-oudaya)] px-4 py-3 text-white shadow-xl" role="status">
        <IconPin size={22} />
        <span className="font-bold">{t(mode === "origin" ? "pick.bannerOrigin" : mode === "favorite" ? "pick.bannerFavorite" : "pick.bannerDestination")}</span>
        <button type="button" onClick={cancelPick} className="ms-auto rounded-lg bg-white/20 px-3 py-1.5 font-bold">{t("pick.cancel")}</button>
      </div>
    </div>
  );
}

function PanelContent({ panel }: { panel: Panel }) {
  const destination = useStore((s) => s.destination);
  if (panel === "incidents") return <IncidentsPanel />;
  if (panel === "account") return <AccountPanel />;
  return destination ? <RoutePanel /> : (
    <div className="flex flex-col gap-5">
      <FavoritesSection />
      <PickButton target="destination" />
      <TrafficPanel />
    </div>
  );
}

function Tabs() {
  const t = useT();
  const panel = useStore((s) => s.panel);
  const tabs: { id: Panel; label: string; icon: ReactNode }[] = [
    { id: "search", label: t("tab.search"), icon: <IconRoute size={18} /> },
    { id: "incidents", label: t("tab.incidents"), icon: <IconList size={18} /> },
    { id: "account", label: t("tab.account"), icon: <IconUser size={18} /> },
  ];
  return (
    <div className="flex gap-1" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={panel === tab.id}
          onClick={() => setState((s) => ({ panel: tab.id, sheet: s.sheet === "peek" ? "half" : s.sheet }))}
          className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-bold ${panel === tab.id ? "bg-accent-soft accent" : "muted"}`}
        >
          {tab.icon}{tab.label}
        </button>
      ))}
    </div>
  );
}

function MainScreen({ dark }: { dark: boolean }) {
  const t = useT();
  const nav = useStore((s) => s.nav);
  const panel = useStore((s) => s.panel);
  const level = useStore((s) => s.sheet);
  const wide = useIsWide();
  const cardOpen = useStore((s) => Boolean(s.selectedReportId || s.selectedOfficialId || s.pickedPoint || s.pickChoice || s.favoriteDraft));
  const userPos = useStore((s) => s.userPos);
  const geoError = useStore((s) => s.geoError);
  const pickMode = useStore((s) => s.pickMode);

  useEffect(() => {
    if (geoError) toast(tr(geoError), "error", undefined, 7000);
  }, [geoError]);

  const locate = () => {
    startWatch();
    const p = getState().userPos;
    if (p) focusMap(p.lngLat, 15);
    else {
      const unsub = setInterval(() => {
        const pos = getState().userPos;
        if (pos) { focusMap(pos.lngLat, 15); clearInterval(unsub); }
      }, 300);
      setTimeout(() => clearInterval(unsub), 12000);
    }
  };

  return (
    <div className="fixed inset-0 overflow-hidden">
      <MapView dark={dark} />

      {nav ? <NavigationHud /> : (
        <>
          {/* Recherche (mobile : en haut ; ordinateur : dans le panneau) */}
          <div className={`absolute inset-x-3 top-[calc(env(safe-area-inset-top)+10px)] z-30 flex-col items-start gap-2 lg:hidden ${pickMode ? "hidden" : "flex"}`}>
            <SearchBox />
            {(level !== "full" || cardOpen) && <><StatusPill /><TrafficLegend /></>}
          </div>

          {/* Panneau : feuille inférieure à 3 hauteurs sur mobile, colonne latérale sur ordinateur.
              Masquée sur mobile quand une fiche (incident, point choisi) est ouverte. */}
          <BottomSheet
            label={t("app.name")}
            hidden={cardOpen || Boolean(pickMode)}
            header={
              <>
                <div className="hidden flex-col gap-3 p-4 pb-2 lg:flex">
                  <div className="flex items-baseline justify-between">
                    <h1 className="panel-title text-[var(--accent)]">{t("app.name")}</h1>
                    <span className="muted text-sm">{t("app.region")}</span>
                  </div>
                  <SearchBox />
                  <StatusPill />
                  <TrafficLegend compact />
                </div>
                <div className="px-3 lg:px-4"><Tabs /></div>
              </>
            }
          >
            <PanelContent panel={panel} />
          </BottomSheet>
        </>
      )}

      {/* Boutons flottants */}
      {!nav && (wide || level !== "full" || cardOpen) && (
        <div className="fab-stack absolute end-3 z-10 flex flex-col gap-3 lg:end-4">
          <button type="button" className="map-btn" aria-label={t("map.layers")} onClick={() => setState({ layerMenu: true })}>
            <IconLayers />
          </button>
          <button type="button" className={`map-btn ${userPos ? "accent" : ""}`} aria-label={t("map.locate")} onClick={locate}>
            <IconLocate />
          </button>
          <button
            type="button"
            className="map-btn !h-16 !w-16 !bg-[var(--color-alerte)] text-white"
            aria-label={t("report.title")}
            onClick={() => setState({ reportSheet: { at: null, source: userPos ? "position" : "center" } })}
          >
            <span className="flex flex-col items-center text-[11px] font-bold leading-none"><IconAlert size={24} />{t("report.button")}</span>
          </button>
        </div>
      )}
      {nav && (
        <button
          type="button"
          className="map-btn fixed end-4 bottom-48 z-30 !h-14 !w-14 !bg-[var(--color-alerte)] text-white lg:bottom-32"
          aria-label={t("report.title")}
          onClick={() => setState({ reportSheet: { at: null, source: "position" } })}
        >
          <IconAlert size={26} />
        </button>
      )}

      {!nav && <PickBanner />}
      {!nav && <PickChoiceCard />}
      {!nav && <ReportCard />}
      {!nav && <OfficialCard />}
      {!nav && <PickedCard />}
      <FavoriteSheet />
      <ReportSheet />
      <LayerMenu />
      <Toasts />
    </div>
  );
}

export default function App() {
  const dark = useDark();
  const lang = useStore((s) => s.lang);
  const hash = useHashRoute();

  useEffect(() => {
    const meta = LANGS.find((l) => l.code === lang)!;
    document.documentElement.lang = lang;
    document.documentElement.dir = meta.dir;
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    if (!CONFIG_OK) return;
    const stop = startLiveData();
    const tick = setInterval(() => setState({ now: Date.now() }), UI_TICK_MS);
    void supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session });
      void loadUserData();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const prev = getState().session?.user.id;
      setState({ session });
      if (prev !== session?.user.id) void loadUserData();
    });
    return () => {
      stop();
      clearInterval(tick);
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!CONFIG_OK) {
    return <p className="p-6">{tr("config.missing")}</p>;
  }

  if (hash.startsWith("#/admin")) {
    return (
      <Suspense fallback={<p className="p-6">{tr("common.loading")}</p>}>
        <AdminPage dark={dark} />
      </Suspense>
    );
  }
  return <MainScreen dark={dark} />;
}
