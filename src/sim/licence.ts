import type { Company } from "./company.ts";
import type { Contract } from "./contracts.ts";
import type { Mission } from "./mission.ts";
import { CLEAN_FLIGHTS_FOR_CREW, crewRating } from "./crew.ts";

/**
 * Launch licences. A young company flies sounding rockets until the
 * regulator has seen it fly safely; orbit comes after that, and people
 * after a long orbital record. Each tier is applied for: a fee, a review
 * period, and requirements the record has to show.
 */

export type Licence = "suborbital" | "orbital" | "crew";

export const LICENCE_ORDER: Licence[] = ["suborbital", "orbital", "crew"];

export const LICENCE_LABELS: Record<Licence, string> = {
  suborbital: "Suborbital",
  orbital: "Orbital",
  crew: "Crewed flight",
};

/** Fee in $k and review time in days for each tier past the first. */
export const LICENCE_COSTS: Record<Exclude<Licence, "suborbital">, { fee: number; days: number }> = {
  orbital: { fee: 250, days: 20 },
  crew: { fee: 2_000, days: 90 },
};

/** Flights above this altitude count as proof of a safe flight profile, m. */
export const SPACE_LINE = 100_000;
/** Safe flights to space the regulator wants before an orbital licence. */
export const ORBITAL_FLIGHTS_NEEDED = 2;
/** Orbital deliveries before the regulator will look at crew. */
export const CREW_DELIVERIES_NEEDED = 5;

export function licenceRank(l: Licence): number {
  return LICENCE_ORDER.indexOf(l);
}

/** The licence a mission needs: anything that goes to orbit needs the orbital tier. */
export function missionLicence(mission: Mission): Licence {
  return mission.target ? "orbital" : "suborbital";
}

export function requiredLicence(contract: Contract): Licence {
  return contract.licence ?? missionLicence(contract.mission);
}

export function holds(company: Company, needed: Licence): boolean {
  return licenceRank(company.licence) >= licenceRank(needed);
}

export type Requirement = { text: string; met: boolean; progress?: [number, number] };

export type Application = { tier: Licence; fee: number; days: number; requirements: Requirement[]; ready: boolean };

/** Flights that went above the space line without losing the vehicle. */
export function safeSpaceFlights(company: Company): number {
  return company.flights.filter((f) => (f.outcome === "apogee" || f.outcome === "orbit") && f.apogee >= SPACE_LINE).length;
}

function orbitalDeliveries(company: Company): number {
  return Object.entries(company.closed).filter(([id, s]) => s === "delivered" && company.board.find((c) => c.id === id)?.mission.target).length;
}

/** The next licence up and what the regulator wants for it, or null at the top. */
export function nextLicence(company: Company, reputation: number): Application | null {
  const tier = LICENCE_ORDER[licenceRank(company.licence) + 1];
  if (!tier || tier === "suborbital") return null;
  const requirements: Requirement[] = [];
  if (tier === "orbital") {
    const flights = safeSpaceFlights(company);
    requirements.push({
      text: `${ORBITAL_FLIGHTS_NEEDED} flights above 100 km without losing the vehicle`,
      met: flights >= ORBITAL_FLIGHTS_NEEDED,
      progress: [Math.min(flights, ORBITAL_FLIGHTS_NEEDED), ORBITAL_FLIGHTS_NEEDED],
    });
    requirements.push({ text: "A reputation of 0 or better", met: reputation >= 0 });
  } else {
    const delivered = orbitalDeliveries(company);
    requirements.push({
      text: `${CREW_DELIVERIES_NEEDED} orbital deliveries`,
      met: delivered >= CREW_DELIVERIES_NEEDED,
      progress: [Math.min(delivered, CREW_DELIVERIES_NEEDED), CREW_DELIVERIES_NEEDED],
    });
    requirements.push({ text: "A reputation of 5 or better", met: reputation >= 5 });
    const known = company.capsule?.known;
    requirements.push({ text: "A crew capsule", met: company.capsule !== undefined });
    requirements.push({ text: "A pad abort passed on the current abort system", met: known?.padAbortPassed ?? false });
    requirements.push({ text: "An in-flight abort passed on the current abort system", met: known?.inflightAbortPassed ?? false });
    const rated = Object.keys(company.designs).filter((key) => crewRating(company, key).rated);
    requirements.push({ text: `A crew-rated rocket: engines proven for their full burns, ${CLEAN_FLIGHTS_FOR_CREW} clean orbital flights in a row`, met: rated.length > 0 });
  }
  const { fee, days } = LICENCE_COSTS[tier];
  return { tier, fee, days, requirements, ready: requirements.every((r) => r.met) };
}
