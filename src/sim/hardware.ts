import { DEFAULT_RATED_LIFE, type Engine } from "./engine.ts";
import { COOLINGS, CYCLES, INJECTORS, NOZZLES, parsePartKey, partKeys, type CoolingOption, type CycleOption, type InjectorOption, type NozzleOption } from "./parts.ts";
import { hashSeed, rng } from "./random.ts";

/**
 * What an engine design really does, as opposed to what its drawings
 * claim. Rolled from the run's seed, hidden from the player, and
 * discoverable only by firing the engine.
 *
 * Every quirk here has a test that can reveal it. If a flight dies of one,
 * there was a firing that would have found it.
 */
export type EngineTruth = {
  /** Real Isp as a share of the design figure. Thrust scales with it; mass flow does not. */
  ispFactor: number;
  /** Propellant pools before ignition and lights at once, cracking the chamber. */
  hardStart: boolean;
  /** Seconds of running before combustion goes unstable, or null if it stays stable. */
  instabilityOnset: number | null;
  /** Seconds the chamber wall survives at full thrust before it burns through. */
  thermalLife: number;
  /** The engine won't restart once it has been shut down in vacuum. Left out: it restarts. */
  relightFails?: boolean;
};

export type FailureMode =
  | "hard-start"
  | "combustion-instability"
  | "burn-through"
  | "flow-separation"
  | "transonic-buffet"
  | "relight-failure";

export const FAILURE_LABELS: Record<FailureMode, string> = {
  "hard-start": "hard start",
  "combustion-instability": "combustion instability",
  "burn-through": "burn-through",
  "flow-separation": "flow separation",
  "transonic-buffet": "transonic buffet",
  "relight-failure": "relight failure",
};

/** Odds and ranges the seed draws from. Tuned so most designs have at least one surprise. */
const HARD_START_CHANCE = 0.25;
const INSTABILITY_CHANCE = 0.2;
const INSTABILITY_ONSET: [number, number] = [4, 60];
const ISP_FACTOR: [number, number] = [0.95, 1.0];
const LIFE_FACTOR: [number, number] = [0.6, 1.4];

/**
 * The hidden truth of one part in one run. Each slot rolls only the quirks
 * it owns; anything a slot doesn't own stays neutral. Fixes and refinements
 * change these, and every engine built from the part inherits the change.
 */
export type PartTruth = {
  /** Share of the design Isp this part delivers. Injector mixing, nozzle contour, film-cooling losses. */
  ispFactor: number;
  hardStart: boolean;
  instabilityOnset: number | null;
  /** Chamber life as a share of the engine's rated life. */
  lifeFactor: number;
  /** Cycle: won't restart in vacuum. */
  relightFails?: boolean;
};

export type PartTruthTable = Record<string, PartTruth>;

const NEUTRAL: PartTruth = { ispFactor: 1, hardStart: false, instabilityOnset: null, lifeFactor: 1 };

export function rollPartTruth(key: string, seed: number): PartTruth {
  const random = rng(hashSeed(`${seed}:part:${key}`));
  const between = ([lo, hi]: [number, number]) => lo + (hi - lo) * random();
  const { slot, option } = parsePartKey(key);
  switch (slot) {
    case "cycle": {
      const spec = CYCLES[option as CycleOption];
      const hardStart = random() < spec.hardStart;
      // Rolled after the hard start so existing seeds keep their hard starts.
      return { ...NEUTRAL, hardStart, relightFails: random() < spec.relightFails };
    }
    case "injector": {
      const spec = INJECTORS[option as InjectorOption];
      const ispFactor = between(spec.isp);
      const unstable = random() < spec.instability;
      const onset = between(INSTABILITY_ONSET);
      return { ...NEUTRAL, ispFactor, instabilityOnset: unstable ? onset : null };
    }
    case "cooling":
      return { ...NEUTRAL, lifeFactor: between(COOLINGS[option as CoolingOption].lifeRange) };
    case "nozzle":
      return { ...NEUTRAL, ispFactor: between(NOZZLES[option as NozzleOption].ispRange) };
  }
}

/** Roll every part these engines are built from that isn't in the table yet. */
export function rollPartTruths(engines: Iterable<Engine>, seed: number, table: PartTruthTable = {}): PartTruthTable {
  for (const engine of engines) {
    if (!engine.parts) continue;
    for (const key of Object.values(partKeys(engine.parts))) table[key] ??= rollPartTruth(key, seed);
  }
  return table;
}

/** An engine's truth is its parts' truths put together. */
export function combineTruth(engine: Engine, parts: PartTruthTable): EngineTruth {
  const keys = partKeys(engine.parts!);
  const p = (k: string) => parts[k] ?? NEUTRAL;
  const [cycle, injector, cooling, nozzle] = [p(keys.cycle), p(keys.injector), p(keys.cooling), p(keys.nozzle)];
  return {
    ispFactor: cycle.ispFactor * injector.ispFactor * cooling.ispFactor * nozzle.ispFactor,
    hardStart: cycle.hardStart,
    relightFails: cycle.relightFails ?? false,
    instabilityOnset: injector.instabilityOnset,
    thermalLife: (engine.ratedLife ?? DEFAULT_RATED_LIFE) * cooling.lifeFactor,
  };
}

/** The hidden truth for one engine design in one run. Engines built from parts take their parts' truths. */
export function rollEngineTruth(engine: Engine, seed: number): EngineTruth {
  if (engine.parts) return combineTruth(engine, rollPartTruths([engine], seed));
  const random = rng(hashSeed(`${seed}:${engine.name}`));
  const between = ([lo, hi]: [number, number]) => lo + (hi - lo) * random();
  const ispFactor = between(ISP_FACTOR);
  const hardStart = random() < HARD_START_CHANCE;
  const unstable = random() < INSTABILITY_CHANCE;
  const onset = between(INSTABILITY_ONSET);
  const thermalLife = (engine.ratedLife ?? DEFAULT_RATED_LIFE) * between(LIFE_FACTOR);
  return { ispFactor, hardStart, instabilityOnset: unstable ? onset : null, thermalLife };
}

/** A flawless engine: performs to the drawings and never fails. */
export const IDEAL_TRUTH: EngineTruth = { ispFactor: 1, hardStart: false, instabilityOnset: null, thermalLife: Infinity };

/** The engine as it really performs. Lower Isp at the same mass flow means less thrust. */
export function asBuilt(engine: Engine, truth: EngineTruth): Engine {
  return { ...engine, thrustVac: engine.thrustVac * truth.ispFactor, ispVac: engine.ispVac * truth.ispFactor };
}

/**
 * When a firing of this engine ends in failure, measured from ignition,
 * and why. Null if it would run as long as asked.
 */
export function firstFailure(truth: EngineTruth): { t: number; mode: FailureMode } | null {
  if (truth.hardStart) return { t: 0, mode: "hard-start" };
  const onset = truth.instabilityOnset ?? Infinity;
  if (onset === Infinity && truth.thermalLife === Infinity) return null;
  return onset <= truth.thermalLife
    ? { t: onset, mode: "combustion-instability" }
    : { t: truth.thermalLife, mode: "burn-through" };
}

/** Hidden truths for every engine a set of designs uses, keyed by engine name. */
export type HardwareTruth = Record<string, EngineTruth>;

export function rollTruths(engines: Iterable<Engine>, seed: number): HardwareTruth {
  const truths: HardwareTruth = {};
  for (const engine of engines) truths[engine.name] ??= rollEngineTruth(engine, seed);
  return truths;
}
