import { simulateAscent, type FlightResult } from "./ascent.ts";
import { rollAeroTruths } from "./airframe.ts";
import type { VehicleSpec } from "./builder.ts";
import { settle, type Contract, type Settlement, type Tag } from "./contracts.ts";
import { COSTS, vehicleCost } from "./cost.ts";
import { debrief } from "./debrief.ts";
import type { Engine } from "./engine.ts";
import { FAILURE_LABELS, rollPartTruths, rollTruths, type FailureMode } from "./hardware.ts";
import type { Mission } from "./mission.ts";
import { holds, LICENCE_LABELS, LICENCE_COSTS, missionLicence, nextLicence, requiredLicence, SPACE_LINE, type Licence } from "./licence.ts";
import { designSpec, newUnits, nextEvent, runTask, runTracks, type Task, type TaskDone, type TaskSpec, type Track } from "./schedule.ts";
import { partKeys, type EngineParts } from "./parts.ts";
import { abortAt, abortOutcome, crewRating, inflightAbort, qAt, withCapsule, type Capsule } from "./crew.ts";
import { learnFromFlight } from "./telemetry.ts";
import { believedHardware, flightUnknowns, newCampaign, type Campaign, type Facility, type Unknown } from "./teststand.ts";
import { retuneFromTests } from "./tuning.ts";
import { believedAero, type AeroFacility } from "./tunnel.ts";
import { believedGnc, flownGnc } from "./control.ts";
import { flightWindSeed, rollWind } from "./wind.ts";
import { FLIGHT_PROVEN_TRUST, flightWear, nextSerial, restackCost, rollBoosterTruth, wearFailure, type BoosterUnit } from "./fleet.ts";
import { ENTRY_HEATING, RECOVERY_CAUSE_LABELS } from "./recovery.ts";
import { hashSeed } from "./random.ts";
import { burnTime, type Vehicle } from "./vehicle.ts";

/**
 * The company: the pressure around the engineering. Cash, a calendar,
 * reputation tagged by what went wrong, and a contract board. Work runs on
 * tracks side by side (see schedule.ts); production lines build vehicles
 * meanwhile, and the pad flies them.
 *
 * The run ends when the cash runs out, or, before first orbit, when the
 * company can no longer afford a vehicle that could get there.
 */

export type Category = "test" | "fix" | "rnd" | "analysis" | "build" | "facility" | "launch" | "licence" | "overhead" | "payout" | "penalty";

/** A vehicle on a production line, paid for, rolling out on its ready day. */
export type Order = { design: string; line: number; startDay: number; readyDay: number; /** A re-stack: the flown booster it's built on. */ booster?: string };

/** How a contract ended. "withdrawn" is a series instance the customer pulled after a failure. */
export type Closed = "delivered" | "degraded" | "failed" | "late" | "withdrawn";

export type MoneyEntry = { day: number; category: Category; amount: number; note: string };
/** `test`: on the company's own test flight. Nobody's payload was lost, so it costs no reputation and customers don't hold it against the company. */
export type RecordEntry = { day: number; tag: Tag; reputation: number; note: string; test?: boolean };

/** The entry in the record a customer won't sign over, if any. Test-flight failures don't count. */
export function objectionTo(company: Company, contract: Contract): RecordEntry | undefined {
  return company.record.find((r) => !r.test && contract.refuses.includes(r.tag));
}

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
  /** A recoverable booster: its serial, which flight of its this was, and whether it landed. */
  booster?: { serial: string; flight: number; landed: boolean };
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
  /** Jobs booked on the tracks, queued or running. */
  tasks: Task[];
  /** Recently finished jobs, newest last. */
  done: TaskDone[];
  nextTask: number;
  /** Units on each track, as the day each comes into service. */
  units: Record<Track, number[]>;
  /** The crew capsule, once developed. */
  capsule?: Capsule;
  /** Every recoverable booster the company has flown, by serial order. */
  boosters?: BoosterUnit[];
  /** Built vehicles stacked on a flown booster, by design key: the serials, first to fly first. */
  stacked?: Record<string, string[]>;
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
    tasks: [],
    done: [],
    nextTask: 1,
    units: newUnits(),
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
  if (amount !== 0) company.ledger.push({ day: company.day, category, amount: -amount, note });
  return settleDays(company, days);
}

/**
 * Let `days` pass. The clock stops wherever a job on the tracks finishes, so
 * what it found lands on its own day, and the next job can start.
 */
export function settleDays(company: Company, days: number): string[] {
  const target = company.day + days;
  const notices = runTracks(company);
  while (!company.dead) {
    const next = nextEvent(company);
    const to = next !== null && next > company.day && next < target ? next : target;
    const step = to - company.day;
    company.day = to;
    if (step > 0) {
      const overhead = step * COSTS.overheadPerDay;
      company.cash -= overhead;
      company.ledger.push({ day: company.day, category: "overhead", amount: -overhead, note: `${step} days` });
    }
    notices.push(...tick(company));
    if (company.dead) break;
    notices.push(...runTracks(company));
    if (company.day >= target) break;
  }
  return notices;
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
    if (order.booster) ((company.stacked ??= {})[order.design] ??= []).push(order.booster);
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
  return strandedWith(company, company.cash) !== null;
}

/**
 * Whether the company would be stranded with `cash` in hand: what another
 * orbital try would cost, or null when it isn't stranded. `ordering` is a
 * design about to be ordered, `lost` contracts that would lapse first.
 */
export function strandedWith(company: Company, cash: number, { ordering, lost = [] }: { ordering?: string; lost?: string[] } = {}): { needed: number } | null {
  if (company.firstOrbitDay !== null) return null;
  const orbital = Object.entries(company.designs).filter(([, d]) => d.pitchProgram?.kind === "gravity-turn");
  if (orbital.length === 0) return null;
  if (orbital.some(([key]) => key === ordering || (company.inventory[key] ?? 0) > 0 || company.orders.some((o) => o.design === key))) return null;
  const licence = holds(company, "orbital") ? 0 : LICENCE_COSTS.orbital.fee;
  const cheapest = Math.min(...orbital.map(([, d]) => vehicleCost(d).cost + COSTS.launchFee)) + licence;
  const owed = company.accepted.filter((id) => !lost.includes(id)).reduce((sum, id) => sum + contractOf(company, id).payout, 0);
  return cash + owed < cheapest ? { needed: cheapest - owed } : null;
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
  return runTask(company, { kind: "develop", name: name.trim(), parts });
}

/**
 * Refine an injector or nozzle: tune elements and contour against measured
 * Isp. Each round closes part of the gap to the best the part can do, and
 * the gain is only known once it is measured again.
 */
export function refinePart(company: Company, key: string): ActionResult {
  return runTask(company, { kind: "refine", part: key });
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

/** The licence an application now would be for. */
export function licenceSpec(company: Company): TaskSpec {
  const next = nextLicence(company, reputation(company));
  if (!next) throw new Error("The company already holds every licence there is.");
  return { kind: "licence", tier: next.tier };
}

/** Apply for the next licence tier: pay the fee and wait out the review. */
export function applyForLicence(company: Company): ActionResult {
  return runTask(company, licenceSpec(company));
}

/** Why the company can't sign a contract today, or null. A series commitment may sign launches not yet posted. */
function signingProblem(company: Company, contract: Contract, announcedOk = false): string | null {
  if (company.accepted.includes(contract.id) || company.closed[contract.id]) return `"${contract.title}" is no longer open.`;
  if (!announcedOk && company.day < contract.postedDay) return `"${contract.title}" isn't on the board yet.`;
  if (company.day > contract.deadline) return `"${contract.title}" has expired.`;
  const needs = requiredLicence(contract);
  if (!holds(company, needs)) return `"${contract.title}" needs the ${LICENCE_LABELS[needs].toLowerCase()} licence.`;
  if ((contract.kind === "cargo" || contract.kind === "crew") && !company.capsule) return `"${contract.title}" flies the company's own capsule: develop one first.`;
  if (reputation(company) < contract.minReputation) return `${contract.customer} wants a reputation of ${contract.minReputation}; the company has ${reputation(company)}.`;
  const objection = objectionTo(company, contract);
  if (objection) return `${contract.customer} won't sign with a company whose record shows ${describeTag(objection.tag)}.`;
  return null;
}

export function accept(company: Company, id: string): ActionResult {
  alive(company);
  const contract = contractOf(company, id);
  const problem = signingProblem(company, contract);
  if (problem) throw new Error(problem);
  company.accepted.push(id);
  return { text: `Signed "${contract.title}" with ${contract.customer}: ${money(contract.payout)} on delivery by day ${contract.deadline}.`, notices: [] };
}

/** Delivering every launch of a series earns this share of what the launches paid, on top. */
export const SERIES_BONUS = 0.15;

/** Every launch of a series, in order. */
export function seriesOf(company: Company, seriesId: string): Contract[] {
  return company.board.filter((c) => c.seriesId === seriesId).sort((a, b) => (a.seriesIndex ?? 0) - (b.seriesIndex ?? 0));
}

/** The bonus for delivering every launch of a series, $k, at today's prices. */
export function seriesBonus(company: Company, seriesId: string): number {
  return Math.round(SERIES_BONUS * seriesOf(company, seriesId).reduce((sum, c) => sum + c.payout, 0));
}

/** The first launch of a series that ended any way but delivered: once there is one, the bonus is gone. */
export function seriesBroken(company: Company, seriesId: string): Contract | undefined {
  return seriesOf(company, seriesId).find((c) => company.closed[c.id] && company.closed[c.id] !== "delivered");
}

/** The launches of a series a commitment would sign now: everything not flown, closed, signed or past due. */
export function uncommitted(company: Company, seriesId: string): Contract[] {
  return seriesOf(company, seriesId).filter((c) => !company.closed[c.id] && !company.accepted.includes(c.id) && company.day <= c.deadline);
}

/**
 * Sign every remaining launch of a series at once, including ones the
 * customer has announced but not posted yet. Each is an ordinary signed
 * contract: its own deadline, its own penalty.
 */
export function commitSeries(company: Company, seriesId: string): ActionResult {
  alive(company);
  const launches = uncommitted(company, seriesId);
  if (launches.length === 0) throw new Error("Nothing left in that series to sign.");
  for (const c of launches) {
    const problem = signingProblem(company, c, true);
    if (problem) throw new Error(problem);
  }
  for (const c of launches) company.accepted.push(c.id);
  const first = launches[0]!;
  return {
    text: `Committed to ${first.customer}'s series: ${launches.length} launch${launches.length === 1 ? "" : "es"} signed, due days ${launches.map((c) => c.deadline).join(", ")}.${seriesBroken(company, seriesId) ? "" : ` Deliver every launch for a ${money(seriesBonus(company, seriesId))} bonus.`}`,
    notices: [],
  };
}

/** What losing a crew costs: the licence to fly people, a heavy penalty and much of the company's standing. The company itself survives. */
export const LOSS_OF_CREW = { penalty: 50_000, reputation: -10 };

function lossOfCrew(company: Company, contract: Contract): string[] {
  company.licence = "orbital";
  company.cash -= LOSS_OF_CREW.penalty;
  company.ledger.push({ day: company.day, category: "penalty", amount: -LOSS_OF_CREW.penalty, note: `${contract.title}: loss of crew` });
  company.record.push({ day: company.day, tag: "crew-lost", reputation: LOSS_OF_CREW.reputation, note: contract.title });
  return [
    `The regulator revokes the crewed-flight licence. Compensation and the investigation cost ${money(LOSS_OF_CREW.penalty)}, and the record shows it: reputation ${LOSS_OF_CREW.reputation}. The company goes on, but it will have to earn the right to fly people again.`,
  ];
}

/** After a series launch is settled: if every launch is now delivered, the customer pays the bonus. */
export function seriesCompletion(company: Company, contract: Contract): string[] {
  if (!contract.seriesId) return [];
  const all = seriesOf(company, contract.seriesId);
  if (!all.every((c) => company.closed[c.id] === "delivered")) return [];
  const bonus = seriesBonus(company, contract.seriesId);
  company.cash += bonus;
  company.ledger.push({ day: company.day, category: "payout", amount: bonus, note: `${contract.customer}: series bonus` });
  company.record.push({ day: company.day, tag: "delivered", reputation: 1, note: `${contract.customer}: every launch of the series delivered` });
  return [`Every launch of the series delivered. ${contract.customer} pays a ${money(bonus)} bonus, and the record shows it: reputation +1.`];
}

export function fire(company: Company, engine: Engine, seconds: number, facility: Facility, restart = false): ActionResult {
  return runTask(company, { kind: "fire", engine: engine.name, seconds, facility, restart });
}

export function tunnel(company: Company, key: string, facility: AeroFacility): ActionResult {
  return runTask(company, { kind: "tunnel", design: key, facility });
}

export function fixEngine(company: Company, engine: Engine, mode: FailureMode): ActionResult {
  return runTask(company, { kind: "fix-engine", engine: engine.name, mode });
}

export function fixAero(company: Company, key: string, mode: FailureMode): ActionResult {
  return runTask(company, { kind: "fix-aero", design: key, mode });
}

/** Work out a re-tune now, from what is known; it takes effect when the office finishes it. */
export function retuneSpec(company: Company, key: string, target: { contract: string } | { mission: Mission }): TaskSpec {
  const design = designOf(company, key);
  const contract = "contract" in target ? contractOf(company, target.contract) : null;
  // A crew flight carries the abort tower too: tune for what really flies.
  const loaded = contract?.kind === "crew" ? withCapsule(design) : contract ? { ...design, payloadMass: contract.payloadMass } : design;
  const mission = contract?.mission ?? (target as { mission: Mission }).mission;
  const { vehicle, text } = retuneFromTests(company.campaign, loaded, mission);
  return { kind: "retune", design: key, pitchProgram: vehicle.pitchProgram, text };
}

/** Re-tune a design's pitch programme for a mission with the design's own payload: a test flight. */
export function retuneForMission(company: Company, key: string, mission: Mission): ActionResult {
  alive(company);
  return runTask(company, retuneSpec(company, key, { mission }));
}

/**
 * Draw up a new design. The drawing office always costs something; new tank
 * or fairing diameters need tooling the first time. A new outer shape is a
 * new aerodynamic unknown for the tunnel.
 */
export function designVehicle(company: Company, spec: VehicleSpec): ActionResult & { key: string } {
  alive(company);
  const result = runTask(company, designSpec(company, spec));
  return { ...result, key: result.done.find((d) => d.key)?.key ?? "" };
}

/** Re-tune a design's pitch programme for a contract's mission and payload. */
export function retune(company: Company, key: string, contractId: string): ActionResult {
  alive(company);
  return runTask(company, retuneSpec(company, key, { contract: contractId }));
}

/**
 * The factory learns: each time the number of a design built doubles, the
 * line builds the next one in this share of the time, down to the floor.
 */
export const LEARNING = { rate: 0.85, floor: 0.55 };

/** Share of the first build's time the next one takes, after `builtBefore` of the design. */
export function learningFactor(builtBefore: number): number {
  return Math.max(LEARNING.floor, Math.pow(builtBefore + 1, Math.log2(LEARNING.rate)));
}

/** Days the line takes for the next vehicle of a design, with what building the earlier ones taught. */
export function buildDays(company: Company, key: string, vehicle: Vehicle = designOf(company, key)): number {
  return Math.max(1, Math.round(vehicleCost(vehicle).days * learningFactor(company.built[key] ?? 0)));
}

/** What the next order on the first free line would look like. */
export function nextSlot(company: Company, key: string, days = buildDays(company, key)): { line: number; startDay: number; readyDay: number } {
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
export function build(company: Company, key: string, options: { booster?: string } = {}): ActionResult {
  alive(company);
  const design = designOf(company, key);
  if (options.booster) return restack(company, key, options.booster);
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

export const boosterOf = (company: Company, serial: string): BoosterUnit => {
  const unit = company.boosters?.find((b) => b.serial === serial);
  if (!unit) throw new Error(`No booster ${serial}.`);
  return unit;
};

/** Boosters back from the hangar and waiting for an upper stage, for a design. */
export const readyBoosters = (company: Company, key: string): BoosterUnit[] => (company.boosters ?? []).filter((b) => b.design === key && b.status === "ready");

/** Build a new upper stage onto a booster that has flown and been through the hangar. */
function restack(company: Company, key: string, serial: string): ActionResult {
  const design = designOf(company, key);
  const unit = boosterOf(company, serial);
  if (unit.design !== key) throw new Error(`${serial} was built for another design.`);
  if (unit.status !== "ready") throw new Error(`${serial} isn't ready to fly: ${unit.status === "flown" ? "it needs the hangar first" : `it's ${unit.status}`}.`);
  const { cost, days } = restackCost(design);
  const slot = nextSlot(company, key, days);
  company.orders.push({ design: key, ...slot, booster: serial });
  company.lines[slot.line] = slot.readyDay;
  unit.status = "stacked";
  const notices = charge(company, "build", cost, 0, `${design.name} on ${serial}`);
  return { text: `Stacking a new ${design.name} upper stage on ${serial} (flight ${unit.flights + 1} for it): ${money(cost)}. Ready on day ${slot.readyDay}.`, notices };
}

/** Take a booster out of service for good. */
export function retireBooster(company: Company, serial: string): ActionResult {
  alive(company);
  const unit = boosterOf(company, serial);
  if (unit.status !== "flown" && unit.status !== "ready") throw new Error(`${serial} can't be retired while it's ${unit.status}.`);
  if (company.tasks.some((t) => t.spec.kind === "refurb" && t.spec.serial === serial)) throw new Error(`${serial} is booked into the hangar.`);
  unit.status = "retired";
  return { text: `${serial} retired after ${unit.flights} flight${unit.flights === 1 ? "" : "s"}.`, notices: [] };
}

/** Reflights that went cleanly: what cautious customers want to see before they fly on a booster that has flown. */
export function cleanReflights(company: Company): number {
  return company.flights.filter((f) => f.booster && f.booster.flight > 1 && (f.outcome === "orbit" || f.outcome === "escape") && f.settlement !== "failed").length;
}

/** Crew and series customers won't fly on a booster that has flown until the company has shown it works. */
export function refusesFlightProven(company: Company, contract: Contract): boolean {
  return (contract.kind === "crew" || contract.seriesId !== undefined) && cleanReflights(company) < FLIGHT_PROVEN_TRUST;
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
export function fly(company: Company, key: string, target: { contract: string } | { mission: Mission; abortTest?: boolean }): FlightReport {
  alive(company);
  const design = designOf(company, key);
  const ready = readyDay(company, key);
  if (ready === null) throw new Error(`No ${design.name} built. Build one first.`);
  const contract = "contract" in target ? contractOf(company, target.contract) : null;
  if (contract && !company.accepted.includes(contract.id)) throw new Error(`"${contract.title}" isn't signed.`);
  const mission = contract?.mission ?? (target as { mission: Mission }).mission;
  const abortTest = "abortTest" in target && target.abortTest === true;
  const crewed = contract?.kind === "crew";
  const needs = contract ? requiredLicence(contract) : missionLicence(mission);
  if (!holds(company, needs)) throw new Error(needs === "crew" ? "Flying people needs the crewed-flight licence." : `Flying to orbit needs an orbital licence. Apply on the company page.`);
  if ((abortTest || crewed || contract?.kind === "cargo") && !company.capsule) throw new Error("That flight needs the company's capsule: develop one first.");
  if (crewed) {
    const rating = crewRating(company, key, mission);
    if (!rating.rated) throw new Error(`The ${design.name} isn't crew-rated. Still needed: ${rating.missing.join(" ")}`);
  }
  const early: string[] = [];
  if (ready > company.day) {
    // Launch on rollout: the calendar runs, and the payroll with it, until the vehicle is ready.
    early.push(...charge(company, "overhead", 0, ready - company.day, `waiting for the ${design.name} to roll out`));
    alive(company);
    if (contract && !company.accepted.includes(contract.id)) {
      throw new Error(`The ${design.name} rolled out on day ${ready}, after "${contract.title}" was due.`);
    }
  }
  // The capsule rides under its abort tower when people could be aboard, or to prove the tower.
  const vehicle = crewed || abortTest ? withCapsule(design) : { ...design, payloadMass: contract?.payloadMass ?? design.payloadMass };

  // A recoverable booster flies under a serial: one that has flown if one is stacked, unless the customer won't have it.
  const reusable = !!design.geometry?.recovery && design.stages.length > 1;
  let unit: BoosterUnit | null = null;
  if (reusable) {
    const proven = ((company.stacked ??= {})[key] ??= []);
    const fresh = (company.inventory[key] ?? 0) - proven.length;
    const cautious = contract !== null && refusesFlightProven(company, contract);
    if (proven.length > 0 && !(cautious && fresh > 0)) {
      if (cautious) throw new Error(`${contract!.customer} won't fly on a booster that has flown until the company has ${FLIGHT_PROVEN_TRUST} clean reflights (it has ${cleanReflights(company)}). Build a new ${design.name}.`);
      unit = boosterOf(company, proven.shift()!);
    } else {
      const fleet = (company.boosters ??= []);
      unit = { serial: nextSerial(fleet), design: key, flights: 0, status: "stacked", lastFlight: company.day };
      fleet.push(unit);
      (company.campaign.boosterTruth ??= {})[unit.serial] = rollBoosterTruth(unit.serial, company.seed);
    }
  }
  const boosterTruth = unit ? company.campaign.boosterTruth?.[unit.serial] : undefined;
  const worn = unit && boosterTruth && unit.flights > 0 ? wearFailure(boosterTruth, unit.serial, unit.flights + 1, company.seed, burnTime(design.stages[0]!) * (1 - design.geometry!.recovery!.reserve)) : null;

  const notices = [...early, ...charge(company, "launch", COSTS.launchFee, COSTS.padDays, `${design.name} launch`)];
  company.inventory[key]! -= 1;
  // The day's wind, and the attitude loop as built and as testing has corrected it.
  const gncTruth = vehicle.control ? company.campaign.gncTruth?.[vehicle.name] : undefined;
  let result = simulateAscent(vehicle, mission, {
    hardware: company.campaign.truth,
    aero: company.campaign.aeroTruth,
    structure: company.campaign.structureTruth,
    ...(vehicle.control
      ? {
          wind: rollWind(flightWindSeed(company.seed, company.flights.length)),
          gnc: { [vehicle.name]: gncTruth ? flownGnc(vehicle.control, gncTruth, company.campaign.gncKnowledge?.[vehicle.name]) : believedGnc(vehicle.control, undefined) },
        }
      : {}),
    ...(reusable ? { landingSeed: hashSeed(`${company.seed}:landing:${company.flights.length}`) } : {}),
    ...(worn ? { boosterFailure: worn } : {}),
  });
  // The abort: on purpose at max-q in a test, or because the rocket is failing under a crew.
  let abortText: string | null = null;
  let crewLost = false;
  if (abortTest) {
    const failure = result.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure" || e.kind === "loss-of-control");
    // At max-q, or earlier if the booster fails first: then the abort fires on a real failure.
    const at = failure && failure.t <= result.summary.maxQ.t + 1 ? failure.t : result.summary.maxQ.t;
    const q = qAt(result, at);
    result = abortAt(result, at, q);
    abortText = inflightAbort(company.capsule!, company.day, q);
  } else if (crewed) {
    const failure = result.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure" || e.kind === "loss-of-control");
    if (failure) {
      const q = qAt(result, failure.t);
      const outcome = abortOutcome(company.capsule!.truth, failure.t, q);
      result = { ...result, events: [...result.events.filter((e) => e.t <= failure.t), { ...failure, kind: "abort", value: q }, ...result.events.filter((e) => e.t > failure.t)] };
      crewLost = !outcome.survived;
      abortText = outcome.survived ? `The abort worked: ${outcome.why}. Both crew are safe.` : `The crew were lost: ${outcome.why}.`;
    }
  }
  const written = debrief(result, vehicle, mission, company.campaign);
  const lines = abortText ? [written, "", abortText] : [written];
  let landed = false;
  if (unit) {
    unit.flights += 1;
    unit.lastFlight = company.day;
    const home = result.recovery;
    landed = home?.outcome === "landed";
    unit.status = landed ? "flown" : "lost";
    if (landed && boosterTruth) boosterTruth.wear += flightWear(home!);
    lines.push("", boosterLine(unit, home, worn !== null));
  }
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
    const completed = seriesCompletion(company, contract);
    if (completed.length > 0) lines.push("", ...completed);
    if (crewLost) lines.push("", ...lossOfCrew(company, contract));
  } else {
    const failure = result.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure" || e.kind === "loss-of-control");
    // A test flight risks only the company's own vehicle: the record keeps it, reputation doesn't move.
    if (failure?.mode) company.record.push({ day: company.day, tag: failure.mode, reputation: 0, note: `${design.name} test flight`, test: true });
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
    ...(unit ? { booster: { serial: unit.serial, flight: unit.flights, landed } } : {}),
  });
  notices.push(...tick(company));
  return { text: lines.join("\n"), notices, result, debrief: written, settlement };
}

/** What became of the booster, for the flight report. */
function boosterLine(unit: BoosterUnit, home: FlightResult["recovery"], worn: boolean): string {
  const which = `Booster ${unit.serial}${unit.flights > 1 ? `, flight ${unit.flights}` : ""}`;
  const wear = worn ? " Its engines failed on the way up: wear, on a booster flown past its life." : "";
  if (!home) return `${which} went down with the vehicle.${wear}`;
  const where = home.mode === "rtls" ? "back at the launch site" : "on the drone ship";
  if (home.outcome === "landed") {
    const hot = home.peakHeating > ENTRY_HEATING ? " A hot entry: the base took some heat." : "";
    return `${which} landed ${where}, ${Math.round(home.touchdown!.miss)} m off centre, with ${Math.round(home.propellantLeft)} kg to spare.${hot}${wear}`;
  }
  return `${which} was lost: ${RECOVERY_CAUSE_LABELS[home.cause!]}.${wear}`;
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
  const vehicle = contract.kind === "crew" ? withCapsule(design) : { ...design, payloadMass: contract.payloadMass };
  const mission = contract.mission;
  const build = { cost: vehicleCost(vehicle).cost, days: buildDays(company, key, vehicle) };

  const blockers: string[] = [];
  if (company.accepted.includes(contract.id)) blockers.push("Already signed.");
  else if (company.closed[contract.id]) blockers.push("Closed.");
  if (company.day > contract.deadline) blockers.push("The deadline has passed.");
  if (reputation(company) < contract.minReputation) {
    blockers.push(`${contract.customer} wants a reputation of ${contract.minReputation}; the company has ${reputation(company)}.`);
  }
  const needs = requiredLicence(contract);
  if (!holds(company, needs)) blockers.push(`Needs the ${LICENCE_LABELS[needs].toLowerCase()} licence; the company holds ${LICENCE_LABELS[company.licence].toLowerCase()}.`);
  const objection = objectionTo(company, contract);
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
    // Shells the proof stand has measured fly as measured; the rest as drawn.
    structure: Object.fromEntries(Object.entries(company.campaign.structureKnowledge ?? {}).map(([k, v]) => [k, v.knockdown])),
    ...(vehicle.control ? { gnc: { [vehicle.name]: believedGnc(vehicle.control, company.campaign.gncKnowledge?.[vehicle.name]) } } : {}),
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
    unknowns: flightUnknowns(vehicle, company.campaign, mission),
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
  const failure = forecast.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure" || e.kind === "loss-of-control");
  if (failure?.mode) return `lost to a known ${FAILURE_LABELS[failure.mode]} at T+${failure.t.toFixed(1)} s.`;
  if (contract.minApogee !== undefined) {
    const apogee = forecast.summary.apogee;
    return `apogee ${(apogee / 1000).toFixed(0)} km against ${(contract.minApogee / 1000).toFixed(0)} km needed.`;
  }
  const orbit = forecast.summary.orbit;
  const ins = forecast.summary.insertion;
  if (forecast.outcome === "escape" && ins) {
    return `escapes with C3 ${((2 * (orbit?.energy ?? 0)) / 1e6).toFixed(1)} km²/s², ${ins.inSpec ? "in spec" : "out of spec"}, ${Math.round(forecast.summary.propellantMargin)} kg margin.`;
  }
  if (forecast.outcome !== "orbit" || !orbit || !ins) {
    return forecast.events.some((e) => e.kind === "coast") ? "reaches the parking orbit but not the target with this payload." : "no orbit with this payload.";
  }
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
    case "crew-lost":
      return "a crew lost";
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
