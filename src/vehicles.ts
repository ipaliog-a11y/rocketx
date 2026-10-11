import { SLENDER_ROCKET } from "./sim/aero.ts";
import type { Engine } from "./sim/engine.ts";
import type { PitchProgram } from "./sim/guidance.ts";
import type { Vehicle } from "./sim/vehicle.ts";

/*
 * The preset engines keep their hand-drawn numbers, so the presets fly as
 * they always have. Their parts say where their quirks come from, and which
 * engines share them: the two Harriers share cycle, injector and cooling,
 * as do the two 35 kN Kestrels.
 */

/** Pressure-fed kerosene engine with a short sea-level bell. */
export const KESTREL_SL: Engine = {
  name: "Kestrel-SL",
  thrustVac: 35_000,
  ispVac: 270,
  exitArea: 0.07,
  exitPressure: 70_000,
  ratedLife: 100,
  parts: { size: 35, cycle: "pressure-fed", injector: "showerhead", cooling: "ablative", nozzle: "sea-level" },
};

/** Same chamber with a long bell expanded for near-vacuum. Better Isp, worse on the pad. */
export const KESTREL_VAC: Engine = {
  name: "Kestrel-Vac",
  thrustVac: 37_000,
  ispVac: 300,
  exitArea: 0.15,
  exitPressure: 6_000,
  ratedLife: 120,
  parts: { size: 35, cycle: "pressure-fed", injector: "showerhead", cooling: "ablative", nozzle: "vacuum" },
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
      engine: { ...KESTREL_SL, name: "Kestrel-SL Block 2", thrustVac: 50_000, exitArea: 0.09, parts: { ...KESTREL_SL.parts!, size: 50 } },
      engineCount: 1,
      diameter: 0.8,
    },
    {
      name: "Upper",
      dryMass: 170,
      propellantMass: 400,
      engine: { ...KESTREL_VAC, name: "Kestrel-Vac Mini", thrustVac: 9_000, exitArea: 0.04, ratedLife: 160, parts: { ...KESTREL_VAC.parts!, size: 9 } },
      engineCount: 1,
      diameter: 0.6,
    },
  ],
};


/** Pump-fed kerosene engine for an orbital booster, nine to a core. */
export const HARRIER_SL: Engine = {
  name: "Harrier-SL",
  thrustVac: 24_500,
  ispVac: 311,
  exitArea: 0.055,
  exitPressure: 60_000,
  ratedLife: 150,
  parts: { size: 25, cycle: "gas-generator", injector: "coaxial", cooling: "film", nozzle: "sea-level" },
};

/** Vacuum Harrier for the upper stage. */
export const HARRIER_VAC: Engine = {
  name: "Harrier-Vac",
  thrustVac: 26_000,
  ispVac: 343,
  exitArea: 0.35,
  exitPressure: 2_000,
  ratedLife: 300,
  parts: { size: 25, cycle: "gas-generator", injector: "coaxial", cooling: "film", nozzle: "large-vacuum" },
};

const MERIDIAN_TURN = {
  kind: "gravity-turn",
  kickSpeed: 60,
  kickAngle: 7,
  kickDuration: 5,
  upperStage: { startPitch: 25, endPitch: -15 },
} as const satisfies PitchProgram;

/**
 * Small two-stage orbital launcher. Gravity turn on the booster, then the
 * upper stage ramps its pitch down to level for a direct insertion.
 */
export const MERIDIAN: Vehicle = {
  name: "Meridian",
  stages: [
    {
      name: "Meridian booster",
      dryMass: 950,
      propellantMass: 9_250,
      engine: HARRIER_SL,
      engineCount: 9,
      diameter: 1.2,
    },
    {
      name: "Meridian upper",
      dryMass: 250,
      propellantMass: 2_050,
      engine: HARRIER_VAC,
      engineCount: 1,
      diameter: 1.2,
    },
  ],
  payloadMass: 200,
  fairingDiameter: 1.2,
  dragCurve: SLENDER_ROCKET,
  pitchProgram: MERIDIAN_TURN,
  limits: { maxDynamicPressure: 50_000, maxAcceleration: 8, maxQAlpha: 30_000 },
};

/** Meridian with a timid 2° kick: it climbs too steeply and stages too high. */
export const MERIDIAN_LOFTED: Vehicle = {
  ...MERIDIAN,
  name: "Meridian, 2° kick",
  pitchProgram: { ...MERIDIAN_TURN, kickAngle: 2 },
};

/** Meridian kicking 12° at 100 m/s: turns over hard in thick air. */
export const MERIDIAN_HARD_KICK: Vehicle = {
  ...MERIDIAN,
  name: "Meridian, 12° kick",
  pitchProgram: { ...MERIDIAN_TURN, kickSpeed: 100, kickAngle: 12 },
};

export const VEHICLES: Record<string, Vehicle> = {
  pathfinder: PATHFINDER,
  "fat-fairing": PATHFINDER_FAT_FAIRING,
  "vac-bell": PATHFINDER_VAC_BELL,
  overfuelled: PATHFINDER_OVERFUELLED,
  "two-stage": PATHFINDER_TWO_STAGE,
  meridian: MERIDIAN,
  "meridian-lofted": MERIDIAN_LOFTED,
  "meridian-hard-kick": MERIDIAN_HARD_KICK,
};

/** Every engine the vehicles use, keyed like "harrier-sl". */
export const ENGINES: Record<string, Engine> = Object.fromEntries(
  Object.values(VEHICLES).flatMap((v) => v.stages.map((stage) => [engineKey(stage.engine), stage.engine] as const)),
);

export function engineKey(engine: Engine): string {
  return engine.name.toLowerCase().replace(/\s+/g, "-");
}
