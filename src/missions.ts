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
};
