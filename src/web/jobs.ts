import { applyForLicence, build, fire, fixAero, fixEngine, fly, retune, tunnel, wait, type ActionResult, type Company, type FlightReport } from "../sim/company.ts";
import type { Contract } from "../sim/contracts.ts";
import { COSTS, vehicleCost } from "../sim/cost.ts";
import type { Engine } from "../sim/engine.ts";
import { FAILURE_LABELS, type FailureMode } from "../sim/hardware.ts";
import { LICENCE_LABELS, type Application } from "../sim/licence.ts";
import type { Mission } from "../sim/mission.ts";
import { FACILITIES, FIXES, HARDWARE_LOSS, type Facility } from "../sim/teststand.ts";
import { AERO_FACILITIES, BUFFET_FIX, type AeroFacility } from "../sim/tunnel.ts";
import { RETUNE_COST } from "../sim/tuning.ts";
import { DESIGNS } from "./designs.ts";
import { money } from "./format.ts";

/**
 * Everything the player does that moves the calendar is a job: what it
 * costs in money and days, a line for the progress screen, and the sim
 * action to run once the days have passed.
 */
export type Job<T extends ActionResult = ActionResult> = {
  /** The question the confirmation asks: "Build a Meridian?" */
  title: string;
  /** The progress screen's label while the days pass: "Firing on the stand". */
  doing: string;
  /** Label for the go-ahead button. */
  verb: string;
  days: number;
  /** Direct cost, $k; payroll comes on top. */
  cost: number;
  /** Ask even when no deadline is at risk: builds spend months and millions. */
  alwaysAsk?: boolean;
  /** Something that could make it take longer, said up front. */
  caveat?: string;
  /** A contract this job is for: it isn't at risk from its own launch. */
  forContract?: string;
  run: (company: Company) => T;
  onDone?: (result: T) => void;
};

export type Risk = { contract: Contract; text: string };

/** Signed contracts, soonest deadline first. */
export function signedContracts(company: Company): Contract[] {
  return company.accepted
    .map((id) => company.board.find((c) => c.id === id))
    .filter((c): c is Contract => c !== undefined)
    .sort((a, b) => a.deadline - b.deadline);
}

/** What spending `days` now does to each signed contract. */
export function deadlineRisks(company: Company, days: number, forContract?: string): Risk[] {
  const after = company.day + days;
  const risks: Risk[] = [];
  for (const c of signedContracts(company)) {
    if (after > c.deadline) {
      risks.push({ contract: c, text: `"${c.title}" is due on day ${c.deadline}. This ends on day ${after}: the contract is lost and ${money(c.penalty)} penalty is charged.` });
    } else if (c.id !== forContract && after + COSTS.padDays > c.deadline) {
      risks.push({ contract: c, text: `"${c.title}" is due on day ${c.deadline}. This ends on day ${after}, leaving ${c.deadline - after} days: too few for the ${COSTS.padDays} days on the pad.` });
    }
  }
  return risks;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildJob(key: string): Job {
  const v = DESIGNS[key]!;
  const { cost, days } = vehicleCost(v);
  return { title: `Build a ${v.name}?`, doing: `Building a ${v.name}`, verb: "Build", days, cost, alwaysAsk: true, run: (c) => build(c, key) };
}

export function fireJob(engine: Engine, seconds: number, facility: Facility, expectedRun: number): Job {
  const f = FACILITIES[facility];
  return {
    title: `Fire the ${engine.name} for ${seconds} s?`,
    doing: `Hot-firing the ${engine.name} · ${f.name}`,
    verb: "Fire",
    days: f.days,
    cost: f.setup + f.perSecond * expectedRun,
    caveat: `If the engine fails, a new one costs ${money(HARDWARE_LOSS.cost)} and ${HARDWARE_LOSS.days} more days.`,
    run: (c) => fire(c, engine, seconds, facility),
  };
}

export function tunnelJob(key: string, shape: string, facility: AeroFacility): Job {
  const f = AERO_FACILITIES[facility];
  return {
    title: `Book the ${f.name} for the ${shape}?`,
    doing: `${capital(f.name)} · ${shape}`,
    verb: "Book",
    days: f.days,
    cost: f.cost,
    run: (c) => tunnel(c, key, facility),
  };
}

export function fixEngineJob(engine: Engine, mode: FailureMode): Job {
  const fix = FIXES[mode]!;
  return {
    title: `Fix the ${engine.name}'s ${FAILURE_LABELS[mode]}?`,
    doing: `${capital(fix.name)} · ${engine.name}`,
    verb: "Apply fix",
    days: fix.days,
    cost: fix.cost,
    run: (c) => fixEngine(c, engine, mode),
  };
}

export function fixAeroJob(key: string, shape: string): Job {
  return {
    title: `Fit ${BUFFET_FIX.name} to the ${shape}?`,
    doing: `Fitting vortex generators · ${shape}`,
    verb: "Fit them",
    days: BUFFET_FIX.days,
    cost: BUFFET_FIX.cost,
    run: (c) => fixAero(c, key, "transonic-buffet"),
  };
}

export function retuneJob(key: string, contract: Contract): Job {
  return {
    title: `Re-tune the ${DESIGNS[key]!.name} for ${contract.payloadMass} kg?`,
    doing: `Re-tuning the ${DESIGNS[key]!.name}'s pitch programme`,
    verb: "Re-tune",
    days: RETUNE_COST.days,
    cost: RETUNE_COST.cost,
    forContract: contract.id,
    run: (c) => retune(c, key, contract.id),
  };
}

export function launchJob(key: string, contract: Contract, onDone: (r: FlightReport) => void): Job<FlightReport> {
  const v = DESIGNS[key]!;
  return {
    title: `Launch the ${v.name} for ${contract.customer}?`,
    doing: `${v.name} on the pad`,
    verb: "Launch",
    days: COSTS.padDays,
    cost: COSTS.launchFee,
    forContract: contract.id,
    run: (c) => fly(c, key, { contract: contract.id }),
    onDone,
  };
}

export function testFlightJob(key: string, mission: Mission, onDone: (r: FlightReport) => void): Job<FlightReport> {
  const v = DESIGNS[key]!;
  return {
    title: `Fly the ${v.name} as a test flight?`,
    doing: `${v.name} on the pad`,
    verb: "Launch",
    days: COSTS.padDays,
    cost: COSTS.launchFee,
    run: (c) => fly(c, key, { mission }),
    onDone,
  };
}

export function waitJob(days: number, why: string): Job {
  return { title: `Wait ${days} days?`, doing: why, verb: "Wait", days, cost: 0, run: (c) => wait(c, days) };
}

export function licenceJob(application: Application): Job {
  const name = LICENCE_LABELS[application.tier].toLowerCase();
  return {
    title: `Apply for the ${name} licence?`,
    doing: `The regulator reviews your ${name} application`,
    verb: "Apply",
    days: application.days,
    cost: application.fee,
    alwaysAsk: true,
    run: (c) => applyForLicence(c),
  };
}
