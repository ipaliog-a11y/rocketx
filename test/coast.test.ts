import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { combineTruth, IDEAL_TRUTH, rollPartTruths } from "../src/sim/hardware.ts";
import { missionPlan } from "../src/sim/mission.ts";
import { assembleEngine, type EngineParts } from "../src/sim/parts.ts";
import { applyFix, flightUnknowns, hotFire, newCampaign, partKnowledgeOf } from "../src/sim/teststand.ts";
import { missionDeltaV, suggestBuilds } from "../src/sim/guide.ts";
import { retunePitch } from "../src/sim/tuning.ts";
import { generateBoard } from "../src/contracts.ts";
import { circular, escape, gto, highCircular, LEO_300, lunar } from "../src/missions.ts";
import { ENGINES, HARRIER_SL, HARRIER_VAC, MERIDIAN, PATHFINDER } from "../src/vehicles.ts";

const BIG: EngineParts = { size: 100, cycle: "gas-generator", injector: "coaxial", cooling: "film", nozzle: "sea-level" };
const big = [
  assembleEngine(BIG, "Osprey-100"),
  assembleEngine({ ...BIG, nozzle: "large-vacuum" }, "Osprey-100-XV"),
  assembleEngine({ size: 9, cycle: "storable", injector: "pintle", cooling: "ablative", nozzle: "vacuum" }, "Petrel-9-V"),
];
const engines = Object.fromEntries([...Object.values(ENGINES), ...big].map((e) => [e.name, e]));
const typical = Object.fromEntries(Object.values(engines).map((e) => [e.name, { ...IDEAL_TRUTH, ispFactor: 0.975 }]));
const kinds = (r: ReturnType<typeof simulateAscent>) => r.events.map((e) => e.kind);

test("low orbits fly direct; higher ones go via a parking orbit", () => {
  assert.equal(missionPlan(LEO_300).burns.length, 0);
  assert.deepEqual(missionPlan(highCircular(800, 28.5)).burns.map((b) => b.name), ["transfer", "circularize"]);
  assert.deepEqual(missionPlan(gto()).burns.map((b) => b.name), ["transfer"]);
  assert.deepEqual(missionPlan(escape(10)).burns.map((b) => b.name), ["escape"]);
  assert.ok(missionDeltaV(gto()) > missionDeltaV(LEO_300) + 1_500);
  assert.ok(missionDeltaV(escape(10)) > missionDeltaV(lunar()) && missionDeltaV(lunar()) > missionDeltaV(gto()));
});

test("the Meridian reaches 800 km circular with two relights", () => {
  const mission = highCircular(800, 28.5);
  const r = retunePitch({ ...MERIDIAN, payloadMass: 50 }, mission, {});
  assert.equal(r.inSpec, true);
  const k = kinds(r.predicted);
  assert.equal(k.filter((x) => x === "relight").length, 2);
  assert.ok(k.includes("coast") && k.includes("transfer") && k.includes("circularize"));
  const o = r.predicted.summary.orbit!;
  assert.ok(Math.abs(o.periapsis - 800_000) < 15_000 && Math.abs(o.apoapsis - 800_000) < 15_000);
});

test("an engine that won't relight strands the payload in the parking orbit", () => {
  const mission = highCircular(800, 28.5);
  const tuned = retunePitch({ ...MERIDIAN, payloadMass: 50 }, mission, {}).program;
  const r = simulateAscent({ ...MERIDIAN, payloadMass: 50, pitchProgram: tuned }, mission, {
    hardware: { [HARRIER_SL.name]: IDEAL_TRUTH, [HARRIER_VAC.name]: { ...IDEAL_TRUTH, relightFails: true } },
  });
  assert.equal(r.outcome, "failure");
  const failure = r.events.find((e) => e.kind === "engine-failure")!;
  assert.equal(failure.mode, "relight-failure");
  assert.ok(failure.altitude > 150_000, "it failed in orbit, after the coast");
});

test("a restart test in the cell finds a bad relight, and the fix covers the sister engine", () => {
  const list = [HARRIER_SL, HARRIER_VAC];
  const partTruth = rollPartTruths(list, 1);
  for (const key of Object.keys(partTruth)) partTruth[key] = { ispFactor: 1, hardStart: false, instabilityOnset: null, lifeFactor: 1, relightFails: key.startsWith("cycle") };
  const truth = Object.fromEntries(list.map((e) => [e.name, combineTruth(e, partTruth)]));
  const campaign = newCampaign(truth, {}, { engines: list, partTruth });
  assert.throws(() => hotFire(campaign, HARRIER_VAC, 30, "sea-level", true), /altitude cell/);
  const report = hotFire(campaign, HARRIER_VAC, 30, "altitude", true);
  assert.equal(report.findings[0]?.mode, "relight-failure");
  assert.ok(campaign.knowledge[HARRIER_SL.name]!.open.includes("relight-failure"), "the sister shares the cycle");
  applyFix(campaign, HARRIER_VAC, "relight-failure");
  assert.equal(campaign.truth[HARRIER_SL.name]!.relightFails, false);
  const again = hotFire(campaign, HARRIER_VAC, 30, "altitude", true);
  assert.deepEqual(again.findings, []);
  assert.equal(campaign.knowledge[HARRIER_SL.name]!.relightProven, true);
  assert.equal(partKnowledgeOf(campaign, Object.keys(partTruth).find((k) => k.startsWith("cycle"))!).relightProven, true);
});

test("the bid lists an unproven relight for a mission that needs one", () => {
  const campaign = newCampaign({ [HARRIER_SL.name]: IDEAL_TRUTH, [HARRIER_VAC.name]: IDEAL_TRUTH }, {}, { engines: [HARRIER_SL, HARRIER_VAC] });
  const unknowns = flightUnknowns(MERIDIAN, campaign, highCircular(800, 28.5)).concat(flightUnknowns(MERIDIAN, campaign, LEO_300));
  assert.equal(unknowns.filter((u) => /Never restarted/.test(u.text)).length, 0, "never fired at all says so instead");
  hotFire(campaign, HARRIER_VAC, 30, "altitude");
  assert.ok(flightUnknowns(MERIDIAN, campaign, highCircular(800, 28.5)).some((u) => /Never restarted in vacuum/.test(u.text)));
  assert.ok(!flightUnknowns(MERIDIAN, campaign, LEO_300).some((u) => /Never restarted/.test(u.text)));
});

test("the storable cycle makes a small, restartable kick engine", () => {
  const petrel = big[2]!;
  assert.ok(petrel.ispVac > 300 && petrel.ispVac < 330);
  assert.ok(petrel.thrustVac < 10_000);
  assert.deepEqual(assembleEngine({ ...BIG, size: 3, cycle: "storable" }, "x").parts!.size, 3);
});

test("the heaviest high-energy payloads on the board can be flown on developed engines", () => {
  const board = generateBoard(1);
  const heaviest = (kind: string) => board.filter((c) => c.kind === kind).sort((a, b) => b.payloadMass - a.payloadMass)[0]!;
  for (const c of [heaviest("geo"), heaviest("deep-space"), heaviest("megaconstellation")]) {
    const pick = suggestBuilds({ mission: c.mission, payloadMass: c.payloadMass }, engines, [PATHFINDER, MERIDIAN])[0];
    assert.ok(pick, `${c.title}: no design`);
    const r = retunePitch(pick.vehicle, c.mission, { hardware: typical });
    assert.equal(r.inSpec, true, `${c.title}: ${r.predicted.outcome}`);
    if (c.kind === "deep-space") assert.equal(r.predicted.outcome, "escape");
  }
  // And the 1,200 km navigation orbit, which needs a circularisation burn.
  const nav = board.filter((c) => c.kind === "navigation").sort((a, b) => b.payloadMass - a.payloadMass)[0]!;
  const pick = suggestBuilds({ mission: nav.mission, payloadMass: nav.payloadMass }, engines, [PATHFINDER, MERIDIAN])[0]!;
  assert.equal(retunePitch(pick.vehicle, nav.mission, { hardware: typical }).inSpec, true);
  void circular;
});
