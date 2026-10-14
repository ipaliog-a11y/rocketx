import { build, buyLine, LINE_COSTS, licenceSpec, nextSlot, readyDay, REFINE, retuneSpec, fly, wait, type ActionResult, type Company, type FlightReport } from "../sim/company.ts";
import { buyUnit, cancelTask, designSpec, runTask, TRACKS, type Task, type TaskSpec, type Track } from "../sim/schedule.ts";
import { ABORT_FIXES, ABORT_FLAW_LABELS, CAPSULE, PAD_ABORT, type AbortFlaw } from "../sim/crew.ts";
import type { Contract } from "../sim/contracts.ts";
import { COSTS, vehicleCost } from "../sim/cost.ts";
import { flowSeparates, type Engine } from "../sim/engine.ts";
import { FAILURE_LABELS, type FailureMode } from "../sim/hardware.ts";
import { LICENCE_LABELS, type Application } from "../sim/licence.ts";
import { partLabel, type EngineParts } from "../sim/parts.ts";
import type { DesignQuote, VehicleSpec } from "../sim/builder.ts";
import type { Mission } from "../sim/mission.ts";
import { FACILITIES, FIXES, firingCost, fixQuote, hardwareLoss, RESTART_TEST, type Facility } from "../sim/teststand.ts";
import { AERO_FACILITIES, BUFFET_FIX, type AeroFacility } from "../sim/tunnel.ts";
import { RETUNE_COST } from "../sim/tuning.ts";
import { defaultDesign } from "./designs.ts";
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
  /** What else it could cost if it goes wrong: a lost engine, a failed flight's penalty. */
  exposure?: Array<{ cost: number; text: string }>;
  /** Money that comes back instead of going out: calling off a queued job. */
  refund?: number;
  /** The design this job orders: once ordered, the company has a rocket coming. */
  orders?: string;
  run: (company: Company) => T;
  onDone?: (result: T) => void;
  /** Work on a track: it can go on the plan instead of running now. Making it may be slow (a re-tune works the trajectory out). */
  task?: (company: Company) => TaskSpec;
  /** A quick stand-in for `task` to quote from, when making the real one is slow. */
  quote?: (company: Company) => TaskSpec;
  /** Run now, this job plays back when it finishes: a firing on the stand. */
  moment?: { kind: "firing"; engine: string };
};

/**
 * A job on a track. Run now, it books the job and lets the calendar run to
 * its end; planned, it is only booked. Its days and cost come from the
 * quote when it is asked for.
 */
function trackJob(base: Omit<Job, "run" | "task">, task: (company: Company) => TaskSpec, quote?: (company: Company) => TaskSpec): Job<ActionResult & { key?: string }> {
  return {
    ...base,
    task,
    quote,
    run: (c) => {
      const r = runTask(c, task(c), false);
      return { ...r, key: r.done.find((d) => d.key)?.key };
    },
  };
}

export type Risk = { contract: Contract; text: string };

/** A design with a vehicle on the ground or on the line: what the player most likely means to fly. */
export function readyDesign(company: Company): string | undefined {
  return Object.keys(company.designs).find((k) => readyDay(company, k) !== null);
}

/** The design a signed contract will fly on, unless the player picks another: one that's built, else the usual one for the job. */
export function designFor(company: Company, contract: Contract): string {
  return readyDesign(company) ?? defaultDesign(contract);
}

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

/** Order a vehicle: paid now, built on a production line while the company keeps working. */
export function buildJob(company: Company, key: string): Job {
  const v = company.designs[key]!;
  const { cost } = vehicleCost(v);
  const slot = nextSlot(company, key);
  const days = slot.readyDay - slot.startDay;
  const built = company.built[key] ?? 0;
  const learned = built > 0 ? ` The line has built ${built} before: ${Math.round((1 - days / vehicleCost(v).days) * 100)}% faster than the first.` : "";
  const queued = slot.startDay > company.day ? ` Line ${slot.line + 1} is busy until day ${slot.startDay}, so it starts then.` : "";
  return {
    title: `Order a ${v.name}?`,
    doing: `Ordering a ${v.name}`,
    verb: "Order",
    days: 0,
    cost,
    alwaysAsk: true,
    orders: key,
    caveat: `Built on line ${slot.line + 1} in ${days} days: ready on day ${slot.readyDay}.${queued}${learned} The company keeps working meanwhile.`,
    run: (c) => build(c, key),
  };
}

export function lineJob(company: Company): Job | null {
  const next = LINE_COSTS[company.lines.length - 1];
  if (!next) return null;
  return {
    title: `Buy production line ${company.lines.length + 1}?`,
    doing: "Buying a production line",
    verb: "Buy",
    days: 0,
    cost: next.cost,
    alwaysAsk: true,
    caveat: `It takes orders from day ${company.day + next.days}, after ${next.days} days of setting up.`,
    run: (c) => buyLine(c),
  };
}

export function designJob(spec: VehicleSpec, quote: DesignQuote, onDone?: (key: string) => void): Job {
  return trackJob({
    title: `Draw up the ${spec.name.trim()}?`,
    doing: `Drawing up the ${spec.name.trim()}`,
    verb: "Draw it up",
    days: quote.days,
    cost: quote.cost,
    alwaysAsk: true,
    caveat:
      quote.newTanks.length > 0 || quote.newFairing
        ? `Includes tooling for ${[...quote.newTanks.map((d) => `${d} m tanks`), ...(quote.newFairing ? [`a ${spec.fairingDiameter} m fairing`] : [])].join(" and ")}.`
        : "The shop already has the tooling.",
    onDone: onDone ? (r) => (r as ActionResult & { key?: string }).key && onDone((r as ActionResult & { key: string }).key) : undefined,
  }, (c) => designSpec(c, spec));
}

export function retuneTestJob(company: Company, key: string, mission: Mission): Job {
  const v = company.designs[key]!;
  return trackJob({
    title: `Re-tune the ${v.name} for a test flight to ${mission.name}?`,
    doing: `Re-tuning the ${v.name}'s pitch programme`,
    verb: "Re-tune",
    days: RETUNE_COST.days,
    cost: RETUNE_COST.cost,
  }, (c) => retuneSpec(c, key, { mission }), () => ({ kind: "retune", design: key, pitchProgram: v.pitchProgram, text: "" }));
}

/** Days until a design's next vehicle is on the pad: 0 if one is built. */
const waitForRollout = (company: Company, key: string) => Math.max(0, (readyDay(company, key) ?? company.day) - company.day);

export function fireJob(engine: Engine, seconds: number, facility: Facility, expectedRun: number, restart = false): Job {
  const f = FACILITIES[facility];
  const startCheck = flowSeparates(engine, f.ambient);
  return trackJob({
    title: startCheck
      ? `Start-check the ${engine.name} on the ${f.name}?`
      : restart
        ? `Fire the ${engine.name} for ${seconds} s, then restart it in vacuum?`
        : `Fire the ${engine.name} for ${seconds} s?`,
    doing: `${startCheck ? "Start check" : restart ? "Restart test" : "Hot-firing"} the ${engine.name} · ${f.name}`,
    verb: "Fire",
    days: f.days + (restart ? RESTART_TEST.days : 0),
    cost: firingCost(engine, facility, expectedRun, restart),
    moment: { kind: "firing", engine: engine.name },
    exposure: [{ cost: hardwareLoss(engine).cost, text: `If the engine fails, a new one costs ${money(hardwareLoss(engine).cost)}.` }],
    caveat: `If the engine fails, a new one costs ${money(hardwareLoss(engine).cost)} and ties up the ${f.name} ${hardwareLoss(engine).days} more days while it is built. A firing cut short refunds the seconds it didn't run.`,
  }, () => ({ kind: "fire", engine: engine.name, seconds, facility, restart }));
}

export function tunnelJob(key: string, shape: string, facility: AeroFacility): Job {
  const f = AERO_FACILITIES[facility];
  return trackJob({
    title: `Book the ${f.name} for the ${shape}?`,
    doing: `${capital(f.name)} · ${shape}`,
    verb: "Book",
    days: f.days,
    cost: f.cost,
  }, () => ({ kind: "tunnel", design: key, facility }));
}

export function fixEngineJob(engine: Engine, mode: FailureMode): Job {
  const fix = FIXES[mode]!;
  const quote = fixQuote(mode, engine);
  return trackJob({
    title: `Fix the ${engine.name}'s ${FAILURE_LABELS[mode]}?`,
    doing: `${capital(fix.name)} · ${engine.name}`,
    verb: "Apply fix",
    days: quote.days,
    cost: quote.cost,
  }, () => ({ kind: "fix-engine", engine: engine.name, mode }));
}

export function fixAeroJob(key: string, shape: string): Job {
  return trackJob({
    title: `Fit ${BUFFET_FIX.name} to the ${shape}?`,
    doing: `Fitting vortex generators · ${shape}`,
    verb: "Fit them",
    days: BUFFET_FIX.days,
    cost: BUFFET_FIX.cost,
  }, () => ({ kind: "fix-aero", design: key, mode: "transonic-buffet" }));
}

export function retuneJob(company: Company, key: string, contract: Contract): Job {
  const v = company.designs[key]!;
  return trackJob({
    title: `Re-tune the ${v.name} for ${contract.payloadMass} kg?`,
    doing: `Re-tuning the ${v.name}'s pitch programme`,
    verb: "Re-tune",
    days: RETUNE_COST.days,
    cost: RETUNE_COST.cost,
    forContract: contract.id,
  }, (c) => retuneSpec(c, key, { contract: contract.id }), () => ({ kind: "retune", design: key, pitchProgram: v.pitchProgram, text: "" }));
}

export function launchJob(company: Company, key: string, contract: Contract, onDone: (r: FlightReport) => void): Job<FlightReport> {
  const v = company.designs[key]!;
  return {
    title: `Launch the ${v.name} for ${contract.customer}?`,
    doing: waitForRollout(company, key) > 0 ? `Waiting for the ${v.name} to roll out, then the pad` : `${v.name} on the pad`,
    verb: "Launch",
    days: waitForRollout(company, key) + COSTS.padDays,
    cost: COSTS.launchFee,
    forContract: contract.id,
    exposure: contract.penalty > 0 ? [{ cost: contract.penalty, text: `If the flight fails, ${contract.customer} charges a ${money(contract.penalty)} penalty.` }] : undefined,
    run: (c) => fly(c, key, { contract: contract.id }),
    onDone,
  };
}

export function testFlightJob(company: Company, key: string, mission: Mission, onDone: (r: FlightReport) => void): Job<FlightReport> {
  const v = company.designs[key]!;
  return {
    title: `Fly the ${v.name} as a test flight?`,
    doing: waitForRollout(company, key) > 0 ? `Waiting for the ${v.name} to roll out, then the pad` : `${v.name} on the pad`,
    verb: "Launch",
    days: waitForRollout(company, key) + COSTS.padDays,
    cost: COSTS.launchFee,
    run: (c) => fly(c, key, { mission }),
    onDone,
  };
}

export function waitJob(days: number, why: string, title = `Wait ${days} days?`, verb = "Wait", alwaysAsk = false): Job {
  return { title, doing: why, verb, days, cost: 0, alwaysAsk, run: (c) => wait(c, days) };
}

/** Another unit for a track: another stand, cell or engineering team. */
export function unitJob(company: Company, track: Track): Job | null {
  const next = TRACKS[track].extra[company.units[track].length - 1];
  if (!next) return null;
  return {
    title: `Add ${next.name}?`,
    doing: `Adding ${next.name}`,
    verb: "Buy",
    days: 0,
    cost: next.cost,
    alwaysAsk: true,
    caveat: `It takes work from day ${company.day + next.days}, after ${next.days} days of setting up. Two units on a track run two jobs side by side.`,
    run: (c) => buyUnit(c, track),
  };
}

/** Call off a job that hasn't started: its money comes back and its place on the plan is lost. */
export function cancelJob(task: Task): Job {
  return {
    title: `Cancel “${task.title}”?`,
    doing: `Cancelling ${task.title}`,
    verb: "Cancel the job",
    days: 0,
    cost: 0,
    refund: task.cost,
    alwaysAsk: true,
    caveat: `It hasn't started, so all ${money(task.cost)} comes back. Booking it again later puts it at the back of the queue.`,
    run: (c) => cancelTask(c, task.id),
  };
}

export function licenceJob(application: Application): Job {
  const name = LICENCE_LABELS[application.tier].toLowerCase();
  return trackJob({
    title: `Apply for the ${name} licence?`,
    doing: `The regulator reviews your ${name} application`,
    verb: "Apply",
    days: application.days,
    cost: application.fee,
    alwaysAsk: true,
  }, (c) => licenceSpec(c));
}

export function developJob(parts: EngineParts, name: string, quote: { cost: number; days: number; newParts: string[] }): Job {
  return trackJob({
    title: `Develop the ${name}?`,
    doing: `Developing the ${name}${quote.newParts.length > 0 ? `: ${quote.newParts.length} new part${quote.newParts.length === 1 ? "" : "s"}` : ""}`,
    verb: "Develop",
    days: quote.days,
    cost: quote.cost,
    alwaysAsk: true,
    caveat:
      quote.newParts.length > 0
        ? `New parts bring new unknowns: ${quote.newParts.map(partLabel).join(", ")}. Nothing about them is proven until they fire.`
        : "Every part is already in production, with what tests have learned about it.",
  }, () => ({ kind: "develop", name, parts }));
}

export function refineJob(key: string): Job {
  return trackJob({
    title: `Refine the ${partLabel(key)}?`,
    doing: `Refining the ${partLabel(key)}`,
    verb: "Refine",
    days: REFINE.days,
    cost: REFINE.cost,
    caveat: "The gain only shows once Isp is measured again: the next firing or flight.",
  }, () => ({ kind: "refine", part: key }));
}

export function capsuleJob(): Job {
  return trackJob(
    {
      title: "Develop the crew capsule?",
      doing: "Developing the crew capsule and its abort system",
      verb: "Develop",
      days: CAPSULE.develop.days,
      cost: CAPSULE.develop.cost,
      alwaysAsk: true,
      caveat: "Whether its abort system would save a crew stays unknown until the pad and in-flight abort tests.",
    },
    () => ({ kind: "capsule" }),
  );
}

export function padAbortJob(): Job {
  return trackJob(
    {
      title: "Fly a pad abort test?",
      doing: "Pad abort test: the tower fires from the pad",
      verb: "Test",
      days: PAD_ABORT.days,
      cost: PAD_ABORT.cost,
      caveat: "It shows whether the tower fires and the parachutes open. It says nothing about an abort in thick air at speed.",
    },
    () => ({ kind: "pad-abort" }),
  );
}

export function fixAbortJob(flaw: AbortFlaw): Job {
  const fix = ABORT_FIXES[flaw];
  return trackJob(
    {
      title: `Fix the ${ABORT_FLAW_LABELS[flaw]}?`,
      doing: `${capital(fix.name)}`,
      verb: "Apply fix",
      days: fix.days,
      cost: fix.cost,
      caveat: `${fix.text} A new revision of the abort system: both abort tests have to be flown again.`,
    },
    () => ({ kind: "fix-abort", flaw }),
  );
}

/** Spend a built rocket on an in-flight abort: the capsule pulls away at max-q and the booster is lost. */
export function abortTestJob(company: Company, key: string, mission: Mission, onDone: (r: FlightReport) => void): Job<FlightReport> {
  const v = company.designs[key]!;
  return {
    title: `Spend a ${v.name} on an in-flight abort test?`,
    doing: waitForRollout(company, key) > 0 ? `Waiting for the ${v.name} to roll out, then the pad` : `${v.name} on the pad with the capsule`,
    verb: "Launch",
    days: waitForRollout(company, key) + COSTS.padDays,
    cost: COSTS.launchFee,
    alwaysAsk: true,
    caveat: "The abort fires at max-q and the booster is lost on purpose. Telemetry still learns what its engines did on the way up.",
    run: (c) => fly(c, key, { mission, abortTest: true }),
    onDone,
  };
}
