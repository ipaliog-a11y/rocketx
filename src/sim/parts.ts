import type { Engine } from "./engine.ts";
import type { FailureMode } from "./hardware.ts";

/**
 * Engines built from parts. Each hidden quirk an engine can have belongs to
 * the part that causes it: the start sequence of the feed cycle can hard
 * start, the injector can drive combustion instability, the cooling sets
 * how long the chamber wall lasts, and the nozzle sets the exit pressure
 * (and so whether the flow separates on the pad). Isp falls short through
 * the injector's mixing and the nozzle's contour.
 *
 * A part is one option built at one chamber size, so a sea-level engine and
 * its vacuum sister share cycle, injector and cooling: a firing of one
 * teaches about the other, and a flaw in one is a flaw in both.
 *
 * Every option publishes ranges. The seed rolls the truth inside them;
 * firings narrow what the company knows.
 */

export type Slot = "cycle" | "injector" | "cooling" | "nozzle";
export type ChamberSize = 3 | 9 | 25 | 35 | 50 | 100 | 250 | 600;
export type CycleOption = "pressure-fed" | "electric-pump" | "gas-generator" | "storable";
export type InjectorOption = "showerhead" | "pintle" | "coaxial";
export type CoolingOption = "ablative" | "film" | "regenerative";
export type NozzleOption = "sea-level" | "altitude" | "vacuum" | "large-vacuum";

export type EngineParts = {
  /** Chamber size: vacuum thrust with a sea-level bell, kN. */
  size: ChamberSize;
  cycle: CycleOption;
  injector: InjectorOption;
  cooling: CoolingOption;
  nozzle: NozzleOption;
};

export const SIZES: ChamberSize[] = [3, 9, 25, 35, 50, 100, 250, 600];
export const SLOTS: Slot[] = ["cycle", "injector", "cooling", "nozzle"];

type Common = {
  label: string;
  text: string;
  /** Multiplier on the engine's unit cost. */
  cost: number;
  /** One-off cost to develop this part at a chamber size, $k. */
  develop: number;
};

export const CYCLES: Record<CycleOption, Common & { isp: number; hardStart: number; relightFails: number; sizes: ChamberSize[] }> = {
  "pressure-fed": {
    label: "Pressure-fed",
    text: "Tank pressure pushes propellant in. Few moving parts and a gentle start, but heavy tanks keep chamber pressure and Isp low.",
    isp: 262,
    hardStart: 0.15,
    relightFails: 0.08,
    cost: 0.85,
    develop: 300,
    sizes: [9, 25, 35, 50],
  },
  "electric-pump": {
    label: "Electric pump",
    text: "Battery-driven pumps. Better Isp than pressure-fed and simple to start, but the batteries limit it to small engines.",
    isp: 285,
    hardStart: 0.2,
    relightFails: 0.1,
    cost: 1,
    develop: 350,
    sizes: [9, 25, 35, 100],
  },
  "gas-generator": {
    label: "Gas generator",
    text: "A small burner drives a turbopump. High chamber pressure and the best Isp here, and the most complicated start sequence.",
    isp: 300,
    hardStart: 0.3,
    relightFails: 0.3,
    cost: 1.25,
    develop: 450,
    sizes: [25, 35, 50, 100, 250, 600],
  },
  storable: {
    label: "Storable (hypergolic)",
    text: "Propellants that ignite on contact and keep for months. Lights every time, restarts after any coast; a kick-stage and deep-space engine.",
    isp: 290,
    hardStart: 0.03,
    relightFails: 0.02,
    cost: 1.1,
    develop: 300,
    sizes: [3, 9],
  },
};

export const INJECTORS: Record<InjectorOption, Common & { isp: [number, number]; instability: number }> = {
  showerhead: {
    label: "Showerhead",
    text: "Straight holes, cheap to drill. Mixes unevenly and couples easily to the chamber's acoustics.",
    isp: [0.95, 1],
    instability: 0.25,
    cost: 0.9,
    develop: 120,
  },
  pintle: {
    label: "Pintle",
    text: "A single central element. Hard to drive unstable, at the price of a little mixing efficiency.",
    isp: [0.95, 0.99],
    instability: 0.08,
    cost: 1,
    develop: 150,
  },
  coaxial: {
    label: "Coaxial swirl",
    text: "Swirl elements atomise and mix best. Many small elements, and more ways to excite an acoustic mode.",
    isp: [0.955, 1],
    instability: 0.22,
    cost: 1.15,
    develop: 200,
  },
};

export const COOLINGS: Record<CoolingOption, Common & { life: number; lifeRange: [number, number]; isp: number }> = {
  ablative: {
    label: "Ablative liner",
    text: "The liner chars away as it runs. Cheap and simple, and its life is whatever the char depth allows.",
    life: 120,
    lifeRange: [0.6, 1.4],
    isp: 1,
    cost: 0.9,
    develop: 100,
  },
  film: {
    label: "Film cooling",
    text: "A ring of fuel along the wall shields the liner. Longer life; that fuel barely burns, so about 1% Isp.",
    life: 200,
    lifeRange: [0.7, 1.4],
    isp: 0.99,
    cost: 1,
    develop: 150,
  },
  regenerative: {
    label: "Regenerative cooling",
    text: "Fuel runs through channels in the wall before it burns. Long life and a little Isp back, but costly to make.",
    life: 320,
    lifeRange: [0.8, 1.3],
    isp: 1.01,
    cost: 1.3,
    develop: 250,
  },
};

export const NOZZLES: Record<NozzleOption, Common & { exitPressure: number; isp: number; thrust: number; life: number; ispRange: [number, number] }> = {
  "sea-level": {
    label: "Sea-level bell",
    text: "Short bell, exit near ambient on the pad. Fires anywhere; gives up Isp high up.",
    exitPressure: 70_000,
    isp: 1,
    thrust: 1,
    life: 1,
    ispRange: [0.995, 1],
    cost: 1,
    develop: 80,
  },
  altitude: {
    label: "Altitude bell",
    text: "Expanded for thin air. Separates on a sea-level stand, so it needs the altitude cell.",
    exitPressure: 25_000,
    isp: 1.05,
    thrust: 1.03,
    life: 1.1,
    ispRange: [0.995, 1],
    cost: 1.05,
    develop: 100,
  },
  vacuum: {
    label: "Vacuum bell",
    text: "Long bell for an upper stage. Much more Isp in vacuum; useless on the pad.",
    exitPressure: 6_000,
    isp: 1.1,
    thrust: 1.06,
    life: 1.4,
    ispRange: [0.995, 1],
    cost: 1.1,
    develop: 120,
  },
  "large-vacuum": {
    label: "Large vacuum bell",
    text: "Huge radiatively cooled extension. The most Isp there is here, and heavy and costly.",
    exitPressure: 2_000,
    isp: 1.12,
    thrust: 1.07,
    life: 1.6,
    ispRange: [0.995, 1],
    cost: 1.25,
    develop: 160,
  },
};

/** Which part a failure mode comes from. */
export const OWNER: Partial<Record<FailureMode, Slot>> = {
  "hard-start": "cycle",
  "combustion-instability": "injector",
  "burn-through": "cooling",
  "flow-separation": "nozzle",
  "relight-failure": "cycle",
};

/** A part's identity: one option built at one chamber size. */
export function partKey(parts: EngineParts, slot: Slot): string {
  return `${slot}:${parts[slot]}:${parts.size}`;
}

export function partKeys(parts: EngineParts): Record<Slot, string> {
  return { cycle: partKey(parts, "cycle"), injector: partKey(parts, "injector"), cooling: partKey(parts, "cooling"), nozzle: partKey(parts, "nozzle") };
}

export function parsePartKey(key: string): { slot: Slot; option: string; size: ChamberSize } {
  const [slot, option, size] = key.split(":");
  return { slot: slot as Slot, option: option!, size: Number(size) as ChamberSize };
}

const SLOT_NOUN: Record<Slot, string> = { cycle: "cycle", injector: "injector", cooling: "", nozzle: "" };

export function optionSpec(slot: Slot, option: string): Common {
  const table = { cycle: CYCLES, injector: INJECTORS, cooling: COOLINGS, nozzle: NOZZLES }[slot] as Record<string, Common>;
  const spec = table[option];
  if (!spec) throw new Error(`No ${slot} option "${option}".`);
  return spec;
}

/** "Coaxial swirl injector · 25 kN" */
export function partLabel(key: string): string {
  const { slot, option, size } = parsePartKey(key);
  const noun = SLOT_NOUN[slot];
  return `${optionSpec(slot, option).label}${noun ? ` ${noun}` : ""} · ${size} kN`;
}

/** Problems with a combination, before anything is built. */
export function partsProblems(parts: EngineParts): string[] {
  const problems: string[] = [];
  if (!CYCLES[parts.cycle].sizes.includes(parts.size)) {
    problems.push(`${CYCLES[parts.cycle].label} engines come in ${CYCLES[parts.cycle].sizes.join(", ")} kN, not ${parts.size} kN.`);
  }
  return problems;
}

/** Exit area for a thrust and exit pressure: bigger bells for lower exit pressure, m². */
export function exitAreaFor(thrust: number, exitPressure: number): number {
  return 2e-6 * thrust * Math.sqrt(70_000 / exitPressure);
}

/**
 * Unit cost of one engine, $k: the base price by thrust, scaled by its
 * parts. The scale keeps a gas-generator Harrier at the price it always had;
 * pressure-fed engines come out at about half the price per kN.
 */
export function engineUnitCost(parts: EngineParts, thrust: number): number {
  const base = 100 + (6 * thrust) / 1000;
  const mult = CYCLES[parts.cycle].cost * INJECTORS[parts.injector].cost * COOLINGS[parts.cooling].cost * NOZZLES[parts.nozzle].cost;
  return Math.round(0.7 * base * mult);
}

/** Put the parts together: the engine's drawings. */
export function assembleEngine(parts: EngineParts, name: string): Engine {
  const cycle = CYCLES[parts.cycle];
  const cooling = COOLINGS[parts.cooling];
  const nozzle = NOZZLES[parts.nozzle];
  const thrustVac = Math.round(parts.size * 1000 * nozzle.thrust);
  const ispVac = Math.round(cycle.isp * cooling.isp * nozzle.isp);
  return {
    name,
    thrustVac,
    ispVac,
    exitArea: Math.round(exitAreaFor(thrustVac, nozzle.exitPressure) * 1000) / 1000,
    exitPressure: nozzle.exitPressure,
    ratedLife: Math.round(cooling.life * nozzle.life),
    parts,
    unitCost: engineUnitCost(parts, thrustVac),
  };
}

/** What the drawings promise, as ranges the player can plan with. */
export type EngineRanges = {
  /** Vacuum Isp, s: worst and best the parts allow. */
  isp: [number, number];
  hardStart: number;
  instability: number;
  /** Seconds before the chamber wall gives out: worst and best. */
  life: [number, number];
};

export function engineRanges(engine: Engine): EngineRanges | null {
  const parts = engine.parts;
  if (!parts) return null;
  const injector = INJECTORS[parts.injector];
  const nozzle = NOZZLES[parts.nozzle];
  const cooling = COOLINGS[parts.cooling];
  const rated = engine.ratedLife ?? cooling.life;
  return {
    isp: [engine.ispVac * injector.isp[0] * nozzle.ispRange[0], engine.ispVac * injector.isp[1] * nozzle.ispRange[1]],
    hardStart: CYCLES[parts.cycle].hardStart,
    instability: injector.instability,
    life: [rated * cooling.lifeRange[0], rated * cooling.lifeRange[1]],
  };
}

/** Development cost of the parts this combination needs that the company has never built, $k and days. */
export function developmentCost(parts: EngineParts, developed: Iterable<string>): { cost: number; days: number; newParts: string[] } {
  const have = new Set(developed);
  const keys = partKeys(parts);
  const newParts = SLOTS.map((s) => keys[s]).filter((k) => !have.has(k));
  // A heavy-lift chamber is a bigger programme: twice the money, and longer.
  const heavy = parts.size >= 600;
  const cost = 80 + newParts.reduce((sum, k) => sum + optionSpec(parsePartKey(k).slot, parsePartKey(k).option).develop, 0) * (heavy ? 2 : 1);
  return { cost, days: 15 + (heavy ? 18 : 10) * newParts.length, newParts };
}
