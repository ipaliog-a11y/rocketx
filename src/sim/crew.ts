import type { FlightResult } from "./ascent.ts";
import type { Company } from "./company.ts";
import { missionPlan, type Mission } from "./mission.ts";
import { hashSeed, rng } from "./random.ts";
import { burnTime, type Vehicle } from "./vehicle.ts";

/**
 * People. The company builds a capsule with a launch-abort system: a tower
 * of solid motors on its nose that pulls the capsule clear of a failing
 * rocket and lets it down on parachutes. Whether an abort saves the crew is
 * a hidden truth, like an engine's. Two tests reveal it: a pad abort and an
 * in-flight abort at max-q on a booster spent for the purpose.
 */

export type AbortFlaw = "tower-misfire" | "chute-failure" | "max-q-breakup";

export const ABORT_FLAWS: AbortFlaw[] = ["tower-misfire", "chute-failure", "max-q-breakup"];

export const ABORT_FLAW_LABELS: Record<AbortFlaw, string> = {
  "tower-misfire": "abort tower misfire",
  "chute-failure": "parachute failure",
  "max-q-breakup": "capsule breakup in a max-q abort",
};

/** How often each flaw is in a new capsule's design. */
const FLAW_ODDS: Record<AbortFlaw, number> = { "tower-misfire": 0.2, "chute-failure": 0.1, "max-q-breakup": 0.25 };

/** The capsule, its abort tower and what developing it takes. Masses in kg, money in $k. */
export const CAPSULE = {
  name: "crew capsule",
  mass: 2_400,
  crew: 2,
  develop: { cost: 8_000, days: 150 },
  /** Solid motors on the nose: dead weight until the vehicle is clear of the thick air. */
  tower: { mass: 500, jettisonAt: 150 },
};

/** Above this dynamic pressure an abort is a max-q abort, Pa. */
export const MAX_Q_ABORT = 15_000;

export const PAD_ABORT = { cost: 1_500, days: 20 };

export const ABORT_FIXES: Record<AbortFlaw, { name: string; cost: number; days: number; text: string }> = {
  "tower-misfire": { name: "redundant igniters on the abort motors", cost: 400, days: 30, text: "Two igniter chains per motor, either one enough." },
  "chute-failure": { name: "a third main parachute", cost: 350, days: 25, text: "Any two of three bring the capsule down at a survivable speed." },
  "max-q-breakup": { name: "canards and a stronger heat shield attachment", cost: 900, days: 60, text: "The capsule flies heat shield first after separation, instead of tumbling." },
};

export type AbortTruth = Record<AbortFlaw, boolean>;

export type AbortKnowledge = {
  /** Revisions since the first design; a fix makes a new one, and earlier tests stop counting. */
  revision: number;
  padAbortPassed: boolean;
  inflightAbortPassed: boolean;
  open: AbortFlaw[];
  fixed: AbortFlaw[];
  history: Array<{ day: number; text: string }>;
};

export type Capsule = { developedDay: number; truth: AbortTruth; known: AbortKnowledge };

export function rollAbortTruth(seed: number): AbortTruth {
  const random = rng(hashSeed(`${seed}:capsule`));
  return { "tower-misfire": random() < FLAW_ODDS["tower-misfire"], "chute-failure": random() < FLAW_ODDS["chute-failure"], "max-q-breakup": random() < FLAW_ODDS["max-q-breakup"] };
}

export function newCapsule(seed: number, day: number): Capsule {
  return { developedDay: day, truth: rollAbortTruth(seed), known: { revision: 0, padAbortPassed: false, inflightAbortPassed: false, open: [], fixed: [], history: [] } };
}

function reveal(capsule: Capsule, flaws: AbortFlaw[]): AbortFlaw[] {
  const found = flaws.filter((f) => capsule.truth[f]);
  for (const f of found) if (!capsule.known.open.includes(f)) capsule.known.open.push(f);
  return found;
}

/** The pad abort: the tower fires from the pad and the capsule comes down on its parachutes. */
export function padAbort(capsule: Capsule, day: number): string {
  const found = reveal(capsule, ["tower-misfire", "chute-failure"]);
  capsule.known.padAbortPassed = found.length === 0;
  const text =
    found.length === 0
      ? "Pad abort: the tower pulled the capsule clear and the parachutes brought it down in the sea, a short swim from the pad. Passed."
      : `Pad abort failed: ${found.map((f) => ABORT_FLAW_LABELS[f]).join(" and ")}. A crew aboard would not have survived it.`;
  capsule.known.history.push({ day, text });
  return text;
}

/**
 * The in-flight abort, on a booster spent for the test. It only says how the
 * capsule copes with thick air if the abort really came in thick air: one
 * that fires early, on a booster that failed before max-q, tests the tower
 * and the parachutes but not that.
 */
export function inflightAbort(capsule: Capsule, day: number, q: number): string {
  const thick = q > MAX_Q_ABORT;
  const found = reveal(capsule, thick ? ABORT_FLAWS : ["tower-misfire", "chute-failure"]);
  capsule.known.inflightAbortPassed = thick && found.length === 0;
  const at = `In-flight abort at ${(q / 1000).toFixed(1)} kPa`;
  const text =
    found.length > 0
      ? `${at} failed: ${found.map((f) => ABORT_FLAW_LABELS[f]).join(" and ")}. A crew aboard would not have survived it.`
      : thick
        ? `${at}: the capsule pulled clear of the booster at max-q and came down under its parachutes. Passed.`
        : `${at}: the capsule came clear and down on its parachutes, but the abort came below ${MAX_Q_ABORT / 1000} kPa, before max-q. It doesn't show how the capsule copes with thick air: fly it again.`;
  capsule.known.history.push({ day, text });
  return text;
}

/** Fix a flaw the tests have shown: a new revision, and the tests have to be flown again. */
export function fixAbortFlaw(capsule: Capsule, flaw: AbortFlaw, day: number): string {
  if (!capsule.known.open.includes(flaw)) throw new Error(`No ${ABORT_FLAW_LABELS[flaw]} has been seen. A test has to show a problem before it can be fixed.`);
  capsule.truth[flaw] = false;
  capsule.known.open = capsule.known.open.filter((f) => f !== flaw);
  if (!capsule.known.fixed.includes(flaw)) capsule.known.fixed.push(flaw);
  capsule.known.revision += 1;
  capsule.known.padAbortPassed = false;
  capsule.known.inflightAbortPassed = false;
  const fix = ABORT_FIXES[flaw];
  const text = `Abort system: ${fix.name}. ${fix.text} Both abort tests have to be flown again on the new revision.`;
  capsule.known.history.push({ day, text });
  return text;
}

/**
 * Whether an abort saves the crew. Before the tower goes, it has to fire
 * and the parachutes have to open, and in thick air the capsule has to
 * hold together. After the tower is gone, the capsule separates on its own
 * and only the parachutes matter.
 */
export function abortOutcome(truth: AbortTruth, t: number, q: number): { survived: boolean; why: string } {
  if (t < CAPSULE.tower.jettisonAt) {
    if (truth["tower-misfire"]) return { survived: false, why: "the abort tower didn't fire" };
    if (q > MAX_Q_ABORT && truth["max-q-breakup"]) return { survived: false, why: `the capsule broke up as it pulled away at ${(q / 1000).toFixed(1)} kPa` };
  }
  if (truth["chute-failure"]) return { survived: false, why: "the parachutes failed" };
  return { survived: true, why: t < CAPSULE.tower.jettisonAt ? "the tower pulled the capsule clear and it came down on its parachutes" : "the capsule separated and came down on its parachutes" };
}

/** A vehicle carrying the capsule: its mass and the tower on top. */
export function withCapsule(vehicle: Vehicle): Vehicle {
  return { ...vehicle, payloadMass: CAPSULE.mass + CAPSULE.tower.mass, escapeTower: { ...CAPSULE.tower } };
}

/** Clean flights in a row that make a design's record good enough for people. */
export const CLEAN_FLIGHTS_FOR_CREW = 3;

/**
 * Whether a design may fly people, and what is missing if not: every engine
 * proven past its burn (and its relight, if the station mission needs one),
 * its last flights clean, and both abort tests passed on the current abort
 * system.
 */
export function crewRating(company: Company, key: string, mission?: Mission): { rated: boolean; missing: string[] } {
  const design = company.designs[key];
  const missing: string[] = [];
  if (!design) return { rated: false, missing: ["No such design."] };
  const capsule = company.capsule;
  if (!capsule) missing.push("The company has no capsule.");
  else {
    if (!capsule.known.padAbortPassed) missing.push("A pad abort passed on the current abort system.");
    if (!capsule.known.inflightAbortPassed) missing.push("An in-flight abort passed on the current abort system.");
  }
  const relights = mission ? missionPlan(mission).burns.length > 0 : false;
  design.stages.forEach((stage, i) => {
    const known = company.campaign.knowledge[stage.engine.name];
    const burn = burnTime(stage);
    if (!known || known.provenDuration < burn) missing.push(`The ${stage.engine.name} proven for its full ${burn.toFixed(0)} s burn.`);
    if (known?.open.length) missing.push(`The ${stage.engine.name}'s open faults fixed.`);
    if (relights && i === design.stages.length - 1 && !known?.relightProven) missing.push(`The ${stage.engine.name}'s relight proven.`);
  });
  const flights = company.flights.filter((f) => f.design === design.name && f.outcome !== "abort");
  const recent = flights.slice(-CLEAN_FLIGHTS_FOR_CREW);
  const clean = recent.filter((f) => f.outcome === "orbit" || f.outcome === "escape").length;
  if (recent.length < CLEAN_FLIGHTS_FOR_CREW || clean < CLEAN_FLIGHTS_FOR_CREW) {
    missing.push(`${CLEAN_FLIGHTS_FOR_CREW} clean orbital flights in a row of the ${design.name} (last ${recent.length}: ${clean} clean).`);
  }
  return { rated: missing.length === 0, missing };
}

/** Dynamic pressure on the vehicle at a moment of the flight, from the nearest sample, Pa. */
export function qAt(result: FlightResult, t: number): number {
  const nearest = result.samples.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), result.samples[0]!);
  return nearest?.dynamicPressure ?? 0;
}

/** The flight as an in-flight abort test sees it: everything up to the abort, then the capsule pulls away and the booster is lost. */
export function abortAt(result: FlightResult, t: number, q: number): FlightResult {
  const samples = result.samples.filter((s) => s.t <= t);
  const last = samples.at(-1) ?? result.samples[0]!;
  const events = result.events.filter((e) => e.t <= t);
  const stage = events.filter((e) => e.kind === "staging").length;
  events.push({ kind: "abort", t, altitude: last.altitude, velocity: last.velocity, mach: last.mach, stage, value: q });
  return { ...result, outcome: "abort", events, samples, summary: { ...result.summary, apogee: Math.max(...samples.map((s) => s.altitude)) } };
}
