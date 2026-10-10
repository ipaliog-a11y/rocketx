import { useSyncExternalStore } from "react";
import { build, newCompany, type ActionResult, type Company, type FlightReport } from "../sim/company.ts";
import type { Vehicle } from "../sim/vehicle.ts";
import { generateBoard, startingCash } from "../contracts.ts";
import { MERIDIAN, PATHFINDER, PATHFINDER_FAT_FAIRING, PATHFINDER_TWO_STAGE } from "../vehicles.ts";

/**
 * The game's state for the browser: the sim's Company plus what the UI
 * needs around it (the last flight to replay, notices to show). Actions
 * mutate the company the same way the command line does, then the store
 * saves and tells React to redraw.
 */

/** The designs a player starts with. The other sim variants are command-line teaching cases. */
export const DESIGNS: Record<string, Vehicle> = {
  pathfinder: PATHFINDER,
  "fat-fairing": PATHFINDER_FAT_FAIRING,
  "two-stage": PATHFINDER_TWO_STAGE,
  meridian: MERIDIAN,
};

export type Notice = { id: number; text: string; tone: "info" | "bad" };

type State = {
  company: Company | null;
  /** The most recent flight, kept until the player leaves its debrief. */
  flight: { id: number; report: FlightReport; design: string } | null;
  notices: Notice[];
  busy: string | null;
  /** A build waiting on the player's go-ahead: the design key. */
  pendingBuild: string | null;
  version: number;
};

const SAVE_KEY = "rocketx.save.v1";

let state: State = { company: load(), flight: null, notices: [], busy: null, pendingBuild: null, version: 0 };
const listeners = new Set<() => void>();
let nextNotice = 1;
let nextFlight = 1;

function emit(): void {
  state = { ...state, version: state.version + 1 };
  for (const l of listeners) l();
}

function load(): Company | null {
  try {
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

function notify(text: string, tone: Notice["tone"]): void {
  state.notices = [...state.notices, { id: nextNotice++, text, tone }].slice(-5);
}

export const game = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: (): State => state,

  start(seed: number): void {
    const board = generateBoard(seed);
    const engines = Object.values(DESIGNS).flatMap((d) => d.stages.map((s) => s.engine));
    state.company = newCompany(seed, startingCash(seed), DESIGNS, engines, board);
    state.flight = null;
    state.notices = [];
    save();
    emit();
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

  /** Ask before a build: it spends money and calendar the player can't get back. */
  askBuild(key: string): void {
    state.pendingBuild = key;
    emit();
  },

  cancelBuild(): void {
    state.pendingBuild = null;
    emit();
  },

  confirmBuild(): void {
    const key = state.pendingBuild;
    state.pendingBuild = null;
    if (key) game.act((c) => build(c, key));
    else emit();
  },

  /** Same as act, but shows a busy screen first: re-tunes take a few seconds. */
  actSlow<T extends ActionResult>(label: string, action: (company: Company) => T, onDone?: (result: T) => void): void {
    state.busy = label;
    emit();
    setTimeout(() => {
      game.act(action, onDone);
      state.busy = null;
      emit();
    }, 30);
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
