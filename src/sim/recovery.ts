import { atmosphereAt } from "./atmosphere.ts";
import { G0, MU_EARTH, R_EARTH } from "./constants.ts";
import { massFlow, thrustAt, type Engine } from "./engine.ts";
import { hashSeed, rng } from "./random.ts";

/**
 * Bringing the booster home. After separation the spent first stage flips,
 * and either burns back toward the launch site (RTLS) or falls on toward a
 * drone ship waiting where its arc comes down. It burns again high up to
 * keep re-entry heating down, steers through the thick air on its grid fins,
 * and lights once more at the last moment to land. Every burn after the
 * first is a relight: an engine that won't restart can't come home.
 *
 * The booster flies its own point-mass path in the plane of the ascent, on
 * the same Earth, gravity and air as the ascent; it flies engines first, a
 * blunt base into the wind. Its guidance predicts where it will come down,
 * drag and entry burn included, and burns back until that is the pad.
 */

export type RecoveryMode = "rtls" | "drone-ship";

export type RecoveryDesign = {
  mode: RecoveryMode;
  /** Share of the booster's propellant held back for the flight home. */
  reserve: number;
  /** Landing legs. Without them there is nothing to land on. */
  legs: boolean;
  /** Grid fins: steering through the descent, a landing in metres instead of a hundred. */
  gridFins: boolean;
};

export const RECOVERY_RANGES = { reserve: [0.03, 0.4] as [number, number] };

export const RECOVERY_LABELS: Record<RecoveryMode, string> = { rtls: "Back to the launch site", "drone-ship": "Drone ship downrange" };

export function defaultRecovery(mode: RecoveryMode = "drone-ship"): RecoveryDesign {
  return { mode, reserve: mode === "rtls" ? 0.22 : 0.12, legs: true, gridFins: true };
}

/** Dry mass the recovery hardware adds to a booster, kg: legs, grid fins and the base heat shield. */
export function recoveryMass(r: RecoveryDesign, boosterDry: number, diameter: number): number {
  return (r.legs ? 0.06 * boosterDry : 0) + (r.gridFins ? 40 * diameter * diameter : 0) + 0.02 * boosterDry;
}

/** Heating rate (½ρv³, W/m²) a base heat shield takes without damage. */
export const ENTRY_HEATING = 1.5e7;
/** Above this the engines don't survive the entry. */
export const ENTRY_LETHAL = 2.5 * ENTRY_HEATING;
/** Fastest touchdown the legs take, m/s. */
export const TOUCHDOWN_SPEED = 6;
/** How far off the pad or deck still counts, m. */
export const PAD_RADIUS = { rtls: 45, "drone-ship": 25 } as const;
/** Landing scatter (1σ, m) with and without grid fins. */
export const LANDING_SCATTER = { fins: 10, bare: 120 };
/** The entry burn aims for this share of the heating limit, a margin for the air being thicker than the model's. */
const ENTRY_AIM = 0.8;
/** Scale height of the air the booster enters, m. */
const SCALE_HEIGHT = 7_200;
/** Lift coefficient of the grid fins steering, on the base area: a lift-to-drag of about a third. */
const FIN_LIFT = 0.35;

export type RecoveryCause = "no-relight" | "out-of-propellant" | "entry-heating" | "hard-landing" | "missed-pad" | "no-legs";

export const RECOVERY_CAUSE_LABELS: Record<RecoveryCause, string> = {
  "no-relight": "the engines wouldn't relight",
  "out-of-propellant": "out of propellant before touchdown",
  "entry-heating": "burned up on entry",
  "hard-landing": "landed too hard",
  "missed-pad": "missed the landing zone",
  "no-legs": "no legs to land on",
};

/** Where and how the booster came off the stack. */
export type Separation = {
  t: number;
  /** Inertial position and velocity in the plane of the ascent, m and m/s. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Propellant it kept back, and its own dry mass, kg. */
  propellant: number;
  dryMass: number;
  /** In-plane rotation rate of the Earth and its air, rad/s. */
  omega: number;
};

export type RecoverySample = { t: number; altitude: number; downrange: number; speed: number; burning: boolean };

export type RecoveryResult = {
  outcome: "landed" | "lost";
  cause?: RecoveryCause;
  mode: RecoveryMode;
  samples: RecoverySample[];
  /** Burns flown and the propellant each took, kg. */
  burns: Array<{ name: "boostback" | "entry" | "landing"; t: number; propellant: number }>;
  /** Peak ½ρv³ on the way down, W/m². */
  peakHeating: number;
  propellantLeft: number;
  touchdown: { speed: number; miss: number } | null;
  /** Where it came down, m downrange of the pad (negative is behind it). */
  landedAt: number;
  /** Where it started from. */
  separation: Separation;
};

/** The booster as it flies home. */
export type Booster = { engine: Engine; engineCount: number; diameter: number; recovery: RecoveryDesign };

export type RecoveryOptions = {
  /** The engine truly won't restart. */
  relightFails?: boolean;
  /** Seed for the landing scatter and the sea state; left out, a calm nominal landing. */
  seed?: number;
  /** Surface wind along track, m/s: drift on the way down. */
  surfaceWind?: number;
};

/** Drag of a stage flying base first: blunt, with the grid fins adding a little. */
function baseFirstCd(mach: number, fins: boolean): number {
  const cd = mach < 0.8 ? 0.8 : mach < 1.2 ? 0.8 + ((mach - 0.8) / 0.4) * 0.5 : mach < 3 ? 1.3 - ((mach - 1.2) / 1.8) * 0.25 : 1.05;
  return cd + (fins ? 0.15 : 0);
}

type Body = { x: number; y: number; vx: number; vy: number; t: number; propellant: number };

/** The booster's physics, for flying it and for predicting where it lands. */
function physics(b: Booster, sep: Separation) {
  const omega = sep.omega;
  const r = b.recovery;
  const area = (Math.PI * b.diameter * b.diameter) / 4;
  const flowPer = massFlow(b.engine);
  const mass = (s: Body) => sep.dryMass + s.propellant;
  const local = (s: Body) => {
    const radius = Math.hypot(s.x, s.y);
    const up: [number, number] = [s.x / radius, s.y / radius];
    const horizontal: [number, number] = [up[1], -up[0]];
    // The ground and air move with ω × r along +horizontal.
    const gx = s.vx - omega * s.y;
    const gy = s.vy + omega * s.x;
    return { radius, altitude: radius - R_EARTH, up, horizontal, vUp: gx * up[0] + gy * up[1], vH: gx * horizontal[0] + gy * horizontal[1], gx, gy, air: Math.hypot(gx, gy) };
  };
  /**
   * Advance one step; thrust along `dir` (horizontal, up) at a share of full,
   * and the fins asked for `lateral` m/s² of lift along the ground (they give
   * what the air lets them). Returns ½ρv³ on the base at the start of the step.
   */
  const step = (s: Body, dt: number, dir: [number, number] | null, engines: number, throttle = 1, lateral = 0): number => {
    const l = local(s);
    const atm = atmosphereAt(l.altitude);
    const mach = l.air / atm.speedOfSound;
    const q = 0.5 * atm.density * l.air * l.air;
    const drag = q * baseFirstCd(mach, r.gridFins) * area;
    const m = mass(s);
    const g = MU_EARTH / (l.radius * l.radius);
    let ax = -g * l.up[0] - (l.air > 1e-6 ? (drag * l.gx) / l.air / m : 0);
    let ay = -g * l.up[1] - (l.air > 1e-6 ? (drag * l.gy) / l.air / m : 0);
    if (lateral && r.gridFins) {
      const most = (q * FIN_LIFT * area) / m;
      const lift = Math.max(-most, Math.min(most, lateral));
      ax += lift * l.horizontal[0];
      ay += lift * l.horizontal[1];
    }
    if (dir && engines > 0 && s.propellant > 0) {
      const thrust = engines * thrustAt(b.engine, atm.pressure) * throttle;
      ax += (thrust * (dir[0] * l.horizontal[0] + dir[1] * l.up[0])) / m;
      ay += (thrust * (dir[0] * l.horizontal[1] + dir[1] * l.up[1])) / m;
      s.propellant = Math.max(0, s.propellant - engines * flowPer * throttle * dt);
    }
    s.vx += ax * dt;
    s.vy += ay * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.t += dt;
    // Only the way down heats the base: going up, it's still flying nose first.
    return l.vUp < 0 ? q * l.air : 0;
  };
  const downrangeOf = (s: Body) => {
    let a = Math.atan2(s.x, s.y) - omega * s.t;
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return R_EARTH * a;
  };
  // What the landing burn will need: stopping from the speed it falls at near the ground, gravity losses included.
  const seaLevel = thrustAt(b.engine, 101_325);
  const landingNeed = () => {
    const terminal = Math.sqrt((2 * sep.dryMass * G0) / (1.225 * baseFirstCd(0.5, r.gridFins) * area));
    return sep.dryMass * (Math.exp((1.4 * terminal) / (seaLevel / flowPer)) - 1);
  };
  /** ½ρv³ on the base, W/m². */
  const heatingAt = (s: Body) => {
    const l = local(s);
    return l.vUp < 0 ? 0.5 * atmosphereAt(l.altitude).density * l.air ** 3 : 0;
  };
  /**
   * The fastest it can meet the air at and keep the peak heating to the
   * shield's aim. Allen and Eggers: falling ballistically into an
   * exponential atmosphere, ½ρv³ peaks at β·sinγ·v³ / (3·H·e), β = m / (Cd·A).
   * Gravity, which they leave out, keeps it speeding up: the real peak runs
   * about twice that.
   */
  const entryTarget = (s: Body) => {
    const l = local(s);
    const beta = mass(s) / (baseFirstCd(4, r.gridFins) * area);
    const sinGamma = Math.max(0.05, -l.vUp / Math.max(1, l.air));
    return Math.cbrt((ENTRY_AIM * ENTRY_HEATING * 3 * SCALE_HEIGHT * Math.E) / (2 * beta * sinGamma));
  };
  /** Entry burn: retrograde on the way down from 70 km, until it's no faster than it can enter at. It never touches what the landing needs. */
  const entryDue = (s: Body) => {
    const l = local(s);
    return l.vUp < 0 && l.altitude < 70_000 && l.altitude > 8_000 && l.air > entryTarget(s) && s.propellant > landingNeed();
  };
  /** Where it comes down from here, coasting and flying the entry burn, drag included, m downrange. */
  const predictLanding = (from: Body, engines: number): number => {
    const s = { ...from };
    for (let n = 0; n < 4000; n++) {
      const l = local(s);
      if (l.altitude <= 0) break;
      const burn = entryDue(s);
      step(s, 0.5, burn ? [-l.vH / l.air, -l.vUp / l.air] : null, burn ? engines : 0);
    }
    return downrangeOf(s);
  };
  /** Burning retrograde at a fixed throttle from here, the altitude it stops at, m; below zero if it hits the ground still falling. */
  const stopsAt = (from: Body, engines: number, throttle: number): number => {
    const s = { ...from };
    for (let n = 0; n < 2000; n++) {
      const l = local(s);
      if (l.vUp >= 0) return l.altitude;
      if (l.altitude <= 0) return l.altitude - (l.vUp * l.vUp) / 20;
      step(s, 0.2, l.air > 1 ? [-l.vH / l.air, -l.vUp / l.air] : [0, 1], engines, throttle);
    }
    return local(s).altitude;
  };
  return { mass, local, step, downrangeOf, entryDue, predictLanding, stopsAt };
}

const DT = 0.1;

/** Fly the booster home from separation. */
export function flyHome(b: Booster, sep: Separation, o: RecoveryOptions = {}): RecoveryResult {
  const r = b.recovery;
  const p = physics(b, sep);
  const s: Body = { x: sep.x, y: sep.y, vx: sep.vx, vy: sep.vy, t: sep.t, propellant: sep.propellant };
  // The high burns light a third of the engines (three of nine, as boosters do); the landing, the fewest that can stop it.
  const burnEngines = Math.max(1, Math.ceil(b.engineCount / 3));
  const samples: RecoverySample[] = [];
  const burns: RecoveryResult["burns"] = [];
  let peakHeating = 0;
  const random = rng(hashSeed(`${o.seed ?? 0}:landing`));
  const scatter = o.seed === undefined ? 0 : gaussian(random) * (r.gridFins ? LANDING_SCATTER.fins : LANDING_SCATTER.bare);

  const fly = (dir: [number, number] | null, engines: number, throttle = 1, lateral = 0) => {
    peakHeating = Math.max(peakHeating, p.step(s, DT, dir, engines, throttle, lateral));
    if (samples.length === 0 || s.t - samples.at(-1)!.t >= 1) {
      const l = p.local(s);
      samples.push({ t: s.t, altitude: l.altitude, downrange: p.downrangeOf(s), speed: l.air, burning: !!dir && s.propellant > 0 });
    }
  };
  const coastToGround = (cause: RecoveryCause): RecoveryResult => {
    for (let n = 0; n < 40_000 && p.local(s).altitude > 0; n++) fly(null, 0);
    return { outcome: "lost", cause, mode: r.mode, samples, burns, peakHeating, propellantLeft: s.propellant, touchdown: null, landedAt: p.downrangeOf(s), separation: sep };
  };
  let relit = false;
  const relight = (): boolean => {
    if (relit) return true;
    relit = true;
    return !o.relightFails;
  };

  // 1. Flip: ten seconds of coast while the thrusters turn it round.
  for (let i = 0; i < 100; i++) fly(null, 0);

  // 2. Boostback: burn uprange until the predicted landing, drag and entry burn included, is the pad.
  // The drone ship is waiting where the arc comes down; it skips this.
  if (r.mode === "rtls") {
    if (!relight()) return coastToGround("no-relight");
    const before = s.propellant;
    let predicted = p.predictLanding(s, burnEngines);
    for (let n = 0; predicted > 0 && s.propellant > 0 && n < 4000; n++) {
      fly([-0.985, 0.17], burnEngines);
      // Re-aim every second, every step once it's close: a second of boostback moves the landing kilometres.
      if (predicted < 30_000 || n % 10 === 9) predicted = p.predictLanding(s, burnEngines);
    }
    burns.push({ name: "boostback", t: s.t, propellant: before - s.propellant });
    if (s.propellant <= 0) return coastToGround("out-of-propellant");
  }
  const target = r.mode === "rtls" ? 0 : p.predictLanding(s, burnEngines);

  // The grid fins steer the rest of the way: every second, where it would come down, and lift toward the pad.
  let lateral = 0;
  const steer = (n: number) => {
    if (!r.gridFins || n % 10 !== 0) return;
    const l = p.local(s);
    if (l.altitude > 70_000 || l.vUp >= 0) return;
    const miss = target - p.predictLanding(s, burnEngines);
    const tgo = l.altitude / Math.max(50, -l.vUp);
    lateral = (3 * miss) / (tgo * tgo);
  };

  // 3–4. Coast over the top and down; the entry burn lights when it's too fast to meet the air, as often as it needs to.
  let entry: { t: number; before: number } | null = null;
  for (let n = 0; n < 40_000 && p.local(s).altitude > 5_000; n++) {
    steer(n);
    if (p.entryDue(s)) {
      if (!entry) {
        if (!relight()) return coastToGround("no-relight");
        entry = { t: s.t, before: s.propellant };
      }
      const l = p.local(s);
      fly([-l.vH / l.air, -l.vUp / l.air], burnEngines, 1, lateral);
    } else fly(null, 0, 1, lateral);
  }
  if (entry) burns.push({ name: "entry", t: entry.t, propellant: entry.before - s.propellant });

  // 5. Through the thick air on the fins, until it's time to light for landing.
  const landingEngines = () => {
    const w = p.mass(s) * G0;
    for (let n = 1; n <= b.engineCount; n++) if (n * thrustAt(b.engine, 101_325) > 1.4 * w) return n;
    return b.engineCount;
  };
  for (let n = 0; n < 40_000; n++) {
    const l = p.local(s);
    if (l.altitude <= 0) break;
    // Light when, burning at four-fifths thrust from here, it would only just stop above the ground.
    // Drag still slowing it is in that prediction: high up the air does most of the braking.
    const engines = landingEngines();
    const full = engines * thrustAt(b.engine, 101_325);
    if (l.vUp < 0 && (l.vUp * l.vUp) / (2 * Math.max(0.1, full / p.mass(s) - G0)) >= l.altitude - 10 && p.stopsAt(s, engines, 0.8) <= 5) break;
    steer(n);
    fly(null, 0, 1, lateral);
  }
  if (peakHeating > ENTRY_LETHAL) return coastToGround("entry-heating");

  // 6. Landing burn: the steady deceleration that stops it just above the ground, re-solved every step.
  if (!relight()) return coastToGround("no-relight");
  const before = s.propellant;
  // The engines lit stay lit to the ground: it lightens as it burns, and throttles down instead.
  const engines = landingEngines();
  for (let n = 0; n < 3000; n++) {
    const l = p.local(s);
    if (l.altitude <= 0) break;
    if (s.propellant <= 0) {
      burns.push({ name: "landing", t: s.t, propellant: before });
      return coastToGround("out-of-propellant");
    }
    const full = engines * thrustAt(b.engine, atmosphereAt(l.altitude).pressure);
    // Stop two metres up, then settle the last of it at a walking pace.
    const high = l.vUp < -2;
    const decel = high ? (l.vUp * l.vUp) / (2 * Math.max(0.5, l.altitude - 2)) : (-1.5 - l.vUp) / 0.5;
    // Lean the thrust to come down on the pad: close the gap and kill the drift in the time left.
    const tgo = high ? (2 * Math.max(0.5, l.altitude - 2)) / -l.vUp : 0.5;
    const gap = target - p.downrangeOf(s);
    const most = 0.4 * (G0 + decel);
    const sideways = Math.max(-most, Math.min(most, high ? (2 * (gap - l.vH * tgo)) / (tgo * tgo) : -l.vH / 0.5));
    const up = G0 + decel;
    const want = Math.hypot(sideways, up);
    const throttle = Math.min(1, Math.max(0.35, (p.mass(s) * want) / full));
    fly([sideways / want, up / want], engines, throttle);
  }
  burns.push({ name: "landing", t: s.t, propellant: before - s.propellant });

  const l = p.local(s);
  const speed = Math.hypot(l.vUp, l.vH);
  // Where it came down against the pad, the scatter the model doesn't fly, and drift in the surface wind.
  const miss = Math.abs(p.downrangeOf(s) - target) + Math.abs(scatter) + Math.abs(o.surfaceWind ?? 0) * (r.gridFins ? 0.5 : 3);
  const done = (outcome: "landed" | "lost", cause?: RecoveryCause): RecoveryResult => ({
    outcome,
    ...(cause ? { cause } : {}),
    mode: r.mode,
    samples,
    burns,
    peakHeating,
    propellantLeft: s.propellant,
    touchdown: { speed, miss },
    landedAt: p.downrangeOf(s),
    separation: sep,
  });
  if (!r.legs) return done("lost", "no-legs");
  if (speed > TOUCHDOWN_SPEED) return done("lost", "hard-landing");
  // The drone ship's deck heaves: on a rough day the landing zone is smaller.
  const sea = r.mode === "drone-ship" && o.seed !== undefined ? 0.7 + 0.3 * random() : 1;
  if (miss > PAD_RADIUS[r.mode] * sea) return done("lost", "missed-pad");
  return done("landed");
}

function gaussian(random: () => number): number {
  const u = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}
