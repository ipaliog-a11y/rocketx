import { simulateAscent, type FlightResult } from "./ascent.ts";
import { believedGnc, GNC_RANGES, IMU, IMU_RESIDUAL, type GncFlight } from "./control.ts";
import type { Mission } from "./mission.ts";
import { hashSeed, rng } from "./random.ts";
import { rollKnockdown } from "./structures.ts";
import { believedHardware, type Campaign } from "./teststand.ts";
import { believedAero } from "./tunnel.ts";
import type { Vehicle } from "./vehicle.ts";
import { rollWind } from "./wind.ts";

/**
 * Monte Carlo dispersions: the flight flown many times on paper, each in a
 * different day's wind, with whatever testing hasn't pinned down drawn from
 * the range it could be in: the bending mode, slosh, the IMU's drift, a
 * gain-schedule error in untested flight software, and the real knock-down
 * of shells never proof-tested. What is measured flies as measured.
 * Engines and drag fly as the company believes them. Control and
 * structural failures are on, so the runs count what would be lost.
 *
 * It never reads the hidden truth: it samples what the truth could be.
 */

export const DISPERSION_RUNS = 30;

export type DispersionRun = { index: number; result: FlightResult; delivers: boolean; lost: string | null };

export type Percentiles = { p50: number; p95: number; p99: number; max: number };

export type Dispersions = {
  runs: DispersionRun[];
  /** Share of runs that delivered. */
  success: number;
  /** Peak gimbal use, and peak q·α against the shell's drawn budget. */
  effort: Percentiles;
  qAlpha: Percentiles;
  qAlphaBudget: number;
  /** Apogee (suborbital) or perigee (orbital) at the end, m. */
  reach: Percentiles & { p5: number };
  orbital: boolean;
  /** Losses by what caused them. */
  losses: Record<string, number>;
  /** A recoverable booster: share of the runs it landed in, and what lost it in the rest. Null if it's expended. */
  landed: number | null;
  landingLosses: Record<string, number>;
};

/** One run's sampled situation: what testing hasn't measured, drawn from its range. */
function sample(campaign: Campaign, vehicle: Vehicle, seed: number): { gnc?: Record<string, GncFlight>; structure: Record<string, number> } {
  const r = rng(hashSeed(`${seed}:sample`));
  const structure: Record<string, number> = {};
  for (const st of vehicle.structure?.stages ?? []) structure[st.key] = campaign.structureKnowledge?.[st.key]?.knockdown ?? rollKnockdown(st.key, seed);
  const model = vehicle.control;
  if (!model) return { structure };
  const known = campaign.gncKnowledge?.[vehicle.name];
  const believed = believedGnc(model, known);
  const between = ([a, b]: [number, number]) => a + (b - a) * r();
  const bending = known?.bending ?? between(GNC_RANGES.bending);
  const drift = (IMU[model.design.imu].drift / 3600) * (2 * r() - 1);
  const hitl = known?.hitl?.runs ? true : false;
  const flaw = hitl || known?.flawFixed ? null : r() < GNC_RANGES.flawChance ? (() => { const from = 0.7 + 1.6 * r(); return { from, to: from + 0.4, gain: between(GNC_RANGES.flawGain) }; })() : null;
  const flight: GncFlight = {
    bending,
    notchAt: believed.notchAt,
    slosh: known?.slosh ?? model.configs.map(() => between(GNC_RANGES.slosh)),
    imuBias: known?.imuBias !== undefined ? known.imuBias * IMU_RESIDUAL : drift,
    flaw,
  };
  return { gnc: { [vehicle.name]: flight }, structure };
}

const percentiles = (xs: number[]): Percentiles & { p5: number } => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] ?? 0;
  return { p5: at(0.05), p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s.at(-1) ?? 0 };
};

function delivers(result: FlightResult, minApogee?: number): boolean {
  if (minApogee !== undefined) return result.outcome === "apogee" && result.summary.apogee >= minApogee;
  return result.summary.insertion?.inSpec ?? false;
}

/**
 * Fly the runs one at a time, yielding after each so a screen can show
 * progress; the generator's return value is the summary.
 */
export function* runDispersions(campaign: Campaign, vehicle: Vehicle, mission: Mission, options: { runs?: number; minApogee?: number; seed?: number } = {}): Generator<DispersionRun, Dispersions> {
  const n = options.runs ?? DISPERSION_RUNS;
  const hardware = believedHardware(campaign);
  const aero = believedAero(campaign);
  const runs: DispersionRun[] = [];
  for (let i = 0; i < n; i++) {
    const seed = hashSeed(`${options.seed ?? 0}:mc:${vehicle.name}:${i}`);
    const s = sample(campaign, vehicle, seed);
    // A booster coming home meets the day's scatter and sea state too.
    const result = simulateAscent(vehicle, mission, { hardware, aero, structure: s.structure, ...(s.gnc ? { gnc: s.gnc, wind: rollWind(seed) } : {}), ...(vehicle.geometry?.recovery ? { landingSeed: seed } : {}) });
    const lost = result.events.find((e) => e.kind === "loss-of-control" || e.kind === "structural-failure" || e.kind === "engine-failure");
    const run: DispersionRun = { index: i, result, delivers: delivers(result, options.minApogee), lost: lost ? (lost.cause ?? lost.mode ?? lost.kind) : null };
    runs.push(run);
    yield run;
  }
  const losses: Record<string, number> = {};
  for (const r of runs) if (r.lost) losses[r.lost] = (losses[r.lost] ?? 0) + 1;
  const orbital = mission.target !== undefined && options.minApogee === undefined;
  const homes = runs.map((r) => r.result.recovery).filter((h) => h !== undefined);
  const landingLosses: Record<string, number> = {};
  for (const h of homes) if (h.outcome === "lost") landingLosses[h.cause!] = (landingLosses[h.cause!] ?? 0) + 1;
  return {
    runs,
    success: runs.filter((r) => r.delivers).length / Math.max(1, runs.length),
    effort: percentiles(runs.map((r) => r.result.summary.control?.maxEffort.value ?? 0)),
    qAlpha: percentiles(runs.map((r) => r.result.summary.maxQAlpha.value)),
    qAlphaBudget: vehicle.limits.maxQAlpha ?? 0,
    reach: percentiles(runs.filter((r) => !r.lost).map((r) => (orbital ? (r.result.summary.orbit?.periapsis ?? 0) : r.result.summary.apogee))),
    orbital,
    losses,
    landed: vehicle.geometry?.recovery && vehicle.stages.length > 1 ? homes.filter((h) => h.outcome === "landed").length / Math.max(1, runs.length) : null,
    landingLosses,
  };
}

/** All the runs at once. */
export function dispersions(campaign: Campaign, vehicle: Vehicle, mission: Mission, options: { runs?: number; minApogee?: number; seed?: number } = {}): Dispersions {
  const it = runDispersions(campaign, vehicle, mission, options);
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
  }
}
