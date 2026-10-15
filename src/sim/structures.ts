import { G0 } from "./constants.ts";
import { hashSeed, rng } from "./random.ts";
import type { Vehicle } from "./vehicle.ts";
import { layout, MATERIALS, type StageGeometry, type StageShape, type VehicleGeometry } from "./geometry.ts";
import { forceComponents, type StabilityInput } from "./stability.ts";

/**
 * The stage as a pressure vessel. Wall thickness from hoop stress at the
 * design pressure (ullage plus the propellant head under load) times the
 * safety factor, down to a minimum gauge. Tank mass from that shell, with
 * stiffeners, insulation and feed lines on top. What the stack can carry:
 * the shell's buckling line load (classical thin-cylinder buckling with the
 * NASA SP-8007 knock-down, plus the tension internal pressure adds) against
 * the bending moment the air's normal force makes and the axial load of the
 * mass above.
 *
 * The real knock-down of a material at a diameter is a hidden truth: a test
 * article on the proof stand shows it.
 */

const PROPELLANT_DENSITY = 1030;
/** Axial load the propellant head is sized for, g. */
const HEAD_LOAD = 3;
/** Stiffeners, frames, insulation and baffles on top of the bare shell. */
const SECONDARY = 2.2;
/** Feed lines, fittings and residuals, per kg of propellant. */
const FITTINGS = 0.03;
/** Pressurant bottles for a pressure-fed stage, kg per bar·m³ of tank. */
const PRESSURANT = 6;
/** Load at max-q the axial term is sized for, g. */
const MAX_Q_AXIAL = 1.5;
/**
 * Allowables: the drawing's limits are the shell's capacity knocked down for
 * joints, cut-outs, dynamic amplification of gusts and buffet, and margin.
 * Calibrated so a 1.2 m aluminium stack at 3 bar carries what the hand-drawn
 * limits gave (about 30 kPa·deg of q·α).
 */
const ALLOWABLE = 0.135;
/** The q·α budget is quoted against this design gust angle to give a max-q budget, deg. */
const DESIGN_GUST = 0.6;
/** The fairing and payload are qualified to this much dynamic pressure, Pa: small fairings take more. */
const FAIRING_Q = (d: number) => (d <= 0.8 ? 60_000 : 50_000);
const MAX_G = 8;

/** The tank's design pressure, Pa: ullage (or feed pressure) plus the head under load. */
export function designPressure(geo: StageGeometry, tankLength: number, feedPressure?: number): number {
  return (feedPressure ?? geo.ullage) * 1e5 + PROPELLANT_DENSITY * G0 * HEAD_LOAD * tankLength;
}

/** Wall thickness, m. */
export function wallThickness(geo: StageGeometry, diameter: number, tankLength: number, feedPressure?: number): number {
  const m = MATERIALS[geo.material];
  return Math.max(m.minGauge, (designPressure(geo, tankLength, feedPressure) * (diameter / 2) * geo.safetyFactor) / m.stress);
}

/** Tank structure mass, kg. */
export function tankMass(geo: StageGeometry, diameter: number, tankLength: number, propellantMass: number, feedPressure?: number): number {
  const m = MATERIALS[geo.material];
  const r = diameter / 2;
  const t = wallThickness(geo, diameter, tankLength, feedPressure);
  const area = 2 * Math.PI * r * tankLength + 2 * 0.7 * 2 * Math.PI * r * r;
  const shell = area * t * m.density * SECONDARY;
  const pressurant = feedPressure ? PRESSURANT * feedPressure * (propellantMass / PROPELLANT_DENSITY) : 0;
  return shell + FITTINGS * propellantMass + pressurant;
}

/** Compressive line load the shell takes before it buckles, N/m: knocked-down classical buckling plus pressure stabilisation. */
export function bucklingLineLoad(geo: StageGeometry, diameter: number, t: number, knockdown = 1): number {
  const m = MATERIALS[geo.material];
  const r = diameter / 2;
  const phi = Math.sqrt(r / t) / 16;
  const gamma = 1 - 0.901 * (1 - Math.exp(-phi));
  // The real shell carries a share of its drawing: imperfections, welds and workmanship knock the whole of it down.
  return knockdown * (gamma * 0.605 * m.modulus * (t * t) / r + (geo.ullage * 1e5 * r) / 2);
}

export type StructureInput = StabilityInput & { feedPressures: Array<number | undefined> };

export type StructureLimits = {
  maxQAlpha: number;
  maxDynamicPressure: number;
  maxAcceleration: number;
  /** First free-free bending frequency of the stack, Hz. */
  bendingFrequency: number;
  /** Wall thickness of each stage's tanks, m. */
  walls: number[];
  /** Which stage's shell sets the q·α budget. */
  critical: number;
};

/** What the stack can carry, from each stage's shell. `knockdowns` are the real factors (1 on the drawing). */
export function structureLimits(input: StructureInput, knockdowns: number[] = input.stages.map(() => 1)): StructureLimits {
  const body = layout(input.fairingDiameter, input.stages, input.geometry);
  const R = Math.max(...body.map((s) => Math.max(s.r0, s.r1)));
  const sRef = Math.PI * R * R;
  const forces = forceComponents(input, 0.9);
  const walls: number[] = [];
  let qAlpha = Infinity;
  let critical = 0;
  let accel = MAX_G;
  input.stages.forEach((s, i) => {
    const geo = input.geometry.stages[i]!;
    const t = wallThickness(geo, s.diameter, s.tankLength, input.feedPressures[i]);
    walls.push(t);
    const r = s.diameter / 2;
    const tank = body.find((b) => b.label === `stage ${i + 1} tanks`)!;
    const above = input.payloadMass + input.fairingMass + input.stages.slice(i + 1).reduce((sum, u) => sum + u.dryMass + u.propellantMass, 0);
    const lineLoad = bucklingLineLoad(geo, s.diameter, t, knockdowns[i]);
    const axial = (above * G0 * MAX_Q_AXIAL) / (2 * Math.PI * r);
    const moment = Math.PI * r * r * Math.max(0, lineLoad - axial) * ALLOWABLE;
    // Bending at the bottom of the tank from everything ahead of it, per q·α (Pa·deg).
    const xs = tank.x + tank.length;
    const arm = forces.filter((f) => f.x < xs).reduce((sum, f) => sum + f.cnAlpha * (xs - f.x), 0);
    const perQAlpha = sRef * arm * (Math.PI / 180);
    const cap = moment / perQAlpha;
    if (cap < qAlpha) {
      qAlpha = cap;
      critical = i;
    }
    // Axial: the shell carries the stack above at its stage's burnout.
    const burnoutAbove = above + s.dryMass;
    accel = Math.min(accel, (lineLoad * 2 * Math.PI * r) / (burnoutAbove * G0));
  });

  // First bending mode of the stack as a free-free beam.
  const length = body.reduce((sum, s) => sum + s.length, 0);
  const mass = input.payloadMass + input.fairingMass + input.stages.reduce((sum, s) => sum + s.dryMass + s.propellantMass, 0);
  const ei = Math.min(
    ...input.stages.map((s, i) => MATERIALS[input.geometry.stages[i]!.material].modulus * Math.PI * (s.diameter / 2) ** 3 * walls[i]!),
  );
  const bendingFrequency = (22.37 / (2 * Math.PI * length * length)) * Math.sqrt(ei / (mass / length));

  return {
    maxQAlpha: Math.round(qAlpha),
    maxDynamicPressure: Math.round(Math.min(qAlpha / DESIGN_GUST, FAIRING_Q(input.fairingDiameter))),
    maxAcceleration: Math.round(Math.max(2, Math.min(MAX_G, accel)) * 10) / 10,
    bendingFrequency: Math.round(bendingFrequency * 100) / 100,
    walls,
    critical,
  };
}

/** Each stage's shell, stored on the vehicle: enough to recompute capacity with the real knock-down in flight. */
export type StructureModel = {
  stages: Array<{ key: string; radius: number; elastic: number; pressure: number; axial: number; perQAlpha: number }>;
  bendingFrequency: number;
};

/** The shell model of a stack, for the vehicle to carry. */
export function structureModel(input: StructureInput): StructureModel {
  const body = layout(input.fairingDiameter, input.stages, input.geometry);
  const R = Math.max(...body.map((s) => Math.max(s.r0, s.r1)));
  const sRef = Math.PI * R * R;
  const forces = forceComponents(input, 0.9);
  const stages = input.stages.map((s, i) => {
    const geo = input.geometry.stages[i]!;
    const t = wallThickness(geo, s.diameter, s.tankLength, input.feedPressures[i]);
    const r = s.diameter / 2;
    const pressure = (geo.ullage * 1e5 * r) / 2;
    const elastic = bucklingLineLoad(geo, s.diameter, t) - pressure;
    const tank = body.find((b) => b.label === `stage ${i + 1} tanks`)!;
    const above = input.payloadMass + input.fairingMass + input.stages.slice(i + 1).reduce((sum, u) => sum + u.dryMass + u.propellantMass, 0);
    const xs = tank.x + tank.length;
    const arm = forces.filter((f) => f.x < xs).reduce((sum, f) => sum + f.cnAlpha * (xs - f.x), 0);
    return { key: structureKey(geo, s.diameter), radius: r, elastic, pressure, axial: (above * G0 * MAX_Q_AXIAL) / (2 * Math.PI * r), perQAlpha: sRef * arm * (Math.PI / 180) };
  });
  return { stages, bendingFrequency: structureLimits(input).bendingFrequency };
}

/** The q·α a stage's shell really carries, Pa·deg, with its real knock-down. */
export function trueQAlpha(stage: StructureModel["stages"][number], knockdown: number): number {
  const line = knockdown * (stage.elastic + stage.pressure);
  return (Math.PI * stage.radius ** 2 * Math.max(0, line - stage.axial) * ALLOWABLE) / stage.perQAlpha;
}

/** The axial load a stage's shell really carries before it buckles, N. */
export function trueAxial(stage: StructureModel["stages"][number], knockdown: number): number {
  return knockdown * (stage.elastic + stage.pressure) * 2 * Math.PI * stage.radius;
}

/** The real knock-down of a structure against its drawing, rolled from the run's seed within its material's range. */
export function rollKnockdown(key: string, seed: number): number {
  const material = key.split("@")[0] as keyof typeof MATERIALS;
  const [lo, hi] = MATERIALS[material]?.knockdown ?? [0.85, 1.1];
  return lo + (hi - lo) * rng(hashSeed(`${seed}:struct:${key}`))();
}

/** Roll every structure a vehicle is built from that isn't in the table yet. */
export function rollStructureTruths(vehicle: Vehicle, seed: number, table: Record<string, number>): Record<string, number> {
  for (const st of vehicle.structure?.stages ?? []) table[st.key] ??= rollKnockdown(st.key, seed);
  return table;
}

/** Proof test cost ($k) and days for a stage diameter: a test article loaded to failure. */
export function proofQuote(diameter: number): { cost: number; days: number } {
  return { cost: Math.round((40 + 30 * diameter * diameter) / 5) * 5, days: Math.round(10 + 3 * diameter) };
}

/** A structural identity: the material at a diameter (to 5 cm). Stages that share it share its real knock-down. */
export function structureKey(geo: StageGeometry, diameter: number): string {
  return `${geo.material}@${(Math.round(diameter * 20) / 20).toFixed(2)}`;
}

export type { StageShape, VehicleGeometry };
