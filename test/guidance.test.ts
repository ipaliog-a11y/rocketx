import assert from "node:assert/strict";
import { test } from "node:test";
import { MU_EARTH, R_EARTH } from "../src/sim/constants.ts";
import { commandedPitch, kickDue, type GuidanceInput, type PitchProgram } from "../src/sim/guidance.ts";
import { isOrbit, orbitFrom } from "../src/sim/orbit.ts";

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);

const DEG = Math.PI / 180;
const at = (input: Partial<GuidanceInput>): GuidanceInput => ({
  t: 0,
  kickStart: null,
  flightPathAngle: 90 * DEG,
  stage: 0,
  stageBurnFraction: 0,
  ...input,
});

const turn: PitchProgram = {
  kind: "gravity-turn",
  kickSpeed: 60,
  kickAngle: 6,
  kickDuration: 4,
  upperStage: { startPitch: 20, endPitch: -4 },
};

test("gravity turn rises vertically until the kick", () => {
  near(commandedPitch(turn, at({ t: 10 })), 90 * DEG, 1e-12);
  assert.equal(kickDue(turn, 59), false);
  assert.equal(kickDue(turn, 60), true);
  assert.equal(kickDue({ kind: "vertical" }, 1_000), false);
});

test("gravity turn ramps through the kick, then holds until prograde catches up", () => {
  near(commandedPitch(turn, at({ t: 12, kickStart: 10 })), 87 * DEG, 1e-12);
  near(commandedPitch(turn, at({ t: 20, kickStart: 10, flightPathAngle: 89 * DEG })), 84 * DEG, 1e-12);
  near(commandedPitch(turn, at({ t: 40, kickStart: 10, flightPathAngle: 50 * DEG })), 50 * DEG, 1e-12);
});

test("upper-stage ramp runs from start to end pitch across the burn", () => {
  near(commandedPitch(turn, at({ stage: 1, stageBurnFraction: 0 })), 20 * DEG, 1e-12);
  near(commandedPitch(turn, at({ stage: 1, stageBurnFraction: 0.5 })), 8 * DEG, 1e-12);
  near(commandedPitch(turn, at({ stage: 1, stageBurnFraction: 1 })), -4 * DEG, 1e-12);
});

test("schedule interpolates and holds its last value", () => {
  const schedule: PitchProgram = { kind: "schedule", points: [[0, 90], [10, 90], [60, 40], [200, 5]] };
  near(commandedPitch(schedule, at({ t: 5 })), 90 * DEG, 1e-12);
  near(commandedPitch(schedule, at({ t: 35 })), 65 * DEG, 1e-12);
  near(commandedPitch(schedule, at({ t: 500 })), 5 * DEG, 1e-12);
});

test("circular orbit has zero eccentricity and equal apsides", () => {
  const r = R_EARTH + 400_000;
  const v = Math.sqrt(MU_EARTH / r);
  const orbit = orbitFrom(0, r, v, 0);
  near(orbit.eccentricity, 0, 1e-9);
  near(orbit.periapsis, 400_000, 1e-3);
  near(orbit.apoapsis, 400_000, 1e-3);
  near(orbit.circularSpeed, v, 1e-9);
  assert.equal(isOrbit(orbit), true);
});

test("orbit elements are independent of where on the circle we measure", () => {
  const r = R_EARTH + 300_000;
  const v = Math.sqrt(MU_EARTH / r) * 1.02;
  const a = orbitFrom(0, r, v, 0);
  const angle = 1.1;
  const b = orbitFrom(r * Math.sin(angle), r * Math.cos(angle), v * Math.cos(angle), -v * Math.sin(angle));
  near(b.periapsis, a.periapsis, 1e-3);
  near(b.apoapsis, a.apoapsis, 1e-3);
});

test("too slow or too low is not an orbit", () => {
  const r = R_EARTH + 300_000;
  assert.equal(isOrbit(orbitFrom(0, r, 0.9 * Math.sqrt(MU_EARTH / r), 0)), false);
  const low = R_EARTH + 80_000;
  assert.equal(isOrbit(orbitFrom(0, low, Math.sqrt(MU_EARTH / low), 0)), false);
  assert.equal(isOrbit(orbitFrom(0, r, 2 * Math.sqrt(MU_EARTH / r), 0)), false);
});
