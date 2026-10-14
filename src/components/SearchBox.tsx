import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { matchCities } from "../lib/cities";
import { searchNominatim, searchPlaces, type Place } from "../lib/geocode";
import { clearRoutes, computeRoutes, startPick } from "../services/routes";
import { setState, useStore, useT } from "../store";
import { IconBriefcase, IconClock, IconClose, IconHome, IconPin, IconSearch, IconStar } from "./Icons";

interface Item { id: string; label: string; detail: string; lngLat: [number, number]; icon: "pin" | "home" | "work" | "star" | "clock" | "city" }

/** target="destination" : barre principale ; target="origin" : choix du point de départ. */
export function SearchBox({ target = "destination" }: { target?: "destination" | "origin" }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const destination = useStore((s) => (target === "origin" ? s.origin : s.destination));
  const userPos = useStore((s) => s.userPos);
  const favorites = useStore((s) => s.favorites);
  const history = useStore((s) => s.history);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">("idle");
  const [active, setActive] = useState(-1);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setQuery(destination?.label ?? "");
  }, [destination]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 3 || q === destination?.label) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus("loading");
      try {
        const r = await searchPlaces(q, userPos?.lngLat ?? null, lang, ctrl.signal);
        setResults(r);
        setStatus(r.length ? "idle" : "empty");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setStatus("error");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query, open, lang, userPos?.lngLat, destination?.label]);

  const q = query.trim().toLowerCase();
  const items: Item[] = [];
  if (open) {
    if (q.length === 0 || q === destination?.label.toLowerCase()) {
      for (const f of favorites) {
        items.push({ id: `f${f.id}`, label: f.label, detail: f.address ?? "", lngLat: [f.lng, f.lat], icon: f.kind === "home" ? "home" : f.kind === "work" ? "work" : "star" });
      }
      for (const h of history.slice(0, 5)) {
        items.push({ id: `h${h.id}`, label: h.label, detail: "", lngLat: [h.lng, h.lat], icon: "clock" });
      }
    } else {
      for (const f of favorites.filter((f) => f.label.toLowerCase().includes(q))) {
        items.push({ id: `f${f.id}`, label: f.label, detail: f.address ?? "", lngLat: [f.lng, f.lat], icon: "star" });
      }
      for (const c of matchCities(query)) {
        items.push({ id: `c${c.name}`, label: c.name, detail: t("app.region"), lngLat: c.lngLat, icon: "city" });
      }
      for (const p of results) items.push({ id: p.id, label: p.label, detail: p.detail, lngLat: p.lngLat, icon: "pin" });
    }
  }

  const choose = (item: Item) => {
    setOpen(false);
    setQuery(item.label);
    inputRef.current?.blur();
    if (target === "origin") {
      setState({ origin: { label: item.label, lngLat: item.lngLat } });
      void computeRoutes();
    } else {
      void computeRoutes({ label: item.label, lngLat: item.lngLat });
    }
  };

  const onKeyDown = async (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
    else if (e.key === "Escape") { setOpen(false); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && items[active]) return choose(items[active]);
      if (items[0]) return choose(items[0]);
      if (query.trim().length >= 3) {
        setStatus("loading");
        try {
          const r = await searchNominatim(query.trim());
          setResults(r);
          setStatus(r.length ? "idle" : "empty");
        } catch {
          setStatus("error");
        }
      }
    }
  };

  const icon = (i: Item["icon"]) =>
    i === "home" ? <IconHome size={18} /> : i === "work" ? <IconBriefcase size={18} /> : i === "star" ? <IconStar size={18} />
      : i === "clock" ? <IconClock size={18} /> : <IconPin size={18} />;

  return (
    <div className="relative w-full">
      <div className="surface flex items-center gap-2 rounded-2xl px-3 shadow-[0_2px_10px_rgb(15_26_38/.16)] lg:shadow-none lg:border hairline">
        <IconSearch size={20} className="muted shrink-0" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={t(target === "origin" ? "route.originPlaceholder" : "search.placeholder")}
          placeholder={t(target === "origin" ? "route.originPlaceholder" : "search.placeholder")}
          className="h-12 w-full bg-transparent text-[17px] outline-none placeholder:text-[var(--muted)]"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          enterKeyHint="search"
          autoComplete="off"
        />
        {(query || destination) && (
          <button
            type="button"
            className="muted grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-[var(--surface-2)]"
            aria-label={t("search.clear")}
            onClick={() => {
              setQuery("");
              setResults([]);
              if (target === "origin") { setState({ origin: null }); void computeRoutes(); }
              else clearRoutes();
              inputRef.current?.focus();
            }}
          >
            <IconClose size={18} />
          </button>
        )}
      </div>

      {open && (
        <div id={listId} role="listbox" className="surface absolute inset-x-0 top-[calc(100%+6px)] z-30 max-h-[60vh] overflow-auto rounded-2xl border hairline py-1 shadow-xl">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setOpen(false); inputRef.current?.blur(); startPick(target); }}
            className="accent flex w-full items-center gap-3 border-b hairline px-4 py-3 text-start font-bold hover:bg-[var(--surface-2)]"
          >
            <IconPin size={18} />
            {t(target === "origin" ? "pick.origin" : "pick.destination")}
          </button>
          {items.map((item, i) => (
            <button
              key={item.id}
              role="option"
              aria-selected={i === active}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(item)}
              className={`flex w-full items-start gap-3 px-4 py-2.5 text-start ${i === active ? "bg-accent-soft" : "hover:bg-[var(--surface-2)]"}`}
            >
              <span className="accent mt-0.5">{icon(item.icon)}</span>
              <span className="min-w-0">
                <span className="block truncate font-bold">{item.label}</span>
                {item.detail && <span className="muted block truncate text-sm">{item.detail}</span>}
              </span>
            </button>
          ))}
          {status === "loading" && <p className="muted px-4 py-3 text-sm">{t("search.searching")}</p>}
          {status === "empty" && items.length === 0 && <p className="muted px-4 py-3 text-sm">{t("search.noResult")}</p>}
          {status === "error" && <p className="px-4 py-3 text-sm text-[var(--color-alerte)]">{t("search.error")}</p>}
          {q.length === 0 && items.length === 0 && <p className="muted px-4 py-3 text-sm">{t("search.hint")}</p>}
          <p className="muted border-t hairline px-4 pt-2 pb-1 text-[11px]">Recherche © Photon / OpenStreetMap</p>
        </div>
      )}
    </div>
  );
}
