import { simulateAscent, type AscentOptions, type FlightEvent, type Outcome } from "./ascent.ts";
import { massFlow, thrustAt } from "./engine.ts";
import type { Mission } from "./mission.ts";
import { flyHome, type RecoveryResult } from "./recovery.ts";
import type { Vehicle } from "./vehicle.ts";

/**
 * The paper check on a booster drawn to come back: fly the ascent with its
 * reserve held back, then the booster home, calm and nominal, and say how
 * much propellant it touches down with. Short, it says by how much.
 */
export type LandingMargin = {
  /** The ascent with the reserve held back. */
  ascent: Outcome;
  /** What lost the ascent, if it was lost: an early staging can leave the upper stage in air it can't fly. */
  ascentLoss: FlightEvent | null;
  recovery: RecoveryResult | null;
  /** Propellant left at touchdown, kg; negative is what it would have needed on top. */
  propellant: number;
  /** The same as speed the landing burn could still take off, m/s; negative when short. */
  deltaV: number;
  /** Dynamic pressure at staging, Pa. */
  stagingQ: number;
};

export function landingMargin(vehicle: Vehicle, mission: Mission, options: AscentOptions = {}): LandingMargin | null {
  const recovery = vehicle.geometry?.recovery;
  if (!recovery || vehicle.stages.length < 2) return null;
  const { landingSeed: _, ...calm } = options;
  const r = simulateAscent(vehicle, mission, calm);
  const staging = r.events.find((e) => e.kind === "staging");
  const near = staging ? r.samples.reduce((a, b) => (Math.abs(b.t - staging.t) < Math.abs(a.t - staging.t) ? b : a)) : null;
  const ascentLoss = r.outcome === "failure" ? (r.events.find((e) => e.kind === "loss-of-control" || e.kind === "engine-failure" || e.kind === "structural-failure") ?? null) : null;
  const home = r.recovery ?? null;
  const b = vehicle.stages[0]!;
  const ve = thrustAt(b.engine, 101_325) / massFlow(b.engine);
  let propellant = home?.propellantLeft ?? 0;
  if (home && home.cause === "out-of-propellant") {
    // Fly it again with plenty, and see what it would have used.
    const extra = b.propellantMass * 0.3;
    const sep = home.separation;
    const again = flyHome({ engine: b.engine, engineCount: b.engineCount, diameter: b.diameter, recovery }, { ...sep, propellant: sep.propellant + extra });
    // What it used, against what it had.
    propellant = again.outcome === "landed" ? again.propellantLeft - extra : -extra;
  }
  const dry = b.dryMass;
  const deltaV = propellant >= 0 ? ve * Math.log((dry + propellant) / dry) : -ve * Math.log((dry - propellant) / dry);
  return { ascent: r.outcome, ascentLoss, recovery: home, propellant, deltaV, stagingQ: near?.dynamicPressure ?? 0 };
}
