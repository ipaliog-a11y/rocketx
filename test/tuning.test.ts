import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { aeroShape, IDEAL_AERO } from "../src/sim/airframe.ts";
import { IDEAL_TRUTH, type HardwareTruth } from "../src/sim/hardware.ts";
import { hotFire, newCampaign } from "../src/sim/teststand.ts";
import { retuneFromTests, retunePitch, RETUNE_COST } from "../src/sim/tuning.ts";
import { tunnelRun } from "../src/sim/tunnel.ts";
import { LEO_300, SUBORBITAL_TEST } from "../src/missions.ts";
import { HARRIER_SL, HARRIER_VAC, MERIDIAN, PATHFINDER, PATHFINDER_FAT_FAIRING } from "../src/vehicles.ts";

/** Both Meridian engines 3% short of their drawings. */
const weak: HardwareTruth = {
  [HARRIER_SL.name]: { ...IDEAL_TRUTH, ispFactor: 0.97 },
  [HARRIER_VAC.name]: { ...IDEAL_TRUTH, ispFactor: 0.97 },
};

test("re-tuning on the real engines puts a weak Meridian back in spec", () => {
  const untuned = simulateAscent(MERIDIAN, LEO_300, { hardware: weak });
  assert.equal(untuned.summary.insertion!.inSpec, false);

  const tuned = retunePitch(MERIDIAN, LEO_300, { hardware: weak });
  assert.equal(tuned.inSpec, true);
  assert.notDeepEqual(tuned.program, MERIDIAN.pitchProgram);

  // With an accurate model, the prediction is what flies.
  const flown = simulateAscent({ ...MERIDIAN, pitchProgram: tuned.program }, LEO_300, { hardware: weak });
  assert.equal(flown.summary.insertion!.inSpec, true);
  assert.deepEqual(flown.summary.orbit, tuned.predicted.summary.orbit);
});

test("tuning on the drawings can't correct for engines nobody measured", () => {
  const paper = retunePitch(MERIDIAN, LEO_300, {});
  assert.equal(paper.inSpec, true);
  const flown = simulateAscent({ ...MERIDIAN, pitchProgram: paper.program }, LEO_300, { hardware: weak });
  assert.equal(flown.summary.insertion!.inSpec, false);
});

test("only a gravity turn with a target can be tuned", () => {
  assert.throws(() => retunePitch(PATHFINDER, LEO_300, {}), /nothing to tune/);
  assert.throws(() => retunePitch(MERIDIAN, SUBORBITAL_TEST, {}), /no insertion target/);
});

test("analysis runs can record buffet past the budget without breaking up", () => {
  const key = aeroShape(PATHFINDER_FAT_FAIRING).key;
  const aero = { [key]: { ...IDEAL_AERO, buffet: 2.5 } };
  const fatal = simulateAscent(PATHFINDER_FAT_FAIRING, SUBORBITAL_TEST, { aero });
  assert.equal(fatal.outcome, "failure");
  const analysis = simulateAscent(PATHFINDER_FAT_FAIRING, SUBORBITAL_TEST, { aero, structuralFailures: false });
  assert.equal(analysis.outcome, "apogee");
  assert.ok(analysis.summary.maxBuffetLoad.value > PATHFINDER_FAT_FAIRING.limits.maxDynamicPressure);
});

test("a campaign re-tune flies what was measured, charges its time and ignores engine failures", () => {
  const truth: HardwareTruth = {
    [HARRIER_SL.name]: { ...IDEAL_TRUTH, ispFactor: 0.97 },
    [HARRIER_VAC.name]: { ...IDEAL_TRUTH, ispFactor: 0.97, instabilityOnset: 200 },
  };
  const campaign = newCampaign(truth);
  hotFire(campaign, HARRIER_SL, 20, "sea-level");
  hotFire(campaign, HARRIER_VAC, 280, "altitude");
  assert.deepEqual(campaign.knowledge[HARRIER_VAC.name]!.open, ["combustion-instability"]);
  const spent = campaign.spent;
  const days = campaign.days;

  const { vehicle, result, text } = retuneFromTests(campaign, MERIDIAN, LEO_300);
  assert.equal(result.inSpec, true, "a known engine flaw shouldn't stop the tuner");
  assert.notDeepEqual(vehicle.pitchProgram, MERIDIAN.pitchProgram);
  assert.equal(campaign.spent, spent + RETUNE_COST.cost);
  assert.equal(campaign.days, days + RETUNE_COST.days);
  assert.match(text, /Predicted .* in spec/);
});

test("a re-tune that can't clear known buffet leaves the programme alone", () => {
  const key = aeroShape(MERIDIAN).key;
  const campaign = newCampaign(
    { [HARRIER_SL.name]: IDEAL_TRUTH, [HARRIER_VAC.name]: IDEAL_TRUTH },
    { [key]: { ...IDEAL_AERO, buffet: 2.6 } },
  );
  tunnelRun(campaign, MERIDIAN, "transonic");
  const { vehicle, text } = retuneFromTests(campaign, MERIDIAN, LEO_300);
  assert.deepEqual(vehicle.pitchProgram, MERIDIAN.pitchProgram);
  assert.match(text, /No programme flies clear of the known transonic buffet.*Programme unchanged/);
});
