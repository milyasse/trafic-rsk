// Pictogrammes des types d'incident (identiques aux composants « Icône incident/* » de la maquette Figma).
// Uniquement des tracés SVG <path> : utilisables en SVG (interface) et en Path2D (icônes de la carte).
import type { ReportType } from "./reports";

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export interface IncidentIcon {
  color: string;
  /** Tracés dessinés au trait (stroke). */
  strokes: string[];
  /** Tracés pleins (fill), le cas échéant. */
  fills?: string[];
}

export const INCIDENT_ICONS: Record<ReportType, IncidentIcon> = {
  jam: {
    color: "#C2410C",
    strokes: ["M5 17v-5l2-5h10l2 5v5M4 17h16M6 17v2M18 17v2"],
    fills: [circle(8.5, 13.5, 1.3), circle(15.5, 13.5, 1.3)],
  },
  accident: {
    color: "#B91C1C",
    strokes: ["M12 2.5l1.8 4.6 4.7-1.6-1.9 4.5 4.6 1.9-4.6 1.9 1.9 4.5-4.7-1.6L12 21.5l-1.8-4.8-4.7 1.6 1.9-4.5-4.6-1.9 4.6-1.9-1.9-4.5 4.7 1.6z"],
  },
  road_closed: { color: "#7F1D1D", strokes: [circle(12, 12, 9), "M7 12h10"] },
  roadworks: { color: "#B45309", strokes: ["M10 3h4l4.5 16h-13L10 3z", "M3.5 21h17M8.6 9h6.8M7.4 14h9.2"] },
  breakdown: {
    color: "#6D28D9",
    strokes: ["M14.5 6.5a4 4 0 0 0 4.9 4.9L11 19.8a2.1 2.1 0 1 1-3-3l8.4-8.4a4 4 0 0 0-4.9-4.9l2.5 2.5-.4 2.1-2.1.4-2.5-2.5"],
  },
  obstacle: { color: "#A16207", strokes: ["M12 3 2 20h20L12 3z", "M12 10v4M12 17h.01"] },
  flood: {
    color: "#1D4ED8",
    strokes: ["M2 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2", "M12 3v6M9 6.5 12 9.5l3-3"],
  },
  danger: { color: "#9D174D", strokes: [circle(12, 12, 9), "M12 7v6M12 16.5h.01"] },
  police: { color: "#1E3A8A", strokes: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z", "m9 12 2 2 4-4"] },
  other: { color: "#475569", strokes: ["M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z", circle(12, 9, 2.5)] },
};
