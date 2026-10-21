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
  retuneSpec,
  tunnel,
  wait,
  type Company,
} from "./sim/company.ts";
import type { Contract } from "./sim/contracts.ts";
import { COSTS, vehicleCost } from "./sim/cost.ts";
import { holds, nextLicence, ORBITAL_FLIGHTS_NEEDED, requiredLicence, safeSpaceFlights } from "./sim/licence.ts";
import type { Engine } from "./sim/engine.ts";
import { FIXES, believedHardware, type Facility } from "./sim/teststand.ts";
import { believedAero, type AeroFacility } from "./sim/tunnel.ts";
import { burnTime } from "./sim/vehicle.ts";
import { generateBoard, startingCash } from "./contracts.ts";
import { SUBORBITAL_TEST } from "./missions.ts";
import { missionPlan } from "./sim/mission.ts";
import { STARTER_ENGINES, STARTERS } from "./starters.ts";
import { suggestBuilds, type Suggestion } from "./sim/guide.ts";
import { flownGnc } from "./sim/control.ts";
import { flightWindSeed, rollWind } from "./sim/wind.ts";
import { book, designSpec, runTask } from "./sim/schedule.ts";
import type { VehicleSpec } from "./sim/builder.ts";
import type { GncTest } from "./sim/gncTests.ts";
import { charterProblem, NETWORK, orderSatellites, paperCapacity, working } from "./sim/network.ts";

/**
 * Balance play-testing. Bots play whole company runs and report how they
 * end. A bot sees only what a player sees: test reports, the knowledge
 * they build, forecasts and the board. Never the hidden truth.
 *
 *   npm run playtest -- [--seeds 30] [--policy careful,cheap,reckless,greedy,designer,designer-fast,designer-reuse]
 *
 * Every bot starts with the drawn Pathfinder and Meridian (src/starters.ts),
 * which fly the full physics (built-up drag, shells, the attitude loop in
 * wind). careful and greedy also proof-test the shells and run the GNC
 * lab's three tests. The designer bots draw their own orbital rocket with
 * the sizing guide instead of flying the starting Meridian. "designer" also
 * proof-tests the shells and runs the GNC lab's three tests; "designer-fast"
 * only fires the engines and runs the tunnel, to show what the rest buys.
 * "designer-reuse" tests like "designer" and flies the guide's reusable
 * pick (a drone-ship landing) once it holds the rocket's cost and a cushion:
 * from the start if it can, else switching after first orbit. It turns
 * landed boosters around, overhauls them every fifth flight, retires the
 * worn, and stacks new upper stages on them.
 */

type Policy = "careful" | "cheap" | "reckless" | "greedy" | "designer" | "designer-fast" | "designer-reuse";

const designs = (p: Policy) => p === "designer" || p === "designer-fast" || p === "designer-reuse";
/** What each run's boosters did: landings, losses, reflights, and what building cost per flight. */
const fleetRuns: Array<{ landed: number; lost: number; reflown: number; buildPerFlight: number }> = [];
/** What lost each booster, over every run of a policy. */
const boosterLosses = new Map<string, number>();
/** Cash beyond the reusable rocket's build cost the bot wants before drawing one, $k: drawing, tests and slack. */
const REUSE_CUSHION = 6_000;
/** Days left in the run the reuse bot wants before it switches to a reusable rocket. */
const REUSE_RUNWAY = 365;
/** The reuse bot overhauls a booster every this many flights, and retires it this worn. */
const OVERHAUL_EVERY = 5;
const RETIRE_AT = 0.85;

/** Cash beyond a heavier rocket's build cost a bot wants before drawing it, $k: drawing, tests and slack. */
const MOVE_CUSHION = 4_000;
/** Each time a bot met era work its fleet couldn't carry: whether it drew a rocket for it, and if not why. */
const moveUps: Array<{ day: number; payload: number; drawn: boolean; why?: string }> = [];
/** Extra cash a bot keeps beyond a network charter or satellite order, $k. */
const NETWORK_CUSHION = 15_000;
/** What the networks did, over every run of a policy. */
const networkRuns = { batches: 0, deployed: 0, lost: 0, runs: [] as Array<{ chartered: number; service?: number; working: number; income: number; spent: number }> };

/** The day each run's market reached era 2 and era 3. */
const eraDays: Array<{ two?: number; three?: number }> = [];
/** Era work each run delivered. */
const eraDelivered: number[] = [];

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

/** How long a bot keeps playing, days. About two years, or --horizon. */
let HORIZON = 730;
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
  } catch (error) {
    if (process.env.GUARD_LOG) console.log(`      refused: ${(error as Error).message}`);
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
    const home = report.result.recovery;
    if (report.booster && home?.outcome !== "landed") {
      const why = home ? `${home.cause}${home.touchdown ? ` (${home.touchdown.speed.toFixed(1)} m/s, ${Math.round(home.touchdown.miss)} m)` : ""}` : "with the vehicle";
      const cause = why.replace(/ \(.*/, "");
      boosterLosses.set(cause, (boosterLosses.get(cause) ?? 0) + 1);
      if (verbose) console.log(`      booster lost: ${why}, heating ${((home?.peakHeating ?? 0) / 1e6).toFixed(1)} MW/m², left ${Math.round(home?.propellantLeft ?? 0)} kg`);
    }
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

/**
 * A designer bot's orbital rocket: the guide's balanced pick for the first
 * LEO job (or a reusable pick, given one), drawn up, then tested. Returns
 * its design key, or null.
 */
function drawOrbiter(company: Company, policy: Policy, job: Contract, reusable: Suggestion | null = null, name = "Orbiter"): string | null {
  let spec: VehicleSpec;
  if (reusable) spec = reusable.spec;
  else {
    const picks = suggestBuilds({ mission: job.mission, payloadMass: job.payloadMass }, company.campaign.engines, Object.values(company.designs), name);
    const balanced = picks.find((p) => p.label === "Balanced") ?? picks[0];
    if (!balanced) return null;
    spec = balanced.spec;
  }
  if (!guard(company, () => runTask(company, designSpec(company, { ...spec, name })))) return null;
  const key = Object.keys(company.designs).find((k) => company.designs[k]!.name === name);
  if (!key) return null;
  const v = company.designs[key]!;
  for (const [index, stage] of v.stages.entries()) {
    proveEngine(company, stage.engine, Math.ceil(burnTime(stage) * DURATION_MARGIN), index > 0 ? "altitude" : "sea-level");
  }
  proveShape(company, key, "transonic");
  if (thorough(policy)) proveBuild(company, key);
  return key;
}

/**
 * Book a newly drawn rocket's testing on the tracks without waiting for it:
 * its engines for the longer burns it asks, its shape in the transonic
 * tunnel, and for thorough bots its shells and GNC.
 */
function bookTests(company: Company, key: string, policy: Policy): void {
  const v = company.designs[key]!;
  v.stages.forEach((stage, index) => {
    const seconds = Math.ceil(burnTime(stage) * DURATION_MARGIN);
    if ((company.campaign.knowledge[stage.engine.name]?.provenDuration ?? 0) < seconds) {
      guard(company, () => book(company, { kind: "fire", engine: stage.engine.name, seconds, facility: index > 0 ? "altitude" : "sea-level", restart: false }));
    }
  });
  guard(company, () => book(company, { kind: "tunnel", design: key, facility: "transonic" }));
  if (thorough(policy)) {
    if (v.structure) guard(company, () => book(company, { kind: "proof", design: key }));
    if (v.control) for (const test of ["modal", "imu-cal", "hitl"] as GncTest[]) guard(company, () => book(company, { kind: "gnc", design: key, test }));
  }
}

/** Policies that also proof-test the shells and run the GNC lab's three tests. */
const thorough = (p: Policy) => p === "careful" || p === "greedy" || p === "designer" || p === "designer-reuse";

/** Proof-test a design's shells and run its GNC tests, tallying what they cost. */
function proveBuild(company: Company, key: string): void {
  const v = company.designs[key]!;
  const before = company.cash;
  if (v.structure) guard(company, () => runTask(company, { kind: "proof", design: key }));
  if (v.control) for (const test of ["modal", "imu-cal", "hitl"] as GncTest[]) guard(company, () => runTask(company, { kind: "gnc", design: key, test }));
  extraTests.push(before - company.cash);
}

function engineTests(company: Company, key: string, policy: Policy): boolean {
  const vehicle = company.designs[key]!;
  for (const [index, stage] of vehicle.stages.entries()) {
    const facility: Facility = index > 0 ? "altitude" : "sea-level";
    const seconds = policy === "cheap" ? 5 : Math.ceil(burnTime(stage) * DURATION_MARGIN);
    if (!proveEngine(company, stage.engine, seconds, facility)) return false;
  }
  return true;
}

function play(seed: number, policy: Policy): Outcome {
  const board = generateBoard(seed);
  const company = newCompany(seed, startingCash(seed), STARTERS, STARTER_ENGINES, board);
  const contract = (id: string) => board.find((c) => c.id === id)!;
  const testing = policy !== "reckless";
  let note = "";

  // Suborbital work first, for the reputation the LEO customers want. A
  // player presses on after a failure, so the bots do too.
  if (testing) {
    engineTests(company, "pathfinder", policy);
    proveShape(company, "pathfinder", policy === "cheap" ? "cfd" : "transonic");
    if (thorough(policy)) proveBuild(company, "pathfinder");
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
  if (!holds(company, "orbital")) note ||= "no orbital license";

  // The orbital rocket: the starting Meridian, or one the designer bots draw themselves.
  let orbiter = "meridian";
  let reusePick: Suggestion | null = null;
  // A reusable rocket drawn alongside the expendable one: it flies what it can carry, the expendable the rest.
  let reuser: string | null = null;
  if (designs(policy)) {
    // The reuse bot flies reusable from the start if it can afford to, else switches once it can.
    reusePick = policy === "designer-reuse" && !company.dead ? (suggestBuilds({ mission: contract("leo-150").mission, payloadMass: contract("leo-150").payloadMass, reuse: "drone-ship" }, company.campaign.engines, Object.values(company.designs), "Reuser")[0] ?? null) : null;
    const affordable = reusePick && company.cash >= reusePick.build.cost + REUSE_CUSHION;
    if (trace && reusePick) console.log(`    reuse: cash $${(company.cash / 1000).toFixed(2)}M, reusable pick $${(reusePick.build.cost / 1000).toFixed(2)}M at ${Math.round(reusePick.reuse!.reserve * 100)}%${affordable ? "" : ": expendable for now"}`);
    const drawn = company.dead ? null : affordable ? drawOrbiter(company, policy, contract("leo-150"), reusePick, "Reuser") : drawOrbiter(company, policy, contract("leo-150"));
    if (affordable) reusePick = null;
    if (drawn) orbiter = drawn;
    else note ||= "couldn't draw an orbiter";
  } else if (testing && !company.dead) {
    if (!engineTests(company, "meridian", policy)) note ||= "Meridian engines unproven";
    if (!proveShape(company, "meridian", policy === "cheap" ? "cfd" : "transonic")) note ||= "Meridian shape unproven";
    if (thorough(policy)) proveBuild(company, "meridian");
  }

  // Rockets drawn later for heavier work the market brings, cheapest first when flying.
  const movers: string[] = [];
  const fleet = () => [...(reuser ? [reuser] : []), orbiter, ...movers].sort((a, b) => vehicleCost(company.designs[a]!).cost - vehicleCost(company.designs[b]!).cost);
  const triedMove = new Set<string>();
  // A heavier rocket in the drawing office, by name.
  let drawing: string | null = null;

  // Orbital work until the horizon: bid on what's posted, wait for more,
  // and buy heritage with a demonstration flight if nobody will sign.
  const considered = new Set<string>();
  let demos = 0;
  while (!company.dead && company.day < HORIZON && holds(company, "orbital")) {
    // Switching to reuse costs a drawing and its tests: only worth it with a year left to fly it.
    if (reusePick && company.day > HORIZON - REUSE_RUNWAY) reusePick = null;
    if (reusePick && company.firstOrbitDay !== null && company.cash >= reusePick.build.cost + REUSE_CUSHION) {
      if (trace) console.log(`    reuse: day ${company.day}, cash $${(company.cash / 1000).toFixed(2)}M: drawing the reusable rocket`);
      reuser = drawOrbiter(company, policy, contract("leo-150"), reusePick, "Reuser");
      reusePick = null;
    }
    // Moving up: era work nothing in the fleet can carry gets a rocket of its own, if the company can afford
    // one. Drawing and testing it are booked on the tracks, as a player would, while the fleet keeps flying.
    if (testing && moveUp && !company.dead) {
      if (drawing) {
        const name = drawing;
        const key = Object.keys(company.designs).find((k) => company.designs[k]!.name === name);
        if (key) {
          bookTests(company, key, policy);
          movers.push(key);
          drawing = null;
        } else if (!company.tasks.some((t) => t.spec.kind === "design" && t.spec.vehicle.name === name)) drawing = null;
      }
      const job = drawing
        ? undefined
        : posted(company).find(
            (c) => (c.kind === "bus" || c.kind === "platform") && !triedMove.has(c.id) && !considered.has(c.id) && company.day + 150 < c.deadline && reputation(company) >= c.minReputation && missionPlan(c.mission).burns.length === 0,
          );
      if (job) {
        triedMove.add(job.id);
        // The forecast decides, not a design's drawn payload (Meridian lifts more than its 200 kg). No re-tune here:
        // the last stage steers to the orbit, and a re-tune costs three days for every rocket and every job looked at.
        const carries = fleet().some((k) => forecastDelivers(company, k, job));
        if (!carries) {
          const name = `Mover ${movers.length + 1}`;
          const picks = suggestBuilds({ mission: job.mission, payloadMass: job.payloadMass }, company.campaign.engines, Object.values(company.designs), name);
          const pick = picks.find((x) => x.label === "Balanced") ?? picks[0];
          if (pick && company.cash >= pick.build.cost + MOVE_CUSHION) {
            if (trace) console.log(`    move up: day ${company.day}, ${job.payloadMass} kg ${job.mission.name}, drawing a $${(pick.build.cost / 1000).toFixed(2)}M rocket`);
            const booked = guard(company, () => book(company, designSpec(company, { ...pick.spec, name })));
            if (booked) drawing = name;
            moveUps.push({ day: company.day, payload: job.payloadMass, drawn: booked });
          } else moveUps.push({ day: company.day, payload: job.payloadMass, drawn: false, why: pick ? "cash" : "no engine big enough" });
        }
      }
    }
    // The company's own network: charter it when affordable, keep satellites coming, fly full batches.
    if (testing && withNetwork && !company.dead) {
      if (!company.network && charterProblem(company) === null && !company.tasks.some((t) => t.spec.kind === "charter") && company.cash >= NETWORK.charter.cost + NETWORK_CUSHION) {
        guard(company, () => book(company, { kind: "charter" }));
      }
      const net = company.network;
      if (net) {
        const supply = working(net, company.day) + net.stored + net.orders.reduce((n, o) => n + o.count, 0);
        const want = Math.min(8, NETWORK.planned - supply);
        if (want > 0 && company.cash >= want * NETWORK.satCost + NETWORK_CUSHION) guard(company, () => orderSatellites(company, want));
        // The rocket that puts up the most satellites for its build cost.
        const best = fleet()
          .map((k) => ({ k, n: paperCapacity(company.designs[k]!) }))
          .filter((x) => x.n > 0)
          .sort((a, b) => b.n / vehicleCost(company.designs[b.k]!).cost - a.n / vehicleCost(company.designs[a.k]!).cost)[0];
        const short = NETWORK.planned - working(net, company.day);
        if (best && net.stored > 0 && net.stored >= Math.min(best.n, short)) {
          const n = Math.min(best.n, net.stored);
          guard(company, () => runTask(company, retuneSpec(company, best.k, { deploy: n })));
          if (order(company, best.k)) {
            const before = net.sats.length;
            flyAndCount(company, best.k, { deploy: n });
            networkRuns.batches += 1;
            networkRuns.deployed += net.sats.length - before;
            networkRuns.lost += n - (net.sats.length - before);
          }
          continue;
        }
      }
    }
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
        // The bots fly Meridian-class rockets; work that needs a parking orbit and relights needs a bigger design.
        missionPlan(c.mission).burns.length === 0 &&
        !considered.has(c.id) &&
        (policy === "greedy" || c.id !== "sso-150") &&
        fleet().some((k) => canSign(company, c, k)),
    );
    const next = wanted[0];
    if (!next) {
      const upcoming = board.filter((c) => c.postedDay > company.day).map((c) => c.postedDay);
      if (upcoming.length === 0) break;
      guard(company, () => wait(company, Math.min(...upcoming) - company.day));
      continue;
    }
    considered.add(next.id);
    // The reusable rocket first, if it can carry the job; the expendable one if not.
    const keys = fleet().filter((k) => canSign(company, next, k));
    let flyOn: string | null = keys[0] ?? null;
    if (testing) {
      flyOn = null;
      for (const k of keys) {
        guard(company, () => retune(company, k, next.id));
        // The re-tune takes days: the deadline may no longer be reachable.
        if (!canSign(company, next, k)) continue;
        const greedyBid = policy === "greedy" && next.id === "sso-150";
        if (greedyBid || forecastDelivers(company, k, next)) {
          flyOn = k;
          break;
        }
      }
    }
    if (flyOn) deliver(company, flyOn, next);
  }
  if (company.firstOrbitDay === null) note ||= "never reached orbit";

  if (trace) {
    const byCategory = new Map<string, number>();
    for (const e of company.ledger) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    console.log(`  seed ${seed} ${policy}: ${[...byCategory].map(([k, v]) => `${k} ${(v / 1000).toFixed(2)}M`).join(", ")}`);
    for (const f of company.flights) console.log(`    day ${f.day} ${f.design} ${f.mission}: ${f.outcome}${f.settlement ? ` (${f.settlement})` : ""}`);
    for (const [id, status] of Object.entries(company.closed)) if (status !== "delivered") console.log(`    contract ${id}: ${status}`);
    console.log(`    note: ${note || "-"}, license ${company.licence}, rep ${reputation(company)}`);
  }
  const flown = company.flights.filter((f) => f.design === company.designs[orbiter]?.name || (reuser !== null && f.design === company.designs[reuser]?.name));
  if (designs(policy) && flown.length > 0) {
    const building = -company.ledger.filter((e) => e.category === "build").reduce((s, e) => s + e.amount, 0);
    fleetRuns.push({
      landed: flown.filter((f) => f.booster?.landed).length,
      lost: flown.filter((f) => f.booster && !f.booster.landed).length,
      reflown: flown.filter((f) => (f.booster?.flight ?? 0) > 1).length,
      buildPerFlight: building / company.flights.length,
    });
  }
  eraDays.push({ two: company.market?.since[2], three: company.market?.since[3] });
  if (company.network) {
    const sum = (cat: string) => company.ledger.filter((e) => e.category === cat).reduce((a, e) => a + e.amount, 0);
    networkRuns.runs.push({ chartered: company.network.charteredDay, service: company.network.serviceDay, working: working(company.network, company.day), income: sum("network"), spent: -sum("satellites") });
  }
  eraDelivered.push(company.board.filter((c) => (c.kind === "bus" || c.kind === "platform") && company.closed[c.id] === "delivered").length);
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
/** --no-move: bots never draw a heavier rocket for era work, to compare against moving up. */
const moveUp = !args.includes("--no-move");
/** --network: testing bots charter the company's own network at era 2 and keep it supplied. */
const withNetwork = args.includes("--network");
if (option("--horizon")) HORIZON = Number(option("--horizon"));
const trace = args.includes("--trace");
const only = option("--seed");

for (const policy of policies) {
  losses.clear();
  extraTests.length = 0;
  fleetRuns.length = 0;
  moveUps.length = 0;
  eraDays.length = 0;
  Object.assign(networkRuns, { batches: 0, deployed: 0, lost: 0, runs: [] });
  eraDelivered.length = 0;
  boosterLosses.clear();
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
  if (networkRuns.runs.length > 0) {
    const r = networkRuns.runs;
    const served = r.filter((x) => x.service !== undefined);
    console.log(
      `  network: chartered in ${r.length} runs (median day ${median(r.map((x) => x.chartered))}), in service in ${served.length} (median day ${median(served.map((x) => x.service!))}); ${networkRuns.batches} batches, ${networkRuns.deployed} satellites up, ${networkRuns.lost} lost at launch; median at the end ${median(r.map((x) => x.working))} working, income $${(median(r.map((x) => x.income)) / 1000).toFixed(1)}M against $${(median(r.map((x) => x.spent)) / 1000).toFixed(1)}M on satellites and operations`,
    );
  }
  {
    const two = eraDays.filter((e) => e.two !== undefined).map((e) => e.two!);
    const three = eraDays.filter((e) => e.three !== undefined).map((e) => e.three!);
    const why = new Map<string, number>();
    for (const m of moveUps) if (!m.drawn) why.set(m.why ?? "draw failed", (why.get(m.why ?? "draw failed") ?? 0) + 1);
    console.log(
      `  market: era 2 in ${two.length} runs (median day ${median(two)}), era 3 in ${three.length} (median day ${median(three)}); era work delivered ${eraDelivered.reduce((a, b) => a + b, 0)}; heavier rockets drawn ${moveUps.filter((m) => m.drawn).length}${why.size > 0 ? ` (skipped: ${[...why].map(([w, k]) => `${w} ×${k}`).join(", ")})` : ""}`,
    );
  }
  if (fleetRuns.length > 0) {
    const sum = (f: (r: (typeof fleetRuns)[number]) => number) => fleetRuns.reduce((s, r) => s + f(r), 0);
    if (sum((r) => r.landed + r.lost) > 0) console.log(`  boosters: landed ${sum((r) => r.landed)} of ${sum((r) => r.landed + r.lost)}, ${sum((r) => r.reflown)} flights on a flown booster`);
    if (boosterLosses.size > 0) console.log(`  boosters lost: ${[...boosterLosses].map(([n, k]) => `${n} ×${k}`).join(", ")}`);
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
