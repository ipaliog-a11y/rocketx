import type { OrbitElements } from "./orbit.ts";

/** Earth's sidereal rotation rate, rad/s. */
export const EARTH_ROTATION = 7.2921159e-5;

const RAD = Math.PI / 180;

export type LaunchSite = {
  name: string;
  /** Geodetic latitude, deg. North positive. */
  latitude: number;
};

/** The orbit a contract asks for, with how far off it may be. */
export type InsertionTarget = {
  /** Periapsis altitude, m. */
  periapsis: number;
  /** Apoapsis altitude, m. Infinity for an escape. */
  apoapsis: number;
  /** Orbital inclination, deg. */
  inclination: number;
  /** For an escape: the energy left over at infinity, C3, km²/s². */
  c3?: number;
  tolerance: {
    /** Allowed error on each apsis, m. */
    altitude: number;
    /** Allowed apoapsis error when it differs from the periapsis's, m: a transfer orbit's high point is loose. */
    apoapsis?: number;
    /** Allowed inclination error, deg. */
    inclination: number;
    /** Allowed C3 error for an escape, km²/s². */
    c3?: number;
  };
};

/** A powered burn in orbit after a coast. */
export type OrbitBurn = {
  name: "transfer" | "circularize" | "escape";
  /** Coast first: for a fixed time, or until the high point of the orbit. */
  coast: { kind: "time"; seconds: number } | { kind: "apoapsis" };
  /** Burn prograde until this reaches the value: an apsis altitude (m) or specific energy (J/kg). */
  until: { kind: "apoapsis" | "periapsis"; altitude: number } | { kind: "energy"; energy: number };
};

/** How a mission is flown: the powered ascent cuts off on `ascent`, then the burns. */
export type FlightPlan = { ascent: InsertionTarget | undefined; burns: OrbitBurn[] };

/** Highest orbit flown straight up from the pad, m: anything higher goes via a parking orbit. */
export const DIRECT_LIMIT = { periapsis: 400_000, apoapsis: 600_000 };
/** Parking orbit for high-energy missions, m, and the coast before the first relight, s. */
export const PARKING = { altitude: 200_000, coast: 600 };

/**
 * Low orbits are flown in one go. Anything higher goes to a low parking
 * orbit first, coasts, and relights the upper stage: once to raise the high
 * point (or to escape), and once more at the high point to circularise.
 */
export function missionPlan(mission: Mission): FlightPlan {
  const t = mission.target;
  if (!t) return { ascent: undefined, burns: [] };
  const escaping = t.c3 !== undefined;
  if (!escaping && t.periapsis <= DIRECT_LIMIT.periapsis && t.apoapsis <= DIRECT_LIMIT.apoapsis) return { ascent: t, burns: [] };
  const low = Math.min(t.periapsis, DIRECT_LIMIT.periapsis);
  const parkingAlt = t.periapsis <= DIRECT_LIMIT.periapsis ? low : PARKING.altitude;
  const ascent: InsertionTarget = {
    periapsis: parkingAlt,
    apoapsis: parkingAlt,
    inclination: t.inclination,
    tolerance: { altitude: 15_000, inclination: t.tolerance.inclination },
  };
  const coast = { kind: "time" as const, seconds: PARKING.coast };
  if (escaping) return { ascent, burns: [{ name: "escape", coast, until: { kind: "energy", energy: (t.c3! * 1e6) / 2 } }] };
  const burns: OrbitBurn[] = [{ name: "transfer", coast, until: { kind: "apoapsis", altitude: t.apoapsis } }];
  if (t.periapsis > DIRECT_LIMIT.periapsis) burns.push({ name: "circularize", coast: { kind: "apoapsis" }, until: { kind: "periapsis", altitude: t.periapsis } });
  return { ascent, burns };
}

/** Escape energy of a target, J/kg: v∞²/2. */
export const escapeEnergy = (c3: number) => (c3 * 1e6) / 2;

export type Mission = {
  name: string;
  site: LaunchSite;
  /** No target means a suborbital flight: fly, look, come down. */
  target?: InsertionTarget;
};

/**
 * Where the trajectory plane points and how fast the ground under it moves.
 *
 * The plane is fixed in inertial space by the site latitude and the launch
 * azimuth. Its inclination follows from cos i = cos(lat)·sin(az). The part
 * of Earth's spin that lies in that plane is ω·cos i, which is what the
 * pad and the air contribute along the trajectory. The out-of-plane part
 * of the pad's motion is left out of the model.
 */
export type LaunchGeometry = {
  /** Inertial launch azimuth, deg clockwise from north. */
  azimuth: number;
  /** Inclination this azimuth produces, deg. */
  inclination: number;
  /** Earth's rotation rate projected onto the trajectory plane, rad/s. */
  rotationRate: number;
};

/**
 * Azimuth that puts the vehicle into the target's inclination. A pad can't
 * launch directly into an inclination lower than its own latitude; asking
 * for one gets due east, the lowest it can reach.
 */
export function launchGeometry(mission: Mission, rotatingEarth = true): LaunchGeometry {
  const lat = mission.site.latitude * RAD;
  const wanted = mission.target?.inclination;
  let sinAz = 1;
  if (wanted !== undefined) {
    sinAz = Math.max(-1, Math.min(1, Math.cos(wanted * RAD) / Math.cos(lat)));
  }
  const azimuth = Math.asin(sinAz) / RAD;
  const cosI = Math.cos(lat) * sinAz;
  return {
    azimuth: (azimuth + 360) % 360,
    inclination: Math.acos(cosI) / RAD,
    rotationRate: rotatingEarth ? EARTH_ROTATION * cosI : 0,
  };
}

export type InsertionReport = {
  target: InsertionTarget;
  /** For an escape: achieved minus target C3, km²/s². */
  c3Error?: number;
  /** Achieved minus target, m. */
  periapsisError: number;
  apoapsisError: number;
  /** Achieved minus target, deg. */
  inclinationError: number;
  reachedOrbit: boolean;
  inSpec: boolean;
};

export function scoreInsertion(
  target: InsertionTarget,
  orbit: OrbitElements,
  inclination: number,
  reachedOrbit: boolean,
): InsertionReport {
  const inclinationError = inclination - target.inclination;
  if (target.c3 !== undefined) {
    // An escape is scored on the energy it leaves with.
    const c3Error = (2 * orbit.energy) / 1e6 - target.c3;
    const inSpec = reachedOrbit && Math.abs(c3Error) <= (target.tolerance.c3 ?? 1) && Math.abs(inclinationError) <= target.tolerance.inclination;
    return { target, periapsisError: orbit.periapsis - target.periapsis, apoapsisError: 0, inclinationError, reachedOrbit, inSpec, c3Error };
  }
  const periapsisError = orbit.periapsis - target.periapsis;
  const apoapsisError = orbit.apoapsis - target.apoapsis;
  const inSpec =
    reachedOrbit &&
    Math.abs(periapsisError) <= target.tolerance.altitude &&
    Math.abs(apoapsisError) <= (target.tolerance.apoapsis ?? target.tolerance.altitude) &&
    Math.abs(inclinationError) <= target.tolerance.inclination;
  return { target, periapsisError, apoapsisError, inclinationError, reachedOrbit, inSpec };
}

/** Semi-major axis of the target orbit, m, measured from Earth's centre. */
export function targetSemiMajorAxis(target: InsertionTarget, earthRadius: number): number {
  return earthRadius + (target.periapsis + target.apoapsis) / 2;
}
