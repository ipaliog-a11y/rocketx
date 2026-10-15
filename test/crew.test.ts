import assert from "node:assert/strict";
import { test } from "node:test";
import { aeroShape, IDEAL_AERO } from "../src/sim/airframe.ts";
import { simulateAscent } from "../src/sim/ascent.ts";
import { accept, build, fly, LOSS_OF_CREW, newCompany, reputation, type Company } from "../src/sim/company.ts";
import { abortOutcome, CAPSULE, crewRating, MAX_Q_ABORT, newCapsule, withCapsule } from "../src/sim/crew.ts";
import { IDEAL_TRUTH } from "../src/sim/hardware.ts";
import { nextLicence } from "../src/sim/licence.ts";
import { assembleEngine } from "../src/sim/parts.ts";
import { book, runTask } from "../src/sim/schedule.ts";
import { suggestBuilds } from "../src/sim/guide.ts";
import { retunePitch } from "../src/sim/tuning.ts";
import { generateBoard } from "../src/contracts.ts";
import { circular } from "../src/missions.ts";
import { ENGINES, MERIDIAN, PATHFINDER, VEHICLES } from "../src/vehicles.ts";

const GG = { cycle: "gas-generator", injector: "coaxial", cooling: "film" } as const;
const HEAVY = [assembleEngine({ ...GG, size: 600, nozzle: "sea-level" }, "Condor-600"), assembleEngine({ ...GG, size: 250, nozzle: "large-vacuum" }, "Osprey-250-XV")];
const STATION = circular(400, 51.6);
const typical = { ...IDEAL_TRUTH, ispFactor: 0.975 };

/** A company with the orbital licence and a heavy-lift design sized and tuned for the capsule. Built once: the guide takes a moment. */
const heavyDesign = (() => {
  const engines = Object.fromEntries([...Object.values(ENGINES), ...HEAVY].map((e) => [e.name, e]));
  const hardware = Object.fromEntries(Object.keys(engines).map((n) => [n, typical]));
  const pick = suggestBuilds({ mission: STATION, payloadMass: CAPSULE.mass + CAPSULE.tower.mass }, engines, [PATHFINDER, MERIDIAN])[0]!;
  const tuned = retunePitch(withCapsule(pick.vehicle), STATION, { hardware });
  return { ...pick.vehicle, name: "Albatross", pitchProgram: tuned.program };
})();

function company(): Company {
  const c = newCompany(1, 900_000, { ...VEHICLES, albatross: heavyDesign }, [...Object.values(ENGINES), ...HEAVY], generateBoard(1));
  for (const name of Object.keys(c.campaign.truth)) c.campaign.truth[name] = typical;
  c.campaign.aeroTruth[aeroShape(heavyDesign).key] = IDEAL_AERO;
  c.licence = "orbital";
  return c;
}

/** Everything a crew licence and a crew-rated rocket need, short of flying it. */
function readyForCrew(c: Company): void {
  c.capsule = newCapsule(1, c.day);
  c.capsule.truth = { "tower-misfire": false, "chute-failure": false, "max-q-breakup": false };
  c.capsule.known.padAbortPassed = true;
  c.capsule.known.inflightAbortPassed = true;
  for (const s of heavyDesign.stages) {
    const k = (c.campaign.knowledge[s.engine.name] ??= { firings: 1, startupProven: true, provenDuration: 0, measuredIspFactor: 0.975, altitudeTested: true, relightProven: true, open: [], fixed: [], seen: {}, history: [] });
    k.provenDuration = 10_000;
  }
  for (let i = 0; i < 3; i++) c.flights.push({ day: 0, design: heavyDesign.name, mission: STATION.name, contract: null, outcome: "orbit", apogee: 400_000, settlement: null });
  c.licence = "crew";
}

test("the abort tower rides to T+150 s, then its mass is gone", () => {
  const r = simulateAscent(withCapsule(heavyDesign), STATION, { hardware: Object.fromEntries(heavyDesign.stages.map((s) => [s.engine.name, typical])) });
  const jettison = r.events.find((e) => e.kind === "tower-jettison")!;
  assert.ok(Math.abs(jettison.t - CAPSULE.tower.jettisonAt) < 1, `at ${jettison.t}`);
  assert.equal(r.outcome, "orbit");
  assert.equal(r.summary.insertion?.inSpec, true, "the capsule reaches the station orbit");
});

test("whether an abort saves the crew follows the abort system's truth", () => {
  const sound = { "tower-misfire": false, "chute-failure": false, "max-q-breakup": false };
  assert.equal(abortOutcome(sound, 60, 30_000).survived, true);
  assert.equal(abortOutcome({ ...sound, "tower-misfire": true }, 60, 5_000).survived, false);
  assert.equal(abortOutcome({ ...sound, "tower-misfire": true }, 200, 0).survived, true, "after jettison the tower doesn't matter");
  assert.equal(abortOutcome({ ...sound, "max-q-breakup": true }, 60, MAX_Q_ABORT + 1).survived, false);
  assert.equal(abortOutcome({ ...sound, "max-q-breakup": true }, 10, MAX_Q_ABORT - 1).survived, true, "low in thin dynamic pressure the capsule holds");
  assert.equal(abortOutcome({ ...sound, "chute-failure": true }, 300, 0).survived, false);
});

test("the capsule is developed in the office, and the pad abort finds a misfiring tower that a fix then clears", () => {
  const c = company();
  c.licence = "suborbital";
  assert.throws(() => book(c, { kind: "capsule" }), /orbital license/);
  c.licence = "orbital";
  runTask(c, { kind: "capsule" });
  assert.ok(c.capsule);
  c.capsule.truth = { "tower-misfire": true, "chute-failure": false, "max-q-breakup": false };
  runTask(c, { kind: "pad-abort" });
  assert.deepEqual(c.capsule.known.open, ["tower-misfire"]);
  assert.equal(c.capsule.known.padAbortPassed, false);
  runTask(c, { kind: "fix-abort", flaw: "tower-misfire" });
  assert.deepEqual(c.capsule.known.open, []);
  runTask(c, { kind: "pad-abort" });
  assert.equal(c.capsule.known.padAbortPassed, true);
});

test("an in-flight abort test spends the booster at max-q and shows a capsule that would break up", () => {
  const c = company();
  c.capsule = newCapsule(1, 0);
  c.capsule.truth = { "tower-misfire": false, "chute-failure": false, "max-q-breakup": true };
  const rep = reputation(c);
  build(c, "albatross");
  const r = fly(c, "albatross", { mission: STATION, abortTest: true });
  assert.equal(r.result.outcome, "abort");
  assert.ok(r.result.events.some((e) => e.kind === "abort"));
  assert.equal(c.inventory.albatross, 0, "the booster is spent");
  assert.deepEqual(c.capsule.known.open, ["max-q-breakup"]);
  assert.equal(c.capsule.known.inflightAbortPassed, false);
  assert.equal(reputation(c), rep, "a test costs no reputation");
});

test("the crew licence and a crew rating both wait on everything being proven", () => {
  const c = company();
  assert.equal(crewRating(c, "albatross").rated, false);
  assert.equal(nextLicence(c, 10)!.ready, false);
  readyForCrew(c);
  assert.deepEqual(crewRating(c, "albatross").missing, []);
});

function crewFlight(c: Company) {
  const contract = c.board.find((x) => x.kind === "crew")!;
  c.day = contract.postedDay;
  for (let i = 0; i < 6; i++) c.record.push({ day: 0, tag: "delivered", reputation: 1, note: "test" });
  accept(c, contract.id);
  build(c, "albatross");
  return { contract, report: fly(c, "albatross", { contract: contract.id }) };
}

test("a booster failure under a crew with a sound abort system: the crew come home, the contract fails", () => {
  const c = company();
  readyForCrew(c);
  c.campaign.truth[heavyDesign.stages[0]!.engine.name] = { ...typical, instabilityOnset: 40 };
  const { report } = crewFlight(c);
  assert.ok(report.result.events.some((e) => e.kind === "abort"));
  assert.match(report.text, /Both crew are safe/);
  assert.equal(c.licence, "crew");
  assert.ok(!c.record.some((r) => r.tag === "crew-lost"));
});

test("losing a crew costs the licence, a heavy penalty and much of the company's standing, but not the company", () => {
  const c = company();
  readyForCrew(c);
  c.capsule!.truth["tower-misfire"] = true;
  c.campaign.truth[heavyDesign.stages[0]!.engine.name] = { ...typical, instabilityOnset: 40 };
  const rep = reputation(c);
  const cash = c.cash;
  const { contract, report } = crewFlight(c);
  assert.match(report.text, /crew were lost/);
  assert.equal(c.licence, "orbital");
  assert.equal(reputation(c), rep - 2 + LOSS_OF_CREW.reputation + 6, "the failed contract's −2 and the loss of crew");
  assert.ok(c.cash < cash - LOSS_OF_CREW.penalty - contract.penalty + 1);
  assert.equal(c.dead, false);
});

test("an abort test cut short by an early booster failure doesn't count as a max-q abort", () => {
  const c = company();
  c.capsule = newCapsule(1, 0);
  c.capsule.truth = { "tower-misfire": false, "chute-failure": false, "max-q-breakup": true };
  c.campaign.truth[heavyDesign.stages[0]!.engine.name] = { ...typical, instabilityOnset: 20 };
  build(c, "albatross");
  const r = fly(c, "albatross", { mission: STATION, abortTest: true });
  assert.ok(r.result.events.some((e) => e.kind === "engine-failure"), "the real failure shows");
  assert.match(r.text, /before max-q/);
  assert.equal(c.capsule.known.inflightAbortPassed, false);
  assert.deepEqual(c.capsule.known.open, [], "the max-q flaw stays hidden: the abort never met thick air");
});
