import { INCIDENT_ICONS } from "../lib/icons";
import type { ReportType } from "../lib/reports";
import type { ManeuverIcon } from "../lib/instructions";

type P = { size?: number; className?: string };
const base = (size = 22) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
});

export const IconSearch = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const IconClose = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconLocate = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
);
export const IconLayers = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></svg>
);
export const IconAlert = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
);
export const IconUser = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
);
export const IconList = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
);
export const IconRoute = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5" /></svg>
);
export const IconVolume = ({ size, className, off }: P & { off?: boolean }) => (
  <svg {...base(size)} className={className}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    {off ? <path d="m17 9 5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
  </svg>
);
export const IconStar = ({ size, className, filled }: P & { filled?: boolean }) => (
  <svg {...base(size)} className={className} fill={filled ? "currentColor" : "none"}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z" /></svg>
);
export const IconHome = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /></svg>
);
export const IconBriefcase = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5h6v2" /></svg>
);
export const IconClock = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconChevron = ({ size, className, up }: P & { up?: boolean }) => (
  <svg {...base(size)} className={className}><path d={up ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
);
export const IconSide = ({ size, className, dir }: P & { dir: "prev" | "next" }) => (
  <svg {...base(size)} className={`rtl:-scale-x-100 ${className ?? ""}`}><path d={dir === "prev" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} /></svg>
);
export const IconPin = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>
);

/** Flèches de manœuvre, dessinées pour être lisibles d'un coup d'œil. */
export function ManeuverArrow({ icon, size = 56 }: { icon: ManeuverIcon; size?: number }) {
  const s = { width: size, height: size, viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (icon) {
    case "left": return <svg {...s}><path d="M32 42V22a6 6 0 0 0-6-6H10" /><path d="m17 8-8 8 8 8" /></svg>;
    case "right": return <svg {...s}><path d="M16 42V22a6 6 0 0 1 6-6h16" /><path d="m31 8 8 8-8 8" /></svg>;
    case "slight-left": return <svg {...s}><path d="M30 42V28L16 12" /><path d="M14 22V10h12" /></svg>;
    case "slight-right": return <svg {...s}><path d="M18 42V28l14-16" /><path d="M34 22V10H22" /></svg>;
    case "sharp-left": return <svg {...s}><path d="M32 8v20L12 40" /><path d="M10 28v13h13" /></svg>;
    case "sharp-right": return <svg {...s}><path d="M16 8v20l20 12" /><path d="M38 28v13H25" /></svg>;
    case "uturn": return <svg {...s}><path d="M32 42V18a8 8 0 0 0-16 0v12" /><path d="m9 23 7 8 7-8" /></svg>;
    case "roundabout": return <svg {...s}><circle cx="24" cy="20" r="8" /><path d="M24 28v14" /><path d="M30 14l6-6M29 8h7v7" /></svg>;
    case "arrive": return <svg {...s}><path d="M24 44s12-10 12-21a12 12 0 0 0-24 0c0 11 12 21 12 21z" /><circle cx="24" cy="23" r="4" /></svg>;
    case "depart":
    case "straight":
    default: return <svg {...s}><path d="M24 42V8" /><path d="m14 18 10-10 10 10" /></svg>;
  }
}

/** Pictogramme d'un type d'incident (tracés partagés avec la carte et la maquette Figma). */
export function IncidentIcon({ type, size = 24, color }: { type: ReportType; size?: number; color?: string }) {
  const ic = INCIDENT_ICONS[type];
  const c = color ?? ic.color;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {ic.strokes.map((d, i) => <path key={i} d={d} stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />)}
      {ic.fills?.map((d, i) => <path key={`f${i}`} d={d} fill={c} />)}
    </svg>
  );
}

/** Pastille ronde (fond blanc, anneau coloré) contenant le pictogramme. */
export function IncidentBadge({ type, size = 40 }: { type: ReportType; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-white"
      style={{ width: size, height: size, border: `3px solid ${INCIDENT_ICONS[type].color}` }}
      aria-hidden
    >
      <IncidentIcon type={type} size={Math.round(size * 0.55)} />
    </span>
  );
}
