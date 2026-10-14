// Feuille inférieure à trois hauteurs (réduite / moitié / agrandie) qu'on fait glisser du doigt.
// Sur ordinateur (≥ 1024 px), le même contenu devient un panneau latéral flottant.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from "react";
import { setState, useStore, useT, type SheetLevel } from "../store";

const LEVELS: SheetLevel[] = ["peek", "half", "full"];
const PEEK_PX = 104;

export function useIsWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.("(min-width: 1024px)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(min-width: 1024px)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/**
 * Publie la hauteur occupée en bas de l'écran (variable CSS --bottom-ui) pour que les boutons
 * flottants et le cadrage de la carte restent au-dessus de la feuille ou de la fiche affichée.
 */
export function useBottomInset(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const root = document.documentElement;
    const publish = () => {
      const wide = window.matchMedia?.("(min-width: 1024px)").matches;
      const h = wide ? 0 : Math.max(0, window.innerHeight - el.getBoundingClientRect().top);
      root.style.setProperty("--bottom-ui", `${Math.round(h)}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    el.addEventListener("transitionend", publish);
    window.addEventListener("resize", publish);
    return () => {
      ro.disconnect();
      root.style.setProperty("--bottom-ui", "0px");
      el.removeEventListener("transitionend", publish);
      window.removeEventListener("resize", publish);
    };
  }, [ref, active]);
}

/** Hauteur visible (en px) en bas de l'écran, pour le cadrage de la carte. */
export function bottomInset(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--bottom-ui");
  return Number.parseFloat(v) || 0;
}

function levelPx(level: SheetLevel): number {
  const h = window.innerHeight;
  if (level === "peek") return PEEK_PX;
  if (level === "half") return Math.round(h * 0.46);
  return h - 84;
}

const LEVEL_CSS: Record<SheetLevel, string> = {
  peek: `calc(${PEEK_PX}px + env(safe-area-inset-bottom))`,
  half: "46dvh",
  full: "calc(100dvh - 84px - env(safe-area-inset-top))",
};

export function BottomSheet({ header, children, hidden, label }: {
  header: ReactNode;
  children: ReactNode;
  hidden: boolean;
  label: string;
}) {
  const t = useT();
  const wide = useIsWide();
  const level = useStore((s) => s.sheet);
  const ref = useRef<HTMLElement>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; t: number; moved: boolean; lastY: number; lastT: number } | null>(null);
  const suppressClick = useRef(false);

  useBottomInset(ref, !wide && !hidden);

  const onPointerDown = (e: RPointerEvent) => {
    if (wide) return;
    const h = ref.current?.getBoundingClientRect().height ?? levelPx(level);
    drag.current = { y: e.clientY, h, t: e.timeStamp, moved: false, lastY: e.clientY, lastT: e.timeStamp };
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 8) return;
    if (!d.moved) {
      d.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    setDragH(Math.max(PEEK_PX - 20, Math.min(window.innerHeight - 70, d.h - dy)));
  };
  const onPointerUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    suppressClick.current = true;
    const h = d.h - (e.clientY - d.y);
    const dt = Math.max(1, e.timeStamp - d.lastT);
    const v = (e.clientY - d.lastY) / dt; // px/ms, > 0 vers le bas
    const idx = LEVELS.indexOf(level);
    let next: SheetLevel;
    // Geste rapide : niveau suivant dans le sens du geste ; sinon niveau le plus proche.
    if (v < -0.5) next = LEVELS.find((l) => levelPx(l) > h + 1) ?? "full";
    else if (v > 0.5) next = [...LEVELS].reverse().find((l) => levelPx(l) < h - 1) ?? "peek";
    else next = LEVELS.reduce((a, b) => (Math.abs(levelPx(b) - h) < Math.abs(levelPx(a) - h) ? b : a), LEVELS[idx]);
    setDragH(null);
    setState({ sheet: next });
  };

  const cycle = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setState({ sheet: level === "peek" ? "half" : "peek" });
  };

  const style = wide ? undefined : {
    height: dragH != null ? `${dragH}px` : LEVEL_CSS[level],
    transform: hidden ? "translateY(110%)" : undefined,
  };

  return (
    <aside
      ref={ref}
      aria-label={label}
      aria-hidden={hidden && !wide ? true : undefined}
      style={style}
      className={`sheet surface fixed inset-x-0 bottom-0 z-20 flex flex-col pb-[env(safe-area-inset-bottom)]
        ${dragH != null ? "" : "transition-[height,transform] duration-300 ease-out"}
        lg:inset-y-3 lg:start-3 lg:end-auto lg:h-auto lg:w-[400px]`}
    >
      <div
        className="touch-none select-none lg:touch-auto lg:select-auto"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setDragH(null); }}
        onClickCapture={(e) => { if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); suppressClick.current = false; } }}
      >
        <button
          type="button"
          className="flex h-7 w-full items-center justify-center lg:hidden"
          aria-label={level === "peek" ? t("sheet.expand") : t("sheet.collapse")}
          aria-expanded={level !== "peek"}
          onClick={cycle}
        >
          <span className="h-1.5 w-11 rounded-full bg-[var(--line)]" aria-hidden />
        </button>
        {header}
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-6 ${!wide && level === "peek" && dragH == null ? "invisible" : ""}`}>
        {children}
      </div>
    </aside>
  );
}
