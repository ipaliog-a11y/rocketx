import { dragCoefficient, dynamicPressure, referenceArea } from "./aero.ts";
import { atmosphereAt } from "./atmosphere.ts";
import { G0, gravityAt } from "./constants.ts";
import { flowSeparates, massFlow, thrustAt } from "./engine.ts";
import { stackMass, type Stage, type Vehicle } from "./vehicle.ts";

/**
 * One-dimensional vertical ascent. The vehicle points straight up for the
 * whole flight, so this answers "how high and how hard" but cannot reach
 * orbit: that needs a pitch programme and a second axis.
 */

export type EventKind =
  | "ignition"
  | "liftoff"
  | "no-liftoff"
  | "flow-separation"
  | "mach-1"
  | "max-q"
  | "q-limit-exceeded"
  | "accel-limit-exceeded"
  | "meco"
  | "staging"
  | "apogee"
  | "impact"
  | "timeout";

export type FlightEvent = {
  kind: EventKind;
  t: number;
  altitude: number;
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
  velocity: number;
  /** Net acceleration, m/s². */
  acceleration: number;
  mass: number;
  mach: number;
  dynamicPressure: number;
  thrust: number;
  drag: number;
  stage: number;
};

export type Losses = {
  /** Δv spent holding the vehicle up against gravity while burning, m/s. */
  gravity: number;
  /** Δv spent pushing air out of the way while burning, m/s. */
  drag: number;
  /** Δv lost to ambient pressure on the nozzle exit (F_vac − F), m/s. */
  backPressure: number;
};

export type Outcome = "no-liftoff" | "apogee" | "impact" | "timeout";

export type FlightResult = {
  vehicle: string;
  outcome: Outcome;
  events: FlightEvent[];
  samples: Sample[];
  summary: {
    apogee: number;
    apogeeTime: number;
    maxQ: { value: number; t: number; altitude: number; velocity: number; mach: number; stage: number };
    burnoutVelocity: number;
    burnoutAltitude: number;
    burnoutTime: number;
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

/** [altitude, velocity, mass, gravity loss, drag loss, back-pressure loss, ideal Δv] */
type State = [number, number, number, number, number, number, number];

type Phase = {
  stage: Stage;
  burning: boolean;
  area: number;
};

type Forces = {
  thrust: number;
  drag: number;
  mach: number;
  q: number;
  pressure: number;
};

function forcesAt(vehicle: Vehicle, phase: Phase, altitude: number, velocity: number): Forces {
  const atm = atmosphereAt(altitude);
  const speed = Math.abs(velocity);
  const mach = speed / atm.speedOfSound;
  const q = dynamicPressure(atm.density, speed);
  const drag = q * dragCoefficient(vehicle.dragCurve, mach) * phase.area;
  const thrust = phase.burning ? phase.stage.engineCount * thrustAt(phase.stage.engine, atm.pressure) : 0;
  return { thrust, drag, mach, q, pressure: atm.pressure };
}

function derivative(vehicle: Vehicle, phase: Phase, s: State): State {
  const [h, v, m] = s;
  const f = forcesAt(vehicle, phase, h, v);
  const g = gravityAt(h);
  const dragAccel = (Math.sign(v) * f.drag) / m;
  const a = f.thrust / m - g - dragAccel;
  if (!phase.burning) return [v, a, 0, 0, 0, 0, 0];

  const { engine, engineCount } = phase.stage;
  const thrustVac = engineCount * engine.thrustVac;
  return [v, a, -engineCount * massFlow(engine), g, dragAccel, (thrustVac - f.thrust) / m, thrustVac / m];
}

function rk4(vehicle: Vehicle, phase: Phase, s: State, dt: number): State {
  const add = (a: State, b: State, k: number): State => a.map((x, i) => x + k * b[i]!) as State;
  const k1 = derivative(vehicle, phase, s);
  const k2 = derivative(vehicle, phase, add(s, k1, dt / 2));
  const k3 = derivative(vehicle, phase, add(s, k2, dt / 2));
  const k4 = derivative(vehicle, phase, add(s, k3, dt));
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

export function simulateAscent(vehicle: Vehicle, options: AscentOptions = {}): FlightResult {
  const dt = options.dt ?? 0.05;
  const sampleInterval = options.sampleInterval ?? 1;
  const maxTime = options.maxTime ?? 3600;
  if (vehicle.stages.length === 0) throw new Error(`${vehicle.name} has no stages`);

  const events: FlightEvent[] = [];
  const samples: Sample[] = [];

  let t = 0;
  let stageIndex = 0;
  let propellant = vehicle.stages[0]!.propellantMass;
  let s: State = [0, 0, stackMass(vehicle, 0), 0, 0, 0, 0];
  let phase: Phase = { stage: vehicle.stages[0]!, burning: true, area: frontalArea(vehicle, 0) };

  let liftedOff = false;
  let passedMach1 = false;
  let qLimitHit = false;
  let accelLimitHit = false;
  let nextSampleAt = 0;
  let outcome: Outcome = "timeout";
  let maxQ = { value: 0, t: 0, altitude: 0, velocity: 0, mach: 0, stage: 0 };
  let burnout = { t: 0, altitude: 0, velocity: 0 };
  let apogee = { t: 0, altitude: 0 };

  const event = (kind: EventKind, f: Forces, value?: number) => {
    events.push({ kind, t, altitude: s[0], velocity: s[1], mach: f.mach, stage: stageIndex, value });
  };

  const record = (f: Forces) => {
    const [h, v, m] = s;
    samples.push({
      t,
      altitude: h,
      velocity: v,
      acceleration: f.thrust / m - gravityAt(h) - (Math.sign(v) * f.drag) / m,
      mass: m,
      mach: f.mach,
      dynamicPressure: f.q,
      thrust: f.thrust,
      drag: f.drag,
      stage: stageIndex,
    });
  };

  const ignite = () => {
    const f = forcesAt(vehicle, phase, s[0], s[1]);
    event("ignition", f);
    if (flowSeparates(phase.stage.engine, f.pressure)) event("flow-separation", f, f.pressure);
  };

  ignite();
  const pad = forcesAt(vehicle, phase, 0, 0);
  const thrustToWeight = pad.thrust / (s[2] * gravityAt(0));
  if (thrustToWeight <= 1) {
    event("no-liftoff", pad, thrustToWeight);
    record(pad);
    outcome = "no-liftoff";
  }

  while (outcome === "timeout" && t < maxTime) {
    const flow = phase.burning ? phase.stage.engineCount * massFlow(phase.stage.engine) : 0;
    const step = phase.burning ? Math.min(dt, propellant / flow) : dt;
    const prevVelocity = s[1];

    s = rk4(vehicle, phase, s, step);
    t += step;
    if (phase.burning) propellant = Math.max(0, propellant - flow * step);

    let f = forcesAt(vehicle, phase, s[0], s[1]);

    if (!liftedOff && s[0] > 0) {
      liftedOff = true;
      event("liftoff", f, thrustToWeight);
    }
    if (liftedOff && s[0] < 0) {
      s[0] = 0;
      event("impact", f);
      outcome = "impact";
      record(f);
      break;
    }

    if (f.q > maxQ.value) maxQ = { value: f.q, t, altitude: s[0], velocity: s[1], mach: f.mach, stage: stageIndex };
    if (!passedMach1 && f.mach >= 1) {
      passedMach1 = true;
      event("mach-1", f);
    }
    if (!qLimitHit && f.q > vehicle.limits.maxDynamicPressure) {
      qLimitHit = true;
      event("q-limit-exceeded", f, f.q);
    }
    const axialG = (f.thrust - f.drag) / s[2] / G0;
    if (!accelLimitHit && axialG > vehicle.limits.maxAcceleration) {
      accelLimitHit = true;
      event("accel-limit-exceeded", f, axialG);
    }

    if (phase.burning && propellant <= 1e-9) {
      event("meco", f);
      burnout = { t, altitude: s[0], velocity: s[1] };
      const next = vehicle.stages[stageIndex + 1];
      if (next) {
        s[2] -= phase.stage.dryMass;
        stageIndex += 1;
        propellant = next.propellantMass;
        phase = { stage: next, burning: true, area: frontalArea(vehicle, stageIndex) };
        f = forcesAt(vehicle, phase, s[0], s[1]);
        event("staging", f);
        ignite();
      } else {
        phase = { ...phase, burning: false };
        f = forcesAt(vehicle, phase, s[0], s[1]);
      }
    }

    if (!phase.burning && prevVelocity > 0 && s[1] <= 0) {
      apogee = { t, altitude: s[0] };
      event("apogee", f);
      outcome = "apogee";
      record(f);
      break;
    }

    if (t >= nextSampleAt) {
      record(f);
      nextSampleAt += sampleInterval;
    }
  }

  if (outcome === "timeout") {
    events.push({ kind: "timeout", t, altitude: s[0], velocity: s[1], mach: 0, stage: stageIndex });
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
      apogee: apogee.altitude,
      apogeeTime: apogee.t,
      maxQ,
      burnoutVelocity: burnout.velocity,
      burnoutAltitude: burnout.altitude,
      burnoutTime: burnout.t,
      idealDeltaV: s[6],
      losses: { gravity: s[3], drag: s[4], backPressure: s[5] },
    },
  };
}
