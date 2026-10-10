import { G0 } from "./constants.ts";
import type { EngineParts } from "./parts.ts";

export type Engine = {
  name: string;
  /** Thrust in vacuum, N. */
  thrustVac: number;
  /** Specific impulse in vacuum, s. */
  ispVac: number;
  /** Nozzle exit area, m². Sets how much back-pressure costs at low altitude. */
  exitArea: number;
  /** Nozzle exit pressure, Pa. Low values mean a big vacuum-optimised bell. */
  exitPressure: number;
  /**
   * Burn duration the chamber was designed for, s. A design claim: the
   * real hardware may fall short, and only a long enough firing tells.
   */
  ratedLife?: number;
  /** What the engine is built from. Engines without parts keep their quirks to themselves. */
  parts?: EngineParts;
  /** Price of one engine, $k. Left out: the cost model's thrust formula. */
  unitCost?: number;
};

/** Rated life assumed when a design doesn't state one, s. */
export const DEFAULT_RATED_LIFE = 300;

/**
 * Summerfield criterion: the exhaust tends to separate from the nozzle wall
 * when exit pressure drops below roughly 40% of ambient. Separated flow is
 * asymmetric and loads the bell sideways.
 */
export const SEPARATION_RATIO = 0.4;

/** Propellant mass flow of one engine at full throttle, kg/s. */
export function massFlow(engine: Engine): number {
  return engine.thrustVac / (engine.ispVac * G0);
}

/** Thrust of one engine at a given ambient pressure, N. F = F_vac − p_a·A_e. */
export function thrustAt(engine: Engine, ambientPressure: number): number {
  return Math.max(0, engine.thrustVac - ambientPressure * engine.exitArea);
}

/** Effective specific impulse at a given ambient pressure, s. */
export function ispAt(engine: Engine, ambientPressure: number): number {
  return thrustAt(engine, ambientPressure) / (massFlow(engine) * G0);
}

/** True when the nozzle is over-expanded enough at this pressure to separate. */
export function flowSeparates(engine: Engine, ambientPressure: number): boolean {
  return engine.exitPressure < SEPARATION_RATIO * ambientPressure;
}
