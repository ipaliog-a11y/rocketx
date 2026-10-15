import { hashSeed, rng } from "./random.ts";
import { bodyLength, layout } from "./geometry.ts";
import { centreOfPressure, forceComponents, massProperties, type StabilityInput } from "./stability.ts";

/**
 * Guidance, navigation and control, kept to what a launch-company engineer
 * trades on paper: how far the engines gimbal and how fast, how quick the
 * attitude loop is (its bandwidth), whether it filters the first bending
 * mode, whether the tanks have slosh baffles, and how good the inertial
 * unit is.
 *
 * In flight the model is quasi-static: at each step the gimbal angle that
 * balances the aerodynamic moment about the centre of mass (normal force at
 * the centre of pressure, from angle of attack including the gusts) is what
 * the loop has to find, filtered to what a loop of this bandwidth follows.
 * The loop's own stability is one growth rate on an attitude oscillation:
 * damped by the loop, fed by propellant slosh near the loop's frequency,
 * by the bending mode the loop still sees through its filter, by an
 * airframe that diverges faster than the loop can catch, by actuators
 * running at their rate limit, and by any error in the flight software's
 * gain schedule. The oscillation grows or dies away; past a few degrees
 * the vehicle is lost.
 *
 * After M. Greensite, "Analysis and Design of Space Vehicle Flight Control
 * Systems" (NASA CR-820, 1967) for the rigid-body trim and the bending and
 * slosh coupling, and NASA SP-8031 ("Slosh Suppression", 1969) for baffles.
 */

export type ImuGrade = "tactical" | "navigation" | "strategic";

export type ControlDesign = {
  /** False flies unguided on its fins, as a sounding rocket. */
  guided: boolean;
  /** Gimbal range either way, degrees. */
  gimbal: number;
  /** Actuator slew rate, degrees per second. */
  actuatorRate: number;
  /** Attitude-loop crossover, Hz. */
  bandwidth: number;
  /** A notch filter at the bending mode's frequency (as drawn, or as a modal survey measured it). */
  notch: boolean;
  /** Slosh baffles in every tank. */
  baffles: boolean;
  imu: ImuGrade;
};

/** Drift (deg/h), unit cost ($k) and mass (kg) by grade. */
export const IMU: Record<ImuGrade, { label: string; drift: number; cost: number; mass: number }> = {
  tactical: { label: "Tactical (MEMS)", drift: 10, cost: 20, mass: 2 },
  navigation: { label: "Navigation (ring laser)", drift: 0.5, cost: 150, mass: 12 },
  strategic: { label: "Strategic", drift: 0.02, cost: 600, mass: 25 },
};

export const CONTROL_RANGES = {
  gimbal: [0, 10] as [number, number],
  actuatorRate: [5, 40] as [number, number],
  bandwidth: [0.3, 3] as [number, number],
};

/** Baffles add this share to tank mass. */
export const BAFFLE_MASS = 0.03;

export function defaultControl(stageCount: number): ControlDesign {
  return { guided: stageCount > 1, gimbal: 5, actuatorRate: 15, bandwidth: 1, notch: true, baffles: true, imu: "navigation" };
}

/** Whether a vehicle flies the control model, and with what design. */
export function controlDesignOf(geometry: { control?: ControlDesign; stages: unknown[] } | undefined): ControlDesign | null {
  if (!geometry) return null;
  return geometry.control ?? defaultControl(geometry.stages.length);
}

// ── The model stored on a vehicle ──────────────────────────────────────

/** Mach numbers the centre of pressure is tabulated at. */
export const CONTROL_MACHS = [0.3, 0.8, 1.1, 1.5, 2, 3, 5];
/** Burn fractions the mass properties are tabulated at: full, half, empty. */
const FRACTIONS = [0, 0.5, 1];

/** The stack from one stage up: where its mass and its aerodynamic centre sit, m from the nose tip. */
export type ControlConfig = {
  /** Centre of mass, mass (kg) and pitch inertia (kg·m²) at burn fraction 0, 0.5, 1. */
  cg: number[];
  mass: number[];
  inertia: number[];
  /** Gimbal point: the base of the stage. */
  nozzle: number;
  /** Centre of pressure and normal-force slope (per rad) at each of CONTROL_MACHS. */
  cp: number[];
  cnAlpha: number[];
  /** Reference area, m², and tank radius for slosh, m. */
  area: number;
  tankRadius: number;
};

export type ControlModel = {
  design: ControlDesign;
  configs: ControlConfig[];
  /** First bending mode of the full stack as drawn, Hz. */
  bendingFrequency: number;
};

export function controlModel(input: StabilityInput, design: ControlDesign, bendingFrequency: number): ControlModel {
  const configs = input.stages.map((stage, i): ControlConfig => {
    const geometry = { ...input.geometry, stages: input.geometry.stages.slice(i), fins: i === 0 ? input.geometry.fins : undefined };
    const sliced: StabilityInput = { ...input, stages: input.stages.slice(i), geometry };
    const props = FRACTIONS.map((f) => massProperties(sliced, 1 - f));
    const aero = CONTROL_MACHS.map((m) => centreOfPressure(forceComponents(sliced, m, 0)));
    const body = layout(sliced.fairingDiameter, sliced.stages, geometry);
    const length = bodyLength(body);
    const R = Math.max(input.fairingDiameter, ...sliced.stages.map((s) => s.diameter)) / 2;
    return {
      cg: props.map((p) => p.x),
      mass: props.map((p) => p.mass),
      inertia: props.map((p) => p.inertia),
      nozzle: length,
      cp: aero.map((a) => a.x),
      cnAlpha: aero.map((a) => a.cnAlpha),
      area: Math.PI * R * R,
      tankRadius: stage.diameter / 2,
    };
  });
  return { design, configs, bendingFrequency };
}

const lerp = (xs: number[], ys: number[], x: number) => {
  if (x <= xs[0]!) return ys[0]!;
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]!) {
      const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
      return ys[i - 1]! + (ys[i]! - ys[i - 1]!) * t;
    }
  }
  return ys.at(-1)!;
};

/** Mass properties and aerodynamic centre of the stack from `stage` up, at a burn fraction and Mach. */
export function configAt(model: ControlModel, stage: number, burned: number, mach: number) {
  const c = model.configs[Math.min(stage, model.configs.length - 1)]!;
  return {
    cg: lerp(FRACTIONS, c.cg, burned),
    mass: lerp(FRACTIONS, c.mass, burned),
    inertia: lerp(FRACTIONS, c.inertia, burned),
    cp: lerp(CONTROL_MACHS, c.cp, mach),
    cnAlpha: lerp(CONTROL_MACHS, c.cnAlpha, mach),
    nozzle: c.nozzle,
    area: c.area,
    tankRadius: c.tankRadius,
  };
}

// ── Hidden truths, what the company knows, and what a flight flies ─────

/** A gain-schedule error in the flight software: the loop gain is wrong across a Mach band. */
export type SoftwareFlaw = { from: number; to: number; gain: number };

export type GncTruth = {
  /** True first bending frequency over the drawn one. */
  bending: number;
  /** Slosh coupling gain of each stage's tanks, 0–1. */
  slosh: number[];
  /** IMU drift as flown, degrees per second (signed). */
  imuBias: number;
  flaw: SoftwareFlaw | null;
};

export type GncKnowledge = {
  /** Measured by a modal survey or a flight. */
  bending?: number;
  slosh?: number[];
  /** Measured by calibration or a flight: the flight software corrects for it. */
  imuBias?: number;
  hitl?: { runs: number; losses: number; peakEffort: number; flaw: SoftwareFlaw | null };
  /** The flaw HITL found has been corrected. */
  flawFixed?: boolean;
};

/** What a flight flies with: the truth, as far as testing has corrected it. */
export type GncFlight = {
  bending: number;
  /** Where the notch sits, Hz, or none. */
  notchAt: number | null;
  slosh: number[];
  imuBias: number;
  flaw: SoftwareFlaw | null;
};

/** Ranges the truths are rolled from. */
export const GNC_RANGES = { bending: [0.8, 1.15] as [number, number], slosh: [0.1, 0.8] as [number, number], flawChance: 0.2, flawGain: [0.4, 1] as [number, number] };
/** Slosh gain assumed before a modal survey. */
export const SLOSH_NOMINAL = 0.3;
/** Calibration leaves this share of the IMU's drift. */
export const IMU_RESIDUAL = 0.1;

export function rollGncTruth(name: string, design: ControlDesign, stageCount: number, seed: number): GncTruth {
  const r = rng(hashSeed(`${seed}:gnc:${name}`));
  const [b0, b1] = GNC_RANGES.bending;
  const [s0, s1] = GNC_RANGES.slosh;
  const bending = b0 + (b1 - b0) * r();
  const slosh = Array.from({ length: stageCount }, () => s0 + (s1 - s0) * r());
  const imuBias = ((IMU[design.imu].drift / 3600) * (2 * r() - 1));
  let flaw: SoftwareFlaw | null = null;
  if (r() < GNC_RANGES.flawChance) {
    const from = 0.7 + 1.6 * r();
    const [g0, g1] = GNC_RANGES.flawGain;
    flaw = { from, to: from + 0.4, gain: g0 + (g1 - g0) * r() };
  }
  return { bending, slosh, imuBias, flaw };
}

/** The flight as flown: truth, with what testing has corrected. */
export function flownGnc(model: ControlModel, truth: GncTruth, known: GncKnowledge | undefined): GncFlight {
  return {
    bending: truth.bending,
    notchAt: model.design.notch ? model.bendingFrequency * (known?.bending ?? 1) : null,
    slosh: truth.slosh,
    imuBias: known?.imuBias !== undefined ? truth.imuBias * IMU_RESIDUAL : truth.imuBias,
    flaw: known?.flawFixed ? null : truth.flaw,
  };
}

/** The flight as the company believes it: the drawings, corrected by what's been measured. */
export function believedGnc(model: ControlModel, known: GncKnowledge | undefined): GncFlight {
  return {
    bending: known?.bending ?? 1,
    notchAt: model.design.notch ? model.bendingFrequency * (known?.bending ?? 1) : null,
    slosh: known?.slosh ?? model.configs.map(() => SLOSH_NOMINAL),
    imuBias: 0,
    flaw: null,
  };
}

// ── One step of the loop ───────────────────────────────────────────────

/** Attitude oscillation the loop always has, and where the vehicle is lost, degrees. */
export const OSC_FLOOR = 0.02;
export const OSC_LOST = 5;
/** Loop gain at the bending mode above which it couples. */
export const BENDING_LIMIT = 0.25;
/** How fast a healthy loop damps an attitude oscillation, 1/s. */
const LOOP_DAMPING = 0.8;
/** An airframe diverging faster than this share of the loop's crossover can't be caught. */
export const DIVERGENCE_LIMIT = 0.5;

export type LoopState = {
  /** Attitude oscillation, degrees. */
  amp: number;
  /** Gimbal command the loop is following, degrees (low-passed). */
  delta: number;
  /** Seconds the gimbal has been out of range. */
  saturated: number;
  started: boolean;
};

export const newLoop = (): LoopState => ({ amp: OSC_FLOOR, delta: 0, saturated: 0, started: false });

export type Cause = "authority" | "divergence" | "slosh" | "bending" | "software" | "rate";

export type ControlStep = {
  /** Gimbal the loop is commanding, degrees. */
  delta: number;
  /** Share of the gimbal range in use. */
  effort: number;
  /** Share of the actuator rate in use. */
  rateUse: number;
  /** Airframe divergence over the loop's crossover. */
  divergence: number;
  /** Loop gain at the bending mode. */
  bendingGain: number;
  /** Slosh frequency of the burning stage, Hz. */
  sloshFrequency: number;
  /** Growth rate of the oscillation, 1/s, and what feeds it most. */
  growth: number;
  cause: Cause | null;
  amp: number;
};

export type StepInput = {
  stage: number;
  /** Share of the burning stage's propellant gone. */
  burned: number;
  mach: number;
  q: number;
  /** Angle of attack, rad, signed. */
  alpha: number;
  thrust: number;
  /** Axial acceleration, m/s². */
  axial: number;
  /** Liftoff mass over current mass: the bending mode stiffens as the stack lightens. */
  massRatio: number;
  dt: number;
};

/** Advance the loop one step; returns the new state's figures. Mutates `loop`. */
export function controlStep(model: ControlModel, flight: GncFlight, s: StepInput, loop: LoopState): ControlStep {
  const d = model.design;
  const c = configAt(model, s.stage, s.burned, s.mach);
  const arm = c.cg - c.cp; // positive: centre of pressure ahead of the centre of mass, unstable
  const lever = Math.max(0.5, c.nozzle - c.cg);
  const moment = s.q * c.area * c.cnAlpha * Math.abs(s.alpha) * Math.abs(arm);
  const trim = s.thrust > 0 ? (Math.asin(Math.min(1, moment / (s.thrust * lever))) * 180) / Math.PI : 0;
  // The loop follows the trim it needs only as fast as its bandwidth.
  const omegaC = 2 * Math.PI * d.bandwidth;
  const prev = loop.delta;
  const k = loop.started ? 1 - Math.exp(-omegaC * s.dt) : 1;
  loop.started = true;
  loop.delta = prev + (trim - prev) * k;
  const oscDemand = loop.amp * 0.5;
  const delta = loop.delta + oscDemand;
  const effort = d.gimbal > 0 ? delta / d.gimbal : Infinity;
  const trimRate = Math.abs(loop.delta - prev) / s.dt / d.actuatorRate;
  const rateUse = trimRate + (omegaC * oscDemand) / d.actuatorRate;

  // Rigid-body divergence of an unstable airframe.
  const omegaA = arm > 0 ? Math.sqrt((s.q * c.area * c.cnAlpha * arm) / c.inertia) : 0;
  const divergence = omegaA / omegaC;

  // The bending mode as the loop sees it, through the notch if it sits close to the true frequency.
  const fb = model.bendingFrequency * flight.bending * Math.sqrt(s.massRatio);
  let notch = 1;
  if (flight.notchAt !== null) {
    // The notch is scheduled with the mode it expects: the same stiffening as the stack lightens.
    const off = Math.abs((flight.notchAt * Math.sqrt(s.massRatio)) / fb - 1);
    notch = off <= 0.1 ? 0.1 : off >= 0.2 ? 1 : 0.1 + 0.9 * ((off - 0.1) / 0.1);
  }
  const bendingGain = (d.bandwidth / fb) ** 2 * notch;

  // Propellant sloshing in the burning stage's tanks: its first mode rises with acceleration.
  const fs = Math.sqrt((1.84 * Math.max(0, s.axial)) / c.tankRadius) / (2 * Math.PI);
  const detune = Math.abs(fs / d.bandwidth - 1);
  const slosh = d.baffles ? 0 : detune < 0.25 ? 2 * (flight.slosh[s.stage] ?? SLOSH_NOMINAL) * (1 - detune / 0.25) : 0;

  const software = flight.flaw && s.mach >= flight.flaw.from && s.mach <= flight.flaw.to ? 2 * flight.flaw.gain : 0;
  const sources: Array<[Cause, number]> = [
    ["slosh", slosh],
    ["bending", Math.max(0, bendingGain - BENDING_LIMIT) * 8],
    ["software", software],
    ["divergence", divergence > DIVERGENCE_LIMIT * 0.5 ? (divergence - DIVERGENCE_LIMIT * 0.5) * 4 : 0],
    // Actuators at their limit fall behind what the loop asks: phase lag, and the oscillation grows.
    ["rate", trimRate > 1 ? (trimRate - 1) * 2 : 0],
  ];
  const growth = -LOOP_DAMPING + sources.reduce((sum, [, v]) => sum + v, 0);
  const top = sources.reduce((a, b) => (b[1] > a[1] ? b : a));
  loop.amp = Math.min(OSC_LOST * 2, Math.max(OSC_FLOOR, loop.amp * Math.exp(growth * s.dt)));
  loop.saturated = effort > 1 ? loop.saturated + s.dt : 0;

  let cause: Cause | null = null;
  if (divergence > DIVERGENCE_LIMIT) cause = "divergence";
  else if (loop.saturated >= 0.5) cause = "authority";
  else if (loop.amp >= OSC_LOST) cause = top[1] > 0 ? top[0] : "authority";
  return { delta, effort, rateUse, divergence, bendingGain, sloshFrequency: fs, growth, cause, amp: loop.amp };
}

/** What the drawing says at the design point: max-q, a 2° steering angle and a 0.6° gust, half the booster burned. */
export function designPoint(model: ControlModel, q = 35_000, mach = 1.3) {
  const c = configAt(model, 0, 0.5, mach);
  const alpha = (2.6 * Math.PI) / 180;
  const arm = c.cg - c.cp;
  const d = model.design;
  const omegaC = 2 * Math.PI * d.bandwidth;
  const omegaA = arm > 0 ? Math.sqrt((q * c.area * c.cnAlpha * arm) / c.inertia) : 0;
  return {
    /** Gimbal needed for the moment at a typical thrust over weight of 1.5, degrees. */
    needs: (thrust: number) => (Math.asin(Math.min(1, (q * c.area * c.cnAlpha * alpha * Math.abs(arm)) / (thrust * Math.max(0.5, c.nozzle - c.cg)))) * 180) / Math.PI,
    divergence: omegaA / omegaC,
    divergenceHz: omegaA / (2 * Math.PI),
    bendingHz: model.bendingFrequency,
    bendingGain: (d.bandwidth / model.bendingFrequency) ** 2,
    sloshHz: model.configs.map((cfg) => Math.sqrt((1.84 * 1.5 * 9.81) / cfg.tankRadius) / (2 * Math.PI)),
  };
}

export const CAUSE_LABELS: Record<Cause, string> = {
  authority: "out of gimbal",
  divergence: "airframe diverged",
  slosh: "propellant slosh",
  bending: "bending mode coupled",
  software: "flight-software gain error",
  rate: "actuators at their rate limit",
};
