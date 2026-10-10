import { useSyncExternalStore } from "react";
import { newCompany, rename, type ActionResult, type Company, type FlightReport } from "../sim/company.ts";
import { generateBoard, startingCash } from "../contracts.ts";
import { DESIGNS } from "./designs.ts";
import { deadlineRisks, signedContracts, type Job } from "./jobs.ts";

export { DESIGNS, defaultDesign } from "./designs.ts";

/**
 * The game's state for the browser: the sim's Company plus what the UI
 * needs around it (the last flight to replay, notices to show). Actions
 * mutate the company the same way the command line does, then the store
 * saves and tells React to redraw.
 */

export type Notice = { id: number; text: string; tone: "info" | "bad" | "clock" };

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
  version: number;
};

const SAVE_KEY = "rocketx.save.v3";
/** Saves from before licences, the generated board or engines built from parts: they can't be carried over. */
const OLD_SAVE_KEYS = ["rocketx.save.v1", "rocketx.save.v2"];

/** Set when an old save was found and dropped, so the new-game screen can say so. Declared before the first load. */
export let droppedOldSave = false;

let state: State = { company: load(), flight: null, notices: [], pending: null, progress: null, version: 0 };
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
    return raw ? (JSON.parse(raw) as Company) : null;
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

function notify(text: string, tone: Notice["tone"]): void {
  const id = nextNotice++;
  state.notices = [...state.notices, { id, text, tone }].slice(-5);
  // The calendar notices are a glance, not a record: they clear themselves.
  if (tone === "clock") setTimeout(() => game.dismiss(id), 9000);
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
      const result = action(company);
      for (const n of result.notices) notify(n, company.dead ? "bad" : "info");
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
    if (job.alwaysAsk || deadlineRisks(company, job.days, job.forContract).length > 0) {
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

  proceed<T extends ActionResult>(job: Job<T>): void {
    const company = state.company;
    if (!company) return;
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
        game.act(job.run, job.onDone);
        state.progress = null;
        if (state.company && !state.company.dead) clockNotice(state.company, "after");
        emit();
      }, 40);
    }, ms);
  },

  showFlight(report: FlightReport, design: string): void {
    state.flight = { id: nextFlight++, report, design };
    emit();
  },

  closeFlight(): void {
    state.flight = null;
    emit();
  },

  dismiss(id: number): void {
    state.notices = state.notices.filter((n) => n.id !== id);
    emit();
  },
};

export function useGame(): State {
  return useSyncExternalStore(game.subscribe, game.snapshot);
}
