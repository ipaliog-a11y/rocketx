import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { debrief } from "../src/sim/debrief.ts";
import { firstFailure, IDEAL_TRUTH, rollEngineTruth, rollTruths, type EngineTruth } from "../src/sim/hardware.ts";
import {
  applyFix,
  believedHardware,
  flightUnknowns,
  hotFire,
  HARDWARE_LOSS,
  newCampaign,
} from "../src/sim/teststand.ts";
import { LEO_300, SUBORBITAL_TEST } from "../src/missions.ts";
import { ENGINES, HARRIER_SL, HARRIER_VAC, KESTREL_SL, KESTREL_VAC, MERIDIAN, PATHFINDER } from "../src/vehicles.ts";

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);

/** A healthy engine with a finite but generous chamber life. */
const healthy = (overrides: Partial<EngineTruth> = {}): EngineTruth => ({
  ispFactor: 0.98,
  hardStart: false,
  instabilityOnset: null,
  thermalLife: 1_000,
  ...overrides,
});

test("the same seed always rolls the same hardware", () => {
  assert.deepEqual(rollEngineTruth(HARRIER_SL, 42), rollEngineTruth(HARRIER_SL, 42));
  assert.notDeepEqual(rollEngineTruth(HARRIER_SL, 42), rollEngineTruth(HARRIER_SL, 43));
  assert.notDeepEqual(rollEngineTruth(HARRIER_SL, 42), rollEngineTruth(HARRIER_VAC, 42));
});

test("rolled quirks stay inside their ranges", () => {
  for (let seed = 0; seed < 200; seed++) {
    const t = rollEngineTruth(HARRIER_SL, seed);
    assert.ok(t.ispFactor >= 0.95 && t.ispFactor <= 1);
    assert.ok(t.thermalLife >= 150 * 0.6 && t.thermalLife <= 150 * 1.4);
    if (t.instabilityOnset !== null) assert.ok(t.instabilityOnset >= 4 && t.instabilityOnset <= 60);
  }
});

test("every hidden quirk is found by a long enough firing", () => {
  for (let seed = 0; seed < 200; seed++) {
    const campaign = newCampaign({ [HARRIER_VAC.name]: rollEngineTruth(HARRIER_VAC, seed) });
    const truth = campaign.truth[HARRIER_VAC.name]!;
    const expected = firstFailure(truth)!;
    const report = hotFire(campaign, HARRIER_VAC, 10_000, "altitude");
    assert.equal(report.findings[0]?.mode, expected.mode, `seed ${seed}`);
    near(report.fired, Math.max(expected.t, 0.3), 1e-9);
  }
});

test("a short firing says nothing about a chamber that fails later", () => {
  const campaign = newCampaign({ [KESTREL_SL.name]: healthy({ thermalLife: 120 }) });
  const report = hotFire(campaign, KESTREL_SL, 30, "sea-level");
  assert.equal(report.findings.length, 0);
  assert.equal(report.fired, 30);
  assert.equal(campaign.knowledge[KESTREL_SL.name]!.provenDuration, 30);
  const long = hotFire(campaign, KESTREL_SL, 200, "sea-level");
  assert.equal(long.findings[0]?.mode, "burn-through");
  near(long.fired, 120, 1e-9);
});

test("a vacuum bell separates on the sea-level stand and needs the altitude cell", () => {
  const campaign = newCampaign({ [KESTREL_VAC.name]: healthy() });
  const sea = hotFire(campaign, KESTREL_VAC, 60, "sea-level");
  assert.equal(sea.findings[0]?.mode, "flow-separation");
  assert.equal(sea.isp, null);
  assert.equal(sea.hardwareLost, false);

  const alt = hotFire(campaign, KESTREL_VAC, 60, "altitude");
  assert.equal(alt.findings.length, 0);
  assert.ok(alt.isp);
  assert.equal(campaign.knowledge[KESTREL_VAC.name]!.altitudeTested, true);
});

test("the stand measures the real Isp, and the model can use it", () => {
  const campaign = newCampaign({ [KESTREL_SL.name]: healthy({ ispFactor: 0.963 }) });
  hotFire(campaign, KESTREL_SL, 20, "sea-level");
  near(campaign.knowledge[KESTREL_SL.name]!.measuredIspFactor!, 0.963, 1e-9);
  near(believedHardware(campaign)[KESTREL_SL.name]!.ispFactor, 0.963, 1e-9);
  assert.equal(believedHardware(campaign)[KESTREL_SL.name]!.thermalLife, Infinity);
});

test("a hard start destroys the test engine and costs a rebuild", () => {
  const campaign = newCampaign({ [KESTREL_SL.name]: healthy({ hardStart: true }) });
  const report = hotFire(campaign, KESTREL_SL, 30, "sea-level");
  assert.equal(report.findings[0]?.mode, "hard-start");
  assert.equal(report.hardwareLost, true);
  assert.ok(report.cost > HARDWARE_LOSS.cost);
  assert.equal(campaign.knowledge[KESTREL_SL.name]!.startupProven, false);
});

test("a fix needs an observed problem, and resets what was proven", () => {
  const campaign = newCampaign({ [HARRIER_SL.name]: healthy({ instabilityOnset: 12 }) });
  assert.throws(() => applyFix(campaign, HARRIER_SL, "combustion-instability"), /has to see a problem/);

  hotFire(campaign, HARRIER_SL, 5, "sea-level");
  assert.throws(() => applyFix(campaign, HARRIER_SL, "combustion-instability"), /has to see a problem/);

  hotFire(campaign, HARRIER_SL, 30, "sea-level");
  const before = campaign.truth[HARRIER_SL.name]!.ispFactor;
  applyFix(campaign, HARRIER_SL, "combustion-instability");
  const after = campaign.truth[HARRIER_SL.name]!;
  assert.equal(after.instabilityOnset, null);
  assert.ok(after.ispFactor < before, "baffles should cost a little Isp");
  const known = campaign.knowledge[HARRIER_SL.name]!;
  assert.equal(known.provenDuration, 0);
  assert.equal(known.measuredIspFactor, null);
  assert.deepEqual(known.open, []);
  assert.deepEqual(known.fixed, ["combustion-instability"]);
});

test("flow separation can't be fixed on the stand", () => {
  const campaign = newCampaign({ [KESTREL_VAC.name]: healthy() });
  hotFire(campaign, KESTREL_VAC, 10, "sea-level");
  assert.throws(() => applyFix(campaign, KESTREL_VAC, "flow-separation"), /change the bell/);
});

test("an untested vehicle flies everything on trust", () => {
  const campaign = newCampaign(rollTruths(Object.values(ENGINES), 1));
  const unknowns = flightUnknowns(MERIDIAN, campaign);
  assert.equal(unknowns.length, 2);
  assert.ok(unknowns.every((u) => /Never fired/.test(u.text)));
});

test("full-duration firings in the right facilities leave nothing on trust", () => {
  const campaign = newCampaign({ [HARRIER_SL.name]: healthy(), [HARRIER_VAC.name]: healthy() });
  hotFire(campaign, HARRIER_SL, 140, "sea-level");
  hotFire(campaign, HARRIER_VAC, 280, "altitude");
  assert.deepEqual(flightUnknowns(MERIDIAN, campaign), []);
});

test("a known flaw short of the flight burn is called out as a certain failure", () => {
  const campaign = newCampaign({ [HARRIER_SL.name]: healthy({ thermalLife: 100 }), [HARRIER_VAC.name]: healthy() });
  hotFire(campaign, HARRIER_SL, 140, "sea-level");
  const text = flightUnknowns(MERIDIAN, campaign).map((u) => u.text).join("\n");
  assert.match(text, /Known burn-through at 100\.0 s .* it will fail in flight/);
});

test("a booster hard start loses the vehicle on the pad", () => {
  const result = simulateAscent(PATHFINDER, SUBORBITAL_TEST, { hardware: { [KESTREL_SL.name]: healthy({ hardStart: true }) } });
  assert.equal(result.outcome, "failure");
  assert.ok(!result.events.some((e) => e.kind === "liftoff"));
  const failure = result.events.find((e) => e.kind === "engine-failure")!;
  assert.equal(failure.mode, "hard-start");
  assert.equal(failure.t, 0);
});

test("an engine fails in flight exactly when its truth says", () => {
  const result = simulateAscent(PATHFINDER, SUBORBITAL_TEST, { hardware: { [KESTREL_SL.name]: healthy({ thermalLife: 50 }) } });
  const failure = result.events.find((e) => e.kind === "engine-failure")!;
  assert.equal(failure.mode, "burn-through");
  near(failure.t, 50, 1e-9);
  assert.equal(result.summary.insertion, null);
});

test("an upper-stage failure counts from its own ignition", () => {
  const hardware = { [HARRIER_SL.name]: healthy(), [HARRIER_VAC.name]: healthy({ instabilityOnset: 10 }) };
  const result = simulateAscent(MERIDIAN, LEO_300, { hardware });
  const staging = result.events.find((e) => e.kind === "staging")!;
  const failure = result.events.find((e) => e.kind === "engine-failure")!;
  assert.equal(failure.stage, 1);
  near(failure.t - staging.t, 10, 1e-9);
  assert.equal(result.summary.insertion!.reachedOrbit, false);
});

test("a weak engine flies lower than its drawings", () => {
  const paper = simulateAscent(PATHFINDER, SUBORBITAL_TEST).summary.apogee;
  const real = simulateAscent(PATHFINDER, SUBORBITAL_TEST, {
    hardware: { [KESTREL_SL.name]: { ...IDEAL_TRUTH, ispFactor: 0.95 } },
  }).summary.apogee;
  assert.ok(real < paper * 0.95);
});

test("the debrief points at the firing that would have caught the failure", () => {
  const truth = { [KESTREL_SL.name]: healthy({ thermalLife: 50 }) };
  const campaign = newCampaign(structuredClone(truth));
  hotFire(campaign, KESTREL_SL, 30, "sea-level");
  const result = simulateAscent(PATHFINDER, SUBORBITAL_TEST, { hardware: campaign.truth });
  const text = debrief(result, PATHFINDER, SUBORBITAL_TEST, campaign);
  assert.match(text, /Vehicle lost at T\+50\.0 s/);
  assert.match(text, /chamber burn-through 50\.0 s into the Kestrel-SL burn/);
  assert.match(text, /longest clean firing of the current Kestrel-SL hardware was 30\.0 s/);

  const untested = debrief(result, PATHFINDER, SUBORBITAL_TEST, newCampaign(truth));
  assert.match(untested, /never fired on the stand\. A 50 s firing would have found this/);
});
