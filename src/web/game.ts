import { useSyncExternalStore } from "react";
import { newCompany, rename, type ActionResult, type Company, type FlightReport } from "../sim/company.ts";
import { forgetStandSeparation } from "../sim/teststand.ts";
import { book, completionNotice, project, quoteTask, TRACKS, upgradeCompany, type TaskDone, type Track } from "../sim/schedule.ts";
import type { TestReport } from "../sim/teststand.ts";
import { achievements } from "../sim/achievements.ts";
import { LICENCE_LABELS, LICENCE_ORDER } from "../sim/licence.ts";
import type { IconName } from "./components/Icon.tsx";
import { after } from "./motion.ts";
import { generateBoard, startingCash } from "../contracts.ts";
import { DESIGNS } from "./designs.ts";
import { ERAS } from "../sim/market.ts";
import { cancelJob, deadlineRisks, signedContracts, unitJob, type Job } from "./jobs.ts";
import { cashRisk } from "./cashRisk.ts";

export { DESIGNS, defaultDesign } from "./designs.ts";

/**
 * The game's state for the browser: the sim's Company plus what the UI
 * needs around it (the last flight to replay, notices to show). Actions
 * mutate the company the same way the command line does, then the store
 * saves and tells React to redraw.
 */

/** A toast. Results carry a title and a small line under it; plain messages just have text. */
export type Notice = { id: number; text: string; tone: "info" | "good" | "bad" | "clock"; title?: string; sub?: string; leaving?: boolean };

/** A firing that just finished, played back before its report. */
export type Moment = { id: number; engine: string; report: TestReport };

/** Something worth stopping for: a first orbit, a licence, an achievement. */
export type Milestone = { id: number; icon: IconName; title: string; text: string };

/** A job on the clock: the progress screen runs from `fromDay` to `toDay`. */
export type Progress = { id: number; doing: string; fromDay: number; toDay: number; ms: number; crunching: boolean };

type State = {
  company: Company | null;
  /** The most recent flight, kept until the player leaves its debrief. */
  flight: { id: number; report: FlightReport; design: string } | null;
  notices: Notice[];
  /** A job waiting on the player's go-ahead. */
  pending: Job<any> | null;
  progress: Progress | null;
  moment: Moment | null;
  milestones: Milestone[];
  /** A launch is playing: big news waits for its debrief. */
  cinema: boolean;
  version: number;
};

const SAVE_KEY = "rocketx.save.v5";
/** Saves from before licences, the generated board or engines built from parts: they can't be carried over. */
const OLD_SAVE_KEYS = ["rocketx.save.v1", "rocketx.save.v2", "rocketx.save.v3", "rocketx.save.v4"];

/** Set when an old save was found and dropped, so the new-game screen can say so. Declared before the first load. */
export let droppedOldSave = false;

let state: State = { company: load(), flight: null, notices: [], pending: null, progress: null, moment: null, milestones: [], cinema: false, version: 0 };
const listeners = new Set<() => void>();
let nextNotice = 1;
let nextFlight = 1;

function emit(): void {
  state = { ...state, version: state.version + 1 };
  for (const l of listeners) l();
}

function load(): Company | null {
  try {
    for (const key of OLD_SAVE_KEYS) {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        droppedOldSave = true;
      }
    }
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const company = JSON.parse(raw) as Company;
    forgetStandSeparation(company.campaign);
    upgradeCompany(company);
    return company;
  } catch {
    return null;
  }
}

function save(): void {
  try {
    if (state.company) localStorage.setItem(SAVE_KEY, JSON.stringify(state.company));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage can be full or blocked; the run still works in memory.
  }
}

let nextProgress = 1;

/** How long a toast stays, ms: news clears itself; bad news waits to be read. */
const NOTICE_MS: Record<Notice["tone"], number | null> = { clock: 9000, info: 8000, good: 8000, bad: null };

function notify(text: string, tone: Notice["tone"], extra: { title?: string; sub?: string } = {}): void {
  const id = nextNotice++;
  state.notices = [...state.notices, { id, text, tone, ...extra }].slice(-6);
  const ms = NOTICE_MS[tone];
  if (ms !== null) setTimeout(() => game.dismiss(id), ms);
}

let nextMilestone = 1;
/** News held back while something plays: a launch until its debrief, a firing until Done. */
const held: Array<{ text: string; tone: Notice["tone"]; title?: string; sub?: string }> = [];
/** Set while a run-now firing runs, so its result waits for the playback. */
let holding = false;

/** Post what was held, one after another. */
function release(): void {
  held.splice(0).forEach((n, i) =>
    after(i * 140, () => {
      notify(n.text, n.tone, { title: n.title, sub: n.sub });
      emit();
    }),
  );
}

/** What a company has achieved, to tell what an action changed. */
function milestonesOf(company: Company) {
  return { orbit: company.firstOrbitDay, licence: company.licence, era: company.market?.era ?? 1, earned: new Set(achievements(company).filter((a) => a.earned).map((a) => a.id)) };
}

/** The finished jobs an action produced, as toasts, one after another. */
function toastResults(fresh: TaskDone[]): void {
  fresh
    .filter((d) => !d.title.startsWith("New test engine"))
    .forEach((d, i) => {
      const toast = { text: d.summary, tone: d.tone ?? "info", title: d.summary, sub: `day ${d.day} · ${TRACKS[d.track].name}` } as const;
      if (holding) return void held.push(toast);
      after(i * 140, () => {
        notify(toast.text, toast.tone, toast);
        emit();
      });
    });
}

let lastClock: { day: number; id: number } | null = null;

/** One line on the signed contracts' deadlines, from today. */
function clockNotice(company: Company, when: "now" | "after"): void {
  const due = signedContracts(company);
  if (due.length === 0) return;
  // Back-to-back jobs: the last job's "after" already says where today stands.
  if (when === "now" && lastClock?.day === company.day && state.notices.some((n) => n.id === lastClock!.id)) return;
  lastClock = { day: company.day, id: nextNotice };
  const parts = due.map((c) => {
    const left = c.deadline - company.day;
    return `"${c.title}" ${left < 0 ? "is past due" : `${left} day${left === 1 ? "" : "s"} to go`} (day ${c.deadline})`;
  });
  notify(`${when === "now" ? "Day" : "Now day"} ${company.day} · ${parts.join(" · ")}`, "clock");
}

/** How long the progress screen runs: a couple of seconds, a little longer for long jobs. */
const progressMs = (days: number) => Math.round(1400 + Math.min(days, 60) * 20);

export const game = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: (): State => state,

  start(seed: number, name: string): void {
    const board = generateBoard(seed);
    const engines = Object.values(DESIGNS).flatMap((d) => d.stages.map((s) => s.engine));
    state.company = newCompany(seed, startingCash(seed), DESIGNS, engines, board, name.trim() || "Untitled Launch Co.");
    state.flight = null;
    state.notices = [];
    save();
    emit();
  },

  rename(name: string): boolean {
    return game.act((c) => (rename(c, name), { text: "", notices: [] })) !== null;
  },

  quit(): void {
    state.company = null;
    state.flight = null;
    save();
    emit();
  },

  /**
   * Run a sim action against the company. Rule violations come back as
   * notices rather than exceptions, the way the command line prints them.
   */
  act<T extends ActionResult>(action: (company: Company) => T, onDone?: (result: T) => void): T | null {
    const company = state.company;
    if (!company) return null;
    try {
      const before = new Set(company.done);
      const was = milestonesOf(company);
      const result = action(company);
      const fresh = company.done.filter((d) => !before.has(d));
      const said = new Set(fresh.map(completionNotice));
      // A flight's own news is good or bad by what the customer made of it.
      const settled = (result as Partial<FlightReport>).settlement?.status;
      const tone: Notice["tone"] = company.dead || settled === "failed" ? "bad" : settled === "delivered" ? "good" : "info";
      // A launch's news waits for its debrief, so the replay isn't spoiled.
      const flight = (result as Partial<FlightReport>).result !== undefined;
      for (const n of result.notices) if (!said.has(n)) (flight ? held.push({ text: n, tone }) : notify(n, tone));
      toastResults(fresh);
      queueMilestones(was, company);
      onDone?.(result);
      return result;
    } catch (error) {
      notify((error as Error).message, "bad");
      return null;
    } finally {
      save();
      emit();
    }
  },

  /**
   * Start a job that moves the calendar. It asks first when it would cost a
   * signed contract its deadline (and always for builds), then shows the
   * days passing before the sim runs it.
   */
  schedule<T extends ActionResult>(job: Job<T>): void {
    const company = state.company;
    if (!company || state.progress) return;
    // Work on a track always asks: run it now, or put it on the plan. So does
    // anything big, or anything that would leave the company short of cash.
    if (job.task || job.alwaysAsk || deadlineRisks(company, job.days, job.forContract).length > 0 || cashRisk(company, job).asks) {
      state.pending = job;
      emit();
    } else game.proceed(job);
  },

  cancel(): void {
    state.pending = null;
    emit();
  },

  confirm(): void {
    const job = state.pending;
    state.pending = null;
    if (job) game.proceed(job);
    else emit();
  },

  /** Start a track job now: book it and let the calendar run to its end. */
  startNow(): void {
    const job = state.pending;
    const company = state.company;
    state.pending = null;
    if (!job || !company) return emit();
    try {
      const q = quoteTask(company, (job.quote ?? job.task)!(company));
      game.proceed({ ...job, days: q.end - company.day });
    } catch (error) {
      notify((error as Error).message, "bad");
      emit();
    }
  },

  /** Put a track job on the plan: booked and paid, started when its track is free. The calendar stays put. */
  plan(): void {
    const job = state.pending;
    const company = state.company;
    state.pending = null;
    if (!job?.task || !company) return emit();
    const make = job.task;
    const run = () =>
      game.act((c) => {
        const { task, notices } = book(c, make(c));
        const end = project(c).tasks.get(task.id)?.end;
        return { text: "", notices: [`Planned · ${TRACKS[task.track].name}: ${task.title}${end !== undefined ? `, done on day ${end}` : ""}.`, ...notices] };
      });
    if (!job.quote) return void run();
    // Working out a re-tune takes a moment: say so while it runs.
    state.progress = { id: nextProgress++, doing: job.doing, fromDay: company.day, toDay: company.day, ms: 0, crunching: true };
    emit();
    setTimeout(() => {
      run();
      state.progress = null;
      emit();
    }, 40);
  },

  /** Call off a queued job, after asking. */
  cancelTask(id: number): void {
    const task = state.company?.tasks.find((t) => t.id === id);
    if (task) game.schedule(cancelJob(task));
  },

  /** Another unit for a track, after asking. */
  buyUnit(track: Track): void {
    const job = state.company && unitJob(state.company, track);
    if (job) game.schedule(job);
  },

  proceed<T extends ActionResult>(job: Job<T>): void {
    const company = state.company;
    if (!company) return;
    if (job.days === 0) {
      // Nothing to wait for: an order or a purchase happens at once.
      game.act(job.run, job.onDone);
      return;
    }
    clockNotice(company, "now");
    const ms = progressMs(job.days);
    const id = nextProgress++;
    state.progress = { id, doing: job.doing, fromDay: company.day, toDay: company.day + job.days, ms, crunching: false };
    emit();
    setTimeout(() => {
      // Let the bar sit full while the sim works: a re-tune takes a few seconds.
      state.progress = { ...state.progress!, crunching: true };
      emit();
      setTimeout(() => {
        // A firing run now plays back once it's done; a planned one only posts its result.
        const engine = job.moment?.engine;
        const fired = engine ? (company.campaign.knowledge[engine]?.history.length ?? 0) : 0;
        holding = engine !== undefined;
        game.act(job.run, job.onDone);
        holding = false;
        const history = engine ? state.company?.campaign.knowledge[engine]?.history : undefined;
        if (engine && history && history.length > fired) state.moment = { id: nextProgress++, engine, report: history.at(-1)! };
        else if (engine) release();
        state.progress = null;
        if (state.company && !state.company.dead) clockNotice(state.company, "after");
        emit();
      }, 40);
    }, ms);
  },

  showFlight(report: FlightReport, design: string): void {
    state.flight = { id: nextFlight++, report, design };
    state.cinema = true;
    emit();
  },

  /** The launch has reached its debrief, or was skipped: held news can show. */
  endCinema(): void {
    if (!state.cinema) return;
    state.cinema = false;
    release();
    emit();
  },

  closeMoment(): void {
    state.moment = null;
    release();
    emit();
  },

  dismissMilestone(id: number): void {
    state.milestones = state.milestones.filter((m) => m.id !== id);
    emit();
  },

  closeFlight(): void {
    state.flight = null;
    if (state.cinema) return game.endCinema();
    emit();
  },

  /** Let a toast fade out, then remove it. */
  dismiss(id: number): void {
    if (!state.notices.some((n) => n.id === id && !n.leaving)) return;
    state.notices = state.notices.map((n) => (n.id === id ? { ...n, leaving: true } : n));
    emit();
    after(200, () => {
      state.notices = state.notices.filter((n) => n.id !== id);
      emit();
    });
  },
};

/** Queue a banner for each big thing an action achieved. */
function queueMilestones(was: ReturnType<typeof milestonesOf>, company: Company): void {
  const add = (icon: IconName, title: string, text: string) => state.milestones.push({ id: nextMilestone++, icon, title, text });
  if (was.orbit === null && company.firstOrbitDay !== null) add("orbit", "First orbit", `${company.name} reached orbit on day ${company.firstOrbitDay}.`);
  if (LICENCE_ORDER.indexOf(company.licence) > LICENCE_ORDER.indexOf(was.licence)) add("licence", `${LICENCE_LABELS[company.licence]} license`, "The regulator has signed it off. New work is open to you.");
  for (const a of achievements(company)) if (a.earned && !was.earned.has(a.id)) add("reputation", a.title, a.text);
  const era = company.market?.era ?? 1;
  if (era > was.era) add("contract", `Market era ${era}: ${ERAS[era - 1]!.label}`, ERAS[era - 1]!.text);
}

export function useGame(): State {
  return useSyncExternalStore(game.subscribe, game.snapshot);
}
