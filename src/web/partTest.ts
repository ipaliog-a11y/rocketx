import { REFINE, type Company } from "../sim/company.ts";
import { DEFAULT_RATED_LIFE, flowSeparates, type Engine } from "../sim/engine.ts";
import type { FailureMode } from "../sim/hardware.ts";
import { INJECTORS, NOZZLES, parsePartKey, partLabel, type InjectorOption, type NozzleOption } from "../sim/parts.ts";
import { enginesUsing, FACILITIES, START_CHECK, type Facility } from "../sim/teststand.ts";
import { burnTime, idealDeltaV, type Vehicle } from "../sim/vehicle.ts";

/**
 * What a part still has to prove, and the cheapest firing that proves it:
 * the plan behind the Parts page's "Test it" button.
 */

/** The longest burn any design asks of an engine, s: 0 if no design flies it. */
export function designBurn(company: Company, engineName: string): number {
  let burn = 0;
  for (const d of Object.values(company.designs)) for (const s of d.stages) if (s.engine.name === engineName) burn = Math.max(burn, burnTime(s));
  return burn;
}

/** The burn to prove an engine for: its longest flight burn, or its rated life if no design flies it yet. */
export function plannedBurn(company: Company, engine: Engine): number {
  return designBurn(company, engine.name) || (engine.ratedLife ?? 120);
}

/** An engine's rated chamber life, s. */
const rated = (e: Engine) => e.ratedLife ?? DEFAULT_RATED_LIFE;

/** Flown on an upper stage of some design: it lights in vacuum, and may relight after a coast. */
export function flownUpper(company: Company, engineName: string): boolean {
  return Object.values(company.designs).some((d) => d.stages.some((s, i) => i > 0 && s.engine.name === engineName));
}

export type PartNeed =
  | { kind: "fix"; mode: FailureMode }
  | { kind: "start" }
  | { kind: "relight" }
  | { kind: "stable"; seconds: number }
  | { kind: "life"; share: number }
  | { kind: "vacuum" }
  | { kind: "isp" };

/** The first thing a part has yet to prove, or null when there is nothing left. */
export function partNeed(company: Company, key: string): PartNeed | null {
  const { slot, option } = parsePartKey(key);
  const part = company.campaign.parts[key];
  const users = enginesUsing(company.campaign, key);
  if (users.length === 0) return null;
  if (part && part.open.length > 0) return { kind: "fix", mode: part.open[0]! };
  switch (slot) {
    case "cycle":
      if (!part?.startupProven) return { kind: "start" };
      if (!part.relightProven && users.some((e) => flownUpper(company, e.name))) return { kind: "relight" };
      return null;
    case "injector": {
      const seconds = Math.max(...users.map((e) => plannedBurn(company, e)));
      if ((part?.stableSeconds ?? 0) < seconds) return { kind: "stable", seconds };
      break;
    }
    case "cooling": {
      const share = Math.max(...users.map((e) => plannedBurn(company, e) / rated(e)));
      if ((part?.lifeShare ?? 0) < share) return { kind: "life", share };
      return null;
    }
    case "nozzle":
      if (option !== "sea-level" && !part?.altitudeTested) return { kind: "vacuum" };
      break;
  }
  // Injectors and nozzles set the delivered Isp: refining one needs it measured.
  if (!users.some((e) => company.campaign.knowledge[e.name]?.measuredIspFactor != null)) return { kind: "isp" };
  return null;
}

export type PartTestPlan = { engine: string; facility: Facility; seconds: number; restart: boolean; why: string; cost: number };

const roundUp5 = (s: number) => Math.max(5, Math.ceil(s / 5) * 5);
/** The cheaper stand that lets this engine run: the sea-level stand unless its bell would separate there. */
const runningStand = (e: Engine): Facility => (flowSeparates(e, FACILITIES["sea-level"].ambient) ? "altitude" : "sea-level");

/** The engines worth firing for a need. */
function candidates(company: Company, all: Engine[], need: PartNeed): Engine[] {
  switch (need.kind) {
    case "relight":
      return all.filter((e) => flownUpper(company, e.name));
    case "start": {
      // A start check proves only the start: an engine that can run at sea level proves it and measures Isp too.
      const running = all.filter((e) => runningStand(e) === "sea-level");
      return running.length > 0 ? running : all;
    }
    case "stable": {
      // A run longer than a chamber's rating burns through before it proves anything:
      // use an engine rated long enough, or else the longest-lived.
      const lasting = all.filter((e) => rated(e) >= need.seconds);
      const longest = Math.max(...all.map(rated));
      return lasting.length > 0 ? lasting : all.filter((e) => rated(e) === longest);
    }
    default:
      return all;
  }
}

/** The cheapest firing, on any engine built with the part, that proves what it lacks. Null when there is nothing to fire for. */
export function planPartTest(company: Company, key: string): PartTestPlan | null {
  const need = partNeed(company, key);
  if (!need || need.kind === "fix") return null;
  const name = partLabel(key);
  const all = enginesUsing(company.campaign, key);
  const users = candidates(company, all, need);

  const options = users.map((e) => {
    let facility: Facility;
    let seconds: number;
    let restart = false;
    let why: string;
    switch (need.kind) {
      case "start":
        facility = "sea-level";
        seconds = flowSeparates(e, FACILITIES["sea-level"].ambient) ? START_CHECK : 5;
        why = `Prove the ${name} starts cleanly.`;
        break;
      case "relight":
        facility = "altitude";
        seconds = 10;
        restart = true;
        why = `Restart it in vacuum: the ${e.name} flies an upper stage, and coasting missions relight it.`;
        break;
      case "stable":
        facility = runningStand(e);
        seconds = roundUp5(need.seconds);
        why = `Prove ${need.seconds.toFixed(0)} s of stable combustion: the longest burn on an engine with this injector.${rated(e) < need.seconds ? ` The ${e.name}'s chamber is rated ${rated(e)} s, so expect it to burn through first: fix the cooling or shorten the burn.` : ""}`;
        break;
      case "life":
        facility = runningStand(e);
        seconds = roundUp5(need.share * rated(e));
        why = `Prove the chamber lasts ${Math.round(need.share * 100)}% of its rated life: the longest burn on an engine with this cooling.${need.share > 1 ? " That is past its rating: expect it to burn through." : ""}`;
        break;
      case "vacuum":
        facility = "altitude";
        seconds = 10;
        why = `Measure this bell above the air: vacuum performance is only an inference until then.`;
        break;
      case "isp":
        facility = runningStand(e);
        seconds = 10;
        why = `Measure Isp, so the ${name} can be refined.`;
        break;
    }
    const f = FACILITIES[facility];
    return { engine: e.name, facility, seconds, restart, why, cost: f.setup * (restart ? 2 : 1) + f.perSecond * seconds };
  });
  options.sort((a, b) => a.cost - b.cost);
  return options[0] ?? null;
}

/** The share of its drawn Isp a part type can deliver at best and worst: public, from the catalogue. */
export function ispRange(key: string): [number, number] | null {
  const { slot, option } = parsePartKey(key);
  if (slot === "injector") return INJECTORS[option as InjectorOption].isp;
  if (slot === "nozzle") return NOZZLES[option as NozzleOption].ispRange;
  return null;
}

export type RefineWorth = { design: string; deltaV: number; payload: number };

/**
 * What one more refinement is roughly worth on each design flying an engine
 * with the part: the extra Δv from REFINE.step more Isp on those stages, and
 * the payload that Δv would carry, from the rocket equation.
 */
export function refineWorth(company: Company, key: string): RefineWorth[] {
  const users = new Set(enginesUsing(company.campaign, key).map((e) => e.name));
  const total = (v: Vehicle) => idealDeltaV(v).reduce((a, b) => a + b, 0);
  const out: RefineWorth[] = [];
  for (const v of Object.values(company.designs)) {
    const dv = idealDeltaV(v);
    const gain = v.stages.reduce((sum, s, i) => sum + (users.has(s.engine.name) ? dv[i]! * REFINE.step : 0), 0);
    if (gain === 0) continue;
    // Δv lost per extra kg of payload, near the design's own payload.
    const perKg = (total(v) - total({ ...v, payloadMass: v.payloadMass + 10 })) / 10;
    out.push({ design: v.name, deltaV: gain, payload: perKg > 0 ? gain / perKg : 0 });
  }
  return out.sort((a, b) => b.deltaV - a.deltaV);
}
