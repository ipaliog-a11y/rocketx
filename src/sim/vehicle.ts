import type { DragCurve } from "./aero.ts";
import { G0 } from "./constants.ts";
import { massFlow, type Engine } from "./engine.ts";
import type { PitchProgram } from "./guidance.ts";

export type Stage = {
  name: string;
  /** Structure, tanks and engines without propellant, kg. */
  dryMass: number;
  /** Usable propellant, kg. */
  propellantMass: number;
  engine: Engine;
  engineCount: number;
  /** Outer diameter, m. The widest stage still attached sets frontal area. */
  diameter: number;
};

export type Vehicle = {
  name: string;
  /** Bottom stage first. */
  stages: Stage[];
  payloadMass: number;
  /** Payload fairing diameter, m. A fat fairing on a skinny stack sets the area. */
  fairingDiameter: number;
  dragCurve: DragCurve;
  /** How the vehicle steers on the way up. Vertical when left out. */
  pitchProgram?: PitchProgram;
  limits: {
    /** Structural load budget for dynamic pressure, Pa. */
    maxDynamicPressure: number;
    /** Axial acceleration limit, in g. */
    maxAcceleration: number;
    /**
     * Side-load budget: dynamic pressure times angle of attack, Pa·deg.
     * Turning hard in thick air bends the stack. No limit when left out.
     */
    maxQAlpha?: number;
  };
};

/** Mass of the stack from stage `index` upward, with that stage fully fuelled. */
export function stackMass(vehicle: Vehicle, index: number): number {
  let mass = vehicle.payloadMass;
  for (let i = index; i < vehicle.stages.length; i++) {
    const stage = vehicle.stages[i]!;
    mass += stage.dryMass + stage.propellantMass;
  }
  return mass;
}

/** Ideal Δv of each stage in vacuum, m/s, from the rocket equation. */
export function idealDeltaV(vehicle: Vehicle): number[] {
  return vehicle.stages.map((stage, i) => {
    const m0 = stackMass(vehicle, i);
    const mf = m0 - stage.propellantMass;
    return stage.engine.ispVac * G0 * Math.log(m0 / mf);
  });
}

/** Burn time of a stage at full throttle, s. */
export function burnTime(stage: Stage): number {
  return stage.propellantMass / (massFlow(stage.engine) * stage.engineCount);
}
