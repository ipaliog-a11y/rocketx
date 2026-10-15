import { SLENDER_ROCKET } from "./aero.ts";
import { buildDragCurve } from "./aerodynamics.ts";
import { REFERENCE_PC } from "./enginePhysics.ts";
import { finArea, GEOMETRY_RANGES, MATERIALS, noseWetted, type Material, type VehicleGeometry } from "./geometry.ts";
import { BAFFLE_MASS, BENDING_LIMIT, controlDesignOf, defaultControl, controlModel, designPoint, DIVERGENCE_LIMIT, IMU } from "./control.ts";
import { stabilityOf, unguidedProblems } from "./stability.ts";
import { RECOVERY_RANGES, recoveryMass } from "./recovery.ts";
import { structureLimits, structureModel, tankMass } from "./structures.ts";
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
  /** The shape and build. Specs without one are built the old way, with the hand-drawn curve and limits. */
  geometry?: VehicleGeometry;
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

/** The feed pressure a pressure-fed stage's tanks hold, bar; undefined for a pumped engine. */
export function feedPressure(engine: Engine): number | undefined {
  if (!pressureFed(engine)) return undefined;
  return engine.design?.pd ?? REFERENCE_PC[engine.parts!.cycle] * 1.35;
}

/** Fairing shell mass for a geometry, kg: its nose and payload bay at a composite skin's areal density. */
export function geometricFairingMass(diameter: number, geometry: VehicleGeometry): number {
  const r = diameter / 2;
  const nose = noseWetted(geometry.nose.shape, r, geometry.nose.fineness * diameter);
  return Math.round(10 + 4 * (nose + Math.PI * diameter * diameter));
}

/** Fin mass, kg: aluminium plate. */
const finMass = (g: VehicleGeometry) => (g.fins && g.fins.span > 0 ? g.fins.count * finArea(g.fins) * g.fins.thickness * 2700 * 1.3 : 0);

export function assembleVehicle(spec: VehicleSpec, engines: Record<string, Engine>): Vehicle {
  if (spec.geometry) return assembleGeometric(spec, spec.geometry, engines);
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

/**
 * A vehicle from its shape and build: tanks sized as pressure vessels, the
 * drag curve built up from the shape, limits from what the shells carry,
 * and a fairing that comes off at its altitude.
 */
function assembleGeometric(spec: VehicleSpec, geometry: VehicleGeometry, engines: Record<string, Engine>): Vehicle {
  const two = spec.stages.length > 1;
  const fairing = geometricFairingMass(spec.fairingDiameter, geometry);
  const control = controlDesignOf(geometry);
  const guided = control?.guided ? control : null;
  const built = spec.stages.map((s, i) => {
    const engine = engines[s.engine];
    if (!engine) throw new Error(`No engine called ${s.engine}.`);
    const geo = geometry.stages[i] ?? geometry.stages.at(-1)!;
    const propellantMass = propellantFor(s.diameter, s.tankLength);
    // Base masses already carry a default loop's avionics and baffles: what's drawn pays or saves the difference.
    const tanks = tankMass(geo, s.diameter, s.tankLength, propellantMass, feedPressure(engine)) * (guided && !guided.baffles ? 1 - BAFFLE_MASS : 1);
    const base = two && i > 0 ? 15 + 25 * s.diameter * s.diameter : 40 + 60 * s.diameter * s.diameter;
    // A guided stage carries gimbal actuators on every engine; the top stage carries the inertial unit.
    const avionics = guided ? (actuatorMass(guided) - actuatorMass(DEFAULT_LOOP)) * s.engineCount + (i === spec.stages.length - 1 ? IMU[guided.imu].mass - IMU[DEFAULT_LOOP.imu].mass : 0) : 0;
    const bare = engineMass(engine) * s.engineCount + tanks + base + avionics + (i === 0 ? finMass(geometry) : 0);
    // A booster drawn to come back carries legs, grid fins and a heat shield on its base.
    const dry = bare + (i === 0 && two && geometry.recovery ? recoveryMass(geometry.recovery, bare, s.diameter) : 0);
    return { s, engine, propellantMass, dryMass: Math.round(dry) };
  });
  const stages: Stage[] = built.map(({ s, engine, propellantMass, dryMass }, i) => ({
    name: `${spec.name} ${stageRole(spec.stages.length, i)}`,
    dryMass,
    propellantMass,
    engine,
    engineCount: s.engineCount,
    diameter: s.diameter,
    tankLength: s.tankLength,
  }));
  const shapes = built.map(({ s, engine, propellantMass, dryMass }) => ({ diameter: s.diameter, tankLength: s.tankLength, engine, engineCount: s.engineCount, dryMass, propellantMass, engineMass: engineMass(engine) }));
  const input = { fairingDiameter: spec.fairingDiameter, stages: shapes, geometry, payloadMass: spec.payloadMass, fairingMass: fairing };
  const structure = { ...input, feedPressures: built.map((b) => feedPressure(b.engine)) };
  const limits = structureLimits(structure);
  return {
    name: spec.name,
    stages,
    payloadMass: spec.payloadMass,
    fairingDiameter: spec.fairingDiameter,
    dragCurve: buildDragCurve(input),
    pitchProgram: two ? DEFAULT_TURN : undefined,
    limits: { maxDynamicPressure: limits.maxDynamicPressure, maxAcceleration: limits.maxAcceleration, maxQAlpha: limits.maxQAlpha },
    geometry,
    fairing: { mass: fairing, jettisonAltitude: geometry.jettisonAltitude },
    stability: stabilityOf(input),
    structure: structureModel(structure),
    ...(guided ? { control: controlModel(input, guided, limits.bendingFrequency) } : {}),
  };
}

/** The attitude loop at the design point: enough gimbal, a loop faster than the airframe diverges, clear of the bending mode and slosh. */
export function controlChecks(v: Vehicle): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const model = v.control;
  if (!model) return { problems, warnings };
  const d = model.design;
  const dp = designPoint(model);
  const booster = v.stages[0]!;
  const needs = dp.needs(booster.engine.thrustVac * booster.engineCount);
  if (d.gimbal <= 0) problems.push("A guided vehicle steers by gimballing its engines: give them some range.");
  else if (needs > d.gimbal) problems.push(`Needs ${needs.toFixed(1)}° of gimbal at max-q in a design gust; the engines swing ${d.gimbal.toFixed(1)}°. More range, fins, or a less unstable shape.`);
  else if (needs > 0.7 * d.gimbal) warnings.push(`Uses ${Math.round((needs / d.gimbal) * 100)}% of the gimbal at max-q in a design gust: little left for a strong one.`);
  if (dp.divergence > DIVERGENCE_LIMIT * 0.9) problems.push(`The airframe diverges at ${dp.divergenceHz.toFixed(2)} Hz near max-q: a ${d.bandwidth.toFixed(1)} Hz loop can't catch it. Raise the bandwidth, add fins, or move mass forward.`);
  else if (dp.divergence > DIVERGENCE_LIMIT * 0.6) warnings.push(`The airframe diverges at ${Math.round(dp.divergence * 100)}% of the loop's speed near max-q: a strong gust could get ahead of it.`);
  const seen = dp.bendingGain * (d.notch ? 0.1 : 1);
  if (seen > BENDING_LIMIT) problems.push(`The loop at ${d.bandwidth.toFixed(1)} Hz is too close to the first bending mode at ${dp.bendingHz.toFixed(2)} Hz: it would couple. Slow the loop${d.notch ? "" : " or fit a notch filter"}.`);
  else if (dp.bendingGain > BENDING_LIMIT) warnings.push(`The loop relies on the notch filter to stay clear of the bending mode at ${dp.bendingHz.toFixed(2)} Hz: the notch is tuned to the drawing until a modal survey measures the real one.`);
  else if (!d.notch && dp.bendingGain > 0.1) warnings.push(`The bending mode at ${dp.bendingHz.toFixed(2)} Hz is within reach of the loop and there's no notch filter.`);
  if (!d.baffles && dp.sloshHz.some((f) => Math.abs(f / d.bandwidth - 1) < 0.4)) warnings.push(`Propellant slosh near ${dp.sloshHz.map((f) => f.toFixed(1)).join(" and ")} Hz sits close to the ${d.bandwidth.toFixed(1)} Hz loop, and the tanks have no baffles.`);
  return { problems, warnings };
}

/**
 * Size a guided spec's attitude loop to its airframe: a loop at least three
 * times faster than the airframe diverges, kept clear of the bending mode,
 * and gimbal with half again what the design point needs. Leaves the
 * rest of the control design as it is.
 */
export function fitControl(spec: VehicleSpec, engines: Record<string, Engine>): VehicleSpec {
  const control = controlDesignOf(spec.geometry);
  if (!spec.geometry || !control?.guided) return spec;
  const round = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step;
  let c = { ...control };
  for (let i = 0; i < 3; i++) {
    const v = assembleVehicle({ ...spec, geometry: { ...spec.geometry, control: c } }, engines);
    const dp = designPoint(v.control!);
    const booster = v.stages[0]!;
    const fast = round(Math.max(0.6, dp.divergenceHz / 0.3), 0.1);
    const ceiling = Math.max(0.3, Math.floor(Math.sqrt(0.2) * dp.bendingHz * 10) / 10);
    const bandwidth = Math.min(3, Math.max(fast, Math.min(c.bandwidth, ceiling)));
    const gimbal = Math.min(10, Math.max(c.gimbal, round(1.5 * dp.needs(booster.engine.thrustVac * booster.engineCount), 0.5)));
    if (bandwidth === c.bandwidth && gimbal === c.gimbal) break;
    c = { ...c, bandwidth: Math.round(bandwidth * 10) / 10, gimbal };
  }
  return { ...spec, geometry: { ...spec.geometry, control: c } };
}

const DEFAULT_LOOP = defaultControl(2);

/** Gimbal actuators for one engine, kg: bigger throws and faster slews need bigger actuators. */
export function actuatorMass(c: { gimbal: number; actuatorRate: number }): number {
  return 2 * (c.gimbal / 5) * Math.sqrt(c.actuatorRate / 15);
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
    ...(vehicle.geometry ? { geometry: vehicle.geometry } : {}),
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
    if (spec.geometry) {
      const [lo, hi] = GEOMETRY_RANGES.diameter;
      if (s.diameter < lo || s.diameter > hi) problems.push(`${label}: stages run from ${lo} to ${hi} m across.`);
      if (s.tankLength < 0.5 || s.tankLength > GEOMETRY_RANGES.tankLength[1]) problems.push(`${label}: tanks run from 0.5 to ${GEOMETRY_RANGES.tankLength[1]} m.`);
    } else {
      if (!DIAMETERS.includes(s.diameter)) problems.push(`${label}: ${s.diameter} m isn't a diameter the shop tools for.`);
      if (s.tankLength < 0.5 || s.tankLength > 20) problems.push(`${label}: tanks run from 0.5 to 20 m.`);
    }
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
  const g = spec.geometry;
  if (g) {
    if (g.jettisonAltitude < 100_000) problems.push(`Fairing jettison at ${Math.round(g.jettisonAltitude / 1000)} km: the air would still heat the payload. Jettison above 100 km.`);
    if (g.fins && booster && g.fins.span > 1.5 * booster.diameter) problems.push("Fins spanning more than 1.5 booster diameters would flutter.");
    if (g.recovery) {
      if (spec.stages.length < 2) problems.push("A single stage goes all the way: there's no booster to bring back.");
      if (!g.recovery.legs) problems.push("A booster that comes back needs legs to land on.");
      const [lo, hi] = RECOVERY_RANGES.reserve;
      if (g.recovery.reserve < lo || g.recovery.reserve > hi) problems.push(`The landing reserve runs from ${Math.round(lo * 100)}% to ${Math.round(hi * 100)}% of the booster's propellant.`);
    }
  }
  if (problems.length > 0) return { problems, warnings };

  const f = figures(assembleVehicle(spec, engines));
  if (f.liftoffTW < 1) problems.push(`Liftoff thrust to weight is ${f.liftoffTW.toFixed(2)}: it won't leave the pad.`);
  else if (f.liftoffTW < 1.2) warnings.push(`Liftoff thrust to weight is only ${f.liftoffTW.toFixed(2)}: slow off the pad, heavy gravity losses.`);
  if (upper && f.thrustToWeight[1]! < 0.5) warnings.push(`Upper-stage thrust to weight is ${f.thrustToWeight[1]!.toFixed(2)}: a long, lossy burn.`);
  if (g) {
    if (g.jettisonAltitude < 115_000) warnings.push(`Fairing jettison at ${Math.round(g.jettisonAltitude / 1000)} km: the heating on the payload is close to its limit.`);
    const v = assembleVehicle(spec, engines);
    const margin = v.stability!.min;
    if (!v.control) {
      problems.push(...unguidedProblems(v.stability!));
      if (margin < 0) warnings.push(`Unstable after burnout (${margin.toFixed(2)} calibres at Mach ${v.stability!.points[2]!.mach}): fins lose most of their bite supersonic. It coasts in thin air by then.`);
    } else {
      const r = controlChecks(v);
      problems.push(...r.problems);
      warnings.push(...r.warnings);
    }
  }
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

export type DesignQuote = { cost: number; days: number; newTanks: number[]; newFairing: boolean; newMaterials?: Material[]; newSoftware?: boolean };

/** Flight software for a new attitude-loop configuration: written once, reused by designs that share it, $k and days. */
export const FLIGHT_SOFTWARE = { cost: 60, days: 10 };
const softwareKey = (c: { bandwidth: number; imu: string; notch: boolean }) => `${c.bandwidth.toFixed(1)}/${c.imu}/${c.notch}`;

/** Tooling reaches this far either side of the diameter it was made for. */
const TOOLING_REACH = 0.03;

/** Tooling for a tank diameter: the old tiers at 1.2, 2.4 and 4 m, continuous between. */
export function toolingFor(d: number): { cost: number; days: number } {
  return { cost: Math.round((DESIGN_COSTS.tank.cost * (d / 1.2) ** 1.3) / 5) * 5, days: Math.round(DESIGN_COSTS.tank.days * (d / 1.2) ** 0.6) };
}

/** Tooling the company has is whatever its existing designs were built with; materials it has qualified, likewise. */
export function designQuote(spec: VehicleSpec, existing: Vehicle[]): DesignQuote {
  const have = (pool: number[], d: number) => pool.some((t) => Math.abs(t - d) <= TOOLING_REACH * t);
  const tanks = existing.flatMap((v) => v.stages.map((s) => s.diameter));
  const fairings = existing.map((v) => v.fairingDiameter);
  const newTanks = [...new Set(spec.stages.map((s) => s.diameter))].filter((d) => !have(tanks, d));
  const newFairing = !have(fairings, spec.fairingDiameter);
  const { office, tank, bigTank, heavyTank, fairing } = DESIGN_COSTS;
  // Legacy specs keep the old tiers; geometric ones are continuous.
  const tooling = newTanks.map((d) => (spec.geometry ? toolingFor(d) : d >= HEAVY_TANK ? heavyTank : d >= BIG_TANK ? bigTank : tank));
  const qualified = new Set<Material>(existing.flatMap((v) => v.geometry?.stages.map((s) => s.material) ?? ["al-2219" as Material]));
  const newMaterials = [...new Set(spec.geometry?.stages.map((s) => s.material) ?? [])].filter((m) => !qualified.has(m));
  const qualify = newMaterials.reduce((a, m) => a + MATERIALS[m].qualify, 0);
  const control = controlDesignOf(spec.geometry);
  const newSoftware = control?.guided ? !existing.some((v) => v.control && softwareKey(v.control.design) === softwareKey(control)) : false;
  return {
    cost: office.cost + tooling.reduce((a, t) => a + t.cost, 0) + (newFairing ? fairing.cost : 0) + qualify + (newSoftware ? FLIGHT_SOFTWARE.cost : 0),
    days: office.days + tooling.reduce((a, t) => a + t.days, 0) + (newFairing ? fairing.days : 0) + (newMaterials.length > 0 ? 15 : 0) + (newSoftware ? FLIGHT_SOFTWARE.days : 0),
    newTanks,
    newFairing,
    ...(spec.geometry ? { newMaterials, newSoftware } : {}),
  };
}
