// « Mes favoris » : lieux enregistrés, choisis d'un toucher comme destination.
// Avec un compte : synchronisés ; sans compte : gardés sur cet appareil.
import { useEffect, useRef, useState } from "react";
import { formatDistance } from "../lib/format";
import { reverseGeocode } from "../lib/geocode";
import { haversine, type LngLat } from "../lib/geo";
import { deleteFavorite, hasAccount, renameFavorite, saveFavorite } from "../services/data";
import { computeRoutes, setPendingFavoriteKind, startPick } from "../services/routes";
import { getState, setState, useStore, useT, type Favorite } from "../store";
import { useBottomInset } from "./BottomSheet";
import { IconBriefcase, IconClose, IconHome, IconPin, IconSide, IconStar } from "./Icons";

/** Favori déjà enregistré à moins de 30 m de ce point. */
export function useFavoriteAt(p: LngLat | null | undefined): Favorite | undefined {
  const favorites = useStore((s) => s.favorites);
  if (!p) return undefined;
  return favorites.find((f) => haversine([f.lng, f.lat], p) < 30);
}

function KindIcon({ kind, size = 20 }: { kind: Favorite["kind"]; size?: number }) {
  if (kind === "home") return <IconHome size={size} />;
  if (kind === "work") return <IconBriefcase size={size} />;
  return <IconStar size={size} />;
}

function go(f: Favorite) {
  void computeRoutes({ label: f.label, lngLat: [f.lng, f.lat] });
}

/** Tuile Domicile / Travail : aller vers le lieu, ou l'enregistrer s'il n'existe pas encore. */
function HomeWorkTile({ kind }: { kind: "home" | "work" }) {
  const t = useT();
  const fav = useStore((s) => s.favorites.find((f) => f.kind === kind));
  const label = t(kind === "home" ? "search.home" : "search.work");
  if (!fav) {
    return (
      <button type="button" onClick={() => { setPendingFavoriteKind(kind); startPick("favorite"); }}
        className="flex min-h-[64px] flex-1 items-center gap-3 rounded-2xl border-2 border-dashed hairline px-3 text-start">
        <span className="muted"><KindIcon kind={kind} size={22} /></span>
        <span className="min-w-0">
          <span className="block font-bold">{label}</span>
          <span className="accent block text-sm font-bold">{t("favorites.set")}</span>
        </span>
      </button>
    );
  }
  return (
    <button type="button" onClick={() => go(fav)}
      className="bg-accent-soft flex min-h-[64px] flex-1 items-center gap-3 rounded-2xl px-3 text-start">
      <span className="accent"><KindIcon kind={kind} size={22} /></span>
      <span className="min-w-0">
        <span className="block font-bold">{label}</span>
        <span className="muted block truncate text-sm">{fav.label}</span>
      </span>
    </button>
  );
}

function FavoriteRow({ f, editing }: { f: Favorite; editing: boolean }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const userPos = useStore((s) => s.userPos);
  const [name, setName] = useState(f.label);
  useEffect(() => setName(f.label), [f.label]);
  const d = userPos ? haversine(userPos.lngLat, [f.lng, f.lat]) : null;
  const kindLabel = f.kind === "home" ? t("search.home") : f.kind === "work" ? t("search.work") : null;

  if (editing) {
    return (
      <li className="flex items-center gap-2 py-1.5">
        <span className="accent shrink-0"><KindIcon kind={f.kind} /></span>
        <input className="field min-w-0 flex-1" value={name} maxLength={80} aria-label={t("account.favoriteLabel")}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { if (name.trim() && name.trim() !== f.label) void renameFavorite(f.id, name); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        <button type="button" className="icon-btn shrink-0 text-[var(--color-alerte)]" aria-label={t("favorites.delete", { name: f.label })}
          onClick={() => void deleteFavorite(f.id)}>
          <IconClose size={20} />
        </button>
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={() => go(f)}
        className="flex min-h-[60px] w-full items-center gap-3 rounded-xl px-2 py-2 text-start hover:bg-[var(--surface-2)]">
        <span className="bg-accent-soft accent grid h-10 w-10 shrink-0 place-items-center rounded-full"><KindIcon kind={f.kind} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-bold">{f.label}</span>
          <span className="muted block truncate text-sm">{kindLabel ? `${kindLabel} · ` : ""}{f.address ?? ""}</span>
        </span>
        {d != null && <span className="tabular muted shrink-0 text-sm font-bold">{formatDistance(d, lang)}</span>}
        <IconSide dir="next" size={18} className="muted shrink-0" />
      </button>
    </li>
  );
}

export function FavoritesSection() {
  const t = useT();
  const favorites = useStore((s) => s.favorites);
  useStore((s) => s.profile); // re-rendu quand le compte change (favoris locaux / synchronisés)
  const [editing, setEditing] = useState(false);
  const others = favorites.filter((f) => f.kind === "other");
  const local = !hasAccount();

  return (
    <section aria-labelledby="fav-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="fav-title" className="panel-title">{t("favorites.title")}</h2>
        {favorites.length > 0 && (
          <button type="button" className="accent text-[15px] font-bold" onClick={() => setEditing(!editing)} aria-pressed={editing}>
            {t(editing ? "favorites.done" : "favorites.edit")}
          </button>
        )}
      </div>

      {editing ? (
        <ul className="flex flex-col">
          {favorites.map((f) => <FavoriteRow key={f.id} f={f} editing />)}
        </ul>
      ) : (
        <>
          <div className="flex gap-2">
            <HomeWorkTile kind="home" />
            <HomeWorkTile kind="work" />
          </div>
          {others.length > 0 ? (
            <ul className="-mx-2 flex flex-col">
              {others.map((f) => <FavoriteRow key={f.id} f={f} editing={false} />)}
            </ul>
          ) : favorites.length === 0 ? (
            <p className="muted text-sm">{t("favorites.empty")}</p>
          ) : null}
          <button type="button" onClick={() => { setPendingFavoriteKind("other"); startPick("favorite"); }}
            className="accent flex h-11 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--accent)] font-bold">
            <IconPin size={18} /> {t("favorites.addOnMap")}
          </button>
        </>
      )}
      {local && favorites.length > 0 && <p className="muted text-xs">{t("favorites.localNote")}</p>}
    </section>
  );
}

/** Bouton étoile : enregistre le lieu, ou indique qu'il est déjà dans les favoris. */
export function FavoriteStar({ label, address, lngLat, className = "" }: { label: string; address: string; lngLat: LngLat; className?: string }) {
  const t = useT();
  const existing = useFavoriteAt(lngLat);
  if (existing) {
    return (
      <span className={`chip text-[var(--accent)] ${className}`}>
        <IconStar size={16} filled /> {t("favorites.inFavorites")}
      </span>
    );
  }
  return (
    <button type="button" className={`chip ${className}`} onClick={() => setState({ favoriteDraft: { label, address, lngLat } })}>
      <IconStar size={16} /> {t("favorites.add")}
    </button>
  );
}

/** Fiche d'enregistrement : nom et type (Domicile, Travail, Autre). */
export function FavoriteSheet() {
  const t = useT();
  const draft = useStore((s) => s.favoriteDraft);
  const favorites = useStore((s) => s.favorites);
  const ref = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Favorite["kind"]>("other");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  useBottomInset(ref, Boolean(draft));

  useEffect(() => {
    if (!draft) return undefined;
    setName(draft.label.slice(0, 80));
    setAddress(draft.address);
    setKind(draft.kind ?? "other");
    // Adresse pas encore connue (seulement des coordonnées) : on la cherche et on propose un nom.
    if (!/^-?\d+\.\d+, -?\d+\.\d+$/.test(draft.label.trim())) return undefined;
    const ctrl = new AbortController();
    void reverseGeocode(draft.lngLat, getState().lang, ctrl.signal).then((a) => {
      if (!a || ctrl.signal.aborted) return;
      setAddress(a);
      setName((cur) => (cur === draft.label.slice(0, 80) ? a.split(",")[0].slice(0, 80) : cur));
    });
    return () => ctrl.abort();
  }, [draft]);
  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setState({ favoriteDraft: null }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft]);

  if (!draft) return null;
  const replaced = kind !== "other" ? favorites.find((f) => f.kind === kind) : undefined;
  const close = () => setState({ favoriteDraft: null });

  return (
    <form
      ref={ref}
      role="dialog"
      aria-labelledby="fav-sheet-title"
      className="card-sheet surface fixed inset-x-0 bottom-0 z-50 flex flex-col gap-3 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+16px)]
        lg:inset-x-auto lg:start-[424px] lg:bottom-6 lg:w-[400px] lg:pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await saveFavorite(kind, name, address || draft.address, draft.lngLat);
        setBusy(false);
        // Montrer le favori ajouté dans « Mes favoris »
        if (ok) setState((s) => ({ favoriteDraft: null, panel: "search", sheet: s.sheet === "peek" ? "half" : s.sheet }));
      }}
    >
      <span className="mx-auto block h-1.5 w-11 rounded-full bg-[var(--line)] lg:hidden" aria-hidden />
      <div className="flex items-center justify-between">
        <h2 id="fav-sheet-title" className="panel-title">{t("favorites.addTitle")}</h2>
        <button type="button" onClick={close} aria-label={t("common.close")} className="icon-btn muted"><IconClose size={22} /></button>
      </div>
      <p className="muted -mt-2 truncate text-sm">{address}</p>

      <label>
        <span className="field-label">{t("account.favoriteLabel")}</span>
        <input className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus required />
      </label>

      <div>
        <span className="field-label">{t("account.favoriteKind")}</span>
        <div className="segment">
          {(["home", "work", "other"] as const).map((k) => (
            <button key={k} type="button" className="segment-item inline-flex items-center justify-center gap-1.5" aria-pressed={kind === k} onClick={() => setKind(k)}>
              <KindIcon kind={k} size={16} /> {t(k === "home" ? "search.home" : k === "work" ? "search.work" : "account.other")}
            </button>
          ))}
        </div>
        {replaced && <p className="muted mt-1.5 text-sm">{t("favorites.replaces", { name: replaced.label })}</p>}
      </div>

      <button type="submit" className="btn btn-primary w-full" disabled={busy || !name.trim()}>{t("favorites.save")}</button>
      {!hasAccount() && <p className="muted text-xs">{t("favorites.localNote")}</p>}
    </form>
  );
}
