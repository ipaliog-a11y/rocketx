import { dragCoefficient, dynamicPressure, referenceArea } from "./aero.ts";
import { atmosphereAt } from "./atmosphere.ts";
import { G0, MU_EARTH, R_EARTH } from "./constants.ts";
import { flowSeparates, massFlow, thrustAt } from "./engine.ts";
import { commandedPitch, kickDue, VERTICAL } from "./guidance.ts";
import { isOrbit, orbitFrom, type OrbitElements } from "./orbit.ts";
import { burnTime, stackMass, type Stage, type Vehicle } from "./vehicle.ts";

/**
 * Two-dimensional ascent in the plane of the trajectory. Position and
 * velocity are inertial, measured from Earth's centre, with the pad at
 * (0, R) and downrange along +x. Earth does not rotate, so the pad gives
 * no free eastward velocity and air moves with the ground.
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
  | "staging"
  | "orbit"
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
  /** Event-specific number: q for max-q, T/W for liftoff, pressure for separation. */
  value?: number;
};

export type Sample = {
  t: number;
  altitude: number;
  /** Ground distance from the pad along the surface, m. */
  downrange: number;
  /** Inertial speed, m/s. */
  velocity: number;
  verticalVelocity: number;
  horizontalVelocity: number;
  /** Rate of change of speed, m/s². */
  acceleration: number;
  mass: number;
  mach: number;
  dynamicPressure: number;
  thrust: number;
  drag: number;
  /** Thrust direction above the local horizon, deg. */
  pitch: number;
  /** Velocity direction above the local horizon, deg. */
  flightPathAngle: number;
  /** Angle between thrust and the airflow, deg. */
  angleOfAttack: number;
  stage: number;
};

export type Losses = {
  /** Δv spent holding the vehicle up against gravity while burning, m/s. */
  gravity: number;
  /** Δv spent pushing air out of the way while burning, m/s. */
  drag: number;
  /** Δv lost to ambient pressure on the nozzle exit (F_vac − F), m/s. */
  backPressure: number;
  /** Δv spent turning: thrust that pointed off the velocity vector, m/s. */
  steering: number;
};

/** "apogee" means the flight topped out and fell back: suborbital. */
export type Outcome = "no-liftoff" | "orbit" | "apogee" | "impact" | "timeout";

export type FlightResult = {
  vehicle: string;
  outcome: Outcome;
  events: FlightEvent[];
  samples: Sample[];
  summary: {
    apogee: number;
    apogeeTime: number;
    maxQ: { value: number; t: number; altitude: number; velocity: number; mach: number; stage: number };
    /** Peak dynamic pressure × angle of attack, Pa·deg. */
    maxQAlpha: { value: number; t: number; altitude: number; mach: number };
    burnoutVelocity: number;
    burnoutAltitude: number;
    burnoutTime: number;
    burnoutFlightPathAngle: number;
    burnoutDownrange: number;
    /** Orbit the vehicle was on at final burnout. */
    orbit: OrbitElements | null;
    /** Integrated vacuum Δv actually delivered, m/s. */
    idealDeltaV: number;
    losses: Losses;
  };
};

export type AscentOptions = {
  /** Integration step, s. */
  dt?: number;
  /** Interval between recorded samples, s. */
  sampleInterval?: number;
  /** Give up after this much flight time, s. */
  maxTime?: number;
};

/** [x, y, vx, vy, mass, gravity, drag, back-pressure, steering, ideal Δv] */
type State = [number, number, number, number, number, number, number, number, number, number];

const X = 0, Y = 1, VX = 2, VY = 3, M = 4;
const DEG = 180 / Math.PI;

type Phase = {
  stage: Stage;
  stageIndex: number;
  /** Flight time this stage ignited, s. */
  ignitedAt: number;
  burning: boolean;
  area: number;
  kickStart: number | null;
};

/** Everything the integrator and the event checks need at one instant. */
type Snapshot = {
  altitude: number;
  speed: number;
  /** Unit vectors: local up, local horizontal (downrange), velocity direction. */
  up: [number, number];
  horizontal: [number, number];
  heading: [number, number];
  flightPathAngle: number;
  pitch: number;
  thrustDir: [number, number];
  angleOfAttack: number;
  thrust: number;
  drag: number;
  mach: number;
  q: number;
  pressure: number;
  gravity: number;
};

function snapshot(vehicle: Vehicle, phase: Phase, t: number, s: State): Snapshot {
  const r = Math.hypot(s[X], s[Y]);
  const altitude = r - R_EARTH;
  const up: [number, number] = [s[X] / r, s[Y] / r];
  const horizontal: [number, number] = [up[1], -up[0]];
  const speed = Math.hypot(s[VX], s[VY]);
  const vUp = s[VX] * up[0] + s[VY] * up[1];
  const vHorizontal = s[VX] * horizontal[0] + s[VY] * horizontal[1];
  const flightPathAngle = speed > 1e-9 ? Math.atan2(vUp, vHorizontal) : Math.PI / 2;

  const stageBurnFraction = phase.burning ? Math.min(1, (t - phase.ignitedAt) / burnTime(phase.stage)) : 1;
  const pitch = commandedPitch(vehicle.pitchProgram ?? VERTICAL, {
    t,
    kickStart: phase.kickStart,
    flightPathAngle,
    stage: phase.stageIndex,
    stageBurnFraction,
  });
  const thrustDir: [number, number] = [
    Math.cos(pitch) * horizontal[0] + Math.sin(pitch) * up[0],
    Math.cos(pitch) * horizontal[1] + Math.sin(pitch) * up[1],
  ];
  const heading: [number, number] = speed > 1e-9 ? [s[VX] / speed, s[VY] / speed] : thrustDir;
  const cosAlpha = Math.min(1, Math.max(-1, thrustDir[0] * heading[0] + thrustDir[1] * heading[1]));

  const atm = atmosphereAt(altitude);
  const mach = speed / atm.speedOfSound;
  const q = dynamicPressure(atm.density, speed);
  return {
    altitude,
    speed,
    up,
    horizontal,
    heading,
    flightPathAngle,
    pitch,
    thrustDir,
    angleOfAttack: Math.acos(cosAlpha),
    thrust: phase.burning ? phase.stage.engineCount * thrustAt(phase.stage.engine, atm.pressure) : 0,
    drag: q * dragCoefficient(vehicle.dragCurve, mach) * phase.area,
    mach,
    q,
    pressure: atm.pressure,
    gravity: MU_EARTH / (r * r),
  };
}

function derivative(vehicle: Vehicle, phase: Phase, t: number, s: State): State {
  const m = s[M];
  const k = snapshot(vehicle, phase, t, s);
  const ax = (k.thrust * k.thrustDir[0] - k.drag * k.heading[0]) / m - k.gravity * k.up[0];
  const ay = (k.thrust * k.thrustDir[1] - k.drag * k.heading[1]) / m - k.gravity * k.up[1];
  if (!phase.burning) return [s[VX], s[VY], ax, ay, 0, 0, 0, 0, 0, 0];

  // Rates that split d|v|/dt into what the engines gave and where it went.
  const { engine, engineCount } = phase.stage;
  const thrustVac = engineCount * engine.thrustVac;
  const cosAlpha = Math.cos(k.angleOfAttack);
  return [
    s[VX],
    s[VY],
    ax,
    ay,
    -engineCount * massFlow(engine),
    k.gravity * Math.sin(k.flightPathAngle),
    k.drag / m,
    (thrustVac - k.thrust) / m,
    (k.thrust * (1 - cosAlpha)) / m,
    thrustVac / m,
  ];
}

function rk4(vehicle: Vehicle, phase: Phase, t: number, s: State, dt: number): State {
  const add = (a: State, b: State, k: number): State => a.map((x, i) => x + k * b[i]!) as State;
  const k1 = derivative(vehicle, phase, t, s);
  const k2 = derivative(vehicle, phase, t + dt / 2, add(s, k1, dt / 2));
  const k3 = derivative(vehicle, phase, t + dt / 2, add(s, k2, dt / 2));
  const k4 = derivative(vehicle, phase, t + dt, add(s, k3, dt));
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

function downrangeOf(s: State): number {
  return R_EARTH * Math.atan2(s[X], s[Y]);
}

export function simulateAscent(vehicle: Vehicle, options: AscentOptions = {}): FlightResult {
  const dt = options.dt ?? 0.05;
  const sampleInterval = options.sampleInterval ?? 1;
  const maxTime = options.maxTime ?? 3600;
  if (vehicle.stages.length === 0) throw new Error(`${vehicle.name} has no stages`);
  const program = vehicle.pitchProgram ?? VERTICAL;

  const events: FlightEvent[] = [];
  const samples: Sample[] = [];

  let t = 0;
  let stageIndex = 0;
  let propellant = vehicle.stages[0]!.propellantMass;
  let s: State = [0, R_EARTH, 0, 0, stackMass(vehicle, 0), 0, 0, 0, 0, 0];
  let phase: Phase = {
    stage: vehicle.stages[0]!,
    stageIndex: 0,
    ignitedAt: 0,
    burning: true,
    area: frontalArea(vehicle, 0),
    kickStart: null,
  };

  let liftedOff = false;
  let passedMach1 = false;
  let qLimitHit = false;
  let qAlphaLimitHit = false;
  let accelLimitHit = false;
  let nextSampleAt = 0;
  let outcome: Outcome = "timeout";
  let maxQ = { value: 0, t: 0, altitude: 0, velocity: 0, mach: 0, stage: 0 };
  let maxQAlpha = { value: 0, t: 0, altitude: 0, mach: 0 };
  let burnout = { t: 0, altitude: 0, velocity: 0, flightPathAngle: 0, downrange: 0 };
  let orbit: OrbitElements | null = null;
  let apogee = { t: 0, altitude: 0 };

  const event = (kind: EventKind, k: Snapshot, value?: number) => {
    events.push({ kind, t, altitude: k.altitude, velocity: k.speed, mach: k.mach, stage: stageIndex, value });
  };

  const record = (k: Snapshot) => {
    const d = derivative(vehicle, phase, t, s);
    samples.push({
      t,
      altitude: k.altitude,
      downrange: downrangeOf(s),
      velocity: k.speed,
      verticalVelocity: k.speed * Math.sin(k.flightPathAngle),
      horizontalVelocity: k.speed * Math.cos(k.flightPathAngle),
      acceleration: d[VX] * k.heading[0] + d[VY] * k.heading[1],
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

  const ignite = () => {
    const k = snapshot(vehicle, phase, t, s);
    event("ignition", k);
    if (flowSeparates(phase.stage.engine, k.pressure)) event("flow-separation", k, k.pressure);
  };

  ignite();
  const pad = snapshot(vehicle, phase, 0, s);
  const thrustToWeight = pad.thrust / (s[M] * pad.gravity);
  if (thrustToWeight <= 1) {
    event("no-liftoff", pad, thrustToWeight);
    record(pad);
    outcome = "no-liftoff";
  }

  while (outcome === "timeout" && t < maxTime) {
    const flow = phase.burning ? phase.stage.engineCount * massFlow(phase.stage.engine) : 0;
    const step = phase.burning ? Math.min(dt, propellant / flow) : dt;
    const prevVerticalSpeed = s[VX] * (s[X] / Math.hypot(s[X], s[Y])) + s[VY] * (s[Y] / Math.hypot(s[X], s[Y]));
    const prevSpeed = Math.hypot(s[VX], s[VY]);

    s = rk4(vehicle, phase, t, s, step);
    t += step;
    if (phase.burning) propellant = Math.max(0, propellant - flow * step);

    let k = snapshot(vehicle, phase, t, s);

    if (!liftedOff && k.altitude > 0) {
      liftedOff = true;
      event("liftoff", k, thrustToWeight);
    }
    if (liftedOff && k.altitude < 0) {
      event("impact", k);
      outcome = "impact";
      record(k);
      break;
    }

    if (phase.kickStart === null && kickDue(program, k.speed) && program.kind === "gravity-turn") {
      // Start the kick at the interpolated moment the speed crossed, not at the
      // end of the step, so the trajectory doesn't depend on the step size.
      const crossed = (program.kickSpeed - prevSpeed) / (k.speed - prevSpeed);
      phase = { ...phase, kickStart: t - step * (1 - Math.min(1, Math.max(0, crossed))) };
      event("pitch-kick", k, program.kind === "gravity-turn" ? program.kickAngle : undefined);
    }

    if (k.q > maxQ.value) maxQ = { value: k.q, t, altitude: k.altitude, velocity: k.speed, mach: k.mach, stage: stageIndex };
    const qAlpha = k.q * k.angleOfAttack * DEG;
    if (phase.burning && qAlpha > maxQAlpha.value) maxQAlpha = { value: qAlpha, t, altitude: k.altitude, mach: k.mach };
    if (!passedMach1 && k.mach >= 1) {
      passedMach1 = true;
      event("mach-1", k);
    }
    if (!qLimitHit && k.q > vehicle.limits.maxDynamicPressure) {
      qLimitHit = true;
      event("q-limit-exceeded", k, k.q);
    }
    const qAlphaLimit = vehicle.limits.maxQAlpha;
    if (!qAlphaLimitHit && phase.burning && qAlphaLimit !== undefined && qAlpha > qAlphaLimit) {
      qAlphaLimitHit = true;
      event("q-alpha-limit-exceeded", k, qAlpha);
    }
    const axialG = (k.thrust - k.drag) / s[M] / G0;
    if (!accelLimitHit && axialG > vehicle.limits.maxAcceleration) {
      accelLimitHit = true;
      event("accel-limit-exceeded", k, axialG);
    }

    if (phase.burning && propellant <= 1e-9) {
      event("meco", k);
      burnout = {
        t,
        altitude: k.altitude,
        velocity: k.speed,
        flightPathAngle: k.flightPathAngle * DEG,
        downrange: downrangeOf(s),
      };
      const next = vehicle.stages[stageIndex + 1];
      if (next) {
        s[M] -= phase.stage.dryMass;
        stageIndex += 1;
        propellant = next.propellantMass;
        phase = { ...phase, stage: next, stageIndex, ignitedAt: t, area: frontalArea(vehicle, stageIndex) };
        k = snapshot(vehicle, phase, t, s);
        event("staging", k);
        ignite();
      } else {
        phase = { ...phase, burning: false };
        k = snapshot(vehicle, phase, t, s);
        orbit = orbitFrom(s[X], s[Y], s[VX], s[VY]);
        if (isOrbit(orbit)) {
          event("orbit", k, orbit.periapsis);
          outcome = "orbit";
          record(k);
          break;
        }
      }
    }

    const verticalSpeed = k.speed * Math.sin(k.flightPathAngle);
    if (!phase.burning && prevVerticalSpeed > 0 && verticalSpeed <= 0) {
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

  if (outcome === "timeout") {
    events.push({ kind: "timeout", t, altitude: Math.hypot(s[X], s[Y]) - R_EARTH, velocity: Math.hypot(s[VX], s[VY]), mach: 0, stage: stageIndex });
  }
  if (maxQ.value > 0) {
    const { value, ...at } = maxQ;
    events.push({ kind: "max-q", ...at, value });
    events.sort((a, b) => a.t - b.t);
  }

  return {
    vehicle: vehicle.name,
    outcome,
    events,
    samples,
    summary: {
      apogee: outcome === "orbit" && orbit ? orbit.apoapsis : apogee.altitude,
      apogeeTime: apogee.t,
      maxQ,
      maxQAlpha,
      burnoutVelocity: burnout.velocity,
      burnoutAltitude: burnout.altitude,
      burnoutTime: burnout.t,
      burnoutFlightPathAngle: burnout.flightPathAngle,
      burnoutDownrange: burnout.downrange,
      orbit,
      idealDeltaV: s[9],
      losses: { gravity: s[5], drag: s[6], backPressure: s[7], steering: s[8] },
    },
  };
}
