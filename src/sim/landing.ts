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
  let propellant = home?.outcome === "landed" ? home.propellantLeft : 0;
  if (home && home.outcome === "lost") {
    // Short, whatever lost it: run dry, or saved what it had for the landing and burned up on the way in.
    // Fly it again with more, and see what it would have used. Too much more and it's too heavy to slow: step up.
    const sep = home.separation;
    propellant = -b.propellantMass * 0.35;
    for (const share of [0.05, 0.1, 0.2, 0.35]) {
      const extra = b.propellantMass * share;
      const again = flyHome({ engine: b.engine, engineCount: b.engineCount, diameter: b.diameter, recovery }, { ...sep, propellant: sep.propellant + extra });
      if (again.outcome === "landed") {
        propellant = again.propellantLeft - extra;
        break;
      }
    }
  }
  const dry = b.dryMass;
  const deltaV = propellant >= 0 ? ve * Math.log((dry + propellant) / dry) : -ve * Math.log((dry - propellant) / dry);
  return { ascent: r.outcome, ascentLoss, recovery: home, propellant, deltaV, stagingQ: near?.dynamicPressure ?? 0 };
}
