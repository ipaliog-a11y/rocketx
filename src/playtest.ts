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
  readyBoosters,
  refusesFlightProven,
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
import { flownGnc } from "./sim/control.ts";
import { flightWindSeed, rollWind } from "./sim/wind.ts";
import { book, designSpec, runTask } from "./sim/schedule.ts";
import { assembleVehicle, fitControl, type VehicleSpec } from "./sim/builder.ts";
import { landingMargin } from "./sim/landing.ts";
import { defaultRecovery } from "./sim/recovery.ts";
import type { GncTest } from "./sim/gncTests.ts";

/**
 * Balance play-testing. Bots play whole company runs and report how they
 * end. A bot sees only what a player sees: test reports, the knowledge
 * they build, forecasts and the board. Never the hidden truth.
 *
 *   npm run playtest -- [--seeds 30] [--policy careful,cheap,reckless,greedy,designer,designer-fast,designer-reuse]
 *
 * The designer bots draw their own orbital rocket with the sizing guide
 * instead of flying the preset Meridian, so they play on the new physics
 * (built-up drag, shells, the attitude loop in wind). "designer" also
 * proof-tests the shells and runs the GNC lab's three tests; "designer-fast"
 * only fires the engines and runs the tunnel, to show what the rest buys.
 * "designer-reuse" tests like "designer" and lands its booster on a drone
 * ship: the least reserve that comes home with margin. It turns landed
 * boosters around, overhauls them every fifth flight, retires the worn,
 * and stacks new upper stages on them.
 */

type Policy = "careful" | "cheap" | "reckless" | "greedy" | "designer" | "designer-fast" | "designer-reuse";

const designs = (p: Policy) => p === "designer" || p === "designer-fast" || p === "designer-reuse";
/** What each run's boosters did: landings, losses, reflights, and what building cost per flight. */
const fleetRuns: Array<{ landed: number; lost: number; reflown: number; buildPerFlight: number }> = [];
/** Landing margin the reuse bot wants on paper, m/s, and what it wants left in the last stage at orbit, as a share of its propellant. */
const LANDING_MARGIN = 150;
const ASCENT_MARGIN = 0.04;
/** The reuse bot overhauls a booster every this many flights, and retires it this worn. */
const OVERHAUL_EVERY = 5;
const RETIRE_AT = 0.85;

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

const board = (company: Company, id: string) => company.board.find((c) => c.id === id)!;

/** What the company's forecast flies for this contract. */
function forecastResult(company: Company, key: string, contract: Contract) {
  const vehicle = { ...company.designs[key]!, payloadMass: contract.payloadMass };
  return simulateAscent(vehicle, contract.mission, {
    hardware: believedHardware(company.campaign),
    aero: believedAero(company.campaign),
  });
}

/** The company's forecast for this contract: does it deliver? */
function forecastDelivers(company: Company, key: string, contract: Contract): boolean {
  const result = forecastResult(company, key, contract);
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
    const before = trace && "contract" in target ? forecastResult(company, key, board(company, target.contract)) : null;
    const report = fly(company, key, target);
    hangar(company);
    if (before) {
      const v = company.designs[key]!;
      const shape = aeroShape(v).key;
      const f = (r: typeof report.result) => `${r.outcome} burnout ${(r.summary.burnoutVelocity / 1000).toFixed(2)} km/s at ${(r.summary.burnoutAltitude / 1000).toFixed(0)} km, prop ${r.summary.propellantMargin.toFixed(0)} kg, losses ${Object.values(r.summary.losses).map((x) => x.toFixed(0)).join("/")}`;
      console.log(`    forecast: ${f(before)}\n    flown:    ${f(report.result)}`);
      console.log(`    aero truth ${JSON.stringify(company.campaign.aeroTruth[shape])} known ${JSON.stringify(company.campaign.aeroKnowledge[shape] && { d: company.campaign.aeroKnowledge[shape]!.dragFactor, s: company.campaign.aeroKnowledge[shape]!.supersonicFactor })}`);
      const c = board(company, (target as { contract: string }).contract);
      const veh = { ...v, payloadMass: c.payloadMass };
      const base = { hardware: company.campaign.truth, aero: company.campaign.aeroTruth, structure: company.campaign.structureTruth };
      const wind = rollWind(flightWindSeed(company.seed, company.flights.length - 1));
      const gt = company.campaign.gncTruth?.[v.name];
      const gnc = v.control && gt ? { [v.name]: flownGnc(v.control, gt, company.campaign.gncKnowledge?.[v.name]) } : undefined;
      for (const [label, o] of [["truth", base], ["+wind", { ...base, wind }], ["+gnc", { ...base, gnc }], ["believed+wind", { hardware: believedHardware(company.campaign), aero: believedAero(company.campaign), wind }]] as const) {
        console.log(`    ${label}: ${f(simulateAscent(veh, c.mission, o as Parameters<typeof simulateAscent>[2]))}`);
      }
      console.log(`    isp truth ${v.stages.map((st) => company.campaign.truth[st.engine.name]?.ispFactor.toFixed(3)).join("/")} known ${v.stages.map((st) => company.campaign.knowledge[st.engine.name]?.measuredIspFactor?.toFixed(3)).join("/")}`);
    }
    const lost = report.result.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure" || e.kind === "loss-of-control");
    if (lost) {
      const why = lost.cause ?? lost.mode ?? lost.kind;
      losses.set(why, (losses.get(why) ?? 0) + 1);
    }
  });
}

/** Order a vehicle: on a booster back from the hangar when there is one and the customer will fly it. */
function order(company: Company, key: string, contract?: Contract): boolean {
  const ready = readyBoosters(company, key)[0];
  const proven = ready && !(contract && refusesFlightProven(company, contract));
  return guard(company, () => build(company, key, proven ? { booster: ready.serial } : {}));
}

/** Landed boosters into the hangar: a turnaround, an overhaul every fifth flight, retirement once worn out. */
function hangar(company: Company): void {
  for (const b of company.boosters ?? []) {
    if (b.status !== "flown" || company.tasks.some((t) => t.spec.kind === "refurb" && t.spec.serial === b.serial)) continue;
    if ((b.inspected?.share ?? 0) >= RETIRE_AT) {
      b.status = "retired";
      continue;
    }
    guard(company, () => book(company, { kind: "refurb", serial: b.serial, depth: b.flights % OVERHAUL_EVERY === 0 ? "overhaul" : "turnaround" }));
  }
}

/** Sign, build and fly one contract. */
function deliver(company: Company, key: string, contract: Contract): boolean {
  if (!guard(company, () => accept(company, contract.id))) return false;
  if (!order(company, key, contract)) return false;
  return flyAndCount(company, key, { contract: contract.id });
}

/** The least reserve that brings the booster home with margin, on paper, with the job's payload still in orbit. */
function withLanding(company: Company, spec: VehicleSpec, job: Contract): VehicleSpec | null {
  for (let reserve = 0.1; reserve <= 0.3 + 1e-9; reserve += 0.02) {
    const s = fitControl({ ...spec, geometry: { ...spec.geometry!, recovery: { ...defaultRecovery("drone-ship"), reserve: Math.round(reserve * 100) / 100 } } }, company.campaign.engines);
    try {
      const v = { ...assembleVehicle(s, company.campaign.engines), payloadMass: job.payloadMass };
      const m = landingMargin(v, job.mission);
      // The reserve comes out of the ascent's margin: keep as much as the guide asks for.
      if (m && m.ascent === "orbit" && m.ascentMargin < ASCENT_MARGIN * v.stages.at(-1)!.propellantMass) return null;
      if (m && m.ascent === "orbit" && m.deltaV >= LANDING_MARGIN) return s;
      // More reserve only stages it lower: past an ascent it can't fly, give up.
      if (m && m.ascent === "failure") return null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * A designer bot's orbital rocket: the guide's balanced pick for the first
 * LEO job, drawn up, then tested. Returns its design key, or null.
 */
function drawOrbiter(company: Company, policy: Policy, job: Contract): string | null {
  const picks = suggestBuilds({ mission: job.mission, payloadMass: job.payloadMass }, company.campaign.engines, Object.values(company.designs), "Orbiter");
  const balanced = picks.find((p) => p.label === "Balanced") ?? picks[0];
  if (!balanced) return null;
  let spec: VehicleSpec = balanced.spec;
  if (policy === "designer-reuse") {
    // The balanced stack if it can spare the reserve, else a bigger one that can.
    const ordered = [balanced, ...picks.filter((p) => p !== balanced)];
    spec = ordered.map((p) => withLanding(company, p.spec, job)).find((s) => s !== null) ?? balanced.spec;
  }
  if (!guard(company, () => runTask(company, designSpec(company, { ...spec, name: "Orbiter" })))) return null;
  const key = Object.keys(company.designs).find((k) => company.designs[k]!.name === "Orbiter");
  if (!key) return null;
  const v = company.designs[key]!;
  for (const [index, stage] of v.stages.entries()) {
    proveEngine(company, stage.engine, Math.ceil(burnTime(stage) * DURATION_MARGIN), index > 0 ? "altitude" : "sea-level");
  }
  proveShape(company, key, "transonic");
  if (policy === "designer" || policy === "designer-reuse") {
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
  if (designs(policy)) {
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
      if (order(company, orbiter)) flyAndCount(company, orbiter, { mission: leo.mission });
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

  if (trace) {
    const byCategory = new Map<string, number>();
    for (const e of company.ledger) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    console.log(`  seed ${seed} ${policy}: ${[...byCategory].map(([k, v]) => `${k} ${(v / 1000).toFixed(2)}M`).join(", ")}`);
    for (const f of company.flights) console.log(`    day ${f.day} ${f.design} ${f.mission}: ${f.outcome}${f.settlement ? ` (${f.settlement})` : ""}`);
    for (const [id, status] of Object.entries(company.closed)) if (status !== "delivered") console.log(`    contract ${id}: ${status}`);
    console.log(`    note: ${note || "-"}, licence ${company.licence}, rep ${reputation(company)}`);
  }
  const flown = company.flights.filter((f) => f.design === company.designs[orbiter]?.name);
  if (designs(policy) && flown.length > 0) {
    const building = -company.ledger.filter((e) => e.category === "build").reduce((s, e) => s + e.amount, 0);
    fleetRuns.push({
      landed: flown.filter((f) => f.booster?.landed).length,
      lost: flown.filter((f) => f.booster && !f.booster.landed).length,
      reflown: flown.filter((f) => (f.booster?.flight ?? 0) > 1).length,
      buildPerFlight: building / company.flights.length,
    });
  }
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
const trace = args.includes("--trace");
const only = option("--seed");

for (const policy of policies) {
  losses.clear();
  extraTests.length = 0;
  fleetRuns.length = 0;
  const runs: Outcome[] = [];
  for (let seed = 1; seed <= seeds; seed++) if (!only || Number(only) === seed) runs.push(play(seed, policy));
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
  if (fleetRuns.length > 0) {
    const sum = (f: (r: (typeof fleetRuns)[number]) => number) => fleetRuns.reduce((s, r) => s + f(r), 0);
    if (sum((r) => r.landed + r.lost) > 0) console.log(`  boosters: landed ${sum((r) => r.landed)} of ${sum((r) => r.landed + r.lost)}, ${sum((r) => r.reflown)} flights on a flown booster`);
    console.log(`  building and the hangar: median $${(median(fleetRuns.map((r) => r.buildPerFlight)) / 1000).toFixed(2)}M a flight`);
  }
  if (verbose) {
    for (const r of runs) {
      console.log(
        `    seed ${String(r.seed).padStart(2)} ${r.alive ? "alive" : "DEAD "} orbit ${String(r.firstOrbitDay ?? "-").padStart(4)} day ${String(r.day).padStart(4)} cash ${(r.cash / 1000).toFixed(1).padStart(6)}M delivered ${r.delivered} failed ${r.failed} ${r.note}`,
      );
    }
  }
  console.log("");
}
