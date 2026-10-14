import { describe, expect, it } from "vitest";
import { instructionText, maneuverIcon, roadName, spokenInstruction, type Step } from "./instructions";

const step = (p: Partial<Step>): Step => ({ type: "turn", name: "", distance: 100, duration: 10, location: [-6.83, 34.01], ...p });

describe("instructions en français", () => {
  it("tourne à droite sur une avenue nommée", () => {
    expect(instructionText(step({ type: "turn", modifier: "right", name: "Avenue Hassan II" }), "fr"))
      .toBe("Tournez à droite sur Avenue Hassan II");
  });
  it("rond-point avec numéro de sortie", () => {
    expect(instructionText(step({ type: "roundabout", exit: 2, name: "" }), "fr")).toBe("Au rond-point, prenez la 2e sortie");
    expect(instructionText(step({ type: "rotary", exit: 1, name: "Route de Kénitra" }), "fr"))
      .toBe("Au rond-point, prenez la 1re sortie vers Route de Kénitra");
  });
  it("arrivée et départ", () => {
    expect(instructionText(step({ type: "arrive" }), "fr")).toBe("Vous arrivez à destination");
    expect(instructionText(step({ type: "arrive", modifier: "left" }), "fr")).toBe("La destination est sur votre gauche");
    expect(instructionText(step({ type: "depart", name: "Avenue Mohammed V" }), "fr")).toBe("Partez sur Avenue Mohammed V");
  });
  it("bretelle d'autoroute avec référence", () => {
    expect(instructionText(step({ type: "on ramp", modifier: "slight right", name: "", ref: "A1" }), "fr"))
      .toBe("Prenez la bretelle vers A1");
  });
  it("demi-tour", () => {
    expect(instructionText(step({ type: "continue", modifier: "uturn" }), "fr")).toBe("Faites demi-tour");
  });
  it("nom + référence combinés sans doublon", () => {
    expect(roadName({ name: "Autoroute Rabat-Kénitra", ref: "A1" })).toBe("Autoroute Rabat-Kénitra (A1)");
    expect(roadName({ name: "A1", ref: "A1" })).toBe("A1");
  });
  it("phrase vocale", () => {
    expect(spokenInstruction(step({ type: "turn", modifier: "left", name: "" }), "300 m", "fr")).toBe("Dans 300 m, tournez à gauche");
  });
  it("anglais disponible, arabe partiel avec repli", () => {
    expect(instructionText(step({ type: "turn", modifier: "left", name: "" }), "en")).toBe("Turn left");
    expect(instructionText(step({ type: "turn", modifier: "left", name: "" }), "ar")).toBe("انعطف يسارًا");
    expect(instructionText(step({ type: "merge", modifier: "left", name: "" }), "ar")).toBe("Insérez-vous à gauche".replace("à gauche", "يسارًا"));
  });
  it("icônes de manœuvre", () => {
    expect(maneuverIcon({ type: "turn", modifier: "sharp right" })).toBe("sharp-right");
    expect(maneuverIcon({ type: "roundabout" })).toBe("roundabout");
    expect(maneuverIcon({ type: "arrive" })).toBe("arrive");
  });
});
