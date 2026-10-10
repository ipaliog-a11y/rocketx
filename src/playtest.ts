import { aeroShape } from "./sim/airframe.ts";
import { simulateAscent } from "./sim/ascent.ts";
import {
  accept,
  build,
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
import { COSTS, vehicleCost } from "./sim/cost.ts";
import type { Engine } from "./sim/engine.ts";
import { FIXES, believedHardware, type Facility } from "./sim/teststand.ts";
import { believedAero, type AeroFacility } from "./sim/tunnel.ts";
import { burnTime } from "./sim/vehicle.ts";
import { generateBoard, startingCash } from "./contracts.ts";
import { ENGINES, VEHICLES } from "./vehicles.ts";

/**
 * Balance play-testing. Bots play whole company runs and report how they
 * end. A bot sees only what a player sees: test reports, the knowledge
 * they build, forecasts and the board. Never the hidden truth.
 *
 *   npm run playtest -- [--seeds 30] [--policy careful,cheap,reckless,greedy]
 */

type Policy = "careful" | "cheap" | "reckless" | "greedy";

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
    const shapeKnown = company.campaign.aeroKnowledge[aeroShape(VEHICLES[key]!).key];
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
  const { days } = vehicleCost(VEHICLES[key]!);
  const open = !company.accepted.includes(contract.id) && !company.closed[contract.id];
  const onTime = company.day + days + COSTS.padDays <= contract.deadline;
  const clean = !company.record.some((r) => contract.refuses.includes(r.tag));
  return open && onTime && clean && reputation(company) >= contract.minReputation;
}

/** Sign, build and fly one contract. */
function deliver(company: Company, key: string, contract: Contract): boolean {
  if (!guard(company, () => accept(company, contract.id))) return false;
  if (!guard(company, () => build(company, key))) return false;
  return guard(company, () => fly(company, key, { contract: contract.id }));
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
  for (const id of ["sounding", "microgravity"]) {
    const c = contract(id);
    if (reputation(company) >= 1 || !canSign(company, c, "pathfinder")) continue;
    if (testing && !forecastDelivers(company, "pathfinder", c)) continue;
    deliver(company, "pathfinder", c);
  }

  if (testing && !company.dead) {
    if (!engineTests(company, "meridian", policy)) note ||= "Meridian engines unproven";
    if (!proveShape(company, "meridian", policy === "cheap" ? "cfd" : "transonic")) note ||= "Meridian shape unproven";
  }

  // Orbital work until the horizon: bid on what's posted, wait for more,
  // and buy heritage with a demonstration flight if nobody will sign.
  const considered = new Set<string>();
  let demos = 0;
  while (!company.dead && company.day < HORIZON) {
    if (reputation(company) < 1) {
      if (demos >= MAX_DEMOS) break;
      demos += 1;
      note ||= "needed a demonstration flight";
      const leo = contract("leo-150");
      if (testing) guard(company, () => retune(company, "meridian", leo.id));
      if (guard(company, () => build(company, "meridian"))) guard(company, () => fly(company, "meridian", { mission: leo.mission }));
      continue;
    }
    const wanted = posted(company).filter(
      (c) =>
        c.minApogee === undefined &&
        !considered.has(c.id) &&
        (policy === "greedy" || c.id !== "sso-150") &&
        canSign(company, c, "meridian"),
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
      guard(company, () => retune(company, "meridian", next.id));
      const greedyBid = policy === "greedy" && next.id === "sso-150";
      if (!greedyBid && !forecastDelivers(company, "meridian", next)) continue;
    }
    deliver(company, "meridian", next);
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
  if (verbose) {
    for (const r of runs) {
      console.log(
        `    seed ${String(r.seed).padStart(2)} ${r.alive ? "alive" : "DEAD "} orbit ${String(r.firstOrbitDay ?? "-").padStart(4)} day ${String(r.day).padStart(4)} cash ${(r.cash / 1000).toFixed(1).padStart(6)}M delivered ${r.delivered} failed ${r.failed} ${r.note}`,
      );
    }
  }
  console.log("");
}
