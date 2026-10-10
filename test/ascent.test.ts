import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { MU_EARTH, R_EARTH } from "../src/sim/constants.ts";
import { debrief } from "../src/sim/debrief.ts";
import { idealDeltaV, type Vehicle } from "../src/sim/vehicle.ts";
import {
  PATHFINDER,
  PATHFINDER_FAT_FAIRING,
  PATHFINDER_OVERFUELLED,
  PATHFINDER_TWO_STAGE,
  PATHFINDER_VAC_BELL,
} from "../src/vehicles.ts";

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);

const kinds = (v: Vehicle) => simulateAscent(v).events.map((e) => e.kind);

test("burnout velocity equals delivered Δv minus every loss", () => {
  for (const vehicle of [PATHFINDER, PATHFINDER_FAT_FAIRING, PATHFINDER_VAC_BELL, PATHFINDER_TWO_STAGE]) {
    const { summary } = simulateAscent(vehicle);
    const { gravity, drag, backPressure } = summary.losses;
    near(summary.burnoutVelocity, summary.idealDeltaV - gravity - drag - backPressure, 1e-6);
  }
});

test("integrated Δv matches the rocket equation", () => {
  for (const vehicle of [PATHFINDER, PATHFINDER_TWO_STAGE]) {
    const expected = idealDeltaV(vehicle).reduce((a, b) => a + b, 0);
    near(simulateAscent(vehicle).summary.idealDeltaV, expected, expected * 1e-6);
  }
});

test("drag-free coast conserves orbital energy to apogee", () => {
  const vehicle: Vehicle = {
    ...PATHFINDER,
    dragCurve: [[0, 0]],
    stages: [{ ...PATHFINDER.stages[0]!, engine: { ...PATHFINDER.stages[0]!.engine, exitArea: 0 } }],
  };
  const { summary } = simulateAscent(vehicle);
  const rb = R_EARTH + summary.burnoutAltitude;
  const energy = (summary.burnoutVelocity ** 2) / 2 - MU_EARTH / rb;
  const expectedApogee = -MU_EARTH / energy - R_EARTH;
  near(summary.apogee, expectedApogee, 50);
  near(summary.losses.drag, 0, 1e-9);
  near(summary.losses.backPressure, 0, 1e-9);
});

test("apogee converges as the step shrinks", () => {
  const coarse = simulateAscent(PATHFINDER, { dt: 0.1 }).summary.apogee;
  const fine = simulateAscent(PATHFINDER, { dt: 0.01 }).summary.apogee;
  near(coarse, fine, fine * 1e-3);
});

test("events come out in time order with one max-q", () => {
  const { events } = simulateAscent(PATHFINDER);
  for (let i = 1; i < events.length; i++) assert.ok(events[i]!.t >= events[i - 1]!.t);
  assert.equal(events.filter((e) => e.kind === "max-q").length, 1);
  assert.deepEqual(
    events.map((e) => e.kind).filter((k) => k !== "max-q" && k !== "mach-1"),
    ["ignition", "liftoff", "meco", "apogee"],
  );
});

test("max-q happens while supersonic and below the budget for Pathfinder", () => {
  const { summary } = simulateAscent(PATHFINDER);
  assert.ok(summary.maxQ.mach > 1);
  assert.ok(summary.maxQ.value < PATHFINDER.limits.maxDynamicPressure);
  assert.ok(summary.maxQ.altitude > 5_000 && summary.maxQ.altitude < 20_000);
});

test("a fat fairing costs drag and altitude", () => {
  const slim = simulateAscent(PATHFINDER).summary;
  const fat = simulateAscent(PATHFINDER_FAT_FAIRING).summary;
  assert.ok(fat.losses.drag > 2 * slim.losses.drag);
  assert.ok(fat.apogee < slim.apogee);
});

test("a vacuum bell separates on the pad and pays back-pressure", () => {
  const vac = simulateAscent(PATHFINDER_VAC_BELL);
  const sl = simulateAscent(PATHFINDER);
  assert.ok(vac.events.some((e) => e.kind === "flow-separation" && e.t === 0));
  assert.ok(!sl.events.some((e) => e.kind === "flow-separation"));
  assert.ok(vac.summary.losses.backPressure > 2 * sl.summary.losses.backPressure);
});

test("an overweight stack never leaves the pad", () => {
  const result = simulateAscent(PATHFINDER_OVERFUELLED);
  assert.equal(result.outcome, "no-liftoff");
  assert.ok(!kinds(PATHFINDER_OVERFUELLED).includes("liftoff"));
  assert.match(debrief(result, PATHFINDER_OVERFUELLED), /never left the pad/);
});

test("a tight load budget is reported as exceeded", () => {
  const fragile: Vehicle = { ...PATHFINDER, limits: { ...PATHFINDER.limits, maxDynamicPressure: 20_000 } };
  const result = simulateAscent(fragile);
  assert.ok(result.events.some((e) => e.kind === "q-limit-exceeded"));
  assert.match(debrief(result, fragile), /Max-q .* of the 20\.0 kPa load budget/);
});

test("staging drops the booster and ignites the upper stage", () => {
  const result = simulateAscent(PATHFINDER_TWO_STAGE);
  const order = result.events.map((e) => e.kind).filter((k) => ["meco", "staging", "ignition"].includes(k));
  assert.deepEqual(order, ["ignition", "meco", "staging", "ignition", "meco"]);
  assert.ok(result.summary.apogee > simulateAscent(PATHFINDER).summary.apogee);
});

test("debrief names the physics, not a reliability score", () => {
  const text = debrief(simulateAscent(PATHFINDER_VAC_BELL), PATHFINDER_VAC_BELL);
  assert.match(text, /over-expanded/);
  assert.match(text, /Lost to back-pressure/);
  assert.doesNotMatch(text, /reliability/i);
});
