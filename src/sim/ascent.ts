import { dragCoefficient, dynamicPressure, referenceArea } from "./aero.ts";
import { aeroShape, buffetLoad, dragMultiplier, IDEAL_AERO, type AeroTruth, type AeroTruthTable } from "./airframe.ts";
import { atmosphereAt } from "./atmosphere.ts";
import { G0, MU_EARTH, R_EARTH } from "./constants.ts";
import { flowSeparates, massFlow, thrustAt } from "./engine.ts";
import { commandedPitch, kickDue, VERTICAL } from "./guidance.ts";
import { asBuilt, firstFailure, IDEAL_TRUTH, type FailureMode, type HardwareTruth } from "./hardware.ts";
import { launchGeometry, missionPlan, scoreInsertion, targetSemiMajorAxis, type InsertionReport, type Mission, type OrbitBurn } from "./mission.ts";
import { isOrbit, orbitFrom, type OrbitElements } from "./orbit.ts";
import { believedGnc, controlStep, newLoop, type Cause, type GncFlight } from "./control.ts";
import { trueAxial, trueQAlpha } from "./structures.ts";
import { CALM, windAt, type WindProfile } from "./wind.ts";
import { burnTime, stackMass, type Stage, type Vehicle } from "./vehicle.ts";

/**
 * Two-dimensional ascent in the plane of the trajectory. Position and
 * velocity are inertial, measured from Earth's centre, with the pad at
 * (0, R) and downrange along +x.
 *
 * The ground and the air turn with the Earth at the in-plane rotation rate
 * from the mission's launch geometry, so the pad starts with a free
 * horizontal velocity and aerodynamics see the air-relative flow.
 */

export type EventKind =
  | "ignition"
  | "liftoff"
  | "no-liftoff"
  | "flow-separation"
  | "pitch-kick"
  | "mach-1"
  | "max-q"
  | "q-limit-exceeded"
  | "q-alpha-limit-exceeded"
  | "accel-limit-exceeded"
  | "meco"
  | "cutoff"
  | "engine-failure"
  | "structural-failure"
  | "staging"
  | "orbit"
  | "coast"
  | "relight"
  | "transfer"
  | "circularize"
  | "escape"
  | "tower-jettison"
  | "fairing-jettison"
  | "attitude-oscillation"
  | "loss-of-control"
  | "abort"
  | "apogee"
  | "impact"
  | "timeout";

export type FlightEvent = {
  kind: EventKind;
  t: number;
  altitude: number;
  /** Inertial speed, m/s. */
  velocity: number;
  mach: number;
  /** Stage index active at the event. */
  stage: number;
  /** Event-specific number: q for max-q, T/W for liftoff, pressure for separation, kg left for cutoff. */
  value?: number;
  /** For an engine or structural failure, which failure mode. */
  mode?: FailureMode;
  /** For a control event, what drove it. */
  cause?: Cause;
};

export type Sample = {
  t: number;
  altitude: number;
  /** Ground distance from the pad along the surface, m. */
  downrange: number;
  /** Angle around the Earth's centre from where the pad was at launch, in inertial space, rad. */
  theta: number;
  /** Inertial speed, m/s. */
  velocity: number;
  /** Speed relative to the ground and the air, m/s. */
  airSpeed: number;
  verticalVelocity: number;
  /** Inertial horizontal speed, m/s. */
  horizontalVelocity: number;
  /** Rate of change of air speed, m/s². */
  acceleration: number;
  mass: number;
  mach: number;
  dynamicPressure: number;
  thrust: number;
  drag: number;
  /** Thrust direction above the local horizon, deg. */
  pitch: number;
  /** Air-relative velocity direction above the local horizon, deg. */
  flightPathAngle: number;
  /** Angle between thrust and the airflow, deg. */
  angleOfAttack: number;
  stage: number;
};

/**
 * Where the engines' Δv went, measured against the ground. Starting from
 * rest on the pad, ground speed at burnout is the delivered Δv minus these.
 */
export type Losses = {
  /** Δv spent holding the vehicle up against gravity (net of centrifugal), m/s. */
  gravity: number;
  /** Δv spent pushing air out of the way, m/s. */
  drag: number;
  /** Δv lost to ambient pressure on the nozzle exit (F_vac − F), m/s. */
  backPressure: number;
  /** Δv spent turning: thrust that pointed off the velocity vector, m/s. */
  steering: number;
};

/** "apogee" means the flight topped out and fell back: suborbital. "failure" means the vehicle was lost to an engine or structural failure. */
/** "abort": the capsule was pulled off a booster on purpose, in an in-flight abort test. */
export type Outcome = "no-liftoff" | "failure" | "orbit" | "escape" | "apogee" | "impact" | "timeout" | "abort";

export type FlightResult = {
  vehicle: string;
  mission: string;
  outcome: Outcome;
  events: FlightEvent[];
  samples: Sample[];
  summary: {
    apogee: number;
    apogeeTime: number;
    maxQ: { value: number; t: number; altitude: number; velocity: number; mach: number; stage: number };
    /** Peak dynamic pressure × angle of attack, Pa·deg. */
    maxQAlpha: { value: number; t: number; altitude: number; mach: number };
    /** Peak unsteady load from transonic buffet, Pa. 0 if the shape doesn't buffet. */
    maxBuffetLoad: { value: number; t: number; mach: number };
    /** Inertial speed at final shutdown, m/s. */
    burnoutVelocity: number;
    /** Ground-relative speed at final shutdown, m/s. */
    burnoutGroundSpeed: number;
    burnoutAltitude: number;
    burnoutTime: number;
    /** Inertial flight-path angle at final shutdown, deg. */
    burnoutFlightPathAngle: number;
    burnoutDownrange: number;
    /** Propellant left in the last stage at shutdown, kg. */
    propellantMargin: number;
    /** Launch azimuth flown, deg clockwise from north. */
    azimuth: number;
    /** Inclination of the trajectory plane, deg. */
    inclination: number;
    /** Inertial speed the pad gave the vehicle before it moved, m/s. */
    rotationBoost: number;
    /** Orbit the vehicle was on at final shutdown. */
    orbit: OrbitElements | null;
    /** Scored against the mission's target, when it has one. */
    insertion: InsertionReport | null;
    /** The attitude loop's worst moments, for a vehicle flying the control model. */
    control?: ControlSummary;
    /** Integrated vacuum Δv actually delivered, m/s. */
    idealDeltaV: number;
    losses: Losses;
  };
};

export type ControlSummary = {
  /** Peak share of the gimbal range in use, and when. */
  maxEffort: { value: number; t: number; mach: number };
  /** Peak share of the actuator rate. */
  maxRateUse: number;
  /** Largest attitude oscillation, degrees, and what fed it. */
  maxOscillation: { value: number; t: number; cause: Cause | null };
  /** Peak airframe divergence over loop crossover, and loop gain at the bending mode. */
  maxDivergence: number;
  maxBendingGain: number;
  /** Largest gust met below 15 km, m/s. */
  maxGust: number;
  /** IMU drift flown, deg/s. */
  imuBias: number;
};

export type AscentOptions = {
  /** Integration step, s. */
  dt?: number;
  /** Interval between recorded samples, s. */
  sampleInterval?: number;
  /** Give up after this much flight time, s. */
  maxTime?: number;
  /** False holds the Earth still. For checking the physics against closed forms. */
  rotatingEarth?: boolean;
  /**
   * The engines' hidden truth, keyed by engine name. Engines fly as built
   * and fail when their quirks say so. Left out, every engine is perfect.
   */
  hardware?: HardwareTruth;
  /** The shapes' hidden aero truth, keyed by aero shape. Left out, the drag curves are exact and nothing buffets. */
  aero?: AeroTruthTable;
  /**
   * False records structural loads without breaking the vehicle, so an
   * analysis can see how far over the budget a trajectory goes.
   */
  structuralFailures?: boolean;
  /**
   * The real buckling knock-down of each structure (material at a diameter),
   * keyed by structure key. Left out, shells carry what their drawings say
   * and a load over the budget is only recorded.
   */
  structure?: Record<string, number>;
  /**
   * The day's wind. Only a vehicle flying the control model feels it; left
   * out, the air is calm.
   */
  wind?: WindProfile;
  /**
   * The attitude loop's real bending, slosh, IMU drift and software, by
   * vehicle name, as flown. Left out, the loop flies as drawn.
   */
  gnc?: Record<string, GncFlight>;
};

/** [x, y, vx, vy, mass, gravity, drag, back-pressure, steering, ideal Δv] */
type State = [number, number, number, number, number, number, number, number, number, number];

const X = 0, Y = 1, VX = 2, VY = 3, M = 4;
const DEG = 180 / Math.PI;
/** Dynamic pressure above which the air's moments are the attitude loop's to fight, Pa. Thinner than this, thrust alone points the vehicle. */
const CONTROL_Q = 5_000;
/** Share of the mean wind left after day-of-launch trajectory biasing. */
const WIND_BIAS_RESIDUAL = 0.1;

type Phase = {
  stage: Stage;
  stageIndex: number;
  /** Flight time this stage ignited, s. */
  ignitedAt: number;
  burning: boolean;
  area: number;
  kickStart: number | null;
  /** Seconds after ignition this stage's engines fail, and how. */
  failure: { t: number; mode: FailureMode } | null;
  /** In orbit: thrust along the inertial velocity instead of the pitch programme. */
  prograde?: boolean;
};

type Context = {
  vehicle: Vehicle;
  /** In-plane rotation rate of the Earth and its air, rad/s. */
  omega: number;
  /** How the shape really behaves in the air. */
  aero: AeroTruth;
  /** Wind along track, when the vehicle flies the control model. */
  wind: WindProfile | null;
  /** IMU drift, rad/s: the attitude the vehicle thinks it holds wanders off by this. */
  drift: number;
};

/** Everything the integrator and the event checks need at one instant. */
type Snapshot = {
  altitude: number;
  radius: number;
  /** Inertial speed. */
  speed: number;
  /** Speed relative to the rotating air. */
  airSpeed: number;
  /** Unit vectors: local up, local horizontal (downrange), air-relative velocity direction. */
  up: [number, number];
  horizontal: [number, number];
  heading: [number, number];
  /** Air-relative flight-path angle, rad. */
  flightPathAngle: number;
  pitch: number;
  thrustDir: [number, number];
  angleOfAttack: number;
  /** Angle of attack with its sign: thrust above the airflow is positive, rad. */
  alpha: number;
  /** Gust along track here, m/s. */
  gust: number;
  thrust: number;
  drag: number;
  mach: number;
  q: number;
  pressure: number;
  gravity: number;
};

function snapshot(ctx: Context, phase: Phase, t: number, s: State): Snapshot {
  const { vehicle, omega } = ctx;
  const radius = Math.hypot(s[X], s[Y]);
  const altitude = radius - R_EARTH;
  const up: [number, number] = [s[X] / radius, s[Y] / radius];
  const horizontal: [number, number] = [up[1], -up[0]];
  const speed = Math.hypot(s[VX], s[VY]);

  // The air moves with the ground: ω × r, which points along +horizontal.
  const rx = s[VX] - omega * s[Y];
  const ry = s[VY] + omega * s[X];
  const airSpeed = Math.hypot(rx, ry);
  const vUp = rx * up[0] + ry * up[1];
  const vHorizontal = rx * horizontal[0] + ry * horizontal[1];
  const flightPathAngle = airSpeed > 1e-9 ? Math.atan2(vUp, vHorizontal) : Math.PI / 2;

  const stageBurnFraction = phase.burning ? Math.min(1, (t - phase.ignitedAt) / burnTime(phase.stage)) : 1;
  const inertialFpa = Math.atan2(s[VX] * up[0] + s[VY] * up[1], s[VX] * horizontal[0] + s[VY] * horizontal[1]);
  const pitch =
    (phase.prograde
      ? inertialFpa
      : commandedPitch(vehicle.pitchProgram ?? VERTICAL, {
          t,
          kickStart: phase.kickStart,
          flightPathAngle,
          stage: phase.stageIndex,
          stageBurnFraction,
        })) + ctx.drift * t;
  const thrustDir: [number, number] = [
    Math.cos(pitch) * horizontal[0] + Math.sin(pitch) * up[0],
    Math.cos(pitch) * horizontal[1] + Math.sin(pitch) * up[1],
  ];
  const heading: [number, number] = airSpeed > 1e-9 ? [rx / airSpeed, ry / airSpeed] : thrustDir;
  const cosAlpha = Math.min(1, Math.max(-1, thrustDir[0] * heading[0] + thrustDir[1] * heading[1]));
  // Wind only loads the airframe: the trajectory is flown as planned, and
  // the angle the air meets the body at gains the gusts and whatever of
  // the mean wind the day's balloon and trajectory biasing didn't take out.
  const w = ctx.wind ? windAt(ctx.wind, altitude) : null;
  const gust = w ? w.gust : 0;
  const crossWind = w ? WIND_BIAS_RESIDUAL * w.mean + w.gust : 0;
  const steerAlpha = Math.atan2(heading[0] * thrustDir[1] - heading[1] * thrustDir[0], cosAlpha);
  const windAlpha = crossWind !== 0 && airSpeed > 1 ? Math.atan2(crossWind * Math.abs(vUp / airSpeed), airSpeed) : 0;

  const atm = atmosphereAt(altitude);
  const mach = airSpeed / atm.speedOfSound;
  const q = dynamicPressure(atm.density, airSpeed);
  return {
    altitude,
    radius,
    speed,
    airSpeed,
    up,
    horizontal,
    heading,
    flightPathAngle,
    pitch,
    thrustDir,
    angleOfAttack: Math.acos(cosAlpha),
    alpha: steerAlpha + windAlpha,
    gust,
    thrust: phase.burning ? phase.stage.engineCount * thrustAt(phase.stage.engine, atm.pressure) : 0,
    drag: q * dragCoefficient(vehicle.dragCurve, mach) * dragMultiplier(ctx.aero, mach) * phase.area,
    mach,
    q,
    pressure: atm.pressure,
    gravity: MU_EARTH / (radius * radius),
  };
}

function derivative(ctx: Context, phase: Phase, t: number, s: State): State {
  const m = s[M];
  const k = snapshot(ctx, phase, t, s);
  const ax = (k.thrust * k.thrustDir[0] - k.drag * k.heading[0]) / m - k.gravity * k.up[0];
  const ay = (k.thrust * k.thrustDir[1] - k.drag * k.heading[1]) / m - k.gravity * k.up[1];
  if (!phase.burning) return [s[VX], s[VY], ax, ay, 0, 0, 0, 0, 0, 0];

  // Rates that split the change in ground-relative speed into what the
  // engines gave and where it went. In the rotating frame Coriolis is
  // perpendicular to the motion and drops out; centrifugal offsets gravity.
  const { engine, engineCount } = phase.stage;
  const thrustVac = engineCount * engine.thrustVac;
  const cosAlpha = Math.cos(k.angleOfAttack);
  const netGravity = k.gravity - ctx.omega * ctx.omega * k.radius;
  return [
    s[VX],
    s[VY],
    ax,
    ay,
    -engineCount * massFlow(engine),
    netGravity * Math.sin(k.flightPathAngle),
    k.drag / m,
    (thrustVac - k.thrust) / m,
    (k.thrust * (1 - cosAlpha)) / m,
    thrustVac / m,
  ];
}

function rk4(ctx: Context, phase: Phase, t: number, s: State, dt: number): State {
  const add = (a: State, b: State, k: number): State => a.map((x, i) => x + k * b[i]!) as State;
  const k1 = derivative(ctx, phase, t, s);
  const k2 = derivative(ctx, phase, t + dt / 2, add(s, k1, dt / 2));
  const k3 = derivative(ctx, phase, t + dt / 2, add(s, k2, dt / 2));
  const k4 = derivative(ctx, phase, t + dt, add(s, k3, dt));
  return s.map((x, i) => x + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!)) as State;
}

/** Frontal area of whatever is still attached: the widest stage or the fairing. */
function frontalArea(vehicle: Vehicle, stageIndex: number): number {
  let diameter = vehicle.fairingDiameter;
  for (let i = stageIndex; i < vehicle.stages.length; i++) {
    diameter = Math.max(diameter, vehicle.stages[i]!.diameter);
  }
  return referenceArea(diameter);
}

function specificEnergy(s: State): number {
  return (s[VX] * s[VX] + s[VY] * s[VY]) / 2 - MU_EARTH / Math.hypot(s[X], s[Y]);
}

/**
 * Energy a burn aims for, J/kg, from where it starts. A prograde burn at one
 * apsis moves the other: raising the apoapsis from the parking orbit, or
 * raising the periapsis at the high point. An escape aims at its C3.
 */
function burnEnergy(burn: OrbitBurn, radius: number): number {
  if (burn.until.kind === "energy") return burn.until.energy;
  const other = R_EARTH + burn.until.altitude;
  return -MU_EARTH / (radius + other);
}

function verticalSpeed(s: State): number {
  const r = Math.hypot(s[X], s[Y]);
  return (s[VX] * s[X] + s[VY] * s[Y]) / r;
}

export function simulateAscent(design: Vehicle, mission: Mission, options: AscentOptions = {}): FlightResult {
  // Fly the engines as built, not as drawn.
  const hardware = options.hardware;
  const truthOf = (stage: Stage) => (hardware ? (hardware[stage.engine.name] ?? IDEAL_TRUTH) : IDEAL_TRUTH);
  const vehicle: Vehicle = {
    ...design,
    stages: design.stages.map((stage) => ({ ...stage, engine: asBuilt(stage.engine, truthOf(stage)) })),
  };
  const failureOf = (index: number) => firstFailure(truthOf(design.stages[index]!));

  const dt = options.dt ?? 0.05;
  const sampleInterval = options.sampleInterval ?? 1;
  const plan = missionPlan(mission);
  const maxTime = options.maxTime ?? (plan.burns.length > 0 ? 6 * 3600 : 3600);
  if (vehicle.stages.length === 0) throw new Error(`${vehicle.name} has no stages`);
  const program = vehicle.pitchProgram ?? VERTICAL;
  const geometry = launchGeometry(mission, options.rotatingEarth ?? true);
  // A guided vehicle drawn with a control model flies its attitude loop, in the day's wind.
  const control = design.control ?? null;
  const gnc = control ? (options.gnc?.[design.name] ?? believedGnc(control, undefined)) : null;
  const ctx: Context = {
    vehicle,
    omega: geometry.rotationRate,
    aero: options.aero?.[aeroShape(design).key] ?? IDEAL_AERO,
    wind: control ? (options.wind ?? CALM) : null,
    drift: gnc ? (gnc.imuBias * Math.PI) / 180 : 0,
  };
  const loop = newLoop();
  let liftoffMass = 0;
  const controlSummary: ControlSummary | null = control
    ? { maxEffort: { value: 0, t: 0, mach: 0 }, maxRateUse: 0, maxOscillation: { value: 0, t: 0, cause: null }, maxDivergence: 0, maxBendingGain: 0, maxGust: 0, imuBias: gnc!.imuBias }
    : null;
  let oscillationSeen = false;
  const lastStage = vehicle.stages.length - 1;

  // Guidance shuts the last stage down once the orbit has the target's
  // energy. Where the energy lands between periapsis and apoapsis is up to
  // the pitch programme. A high-energy mission's ascent stops at its parking
  // orbit, on whichever stage gets there first.
  const target = mission.target;
  const ascentTarget = plan.ascent;
  const cutoffEnergy = ascentTarget ? -MU_EARTH / (2 * targetSemiMajorAxis(ascentTarget, R_EARTH)) : Infinity;
  const parking = plan.burns.length > 0;

  const events: FlightEvent[] = [];
  const samples: Sample[] = [];

  let t = 0;
  let stageIndex = 0;
  let propellant = vehicle.stages[0]!.propellantMass;
  const rotationBoost = ctx.omega * R_EARTH;
  let s: State = [0, R_EARTH, rotationBoost, 0, stackMass(vehicle, 0), 0, 0, 0, 0, 0];
  let phase: Phase = {
    stage: vehicle.stages[0]!,
    stageIndex: 0,
    ignitedAt: 0,
    burning: true,
    area: frontalArea(vehicle, 0),
    kickStart: null,
    failure: failureOf(0),
  };

  let liftedOff = false;
  let towerGone = false;
  let fairingGone = false;
  const structuralFailures = options.structuralFailures ?? true;
  // What each stage's shell really carries, from the hidden knock-down; none when the structures aren't in play.
  const shells =
    design.structure && options.structure
      ? design.structure.stages.map((st) => ({ qAlpha: trueQAlpha(st, options.structure![st.key] ?? 1), axial: trueAxial(st, options.structure![st.key] ?? 1) }))
      : null;
  let passedMach1 = false;
  let qLimitHit = false;
  let qAlphaLimitHit = false;
  let accelLimitHit = false;
  let nextSampleAt = 0;
  let outcome: Outcome = "timeout";
  let maxQ = { value: 0, t: 0, altitude: 0, velocity: 0, mach: 0, stage: 0 };
  let maxQAlpha = { value: 0, t: 0, altitude: 0, mach: 0 };
  let maxBuffet = { value: 0, t: 0, mach: 0 };
  let burnout = { t: 0, altitude: 0, velocity: 0, groundSpeed: 0, flightPathAngle: 0, downrange: 0 };
  let orbit: OrbitElements | null = null;
  let apogee = { t: 0, altitude: 0 };

  // Ground distance keeps counting past half an orbit instead of wrapping to negative.
  let groundAngle = 0;
  const downrange = () => {
    let a = Math.atan2(s[X], s[Y]) - ctx.omega * t;
    while (a - groundAngle > Math.PI) a -= 2 * Math.PI;
    while (a - groundAngle < -Math.PI) a += 2 * Math.PI;
    groundAngle = a;
    return R_EARTH * a;
  };

  const event = (kind: EventKind, k: Snapshot, value?: number) => {
    events.push({ kind, t, altitude: k.altitude, velocity: k.speed, mach: k.mach, stage: stageIndex, value });
  };

  const record = (k: Snapshot) => {
    const d = derivative(ctx, phase, t, s);
    const vUp = verticalSpeed(s);
    samples.push({
      t,
      altitude: k.altitude,
      downrange: downrange(),
      theta: Math.atan2(s[X], s[Y]),
      velocity: k.speed,
      airSpeed: k.airSpeed,
      verticalVelocity: vUp,
      horizontalVelocity: Math.sqrt(Math.max(0, k.speed * k.speed - vUp * vUp)),
      acceleration:
        (d[VX] - ctx.omega * s[VY]) * k.heading[0] + (d[VY] + ctx.omega * s[VX]) * k.heading[1],
      mass: s[M],
      mach: k.mach,
      dynamicPressure: k.q,
      thrust: k.thrust,
      drag: k.drag,
      pitch: k.pitch * DEG,
      flightPathAngle: k.flightPathAngle * DEG,
      angleOfAttack: k.angleOfAttack * DEG,
      stage: stageIndex,
    });
  };

  const fail = (k: Snapshot, mode: FailureMode, value?: number, cause?: Cause) => {
    const kind =
      mode === "transonic-buffet" || mode === "structural-buckling"
        ? "structural-failure"
        : mode === "loss-of-control" || mode === "control-structure-coupling"
          ? "loss-of-control"
          : "engine-failure";
    events.push({ kind, t, altitude: k.altitude, velocity: k.speed, mach: k.mach, stage: stageIndex, mode, value, ...(cause ? { cause } : {}) });
    outcome = "failure";
    record(k);
  };

  /** Light the current stage. False if it fails on the spot. */
  const ignite = (): boolean => {
    const k = snapshot(ctx, phase, t, s);
    event("ignition", k);
    if (flowSeparates(phase.stage.engine, k.pressure)) event("flow-separation", k, k.pressure);
    if (phase.failure?.t === 0) {
      fail(k, phase.failure.mode);
      return false;
    }
    return true;
  };

  const lit = ignite();
  const pad = snapshot(ctx, phase, 0, s);
  const thrustToWeight = pad.thrust / (s[M] * pad.gravity);
  if (lit && thrustToWeight <= 1) {
    event("no-liftoff", pad, thrustToWeight);
    record(pad);
    outcome = "no-liftoff";
  }

  while (outcome === "timeout" && t < maxTime) {
    const flow = phase.burning ? phase.stage.engineCount * massFlow(phase.stage.engine) : 0;
    let step = phase.burning ? Math.min(dt, propellant / flow) : dt;
    // Land exactly on a scheduled engine failure.
    if (phase.burning && phase.failure) step = Math.min(step, Math.max(0, phase.ignitedAt + phase.failure.t - t));
    const prev = s;
    const prevVerticalSpeed = verticalSpeed(s);
    const prevAirSpeed = snapshot(ctx, phase, t, s).airSpeed;

    s = rk4(ctx, phase, t, prev, step);

    // Energy cutoff: if this step carried the last stage past the target
    // energy, redo it with the step trimmed to land on the target.
    let guidanceCutoff = false;
    if (phase.burning && (stageIndex === lastStage || parking) && specificEnergy(s) >= cutoffEnergy) {
      const before = specificEnergy(prev);
      const fraction = (cutoffEnergy - before) / (specificEnergy(s) - before);
      step *= Math.min(1, Math.max(0, fraction));
      s = rk4(ctx, phase, t, prev, step);
      guidanceCutoff = true;
    }

    t += step;
    if (phase.burning) propellant = Math.max(0, propellant - flow * step);

    let k = snapshot(ctx, phase, t, s);

    if (phase.burning && phase.failure && t - phase.ignitedAt >= phase.failure.t - 1e-9) {
      fail(k, phase.failure.mode);
      break;
    }

    if (!liftedOff && k.altitude > 0) {
      liftedOff = true;
      liftoffMass = s[M];
      event("liftoff", k, thrustToWeight);
    }
    if (liftedOff && k.altitude < 0) {
      event("impact", k);
      outcome = "impact";
      record(k);
      break;
    }

    // The abort tower goes once the vehicle is clear of the thick air: its mass stops counting.
    // The fairing comes off once the air is thin enough not to heat the payload; q·v is the free-molecular heat flux.
    if (vehicle.fairing && !fairingGone && k.altitude >= vehicle.fairing.jettisonAltitude) {
      fairingGone = true;
      s[M] -= vehicle.fairing.mass;
      k = snapshot(ctx, phase, t, s);
      event("fairing-jettison", k, k.q * k.speed);
    }
    if (vehicle.escapeTower && !towerGone && t >= vehicle.escapeTower.jettisonAt) {
      towerGone = true;
      s[M] -= vehicle.escapeTower.mass;
      k = snapshot(ctx, phase, t, s);
      event("tower-jettison", k, vehicle.escapeTower.mass);
    }

    if (phase.kickStart === null && kickDue(program, k.airSpeed) && program.kind === "gravity-turn") {
      // Start the kick at the interpolated moment the speed crossed, not at the
      // end of the step, so the trajectory doesn't depend on the step size.
      const crossed = (program.kickSpeed - prevAirSpeed) / (k.airSpeed - prevAirSpeed);
      phase = { ...phase, kickStart: t - step * (1 - Math.min(1, Math.max(0, crossed))) };
      event("pitch-kick", k, program.kickAngle);
    }

    // Ascent loads only. A vehicle that falls back meets thick air again, but
    // that is reentry, not the ascent the airframe was sized for.
    const ascending = phase.burning || verticalSpeed(s) > 0;
    if (ascending && k.q > maxQ.value) maxQ = { value: k.q, t, altitude: k.altitude, velocity: k.speed, mach: k.mach, stage: stageIndex };
    const qAlpha = k.q * (ctx.wind ? Math.abs(k.alpha) : k.angleOfAttack) * DEG;
    if (phase.burning && qAlpha > maxQAlpha.value) maxQAlpha = { value: qAlpha, t, altitude: k.altitude, mach: k.mach };
    const buffet = ascending ? buffetLoad(ctx.aero, k.mach, k.q) : 0;
    if (buffet > maxBuffet.value) maxBuffet = { value: buffet, t, mach: k.mach };
    if (buffet > vehicle.limits.maxDynamicPressure && (options.structuralFailures ?? true)) {
      fail(k, "transonic-buffet", buffet);
      break;
    }
    if (ascending && !passedMach1 && k.mach >= 1) {
      passedMach1 = true;
      event("mach-1", k);
    }
    if (ascending && !qLimitHit && k.q > vehicle.limits.maxDynamicPressure) {
      qLimitHit = true;
      event("q-limit-exceeded", k, k.q);
    }
    const qAlphaLimit = vehicle.limits.maxQAlpha;
    if (!qAlphaLimitHit && phase.burning && qAlphaLimit !== undefined && qAlpha > qAlphaLimit) {
      qAlphaLimitHit = true;
      event("q-alpha-limit-exceeded", k, qAlpha);
    }
    const axialG = (k.thrust - k.drag) / s[M] / G0;
    // A shell the real knock-down leaves short of the load buckles: bending from q·α, or the stack's weight under thrust.
    if (shells && structuralFailures && phase.burning) {
      const own = shells[stageIndex];
      const bendCap = Math.min(...shells.slice(stageIndex).map((c) => c.qAlpha));
      const above = s[M] - phase.stage.dryMass - propellant;
      if (qAlpha > bendCap || (own && above * G0 * axialG > own.axial)) {
        fail(k, "structural-buckling", qAlpha > bendCap ? qAlpha : axialG);
        break;
      }
    }
    // The attitude loop: what it has to do this step, and whether it holds.
    if (control && controlSummary && phase.burning && liftedOff && k.q > CONTROL_Q) {
      const c = controlStep(control, gnc!, {
        stage: stageIndex,
        burned: Math.min(1, (t - phase.ignitedAt) / burnTime(phase.stage)),
        mach: k.mach,
        q: k.q,
        alpha: k.alpha,
        thrust: k.thrust,
        axial: axialG * G0,
        massRatio: liftoffMass / s[M],
        dt: step,
      }, loop);
      const cs = controlSummary;
      if (c.effort > cs.maxEffort.value) cs.maxEffort = { value: c.effort, t, mach: k.mach };
      cs.maxRateUse = Math.max(cs.maxRateUse, c.rateUse);
      if (c.amp > cs.maxOscillation.value) cs.maxOscillation = { value: c.amp, t, cause: c.growth > 0 ? growthCause(c) : cs.maxOscillation.cause };
      cs.maxDivergence = Math.max(cs.maxDivergence, c.divergence);
      cs.maxBendingGain = Math.max(cs.maxBendingGain, c.bendingGain);
      if (k.altitude < 15_000) cs.maxGust = Math.max(cs.maxGust, Math.abs(k.gust));
      if (!oscillationSeen && c.amp >= 0.5) {
        oscillationSeen = true;
        events.push({ kind: "attitude-oscillation", t, altitude: k.altitude, velocity: k.speed, mach: k.mach, stage: stageIndex, value: c.amp, cause: growthCause(c) });
      }
      if (c.cause && structuralFailures) {
        fail(k, c.cause === "bending" ? "control-structure-coupling" : "loss-of-control", c.cause === "authority" ? c.effort : c.cause === "divergence" ? c.divergence : c.amp, c.cause);
        break;
      }
    }
    if (!accelLimitHit && axialG > vehicle.limits.maxAcceleration) {
      accelLimitHit = true;
      event("accel-limit-exceeded", k, axialG);
    }

    if (phase.burning && (propellant <= 1e-9 || guidanceCutoff)) {
      if (guidanceCutoff) event("cutoff", k, propellant);
      else event("meco", k);
      const inertialFpa = Math.asin(Math.max(-1, Math.min(1, verticalSpeed(s) / k.speed)));
      burnout = {
        t,
        altitude: k.altitude,
        velocity: k.speed,
        groundSpeed: k.airSpeed,
        flightPathAngle: inertialFpa * DEG,
        downrange: downrange(),
      };
      const next = guidanceCutoff ? undefined : vehicle.stages[stageIndex + 1];
      if (next) {
        s[M] -= phase.stage.dryMass;
        stageIndex += 1;
        propellant = next.propellantMass;
        phase = {
          ...phase,
          stage: next,
          stageIndex,
          ignitedAt: t,
          area: frontalArea(vehicle, stageIndex),
          failure: failureOf(stageIndex),
        };
        k = snapshot(ctx, phase, t, s);
        event("staging", k);
        if (!ignite()) break;
      } else {
        phase = { ...phase, burning: false };
        k = snapshot(ctx, phase, t, s);
        orbit = orbitFrom(s[X], s[Y], s[VX], s[VY]);
        if (isOrbit(orbit)) {
          event("orbit", k, orbit.periapsis);
          outcome = "orbit";
          record(k);
          break;
        }
      }
    }

    if (!phase.burning && prevVerticalSpeed > 0 && verticalSpeed(s) <= 0) {
      apogee = { t, altitude: k.altitude };
      event("apogee", k);
      outcome = "apogee";
      record(k);
      break;
    }

    if (t >= nextSampleAt) {
      record(k);
      nextSampleAt += sampleInterval;
    }
  }

  // High-energy missions: coast in the parking orbit, relight, and burn
  // prograde to each target energy in turn.
  if (outcome === "orbit" && parking) {
    // Seconds the current stage has already run: failures count from its first ignition.
    let stageRun = t - phase.ignitedAt;
    const coastDt = Math.max(dt, 5);
    const burnDt = Math.max(dt, 0.2);
    const propagate = (step: number) => {
      s = rk4(ctx, phase, t, s, step);
      t += step;
    };
    const sampleCoast = (k: Snapshot) => {
      if (t >= nextSampleAt) {
        record(k);
        nextSampleAt = t + Math.max(sampleInterval, 30);
      }
    };
    const relightOf = (index: number) => {
      const truth = hardware ? hardware[design.stages[index]!.engine.name] : undefined;
      return truth?.relightFails ?? false;
    };

    for (const burn of plan.burns) {
      outcome = "timeout";
      // Coast.
      let k = snapshot(ctx, phase, t, s);
      event("coast", k);
      const coastEnd = burn.coast.kind === "time" ? t + burn.coast.seconds : Infinity;
      while (t < maxTime) {
        const before = verticalSpeed(s);
        const step = burn.coast.kind === "time" ? Math.min(coastDt, coastEnd - t) : coastDt;
        propagate(step);
        k = snapshot(ctx, phase, t, s);
        if (k.altitude < 0) break;
        sampleCoast(k);
        if (burn.coast.kind === "time" ? t >= coastEnd - 1e-9 : before > 0 && verticalSpeed(s) <= 0) break;
      }
      if (k.altitude < 0) {
        event("impact", k);
        outcome = "impact";
        break;
      }
      if (t >= maxTime) break;

      // Relight: a stage that has already run has to restart in vacuum.
      if (propellant <= 1e-9) {
        const next = vehicle.stages[stageIndex + 1];
        if (!next) {
          outcome = "orbit";
          break;
        }
        s[M] -= phase.stage.dryMass;
        stageIndex += 1;
        propellant = next.propellantMass;
        stageRun = 0;
        phase = { ...phase, stage: next, stageIndex, area: frontalArea(vehicle, stageIndex), failure: failureOf(stageIndex) };
        event("staging", snapshot(ctx, phase, t, s));
      }
      phase = { ...phase, burning: true, prograde: true, ignitedAt: t - stageRun };
      k = snapshot(ctx, phase, t, s);
      if (stageRun > 0) {
        event("relight", k);
        if (relightOf(stageIndex)) {
          fail(k, "relight-failure");
          break;
        }
      } else {
        event("ignition", k);
        if (phase.failure?.t === 0) {
          fail(k, phase.failure.mode);
          break;
        }
      }

      // Burn to the target energy: the orbit with the target apsis opposite where the vehicle is now.
      const r = Math.hypot(s[X], s[Y]);
      const goal = burnEnergy(burn, r);
      let done = false;
      while (!done && t < maxTime) {
        const flow = phase.stage.engineCount * massFlow(phase.stage.engine);
        let step = Math.min(burnDt, propellant / flow);
        if (phase.failure) step = Math.min(step, Math.max(0, phase.ignitedAt + phase.failure.t - t));
        const prev = s;
        s = rk4(ctx, phase, t, prev, step);
        if (specificEnergy(s) >= goal) {
          const before = specificEnergy(prev);
          step *= Math.min(1, Math.max(0, (goal - before) / (specificEnergy(s) - before)));
          s = rk4(ctx, phase, t, prev, step);
          done = true;
        }
        t += step;
        propellant = Math.max(0, propellant - flow * step);
        stageRun += step;
        k = snapshot(ctx, phase, t, s);
        if (phase.failure && t - phase.ignitedAt >= phase.failure.t - 1e-9) {
          fail(k, phase.failure.mode);
          break;
        }
        if (t >= nextSampleAt) {
          record(k);
          nextSampleAt = t + sampleInterval;
        }
        if (!done && propellant <= 1e-9) {
          const next = vehicle.stages[stageIndex + 1];
          if (!next) break;
          event("meco", k);
          s[M] -= phase.stage.dryMass;
          stageIndex += 1;
          propellant = next.propellantMass;
          stageRun = 0;
          phase = { ...phase, stage: next, stageIndex, ignitedAt: t, area: frontalArea(vehicle, stageIndex), failure: failureOf(stageIndex) };
          k = snapshot(ctx, phase, t, s);
          event("staging", k);
          if (!ignite()) break;
        }
      }
      if ((outcome as Outcome) === "failure") break;
      phase = { ...phase, burning: false };
      k = snapshot(ctx, phase, t, s);
      const inertialFpa = Math.asin(Math.max(-1, Math.min(1, verticalSpeed(s) / k.speed)));
      burnout = { t, altitude: k.altitude, velocity: k.speed, groundSpeed: k.airSpeed, flightPathAngle: inertialFpa * DEG, downrange: downrange() };
      orbit = orbitFrom(s[X], s[Y], s[VX], s[VY]);
      record(k);
      if (!done) {
        // Out of propellant short of the target: whatever orbit this is, it's the one the payload gets.
        event("meco", k);
        outcome = orbit.energy >= 0 ? "escape" : isOrbit(orbit) ? "orbit" : "impact";
        break;
      }
      event(burn.name, k, propellant);
      outcome = orbit.energy >= 0 ? "escape" : "orbit";
    }
    if (outcome === "timeout") {
      const k = snapshot(ctx, phase, t, s);
      events.push({ kind: "timeout", t, altitude: k.altitude, velocity: k.speed, mach: k.mach, stage: stageIndex });
    }
  } else if (outcome === "timeout") {
    const k = snapshot(ctx, phase, t, s);
    events.push({ kind: "timeout", t, altitude: k.altitude, velocity: k.speed, mach: k.mach, stage: stageIndex });
  }
  if (maxQ.value > 0) {
    const { value, ...at } = maxQ;
    events.push({ kind: "max-q", ...at, value });
    events.sort((a, b) => a.t - b.t);
  }

  const finalOrbit = orbit ?? orbitFrom(s[X], s[Y], s[VX], s[VY]);
  const insertion =
    target && outcome !== "no-liftoff"
      ? scoreInsertion(target, finalOrbit, geometry.inclination, outcome === "orbit" || outcome === "escape")
      : null;
  const finalAltitude = Math.hypot(s[X], s[Y]) - R_EARTH;

  return {
    vehicle: vehicle.name,
    mission: mission.name,
    outcome,
    events,
    samples,
    summary: {
      // An escape has no apogee: report how high it was when the simulation let go.
      apogee: outcome === "orbit" && orbit ? orbit.apoapsis : outcome === "escape" ? finalAltitude : apogee.altitude,
      apogeeTime: apogee.t,
      maxQ,
      maxQAlpha,
      maxBuffetLoad: maxBuffet,
      burnoutVelocity: burnout.velocity,
      burnoutGroundSpeed: burnout.groundSpeed,
      burnoutAltitude: burnout.altitude,
      burnoutTime: burnout.t,
      burnoutFlightPathAngle: burnout.flightPathAngle,
      burnoutDownrange: burnout.downrange,
      propellantMargin: phase.burning ? 0 : propellant,
      azimuth: geometry.azimuth,
      inclination: geometry.inclination,
      rotationBoost,
      orbit,
      insertion,
      idealDeltaV: s[9],
      losses: { gravity: s[5], drag: s[6], backPressure: s[7], steering: s[8] },
      ...(controlSummary ? { control: controlSummary } : {}),
    },
  };
}

/** What is feeding a growing oscillation most, from a step's figures. */
function growthCause(c: { cause: Cause | null; divergence: number; bendingGain: number; rateUse: number }): Cause {
  if (c.cause) return c.cause;
  if (c.bendingGain > 0.25) return "bending";
  if (c.rateUse > 1) return "rate";
  if (c.divergence > 0.25) return "divergence";
  return "slosh";
}
