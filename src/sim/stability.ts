import { finArea, layout, noseVolume, nosePlanform, type FinSet, type StageShape, type VehicleGeometry } from "./geometry.ts";

/**
 * Where the air pushes on the vehicle and where its mass sits. Normal force
 * and centre of pressure by the Barrowman method (J. Barrowman, "The
 * practical calculation of the aerodynamic characteristics of slender
 * finned vehicles", NASA, 1967), with body lift at angle of attack
 * (K = 1.1, after Galejs) and fin–body interference (1 + τ). The forms
 * follow S. Niskanen's OpenRocket technical documentation (2013), written
 * here from the published equations. Centre of mass from the mass stack as
 * propellant drains from the top of each tank.
 *
 * Static margin is the distance from the centre of mass back to the centre
 * of pressure, in body diameters (calibres). Positive is stable: a gust
 * that tips the nose makes the air push it back.
 */

const BODY_LIFT_K = 1.1;
/** Angle of attack the margin is quoted at: a typical gust, rad. */
const ALPHA = (3 * Math.PI) / 180;

export type StabilityInput = {
  fairingDiameter: number;
  stages: Array<StageShape & { dryMass: number; propellantMass: number; engineMass: number }>;
  geometry: VehicleGeometry;
  payloadMass: number;
  fairingMass: number;
};

/** One contributor to normal force: its slope (per rad, on the reference area) and where it acts (m from the nose tip). */
export type ForceComponent = { label: string; cnAlpha: number; x: number };

/** Normal-force slope of one fin set (all its fins), per rad on the reference area, and its centre of pressure. */
function finForce(f: FinSet, bodyRadius: number, sRef: number, mach: number, xRoot: number): ForceComponent {
  const area = finArea(f);
  const sweep = (f.sweep * Math.PI) / 180;
  // Mid-chord sweep from the leading-edge sweep and the taper.
  const midSweep = Math.atan(Math.tan(sweep) - (f.rootChord - f.tipChord) / (2 * f.span));
  const sub = (m: number) => {
    const beta = Math.sqrt(Math.max(0.01, 1 - m * m));
    return (2 * Math.PI * (f.span * f.span) / sRef) / (1 + Math.sqrt(1 + ((beta * f.span * f.span) / (area * Math.cos(midSweep))) ** 2));
  };
  const sup = (m: number) => (area / sRef) * (2 / Math.sqrt(m * m - 1));
  let one: number;
  if (mach <= 0.9) one = sub(mach);
  else if (mach >= 1.5) one = sup(mach);
  else {
    const t = (mach - 0.9) / 0.6;
    one = sub(0.9) + (sup(1.5) - sub(0.9)) * t;
  }
  // Three and four fins carry about N/2 of one fin's lift each way; the body between them adds (1 + τ).
  const tau = bodyRadius / (f.span + bodyRadius);
  const cn = (f.count / 2) * one * (1 + tau);
  // Centre of pressure: quarter of the mean aerodynamic chord subsonic, moving to half supersonic.
  const taper = f.tipChord / f.rootChord;
  const mac = (2 / 3) * f.rootChord * ((1 + taper + taper * taper) / (1 + taper));
  const yMac = (f.span / 3) * ((1 + 2 * taper) / (1 + taper));
  const xMacLead = yMac * Math.tan(sweep);
  const share = mach <= 0.5 ? 0.25 : mach >= 2 ? 0.5 : 0.25 + (0.25 * (mach - 0.5)) / 1.5;
  return { label: "fins", cnAlpha: cn, x: xRoot + xMacLead + share * mac };
}

/** Every normal-force contributor at a Mach number. */
export function forceComponents(input: StabilityInput, mach: number, alpha = ALPHA): ForceComponent[] {
  // (alpha only scales body lift: the linear terms are slopes.)
  const body = layout(input.fairingDiameter, input.stages, input.geometry);
  const R = Math.max(...body.map((s) => Math.max(s.r0, s.r1)));
  const sRef = Math.PI * R * R;
  const out: ForceComponent[] = [];
  let planform = 0;
  let planformMoment = 0;
  for (const s of body) {
    const a0 = Math.PI * s.r0 * s.r0;
    const a1 = Math.PI * s.r1 * s.r1;
    if (s.kind === "nose") {
      const v = noseVolume(input.geometry.nose.shape, s.r1, s.length);
      out.push({ label: "nose", cnAlpha: (2 * a1) / sRef, x: s.x + s.length - v / a1 });
      const p = nosePlanform(input.geometry.nose.shape, s.r1, s.length);
      planform += p;
      planformMoment += p * (s.x + 0.6 * s.length);
    } else {
      if (s.kind === "transition" && Math.abs(a1 - a0) > 1e-9) {
        const v = (Math.PI * s.length * (s.r0 * s.r0 + s.r0 * s.r1 + s.r1 * s.r1)) / 3;
        out.push({ label: s.label, cnAlpha: (2 * (a1 - a0)) / sRef, x: s.x + (s.length * a1 - v) / (a1 - a0) });
      }
      const p = (s.r0 + s.r1) * s.length;
      planform += p;
      planformMoment += p * (s.x + s.length / 2);
    }
  }
  // Body lift: grows with angle of attack, acts at the planform's centroid.
  out.push({ label: "body lift", cnAlpha: ((BODY_LIFT_K * planform) / sRef) * Math.sin(alpha), x: planformMoment / planform });
  const fins = input.geometry.fins;
  if (fins && fins.span > 0) {
    const tail = body.at(-1)!;
    out.push(finForce(fins, tail.r1, sRef, mach, tail.x + tail.length - fins.rootChord));
  }
  return out;
}

/** Centre of pressure and total slope from the components. */
export function centreOfPressure(components: ForceComponent[]): { cnAlpha: number; x: number } {
  const cn = components.reduce((s, c) => s + c.cnAlpha, 0);
  return { cnAlpha: cn, x: components.reduce((s, c) => s + c.cnAlpha * c.x, 0) / cn };
}

/** Centre of mass and pitch inertia with stage 1 at a share of its propellant left (upper stages full). */
export function massProperties(input: StabilityInput, boosterLeft: number): { mass: number; x: number; inertia: number } {
  const body = layout(input.fairingDiameter, input.stages, input.geometry);
  const items: Array<{ m: number; x: number; len: number }> = [];
  const nose = body[0]!;
  const bay = body[1]!;
  items.push({ m: input.payloadMass, x: bay.x + bay.length / 2, len: bay.length });
  items.push({ m: input.fairingMass, x: (nose.length + bay.length) * 0.55, len: nose.length + bay.length });
  input.stages.forEach((s, i) => {
    const tank = body.find((b) => b.label === `stage ${i + 1} tanks`)!;
    const end = tank.x + tank.length;
    const left = i === 0 ? boosterLeft : 1;
    // Engines sit at the bottom of the stage, structure along the tanks, propellant drains from the top.
    items.push({ m: s.engineMass * s.engineCount, x: end + 0.3, len: 0.6 });
    items.push({ m: s.dryMass - s.engineMass * s.engineCount, x: tank.x + tank.length / 2, len: tank.length });
    const fill = tank.length * left;
    if (left > 0) items.push({ m: s.propellantMass * left, x: end - fill / 2, len: fill });
  });
  const mass = items.reduce((s, it) => s + it.m, 0);
  const x = items.reduce((s, it) => s + it.m * it.x, 0) / mass;
  const inertia = items.reduce((s, it) => s + it.m * ((it.x - x) ** 2 + (it.len * it.len) / 12), 0);
  return { mass, x, inertia };
}

export type StabilityPoint = { label: string; mach: number; cp: number; cg: number; margin: number };
export type Stability = {
  points: StabilityPoint[];
  /** The least margin over the boost, calibres. */
  min: number;
  /** Subsonic normal-force slope, per rad on the reference area. */
  cnAlpha: number;
  referenceDiameter: number;
  length: number;
};

/** Margin an unguided rocket needs, calibres: off the rail, and through max-q where the air is thick. */
export const UNGUIDED_MARGIN = { liftoff: 1, maxQ: 0.5 };

/** Whether an unguided rocket is stable enough, and if not why: liftoff and max-q are what count; after burnout the air is thin. */
export function unguidedProblems(s: Stability): string[] {
  const [liftoff, maxQ] = s.points;
  const out: string[] = [];
  if (liftoff!.margin < UNGUIDED_MARGIN.liftoff) out.push(`Static margin ${liftoff!.margin.toFixed(2)} calibres at liftoff: an unguided rocket needs ${UNGUIDED_MARGIN.liftoff}. Add or enlarge fins.`);
  if (maxQ!.margin < UNGUIDED_MARGIN.maxQ) out.push(`Static margin ${maxQ!.margin.toFixed(2)} calibres through max-q: an unguided rocket needs ${UNGUIDED_MARGIN.maxQ} while the air is thick. Bigger fins, or move mass forward.`);
  return out;
}

/** Static margin at liftoff, around max-q and at booster burnout. */
export function stabilityOf(input: StabilityInput): Stability {
  const body = layout(input.fairingDiameter, input.stages, input.geometry);
  const d = 2 * Math.max(...body.map((s) => Math.max(s.r0, s.r1)));
  // Margin is quoted the classical way, at zero angle of attack; body lift only grows once a gust tips the nose.
  const at = (label: string, mach: number, left: number): StabilityPoint => {
    const cp = centreOfPressure(forceComponents(input, mach, 0)).x;
    const cg = massProperties(input, left).x;
    return { label, mach, cp, cg, margin: (cp - cg) / d };
  };
  const points = [at("LIFTOFF", 0.3, 1), at("MAX-Q", 1.3, 0.5), at("BURNOUT", 3, 0.02)];
  const last = body.at(-1)!;
  return {
    points,
    min: Math.min(...points.map((p) => p.margin)),
    cnAlpha: centreOfPressure(forceComponents(input, 0.5)).cnAlpha,
    referenceDiameter: d,
    length: last.x + last.length,
  };
}
