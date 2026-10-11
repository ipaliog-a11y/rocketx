import { hashSeed, rng } from "./random.ts";
import type { Vehicle } from "./vehicle.ts";

/**
 * What a vehicle's outer shape really does in the air, as opposed to the
 * hand-estimated drag curve on its drawings. Rolled from the run's seed,
 * hidden, and discoverable only by putting the shape in a tunnel.
 */
export type AeroTruth = {
  /** Real drag as a share of the drawing's curve, at every Mach number. */
  dragFactor: number;
  /** Extra drag at the peak of the transonic rise, as a multiplier. 1 means the curve was right. */
  transonicRise: number;
  /**
   * Shock-induced oscillation on the fairing shoulder near Mach 1. The
   * unsteady load is this multiple of dynamic pressure, or 0 for none.
   */
  buffet: number;
};

/** Mach band where shocks sit on the shoulder and can oscillate. */
export const BUFFET_BAND: [number, number] = [0.85, 1.15];

/** Mach band of the transonic drag rise the hand curve may get wrong, peaking near 1.05. */
const RISE_BAND: [number, number, number] = [0.8, 1.05, 1.5];

export const IDEAL_AERO: AeroTruth = { dragFactor: 1, transonicRise: 1, buffet: 0 };

/** The outer mould line that the air sees. Variants that share it share its aero truth. */
export type AeroShape = { key: string; label: string };

export function aeroShape(vehicle: Vehicle): AeroShape {
  const stack = vehicle.stages.map((s) => s.diameter);
  const widest = Math.max(...stack);
  const key = `${vehicle.fairingDiameter}/${stack.join("-")}`;
  const label =
    vehicle.fairingDiameter > widest
      ? `${vehicle.fairingDiameter} m hammerhead fairing on a ${widest} m stack`
      : `${vehicle.fairingDiameter} m fairing on a ${widest} m stack`;
  return { key, label };
}

/** A fairing wider than the stack below it. The step at its shoulder is where buffet lives. */
export function isHammerhead(vehicle: Vehicle): boolean {
  return vehicle.fairingDiameter > Math.max(...vehicle.stages.map((s) => s.diameter));
}

export const DRAG_FACTOR: [number, number] = [0.95, 1.12];
export const TRANSONIC_RISE: [number, number] = [1.0, 1.5];
const BUFFET_SEVERITY: [number, number] = [1.6, 2.6];
const BUFFET_CHANCE = 0.15;
const HAMMERHEAD_BUFFET_CHANCE = 0.65;

export function rollAeroTruth(vehicle: Vehicle, seed: number): AeroTruth {
  const random = rng(hashSeed(`${seed}:aero:${aeroShape(vehicle).key}`));
  const between = ([lo, hi]: [number, number]) => lo + (hi - lo) * random();
  const dragFactor = between(DRAG_FACTOR);
  const transonicRise = between(TRANSONIC_RISE);
  const buffets = random() < (isHammerhead(vehicle) ? HAMMERHEAD_BUFFET_CHANCE : BUFFET_CHANCE);
  const severity = between(BUFFET_SEVERITY);
  return { dragFactor, transonicRise, buffet: buffets ? severity : 0 };
}

/** Hidden aero truths keyed by shape. */
export type AeroTruthTable = Record<string, AeroTruth>;

export function rollAeroTruths(vehicles: Iterable<Vehicle>, seed: number): AeroTruthTable {
  const truths: AeroTruthTable = {};
  for (const vehicle of vehicles) truths[aeroShape(vehicle).key] ??= rollAeroTruth(vehicle, seed);
  return truths;
}

/** How far the real transonic rise reaches at this Mach: 0 outside the band, 1 at its peak. */
function riseWeight(mach: number): number {
  const [lo, peak, hi] = RISE_BAND;
  if (mach <= lo || mach >= hi) return 0;
  return mach < peak ? (mach - lo) / (peak - lo) : (hi - mach) / (hi - peak);
}

/** Real drag over the drawing's drag at this Mach. */
export function dragMultiplier(truth: AeroTruth, mach: number): number {
  return truth.dragFactor * (1 + (truth.transonicRise - 1) * riseWeight(mach));
}

/** Unsteady buffet load at this Mach and dynamic pressure, Pa. 0 outside the band. */
export function buffetLoad(truth: AeroTruth, mach: number, q: number): number {
  return truth.buffet > 0 && mach >= BUFFET_BAND[0] && mach <= BUFFET_BAND[1] ? truth.buffet * q : 0;
}
