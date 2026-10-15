import { COSTS, enginePrice, vehicleCost } from "./cost.ts";
import { MATERIALS } from "./geometry.ts";
import type { FailureMode } from "./hardware.ts";
import { hashSeed, rng } from "./random.ts";
import { ENTRY_HEATING, type RecoveryResult } from "./recovery.ts";
import type { Vehicle } from "./vehicle.ts";

/**
 * The booster fleet. A booster that lands keeps a serial, a flight count
 * and wear it doesn't show. Before it flies again it goes through the
 * hangar: a quick turnaround, or an overhaul that strips it down, takes
 * out some of the wear and measures what's left. Every booster has a life
 * nobody knows in advance; flown past it, its engines start to fail.
 */

export type BoosterStatus = "flown" | "refurbishing" | "ready" | "stacked" | "lost" | "retired";

export type BoosterUnit = {
  serial: string;
  /** The design key it was built for. */
  design: string;
  flights: number;
  status: BoosterStatus;
  /** Day of its last flight. */
  lastFlight: number;
  /** What the last overhaul measured: wear as a share of its life. */
  inspected?: { day: number; share: number };
};

/** Hidden: how much wear it takes before its engines start to go, and how much it has. In flights' worth. */
export type BoosterTruth = { life: number; wear: number };

export type RefurbDepth = "turnaround" | "overhaul";

/** Hangar work, as a share of the booster's build cost, and days. An overhaul takes out a share of the wear. */
export const REFURB: Record<RefurbDepth, { share: number; days: number; label: string; restores?: number }> = {
  turnaround: { share: 0.12, days: 20, label: "Turnaround" },
  overhaul: { share: 0.3, days: 45, label: "Overhaul", restores: 0.35 },
};

/** Stacking a new upper stage on a ready booster: integration on top of the upper stage itself, $k and days. */
export const RESTACK = { cost: 100, days: 10 };

/** Clean reflights before cautious customers fly on a booster that has flown. */
export const FLIGHT_PROVEN_TRUST = 3;

/** A booster's life, in flights' worth of wear: about ten, give or take a third. */
export function rollBoosterTruth(serial: string, seed: number): BoosterTruth {
  const random = rng(hashSeed(`${seed}:booster:${serial}`));
  const u = Math.max(1e-9, random());
  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  return { life: Math.max(3, 10 * Math.exp(0.35 * normal)), wear: 0 };
}

/** Wear one flight puts on: one flight's worth, more for a hot entry or a hard touchdown. */
export function flightWear(home: RecoveryResult): number {
  const hot = Math.max(0, home.peakHeating / ENTRY_HEATING - 1);
  const hard = home.touchdown ? Math.max(0, home.touchdown.speed - 3) / 3 : 0;
  return 1 + 1.5 * hot + 0.5 * hard;
}

/** Chance its engines fail on this flight: nothing early on, rising once it nears its life. */
export function wearRisk(truth: BoosterTruth): number {
  return Math.min(0.5, Math.max(0, 0.35 * (truth.wear / truth.life - 0.75)));
}

/** Whether a worn booster's engines fail this flight, and when: a seeded roll of its own. */
export function wearFailure(truth: BoosterTruth, serial: string, flight: number, seed: number, burn: number): { t: number; mode: FailureMode } | null {
  const random = rng(hashSeed(`${seed}:wear:${serial}:${flight}`));
  if (random() >= wearRisk(truth)) return null;
  return { t: Math.max(1, burn * random()), mode: "burn-through" };
}

/** What the booster alone costs to build, $k: its engines and its structure, legs and fins included. */
export function boosterCost(vehicle: Vehicle): number {
  const stage = vehicle.stages[0]!;
  const material = vehicle.geometry ? MATERIALS[vehicle.geometry.stages[0]?.material ?? "al-2219"].cost : 1;
  return Math.round(enginePrice(stage.engine) * stage.engineCount + COSTS.structurePerKilogram * stage.dryMass * material);
}

/** Building the rest of the vehicle on a booster that has flown: cost and days. */
export function restackCost(vehicle: Vehicle): { cost: number; days: number } {
  const whole = vehicleCost(vehicle);
  const upperEngines = vehicle.stages.slice(1).reduce((n, s) => n + s.engineCount, 0);
  return {
    cost: whole.cost - boosterCost(vehicle) + RESTACK.cost,
    days: RESTACK.days + COSTS.buildDaysPerStage * (vehicle.stages.length - 1) + COSTS.buildDaysPerEngine * upperEngines,
  };
}

export const nextSerial = (fleet: BoosterUnit[]) => `B${1001 + fleet.length}`;
