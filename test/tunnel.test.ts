import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import {
  aeroShape,
  buffetLoad,
  dragMultiplier,
  IDEAL_AERO,
  isHammerhead,
  rollAeroTruth,
  type AeroTruth,
} from "../src/sim/airframe.ts";
import { debrief } from "../src/sim/debrief.ts";
import { IDEAL_TRUTH } from "../src/sim/hardware.ts";
import { believedHardware, flightUnknowns, hotFire, newCampaign } from "../src/sim/teststand.ts";
import { applyAeroFix, believedAero, tunnelRun } from "../src/sim/tunnel.ts";
import { SUBORBITAL_TEST } from "../src/missions.ts";
import {
  KESTREL_SL,
  MERIDIAN,
  MERIDIAN_LOFTED,
  PATHFINDER,
  PATHFINDER_FAT_FAIRING,
  PATHFINDER_VAC_BELL,
} from "../src/vehicles.ts";

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);

const FAT = aeroShape(PATHFINDER_FAT_FAIRING).key;
const aeroCampaign = (truth: AeroTruth) => newCampaign({ [KESTREL_SL.name]: IDEAL_TRUTH }, { [FAT]: truth });
const buffeting: AeroTruth = { dragFactor: 1.05, transonicRise: 1.3, buffet: 2.4 };

test("variants with the same outer shape share it", () => {
  assert.equal(aeroShape(MERIDIAN).key, aeroShape(MERIDIAN_LOFTED).key);
  assert.equal(aeroShape(PATHFINDER).key, aeroShape(PATHFINDER_VAC_BELL).key);
  assert.notEqual(aeroShape(PATHFINDER).key, FAT);
  assert.equal(isHammerhead(PATHFINDER_FAT_FAIRING), true);
  assert.equal(isHammerhead(PATHFINDER), false);
  assert.match(aeroShape(PATHFINDER_FAT_FAIRING).label, /hammerhead/);
});

test("aero truth is seeded and hammerheads buffet more often", () => {
  assert.deepEqual(rollAeroTruth(MERIDIAN, 5), rollAeroTruth(MERIDIAN, 5));
  let slim = 0;
  let fat = 0;
  for (let seed = 0; seed < 400; seed++) {
    if (rollAeroTruth(PATHFINDER, seed).buffet > 0) slim++;
    if (rollAeroTruth(PATHFINDER_FAT_FAIRING, seed).buffet > 0) fat++;
  }
  assert.ok(fat > 2 * slim, `fat ${fat}, slim ${slim}`);
});

test("the transonic rise only bites near Mach 1", () => {
  const truth: AeroTruth = { dragFactor: 1.1, transonicRise: 1.4, buffet: 0 };
  near(dragMultiplier(truth, 0.5), 1.1, 1e-12);
  near(dragMultiplier(truth, 3), 1.1, 1e-12);
  near(dragMultiplier(truth, 1.05), 1.1 * 1.4, 1e-12);
  assert.ok(dragMultiplier(truth, 0.9) > 1.1 && dragMultiplier(truth, 0.9) < 1.54);
  near(dragMultiplier(IDEAL_AERO, 1.05), 1, 1e-12);
});

test("buffet only loads the structure inside its Mach band", () => {
  assert.equal(buffetLoad(buffeting, 0.7, 30_000), 0);
  near(buffetLoad(buffeting, 1.0, 30_000), 72_000, 1e-9);
  assert.equal(buffetLoad(buffeting, 1.3, 30_000), 0);
  assert.equal(buffetLoad(IDEAL_AERO, 1.0, 30_000), 0);
});

test("CFD gets drag half right and never sees buffet", () => {
  const campaign = aeroCampaign(buffeting);
  const report = tunnelRun(campaign, PATHFINDER_FAT_FAIRING, "cfd");
  near(report.dragFactor, 1.025, 1e-12);
  assert.equal(report.buffet, null);
  const known = campaign.aeroKnowledge[FAT]!;
  assert.equal(known.dragSource, "cfd");
  assert.deepEqual(known.open, []);
});

test("the subsonic tunnel measures drag but not the transonic band", () => {
  const campaign = aeroCampaign(buffeting);
  tunnelRun(campaign, PATHFINDER_FAT_FAIRING, "subsonic");
  tunnelRun(campaign, PATHFINDER_FAT_FAIRING, "cfd");
  const known = campaign.aeroKnowledge[FAT]!;
  near(known.dragFactor!, 1.05, 1e-12);
  assert.equal(known.dragSource, "tunnel", "CFD must not overwrite a tunnel measurement");
  assert.equal(known.transonicRise, null);
  assert.deepEqual(known.open, []);
});

test("the transonic tunnel shows buffet and the real drag rise", () => {
  const campaign = aeroCampaign(buffeting);
  const report = tunnelRun(campaign, PATHFINDER_FAT_FAIRING, "transonic");
  assert.equal(report.buffet, 2.4);
  assert.match(report.text, /2\.40× dynamic pressure/);
  const known = campaign.aeroKnowledge[FAT]!;
  near(known.transonicRise!, 1.3, 1e-12);
  assert.deepEqual(known.open, ["transonic-buffet"]);
  assert.equal(campaign.spent, 180);
});

test("buffet can only be fixed once seen, and the fix costs drag", () => {
  const campaign = aeroCampaign(buffeting);
  assert.throws(() => applyAeroFix(campaign, PATHFINDER_FAT_FAIRING, "transonic-buffet"), /has to see a problem/);
  tunnelRun(campaign, PATHFINDER_FAT_FAIRING, "transonic");
  applyAeroFix(campaign, PATHFINDER_FAT_FAIRING, "transonic-buffet");
  const truth = campaign.aeroTruth[FAT]!;
  assert.equal(truth.buffet, 0);
  near(truth.dragFactor, 1.05 * 1.03, 1e-12);
  const known = campaign.aeroKnowledge[FAT]!;
  assert.equal(known.transonicRise, null);
  assert.deepEqual(known.fixed, ["transonic-buffet"]);
});

test("real drag lowers the flight", () => {
  const paper = simulateAscent(PATHFINDER, SUBORBITAL_TEST).summary;
  const key = aeroShape(PATHFINDER).key;
  const real = simulateAscent(PATHFINDER, SUBORBITAL_TEST, {
    aero: { [key]: { dragFactor: 1.1, transonicRise: 1.4, buffet: 0 } },
  }).summary;
  assert.ok(real.losses.drag > paper.losses.drag * 1.1);
  assert.ok(real.apogee < paper.apogee);
});

test("buffet past the budget breaks the vehicle up in the transonic band", () => {
  const result = simulateAscent(PATHFINDER_FAT_FAIRING, SUBORBITAL_TEST, { aero: { [FAT]: buffeting } });
  assert.equal(result.outcome, "failure");
  const failure = result.events.find((e) => e.kind === "structural-failure")!;
  assert.equal(failure.mode, "transonic-buffet");
  assert.ok(failure.mach >= 0.85 && failure.mach <= 1.15);
  assert.ok(failure.value! > PATHFINDER_FAT_FAIRING.limits.maxDynamicPressure);
});

test("mild buffet is recorded but survived", () => {
  const mild: AeroTruth = { dragFactor: 1, transonicRise: 1, buffet: 1.2 };
  const result = simulateAscent(PATHFINDER_FAT_FAIRING, SUBORBITAL_TEST, { aero: { [FAT]: mild } });
  assert.equal(result.outcome, "apogee");
  assert.ok(result.summary.maxBuffetLoad.value > 0);
  assert.ok(result.summary.maxBuffetLoad.value < PATHFINDER_FAT_FAIRING.limits.maxDynamicPressure);
});

test("the airframe's unknowns shrink as the tunnels learn", () => {
  const campaign = aeroCampaign(IDEAL_AERO);
  const airframe = () => flightUnknowns(PATHFINDER_FAT_FAIRING, campaign).filter((u) => u.subject === "Airframe");
  assert.match(airframe()[0]!.text, /Aerodynamics on paper/);
  tunnelRun(campaign, PATHFINDER_FAT_FAIRING, "cfd");
  assert.equal(airframe().length, 2);
  tunnelRun(campaign, PATHFINDER_FAT_FAIRING, "transonic");
  assert.deepEqual(airframe(), []);
});

test("the forecast flies what was measured, including known flaws", () => {
  const campaign = aeroCampaign(buffeting);
  assert.equal(believedAero(campaign)[FAT]!.buffet, 0);
  tunnelRun(campaign, PATHFINDER_FAT_FAIRING, "transonic");
  const believed = believedAero(campaign)[FAT]!;
  assert.equal(believed.buffet, 2.4);
  const forecast = simulateAscent(PATHFINDER_FAT_FAIRING, SUBORBITAL_TEST, { aero: believedAero(campaign) });
  assert.equal(forecast.outcome, "failure");
});

test("the engine forecast includes failures the stand has seen", () => {
  const campaign = newCampaign({ [KESTREL_SL.name]: { ...IDEAL_TRUTH, thermalLife: 60 } });
  assert.equal(believedHardware(campaign)[KESTREL_SL.name]!.thermalLife, Infinity);
  hotFire(campaign, KESTREL_SL, 90, "sea-level");
  near(believedHardware(campaign)[KESTREL_SL.name]!.thermalLife, 60, 1e-9);
});

test("the debrief blames the missing transonic run", () => {
  const campaign = aeroCampaign(buffeting);
  tunnelRun(campaign, PATHFINDER_FAT_FAIRING, "cfd");
  const result = simulateAscent(PATHFINDER_FAT_FAIRING, SUBORBITAL_TEST, { aero: campaign.aeroTruth });
  const text = debrief(result, PATHFINDER_FAT_FAIRING, SUBORBITAL_TEST, campaign);
  assert.match(text, /Vehicle lost at .*: transonic buffet/);
  assert.match(text, /never went through the transonic tunnel\. It only saw CFD/);

  tunnelRun(campaign, PATHFINDER_FAT_FAIRING, "transonic");
  const again = debrief(result, PATHFINDER_FAT_FAIRING, SUBORBITAL_TEST, campaign);
  assert.match(again, /had already seen buffet .* It flew unfixed/);
});
