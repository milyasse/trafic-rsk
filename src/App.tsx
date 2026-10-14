import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { CONFIG_OK, UI_TICK_MS } from "./config";
import { LANGS } from "./i18n";
import { supabase } from "./lib/supabase";
import { loadUserData, startLiveData } from "./services/data";
import { startWatch } from "./services/geolocation";
import { computeRoutes } from "./services/routes";
import { focusMap, getState, setState, toast, tr, useStore, useT, type Panel } from "./store";
import { AccountPanel } from "./components/AccountPanel";
import { IconAlert, IconBriefcase, IconChevron, IconHome, IconLayers, IconList, IconLocate, IconRoute, IconUser } from "./components/Icons";
import { IncidentsPanel } from "./components/IncidentsPanel";
import { MapView } from "./components/MapView";
import { NavigationHud } from "./components/NavigationHud";
import { LayerMenu, StatusPill, Toasts } from "./components/Overlays";
import { PickedCard, ReportCard } from "./components/ReportCard";
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

function QuickPlaces() {
  const t = useT();
  const favorites = useStore((s) => s.favorites);
  const home = favorites.find((f) => f.kind === "home");
  const work = favorites.find((f) => f.kind === "work");
  if (!home && !work) return null;
  return (
    <div className="flex gap-2">
      {home && (
        <button type="button" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border hairline font-bold"
          onClick={() => void computeRoutes({ label: home.label, lngLat: [home.lng, home.lat] })}>
          <IconHome size={18} /> {t("search.home")}
        </button>
      )}
      {work && (
        <button type="button" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border hairline font-bold"
          onClick={() => void computeRoutes({ label: work.label, lngLat: [work.lng, work.lat] })}>
          <IconBriefcase size={18} /> {t("search.work")}
        </button>
      )}
    </div>
  );
}

function PanelContent({ panel }: { panel: Panel }) {
  const destination = useStore((s) => s.destination);
  if (panel === "incidents") return <IncidentsPanel />;
  if (panel === "account") return <AccountPanel />;
  return destination ? <RoutePanel /> : (
    <div className="flex flex-col gap-5">
      <QuickPlaces />
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
          onClick={() => setState({ panel: tab.id, sheetExpanded: true })}
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
  const expanded = useStore((s) => s.sheetExpanded);
  const userPos = useStore((s) => s.userPos);
  const geoError = useStore((s) => s.geoError);

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
          <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+10px)] z-20 flex flex-col items-start gap-2 lg:hidden">
            <SearchBox />
            <StatusPill />
          </div>

          {/* Panneau : feuille inférieure sur mobile, colonne latérale sur ordinateur */}
          <aside
            className={`sheet surface fixed inset-x-0 bottom-0 z-20 flex flex-col pb-[env(safe-area-inset-bottom)] transition-[max-height] duration-300
              lg:inset-y-0 lg:start-0 lg:end-auto lg:w-[400px] lg:max-h-none
              ${expanded ? "max-h-[72vh]" : "max-h-[156px]"}`}
            aria-label={t("app.name")}
          >
            <div className="hidden flex-col gap-3 p-4 pb-2 lg:flex">
              <div className="flex items-baseline justify-between">
                <h1 className="text-xl font-bold">{t("app.name")}</h1>
                <span className="muted text-sm">{t("app.region")}</span>
              </div>
              <SearchBox />
              <StatusPill />
            </div>
            <button
              type="button"
              className="flex w-full flex-col items-center pt-2 pb-1 lg:hidden"
              aria-expanded={expanded}
              aria-label={expanded ? t("common.close") : t("tab.search")}
              onClick={() => setState({ sheetExpanded: !expanded })}
            >
              <span className="h-1.5 w-10 rounded-full bg-[var(--line)]" aria-hidden />
              <IconChevron size={16} up={!expanded} className="muted mt-0.5" />
            </button>
            <div className="px-3 lg:px-4"><Tabs /></div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-6">
              <PanelContent panel={panel} />
            </div>
          </aside>
        </>
      )}

      {/* Boutons flottants */}
      {!nav && (
        <div className="absolute end-3 z-10 flex flex-col gap-3 bottom-[172px] lg:bottom-8 lg:end-4">
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

      {!nav && <ReportCard />}
      {!nav && <PickedCard />}
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
