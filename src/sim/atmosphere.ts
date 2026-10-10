import { G0, GAMMA_AIR, R_AIR, R_EARTH } from "./constants.ts";

export type AtmosphereState = {
  /** Static temperature, K. */
  temperature: number;
  /** Static pressure, Pa. */
  pressure: number;
  /** Density, kg/m³. */
  density: number;
  /** Speed of sound, m/s. */
  speedOfSound: number;
};

/**
 * US Standard Atmosphere 1976 layers, by geopotential altitude.
 * base height (m), base temperature (K), lapse rate (K/m), base pressure (Pa).
 */
const LAYERS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 288.15, -0.0065, 101_325],
  [11_000, 216.65, 0, 22_632.06],
  [20_000, 216.65, 0.001, 5_474.889],
  [32_000, 228.65, 0.0028, 868.0187],
  [47_000, 270.65, 0, 110.9063],
  [51_000, 270.65, -0.0028, 66.93887],
  [71_000, 214.65, -0.002, 3.956420],
  [84_852, 186.946, 0, 0.3733836],
];

/** Above this geometric altitude the atmosphere is treated as vacuum. */
export const ATMOSPHERE_TOP = 150_000;

const VACUUM: AtmosphereState = { temperature: 186.946, pressure: 0, density: 0, speedOfSound: 274 };

/**
 * Atmosphere at a geometric altitude in metres. Uses the 1976 standard to
 * 86 km and an isothermal tail above it, which is crude but only matters
 * for density far below anything that loads a vehicle.
 */
export function atmosphereAt(altitude: number): AtmosphereState {
  if (altitude >= ATMOSPHERE_TOP) return VACUUM;
  const z = Math.max(0, altitude);
  const h = (R_EARTH * z) / (R_EARTH + z);

  let layer = LAYERS[0]!;
  for (const candidate of LAYERS) {
    if (h >= candidate[0]) layer = candidate;
    else break;
  }
  const [hb, tb, lapse, pb] = layer;
  const dh = h - hb;

  let temperature: number;
  let pressure: number;
  if (lapse === 0) {
    temperature = tb;
    pressure = pb * Math.exp((-G0 * dh) / (R_AIR * tb));
  } else {
    temperature = tb + lapse * dh;
    pressure = pb * Math.pow(tb / temperature, G0 / (R_AIR * lapse));
  }

  return {
    temperature,
    pressure,
    density: pressure / (R_AIR * temperature),
    speedOfSound: Math.sqrt(GAMMA_AIR * R_AIR * temperature),
  };
}
