import { translate, hasKey, type Lang, type Key } from "../i18n";

export interface Step {
  type: string;
  modifier?: string;
  exit?: number;
  name: string;
  ref?: string;
  distance: number;
  duration: number;
  location: [number, number];
  /** Texte fourni par le fournisseur (openrouteservice), utilisé en dernier recours. */
  text?: string;
}

export type ManeuverIcon =
  | "left" | "right" | "slight-left" | "slight-right" | "sharp-left" | "sharp-right"
  | "straight" | "uturn" | "roundabout" | "arrive" | "depart";

export function roadName(step: Pick<Step, "name" | "ref">): string {
  const name = step.name?.trim() ?? "";
  const ref = step.ref?.trim() ?? "";
  if (name && ref && !name.includes(ref)) return `${name} (${ref})`;
  return name || ref;
}

function mod(lang: Lang, modifier?: string): string {
  const key = `man.mod.${modifier ?? "straight"}`;
  return hasKey(key) ? translate(lang, key) : translate(lang, "man.mod.straight");
}

function ordinal(lang: Lang, n: number): string {
  return n === 1 ? translate(lang, "man.ordinal.1") : translate(lang, "man.ordinal.n", { n });
}

function t(lang: Lang, key: Key, vars?: Record<string, string | number>) {
  return translate(lang, key, vars);
}

/** Instruction lisible pour une manœuvre normalisée (format OSRM). */
export function instructionText(step: Step, lang: Lang): string {
  const road = roadName(step);
  const m = step.modifier;
  switch (step.type) {
    case "depart":
      return road ? t(lang, "man.departOn", { road }) : t(lang, "man.continue");
    case "arrive":
      if (m === "left") return t(lang, "man.arriveSide.left");
      if (m === "right") return t(lang, "man.arriveSide.right");
      return t(lang, "man.arrive");
    case "turn":
    case "continue":
      if (m === "uturn") return t(lang, "man.uturn");
      if (step.type === "continue" && (!m || m === "straight")) {
        return road ? t(lang, "man.continueOn", { road }) : t(lang, "man.continue");
      }
      return road ? t(lang, "man.turnOn", { mod: mod(lang, m), road }) : t(lang, "man.turn", { mod: mod(lang, m) });
    case "new name":
      return road ? t(lang, "man.newName", { road }) : t(lang, "man.continue");
    case "merge":
      return road ? t(lang, "man.mergeOn", { road }) : t(lang, "man.merge", { mod: mod(lang, m) });
    case "on ramp":
      return road ? t(lang, "man.onRampOn", { road }) : t(lang, "man.onRamp", { mod: mod(lang, m) });
    case "off ramp":
      return road ? t(lang, "man.offRampOn", { road }) : t(lang, "man.offRamp", { mod: mod(lang, m) });
    case "fork":
      return road ? t(lang, "man.forkOn", { mod: mod(lang, m), road }) : t(lang, "man.fork", { mod: mod(lang, m) });
    case "end of road":
      return t(lang, "man.endOfRoad", { mod: mod(lang, m) });
    case "roundabout":
    case "rotary":
    case "roundabout turn":
      if (!step.exit) return t(lang, "man.roundaboutNoExit");
      return road
        ? t(lang, "man.roundaboutOn", { exit: ordinal(lang, step.exit), road })
        : t(lang, "man.roundabout", { exit: ordinal(lang, step.exit) });
    case "exit roundabout":
    case "exit rotary":
      return t(lang, "man.exitRoundabout");
    default:
      if (step.text) return step.text;
      return road ? t(lang, "man.continueOn", { road }) : t(lang, "man.continue");
  }
}

export function maneuverIcon(step: Pick<Step, "type" | "modifier">): ManeuverIcon {
  if (step.type === "arrive") return "arrive";
  if (step.type === "depart") return "depart";
  if (["roundabout", "rotary", "roundabout turn", "exit roundabout", "exit rotary"].includes(step.type)) return "roundabout";
  switch (step.modifier) {
    case "left": return "left";
    case "right": return "right";
    case "slight left": return "slight-left";
    case "slight right": return "slight-right";
    case "sharp left": return "sharp-left";
    case "sharp right": return "sharp-right";
    case "uturn": return "uturn";
    default: return "straight";
  }
}

/** Phrase vocale : « Dans 300 m, tournez à droite sur Avenue Hassan II ». */
export function spokenInstruction(step: Step, distanceText: string, lang: Lang): string {
  const instr = instructionText(step, lang);
  const lowered = lang === "fr" || lang === "en" ? instr.charAt(0).toLowerCase() + instr.slice(1) : instr;
  return translate(lang, "man.in", { d: distanceText, instr: lowered });
}
