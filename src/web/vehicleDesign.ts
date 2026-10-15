import { dragCoefficient } from "../sim/aero.ts";
import { atmosphereAt } from "../sim/atmosphere.ts";
import { assembleVehicle, checkVehicle, designQuote, figures, fitControl, maxEngines, specOf, type VehicleSpec } from "../sim/builder.ts";
import { BENDING_LIMIT, CONTROL_RANGES, controlDesignOf, defaultControl, designPoint, DIVERGENCE_LIMIT, IMU, type ControlDesign, type ControlModel } from "../sim/control.ts";
import type { Company } from "../sim/company.ts";
import { vehicleCost } from "../sim/cost.ts";
import type { Engine } from "../sim/engine.ts";
import { defaultFins, defaultGeometry, GEOMETRY_RANGES, type FinSet, type VehicleGeometry } from "../sim/geometry.ts";
import { UNGUIDED_MARGIN } from "../sim/stability.ts";
import type { Vehicle } from "../sim/vehicle.ts";
import { landingMargin, type LandingMargin } from "../sim/landing.ts";
import { defaultRecovery, RECOVERY_RANGES, recoveryMass, type RecoveryDesign } from "../sim/recovery.ts";
import { LEO_300 } from "../missions.ts";

/**
 * The vehicle Design screen's working: the parts of a stack, their
 * parameters, what a draft spec comes to, and the curves the sliders run
 * along. Every figure comes from the sim's builder and its models.
 */

export type VPart = { id: string; tag: string; name: string };

/** The stack's parts: the fairing, each stage, the fins, the payload. */
export function vehicleParts(spec: VehicleSpec): VPart[] {
  return [
    { id: "fairing", tag: "FRG-1", name: "FAIRING" },
    ...spec.stages
      .map((_, i) => ({ id: `stage-${i}`, tag: `S${i + 1}`, name: ["BOOSTER", "UPPER", "KICK"][i] ?? `STAGE ${i + 1}` }))
      .reverse(),
    { id: "fins", tag: "FIN-1", name: "FINS" },
    { id: "gnc", tag: "GNC-1", name: "GUIDANCE & CONTROL" },
    ...(spec.stages.length > 1 ? [{ id: "rec", tag: "REC-1", name: "BOOSTER RECOVERY" }] : []),
    { id: "payload", tag: "PL-1", name: "PAYLOAD" },
  ];
}

/** Systems on the vehicle the design office doesn't draw yet. */
export const SYSTEMS: Array<[string, string, string]> = [
  ["TLM-1", "TELEMETRY", "NOT MODELLED"],
  ["TCS-1", "THERMAL CONTROL", "NOT MODELLED"],
  ["FTS-1", "FLIGHT TERMINATION", "NOT MODELLED"],
];

export type VParam = { key: string; sym: string; name: string; unit: string; min: number; max: number; step: number; dec: number; info: string; scale?: number };

/** A part's continuous parameters. */
export function vehicleParams(part: string, spec: VehicleSpec): VParam[] {
  const r = GEOMETRY_RANGES;
  if (part === "fairing")
    return [
      { key: "fairingDiameter", sym: "D", name: "FAIRING DIAMETER", unit: "m", min: r.diameter[0], max: r.diameter[1], step: 0.05, dec: 2, info: "Wider than the stack: room for payload, buffet on the shoulder." },
      { key: "fineness", sym: "L/D", name: "NOSE FINENESS", unit: ":1", min: r.fineness[0], max: r.fineness[1], step: 0.05, dec: 2, info: "Longer nose: less wave drag, more fairing mass." },
      { key: "jettison", sym: "H", name: "JETTISON ALTITUDE", unit: "km", min: r.jettison[0] / 1000, max: r.jettison[1] / 1000, step: 1, dec: 0, scale: 1000, info: "Drop it early to save mass; too early heats the payload." },
    ];
  if (part.startsWith("stage-")) {
    const i = Number(part.slice(6));
    return [
      { key: `d${i}`, sym: "D", name: "STAGE DIAMETER", unit: "m", min: r.diameter[0], max: r.diameter[1], step: 0.05, dec: 2, info: "Wider: more propellant per metre, more drag and tooling." },
      { key: `l${i}`, sym: "L", name: "TANK LENGTH", unit: "m", min: r.tankLength[0], max: r.tankLength[1], step: 0.1, dec: 1, info: "Longer tanks: more Δv, heavier stack, lower thrust to weight." },
      { key: `p${i}`, sym: "PU", name: "ULLAGE PRESSURE", unit: "bar", min: r.ullage[0], max: r.ullage[1], step: 0.1, dec: 1, info: "Pressure stiffens the shell against bending; walls get heavier." },
      { key: `sf${i}`, sym: "SF", name: "SAFETY FACTOR", unit: "", min: r.safetyFactor[0], max: r.safetyFactor[1], step: 0.05, dec: 2, info: "Thicker walls: more mass, more margin over a weak shell." },
    ];
  }
  if (part === "fins") {
    const d = spec.stages[0]!.diameter;
    return [
      { key: "span", sym: "S", name: "FIN SPAN", unit: "m", min: 0, max: Math.round(1.5 * d * 100) / 100, step: 0.01, dec: 2, info: "Bigger fins pull the centre of pressure aft: drag and mass." },
      { key: "chord", sym: "CR", name: "ROOT CHORD", unit: "m", min: 0.1, max: Math.round(2 * d * 100) / 100, step: 0.01, dec: 2, info: "Longer root: more fin area, less span needed." },
      { key: "sweep", sym: "Λ", name: "LEADING-EDGE SWEEP", unit: "°", min: 0, max: 60, step: 1, dec: 0, info: "Sweep moves the fin's pressure aft and eases transonic drag." },
    ];
  }
  if (part === "gnc") {
    const r = CONTROL_RANGES;
    return [
      { key: "g:bw", sym: "ωc", name: "LOOP BANDWIDTH", unit: "Hz", min: r.bandwidth[0], max: r.bandwidth[1], step: 0.1, dec: 1, info: "A faster loop catches an unstable airframe sooner, and comes nearer the bending mode." },
      { key: "g:gimbal", sym: "δ", name: "GIMBAL RANGE", unit: "°", min: r.gimbal[0], max: r.gimbal[1], step: 0.5, dec: 1, info: "How far the engines swing either way: authority against the air's moment, and actuator mass." },
      { key: "g:rate", sym: "δ̇", name: "ACTUATOR RATE", unit: "°/s", min: r.actuatorRate[0], max: r.actuatorRate[1], step: 1, dec: 0, info: "How fast the actuators slew. Too slow and they fall behind the loop in a gust." },
    ];
  }
  if (part === "rec") {
    const [lo, hi] = RECOVERY_RANGES.reserve;
    return [{ key: "r:reserve", sym: "R", name: "LANDING RESERVE", unit: "%", min: lo * 100, max: hi * 100, step: 1, dec: 0, info: "Booster propellant held back to fly home on: payload given up for a landing. Short, the booster is lost; too much, it stages low and slow." }];
  }
  return [{ key: "payload", sym: "M", name: "DESIGN PAYLOAD", unit: "kg", min: 0, max: 20_000, step: 10, dec: 0, info: "The payload the design is drawn around; contracts load their own." }];
}

/**
 * A spec always carries a geometry on this screen; one drawn before the
 * model gets the defaults, with its attitude loop sized to the airframe
 * when the engines are at hand.
 */
export function withGeometry(spec: VehicleSpec, engines?: Record<string, Engine>): VehicleSpec & { geometry: VehicleGeometry } {
  const g = spec.geometry ?? defaultGeometry(spec.stages.length);
  const stages = spec.stages.map((_, i) => g.stages[i] ?? g.stages.at(-1)!);
  const out = { ...spec, geometry: { ...g, stages } };
  if (spec.geometry || !engines) return out;
  try {
    return fitControl(out, engines) as VehicleSpec & { geometry: VehicleGeometry };
  } catch {
    return out;
  }
}

/** The control design a spec flies, explicit. */
export function controlOf(spec: VehicleSpec): ControlDesign {
  return controlDesignOf(withGeometry(spec).geometry) ?? defaultControl(spec.stages.length);
}

/** Change the control design. */
export function withControl(spec: VehicleSpec, change: Partial<ControlDesign>): VehicleSpec {
  const w = withGeometry(spec);
  return { ...w, geometry: { ...w.geometry, control: { ...controlOf(w), ...change } } };
}

/** How the booster comes back, or undefined if it's expended. */
export const recoveryOf = (spec: VehicleSpec): RecoveryDesign | undefined => (spec.stages.length > 1 ? spec.geometry?.recovery : undefined);

/** Change how the booster comes back; null expends it. */
export function withRecovery(spec: VehicleSpec, change: Partial<RecoveryDesign> | null): VehicleSpec {
  const w = withGeometry(spec);
  if (change === null) {
    const { recovery: _, ...rest } = w.geometry;
    return { ...w, geometry: rest };
  }
  const now = w.geometry.recovery ?? defaultRecovery(change.mode);
  // A new mode starts from its own typical reserve.
  const reserve = change.mode && change.mode !== now.mode && change.reserve === undefined ? defaultRecovery(change.mode).reserve : now.reserve;
  return { ...w, geometry: { ...w.geometry, recovery: { ...now, reserve, ...change } } };
}

/** Read a parameter's value from a spec. */
export function readParam(spec: VehicleSpec, key: string): number {
  const g = withGeometry(spec).geometry;
  const fins = g.fins;
  if (key === "fairingDiameter") return spec.fairingDiameter;
  if (key === "fineness") return g.nose.fineness;
  if (key === "jettison") return g.jettisonAltitude / 1000;
  if (key === "payload") return spec.payloadMass;
  if (key === "span") return fins?.span ?? 0;
  if (key === "chord") return fins?.rootChord ?? 0.5;
  if (key === "sweep") return fins?.sweep ?? 35;
  if (key === "g:bw") return controlOf(spec).bandwidth;
  if (key === "g:gimbal") return controlOf(spec).gimbal;
  if (key === "g:rate") return controlOf(spec).actuatorRate;
  if (key === "r:reserve") return (recoveryOf(spec)?.reserve ?? defaultRecovery().reserve) * 100;
  const i = Number(key.replace(/^\D+/, ""));
  if (key.startsWith("d")) return spec.stages[i]!.diameter;
  if (key.startsWith("l")) return spec.stages[i]!.tankLength;
  if (key.startsWith("sf")) return g.stages[i]!.safetyFactor;
  if (key.startsWith("p")) return g.stages[i]!.ullage;
  return 0;
}

const round = (v: number, step: number) => Math.round(v / step) * step;

/** Write a parameter into a spec, keeping it buildable: an upper stage no wider than the one below, fins sized off the booster. */
export function writeParam(specIn: VehicleSpec, key: string, value: number): VehicleSpec {
  if (key === "g:bw") return withControl(specIn, { bandwidth: round(value, 0.1) });
  if (key === "g:gimbal") return withControl(specIn, { gimbal: round(value, 0.5) });
  if (key === "g:rate") return withControl(specIn, { actuatorRate: Math.round(value) });
  if (key === "r:reserve") return withRecovery(specIn, { reserve: Math.round(value) / 100 });
  const spec = withGeometry(specIn);
  const g = { ...spec.geometry, stages: spec.geometry.stages.map((s) => ({ ...s })) };
  const fins = (): FinSet => g.fins ?? { ...defaultFins(spec.stages[0]!.diameter), span: 0 };
  const stages = spec.stages.map((s) => ({ ...s }));
  if (key === "fairingDiameter") return { ...spec, fairingDiameter: round(value, 0.01) };
  if (key === "fineness") g.nose = { ...g.nose, fineness: value };
  else if (key === "jettison") g.jettisonAltitude = value * 1000;
  else if (key === "payload") return { ...spec, payloadMass: Math.max(0, Math.round(value)) };
  else if (key === "span") g.fins = { ...fins(), span: value };
  else if (key === "chord") g.fins = { ...fins(), rootChord: value, tipChord: value * 0.4 };
  else if (key === "sweep") g.fins = { ...fins(), sweep: value };
  else {
    const i = Number(key.replace(/^\D+/, ""));
    if (key.startsWith("d")) stages[i]!.diameter = round(value, 0.01);
    else if (key.startsWith("l")) stages[i]!.tankLength = round(value, 0.1);
    else if (key.startsWith("sf")) g.stages[i]!.safetyFactor = value;
    else if (key.startsWith("p")) g.stages[i]!.ullage = value;
  }
  return { ...spec, stages, geometry: g };
}

/** What a draft spec comes to. */
export type VDraft = {
  spec: VehicleSpec & { geometry: VehicleGeometry };
  vehicle: Vehicle | null;
  problems: string[];
  warnings: string[];
  changed: boolean;
  /** The base design as it stands: its own figures. */
  base: Vehicle | null;
};

export function vDraft(company: Company, specIn: VehicleSpec, base: Vehicle | null, takenNames: string[]): VDraft {
  const engines = company.campaign.engines;
  const spec = withGeometry(specIn, engines);
  const check = checkVehicle(spec, engines, takenNames);
  let vehicle: Vehicle | null = null;
  try {
    vehicle = assembleVehicle(spec, engines);
  } catch {
    vehicle = null;
  }
  const baseSpec = base ? withGeometry(specOf(base), engines) : null;
  const strip = (s: VehicleSpec) => JSON.stringify({ ...s, name: "" });
  const changed = !baseSpec || strip(baseSpec) !== strip(spec);
  return { spec, vehicle, problems: check.problems, warnings: check.warnings, changed, base };
}

export type VReadout = { key: string; label: string; value: number; dec: number; unit: string; lo: number; hi: number; delta: number | null; tag?: string };

const cd12 = (v: Vehicle) => dragCoefficient(v.dragCurve, 1.2);

/** The bottom row: what the draft does, against the base revision. */
export function vReadouts(d: VDraft, engines: Record<string, Engine>, landing: LandingMargin | null = null): VReadout[] {
  const v = d.vehicle;
  if (!v) return [];
  // Against a design drawn before the model, compare with the model at its default geometry: Δ is what the change does.
  const b = d.base && d.changed ? (d.base.geometry ? d.base : assembleVehicle(withGeometry(specOf(d.base), engines), engines)) : null;
  const f = figures(v);
  const fb = b ? figures(b) : null;
  const margin = (x: Vehicle) => (x.stages.length === 1 ? x.stability?.points[0]!.margin : x.stability?.min) ?? 0;
  const delta = (a: number, c: number | undefined) => (c === undefined ? null : a - c);
  const unguided = v.stages.length === 1;
  const lowMargin = unguided ? margin(v) < UNGUIDED_MARGIN.liftoff : false;
  return [
    { key: "dv", label: "Δv VAC", value: f.totalDeltaV, dec: 0, unit: "m/s", lo: 0, hi: 12_000, delta: delta(f.totalDeltaV, fb?.totalDeltaV) },
    { key: "tw", label: "LIFTOFF T/W", value: f.liftoffTW, dec: 2, unit: "", lo: 0.5, hi: 3, delta: delta(f.liftoffTW, fb?.liftoffTW), tag: f.liftoffTW < 1 ? "▲ NO LIFTOFF" : undefined },
    { key: "mass", label: "LIFTOFF MASS", value: f.liftoffMass / 1000, dec: 2, unit: "t", lo: 0, hi: Math.max(20, (f.liftoffMass / 1000) * 1.5), delta: delta(f.liftoffMass / 1000, fb ? fb.liftoffMass / 1000 : undefined) },
    { key: "cd", label: "CD M1.2", value: cd12(v), dec: 3, unit: "", lo: 0.2, hi: 0.9, delta: delta(cd12(v), b ? cd12(b) : undefined) },
    { key: "qa", label: "Q·α CAP", value: (v.limits.maxQAlpha ?? 0) / 1000, dec: 1, unit: "kPa·°", lo: 0, hi: Math.max(80, ((v.limits.maxQAlpha ?? 0) / 1000) * 1.25), delta: delta((v.limits.maxQAlpha ?? 0) / 1000, b ? (b.limits.maxQAlpha ?? 0) / 1000 : undefined) },
    { key: "sm", label: unguided ? "MARGIN LIFTOFF" : "STATIC MARGIN", value: margin(v), dec: 2, unit: "cal", lo: -6, hi: 3, delta: delta(margin(v), b ? margin(b) : undefined), tag: lowMargin ? "▲ UNSTABLE" : undefined },
    ...(v.control
      ? [(() => {
          const e = controlEffort(v);
          return { key: "gnc", label: "CTRL EFFORT", value: e * 100, dec: 0, unit: "%", lo: 0, hi: 120, delta: b?.control ? e * 100 - controlEffort(b) * 100 : null, tag: e > 1 ? "▲ AUTHORITY" : undefined };
        })()]
      : []),
    ...(landing
      ? [{ key: "land", label: "LANDING MARGIN", value: landing.deltaV, dec: 0, unit: "m/s", lo: -500, hi: 1_500, delta: null, tag: landing.ascent === "failure" ? "▲ ASCENT LOST" : landing.deltaV < 0 ? "▲ NO MARGIN" : undefined }]
      : []),
    { key: "cost", label: "BUILD COST", value: vehicleCost(v).cost / 1000, dec: 2, unit: "$M", lo: 0, hi: Math.max(1, (vehicleCost(v).cost / 1000) * 1.6), delta: delta(vehicleCost(v).cost / 1000, b ? vehicleCost(b).cost / 1000 : undefined) },
  ];
}

/** Share of the gimbal range the design point takes. */
export function controlEffort(v: Vehicle): number {
  const c = v.control;
  if (!c) return 0;
  const booster = v.stages[0]!;
  return c.design.gimbal > 0 ? designPoint(c).needs(booster.engine.thrustVac * booster.engineCount) / c.design.gimbal : Infinity;
}

/** The loop's margins at the design point, as shares of their limits. */
export function controlMargins(model: ControlModel) {
  const dp = designPoint(model);
  return { divergence: dp.divergence / DIVERGENCE_LIMIT, bending: (dp.bendingGain * (model.design.notch ? 0.1 : 1)) / BENDING_LIMIT, dp };
}

export type VCurve = { xs: number[]; a: { label: string; ys: number[] }; b?: { label: string; ys: number[] }; redlines: Array<{ x: number; label: string; dotted?: boolean }> };

/** A curve for a parameter: the draft swept along it through the builder. */
export function vCurve(company: Company, spec: VehicleSpec, p: VParam): VCurve | null {
  const engines = company.campaign.engines;
  const n = 36;
  const xs = Array.from({ length: n + 1 }, (_, i) => p.min + ((p.max - p.min) * i) / n);
  const built = xs.map((x) => {
    try {
      return assembleVehicle(withGeometry(writeParam(spec, p.key, x)), engines);
    } catch {
      return null;
    }
  });
  const ys = (f: (v: Vehicle) => number) => built.map((v) => (v ? f(v) : NaN));
  if (p.key.startsWith("d") || p.key.startsWith("l")) {
    return { xs, a: { label: "Δv VAC km/s", ys: ys((v) => figures(v).totalDeltaV / 1000) }, b: { label: "LIFTOFF T/W", ys: ys((v) => figures(v).liftoffTW) }, redlines: [] };
  }
  if (p.key.startsWith("p") || p.key.startsWith("sf")) {
    const i = Number(p.key.replace(/^\D+/, ""));
    return { xs, a: { label: "Q·α CAP kPa·°", ys: ys((v) => (v.limits.maxQAlpha ?? 0) / 1000) }, b: { label: `S${i + 1} DRY t ×10`, ys: ys((v) => (v.stages[i]!.dryMass / 1000) * 10) }, redlines: [] };
  }
  if (p.key === "fineness" || p.key === "fairingDiameter") {
    return { xs, a: { label: "CD M1.2", ys: ys(cd12) }, b: { label: "FAIRING kg ÷100", ys: ys((v) => (v.fairing?.mass ?? 0) / 100) }, redlines: [] };
  }
  if (p.key === "jettison") {
    // Heating at jettison along a nominal ascent: q·v with speed rising toward orbital.
    const heat = (h: number) => {
      const air = atmosphereAt(h);
      const v = 7_600 * Math.min(1, (h / 220_000) ** 0.6);
      return 0.5 * air.density * v ** 3;
    };
    // Capped so the threshold stays readable: low down the flux is in the hundreds of kW.
    const ys2 = xs.map((x) => Math.min(5_000, heat(x * 1000)));
    const cross = xs.find((x, k) => k > 0 && heat(x * 1000) < 1135);
    return {
      xs,
      a: { label: "HEATING EST W/m², TO 5k", ys: ys2 },
      redlines: [{ x: 100, label: "MIN 100 KM" }, ...(cross ? [{ x: cross, label: "1135 W/m²", dotted: true }] : [])],
    };
  }
  if (p.key === "g:bw") {
    // Both as a share of their limit: divergence falls as the loop speeds up, the bending mode's pull rises.
    const div = ys((v) => (v.control ? controlMargins(v.control).divergence * 100 : NaN));
    const bend = ys((v) => (v.control ? controlMargins(v.control).bending * 100 : NaN));
    const curve: VCurve = { xs, a: { label: "DIVERGENCE % OF LIMIT", ys: div }, b: { label: "BENDING % OF LIMIT", ys: bend }, redlines: [] };
    const r1 = crossing(curve, 90, "a");
    const r2 = crossing(curve, 100, "b");
    curve.redlines = [...(r1 !== null ? [{ x: r1, label: "DIVERGENCE" }] : []), ...(r2 !== null ? [{ x: r2, label: "BENDING", dotted: true }] : [])];
    return curve;
  }
  if (p.key === "g:gimbal") {
    const curve: VCurve = { xs, a: { label: "GIMBAL USE AT MAX-Q %", ys: ys((v) => Math.min(300, controlEffort(v) * 100)) }, redlines: [] };
    const r = crossing(curve, 100, "a");
    if (r !== null) curve.redlines = [{ x: r, label: "AUTHORITY" }];
    return curve;
  }
  if (p.key === "g:rate") {
    // The loop chasing a design gust at its own crossover: δ·ωc.
    const demand = (v: Vehicle) => {
      const c = v.control;
      if (!c) return NaN;
      const booster = v.stages[0]!;
      return (designPoint(c).needs(booster.engine.thrustVac * booster.engineCount) * 2 * Math.PI * c.design.bandwidth) / c.design.actuatorRate;
    };
    const curve: VCurve = { xs, a: { label: "RATE USE IN A GUST %", ys: ys((v) => Math.min(300, demand(v) * 100)) }, redlines: [] };
    const r = crossing(curve, 100, "a");
    if (r !== null) curve.redlines = [{ x: r, label: "RATE LIMIT" }];
    return curve;
  }
  if (p.key === "r:reserve") {
    // Each point is a whole paper flight up and home: fewer of them.
    const xr = Array.from({ length: 9 }, (_, i) => p.min + ((p.max - p.min) * i) / 8);
    const flown = xr.map((x) => {
      try {
        const v = assembleVehicle(withGeometry(writeParam(spec, p.key, x)), engines);
        return { v, m: landingMargin(v, LEO_300) };
      } catch {
        return null;
      }
    });
    // What the ascent has without the reserve: the booster's Δv with it held back.
    const toOrbit = (v: Vehicle) => {
      const r = v.geometry?.recovery;
      const s0 = v.stages[0]!;
      const held = r ? s0.propellantMass * r.reserve : 0;
      return figures({ ...v, stages: [{ ...s0, propellantMass: s0.propellantMass - held, dryMass: s0.dryMass + held }, ...v.stages.slice(1)] }).totalDeltaV / 1000;
    };
    const curve: VCurve = {
      xs: xr,
      a: { label: "LANDING MARGIN m/s ÷100", ys: flown.map((f) => (f?.m ? f.m.deltaV / 100 : NaN)) },
      b: { label: "Δv TO ORBIT km/s", ys: flown.map((f) => (f ? toOrbit(f.v) : NaN)) },
      redlines: [],
    };
    const r1 = crossing(curve, 0, "a");
    const lost = flown.findIndex((f) => f?.m?.ascent === "failure");
    curve.redlines = [...(r1 !== null ? [{ x: r1, label: "NO MARGIN" }] : []), ...(lost >= 0 ? [{ x: xr[lost]!, label: "ASCENT LOST", dotted: true }] : [])];
    return curve;
  }
  if (p.key === "span" || p.key === "chord" || p.key === "sweep") {
    return {
      xs,
      a: { label: "MARGIN LIFTOFF cal", ys: ys((v) => v.stability?.points[0]!.margin ?? NaN) },
      b: { label: "MARGIN MAX-Q cal", ys: ys((v) => v.stability?.points[1]!.margin ?? NaN) },
      redlines: spec.stages.length === 1 ? [] : [],
    };
  }
  return { xs, a: { label: "Δv VAC km/s", ys: ys((v) => figures(v).totalDeltaV / 1000) }, redlines: [] };
}

/** The x where a curve first crosses a level, for redlines on the margin curves. */
export function crossing(curve: VCurve, level: number, trace: "a" | "b" = "a"): number | null {
  const ys = (trace === "a" ? curve.a : curve.b!).ys;
  for (let i = 1; i < ys.length; i++) if ((ys[i - 1]! - level) * (ys[i]! - level) <= 0) return curve.xs[i]!;
  return null;
}

/** The engines a stage can fly, and how many fit under it. */
export function engineChoices(company: Company, diameter: number): Array<{ engine: Engine; fit: number }> {
  return Object.values(company.campaign.engines).map((engine) => ({ engine, fit: maxEngines(engine, diameter) }));
}

/** Spec rows for a part. */
export function vSpecRows(part: string, d: VDraft, landing: LandingMargin | null = null): Array<[string, string]> {
  const v = d.vehicle;
  if (!v) return [];
  const g = d.spec.geometry;
  if (part === "fairing")
    return [
      ["NOSE", `${g.nose.shape.toUpperCase()} · ${(g.nose.fineness * d.spec.fairingDiameter).toFixed(2)} m`],
      ["MASS", `${v.fairing?.mass ?? 0} kg`],
      ["JETTISON", `${Math.round(g.jettisonAltitude / 1000)} km`],
    ];
  if (part.startsWith("stage-")) {
    const i = Number(part.slice(6));
    const st = v.stages[i]!;
    const shell = v.structure?.stages[i];
    return [
      ["PROPELLANT", `${(st.propellantMass / 1000).toFixed(2)} t`],
      ["DRY MASS", `${Math.round(st.dryMass)} kg`],
      ["SHELL", shell ? shell.key.replace("@", " @ ") + " m" : "—"],
      ["ENGINES", `${st.engineCount} × ${st.engine.name}`],
    ];
  }
  if (part === "fins") {
    const f = g.fins;
    return [
      ["FINS", f && f.span > 0 ? `${f.count} × ${f.span.toFixed(2)} m span` : "NONE"],
      ["MARGIN LIFTOFF", `${v.stability?.points[0]!.margin.toFixed(2)} cal`],
      ["MARGIN MAX-Q", `${v.stability?.points[1]!.margin.toFixed(2)} cal`],
      ["MARGIN BURNOUT", `${v.stability?.points[2]!.margin.toFixed(2)} cal`],
    ];
  }
  if (part === "gnc") {
    const c = v.control;
    if (!c) return [["GUIDANCE", "NONE · FLIES ON ITS FINS"]];
    const m = controlMargins(c);
    return [
      ["LOOP", `${c.design.bandwidth.toFixed(1)} Hz · ${c.design.gimbal.toFixed(1)}° · ${c.design.actuatorRate}°/s`],
      ["AIRFRAME", m.dp.divergenceHz > 0 ? `diverges ${m.dp.divergenceHz.toFixed(2)} Hz` : "stable"],
      ["BENDING", `${m.dp.bendingHz.toFixed(2)} Hz drawn${c.design.notch ? " · notch" : ""}`],
      ["SLOSH", `${m.dp.sloshHz.map((f) => f.toFixed(1)).join(" / ")} Hz${c.design.baffles ? " · baffled" : ""}`],
      ["IMU", `${IMU[c.design.imu].label.toUpperCase()} · ${IMU[c.design.imu].drift}°/h`],
    ];
  }
  if (part === "rec") {
    const r = recoveryOf(d.spec);
    if (!r) return [["BOOSTER", "EXPENDED · FALLS IN THE SEA"]];
    const s0 = v.stages[0]!;
    // The hardware scales with the bare booster: undo it from the dry mass it's part of.
    const fins = recoveryMass({ ...r, legs: false }, 0, s0.diameter);
    const bare = (s0.dryMass - fins) / (1 + recoveryMass({ ...r, gridFins: false }, 1, 0));
    const flight = !landing
      ? "—"
      : landing.ascent === "failure"
        ? `ASCENT LOST AT STAGING · ${(landing.stagingQ / 1000).toFixed(1)} kPa`
        : landing.recovery?.outcome === "landed"
          ? `LANDS · ${Math.round(landing.propellant)} kg SPARE`
          : `SHORT ${Math.round(-landing.propellant)} kg`;
    return [
      ["MODE", r.mode === "rtls" ? "BACK TO THE PAD" : "DRONE SHIP DOWNRANGE"],
      ["RESERVE", `${Math.round(s0.propellantMass * r.reserve)} kg · ${Math.round(r.reserve * 100)}%`],
      ["HARDWARE", `${Math.round(s0.dryMass - bare)} kg${r.legs ? " · LEGS" : ""}${r.gridFins ? " · GRID FINS" : ""}`],
      ["PAPER FLIGHT", flight],
    ];
  }
  return [
    ["DESIGN PAYLOAD", `${d.spec.payloadMass} kg`],
    ["FAIRING Ø", `${d.spec.fairingDiameter.toFixed(2)} m`],
  ];
}

/** The quote for drawing the draft up, and what stops it. */
export function drawQuote(company: Company, d: VDraft, name: string) {
  const quote = designQuote({ ...d.spec, name }, Object.values(company.designs));
  const blocked = d.problems.length > 0 ? "BLOCKED · LIMITS" : !d.changed ? "NO CHANGES" : name.trim() === "" ? "NAME IT" : null;
  return { ...quote, blocked };
}

/** "Meridian" → the next free revision name: "Meridian B", "Meridian C"… */
export function nextRevisionName(company: Company, base: string): { name: string; letter: string } {
  const stem = base.replace(/ [B-Z]$/, "");
  const taken = new Set(Object.values(company.designs).map((d) => d.name));
  for (let i = 1; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!taken.has(`${stem} ${letter}`)) return { name: `${stem} ${letter}`, letter };
  }
  return { name: `${stem} Z`, letter: "Z" };
}

/** A design's revision letter from its name: "Meridian B" is B; a bare name is A. */
export const revisionOf = (name: string) => (/ ([B-Z])$/.exec(name)?.[1] ?? "A");
