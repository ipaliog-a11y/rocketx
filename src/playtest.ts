import { aeroShape } from "./sim/airframe.ts";
import { simulateAscent } from "./sim/ascent.ts";
import {
  accept,
  applyForLicence,
  build,
  buildDays,
  objectionTo,
  fire,
  fixAero,
  fixEngine,
  fly,
  newCompany,
  posted,
  reputation,
  retune,
  tunnel,
  wait,
  type Company,
} from "./sim/company.ts";
import type { Contract } from "./sim/contracts.ts";
import { COSTS } from "./sim/cost.ts";
import { holds, nextLicence, ORBITAL_FLIGHTS_NEEDED, requiredLicence, safeSpaceFlights } from "./sim/licence.ts";
import type { Engine } from "./sim/engine.ts";
import { FIXES, believedHardware, type Facility } from "./sim/teststand.ts";
import { believedAero, type AeroFacility } from "./sim/tunnel.ts";
import { burnTime } from "./sim/vehicle.ts";
import { generateBoard, startingCash } from "./contracts.ts";
import { SUBORBITAL_TEST } from "./missions.ts";
import { missionPlan } from "./sim/mission.ts";
import { ENGINES, VEHICLES } from "./vehicles.ts";
import { suggestBuilds } from "./sim/guide.ts";
import { designSpec, runTask } from "./sim/schedule.ts";
import type { GncTest } from "./sim/gncTests.ts";

/**
 * Balance play-testing. Bots play whole company runs and report how they
 * end. A bot sees only what a player sees: test reports, the knowledge
 * they build, forecasts and the board. Never the hidden truth.
 *
 *   npm run playtest -- [--seeds 30] [--policy careful,cheap,reckless,greedy,designer,designer-fast]
 *
 * The designer bots draw their own orbital rocket with the sizing guide
 * instead of flying the preset Meridian, so they play on the new physics
 * (built-up drag, shells, the attitude loop in wind). "designer" also
 * proof-tests the shells and runs the GNC lab's three tests; "designer-fast"
 * only fires the engines and runs the tunnel, to show what the rest buys.
 */

type Policy = "careful" | "cheap" | "reckless" | "greedy" | "designer" | "designer-fast";

/** What lost each flight, over every run of a policy. */
const losses = new Map<string, number>();
/** What the designer bots spent on proof and GNC tests, $k, per run. */
const extraTests: number[] = [];

type Outcome = {
  seed: number;
  alive: boolean;
  firstOrbitDay: number | null;
  day: number;
  cash: number;
  delivered: number;
  failed: number;
  note: string;
};

/** How long a bot keeps playing, days. About two years. */
const HORIZON = 730;
/** Demonstration flights a bot will pay for before giving up on heritage. */
const MAX_DEMOS = 2;

/** Fire past the flight burn by this much, so the burn itself is proven. */
const DURATION_MARGIN = 1.1;
const MAX_ATTEMPTS = 4;

function guard(company: Company, act: () => unknown): boolean {
  if (company.dead) return false;
  try {
    act();
    return !company.dead;
  } catch {
    return false;
  }
}

/** Fire until a clean firing of the requested length, fixing whatever turns up. */
function proveEngine(company: Company, engine: Engine, seconds: number, facility: Facility): boolean {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (!guard(company, () => fire(company, engine, seconds, facility))) return false;
    const known = company.campaign.knowledge[engine.name]!;
    const fixable = known.open.filter((m) => FIXES[m]);
    if (known.open.length > fixable.length) return false;
    if (fixable.length === 0 && known.provenDuration >= seconds) return true;
    for (const mode of fixable) if (!guard(company, () => fixEngine(company, engine, mode))) return false;
  }
  return false;
}

function proveShape(company: Company, key: string, facility: AeroFacility): boolean {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (!guard(company, () => tunnel(company, key, facility))) return false;
    const shapeKnown = company.campaign.aeroKnowledge[aeroShape(company.designs[key]!).key];
    if (!shapeKnown?.open.includes("transonic-buffet")) return true;
    if (!guard(company, () => fixAero(company, key, "transonic-buffet"))) return false;
  }
  return false;
}

/** The company's forecast for this contract: does it deliver? */
function forecastDelivers(company: Company, key: string, contract: Contract): boolean {
  const vehicle = { ...company.designs[key]!, payloadMass: contract.payloadMass };
  const result = simulateAscent(vehicle, contract.mission, {
    hardware: believedHardware(company.campaign),
    aero: believedAero(company.campaign),
  });
  if (contract.minApogee !== undefined) return result.outcome === "apogee" && result.summary.apogee >= contract.minApogee * 1.05;
  return result.summary.insertion?.inSpec ?? false;
}

function canSign(company: Company, contract: Contract, key: string): boolean {
  const days = buildDays(company, key);
  const open = !company.accepted.includes(contract.id) && !company.closed[contract.id];
  const onTime = company.day + days + COSTS.padDays <= contract.deadline;
  const clean = !objectionTo(company, contract);
  const licensed = holds(company, requiredLicence(contract));
  return open && onTime && clean && licensed && reputation(company) >= contract.minReputation;
}

/** Fly, and tally what lost the vehicle if it was lost. */
function flyAndCount(company: Company, key: string, target: Parameters<typeof fly>[2]): boolean {
  return guard(company, () => {
    const report = fly(company, key, target);
    const lost = report.result.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure" || e.kind === "loss-of-control");
    if (lost) {
      const why = lost.cause ?? lost.mode ?? lost.kind;
      losses.set(why, (losses.get(why) ?? 0) + 1);
    }
  });
}

/** Sign, build and fly one contract. */
function deliver(company: Company, key: string, contract: Contract): boolean {
  if (!guard(company, () => accept(company, contract.id))) return false;
  if (!guard(company, () => build(company, key))) return false;
  return flyAndCount(company, key, { contract: contract.id });
}

/**
 * A designer bot's orbital rocket: the guide's balanced pick for the first
 * LEO job, drawn up, then tested. Returns its design key, or null.
 */
function drawOrbiter(company: Company, policy: Policy, job: Contract): string | null {
  const picks = suggestBuilds({ mission: job.mission, payloadMass: job.payloadMass }, company.campaign.engines, Object.values(company.designs), "Orbiter");
  const pick = picks.find((p) => p.label === "Balanced") ?? picks[0];
  if (!pick) return null;
  if (!guard(company, () => runTask(company, designSpec(company, { ...pick.spec, name: "Orbiter" })))) return null;
  const key = Object.keys(company.designs).find((k) => company.designs[k]!.name === "Orbiter");
  if (!key) return null;
  const v = company.designs[key]!;
  for (const [index, stage] of v.stages.entries()) {
    proveEngine(company, stage.engine, Math.ceil(burnTime(stage) * DURATION_MARGIN), index > 0 ? "altitude" : "sea-level");
  }
  proveShape(company, key, "transonic");
  if (policy === "designer") {
    const before = company.cash;
    if (v.structure) guard(company, () => runTask(company, { kind: "proof", design: key }));
    if (v.control) for (const test of ["modal", "imu-cal", "hitl"] as GncTest[]) guard(company, () => runTask(company, { kind: "gnc", design: key, test }));
    extraTests.push(before - company.cash);
  }
  return key;
}

function engineTests(company: Company, key: string, policy: Policy): boolean {
  const vehicle = VEHICLES[key]!;
  for (const [index, stage] of vehicle.stages.entries()) {
    const facility: Facility = index > 0 ? "altitude" : "sea-level";
    const seconds = policy === "cheap" ? 5 : Math.ceil(burnTime(stage) * DURATION_MARGIN);
    if (!proveEngine(company, stage.engine, seconds, facility)) return false;
  }
  return true;
}

function play(seed: number, policy: Policy): Outcome {
  const board = generateBoard(seed);
  const company = newCompany(seed, startingCash(seed), VEHICLES, Object.values(ENGINES), board);
  const contract = (id: string) => board.find((c) => c.id === id)!;
  const testing = policy !== "reckless";
  let note = "";

  // Suborbital work first, for the reputation the LEO customers want. A
  // player presses on after a failure, so the bots do too.
  if (testing) {
    engineTests(company, "pathfinder", policy);
    proveShape(company, "pathfinder", policy === "cheap" ? "cfd" : "transonic");
  }
  // Suborbital work until the regulator will grant an orbital licence and
  // LEO customers will sign: sounding contracts when the board has them, a
  // test flight when it doesn't.
  const sounding = () =>
    posted(company).find((c) => c.minApogee !== undefined && canSign(company, c, "pathfinder") && (!testing || forecastDelivers(company, "pathfinder", c)));
  for (let tries = 0; tries < 6 && !company.dead; tries++) {
    const licensable = safeSpaceFlights(company) >= ORBITAL_FLIGHTS_NEEDED;
    if (licensable && reputation(company) >= 1) break;
    const c = sounding();
    if (c) deliver(company, "pathfinder", c);
    else if (!licensable) {
      if (guard(company, () => build(company, "pathfinder"))) guard(company, () => fly(company, "pathfinder", { mission: SUBORBITAL_TEST }));
    } else break;
  }
  if (nextLicence(company, reputation(company))?.ready) guard(company, () => applyForLicence(company));
  if (!holds(company, "orbital")) note ||= "no orbital licence";

  // The orbital rocket: the preset Meridian, or one the designer bots draw themselves.
  let orbiter = "meridian";
  if (policy === "designer" || policy === "designer-fast") {
    const drawn = company.dead ? null : drawOrbiter(company, policy, contract("leo-150"));
    if (drawn) orbiter = drawn;
    else note ||= "couldn't draw an orbiter";
  } else if (testing && !company.dead) {
    if (!engineTests(company, "meridian", policy)) note ||= "Meridian engines unproven";
    if (!proveShape(company, "meridian", policy === "cheap" ? "cfd" : "transonic")) note ||= "Meridian shape unproven";
  }

  // Orbital work until the horizon: bid on what's posted, wait for more,
  // and buy heritage with a demonstration flight if nobody will sign.
  const considered = new Set<string>();
  let demos = 0;
  while (!company.dead && company.day < HORIZON && holds(company, "orbital")) {
    if (reputation(company) < 1) {
      if (demos >= MAX_DEMOS) break;
      demos += 1;
      note ||= "needed a demonstration flight";
      const leo = contract("leo-150");
      if (testing) guard(company, () => retune(company, orbiter, leo.id));
      if (guard(company, () => build(company, orbiter))) flyAndCount(company, orbiter, { mission: leo.mission });
      continue;
    }
    const wanted = posted(company).filter(
      (c) =>
        c.minApogee === undefined &&
        c.kind !== "crew" &&
        // The bots fly the preset Meridian; work that needs a parking orbit and relights needs a bigger design.
        missionPlan(c.mission).burns.length === 0 &&
        !considered.has(c.id) &&
        (policy === "greedy" || c.id !== "sso-150") &&
        canSign(company, c, orbiter),
    );
    const next = wanted[0];
    if (!next) {
      const upcoming = board.filter((c) => c.postedDay > company.day).map((c) => c.postedDay);
      if (upcoming.length === 0) break;
      guard(company, () => wait(company, Math.min(...upcoming) - company.day));
      continue;
    }
    considered.add(next.id);
    if (testing) {
      guard(company, () => retune(company, orbiter, next.id));
      const greedyBid = policy === "greedy" && next.id === "sso-150";
      if (!greedyBid && !forecastDelivers(company, orbiter, next)) continue;
    }
    deliver(company, orbiter, next);
  }
  if (company.firstOrbitDay === null) note ||= "never reached orbit";

  const statuses = Object.values(company.closed);
  return {
    seed,
    alive: !company.dead,
    firstOrbitDay: company.firstOrbitDay,
    day: company.day,
    cash: company.cash,
    delivered: statuses.filter((s) => s === "delivered").length,
    failed: statuses.filter((s) => s === "failed" || s === "late").length,
    note: company.dead ? "bankrupt" : note,
  };
}

const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const seeds = Number(option("--seeds") ?? 30);
const policies = (option("--policy") ?? "careful,cheap,reckless,greedy").split(",") as Policy[];
const verbose = args.includes("--verbose");

for (const policy of policies) {
  losses.clear();
  extraTests.length = 0;
  const runs: Outcome[] = [];
  for (let seed = 1; seed <= seeds; seed++) runs.push(play(seed, policy));
  const orbit = runs.filter((r) => r.firstOrbitDay !== null);
  const notes = new Map<string, number>();
  for (const r of runs) if (r.note) notes.set(r.note, (notes.get(r.note) ?? 0) + 1);
  console.log(`${policy.toUpperCase()} over ${seeds} seeds`);
  console.log(`  alive ${runs.filter((r) => r.alive).length}, reached orbit ${orbit.length}`);
  console.log(`  median first orbit day ${median(orbit.map((r) => r.firstOrbitDay!))}, median end day ${median(runs.map((r) => r.day))}`);
  console.log(`  median end cash $${(median(runs.map((r) => r.cash)) / 1000).toFixed(1)}M, deliveries ${runs.reduce((s, r) => s + r.delivered, 0)}, failed or late ${runs.reduce((s, r) => s + r.failed, 0)}`);
  console.log(`  ${[...notes].map(([n, k]) => `${n}: ${k}`).join("; ")}`);
  if (losses.size > 0) console.log(`  vehicles lost: ${[...losses].map(([n, k]) => `${n} ×${k}`).join(", ")}`);
  if (extraTests.length > 0) console.log(`  proof and GNC tests: median $${median(extraTests).toFixed(0)}k a run`);
  if (verbose) {
    for (const r of runs) {
      console.log(
        `    seed ${String(r.seed).padStart(2)} ${r.alive ? "alive" : "DEAD "} orbit ${String(r.firstOrbitDay ?? "-").padStart(4)} day ${String(r.day).padStart(4)} cash ${(r.cash / 1000).toFixed(1).padStart(6)}M delivered ${r.delivered} failed ${r.failed} ${r.note}`,
      );
    }
  }
  console.log("");
}
