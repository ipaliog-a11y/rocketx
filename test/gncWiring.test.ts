import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { fitControl, specOf, type VehicleSpec } from "../src/sim/builder.ts";
import { newCompany } from "../src/sim/company.ts";
import { defaultControl, flownGnc } from "../src/sim/control.ts";
import { dispersions } from "../src/sim/dispersions.ts";
import { defaultGeometry } from "../src/sim/geometry.ts";
import { designSpec, runTask } from "../src/sim/schedule.ts";
import { learnFromFlight } from "../src/sim/telemetry.ts";
import { flightUnknowns } from "../src/sim/teststand.ts";
import { generateBoard } from "../src/contracts.ts";
import { MISSIONS } from "../src/missions.ts";
import { ENGINES, VEHICLES } from "../src/vehicles.ts";

const meridian = Object.values(VEHICLES).find((v) => v.name === "Meridian")!;
const LEO = MISSIONS["leo-300"]!;
const drawn = (name: string): VehicleSpec => ({ ...specOf(meridian), name, geometry: { ...defaultGeometry(2), control: defaultControl(2) } });

function companyWith(name: string, seed = 3) {
  const c = newCompany(seed, 30_000, VEHICLES, Object.values(ENGINES), generateBoard(seed));
  runTask(c, designSpec(c, drawn(name)));
  const key = Object.keys(c.designs).find((k) => c.designs[k]!.name === name)!;
  return { c, key, v: { ...c.designs[key]!, pitchProgram: meridian.pitchProgram } };
}

test("drawing up a guided design rolls its loop's truth; bids list what's untested", () => {
  const { c, v } = companyWith("Steady");
  const truth = c.campaign.gncTruth?.["Steady"];
  assert.ok(truth);
  assert.ok(truth.bending >= 0.8 && truth.bending <= 1.15);
  const texts = flightUnknowns(v, c.campaign, LEO).map((u) => u.text).join(" ");
  assert.match(texts, /modal survey/);
  assert.match(texts, /IMU never calibrated/);
  assert.match(texts, /hardware-in-the-loop/);
});

test("modal survey, IMU calibration and HITL reveal their truths, and HITL fixes a software error", () => {
  // Find a seed whose design has a flaw, so HITL has something to find.
  let found: ReturnType<typeof companyWith> | null = null;
  for (let seed = 1; seed < 40 && !found; seed++) {
    const w = companyWith("Loop", seed);
    if (w.c.campaign.gncTruth!["Loop"]!.flaw) found = w;
  }
  assert.ok(found, "some seed rolls a flaw");
  const { c, key } = found;
  const truth = c.campaign.gncTruth!["Loop"]!;
  runTask(c, { kind: "gnc", design: key, test: "modal" });
  assert.equal(c.campaign.gncKnowledge!["Loop"]!.bending, truth.bending);
  assert.deepEqual(c.campaign.gncKnowledge!["Loop"]!.slosh, truth.slosh);
  assert.throws(() => runTask(c, { kind: "gnc", design: key, test: "modal" }), /surveyed/);
  runTask(c, { kind: "gnc", design: key, test: "imu-cal" });
  assert.equal(c.campaign.gncKnowledge!["Loop"]!.imuBias, truth.imuBias);
  const done = runTask(c, { kind: "gnc", design: key, test: "hitl" });
  assert.match(done.done.map((d) => d.text).join(" "), /gain-schedule error/);
  const known = c.campaign.gncKnowledge!["Loop"]!;
  assert.equal(known.flawFixed, true);
  // What flies now: the flaw gone, the drift a tenth, the notch on the measured mode.
  const flown = flownGnc(c.designs[key]!.control!, truth, known);
  assert.equal(flown.flaw, null);
  assert.ok(Math.abs(flown.imuBias) <= Math.abs(truth.imuBias) * 0.11);
  assert.equal(flightUnknowns(c.designs[key]!, c.campaign, LEO).filter((u) => u.subject.startsWith("gnc:")).length, 0);
  // GNC tests book on the stand and the new lab.
  assert.equal(c.units.lab.length, 1);
});

test("a flight teaches the IMU's drift, and a loss of control the truth behind it", () => {
  const { c, v } = companyWith("Learner");
  const truth = c.campaign.gncTruth!["Learner"]!;
  const r = simulateAscent(v, LEO, { gnc: { Learner: flownGnc(v.control!, { ...truth, flaw: null }, undefined) } });
  learnFromFlight(c.campaign, v, r);
  assert.equal(c.campaign.gncKnowledge!["Learner"]!.imuBias, truth.imuBias);
  // A coupling failure reveals the bending mode.
  const fast = { ...v, control: { ...v.control!, design: { ...v.control!.design, bandwidth: 3, notch: false } } };
  const lost = simulateAscent(fast, LEO, { gnc: { Learner: { bending: truth.bending, notchAt: null, slosh: truth.slosh, imuBias: 0, flaw: null } } });
  assert.equal(lost.events.find((e) => e.kind === "loss-of-control")?.cause, "bending");
  learnFromFlight(c.campaign, fast, lost);
  assert.equal(c.campaign.gncKnowledge!["Learner"]!.bending, truth.bending);
});

test("dispersions: deterministic, sample what's unknown, and count what would be lost", () => {
  const { c, v } = companyWith("Spread");
  const a = dispersions(c.campaign, v, LEO, { runs: 12 });
  const b = dispersions(c.campaign, v, LEO, { runs: 12 });
  assert.deepEqual(a.runs.map((r) => r.result.summary.maxQAlpha.value), b.runs.map((r) => r.result.summary.maxQAlpha.value));
  assert.equal(a.runs.length, 12);
  // Winds differ run to run.
  assert.ok(new Set(a.runs.map((r) => Math.round(r.result.summary.control?.maxGust ?? 0))).size > 1);
  const lost = Object.values(a.losses).reduce((s, n) => s + n, 0);
  assert.equal(lost, a.runs.filter((r) => r.lost).length);
  assert.ok(a.success >= 0 && a.success <= 1);
  // A design whose loop can't hold its airframe loses every run.
  const slow = { ...v, control: { ...v.control!, design: { ...v.control!.design, bandwidth: 0.3 } } };
  const s = dispersions(c.campaign, slow, LEO, { runs: 4 });
  assert.equal(s.losses.divergence, 4);
});

test("the guide sizes the loop it suggests", () => {
  const pathfinder2 = Object.values(VEHICLES).find((v) => v.name === "Pathfinder two-stage")!;
  const fitted = fitControl({ ...specOf(pathfinder2), geometry: defaultGeometry(2) }, Object.fromEntries(Object.values(ENGINES).map((e) => [e.name, e])));
  assert.ok(fitted.geometry!.control!.bandwidth > 1);
});
