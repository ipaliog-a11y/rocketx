import { simulateAscent, type FlightResult } from "./ascent.ts";
import { aeroShape, rollAeroTruth, rollAeroTruths } from "./airframe.ts";
import { assembleVehicle, checkVehicle, designQuote, type VehicleSpec } from "./builder.ts";
import { settle, type Contract, type Settlement, type Tag } from "./contracts.ts";
import { COSTS, vehicleCost } from "./cost.ts";
import { debrief } from "./debrief.ts";
import type { Engine } from "./engine.ts";
import { combineTruth, FAILURE_LABELS, rollPartTruths, rollTruths, type FailureMode } from "./hardware.ts";
import type { Mission } from "./mission.ts";
import { holds, LICENCE_LABELS, LICENCE_COSTS, missionLicence, nextLicence, requiredLicence, SPACE_LINE, type Licence } from "./licence.ts";
import {
  assembleEngine,
  developmentCost,
  INJECTORS,
  NOZZLES,
  parsePartKey,
  partKeys,
  partLabel,
  partsProblems,
  type EngineParts,
  type InjectorOption,
  type NozzleOption,
} from "./parts.ts";
import { learnFromFlight } from "./telemetry.ts";
import {
  applyFix,
  believedHardware,
  enginesUsing,
  partKnowledgeOf,
  refreshFromParts,
  revisionLetter,
  flightUnknowns,
  hotFire,
  newCampaign,
  type Campaign,
  type Facility,
  type Unknown,
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
 * The run ends when the cash runs out, or, before first orbit, when the
 * company can no longer afford a vehicle that could get there.
 */

export type Category = "test" | "fix" | "rnd" | "analysis" | "build" | "facility" | "launch" | "licence" | "overhead" | "payout" | "penalty";

/** A vehicle on a production line, paid for, rolling out on its ready day. */
export type Order = { design: string; line: number; startDay: number; readyDay: number };

/** How a contract ended. "withdrawn" is a series instance the customer pulled after a failure. */
export type Closed = "delivered" | "degraded" | "failed" | "late" | "withdrawn";

export type MoneyEntry = { day: number; category: Category; amount: number; note: string };
export type RecordEntry = { day: number; tag: Tag; reputation: number; note: string };

/** One launch, as the ledger remembers it. */
export type FlightLogEntry = {
  day: number;
  design: string;
  mission: string;
  contract: string | null;
  outcome: FlightResult["outcome"];
  /** Highest point reached, m: the apoapsis for an orbit. */
  apogee: number;
  /** What the customer made of it, for contract flights. */
  settlement: "delivered" | "degraded" | "failed" | null;
};

/** What a design has actually flown. A bid that goes past this is a new regime. */
export type Experience = { flights: number; orbits: number; maxApoapsis: number; inclinations: number[]; maxPayload: number };

export type Company = {
  /** The player's name for the firm. */
  name: string;
  seed: number;
  licence: Licence;
  day: number;
  /** $k. */
  cash: number;
  campaign: Campaign;
  /** Current designs by key. A re-tune changes the design's pitch programme. */
  designs: Record<string, Vehicle>;
  /** Built vehicles waiting for the pad, by design key. */
  inventory: Record<string, number>;
  /** Production lines, each as the day it is next free. A line bought but not finished is free from its completion day. */
  lines: number[];
  /** Vehicles in production, oldest first. */
  orders: Order[];
  /** Vehicles built over the run, by design key. */
  built: Record<string, number>;
  board: Contract[];
  accepted: string[];
  closed: Record<string, Closed>;
  ledger: MoneyEntry[];
  record: RecordEntry[];
  experience: Record<string, Experience>;
  flights: FlightLogEntry[];
  firstOrbitDay: number | null;
  dead: boolean;
};

export function newCompany(
  seed: number,
  startingCash: number,
  designs: Record<string, Vehicle>,
  engines: Engine[],
  board: Contract[],
  name = "Untitled Launch Co.",
): Company {
  const campaign = newCampaign(rollTruths(engines, seed), rollAeroTruths(Object.values(designs), seed), {
    engines,
    partTruth: rollPartTruths(engines, seed),
  });
  return {
    name,
    seed,
    licence: "suborbital",
    day: 0,
    cash: startingCash,
    campaign,
    designs: { ...designs },
    inventory: {},
    lines: [0],
    orders: [],
    built: {},
    board,
    accepted: [],
    closed: {},
    ledger: [],
    record: [],
    experience: {},
    flights: [],
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
  const overhead = days * COSTS.overheadPerDay;
  if (overhead > 0) {
    company.cash -= overhead;
    company.ledger.push({ day: company.day, category: "overhead", amount: -overhead, note: `${days} days` });
  }
  return tick(company);
}

/** Let the calendar run: nothing happens but the payroll. */
export function wait(company: Company, days: number): ActionResult {
  alive(company);
  const notices = charge(company, "overhead", 0, days, "waiting");
  return { text: `Waited ${days} days: ${money(days * COSTS.overheadPerDay)} in overhead.`, notices };
}

/** Contracts on the board today. */
export function posted(company: Company): Contract[] {
  return company.board.filter((c) => c.postedDay <= company.day);
}

/** Deadlines that have passed, vehicles that rolled out, and whether the company can still pay its bills. */
function tick(company: Company): string[] {
  const notices: string[] = [];
  for (const order of company.orders.filter((o) => o.readyDay <= company.day)) {
    company.inventory[order.design] = (company.inventory[order.design] ?? 0) + 1;
    notices.push(`Day ${order.readyDay}: a ${company.designs[order.design]?.name ?? order.design} rolled out of line ${order.line + 1}.`);
  }
  company.orders = company.orders.filter((o) => o.readyDay > company.day);
  for (const id of [...company.accepted]) {
    const contract = contractOf(company, id);
    if (company.day <= contract.deadline) continue;
    company.accepted = company.accepted.filter((a) => a !== id);
    company.closed[id] = "late";
    company.cash -= contract.penalty;
    company.ledger.push({ day: company.day, category: "penalty", amount: -contract.penalty, note: `${contract.title}: missed the deadline` });
    company.record.push({ day: company.day, tag: "late", reputation: -1, note: contract.title });
    notices.push(`Day ${contract.deadline}: ${contract.customer} gave up waiting on "${contract.title}". Penalty $${contract.penalty}k.`);
    notices.push(...seriesAfter(company, contract, false));
  }
  if (company.dead) return notices;
  if (company.cash < 0) {
    company.dead = true;
    notices.push(`Day ${company.day}: the cash is gone. The company is dead.`);
  } else if (stranded(company)) {
    company.dead = true;
    notices.push(
      `Day ${company.day}: with ${money(company.cash)} and nothing built that can reach orbit, the company can't afford another try at LEO. It is finished.`,
    );
  }
  return notices;
}

/**
 * Before first orbit, the run is over once no vehicle can put anything in
 * orbit: none is built, and the cash plus what signed contracts would pay
 * can't buy and launch the cheapest orbital design.
 */
function stranded(company: Company): boolean {
  if (company.firstOrbitDay !== null) return false;
  const orbital = Object.entries(company.designs).filter(([, d]) => d.pitchProgram?.kind === "gravity-turn");
  if (orbital.length === 0) return false;
  if (orbital.some(([key]) => (company.inventory[key] ?? 0) > 0 || company.orders.some((o) => o.design === key))) return false;
  const licence = holds(company, "orbital") ? 0 : LICENCE_COSTS.orbital.fee;
  const cheapest = Math.min(...orbital.map(([, d]) => vehicleCost(d).cost + COSTS.launchFee)) + licence;
  const owed = company.accepted.reduce((sum, id) => sum + contractOf(company, id).payout, 0);
  return company.cash + owed < cheapest;
}

function contractOf(company: Company, id: string): Contract {
  const contract = company.board.find((c) => c.id === id);
  if (!contract) throw new Error(`No contract "${id}" on the board.`);
  return contract;
}

/**
 * A series customer reacts to how an instance went: a delivery makes the
 * later ones pay 5% more, a failure or a missed deadline pulls every later
 * instance nobody has flown yet.
 */
function seriesAfter(company: Company, contract: Contract, ok: boolean): string[] {
  if (!contract.seriesId) return [];
  const later = company.board.filter(
    (c) => c.seriesId === contract.seriesId && (c.seriesIndex ?? 0) > (contract.seriesIndex ?? 0) && !company.closed[c.id] && !company.accepted.includes(c.id),
  );
  if (ok) {
    for (const c of later) c.payout = Math.round(c.payout * 1.05);
    return [];
  }
  for (const c of later) company.closed[c.id] = "withdrawn";
  return later.length > 0 ? [`${contract.customer} has withdrawn the rest of the series (${later.length} launch${later.length === 1 ? "" : "es"}).`] : [];
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

/** What refining a part costs, and how far it can go. */
export const REFINE = { cost: 120, days: 15, max: 3, step: 0.006 };

/** Every part some engine of the company's is built from: developed, so free to reuse. */
export function developedParts(company: Company): string[] {
  return [...new Set(Object.values(company.campaign.engines).flatMap((e) => (e.parts ? Object.values(partKeys(e.parts)) : [])))];
}

/**
 * Develop a new engine from parts. Parts the company already builds come
 * free, with everything tests have learned about them; new parts cost
 * development money and time, and bring new unknowns.
 */
export function developEngine(company: Company, parts: EngineParts, name: string): ActionResult {
  alive(company);
  const clean = name.trim();
  if (clean.length === 0) throw new Error("The engine needs a name.");
  if (company.campaign.engines[clean]) throw new Error(`There is already an engine called ${clean}.`);
  const problems = partsProblems(parts);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const { cost, days, newParts } = developmentCost(parts, developedParts(company));
  const engine = assembleEngine(parts, clean);
  const notices = charge(company, "rnd", cost, days, `${clean} development`);
  rollPartTruths([engine], company.seed, company.campaign.partTruth);
  company.campaign.truth[clean] = combineTruth(engine, company.campaign.partTruth);
  company.campaign.engines[clean] = engine;
  refreshFromParts(company.campaign);
  const reused = 4 - newParts.length;
  return {
    text: `${clean} developed: ${(engine.thrustVac / 1000).toFixed(1)} kN, Isp ${engine.ispVac} s on paper. ${newParts.length === 0 ? "Every part was already in production." : `New parts: ${newParts.map(partLabel).join(", ")}.`}${reused > 0 ? ` ${reused} part${reused === 1 ? "" : "s"} reused, with what tests know about them.` : ""} ${money(cost)}, ${days} days.`,
    notices,
  };
}

/**
 * Refine an injector or nozzle: tune elements and contour against measured
 * Isp. Each round closes part of the gap to the best the part can do, and
 * the gain is only known once it is measured again.
 */
export function refinePart(company: Company, key: string): ActionResult {
  alive(company);
  const { slot, option } = parsePartKey(key);
  if (slot !== "injector" && slot !== "nozzle") throw new Error("Only injectors and nozzles can be refined: they set how much of the design Isp the engine delivers.");
  const users = enginesUsing(company.campaign, key);
  if (users.length === 0) throw new Error(`No engine uses ${partLabel(key)}.`);
  const part = partKnowledgeOf(company.campaign, key);
  if (part.refinements >= REFINE.max) throw new Error(`${partLabel(key)} has been refined as far as it goes.`);
  if (!users.some((e) => company.campaign.knowledge[e.name]?.measuredIspFactor != null)) {
    throw new Error(`Measure Isp on an engine with ${partLabel(key)} first: refining needs to know how far off it is.`);
  }
  const top = slot === "injector" ? INJECTORS[option as InjectorOption].isp[1] : NOZZLES[option as NozzleOption].ispRange[1];
  const truth = company.campaign.partTruth[key];
  if (truth) {
    const before = truth.ispFactor;
    const after = Math.min(top, before + REFINE.step);
    truth.ispFactor = after;
    for (const e of users) {
      const t = company.campaign.truth[e.name];
      if (t) t.ispFactor *= after / before;
    }
  }
  for (const e of users) {
    const k = company.campaign.knowledge[e.name];
    if (k) k.measuredIspFactor = null;
  }
  part.refinements += 1;
  part.revision += 1;
  part.notes.push(`${revisionLetter(part.revision)}: refined against measured Isp.`);
  const notices = charge(company, "rnd", REFINE.cost, REFINE.days, `${partLabel(key)} refinement`);
  return {
    text: `${partLabel(key)} goes to ${revisionLetter(part.revision)}: elements and contour tuned against the measured Isp. Fire it again to see what it gained. ${money(REFINE.cost)}, ${REFINE.days} days.`,
    notices,
  };
}

/**
 * Put a different engine on one stage of a design. Same tanks and engine
 * count; the thrust, Isp and burn time change, so the trajectory wants a
 * re-tune. Only while none of the design are built: vehicles on the ground
 * keep the engines they were built with.
 */
export function reengine(company: Company, key: string, stageIndex: number, engineName: string): ActionResult {
  alive(company);
  const design = designOf(company, key);
  const stage = design.stages[stageIndex];
  if (!stage) throw new Error(`${design.name} has no stage ${stageIndex + 1}.`);
  const engine = company.campaign.engines[engineName];
  if (!engine) throw new Error(`No engine called ${engineName}.`);
  if ((company.inventory[key] ?? 0) > 0 || company.orders.some((o) => o.design === key)) {
    throw new Error(`${design.name} vehicles are already built or on the line with the old engines. Fly them first.`);
  }
  if (stage.engine.name === engine.name) return { text: `${stage.name} already flies the ${engine.name}.`, notices: [] };
  const was = stage.engine.name;
  company.designs[key] = { ...design, stages: design.stages.map((s, i) => (i === stageIndex ? { ...s, engine } : s)) };
  return { text: `${design.name}: ${stage.name} now flies ${stage.engineCount} × ${engine.name} instead of ${was}. Re-tune the trajectory before an orbital flight.`, notices: [] };
}

/** Rename the company. Customers don't mind. */
export function rename(company: Company, name: string): void {
  const clean = name.trim().slice(0, 40);
  if (clean.length === 0) throw new Error("The company needs a name.");
  company.name = clean;
}

/** Apply for the next licence tier: pay the fee and wait out the review. */
export function applyForLicence(company: Company): ActionResult {
  alive(company);
  const next = nextLicence(company, reputation(company));
  if (!next) throw new Error("The company already holds every licence there is.");
  const missing = next.requirements.filter((r) => !r.met);
  if (missing.length > 0) throw new Error(`The regulator wants: ${missing.map((r) => r.text.toLowerCase()).join("; ")}.`);
  const notices = charge(company, "licence", next.fee, next.days, `${LICENCE_LABELS[next.tier]} licence`);
  if (!company.dead) company.licence = next.tier;
  return { text: `${LICENCE_LABELS[next.tier]} licence granted on day ${company.day}: ${money(next.fee)} and ${next.days} days of review.`, notices };
}

export function accept(company: Company, id: string): ActionResult {
  alive(company);
  const contract = contractOf(company, id);
  if (company.accepted.includes(id) || company.closed[id]) throw new Error(`"${contract.title}" is no longer open.`);
  if (company.day < contract.postedDay) throw new Error(`"${contract.title}" isn't on the board yet.`);
  if (company.day > contract.deadline) throw new Error(`"${contract.title}" has expired.`);
  const needs = requiredLicence(contract);
  if (!holds(company, needs)) throw new Error(`"${contract.title}" needs the ${LICENCE_LABELS[needs].toLowerCase()} licence.`);
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

/** Re-tune a design's pitch programme for a mission with the design's own payload: a test flight. */
export function retuneForMission(company: Company, key: string, mission: Mission): ActionResult {
  const design = designOf(company, key);
  const { value, notices } = viaCampaign(company, "analysis", `${design.name} re-tune`, () => retuneFromTests(company.campaign, design, mission));
  company.designs[key] = { ...design, pitchProgram: value.vehicle.pitchProgram };
  return { text: value.text, notices };
}

/** A key for a new design's name, unique among the company's designs. */
function designKey(company: Company, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "design";
  let key = base;
  for (let i = 2; company.designs[key]; i++) key = `${base}-${i}`;
  return key;
}

/**
 * Draw up a new design. The drawing office always costs something; new tank
 * or fairing diameters need tooling the first time. A new outer shape is a
 * new aerodynamic unknown for the tunnel.
 */
export function designVehicle(company: Company, spec: VehicleSpec): ActionResult & { key: string } {
  alive(company);
  const engines = company.campaign.engines;
  const { problems } = checkVehicle(spec, engines, Object.values(company.designs).map((d) => d.name));
  if (problems.length > 0) throw new Error(problems.join(" "));
  const vehicle = assembleVehicle({ ...spec, name: spec.name.trim() }, engines);
  const quote = designQuote(spec, Object.values(company.designs));
  const key = designKey(company, vehicle.name);
  const notices = charge(company, "rnd", quote.cost, quote.days, `${vehicle.name} design`);
  company.designs[key] = vehicle;
  const shape = aeroShape(vehicle);
  const newShape = !company.campaign.aeroTruth[shape.key];
  company.campaign.aeroTruth[shape.key] ??= rollAeroTruth(vehicle, company.seed);
  const tooling = [
    ...quote.newTanks.map((d) => `${d} m tank tooling`),
    ...(quote.newFairing ? [`${spec.fairingDiameter} m fairing tooling`] : []),
  ];
  return {
    key,
    text: `${vehicle.name} drawn up: ${money(quote.cost)}, ${quote.days} days.${tooling.length > 0 ? ` New: ${tooling.join(", ")}.` : ""}${newShape ? ` Its ${shape.label} is a shape the tunnel has never seen.` : ""}`,
    notices,
  };
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

/** What the next order on the first free line would look like. */
export function nextSlot(company: Company, key: string): { line: number; startDay: number; readyDay: number } {
  const { days } = vehicleCost(designOf(company, key));
  let line = 0;
  company.lines.forEach((free, i) => {
    if (free < company.lines[line]!) line = i;
  });
  const startDay = Math.max(company.day, company.lines[line]!);
  return { line, startDay, readyDay: startDay + days };
}

/** When the next vehicle of a design is ready: today if one is on the ground, its ready day if one is on a line, else null. */
export function readyDay(company: Company, key: string): number | null {
  if ((company.inventory[key] ?? 0) > 0) return company.day;
  const days = company.orders.filter((o) => o.design === key).map((o) => o.readyDay);
  return days.length > 0 ? Math.min(...days) : null;
}

/**
 * Order a vehicle. It is paid for now and goes on the production line that
 * frees up first; the company keeps working while it is built, and it rolls
 * out on its ready day.
 */
export function build(company: Company, key: string): ActionResult {
  alive(company);
  const design = designOf(company, key);
  const { cost } = vehicleCost(design);
  const slot = nextSlot(company, key);
  // On the books before the bill lands: a company that spends its last cash
  // on an orbital vehicle still has a vehicle that can reach orbit.
  company.orders.push({ design: key, ...slot });
  company.lines[slot.line] = slot.readyDay;
  company.built[key] = (company.built[key] ?? 0) + 1;
  const notices = charge(company, "build", cost, 0, `${design.name} build`);
  const queued = slot.startDay > company.day ? `, after the line's current job (starts day ${slot.startDay})` : "";
  return { text: `Ordered a ${design.name} on line ${slot.line + 1}${queued}: ${money(cost)}. Ready on day ${slot.readyDay}.`, notices };
}

/** Production lines beyond the first: what each costs and how long it takes to set up. */
export const LINE_COSTS = [
  { cost: 2_500, days: 30 },
  { cost: 4_000, days: 45 },
];

/** Buy another production line. Paid now; it starts taking orders once it is set up. */
export function buyLine(company: Company): ActionResult {
  alive(company);
  const next = LINE_COSTS[company.lines.length - 1];
  if (!next) throw new Error(`The company already runs ${company.lines.length} production lines, as many as the site holds.`);
  company.lines.push(company.day + next.days);
  const notices = charge(company, "facility", next.cost, 0, `Production line ${company.lines.length}`);
  return { text: `Production line ${company.lines.length} bought: ${money(next.cost)}. It takes orders from day ${company.day + next.days}.`, notices };
}

export type FlightReport = ActionResult & {
  result: FlightResult;
  /** The engineer's debrief, written from what was known before the flight. */
  debrief: string;
  /** What the customer made of it, for contract flights. */
  settlement: Settlement | null;
};

/**
 * Fly a built vehicle, for a signed contract or as a test flight on a
 * given mission. The debrief is written from what the company knew before
 * the flight; then the telemetry is learned.
 */
export function fly(company: Company, key: string, target: { contract: string } | { mission: Mission }): FlightReport {
  alive(company);
  const design = designOf(company, key);
  const ready = readyDay(company, key);
  if (ready === null) throw new Error(`No ${design.name} built. Build one first.`);
  const contract = "contract" in target ? contractOf(company, target.contract) : null;
  if (contract && !company.accepted.includes(contract.id)) throw new Error(`"${contract.title}" isn't signed.`);
  const mission = contract?.mission ?? (target as { mission: Mission }).mission;
  const needs = missionLicence(mission);
  if (!holds(company, needs)) throw new Error(`Flying to orbit needs an orbital licence. Apply on the company page.`);
  const early: string[] = [];
  if (ready > company.day) {
    // Launch on rollout: the calendar runs, and the payroll with it, until the vehicle is ready.
    early.push(...charge(company, "overhead", 0, ready - company.day, `waiting for the ${design.name} to roll out`));
    alive(company);
    if (contract && !company.accepted.includes(contract.id)) {
      throw new Error(`The ${design.name} rolled out on day ${ready}, after "${contract.title}" was due.`);
    }
  }
  const vehicle = { ...design, payloadMass: contract?.payloadMass ?? design.payloadMass };

  const notices = [...early, ...charge(company, "launch", COSTS.launchFee, COSTS.padDays, `${design.name} launch`)];
  company.inventory[key]! -= 1;
  const result = simulateAscent(vehicle, mission, { hardware: company.campaign.truth, aero: company.campaign.aeroTruth });
  const written = debrief(result, vehicle, mission, company.campaign);
  const lines = [written];
  let settlement: Settlement | null = null;
  const orbitedBefore = (company.experience[key]?.orbits ?? 0) > 0;
  learnFromFlight(company.campaign, vehicle, result);
  recordExperience(company, key, vehicle, result);

  if (result.outcome === "orbit" && company.firstOrbitDay === null) {
    company.firstOrbitDay = company.day;
    lines.push("", `First orbit, day ${company.day}.`);
  }

  if (contract) {
    const s = settle(contract, result);
    settlement = s;
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
    const after = seriesAfter(company, contract, s.status !== "failed");
    if (after.length > 0) lines.push(...after);
  } else {
    const failure = result.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure");
    if (failure?.mode) company.record.push({ day: company.day, tag: failure.mode, reputation: -1, note: `${design.name} test flight` });
    // A design's first orbit is flight heritage customers will pay for.
    if (result.outcome === "orbit" && !orbitedBefore) {
      company.record.push({ day: company.day, tag: "demonstrated", reputation: 1, note: `${design.name} demonstration flight` });
      lines.push("", `The ${design.name} has demonstrated orbit. Customers notice: reputation +1.`);
    } else if (!failure && reputation(company) < 0 && result.summary.apogee >= SPACE_LINE) {
      // The way back from a bad record: fly cleanly where people can see it.
      // Each clean flight above 100 km wins back a point, up to zero.
      company.record.push({ day: company.day, tag: "demonstrated", reputation: 1, note: `${design.name} recovery flight` });
      lines.push("", `A clean flight above 100 km. Customers and the regulator notice: reputation +1, now ${reputation(company)}.`);
    }
  }
  company.flights.push({
    day: company.day,
    design: design.name,
    mission: mission.name,
    contract: contract?.title ?? null,
    outcome: result.outcome,
    apogee: result.summary.apogee,
    settlement: settlement?.status ?? null,
  });
  notices.push(...tick(company));
  return { text: lines.join("\n"), notices, result, debrief: written, settlement };
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

export type Bid = {
  contract: Contract;
  designName: string;
  /** Cost and days to build one vehicle for this payload. */
  build: { cost: number; days: number };
  daysLeft: number;
  /** Building and launching now still makes the deadline. */
  fitsSchedule: boolean;
  /** Why the customer won't sign today, if they won't. */
  blockers: string[];
  /** Things this design has never done that the contract asks for. */
  regimes: string[];
  /** Everything the vehicle would fly on trust. */
  unknowns: Unknown[];
  forecast: { text: string; delivers: boolean; result: FlightResult };
};

/**
 * The bid screen: what the contract pays and risks, and everything this
 * design would be doing for the first time or on trust.
 */
export function bid(company: Company, contractId: string, key: string): Bid {
  const contract = contractOf(company, contractId);
  const design = designOf(company, key);
  const vehicle = { ...design, payloadMass: contract.payloadMass };
  const mission = contract.mission;
  const build = vehicleCost(vehicle);

  const blockers: string[] = [];
  if (company.accepted.includes(contract.id)) blockers.push("Already signed.");
  else if (company.closed[contract.id]) blockers.push("Closed.");
  if (company.day > contract.deadline) blockers.push("The deadline has passed.");
  if (reputation(company) < contract.minReputation) {
    blockers.push(`${contract.customer} wants a reputation of ${contract.minReputation}; the company has ${reputation(company)}.`);
  }
  const needs = requiredLicence(contract);
  if (!holds(company, needs)) blockers.push(`Needs the ${LICENCE_LABELS[needs].toLowerCase()} licence; the company holds ${LICENCE_LABELS[company.licence].toLowerCase()}.`);
  const objection = company.record.find((r) => contract.refuses.includes(r.tag));
  if (objection) blockers.push(`${contract.customer} won't sign with a record that shows ${describeTag(objection.tag)}.`);

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

  const forecast = simulateAscent(vehicle, mission, {
    hardware: believedHardware(company.campaign),
    aero: believedAero(company.campaign),
  });
  const delivers =
    contract.minApogee !== undefined
      ? forecast.outcome === "apogee" && forecast.summary.apogee >= contract.minApogee
      : (forecast.summary.insertion?.inSpec ?? false);

  return {
    contract,
    designName: design.name,
    build,
    daysLeft: contract.deadline - company.day,
    fitsSchedule: company.day + build.days + COSTS.padDays <= contract.deadline,
    blockers,
    regimes,
    unknowns: flightUnknowns(vehicle, company.campaign),
    forecast: { text: describeForecast(contract, forecast), delivers, result: forecast },
  };
}

/** The bid screen as text, for the command line. */
export function brief(company: Company, contractId: string, key: string): string {
  const b = bid(company, contractId, key);
  const c = b.contract;
  const lines = [
    `BID: ${c.title} (${c.customer})`,
    `  ${money(c.payout)} on delivery, ${money(c.penalty)} penalty, fly by day ${c.deadline} (${b.daysLeft} days from now).`,
  ];
  if (c.minReputation > 0) lines.push(`  Needs reputation ${c.minReputation}; the company has ${reputation(company)}.`);
  if (c.refuses.length > 0) lines.push(`  Won't sign after: ${c.refuses.map(describeTag).join(", ")}.`);
  lines.push(`  A ${b.designName} costs ${money(b.build.cost)} and ${b.build.days} days to build.`);
  if (b.regimes.length > 0) {
    lines.push("  New regimes:");
    for (const r of b.regimes) lines.push(`    ${r}`);
  }
  if (b.unknowns.length > 0) {
    lines.push("  On trust:");
    for (const u of b.unknowns) lines.push(`    ${u.subject}: ${u.text}`);
  }
  lines.push(`  Forecast from what's known: ${b.forecast.text}`);
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
    case "demonstrated":
      return "an orbital demonstration";
    default:
      return `a ${FAILURE_LABELS[tag]}`;
  }
}

export function status(company: Company): string {
  const lines = [`${company.name.replace(/\.$/, "")}. Day ${company.day}. Cash ${money(company.cash)}. Reputation ${reputation(company)}. ${LICENCE_LABELS[company.licence]} licence.`];
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
    rnd: "R&D",
    analysis: "Analysis",
    build: "Vehicles built",
    launch: "Launch fees",
    licence: "Licences",
    facility: "Facilities",
    overhead: "Overhead",
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
