// Interface d'administration : accès réservé (rôle admin vérifié côté base par RLS et admin_stats()).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { INITIAL_VIEW, MAP_STYLES } from "../config";
import { formatAge, formatDateTime } from "../lib/format";
import { REPORT_META, type Report } from "../lib/reports";
import { supabase } from "../lib/supabase";
import { toast, useStore, useT } from "../store";
import { AuthForm } from "../components/AccountPanel";

type Json = number | boolean | string | Json[] | { [k: string]: Json };
interface SettingRow { key: string; value: Json; description: string | null; updated_at: string }
interface ServiceRow { service: string; ok: boolean; provider: string | null; last_success_at: string | null; last_error_at: string | null; last_error: string | null; calls_today: number; errors_today: number }
interface PointRow { id: string; name: string; city: string; enabled: boolean }
interface Stats { active: number; hidden: number; last_24h: number; last_7d: number; users: number; votes_24h: number; by_type_24h: Record<string, number>; by_city_24h: Record<string, number>; by_status_7d: Record<string, number> }

const ADMIN_COLUMNS = "id,type,severity,description,lat,lng,city,status,confirmations,resolutions,flags,source,created_at,updated_at,expires_at";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="surface rounded-2xl border hairline p-4">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function ValueEditor({ value, onChange }: { value: Json; onChange: (v: Json) => void }) {
  if (typeof value === "number") {
    return <input type="number" className="surface h-9 w-28 rounded-lg border hairline px-2 tabular" value={value} onChange={(e) => onChange(Number(e.target.value))} />;
  }
  if (typeof value === "boolean") {
    return <input type="checkbox" className="h-5 w-5" checked={value} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (Array.isArray(value)) {
    return (
      <input className="surface h-9 w-40 rounded-lg border hairline px-2" value={value.join(", ")}
        onChange={(e) => onChange(e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)))} />
    );
  }
  if (typeof value === "object" && value) {
    return (
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
        {Object.entries(value).map(([k, v]) => (
          <label key={k} className="contents text-sm">
            <span className="muted">{k}</span>
            <ValueEditor value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} />
          </label>
        ))}
      </div>
    );
  }
  return <input className="surface h-9 rounded-lg border hairline px-2" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
}

function SettingEditor({ row, onSaved }: { row: SettingRow; onSaved: () => void }) {
  const [value, setValue] = useState<Json>(row.value);
  const dirty = JSON.stringify(value) !== JSON.stringify(row.value);
  return (
    <div className="border-b hairline py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold">{row.key}</p>
          {row.description && <p className="muted text-sm">{row.description}</p>}
        </div>
        <button type="button" disabled={!dirty} className="bg-accent h-9 shrink-0 rounded-lg px-3 text-sm font-bold text-white disabled:opacity-40"
          onClick={async () => {
            const { error } = await supabase.from("app_settings").update({ value }).eq("key", row.key);
            if (error) toast(`Échec : ${error.message}`, "error");
            else { toast("Paramètre enregistré", "success"); onSaved(); }
          }}>
          Enregistrer
        </button>
      </div>
      <div className="mt-2"><ValueEditor value={value} onChange={setValue} /></div>
    </div>
  );
}

function AdminMap({ reports, dark, focus }: { reports: Report[]; dark: boolean; focus: [number, number] | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const m = new maplibregl.Map({ container: ref.current, style: MAP_STYLES[dark ? "dark" : "positron"], center: INITIAL_VIEW.center, zoom: 9.5 });
    map.current = m;
    m.on("load", () => {
      m.addSource("r", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "r", type: "circle", source: "r",
        paint: {
          "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2,
          "circle-opacity": ["case", ["get", "live"], 1, 0.45],
        },
      });
      m.fire("admin:data");
    });
    return () => m.remove();
  }, [dark]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const src = m.getSource("r") as GeoJSONSource | undefined;
      src?.setData({
        type: "FeatureCollection",
        features: reports.map((r) => ({
          type: "Feature", properties: { color: REPORT_META[r.type].color, live: r.status === "active" || r.status === "confirmed" },
          geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        })),
      });
    };
    apply();
    m.on("admin:data", apply);
    return () => { m.off("admin:data", apply); };
  }, [reports]);
  useEffect(() => {
    if (focus) map.current?.flyTo({ center: focus, zoom: 15 });
  }, [focus]);
  return <div ref={ref} className="h-80 w-full overflow-hidden rounded-xl" />;
}

export default function AdminPage({ dark }: { dark: boolean }) {
  const t = useT();
  const session = useStore((s) => s.session);
  const profile = useStore((s) => s.profile);
  const lang = useStore((s) => s.lang);
  const trafficStatus = useStore((s) => s.trafficStatus);
  const now = useStore((s) => s.now);
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [points, setPoints] = useState<PointRow[]>([]);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const isAdmin = profile?.role === "admin";

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const [st, rp, se, sv, pt] = await Promise.all([
      supabase.rpc("admin_stats"),
      supabase.from("reports").select(ADMIN_COLUMNS).gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      supabase.from("app_settings").select("key,value,description,updated_at").order("key"),
      supabase.from("service_status").select("*"),
      supabase.from("traffic_points").select("id,name,city,enabled").order("city"),
    ]);
    if (st.data) setStats(st.data as Stats);
    if (rp.data) setReports(rp.data as unknown as Report[]);
    if (se.data) setSettings(se.data as SettingRow[]);
    if (sv.data) setServices(sv.data as ServiceRow[]);
    if (pt.data) setPoints(pt.data as PointRow[]);
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (!session || !isAdmin) {
    const signedIn = !!session && !session.user.is_anonymous;
    return (
      <main className="surface-2 min-h-full">
        <div className="surface mx-auto max-w-md rounded-b-2xl p-6 lg:mt-10 lg:rounded-2xl">
          <h1 className="text-2xl font-bold">{t("account.admin")}</h1>
          {!signedIn && (
            <>
              <p className="muted mt-2">
                Connectez-vous avec un compte administrateur. Première visite : choisissez « Créer un compte » avec l'adresse
                e-mail déclarée comme administrateur ; le rôle est attribué automatiquement à l'inscription.
              </p>
              <div className="mt-4"><AuthForm /></div>
            </>
          )}
          {signedIn && profile === null && <p className="muted mt-2">{t("common.loading")}</p>}
          {signedIn && profile && !isAdmin && (
            <>
              <p className="mt-2">
                Le compte <strong>{session.user.email}</strong> n'a pas le rôle administrateur.
              </p>
              <p className="muted mt-1 text-sm">
                Seules les adresses déclarées dans la liste des administrateurs reçoivent ce rôle. Déconnectez-vous pour utiliser un autre compte.
              </p>
              <button type="button" className="mt-3 h-10 rounded-lg border hairline px-3 font-bold" onClick={() => void supabase.auth.signOut()}>
                {t("account.signOut")}
              </button>
            </>
          )}
          <a href="#/" className="accent mt-5 inline-block font-bold">{t("common.back")}</a>
        </div>
      </main>
    );
  }

  const setStatus = async (id: string, status: Report["status"]) => {
    const { error } = await supabase.from("reports").update({ status }).eq("id", id);
    if (error) toast(`Échec : ${error.message}`, "error");
    else { toast("Signalement mis à jour", "success"); void load(); }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Supprimer définitivement ce signalement ?")) return;
    const { error } = await supabase.from("reports").delete().eq("id", id);
    if (error) toast(`Échec : ${error.message}`, "error");
    else { toast("Signalement supprimé", "success"); void load(); }
  };

  const visible = reports.filter((r) => statusFilter === "all" || r.status === statusFilter);
  const trafficCfg = settings.find((s) => s.key === "traffic")?.value as { refresh_minutes?: number } | undefined;

  return (
    <main className="surface-2 min-h-full">
      <header className="surface sticky top-0 z-10 flex items-center justify-between border-b hairline px-4 py-3">
        <h1 className="text-xl font-bold">{t("account.admin")} · {t("app.name")}</h1>
        <div className="flex gap-2">
          <button type="button" className="h-10 rounded-lg border hairline px-3 font-bold" onClick={() => void load()}>Actualiser</button>
          <a href="#/" className="bg-accent grid h-10 place-items-center rounded-lg px-3 font-bold text-white">Carte</a>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-2">
        <Section title="Statistiques">
          {stats ? (
            <>
              <dl className="grid grid-cols-3 gap-3 text-center">
                {[["En cours", stats.active], ["24 h", stats.last_24h], ["7 jours", stats.last_7d], ["Masqués", stats.hidden], ["Votes 24 h", stats.votes_24h], ["Comptes", stats.users]].map(([k, v]) => (
                  <div key={k as string} className="surface-2 rounded-xl p-2">
                    <dt className="muted text-sm">{k}</dt>
                    <dd className="tabular text-2xl font-bold">{v}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="mt-4 text-sm font-bold">Par type (24 h)</h3>
              <p className="text-sm">{Object.entries(stats.by_type_24h).map(([k, v]) => `${REPORT_META[k as Report["type"]]?.glyph ?? ""} ${k} : ${v}`).join(" · ") || "—"}</p>
              <h3 className="mt-2 text-sm font-bold">Par ville (24 h)</h3>
              <p className="text-sm">{Object.entries(stats.by_city_24h).map(([k, v]) => `${k} : ${v}`).join(" · ") || "—"}</p>
              <h3 className="mt-2 text-sm font-bold">Par statut (7 jours)</h3>
              <p className="text-sm">{Object.entries(stats.by_status_7d).map(([k, v]) => `${k} : ${v}`).join(" · ") || "—"}</p>
            </>
          ) : <p className="muted">{t("common.loading")}</p>}
        </Section>

        <Section title="Fraîcheur des données et état des services">
          <p className="text-sm">
            <strong>Trafic :</strong>{" "}
            {trafficStatus?.available ? `disponible (${trafficStatus.provider})` : `indisponible — ${trafficStatus?.message ?? "?"}`}
            {" · "}dernière mesure : {trafficStatus?.last_success_at ? `${formatDateTime(new Date(trafficStatus.last_success_at), lang)} (${formatAge(trafficStatus.last_success_at, now, lang)})` : "jamais"}
          </p>
          <ul className="muted mt-2 list-disc ps-5 text-sm">
            <li>Réception des événements (signalements, mesures) : instantanée via Supabase Realtime.</li>
            <li>Interrogation du fournisseur de trafic : au plus toutes les {trafficCfg?.refresh_minutes ?? "?"} min, côté serveur, dans la limite du budget journalier.</li>
            <li>Rafraîchissement de l'interface : âge des données recalculé toutes les 30 s ; vérification serveur toutes les 5 min.</li>
          </ul>
          <table className="mt-3 w-full text-sm">
            <thead><tr className="muted text-start"><th className="text-start">Service</th><th className="text-start">État</th><th className="text-start">Appels / erreurs (jour)</th></tr></thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.service} className="border-t hairline align-top">
                  <td className="py-1.5 font-bold">{s.service}<span className="muted block font-normal">{s.provider}</span></td>
                  <td className="py-1.5">{s.ok ? "OK" : "Erreur"}<span className="muted block">{s.last_success_at ? `succès ${formatAge(s.last_success_at, now, lang)}` : ""}</span>
                    {s.last_error && <span className="block text-[var(--color-alerte)]">{s.last_error} ({formatAge(s.last_error_at, now, lang)})</span>}</td>
                  <td className="tabular py-1.5">{s.calls_today} / {s.errors_today}</td>
                </tr>
              ))}
              {services.length === 0 && <tr><td colSpan={3} className="muted py-2">Aucun appel enregistré.</td></tr>}
            </tbody>
          </table>
        </Section>

        <div className="lg:col-span-2">
          <Section title="Signalements (7 derniers jours)">
            <AdminMap reports={visible} dark={dark} focus={focus} />
            <div className="mt-3 flex items-center gap-2 text-sm">
              <label>Statut :{" "}
                <select className="surface h-9 rounded-lg border hairline px-2" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  {["all", "active", "confirmed", "hidden", "resolved", "expired"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <span className="muted">{visible.length} élément(s)</span>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="muted"><th className="text-start">Type</th><th className="text-start">Ville</th><th className="text-start">Statut</th><th className="text-start">Votes ✓ / ✗ / abus</th><th className="text-start">Créé</th><th className="text-start">Actions</th></tr></thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id} className="border-t hairline align-top">
                      <td className="py-1.5"><button type="button" className="text-start font-bold" onClick={() => setFocus([r.lng, r.lat])}>{REPORT_META[r.type].glyph} {t(`report.type.${r.type}`)}</button>
                        {r.description && <span className="muted block">{r.description}</span>}</td>
                      <td className="py-1.5">{r.city}</td>
                      <td className="py-1.5">{r.status}</td>
                      <td className="tabular py-1.5">{r.confirmations} / {r.resolutions} / {r.flags ?? 0}</td>
                      <td className="py-1.5">{formatDateTime(new Date(r.created_at), lang)}</td>
                      <td className="flex flex-wrap gap-1 py-1.5">
                        {r.status !== "hidden" && <button type="button" className="rounded border hairline px-2 py-1" onClick={() => void setStatus(r.id, "hidden")}>Masquer</button>}
                        {r.status === "hidden" && <button type="button" className="rounded border hairline px-2 py-1" onClick={() => void setStatus(r.id, "active")}>Restaurer</button>}
                        {(r.status === "active" || r.status === "confirmed") && <button type="button" className="rounded border hairline px-2 py-1" onClick={() => void setStatus(r.id, "resolved")}>Résoudre</button>}
                        <button type="button" className="rounded border border-[var(--color-alerte)] px-2 py-1 text-[var(--color-alerte)]" onClick={() => void remove(r.id)}>Supprimer</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        <Section title="Paramètres">
          {settings.map((s) => <SettingEditor key={s.key + s.updated_at} row={s} onSaved={() => void load()} />)}
        </Section>

        <Section title="Points de mesure du trafic">
          <p className="muted mb-2 text-sm">Chaque point actif consomme une requête par actualisation. Budget journalier dans le paramètre « traffic ».</p>
          <ul>
            {points.map((p) => (
              <li key={p.id} className="flex items-center justify-between border-t hairline py-1.5 text-sm">
                <span><strong>{p.name}</strong> <span className="muted">· {p.city}</span></span>
                <input type="checkbox" className="h-5 w-5" checked={p.enabled} aria-label={`Activer ${p.name}`}
                  onChange={async (e) => {
                    const { error } = await supabase.from("traffic_points").update({ enabled: e.target.checked }).eq("id", p.id);
                    if (error) toast(`Échec : ${error.message}`, "error"); else void load();
                  }} />
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}
