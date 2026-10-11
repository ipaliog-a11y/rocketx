import type { LaunchSite, Mission } from "./sim/mission.ts";

/** Coastal pad at a mid latitude. Due east gets about 408 m/s from the Earth. */
export const PORT_AVERY: LaunchSite = { name: "Port Avery", latitude: 28.5 };

/** Island pad near the equator. Cheap low inclinations, expensive logistics. */
export const ISLA_SERRANO: LaunchSite = { name: "Isla Serrano", latitude: 5.2 };

/** Sounding flight: no orbit asked for, straight up and down. */
export const SUBORBITAL_TEST: Mission = { name: "Suborbital flight", site: PORT_AVERY };

/** Circular 300 km low Earth orbit, flown due east from Port Avery. */
export const LEO_300: Mission = {
  name: "LEO 300 km, 28.5°",
  site: PORT_AVERY,
  target: {
    periapsis: 300_000,
    apoapsis: 300_000,
    inclination: 28.5,
    tolerance: { altitude: 15_000, inclination: 0.1 },
  },
};

/** Sun-synchronous 500 km orbit. Retrograde, so the Earth's spin works against the launch. */
export const SSO_500: Mission = {
  name: "SSO 500 km, 97.4°",
  site: PORT_AVERY,
  target: {
    periapsis: 500_000,
    apoapsis: 500_000,
    inclination: 97.4,
    tolerance: { altitude: 15_000, inclination: 0.1 },
  },
};

/** A customer who wants an equatorial orbit, which Port Avery can't reach directly. */
export const LEO_EQUATORIAL: Mission = {
  name: "LEO 300 km, equatorial",
  site: PORT_AVERY,
  target: {
    periapsis: 300_000,
    apoapsis: 300_000,
    inclination: 0,
    tolerance: { altitude: 15_000, inclination: 0.1 },
  },
};

export const MISSIONS: Record<string, Mission> = {
  suborbital: SUBORBITAL_TEST,
  "leo-300": LEO_300,
  "sso-500": SSO_500,
  "leo-equatorial": LEO_EQUATORIAL,
  // High-energy missions: parking orbit, coast, relights. Defined below.
  get "leo-800"() {
    return highCircular(800, 28.5);
  },
  get gto() {
    return gto();
  },
  get tli() {
    return lunar();
  },
  get escape() {
    return escape(10);
  },
};

/**
 * A circular orbit from Port Avery. Generated contracts use these: the
 * altitudes and inclinations the company's launchers can reach directly
 * from a 28.5° pad.
 */
export function circular(altitudeKm: number, inclination: number): Mission {
  return {
    name: `LEO ${altitudeKm} km, ${inclination}°`,
    site: PORT_AVERY,
    target: {
      periapsis: altitudeKm * 1000,
      apoapsis: altitudeKm * 1000,
      inclination,
      tolerance: { altitude: 15_000, inclination: 0.1 },
    },
  };
}

/** Geostationary transfer orbit from Port Avery: perigee low, apogee at geostationary height. */
export function gto(): Mission {
  return {
    name: "GTO 200 × 35,786 km",
    site: PORT_AVERY,
    target: { periapsis: 200_000, apoapsis: 35_786_000, inclination: 28.5, tolerance: { altitude: 40_000, apoapsis: 500_000, inclination: 0.1 } },
  };
}

/** A circular orbit above the direct-ascent limit: parking orbit, transfer, circularise. */
export function highCircular(altitudeKm: number, inclination: number): Mission {
  return { ...circular(altitudeKm, inclination), name: `${altitudeKm.toLocaleString("en-US")} km circular, ${inclination}°` };
}

/** Trans-lunar injection: an ellipse out to the Moon's distance. */
export function lunar(): Mission {
  return {
    name: "Trans-lunar injection",
    site: PORT_AVERY,
    target: { periapsis: 200_000, apoapsis: 384_400_000, inclination: 28.5, tolerance: { altitude: 40_000, apoapsis: 20_000_000, inclination: 0.1 } },
  };
}

/** Escape with a C3, km²/s²: the energy left over once Earth's pull is spent. */
export function escape(c3: number): Mission {
  return {
    name: `Escape, C3 ${c3}`,
    site: PORT_AVERY,
    target: { periapsis: 200_000, apoapsis: Infinity, inclination: 28.5, c3, tolerance: { altitude: 15_000, inclination: 0.1, c3: 1 } },
  };
}
