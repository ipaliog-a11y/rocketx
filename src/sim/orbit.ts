import { MU_EARTH, R_EARTH } from "./constants.ts";

/** Lowest periapsis that counts as reaching orbit, m. Lower than this and the vehicle is back in the air within one pass. */
export const MIN_ORBIT_PERIAPSIS = 100_000;

/** Below this periapsis the orbit decays within days, m. */
export const SHORT_LIVED_PERIAPSIS = 160_000;

export type OrbitElements = {
  /** Periapsis altitude above mean radius, m. Negative means it intersects the Earth. */
  periapsis: number;
  /** Apoapsis altitude, m. Infinity when the trajectory escapes. */
  apoapsis: number;
  eccentricity: number;
  /** Specific orbital energy, J/kg. */
  energy: number;
  /** Speed a circular orbit would need at the current radius, m/s. */
  circularSpeed: number;
  /** Direction of periapsis in the trajectory plane, rad, measured like a sample's angle: from the pad's direction toward downrange. */
  periapsisAngle: number;
};

/** Keplerian elements from a planar position and velocity around Earth's centre. */
export function orbitFrom(x: number, y: number, vx: number, vy: number): OrbitElements {
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const energy = v2 / 2 - MU_EARTH / r;
  const h = x * vy - y * vx;
  const eccentricity = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (MU_EARTH * MU_EARTH)));
  const p = (h * h) / MU_EARTH;
  const rp = p / (1 + eccentricity);
  const ra = eccentricity < 1 ? p / (1 - eccentricity) : Infinity;
  // Eccentricity vector: points at periapsis.
  const rv = x * vx + y * vy;
  const ex = ((v2 - MU_EARTH / r) * x - rv * vx) / MU_EARTH;
  const ey = ((v2 - MU_EARTH / r) * y - rv * vy) / MU_EARTH;
  return {
    periapsisAngle: Math.atan2(ex, ey),
    periapsis: rp - R_EARTH,
    apoapsis: ra - R_EARTH,
    eccentricity,
    energy,
    circularSpeed: Math.sqrt(MU_EARTH / r),
  };
}

export function isOrbit(orbit: OrbitElements): boolean {
  return orbit.energy < 0 && orbit.periapsis >= MIN_ORBIT_PERIAPSIS;
}
