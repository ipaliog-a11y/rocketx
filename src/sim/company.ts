import { simulateAscent, type FlightResult } from "./ascent.ts";
import { aeroShape, rollAeroTruths } from "./airframe.ts";
import { settle, type Contract, type Tag } from "./contracts.ts";
import { COSTS, vehicleCost } from "./cost.ts";
import { debrief } from "./debrief.ts";
import type { Engine } from "./engine.ts";
import { FAILURE_LABELS, rollTruths, type FailureMode } from "./hardware.ts";
import type { Mission } from "./mission.ts";
import { learnFromFlight } from "./telemetry.ts";
import {
  applyFix,
  believedHardware,
  flightUnknowns,
  hotFire,
  newCampaign,
  type Campaign,
  type Facility,
} from "./teststand.ts";
import { retuneFromTests } from "./tuning.ts";
import { applyAeroFix, believedAero, tunnelRun, type AeroFacility } from "./tunnel.ts";
import type { Vehicle } from "./vehicle.ts";

/**
 * The company: the pressure around the engineering. Cash, a calendar,
 * reputation tagged by what went wrong, and a contract board. One stand,
 * one tunnel, one pad and one build shop, used one job at a time, so every
 * action moves the calendar.
 *
 * The run ends when the cash runs out.
 */

export type Category = "test" | "fix" | "analysis" | "build" | "launch" | "payout" | "penalty";

export type MoneyEntry = { day: number; category: Category; amount: number; note: string };
export type RecordEntry = { day: number; tag: Tag; reputation: number; note: string };

/** What a design has actually flown. A bid that goes past this is a new regime. */
export type Experience = { flights: number; orbits: number; maxApoapsis: number; inclinations: number[]; maxPayload: number };

export type Company = {
  seed: number;
  day: number;
  /** $k. */
  cash: number;
  campaign: Campaign;
  /** Current designs by key. A re-tune changes the design's pitch programme. */
  designs: Record<string, Vehicle>;
  /** Built vehicles waiting for the pad, by design key. */
  inventory: Record<string, number>;
  board: Contract[];
  accepted: string[];
  closed: Record<string, "delivered" | "degraded" | "failed" | "late">;
  ledger: MoneyEntry[];
  record: RecordEntry[];
  experience: Record<string, Experience>;
  firstOrbitDay: number | null;
  dead: boolean;
};

export function newCompany(
  seed: number,
  startingCash: number,
  designs: Record<string, Vehicle>,
  engines: Engine[],
  board: Contract[],
): Company {
  const campaign = newCampaign(rollTruths(engines, seed), rollAeroTruths(Object.values(designs), seed));
  return {
    seed,
    day: 0,
    cash: startingCash,
    campaign,
    designs: { ...designs },
    inventory: {},
    board,
    accepted: [],
    closed: {},
    ledger: [],
    record: [],
    experience: {},
    firstOrbitDay: null,
    dead: false,
  };
}

export function reputation(company: Company): number {
  return company.record.reduce((sum, r) => sum + r.reputation, 0);
}

const money = (k: number) => `${k < 0 ? "−" : ""}$${(Math.abs(k) / 1000).toFixed(2)}M`;

function alive(company: Company): void {
  if (company.dead) throw new Error("The company is gone. Its cash ran out.");
}

/** Move money and time, then settle anything the new date makes due. Returns notices. */
function charge(company: Company, category: Category, amount: number, days: number, note: string): string[] {
  company.cash -= amount;
  company.day += days;
  if (amount !== 0) company.ledger.push({ day: company.day, category, amount: -amount, note });
  return tick(company);
}

/** Deadlines that have passed, and whether the company can still pay its bills. */
function tick(company: Company): string[] {
  const notices: string[] = [];
  for (const id of [...company.accepted]) {
    const contract = contractOf(company, id);
    if (company.day <= contract.deadline) continue;
    company.accepted = company.accepted.filter((a) => a !== id);
    company.closed[id] = "late";
    company.cash -= contract.penalty;
    company.ledger.push({ day: company.day, category: "penalty", amount: -contract.penalty, note: `${contract.title}: missed the deadline` });
    company.record.push({ day: company.day, tag: "late", reputation: -1, note: contract.title });
    notices.push(`Day ${contract.deadline}: ${contract.customer} gave up waiting on "${contract.title}". Penalty $${contract.penalty}k.`);
  }
  if (company.cash < 0 && !company.dead) {
    company.dead = true;
    notices.push(`Day ${company.day}: the cash is gone. The company is dead.`);
  }
  return notices;
}

function contractOf(company: Company, id: string): Contract {
  const contract = company.board.find((c) => c.id === id);
  if (!contract) throw new Error(`No contract "${id}" on the board.`);
  return contract;
}

function designOf(company: Company, key: string): Vehicle {
  const design = company.designs[key];
  if (!design) throw new Error(`No design "${key}".`);
  return design;
}

/** Run a campaign action and post what it cost to the ledger. */
function viaCampaign<T>(company: Company, category: Category, note: string, act: () => T): { value: T; notices: string[] } {
  alive(company);
  const spent = company.campaign.spent;
  const days = company.campaign.days;
  const value = act();
  const notices = charge(company, category, company.campaign.spent - spent, company.campaign.days - days, note);
  return { value, notices };
}

export type ActionResult = { text: string; notices: string[] };

export function accept(company: Company, id: string): ActionResult {
  alive(company);
  const contract = contractOf(company, id);
  if (company.accepted.includes(id) || company.closed[id]) throw new Error(`"${contract.title}" is no longer open.`);
  if (company.day > contract.deadline) throw new Error(`"${contract.title}" has expired.`);
  if (reputation(company) < contract.minReputation) {
    throw new Error(`${contract.customer} wants a reputation of ${contract.minReputation}; the company has ${reputation(company)}.`);
  }
  const objection = company.record.find((r) => contract.refuses.includes(r.tag));
  if (objection) {
    throw new Error(`${contract.customer} won't sign with a company whose record shows ${describeTag(objection.tag)}.`);
  }
  company.accepted.push(id);
  return { text: `Signed "${contract.title}" with ${contract.customer}: ${money(contract.payout)} on delivery by day ${contract.deadline}.`, notices: [] };
}

export function fire(company: Company, engine: Engine, seconds: number, facility: Facility): ActionResult {
  const { value, notices } = viaCampaign(company, "test", `${engine.name} hot-fire`, () =>
    hotFire(company.campaign, engine, seconds, facility),
  );
  return { text: value.text, notices };
}

export function tunnel(company: Company, key: string, facility: AeroFacility): ActionResult {
  const vehicle = designOf(company, key);
  const { value, notices } = viaCampaign(company, "test", `${aeroShape(vehicle).label} ${facility}`, () =>
    tunnelRun(company.campaign, vehicle, facility),
  );
  return { text: value.text, notices };
}

export function fixEngine(company: Company, engine: Engine, mode: FailureMode): ActionResult {
  const { value, notices } = viaCampaign(company, "fix", `${engine.name} ${mode}`, () =>
    applyFix(company.campaign, engine, mode),
  );
  return { text: value.text, notices };
}

export function fixAero(company: Company, key: string, mode: FailureMode): ActionResult {
  const vehicle = designOf(company, key);
  const { value, notices } = viaCampaign(company, "fix", `${aeroShape(vehicle).label} ${mode}`, () =>
    applyAeroFix(company.campaign, vehicle, mode),
  );
  return { text: value, notices };
}

/** Re-tune a design's pitch programme for a contract's mission and payload. */
export function retune(company: Company, key: string, contractId: string): ActionResult {
  const design = designOf(company, key);
  const contract = contractOf(company, contractId);
  const loaded = { ...design, payloadMass: contract.payloadMass };
  const { value, notices } = viaCampaign(company, "analysis", `${design.name} re-tune`, () =>
    retuneFromTests(company.campaign, loaded, contract.mission),
  );
  company.designs[key] = { ...design, pitchProgram: value.vehicle.pitchProgram };
  return { text: value.text, notices };
}

export function build(company: Company, key: string): ActionResult {
  alive(company);
  const design = designOf(company, key);
  const { cost, days } = vehicleCost(design);
  const notices = charge(company, "build", cost, days, `${design.name} build`);
  company.inventory[key] = (company.inventory[key] ?? 0) + 1;
  return { text: `Built a ${design.name}: ${money(cost)}, ${days} days. Ready on day ${company.day}.`, notices };
}

export type FlightReport = ActionResult & { result: FlightResult };

/**
 * Fly a built vehicle, for a signed contract or as a test flight on a
 * given mission. The debrief is written from what the company knew before
 * the flight; then the telemetry is learned.
 */
export function fly(company: Company, key: string, target: { contract: string } | { mission: Mission }): FlightReport {
  alive(company);
  const design = designOf(company, key);
  if (!company.inventory[key]) throw new Error(`No ${design.name} built. Build one first.`);
  const contract = "contract" in target ? contractOf(company, target.contract) : null;
  if (contract && !company.accepted.includes(contract.id)) throw new Error(`"${contract.title}" isn't signed.`);
  const mission = contract?.mission ?? (target as { mission: Mission }).mission;
  const vehicle = { ...design, payloadMass: contract?.payloadMass ?? design.payloadMass };

  const notices = charge(company, "launch", COSTS.launchFee, COSTS.padDays, `${design.name} launch`);
  company.inventory[key]! -= 1;
  const result = simulateAscent(vehicle, mission, { hardware: company.campaign.truth, aero: company.campaign.aeroTruth });
  const lines = [debrief(result, vehicle, mission, company.campaign)];
  learnFromFlight(company.campaign, vehicle, result);
  recordExperience(company, key, vehicle, result);

  if (result.outcome === "orbit" && company.firstOrbitDay === null) {
    company.firstOrbitDay = company.day;
    lines.push("", `First orbit, day ${company.day}.`);
  }

  if (contract) {
    const s = settle(contract, result);
    company.accepted = company.accepted.filter((a) => a !== contract.id);
    company.closed[contract.id] = s.status;
    company.record.push({ day: company.day, tag: s.tag, reputation: s.reputation, note: contract.title });
    if (s.payout > 0) {
      company.cash += s.payout;
      company.ledger.push({ day: company.day, category: "payout", amount: s.payout, note: contract.title });
    }
    if (s.penalty > 0) {
      company.cash -= s.penalty;
      company.ledger.push({ day: company.day, category: "penalty", amount: -s.penalty, note: contract.title });
    }
    lines.push("", s.text);
    notices.push(...tick(company));
  } else {
    const failure = result.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure");
    if (failure?.mode) company.record.push({ day: company.day, tag: failure.mode, reputation: -1, note: `${design.name} test flight` });
  }
  return { text: lines.join("\n"), notices, result };
}

function recordExperience(company: Company, key: string, vehicle: Vehicle, result: FlightResult): void {
  const xp = (company.experience[key] ??= { flights: 0, orbits: 0, maxApoapsis: 0, inclinations: [], maxPayload: 0 });
  xp.flights += 1;
  xp.maxPayload = Math.max(xp.maxPayload, vehicle.payloadMass);
  if (result.outcome === "orbit" && result.summary.orbit) {
    xp.orbits += 1;
    xp.maxApoapsis = Math.max(xp.maxApoapsis, result.summary.orbit.apoapsis);
    const inclination = Math.round(result.summary.inclination * 10) / 10;
    if (!xp.inclinations.includes(inclination)) xp.inclinations.push(inclination);
  }
}

/**
 * The bid screen: what the contract pays and risks, and everything this
 * design would be doing for the first time or on trust.
 */
export function brief(company: Company, contractId: string, key: string): string {
  const contract = contractOf(company, contractId);
  const design = designOf(company, key);
  const vehicle = { ...design, payloadMass: contract.payloadMass };
  const mission = contract.mission;
  const lines = [
    `BID: ${contract.title} (${contract.customer})`,
    `  ${money(contract.payout)} on delivery, ${money(contract.penalty)} penalty, fly by day ${contract.deadline} (${contract.deadline - company.day} days from now).`,
  ];
  if (contract.minReputation > 0) lines.push(`  Needs reputation ${contract.minReputation}; the company has ${reputation(company)}.`);
  if (contract.refuses.length > 0) lines.push(`  Won't sign after: ${contract.refuses.map(describeTag).join(", ")}.`);

  const { cost, days } = vehicleCost(vehicle);
  lines.push(`  A ${design.name} costs ${money(cost)} and ${days} days to build.`);

  const regimes: string[] = [];
  const xp = company.experience[key];
  const target = mission.target;
  if (!xp || xp.flights === 0) regimes.push(`The ${design.name} has never flown.`);
  else {
    if (target && xp.orbits === 0) regimes.push(`The ${design.name} has never reached orbit.`);
    if (contract.payloadMass > xp.maxPayload) regimes.push(`Heaviest payload flown is ${xp.maxPayload} kg; this is ${contract.payloadMass} kg.`);
    if (target && xp.orbits > 0 && target.apoapsis > xp.maxApoapsis + target.tolerance.altitude) {
      regimes.push(`Highest orbit flown is ${(xp.maxApoapsis / 1000).toFixed(0)} km; this needs ${(target.apoapsis / 1000).toFixed(0)} km.`);
    }
    if (target && xp.orbits > 0 && !xp.inclinations.some((i) => Math.abs(i - target.inclination) <= target.tolerance.inclination)) {
      regimes.push(`Never flown to ${target.inclination}°.`);
    }
  }
  if (target && target.inclination < Math.abs(mission.site.latitude)) {
    regimes.push(`${mission.site.name} can't launch directly into ${target.inclination}°: the pad is at ${mission.site.latitude}°.`);
  }
  if (target && target.inclination > 90) regimes.push("Retrograde: the Earth's spin works against this launch.");
  if (regimes.length > 0) {
    lines.push("  New regimes:");
    for (const r of regimes) lines.push(`    ${r}`);
  }

  const unknowns = flightUnknowns(vehicle, company.campaign);
  if (unknowns.length > 0) {
    lines.push("  On trust:");
    for (const u of unknowns) lines.push(`    ${u.subject}: ${u.text}`);
  }

  const forecast = simulateAscent(vehicle, mission, {
    hardware: believedHardware(company.campaign),
    aero: believedAero(company.campaign),
  });
  lines.push(`  Forecast from what's known: ${describeForecast(contract, forecast)}`);
  return lines.join("\n");
}

function describeForecast(contract: Contract, forecast: FlightResult): string {
  const failure = forecast.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure");
  if (failure?.mode) return `lost to a known ${FAILURE_LABELS[failure.mode]} at T+${failure.t.toFixed(1)} s.`;
  if (contract.minApogee !== undefined) {
    const apogee = forecast.summary.apogee;
    return `apogee ${(apogee / 1000).toFixed(0)} km against ${(contract.minApogee / 1000).toFixed(0)} km needed.`;
  }
  const orbit = forecast.summary.orbit;
  if (forecast.outcome !== "orbit" || !orbit) return "no orbit with this payload.";
  const ins = forecast.summary.insertion!;
  return `${(orbit.periapsis / 1000).toFixed(0)} × ${(orbit.apoapsis / 1000).toFixed(0)} km, ${ins.inSpec ? "in spec" : "out of spec"}, ${Math.round(forecast.summary.propellantMargin)} kg margin.`;
}

function describeTag(tag: Tag): string {
  switch (tag) {
    case "no-orbit":
      return "a payload that never reached orbit";
    case "short":
      return "an experiment flown short";
    case "insertion-miss":
      return "an orbit out of spec";
    case "late":
      return "a missed deadline";
    case "delivered":
      return "a delivery";
    default:
      return `a ${FAILURE_LABELS[tag]}`;
  }
}

export function status(company: Company): string {
  const lines = [`Day ${company.day}. Cash ${money(company.cash)}. Reputation ${reputation(company)}.`];
  const built = Object.entries(company.inventory).filter(([, n]) => n > 0);
  if (built.length > 0) lines.push(`  On the ground: ${built.map(([k, n]) => `${n} × ${company.designs[k]!.name}`).join(", ")}.`);
  for (const id of company.accepted) {
    const c = contractOf(company, id);
    lines.push(`  Signed: ${c.title}, due day ${c.deadline}.`);
  }
  return lines.join("\n");
}

/** The end-of-run account: where the money went and what the record says. */
export function summary(company: Company): string {
  const lines = [
    company.dead ? `THE COMPANY DIED ON DAY ${company.day}.` : `DAY ${company.day}: STILL IN BUSINESS.`,
    `  Cash ${money(company.cash)}, reputation ${reputation(company)}.`,
    company.firstOrbitDay === null ? "  Never reached orbit." : `  First orbit on day ${company.firstOrbitDay}.`,
  ];
  const totals = new Map<Category, number>();
  for (const e of company.ledger) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  const labels: Record<Category, string> = {
    test: "Tests",
    fix: "Fixes",
    analysis: "Analysis",
    build: "Vehicles built",
    launch: "Launch fees",
    payout: "Contract payouts",
    penalty: "Penalties",
  };
  lines.push("  Money:");
  for (const [category, amount] of totals) lines.push(`    ${labels[category].padEnd(18)} ${money(amount).padStart(9)}`);
  if (company.record.length > 0) {
    lines.push("  Record:");
    for (const r of company.record) lines.push(`    Day ${r.day}: ${describeTag(r.tag)} (${r.note}).`);
  }
  return lines.join("\n");
}
