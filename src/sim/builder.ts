import { SLENDER_ROCKET } from "./aero.ts";
import { G0, P_SEA_LEVEL } from "./constants.ts";
import { flowSeparates, type Engine } from "./engine.ts";
import type { PitchProgram } from "./guidance.ts";
import { idealDeltaV, stackMass, type Stage, type Vehicle } from "./vehicle.ts";

/**
 * The drawing board: a vehicle from a handful of choices. Stages are tanks
 * of a diameter and length with a cluster of one engine design under them;
 * the top stage carries a fairing. Masses follow from the choices with a
 * simple structures model, so a design's numbers come from what it is.
 */

/** Tank and fairing diameters the shop can tool for, m. */
export const DIAMETERS = [0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.4, 3.0, 4.0];

/** Stage names by position, for one-, two- and three-stage designs. */
export function stageRole(count: number, index: number): string {
  if (count === 1) return "core";
  return ["booster", "upper", "kick stage"][index] ?? `stage ${index + 1}`;
}

/** Bulk density of kerosene and liquid oxygen together, kg/m³. */
export const PROPELLANT_DENSITY = 1030;

export type StageSpec = {
  diameter: number;
  /** Length of the propellant tanks, m. */
  tankLength: number;
  engine: string;
  engineCount: number;
};

export type VehicleSpec = {
  name: string;
  /** Booster first. One stage flies straight up; two can reach orbit. */
  stages: StageSpec[];
  fairingDiameter: number;
  /** Payload the design is drawn around, kg. Contracts load their own. */
  payloadMass: number;
};

/** Thrust to weight of the engine itself: pressure-fed chambers are thick-walled. */
const ENGINE_TW = { pressureFed: 40, pumped: 70 };
/** Tank structure per kg of propellant: pressure-fed tanks hold the feed pressure. */
const TANK_FRACTION = { pressureFed: 0.28, pumped: 0.06 };

/** Pressure-fed and storable engines need tanks that hold their feed pressure. */
const pressureFed = (e: Engine) => e.parts?.cycle === "pressure-fed" || e.parts?.cycle === "storable";
const area = (d: number) => (Math.PI * d * d) / 4;

export function propellantFor(diameter: number, tankLength: number): number {
  return Math.round(area(diameter) * tankLength * PROPELLANT_DENSITY);
}

/** Engine mass, kg. */
export function engineMass(engine: Engine): number {
  if (engine.mass !== undefined) return engine.mass;
  return engine.thrustVac / (G0 * (pressureFed(engine) ? ENGINE_TW.pressureFed : ENGINE_TW.pumped));
}

export function fairingMass(diameter: number): number {
  return 10 + 20 * diameter * diameter;
}

/** How many of an engine fit under a stage of this diameter. */
export function maxEngines(engine: Engine, diameter: number): number {
  const exit = Math.sqrt((4 * engine.exitArea) / Math.PI);
  return Math.max(1, Math.floor(0.9 * (diameter / exit) ** 2));
}

/** Default gravity turn for a new two-stage design. A re-tune fits it to the mission. */
const DEFAULT_TURN: PitchProgram = { kind: "gravity-turn", kickSpeed: 60, kickAngle: 7, kickDuration: 5, upperStage: { startPitch: 25, endPitch: -15 } };

export function assembleVehicle(spec: VehicleSpec, engines: Record<string, Engine>): Vehicle {
  const two = spec.stages.length > 1;
  const stages: Stage[] = spec.stages.map((s, i) => {
    const engine = engines[s.engine];
    if (!engine) throw new Error(`No engine called ${s.engine}.`);
    const propellantMass = propellantFor(s.diameter, s.tankLength);
    const pf = pressureFed(engine);
    const top = i === spec.stages.length - 1;
    // Avionics, thrust structure, and for a lower stage the interstage above it.
    const base = two && i > 0 ? 15 + 25 * s.diameter * s.diameter : 40 + 60 * s.diameter * s.diameter;
    const dry =
      engineMass(engine) * s.engineCount +
      propellantMass * (pf ? TANK_FRACTION.pressureFed : TANK_FRACTION.pumped) +
      base +
      (top ? fairingMass(spec.fairingDiameter) : 0);
    const name = `${spec.name} ${stageRole(spec.stages.length, i)}`;
    return { name, dryMass: Math.round(dry), propellantMass, engine, engineCount: s.engineCount, diameter: s.diameter };
  });
  const widest = Math.max(...spec.stages.map((s) => s.diameter));
  return {
    name: spec.name,
    stages,
    payloadMass: spec.payloadMass,
    fairingDiameter: spec.fairingDiameter,
    dragCurve: SLENDER_ROCKET,
    pitchProgram: two ? DEFAULT_TURN : undefined,
    limits: { maxDynamicPressure: widest <= 0.8 ? 60_000 : 50_000, maxAcceleration: 8, ...(two ? { maxQAlpha: 30_000 } : {}) },
  };
}

/** The spec a vehicle would have been drawn from: "start from" an existing design. */
export function specOf(vehicle: Vehicle): VehicleSpec {
  return {
    name: vehicle.name,
    stages: vehicle.stages.map((s) => ({
      diameter: s.diameter,
      tankLength: Math.round((s.propellantMass / PROPELLANT_DENSITY / area(s.diameter)) * 10) / 10,
      engine: s.engine.name,
      engineCount: s.engineCount,
    })),
    fairingDiameter: vehicle.fairingDiameter,
    payloadMass: vehicle.payloadMass,
  };
}

export type Figures = {
  liftoffMass: number;
  /** Thrust to weight of each stage at its own ignition, vacuum thrust. */
  thrustToWeight: number[];
  /** Liftoff thrust to weight at sea level. */
  liftoffTW: number;
  deltaV: number[];
  totalDeltaV: number;
};

export function figures(vehicle: Vehicle): Figures {
  const tw = vehicle.stages.map((s, i) => (s.engine.thrustVac * s.engineCount) / (stackMass(vehicle, i) * G0));
  const booster = vehicle.stages[0]!;
  const sl = Math.max(0, booster.engine.thrustVac - P_SEA_LEVEL * booster.engine.exitArea) * booster.engineCount;
  const dv = idealDeltaV(vehicle);
  return {
    liftoffMass: stackMass(vehicle, 0),
    thrustToWeight: tw,
    liftoffTW: sl / (stackMass(vehicle, 0) * G0),
    deltaV: dv,
    totalDeltaV: dv.reduce((a, b) => a + b, 0),
  };
}

export type Check = { problems: string[]; warnings: string[] };

/** Total tank length over booster diameter beyond which a stack bends too much in flight. */
export const MAX_SLENDERNESS = 14;

/** What stops a design being drawn up, and what it should know first. */
export function checkVehicle(spec: VehicleSpec, engines: Record<string, Engine>, takenNames: string[] = []): Check {
  const problems: string[] = [];
  const warnings: string[] = [];
  const name = spec.name.trim();
  if (name.length === 0) problems.push("The design needs a name.");
  else if (takenNames.some((n) => n.toLowerCase() === name.toLowerCase())) problems.push(`There is already a design called ${name}.`);
  if (spec.stages.length < 1 || spec.stages.length > 3) problems.push("A design has one, two or three stages.");
  for (const [i, s] of spec.stages.entries()) {
    const engine = engines[s.engine];
    const role = stageRole(spec.stages.length, i);
    const label = role.charAt(0).toUpperCase() + role.slice(1);
    if (!engine) {
      problems.push(`${label}: no engine called ${s.engine}.`);
      continue;
    }
    if (!DIAMETERS.includes(s.diameter)) problems.push(`${label}: ${s.diameter} m isn't a diameter the shop tools for.`);
    if (s.tankLength < 0.5 || s.tankLength > 20) problems.push(`${label}: tanks run from 0.5 to 20 m.`);
    if (s.engineCount < 1) problems.push(`${label}: needs at least one engine.`);
    const fit = maxEngines(engine, s.diameter);
    if (s.engineCount > fit) problems.push(`${label}: only ${fit} ${engine.name} fit under a ${s.diameter} m stage.`);
    if (i === 0 && flowSeparates(engine, P_SEA_LEVEL)) problems.push(`${label}: the ${engine.name}'s bell separates at sea level. A booster needs a bell that works on the pad.`);
  }
  const [booster, upper] = spec.stages;
  for (let i = 1; i < spec.stages.length; i++) {
    if (spec.stages[i]!.diameter > spec.stages[i - 1]!.diameter) problems.push(`The ${stageRole(spec.stages.length, i)} can't be wider than the stage below it.`);
  }
  const tanks = spec.stages.reduce((sum, s) => sum + s.tankLength, 0);
  if (booster && tanks / booster.diameter > MAX_SLENDERNESS) {
    problems.push(`${tanks.toFixed(1)} m of tank on a ${booster.diameter} m booster is too slender: it would bend in the wind. Keep tank length under ${MAX_SLENDERNESS}× the diameter.`);
  }
  const top = spec.stages.at(-1);
  if (top && spec.fairingDiameter < top.diameter) problems.push("The fairing can't be narrower than the stage under it.");
  if (spec.payloadMass < 0) problems.push("Payload can't be negative.");
  if (problems.length > 0) return { problems, warnings };

  const f = figures(assembleVehicle(spec, engines));
  if (f.liftoffTW < 1) problems.push(`Liftoff thrust to weight is ${f.liftoffTW.toFixed(2)}: it won't leave the pad.`);
  else if (f.liftoffTW < 1.2) warnings.push(`Liftoff thrust to weight is only ${f.liftoffTW.toFixed(2)}: slow off the pad, heavy gravity losses.`);
  if (upper && f.thrustToWeight[1]! < 0.5) warnings.push(`Upper-stage thrust to weight is ${f.thrustToWeight[1]!.toFixed(2)}: a long, lossy burn.`);
  if (spec.fairingDiameter > Math.max(...spec.stages.map((s) => s.diameter))) {
    warnings.push("Hammerhead fairing: wider than the stack. Buffet on its shoulder near Mach 1 is likely; plan a transonic tunnel run.");
  }
  return { problems, warnings };
}

/** Drawing office and tooling: what drawing up a design costs. */
export const DESIGN_COSTS = { office: { cost: 60, days: 10 }, tank: { cost: 250, days: 20 }, bigTank: { cost: 600, days: 30 }, heavyTank: { cost: 1_200, days: 45 }, fairing: { cost: 80, days: 5 } };

/** Tanks from this diameter up need a bigger shop's tooling, m. */
const BIG_TANK = 2.4;
/** Heavy-lift tanks need a new building: the 4 m class, m. */
const HEAVY_TANK = 4.0;

export type DesignQuote = { cost: number; days: number; newTanks: number[]; newFairing: boolean };

/** Tooling the company has is whatever its existing designs were built with. */
export function designQuote(spec: VehicleSpec, existing: Vehicle[]): DesignQuote {
  const tanks = new Set(existing.flatMap((v) => v.stages.map((s) => s.diameter)));
  const fairings = new Set(existing.map((v) => v.fairingDiameter));
  const newTanks = [...new Set(spec.stages.map((s) => s.diameter))].filter((d) => !tanks.has(d));
  const newFairing = !fairings.has(spec.fairingDiameter);
  const { office, tank, bigTank, heavyTank, fairing } = DESIGN_COSTS;
  const tooling = newTanks.map((d) => (d >= HEAVY_TANK ? heavyTank : d >= BIG_TANK ? bigTank : tank));
  return {
    cost: office.cost + tooling.reduce((a, t) => a + t.cost, 0) + (newFairing ? fairing.cost : 0),
    days: office.days + tooling.reduce((a, t) => a + t.days, 0) + (newFairing ? fairing.days : 0),
    newTanks,
    newFairing,
  };
}
