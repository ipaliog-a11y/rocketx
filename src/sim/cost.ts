import type { Vehicle } from "./vehicle.ts";

/**
 * What a vehicle costs to build, in $k and days. A rough parametric model:
 * engines by thrust, structure by dry mass, and assembly time by how many
 * stages and engines go together.
 */
export const COSTS = {
  /** Engine price: a base plus a rate per kN of vacuum thrust, $k. */
  engineBase: 100,
  enginePerKilonewton: 6,
  /** Structure, tanks and avionics per kg of stage dry mass (engines excluded), $k. */
  structurePerKilogram: 1.2,
  /** Assembly: a base plus per stage and per engine, days. */
  buildDays: 20,
  buildDaysPerStage: 10,
  buildDaysPerEngine: 2,
  /** Range and pad fees for one launch campaign, $k and days on the pad. */
  launchFee: 100,
  padDays: 7,
  /** Salaries, rent and the lights, per calendar day, $k. Time is money. */
  overheadPerDay: 5,
};

export function vehicleCost(vehicle: Vehicle): { cost: number; days: number } {
  let cost = 0;
  let engines = 0;
  for (const stage of vehicle.stages) {
    const engine = stage.engine.unitCost ?? COSTS.engineBase + (COSTS.enginePerKilonewton * stage.engine.thrustVac) / 1000;
    cost += engine * stage.engineCount + COSTS.structurePerKilogram * stage.dryMass;
    engines += stage.engineCount;
  }
  const days = COSTS.buildDays + COSTS.buildDaysPerStage * vehicle.stages.length + COSTS.buildDaysPerEngine * engines;
  return { cost: Math.round(cost), days };
}
