import { assembleVehicle, type VehicleSpec } from "./sim/builder.ts";
import type { PitchProgram } from "./sim/guidance.ts";
import type { Vehicle } from "./sim/vehicle.ts";
import { HARRIER_SL, HARRIER_VAC, KESTREL_SL } from "./vehicles.ts";

/**
 * The rockets a new company starts with. Both are drawing-board designs,
 * the sizing guide's cheapest pick for the work the board posts, so they
 * fly the same physics as anything the player draws: built-up drag, shells
 * that can buckle, and (Meridian) an attitude loop in the day's wind. The
 * hand-written presets in vehicles.ts stay as command-line teaching cases
 * and test fixtures.
 */

/** Sounding rocket: one pressure-fed Kestrel-SL, fins, 80 kg past 150 km on paper. */
export const PATHFINDER_SPEC: VehicleSpec = {
  name: "Pathfinder",
  stages: [{ diameter: 0.6, tankLength: 3.5, engine: "Kestrel-SL", engineCount: 1 }],
  fairingDiameter: 0.6,
  payloadMass: 80,
  geometry: {
    nose: { shape: "ogive", fineness: 2 },
    jettisonAltitude: 115_000,
    stages: [{ material: "al-2219", ullage: 3, safetyFactor: 1.4 }],
    fins: { count: 4, span: 0.6, rootChord: 0.6, tipChord: 0.24, sweep: 35, section: "rounded", thickness: 0.012 },
  },
};

/** Small orbital launcher: eleven Harrier-SL under a Harrier-Vac upper stage, guided, 200 kg to 300 km. */
export const MERIDIAN_SPEC: VehicleSpec = {
  name: "Meridian",
  stages: [
    { diameter: 1.2, tankLength: 10, engine: "Harrier-SL", engineCount: 11 },
    { diameter: 1, tankLength: 3.5, engine: "Harrier-Vac", engineCount: 1 },
  ],
  fairingDiameter: 1,
  payloadMass: 200,
  geometry: {
    nose: { shape: "ogive", fineness: 2 },
    jettisonAltitude: 115_000,
    stages: [
      { material: "al-2219", ullage: 4, safetyFactor: 1.4 },
      { material: "al-2219", ullage: 4, safetyFactor: 1.4 },
    ],
    control: { guided: true, gimbal: 5, actuatorRate: 15, bandwidth: 1, notch: true, baffles: true, imu: "navigation" },
  },
};

/** Meridian's steering, re-tuned on paper for 200 kg to 300 km at 28.5°. Other jobs want their own re-tune. */
const MERIDIAN_TURN: PitchProgram = { kind: "gravity-turn", kickSpeed: 60, kickAngle: 4.47, kickDuration: 5, upperStage: { startPitch: 0, endPitch: -25 } };

const ENGINES = Object.fromEntries([KESTREL_SL, HARRIER_SL, HARRIER_VAC].map((e) => [e.name, e]));

export const STARTER_PATHFINDER: Vehicle = assembleVehicle(PATHFINDER_SPEC, ENGINES);
export const STARTER_MERIDIAN: Vehicle = { ...assembleVehicle(MERIDIAN_SPEC, ENGINES), pitchProgram: MERIDIAN_TURN };

/** The designs a new company starts with, by key. */
export const STARTERS: Record<string, Vehicle> = {
  pathfinder: STARTER_PATHFINDER,
  meridian: STARTER_MERIDIAN,
};

/** Every engine the starting designs fly. */
export const STARTER_ENGINES = Object.values(ENGINES);
