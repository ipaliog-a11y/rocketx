import type { DragCurve } from "./aero.ts";
import { atmosphereAt } from "./atmosphere.ts";
import { bodyLength, finArea, layout, maxRadius, noseWetted, type BodySegment, type FinSet, type NoseShape, type StageShape, type VehicleGeometry } from "./geometry.ts";

/**
 * Drag from the shape: a component build-up instead of one hand-drawn curve.
 * Skin friction, nose pressure drag, the stagnation load on every forward-
 * facing step, base drag behind the tail (less where the engine bells fill
 * it), and the fins. Each term follows the semi-empirical methods collected
 * in S. Niskanen, "OpenRocket technical documentation" (2013, CC BY-SA),
 * implemented here from the published equations:
 *
 *   - turbulent and laminar flat-plate friction, roughness-limited, with
 *     compressibility corrections either side of Mach 0.9–1.1;
 *   - conical/ogive nose pressure drag from the nose half-angle (sin φ),
 *     blended through transonic, slender-body supersonic form above 1.3;
 *   - stagnation pressure 0.85·(1 + M²/4 + M⁴/40) on forward-facing steps;
 *   - base drag 0.12 + 0.13·M² subsonic, 0.25/M supersonic (Hoerner).
 *
 * Shape multipliers between nose families follow the ordering of the NASA
 * TR-R-100 measurements (von Kármán < power ½ < ogive < cone supersonic;
 * blunter noses worse transonic). They are a fit to that ordering, not the
 * tables. Reynolds number is taken along a nominal ascent (altitude against
 * Mach), which a real ascent only roughly follows. Valid to about Mach 3 in
 * the source; the curve above is an extrapolation, and the air there is too
 * thin for it to matter much.
 */

/** Altitude a typical ascent passes each Mach number at, m. */
const NOMINAL_ASCENT: Array<[number, number]> = [
  [0, 0],
  [0.5, 3_000],
  [1, 10_000],
  [1.5, 14_000],
  [2, 19_000],
  [3, 27_000],
  [5, 40_000],
  [10, 65_000],
];

const MACH_GRID = [0, 0.3, 0.6, 0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.2, 1.3, 1.5, 1.75, 2, 2.5, 3, 4, 5, 7, 10];

/** Painted metal, m: equivalent sand-grain roughness. */
const ROUGHNESS = 60e-6;
/** Raceways, fittings, gaps and antennas a real stack carries, on top of the clean body, as a share of friction plus a constant. */
const PROTUBERANCE = { friction: 1.3, cd: 0.025 };

const interp = (table: Array<[number, number]>, x: number) => {
  if (x <= table[0]![0]) return table[0]![1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]!;
    if (x <= x1) {
      const [x0, y0] = table[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table.at(-1)![1];
};

/** Dynamic viscosity of air, Pa·s (Sutherland). */
const viscosity = (t: number) => (1.458e-6 * t ** 1.5) / (t + 110.4);

/** Reynolds number over a length at a Mach number on the nominal ascent. */
export function reynolds(mach: number, length: number): number {
  // On the pad the flow is just starting: take it at Mach 0.3 so friction isn't a still-air artefact.
  const m = Math.max(0.3, mach);
  const air = atmosphereAt(interp(NOMINAL_ASCENT, m));
  if (air.density <= 0) return 1e4;
  const v = m * air.speedOfSound;
  return (air.density * v * length) / viscosity(air.temperature);
}

/** Skin-friction coefficient: laminar, turbulent or roughness-limited, compressibility-corrected. */
export function skinFriction(re: number, mach: number, length: number): number {
  let cf: number;
  if (re < 1e4) cf = 1.48e-2;
  else if (re < 5.39e5) cf = 1.328 / Math.sqrt(re);
  else cf = 1 / (1.5 * Math.log(re) - 5.6) ** 2;
  const rough = 0.032 * (ROUGHNESS / length) ** 0.2;
  // Compressibility: subsonic and supersonic forms, blended across 0.9–1.1.
  const sub = 1 - 0.1 * mach * mach;
  const sup = 1 / (1 + 0.15 * mach * mach) ** 0.58;
  const roughSub = 1 - 0.1 * mach * mach;
  const roughSup = 1 / (1 + 0.18 * mach * mach);
  const blend = (a: number, b: number) => (mach < 0.9 ? a : mach > 1.1 ? b : a + ((b - a) * (mach - 0.9)) / 0.2);
  return Math.max(cf * blend(sub, sup), rough * blend(roughSub, roughSup));
}

/** Stagnation-pressure coefficient on a blunt forward-facing face. */
export function stagnation(mach: number): number {
  const p = mach <= 1 ? 1 + mach ** 2 / 4 + mach ** 4 / 40 : 1.84 - 0.76 / mach ** 2 + 0.166 / mach ** 4 + 0.035 / mach ** 6;
  return 0.85 * p;
}

/** Base-drag coefficient behind a flat base. */
export function baseDrag(mach: number): number {
  return mach <= 1 ? 0.12 + 0.13 * mach * mach : 0.25 / mach;
}

/** How much drag each nose family carries against a cone of the same fineness: supersonic, and its transonic peak. */
const NOSE_FAMILY: Record<NoseShape, { supersonic: number; transonic: number }> = {
  cone: { supersonic: 1.0, transonic: 1.0 },
  ogive: { supersonic: 0.9, transonic: 0.95 },
  "power-half": { supersonic: 0.68, transonic: 1.2 },
  "von-karman": { supersonic: 0.6, transonic: 0.9 },
};

/** Pressure drag of a nose, referenced to its base area: from its half-angle, by family. */
export function nosePressureDrag(shape: NoseShape, fineness: number, mach: number): number {
  const sinphi = 1 / Math.sqrt(1 + (2 * fineness) ** 2);
  const fam = NOSE_FAMILY[shape];
  const sub = 0.8 * sinphi * sinphi * fam.transonic;
  const m1 = sinphi * fam.transonic;
  const sup = (m: number) => fam.supersonic * (2.1 * sinphi * sinphi + (0.5 * sinphi) / Math.sqrt(m * m - 1));
  if (mach <= 0.8) return sub;
  if (mach <= 1) {
    const t = (mach - 0.8) / 0.2;
    return sub + (m1 - sub) * t * t * (3 - 2 * t);
  }
  if (mach <= 1.3) {
    const t = (mach - 1) / 0.3;
    return m1 + (sup(1.3) - m1) * t * t * (3 - 2 * t);
  }
  return sup(mach);
}

/** Leading- and trailing-edge pressure drag of one fin section, referenced to the fin's frontal area. */
function finPressure(f: FinSet, mach: number): number {
  const le = mach < 0.9 ? (1 - mach * mach) ** -0.417 - 1 : mach < 1 ? 1 - 1.785 * (mach - 0.9) : 1.214 - 0.502 / mach ** 2 + 0.1095 / mach ** 4;
  const leading = f.section === "square" ? stagnation(mach) : le * Math.cos((f.sweep * Math.PI) / 180) ** 2;
  const trailing = f.section === "square" ? baseDrag(mach) : f.section === "rounded" ? baseDrag(mach) / 2 : 0;
  return leading + trailing;
}

export type DragInput = { fairingDiameter: number; stages: StageShape[]; geometry: VehicleGeometry };

/** Every drag term at a Mach number, referenced to the widest frontal area. */
export function dragBreakdown(input: DragInput, mach: number, body = layout(input.fairingDiameter, input.stages, input.geometry)) {
  const R = maxRadius(body);
  const sRef = Math.PI * R * R;
  const L = bodyLength(body);
  const nose = body[0]!;
  const g = input.geometry;

  // Friction over the wetted body, with the body's own form factor.
  const wetted = body.reduce((sum, s) => sum + (s.kind === "nose" ? noseWetted(g.nose.shape, s.r1, s.length) : Math.PI * (s.r0 + s.r1) * Math.hypot(s.length, s.r1 - s.r0)), 0);
  const cf = skinFriction(reynolds(mach, L), mach, L);
  const fineness = L / (2 * R);
  let friction = cf * (1 + 1 / (2 * fineness)) * (wetted / sRef);
  const fins = g.fins && g.fins.span > 0 ? g.fins : undefined;
  if (fins) {
    const mac = (fins.rootChord + fins.tipChord) / 2;
    friction += cf * (1 + (2 * fins.thickness) / mac) * ((2 * finArea(fins) * fins.count) / sRef);
  }
  friction *= PROTUBERANCE.friction;

  // Nose pressure drag over its base.
  const noseCd = nosePressureDrag(g.nose.shape, g.nose.fineness, mach) * ((Math.PI * nose.r1 * nose.r1) / sRef);

  // Steps: a widening transition is a cone of its own half-angle; a narrowing one is a boattail.
  let steps = 0;
  for (const s of body) {
    if (s.kind !== "transition") continue;
    const annulus = Math.PI * Math.abs(s.r1 * s.r1 - s.r0 * s.r0);
    if (s.r1 > s.r0) {
      const sinphi = (s.r1 - s.r0) / Math.hypot(s.length, s.r1 - s.r0);
      const conical = mach <= 1 ? 0.8 * sinphi * sinphi + (sinphi - 0.8 * sinphi * sinphi) * Math.max(0, (mach - 0.8) / 0.2) : 2.1 * sinphi * sinphi + (0.5 * sinphi) / Math.sqrt(Math.max(0.09, mach * mach - 1));
      steps += Math.min(conical, stagnation(mach)) * (annulus / sRef);
    } else {
      const f = s.length / (2 * (s.r0 - s.r1));
      const share = f >= 3 ? 0 : f <= 1 ? 1 : (3 - f) / 2;
      steps += baseDrag(mach) * share * (annulus / sRef);
    }
  }

  // Base: the tail less what the booster's bells fill.
  const tail = body.at(-1)!;
  const booster = input.stages[0]!;
  const exits = Math.min(Math.PI * tail.r1 * tail.r1, booster.engine.exitArea * booster.engineCount);
  const base = baseDrag(mach) * ((Math.PI * tail.r1 * tail.r1 - exits) / sRef);

  const finCd = fins ? finPressure(fins, mach) * ((fins.count * fins.span * fins.thickness) / sRef) : 0;
  const total = friction + noseCd + steps + base + finCd + PROTUBERANCE.cd;
  return { friction, nose: noseCd, steps, base, fins: finCd, protuberance: PROTUBERANCE.cd, total, referenceArea: sRef };
}

/** The drag curve of a shape, on a fixed Mach grid, for the ascent to interpolate. */
export function buildDragCurve(input: DragInput): DragCurve {
  const body = layout(input.fairingDiameter, input.stages, input.geometry);
  return MACH_GRID.map((m) => [m, Math.round(dragBreakdown(input, m, body).total * 10_000) / 10_000] as const);
}

export type { BodySegment };
