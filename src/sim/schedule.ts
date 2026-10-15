import { aeroShape, rollAeroTruth } from "./airframe.ts";
import { assembleVehicle, checkVehicle, designQuote, type VehicleSpec } from "./builder.ts";
import { COSTS } from "./cost.ts";
import type { Engine } from "./engine.ts";
import { combineTruth, FAILURE_LABELS, rollPartTruths, type FailureMode } from "./hardware.ts";
import { holds, LICENCE_LABELS, nextLicence, type Licence } from "./licence.ts";
import { ABORT_FIXES, ABORT_FLAW_LABELS, CAPSULE, fixAbortFlaw, newCapsule, PAD_ABORT, padAbort, type AbortFlaw } from "./crew.ts";
import { designEngine, sameDesign, type EngineDesign } from "./enginePhysics.ts";
import { assembleEngine, developmentCost, INJECTORS, NOZZLES, OWNER, parsePartKey, partKeys, partLabel, partsProblems, type EngineParts, type InjectorOption, type NozzleOption } from "./parts.ts";
import {
  applyFix,
  enginesUsing,
  FACILITIES,
  FIXES,
  hardwareLoss,
  firingCost,
  fixQuote,
  hotFire,
  partKnowledgeOf,
  refreshFromParts,
  RESTART_TEST,
  revisionLetter,
  START_CHECK,
  type Facility,
} from "./teststand.ts";
import { flowSeparates } from "./engine.ts";
import { RETUNE_COST } from "./tuning.ts";
import { AERO_FACILITIES, applyAeroFix, BUFFET_FIX, tunnelRun, type AeroFacility } from "./tunnel.ts";
import type { Vehicle } from "./vehicle.ts";
import { developedParts, REFINE, reputation, settleDays, type ActionResult, type Category, type Company } from "./company.ts";

/**
 * The company's work, on tracks that run side by side: the sea-level stand,
 * the altitude cell, the engineering office, the wind tunnel and the
 * regulator. Each unit does one job at a time. A job is paid for when it is
 * booked, starts when its track is free, and only shows what it found on
 * the day it finishes. Production lines and the pad work as before.
 *
 * Jobs that touch the same hardware keep the order they were booked in: a
 * firing waits for a fix to its parts booked before it, and a fix waits for
 * firings of those parts booked before it.
 */

export type Track = "stand" | "cell" | "office" | "tunnel" | "range" | "regulator";

export type TrackSpec = {
  name: string;
  /** What another unit of this track costs, $k, and how long it takes to set up, in the order they can be bought. */
  extra: Array<{ cost: number; days: number; name: string }>;
};

export const TRACKS: Record<Track, TrackSpec> = {
  stand: { name: "Sea-level stand", extra: [{ cost: 1_500, days: 30, name: "a second sea-level stand" }] },
  cell: { name: "Altitude cell", extra: [{ cost: 5_000, days: 60, name: "a second altitude cell" }] },
  office: {
    name: "Engineering office",
    extra: [
      { cost: 1_000, days: 20, name: "a second engineering team" },
      { cost: 2_000, days: 30, name: "a third engineering team" },
    ],
  },
  tunnel: { name: "Wind tunnel", extra: [] },
  range: { name: "Test range", extra: [] },
  regulator: { name: "Regulator", extra: [] },
};

export const TRACK_ORDER: Track[] = ["stand", "cell", "office", "tunnel", "range", "regulator"];

export type TaskSpec =
  | { kind: "fire"; engine: string; seconds: number; facility: Facility; restart: boolean }
  | { kind: "replace"; engine: string }
  | { kind: "fix-engine"; engine: string; mode: FailureMode }
  | { kind: "tunnel"; design: string; facility: AeroFacility }
  | { kind: "fix-aero"; design: string; mode: FailureMode }
  | { kind: "refine"; part: string }
  | { kind: "develop"; name: string; parts: EngineParts; design?: EngineDesign; family?: string; rev?: number }
  | { kind: "design"; vehicle: Vehicle; tooling: string[]; cost: number; days: number }
  | { kind: "retune"; design: string; pitchProgram: Vehicle["pitchProgram"]; text: string }
  | { kind: "licence"; tier: Licence }
  | { kind: "capsule" }
  | { kind: "pad-abort" }
  | { kind: "fix-abort"; flaw: AbortFlaw };

export type Task = {
  id: number;
  spec: TaskSpec;
  track: Track;
  title: string;
  /** $k paid when booked. */
  cost: number;
  days: number;
  bookedDay: number;
  /** Hardware this job learns from (reads) or changes (writes): keys like "part:…", "engine:…", "shape:…". */
  reads: string[];
  writes: string[];
  /** Set once it starts. */
  unit?: number;
  startDay?: number;
  endDay?: number;
  /** A job this one follows on from: a replacement engine after a firing destroyed one. */
  parent?: number;
};

/** A finished job, for the record and the notices. */
/** How a finished job went: good news, bad news, or just news. */
export type DoneTone = "good" | "bad" | "info";

/** A finished job, for the record and the notices. */
export type TaskDone = { id: number; track: Track; title: string; day: number; summary: string; text: string; key?: string; tone?: DoneTone };

/** Fields older saves lack. */
export function upgradeCompany(company: Company): void {
  company.tasks ??= [];
  company.done ??= [];
  company.nextTask ??= 1;
  company.units ??= newUnits();
  company.units.range ??= [0];
  // Test-flight failures used to cost reputation. They no longer do.
  for (const r of company.record) {
    if (r.note.endsWith(" test flight") && r.tag !== "demonstrated") {
      r.test = true;
      r.reputation = 0;
    }
  }
}

export const newUnits = (): Record<Track, number[]> => ({ stand: [0], cell: [0], office: [0], tunnel: [0], range: [0], regulator: [0] });

// ── What a job is ───────────────────────────────────────────────────────

const engineOf = (company: Company, name: string): Engine => {
  const engine = company.campaign.engines[name];
  if (!engine) throw new Error(`No engine called ${name}.`);
  return engine;
};

const designOf = (company: Company, key: string): Vehicle => {
  const design = company.designs[key];
  if (!design) throw new Error(`No design "${key}".`);
  return design;
};

const pending = (company: Company) => company.tasks;
const pendingOf = <K extends TaskSpec["kind"]>(company: Company, kind: K) =>
  pending(company).filter((t): t is Task & { spec: Extract<TaskSpec, { kind: K }> } => t.spec.kind === kind);

const partsOf = (engine: Engine): string[] => (engine.parts ? Object.values(partKeys(engine.parts)) : [`engine:${engine.name}`]);

/** The firing's planned length: a vacuum bell on the sea-level stand only gets a start check. */
export function plannedSeconds(engine: Engine, seconds: number, facility: Facility): number {
  return flowSeparates(engine, FACILITIES[facility].ambient) ? Math.min(seconds, START_CHECK) : seconds;
}

/** Where a job runs, what it costs, how long it takes, and what it touches. Throws if it can't be booked. */
export function describeTask(company: Company, spec: TaskSpec): Omit<Task, "id" | "bookedDay" | "spec"> {
  switch (spec.kind) {
    case "fire": {
      const engine = engineOf(company, spec.engine);
      if (spec.restart && spec.facility !== "altitude") throw new Error("A restart test needs vacuum: book the altitude cell.");
      const f = FACILITIES[spec.facility];
      const seconds = plannedSeconds(engine, spec.seconds, spec.facility);
      return {
        track: spec.facility === "altitude" ? "cell" : "stand",
        title: `${spec.restart ? "Restart test" : flowSeparates(engine, f.ambient) ? "Start check" : `${seconds} s firing`} · ${engine.name}`,
        cost: firingCost(engine, spec.facility, seconds, spec.restart),
        days: f.days + (spec.restart ? RESTART_TEST.days : 0),
        reads: partsOf(engine),
        writes: [`engine:${engine.name}`],
      };
    }
    case "replace":
      return { track: "stand", title: `New test engine · ${spec.engine}`, cost: 0, days: hardwareLoss(engineOf(company, spec.engine)).days, reads: [], writes: [`engine:${spec.engine}`] };
    case "fix-engine": {
      const engine = engineOf(company, spec.engine);
      const fix = fixFor(spec.mode);
      const known = company.campaign.knowledge[engine.name];
      if (!known?.open.includes(spec.mode)) throw new Error(`${engine.name} has no observed ${FAILURE_LABELS[spec.mode]} to fix. The stand has to see a problem before it can be fixed.`);
      const slot = OWNER[spec.mode];
      const key = engine.parts && slot ? partKeys(engine.parts)[slot] : `engine:${engine.name}`;
      if (pendingOf(company, "fix-engine").some((t) => t.writes.includes(key) && t.spec.mode === spec.mode)) throw new Error(`That fix is already booked.`);
      return { track: "office", title: `Fix: ${fix.name} · ${engine.name}`, ...fixQuote(spec.mode, engine), reads: [], writes: [key] };
    }
    case "tunnel": {
      const vehicle = designOf(company, spec.design);
      const f = AERO_FACILITIES[spec.facility];
      const shape = aeroShape(vehicle);
      return { track: "tunnel", title: `${f.name.charAt(0).toUpperCase() + f.name.slice(1)} · ${shape.label}`, cost: f.cost, days: f.days, reads: [`shape:${shape.key}`], writes: [] };
    }
    case "fix-aero": {
      const vehicle = designOf(company, spec.design);
      const shape = aeroShape(vehicle);
      if (!company.campaign.aeroKnowledge[shape.key]?.open.includes(spec.mode)) throw new Error(`No buffet has been seen on the ${shape.label}. The tunnel has to see a problem before it can be fixed.`);
      if (pendingOf(company, "fix-aero").some((t) => t.writes.includes(`shape:${shape.key}`))) throw new Error("That fix is already booked.");
      return { track: "office", title: `Fix: vortex generators · ${shape.label}`, cost: BUFFET_FIX.cost, days: BUFFET_FIX.days, reads: [], writes: [`shape:${shape.key}`] };
    }
    case "refine": {
      const { slot } = parsePartKey(spec.part);
      if (slot !== "injector" && slot !== "nozzle") throw new Error("Only injectors and nozzles can be refined: they set how much of the design Isp the engine delivers.");
      const users = enginesUsing(company.campaign, spec.part);
      if (users.length === 0) throw new Error(`No engine uses ${partLabel(spec.part)}.`);
      const part = partKnowledgeOf(company.campaign, spec.part);
      const booked = pendingOf(company, "refine").filter((t) => t.spec.part === spec.part).length;
      if (part.refinements + booked >= REFINE.max) throw new Error(`${partLabel(spec.part)} has been refined as far as it goes.`);
      if (!users.some((e) => company.campaign.knowledge[e.name]?.measuredIspFactor != null)) {
        throw new Error(`Measure Isp on an engine with ${partLabel(spec.part)} first: refining needs to know how far off it is.`);
      }
      return { track: "office", title: `Refine · ${partLabel(spec.part)}`, cost: REFINE.cost, days: REFINE.days, reads: [], writes: [spec.part] };
    }
    case "develop": {
      const name = spec.name.trim();
      if (name.length === 0) throw new Error("The engine needs a name.");
      if (company.campaign.engines[name] || pendingOf(company, "develop").some((t) => t.spec.name === name)) throw new Error(`There is already an engine called ${name}.`);
      const twin = twinOf(company, spec.parts, spec.design);
      if (twin) throw new Error(`The ${twin} is already this engine: the same parts at the same size. Use it, or change a part.`);
      const problems = partsProblems(spec.parts);
      if (problems.length > 0) throw new Error(problems.join(" "));
      const { cost, days } = developmentCost(spec.parts, developedParts(company));
      return { track: "office", title: `Develop the ${name}`, cost, days, reads: [], writes: [] };
    }
    case "design":
      return { track: "office", title: `Draw up the ${spec.vehicle.name}`, cost: spec.cost, days: spec.days, reads: [], writes: [] };
    case "retune": {
      const design = designOf(company, spec.design);
      return { track: "office", title: `Re-tune · ${design.name}`, cost: RETUNE_COST.cost, days: RETUNE_COST.days, reads: [], writes: [] };
    }
    case "licence": {
      if (pendingOf(company, "licence").length > 0) throw new Error("A licence application is already with the regulator.");
      const next = nextLicence(company, reputation(company));
      if (!next) throw new Error("The company already holds every licence there is.");
      const missing = next.requirements.filter((r) => !r.met);
      if (missing.length > 0) throw new Error(`The regulator wants: ${missing.map((r) => r.text.toLowerCase()).join("; ")}.`);
      return { track: "regulator", title: `${LICENCE_LABELS[next.tier]} licence review`, cost: next.fee, days: next.days, reads: [], writes: ["licence"] };
    }
    case "capsule": {
      if (company.capsule || pendingOf(company, "capsule").length > 0) throw new Error("The company already has a capsule programme.");
      if (!holds(company, "orbital")) throw new Error("A capsule programme needs the orbital licence first: the regulator won't look at people before orbit.");
      return { track: "office", title: "Develop the crew capsule", cost: CAPSULE.develop.cost, days: CAPSULE.develop.days, reads: [], writes: ["capsule"] };
    }
    case "pad-abort": {
      if (!company.capsule) throw new Error("There is no capsule to test yet.");
      return { track: "range", title: "Pad abort test", cost: PAD_ABORT.cost, days: PAD_ABORT.days, reads: ["capsule"], writes: [] };
    }
    case "fix-abort": {
      if (!company.capsule?.known.open.includes(spec.flaw)) throw new Error(`No ${ABORT_FLAW_LABELS[spec.flaw]} has been seen. A test has to show a problem before it can be fixed.`);
      if (pendingOf(company, "fix-abort").some((t) => t.spec.flaw === spec.flaw)) throw new Error("That fix is already booked.");
      const fix = ABORT_FIXES[spec.flaw];
      return { track: "office", title: `Fix: ${fix.name}`, cost: fix.cost, days: fix.days, reads: [], writes: ["capsule"] };
    }
  }
}

function fixFor(mode: FailureMode) {
  const fix = FIXES[mode];
  if (!fix) throw new Error(`${FAILURE_LABELS[mode]} has no fix on the stand. It comes from the nozzle shape: change the bell.`);
  return fix;
}

const SLOT_CHOICES = ["size", "cycle", "injector", "cooling", "nozzle"] as const;

/** An engine the company has, or is developing, built from exactly these parts to the same design point: developing it again would teach nothing. */
export function twinOf(company: Company, parts: EngineParts, design?: EngineDesign): string | null {
  const same = (p?: EngineParts, d?: EngineDesign) => p !== undefined && SLOT_CHOICES.every((k) => p[k] === parts[k]) && sameDesign(d, design);
  const have = Object.values(company.campaign.engines).find((e) => same(e.parts, e.design));
  if (have) return have.name;
  return pendingOf(company, "develop").find((t) => same(t.spec.parts, t.spec.design))?.spec.name ?? null;
}

/** Designs on the drawing board: booked, not yet drawn up. */
export function pendingDesigns(company: Company): Vehicle[] {
  return pendingOf(company, "design").map((t) => t.spec.vehicle);
}

/** Engines being developed: booked, not yet done. */
export function pendingEngines(company: Company): string[] {
  return pendingOf(company, "develop").map((t) => t.spec.name);
}

/** Check a new design and assemble it, for booking. */
export function designSpec(company: Company, spec: VehicleSpec): TaskSpec {
  const engines = company.campaign.engines;
  const names = [...Object.values(company.designs), ...pendingDesigns(company)].map((d) => d.name);
  const { problems } = checkVehicle(spec, engines, names);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const vehicle = assembleVehicle({ ...spec, name: spec.name.trim() }, engines);
  const quote = designQuote(spec, [...Object.values(company.designs), ...pendingDesigns(company)]);
  const tooling = [...quote.newTanks.map((d) => `${d} m tank tooling`), ...(quote.newFairing ? [`${spec.fairingDiameter} m fairing tooling`] : [])];
  return { kind: "design", vehicle, tooling, cost: quote.cost, days: quote.days };
}

// ── Booking ─────────────────────────────────────────────────────────────

/** Book a job: paid now, started when its track is free. */
export function book(company: Company, spec: TaskSpec): { task: Task; notices: string[] } {
  if (company.dead) throw new Error("The company is gone. Its cash ran out.");
  const d = describeTask(company, spec);
  const task: Task = { id: company.nextTask++, spec, bookedDay: company.day, ...d };
  company.tasks.push(task);
  pay(company, categoryOf(spec), task.cost, task.title);
  // Start it if its track is free, and settle the books: spending the last cash ends the run.
  const notices = settleDays(company, 0);
  return { task, notices };
}

/** Cancel a job that hasn't started: the money comes back. */
export function cancelTask(company: Company, id: number): ActionResult {
  const task = company.tasks.find((t) => t.id === id);
  if (!task) throw new Error("That job is already done.");
  if (task.startDay !== undefined) throw new Error(`${task.title} has started; it can't be called off.`);
  company.tasks = company.tasks.filter((t) => t.id !== id);
  pay(company, categoryOf(task.spec), -task.cost, `${task.title} cancelled`);
  return { text: `Cancelled: ${task.title}. ${money(task.cost)} back.`, notices: [] };
}

/**
 * Book a job and let the calendar run until it is done: with `followUps`,
 * also until anything it leads to is (a new test engine after one is lost).
 */
export function runTask(company: Company, spec: TaskSpec, followUps = true): ActionResult & { done: TaskDone[] } {
  const { task, notices } = book(company, spec);
  const finishedFrom = company.done.length;
  while (!company.dead && company.tasks.some((t) => t.id === task.id || (followUps && t.parent === task.id))) {
    const next = nextEvent(company);
    if (next === null) break;
    notices.push(...settleDays(company, next - company.day));
  }
  const done = company.done.slice(finishedFrom).filter((d) => d.id === task.id);
  const text = done.map((d) => d.text).join("\n");
  // The job's own result is the text; its completion notice would repeat it.
  return { text, notices: notices.filter((n) => !done.some((d) => n === completionNotice(d))), done };
}

/** Buy another unit for a track: paid now, working once it is set up. */
export function buyUnit(company: Company, track: Track): ActionResult {
  if (company.dead) throw new Error("The company is gone. Its cash ran out.");
  const next = TRACKS[track].extra[company.units[track].length - 1];
  if (!next) throw new Error(`The company can't add to its ${TRACKS[track].name.toLowerCase()}.`);
  company.units[track].push(company.day + next.days);
  pay(company, "facility", next.cost, `${TRACKS[track].name}: ${next.name}`);
  const notices = settleDays(company, 0);
  return { text: `Bought ${next.name}: ${money(next.cost)}. Working from day ${company.day + next.days}.`, notices };
}

function categoryOf(spec: TaskSpec): Category {
  switch (spec.kind) {
    case "fire":
    case "replace":
    case "tunnel":
    case "pad-abort":
      return "test";
    case "fix-engine":
    case "fix-aero":
    case "fix-abort":
      return "fix";
    case "retune":
      return "analysis";
    case "licence":
      return "licence";
    default:
      return "rnd";
  }
}

const money = (k: number) => `${k < 0 ? "−" : ""}$${(Math.abs(k) / 1000).toFixed(2)}M`;

function pay(company: Company, category: Category, amount: number, note: string): void {
  if (amount === 0) return;
  company.cash -= amount;
  company.ledger.push({ day: company.day, category, amount: -amount, note });
}

// ── The clock ───────────────────────────────────────────────────────────

/** The next day something changes on the tracks: a job finishes, or a new unit comes free for a waiting job. */
export function nextEvent(company: Company): number | null {
  const ends = company.tasks.filter((t) => t.endDay !== undefined).map((t) => t.endDay!);
  const waiting = new Set(company.tasks.filter((t) => t.startDay === undefined).map((t) => t.track));
  const units = [...waiting].flatMap((track) => company.units[track].filter((d) => d > company.day));
  const all = [...ends, ...units];
  return all.length > 0 ? Math.max(company.day, Math.min(...all)) : null;
}

/** The day the last booked job finishes, if the calendar runs on: what the plan adds up to. */
export function nextFinish(company: Company): number | null {
  const ends = company.tasks.filter((t) => t.endDay !== undefined).map((t) => t.endDay!);
  return ends.length > 0 ? Math.min(...ends) : null;
}

/** Finish what is due today, then start what can start. Called by the company's clock on every day it stops. */
export function runTracks(company: Company): string[] {
  const notices: string[] = [];
  for (;;) {
    const due = company.tasks.filter((t) => t.endDay !== undefined && t.endDay <= company.day).sort((a, b) => a.endDay! - b.endDay! || a.id - b.id);
    for (const task of due) notices.push(...complete(company, task));
    const started = startReady(company);
    if (due.length === 0 && started === 0) break;
    if (!company.tasks.some((t) => t.endDay !== undefined && t.endDay <= company.day)) break;
  }
  return notices;
}

/** Whether an earlier-booked job still pending touches the same hardware, with one of them changing it. */
function blocked(task: Task, tasks: Task[]): boolean {
  return tasks.some(
    (other) =>
      other.id < task.id &&
      (other.writes.some((k) => task.reads.includes(k) || task.writes.includes(k)) || task.writes.some((k) => other.reads.includes(k))),
  );
}

/** Start queued jobs on free units, in the order they were booked. */
function startReady(company: Company): number {
  let started = 0;
  for (const track of TRACK_ORDER) {
    const units = company.units[track];
    for (let unit = 0; unit < units.length; unit++) {
      if (units[unit]! > company.day) continue;
      if (company.tasks.some((t) => t.track === track && t.unit === unit && t.startDay !== undefined)) continue;
      const next = company.tasks.find((t) => t.track === track && t.startDay === undefined && !blocked(t, company.tasks));
      if (!next) continue;
      next.unit = unit;
      next.startDay = company.day;
      next.endDay = company.day + next.days;
      started++;
    }
  }
  return started;
}

export const completionNotice = (d: TaskDone) => `Day ${d.day} · ${TRACKS[d.track].name}: ${d.summary}`;

/** A job's days are up: do what it does, and say what it found. */
function complete(company: Company, task: Task): string[] {
  company.tasks = company.tasks.filter((t) => t.id !== task.id);
  let summary: string;
  let text: string;
  let key: string | undefined;
  let tone: DoneTone = "info";
  try {
    ({ summary, text, key, tone } = effect(company, task));
  } catch (error) {
    // The world moved while it waited: nothing left to do. The money comes back.
    pay(company, categoryOf(task.spec), -task.cost, `${task.title}: not needed`);
    summary = `${task.title}: not done. ${(error as Error).message} The money is refunded.`;
    text = summary;
  }
  const done: TaskDone = { id: task.parent ?? task.id, track: task.track, title: task.title, day: company.day, summary, text, tone, ...(key ? { key } : {}) };
  company.done.push(done);
  if (company.done.length > 40) company.done.splice(0, company.done.length - 40);
  return task.spec.kind === "replace" ? [] : [completionNotice(done)];
}

function effect(company: Company, task: Task): { summary: string; text: string; key?: string; tone: DoneTone } {
  const spec = task.spec;
  const campaign = company.campaign;
  switch (spec.kind) {
    case "fire": {
      const engine = engineOf(company, spec.engine);
      const report = hotFire(campaign, engine, spec.seconds, spec.facility, spec.restart);
      // Booked for the planned run; settle for what was fired, and for a lost engine.
      pay(company, "test", report.cost - task.cost, report.cost > task.cost ? `${engine.name}: test engine lost` : `${engine.name}: firing ended early`);
      if (report.hardwareLost) {
        company.tasks.push({ id: company.nextTask++, spec: { kind: "replace", engine: engine.name }, bookedDay: company.day, parent: task.id, ...describeTask(company, { kind: "replace", engine: engine.name }), unit: task.unit, startDay: company.day, endDay: company.day + hardwareLoss(engine).days, track: task.track });
      }
      const f = report.findings[0];
      const what = f ? `${FAILURE_LABELS[f.mode]} at ${f.t.toFixed(1)} s${report.hardwareLost ? ", test engine lost" : ""}` : report.isp ? `clean, Isp ${(report.isp.measured / report.isp.predicted - 1 >= 0 ? "+" : "")}${((report.isp.measured / report.isp.predicted - 1) * 100).toFixed(1)}% against the drawings` : "clean";
      return { summary: `${engine.name} ${spec.restart ? "restart test" : `${report.fired.toFixed(0)} s`}: ${what}.`, text: report.text, tone: f || report.hardwareLost ? "bad" : "good" };
    }
    case "replace":
      return { summary: `a new ${spec.engine} test engine is ready.`, text: "", tone: "info" };
    case "fix-engine": {
      const r = applyFix(campaign, engineOf(company, spec.engine), spec.mode);
      return { summary: `${r.text.split(".")[0]}.`, text: r.text, tone: "good" };
    }
    case "tunnel": {
      const r = tunnelRun(campaign, designOf(company, spec.design), spec.facility);
      return { summary: `${r.shape}: ${r.buffet ? "transonic buffet found" : "data in"}.`, text: r.text, tone: r.buffet ? "bad" : "info" };
    }
    case "fix-aero": {
      const text = applyAeroFix(campaign, designOf(company, spec.design), spec.mode);
      return { summary: text.split(".")[0] + ".", text, tone: "good" };
    }
    case "refine": {
      const text = refine(company, spec.part);
      return { summary: text.split(":")[0] + ".", text, tone: "good" };
    }
    case "develop": {
      const engine = spec.design ? designEngine(spec.parts, spec.design, spec.name, { family: spec.family, rev: spec.rev }) : assembleEngine(spec.parts, spec.name);
      const newParts = partKeysOf(spec.parts).filter((k) => !developedParts(company).includes(k));
      rollPartTruths([engine], company.seed, campaign.partTruth);
      campaign.truth[spec.name] = combineTruth(engine, campaign.partTruth, company.seed);
      campaign.engines[spec.name] = engine;
      refreshFromParts(campaign);
      const text = `${spec.name} developed: ${(engine.thrustVac / 1000).toFixed(1)} kN, Isp ${engine.ispVac} s on paper. ${newParts.length === 0 ? "Every part was already in production." : `New parts: ${newParts.map(partLabel).join(", ")}.`}`;
      return { summary: `${spec.name} developed.`, text, tone: "good" };
    }
    case "design": {
      const key = designKey(company, spec.vehicle.name);
      company.designs[key] = spec.vehicle;
      const shape = aeroShape(spec.vehicle);
      const newShape = !campaign.aeroTruth[shape.key];
      campaign.aeroTruth[shape.key] ??= rollAeroTruth(spec.vehicle, company.seed);
      const text = `${spec.vehicle.name} drawn up.${spec.tooling.length > 0 ? ` New: ${spec.tooling.join(", ")}.` : ""}${newShape ? ` Its ${shape.label} is a shape the tunnel has never seen.` : ""}`;
      return { summary: `${spec.vehicle.name} drawn up: ready to build.`, text, key, tone: "info" };
    }
    case "retune": {
      const design = designOf(company, spec.design);
      company.designs[spec.design] = { ...design, pitchProgram: spec.pitchProgram };
      return { summary: `${design.name} re-tuned.`, text: spec.text, tone: "info" };
    }
    case "licence":
      company.licence = spec.tier;
      return { summary: `${LICENCE_LABELS[spec.tier]} licence granted.`, text: `${LICENCE_LABELS[spec.tier]} licence granted on day ${company.day}.`, tone: "good" };
    case "capsule":
      company.capsule = newCapsule(company.seed, company.day);
      return {
        summary: "Crew capsule developed.",
        tone: "good",
        text: `The crew capsule is ready: ${CAPSULE.mass.toLocaleString("en-US")} kg with ${CAPSULE.crew} crew, under a ${CAPSULE.tower.mass} kg abort tower dropped at T+${CAPSULE.tower.jettisonAt} s. Whether its abort system would save a crew is unknown until the pad and in-flight abort tests.`,
      };
    case "pad-abort": {
      const text = padAbort(company.capsule!, company.day);
      const passed = company.capsule!.known.padAbortPassed;
      return { summary: text.split(":")[0] + (passed ? ": passed." : ": failed."), text, tone: passed ? "good" : "bad" };
    }
    case "fix-abort": {
      const text = fixAbortFlaw(company.capsule!, spec.flaw, company.day);
      return { summary: `${ABORT_FIXES[spec.flaw].name} fitted.`, text, tone: "good" };
    }
  }
}

const partKeysOf = (parts: EngineParts) => Object.values(partKeys(parts));

/** Tune a part's elements and contour against measured Isp: a new revision, a little closer to the best it can do. */
function refine(company: Company, key: string): string {
  const { slot, option } = parsePartKey(key);
  const users = enginesUsing(company.campaign, key);
  const part = partKnowledgeOf(company.campaign, key);
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
  // Remember where each engine stood, so the next measurement shows what the refinement bought.
  const before = Object.fromEntries(users.map((e) => [e.name, company.campaign.knowledge[e.name]?.measuredIspFactor ?? null]));
  for (const e of users) {
    const k = company.campaign.knowledge[e.name];
    if (k) k.measuredIspFactor = null;
  }
  part.refinements += 1;
  part.revision += 1;
  (part.refined ??= []).push({ revision: part.revision, day: company.day, before });
  part.notes.push(`${revisionLetter(part.revision)}: refined against measured Isp.`);
  return `${partLabel(key)} goes to ${revisionLetter(part.revision)}: elements and contour tuned against the measured Isp. Fire it again to see what it gained.`;
}

/** A key for a new design's name, unique among the company's designs. */
export function designKey(company: Company, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "design";
  let key = base;
  for (let i = 2; company.designs[key]; i++) key = `${base}-${i}`;
  return key;
}

// ── Looking ahead ───────────────────────────────────────────────────────

export type Projection = { start: number; end: number };

/**
 * When every booked job will start and finish if the calendar runs on, and
 * when a job not yet booked would. Firings are assumed to keep their test
 * engine; a lost one pushes its track back.
 */
export function project(company: Company, extra?: TaskSpec): { tasks: Map<number, Projection>; extra: Projection | null } {
  const sim: Task[] = company.tasks.map((t) => ({ ...t }));
  let extraId: number | null = null;
  if (extra) {
    const d = describeTask(company, extra);
    extraId = company.nextTask;
    sim.push({ id: extraId, spec: extra, bookedDay: company.day, ...d });
  }
  const out = new Map<number, Projection>();
  let day = company.day;
  const units = Object.fromEntries(TRACK_ORDER.map((t) => [t, [...company.units[t]]])) as Record<Track, number[]>;
  for (let guard = 0; guard < 500; guard++) {
    // Finish what is due, then start what can.
    for (const t of sim.filter((t) => t.endDay !== undefined && t.endDay <= day)) {
      out.set(t.id, { start: t.startDay!, end: t.endDay! });
      sim.splice(sim.indexOf(t), 1);
    }
    for (const track of TRACK_ORDER) {
      units[track].forEach((free, unit) => {
        if (free > day || sim.some((t) => t.track === track && t.unit === unit && t.startDay !== undefined)) return;
        const next = sim.find((t) => t.track === track && t.startDay === undefined && !blocked(t, sim));
        if (!next) return;
        next.unit = unit;
        next.startDay = day;
        next.endDay = day + next.days;
      });
    }
    if (sim.length === 0) break;
    const ends = sim.filter((t) => t.endDay !== undefined).map((t) => t.endDay!);
    const frees = TRACK_ORDER.flatMap((t) => units[t].filter((d) => d > day));
    const next = Math.min(...ends, ...frees);
    if (!Number.isFinite(next)) break;
    day = next;
  }
  return { tasks: out, extra: extraId === null ? null : (out.get(extraId) ?? null) };
}

/** What booking a job now would mean: its track, when it would start and finish, and what it waits for. */
export function quoteTask(company: Company, spec: TaskSpec): { track: Track; title: string; cost: number; days: number; start: number; end: number; after: string[] } {
  const d = describeTask(company, spec);
  const { extra } = project(company, spec);
  const probe: Task = { id: company.nextTask, spec, bookedDay: company.day, ...d };
  const after = company.tasks.filter((t) => (t.track === d.track && t.startDay !== undefined) || blocked(probe, [t]) || (t.track === d.track && t.startDay === undefined)).map((t) => t.title);
  const start = extra?.start ?? company.day;
  return { track: d.track, title: d.title, cost: d.cost, days: d.days, start, end: extra?.end ?? start + d.days, after };
}

/** Days of payroll a booked plan adds up to, to the last job's end. */
export function planEnd(company: Company): number | null {
  const ends = [...project(company).tasks.values()].map((p) => p.end);
  return ends.length > 0 ? Math.max(...ends) : null;
}

export const overheadFor = (days: number) => days * COSTS.overheadPerDay;
