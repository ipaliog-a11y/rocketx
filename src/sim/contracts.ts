import type { FlightResult } from "./ascent.ts";
import type { FailureMode } from "./hardware.ts";
import type { Licence } from "./licence.ts";
import type { Mission } from "./mission.ts";

/**
 * How a flight ended, as a customer remembers it. Reputation is tagged by
 * this, not a single score: a customer may forgive a late launch and still
 * refuse a company that has burned through a chamber.
 */
export type Tag = FailureMode | "no-orbit" | "short" | "insertion-miss" | "late" | "delivered" | "demonstrated";

/** What sort of work a contract is, for the board's filters. */
export type ContractKind =
  | "sounding"
  | "microgravity"
  | "tech-demo"
  | "rideshare"
  | "smallsat"
  | "constellation"
  | "weather"
  | "agency"
  | "geo"
  | "navigation"
  | "lunar"
  | "deep-space"
  | "megaconstellation"
  | "crew";

export const KIND_LABELS: Record<ContractKind, string> = {
  sounding: "Sounding science",
  microgravity: "Microgravity",
  "tech-demo": "Technology demo",
  rideshare: "Rideshare",
  smallsat: "Smallsat",
  constellation: "Constellation",
  weather: "Weather",
  agency: "Space agency",
  geo: "Geostationary",
  navigation: "Navigation",
  lunar: "Lunar",
  "deep-space": "Deep space",
  megaconstellation: "Mega-constellation",
  crew: "Crew",
};

/** A problem statement with money attached. */
export type Contract = {
  id: string;
  kind: ContractKind;
  customer: string;
  title: string;
  /**
   * Recurring work: every instance of a customer's series shares this id.
   * Deliver and the next one pays a little more; fail or miss one and the
   * customer withdraws the rest.
   */
  seriesId?: string;
  /** Which instance of the series this is, from 1. */
  seriesIndex?: number;
  /** The licence the flight needs. Left out: orbit needs orbital, anything else suborbital. */
  licence?: Licence;
  /** A line of back story. Empty for now; stories come later. */
  story?: string;
  mission: Mission;
  payloadMass: number;
  /** For suborbital work: the apogee the experiment needs, m. */
  minApogee?: number;
  /** Paid on delivery, $k. */
  payout: number;
  /**
   * Share of the payout for an orbit out of spec. 0 means a miss is no use
   * to this customer at all: a weather satellite at the wrong altitude
   * drifts out of its sun-synchronous plane.
   */
  degradedShare: number;
  /** Charged if the flight fails or the deadline passes, $k. */
  penalty: number;
  /** Last day the flight can happen. */
  deadline: number;
  /** Net reputation needed before the customer will sign. */
  minReputation: number;
  /** Day the contract appears on the board. */
  postedDay: number;
  /** Tags on the company's record that make this customer walk away. */
  refuses: Tag[];
};

export type Settlement = {
  status: "delivered" | "degraded" | "failed";
  /** Money in, $k. */
  payout: number;
  /** Money out, $k. */
  penalty: number;
  tag: Tag;
  reputation: number;
  text: string;
};

/** What the customer makes of the flight. */
export function settle(contract: Contract, result: FlightResult): Settlement {
  const failure = result.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure");
  const lost = (tag: Tag, why: string): Settlement => ({
    status: "failed",
    payout: 0,
    penalty: contract.penalty,
    tag,
    reputation: -2,
    text: `${contract.customer}: ${why} Penalty $${contract.penalty}k.`,
  });
  if (failure?.mode) return lost(failure.mode, "the vehicle was lost with the payload.");

  if (contract.minApogee !== undefined) {
    if (result.outcome === "apogee" && result.summary.apogee >= contract.minApogee) {
      return {
        status: "delivered",
        payout: contract.payout,
        penalty: 0,
        tag: "delivered",
        reputation: 1,
        text: `${contract.customer}: experiment flown to ${(result.summary.apogee / 1000).toFixed(1)} km. Paid $${contract.payout}k.`,
      };
    }
    return lost("short", `the experiment needed ${(contract.minApogee / 1000).toFixed(0)} km and got ${(result.summary.apogee / 1000).toFixed(1)} km.`);
  }

  const insertion = result.summary.insertion;
  if ((result.outcome !== "orbit" && result.outcome !== "escape") || !insertion) {
    const stranded = result.events.some((e) => e.kind === "coast");
    return lost("no-orbit", stranded ? "the payload never left its parking orbit." : "the payload never reached orbit.");
  }
  if (insertion.inSpec) {
    return {
      status: "delivered",
      payout: contract.payout,
      penalty: 0,
      tag: "delivered",
      reputation: 1,
      text: `${contract.customer}: payload delivered in spec. Paid $${contract.payout}k.`,
    };
  }
  if (contract.degradedShare <= 0) {
    return { ...lost("insertion-miss", "the orbit is out of spec and no use for this mission."), reputation: -1 };
  }
  const part = Math.round(contract.payout * contract.degradedShare);
  return {
    status: "degraded",
    payout: part,
    penalty: 0,
    tag: "insertion-miss",
    reputation: 0,
    text: `${contract.customer}: payload in orbit but out of spec; it will spend its own propellant fixing that. Paid ${Math.round(contract.degradedShare * 100)}%, $${part}k.`,
  };
}
