/** Standard gravity, m/s². Defines Isp in seconds. */
export const G0 = 9.80665;

/** Earth gravitational parameter, m³/s². */
export const MU_EARTH = 3.986004418e14;

/** Earth mean radius, m. */
export const R_EARTH = 6_371_000;

/** Specific gas constant for dry air, J/(kg·K). */
export const R_AIR = 287.053;

/** Ratio of specific heats for air. */
export const GAMMA_AIR = 1.4;

/** Sea-level standard pressure, Pa. */
export const P_SEA_LEVEL = 101_325;

/** Gravity at altitude above mean radius, m/s². */
export function gravityAt(altitude: number): number {
  const r = R_EARTH + altitude;
  return MU_EARTH / (r * r);
}
