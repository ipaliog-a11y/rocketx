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
  /** Apoapsis altitude, m. */
  apoapsis: number;
  /** Orbital inclination, deg. */
  inclination: number;
  tolerance: {
    /** Allowed error on each apsis, m. */
    altitude: number;
    /** Allowed inclination error, deg. */
    inclination: number;
  };
};

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
  const periapsisError = orbit.periapsis - target.periapsis;
  const apoapsisError = orbit.apoapsis - target.apoapsis;
  const inclinationError = inclination - target.inclination;
  const inSpec =
    reachedOrbit &&
    Math.abs(periapsisError) <= target.tolerance.altitude &&
    Math.abs(apoapsisError) <= target.tolerance.altitude &&
    Math.abs(inclinationError) <= target.tolerance.inclination;
  return { target, periapsisError, apoapsisError, inclinationError, reachedOrbit, inSpec };
}

/** Semi-major axis of the target orbit, m, measured from Earth's centre. */
export function targetSemiMajorAxis(target: InsertionTarget, earthRadius: number): number {
  return earthRadius + (target.periapsis + target.apoapsis) / 2;
}
