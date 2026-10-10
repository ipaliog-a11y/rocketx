import { SLENDER_ROCKET } from "./sim/aero.ts";
import type { Engine } from "./sim/engine.ts";
import type { Vehicle } from "./sim/vehicle.ts";

/** Pressure-fed kerosene engine with a short sea-level bell. */
export const KESTREL_SL: Engine = {
  name: "Kestrel-SL",
  thrustVac: 35_000,
  ispVac: 270,
  exitArea: 0.07,
  exitPressure: 70_000,
};

/** Same chamber with a long bell expanded for near-vacuum. Better Isp, worse on the pad. */
export const KESTREL_VAC: Engine = {
  name: "Kestrel-Vac",
  thrustVac: 37_000,
  ispVac: 300,
  exitArea: 0.15,
  exitPressure: 6_000,
};

/** Baseline suborbital sounding rocket: one stage, slim, sea-level engine. */
export const PATHFINDER: Vehicle = {
  name: "Pathfinder",
  stages: [
    {
      name: "Pathfinder core",
      dryMass: 600,
      propellantMass: 1_100,
      engine: KESTREL_SL,
      engineCount: 1,
      diameter: 0.6,
    },
  ],
  payloadMass: 80,
  fairingDiameter: 0.6,
  dragCurve: SLENDER_ROCKET,
  limits: { maxDynamicPressure: 60_000, maxAcceleration: 8 },
};

/** Pathfinder carrying a customer payload that needs a 1.2 m fairing. */
export const PATHFINDER_FAT_FAIRING: Vehicle = {
  ...PATHFINDER,
  name: "Pathfinder, 1.2 m fairing",
  payloadMass: 100,
  fairingDiameter: 1.2,
};

/** Pathfinder with the vacuum bell bolted on to chase Isp. */
export const PATHFINDER_VAC_BELL: Vehicle = {
  ...PATHFINDER,
  name: "Pathfinder, vacuum bell",
  stages: [{ ...PATHFINDER.stages[0]!, engine: KESTREL_VAC, dryMass: 640 }],
};

/** Pathfinder stretched until it is too heavy to leave the pad. */
export const PATHFINDER_OVERFUELLED: Vehicle = {
  ...PATHFINDER,
  name: "Pathfinder, stretched tanks",
  stages: [{ ...PATHFINDER.stages[0]!, dryMass: 750, propellantMass: 2_300 }],
};

/** Two-stage design: sea-level booster under a vacuum upper stage. */
export const PATHFINDER_TWO_STAGE: Vehicle = {
  ...PATHFINDER,
  name: "Pathfinder two-stage",
  stages: [
    {
      name: "Booster",
      dryMass: 700,
      propellantMass: 1_500,
      engine: { ...KESTREL_SL, thrustVac: 50_000, exitArea: 0.09 },
      engineCount: 1,
      diameter: 0.8,
    },
    {
      name: "Upper",
      dryMass: 170,
      propellantMass: 400,
      engine: { ...KESTREL_VAC, thrustVac: 9_000, exitArea: 0.04 },
      engineCount: 1,
      diameter: 0.6,
    },
  ],
};

export const VEHICLES: Record<string, Vehicle> = {
  pathfinder: PATHFINDER,
  "fat-fairing": PATHFINDER_FAT_FAIRING,
  "vac-bell": PATHFINDER_VAC_BELL,
  overfuelled: PATHFINDER_OVERFUELLED,
  "two-stage": PATHFINDER_TWO_STAGE,
};
