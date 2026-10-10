import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent, type AscentOptions, type FlightResult } from "../src/sim/ascent.ts";
import { MU_EARTH, R_EARTH } from "../src/sim/constants.ts";
import { debrief as writeDebrief } from "../src/sim/debrief.ts";
import { LEO_300, LEO_EQUATORIAL, SSO_500, SUBORBITAL_TEST } from "../src/missions.ts";
import { idealDeltaV, type Vehicle } from "../src/sim/vehicle.ts";
import {
  MERIDIAN,
  MERIDIAN_HARD_KICK,
  MERIDIAN_LOFTED,
  PATHFINDER,
  PATHFINDER_FAT_FAIRING,
  PATHFINDER_OVERFUELLED,
  PATHFINDER_TWO_STAGE,
  PATHFINDER_VAC_BELL,
} from "../src/vehicles.ts";

/** Steered vehicles fly the LEO contract; sounding rockets fly a test from the same pad. */
const missionFor = (v: Vehicle) => (v.pitchProgram ? LEO_300 : SUBORBITAL_TEST);
const fly = (v: Vehicle, options?: AscentOptions) => simulateAscent(v, missionFor(v), options);
const debrief = (result: FlightResult, v: Vehicle) => writeDebrief(result, v, missionFor(v));

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);

const kinds = (v: Vehicle) => fly(v).events.map((e) => e.kind);

test("ground speed at shutdown equals delivered Δv minus every loss", () => {
  const vehicles = [PATHFINDER, PATHFINDER_FAT_FAIRING, PATHFINDER_VAC_BELL, PATHFINDER_TWO_STAGE, MERIDIAN, MERIDIAN_LOFTED];
  for (const vehicle of vehicles) {
    const { summary } = fly(vehicle);
    const { gravity, drag, backPressure, steering } = summary.losses;
    near(summary.burnoutGroundSpeed, summary.idealDeltaV - gravity - drag - backPressure - steering, 1e-6);
  }
});

test("integrated Δv matches the rocket equation", () => {
  for (const vehicle of [PATHFINDER, PATHFINDER_TWO_STAGE]) {
    const expected = idealDeltaV(vehicle).reduce((a, b) => a + b, 0);
    near(fly(vehicle).summary.idealDeltaV, expected, expected * 1e-6);
  }
});

test("drag-free coast conserves orbital energy to apogee", () => {
  const vehicle: Vehicle = {
    ...PATHFINDER,
    dragCurve: [[0, 0]],
    stages: [{ ...PATHFINDER.stages[0]!, engine: { ...PATHFINDER.stages[0]!.engine, exitArea: 0 } }],
  };
  const { summary } = fly(vehicle, { rotatingEarth: false });
  const rb = R_EARTH + summary.burnoutAltitude;
  const energy = (summary.burnoutVelocity ** 2) / 2 - MU_EARTH / rb;
  const expectedApogee = -MU_EARTH / energy - R_EARTH;
  near(summary.apogee, expectedApogee, 50);
  near(summary.losses.drag, 0, 1e-9);
  near(summary.losses.backPressure, 0, 1e-9);
});

test("apogee converges as the step shrinks", () => {
  const coarse = fly(PATHFINDER, { dt: 0.1 }).summary.apogee;
  const fine = fly(PATHFINDER, { dt: 0.01 }).summary.apogee;
  near(coarse, fine, fine * 1e-3);
});

test("events come out in time order with one max-q", () => {
  const { events } = fly(PATHFINDER);
  for (let i = 1; i < events.length; i++) assert.ok(events[i]!.t >= events[i - 1]!.t);
  assert.equal(events.filter((e) => e.kind === "max-q").length, 1);
  assert.deepEqual(
    events.map((e) => e.kind).filter((k) => k !== "max-q" && k !== "mach-1"),
    ["ignition", "liftoff", "meco", "apogee"],
  );
});

test("max-q happens while supersonic and below the budget for Pathfinder", () => {
  const { summary } = fly(PATHFINDER);
  assert.ok(summary.maxQ.mach > 1);
  assert.ok(summary.maxQ.value < PATHFINDER.limits.maxDynamicPressure);
  assert.ok(summary.maxQ.altitude > 5_000 && summary.maxQ.altitude < 20_000);
});

test("a fat fairing costs drag and altitude", () => {
  const slim = fly(PATHFINDER).summary;
  const fat = fly(PATHFINDER_FAT_FAIRING).summary;
  assert.ok(fat.losses.drag > 2 * slim.losses.drag);
  assert.ok(fat.apogee < slim.apogee);
});

test("a vacuum bell separates on the pad and pays back-pressure", () => {
  const vac = fly(PATHFINDER_VAC_BELL);
  const sl = fly(PATHFINDER);
  assert.ok(vac.events.some((e) => e.kind === "flow-separation" && e.t === 0));
  assert.ok(!sl.events.some((e) => e.kind === "flow-separation"));
  assert.ok(vac.summary.losses.backPressure > 2 * sl.summary.losses.backPressure);
});

test("an overweight stack never leaves the pad", () => {
  const result = fly(PATHFINDER_OVERFUELLED);
  assert.equal(result.outcome, "no-liftoff");
  assert.ok(!kinds(PATHFINDER_OVERFUELLED).includes("liftoff"));
  assert.match(debrief(result, PATHFINDER_OVERFUELLED), /never left the pad/);
});

test("a tight load budget is reported as exceeded", () => {
  const fragile: Vehicle = { ...PATHFINDER, limits: { ...PATHFINDER.limits, maxDynamicPressure: 20_000 } };
  const result = fly(fragile);
  assert.ok(result.events.some((e) => e.kind === "q-limit-exceeded"));
  assert.match(debrief(result, fragile), /Max-q .* of the 20\.0 kPa load budget/);
});

test("staging drops the booster and ignites the upper stage", () => {
  const result = fly(PATHFINDER_TWO_STAGE);
  const order = result.events.map((e) => e.kind).filter((k) => ["meco", "staging", "ignition"].includes(k));
  assert.deepEqual(order, ["ignition", "meco", "staging", "ignition", "meco"]);
  assert.ok(result.summary.apogee > fly(PATHFINDER).summary.apogee);
});

test("debrief names the physics, not a reliability score", () => {
  const text = debrief(fly(PATHFINDER_VAC_BELL), PATHFINDER_VAC_BELL);
  assert.match(text, /over-expanded/);
  assert.match(text, /Lost to back-pressure/);
  assert.doesNotMatch(text, /reliability/i);
});

test("on a still Earth a vertical flight stays on the pad's local vertical", () => {
  const { samples, summary } = fly(PATHFINDER, { rotatingEarth: false });
  for (const x of samples) near(x.downrange, 0, 1e-6);
  near(summary.losses.steering, 0, 1e-9);
});

test("Meridian's gravity turn reaches a stable orbit", () => {
  const result = fly(MERIDIAN);
  assert.equal(result.outcome, "orbit");
  const orbit = result.summary.orbit!;
  assert.ok(orbit.periapsis > 160_000, `periapsis ${orbit.periapsis}`);
  assert.ok(orbit.eccentricity < 0.05);
  const order = result.events.map((e) => e.kind).filter((k) => ["liftoff", "pitch-kick", "staging", "orbit"].includes(k));
  assert.deepEqual(order, ["liftoff", "pitch-kick", "staging", "orbit"]);
  assert.match(debrief(result, MERIDIAN), /^Orbit .* × .*, eccentricity/m);
});

test("the orbit converges as the step shrinks", () => {
  const coarse = fly(MERIDIAN, { dt: 0.1 }).summary.orbit!;
  const fine = fly(MERIDIAN, { dt: 0.01 }).summary.orbit!;
  near(coarse.periapsis, fine.periapsis, 500);
  near(coarse.apoapsis, fine.apoapsis, 500);
});

test("the pitch programme turns the trajectory over", () => {
  const { samples } = fly(MERIDIAN);
  const last = samples[samples.length - 1]!;
  assert.ok(last.downrange > 500_000);
  assert.ok(Math.abs(last.flightPathAngle) < 5, `ended at ${last.flightPathAngle}°`);
  assert.ok(samples.some((x) => x.pitch < 89 && x.t < 30), "no kick in the first 30 s");
});

test("a timid kick lofts the vehicle and pays for it in gravity loss", () => {
  const good = fly(MERIDIAN).summary;
  const lofted = fly(MERIDIAN_LOFTED);
  assert.equal(lofted.outcome, "apogee");
  assert.ok(lofted.summary.losses.gravity > good.losses.gravity + 500);
  assert.ok(lofted.summary.losses.steering > good.losses.steering);
  assert.match(debrief(lofted, MERIDIAN_LOFTED), /Short of orbit/);
});

test("a hard kick in thick air blows the side-load budget", () => {
  const result = fly(MERIDIAN_HARD_KICK);
  assert.ok(result.events.some((e) => e.kind === "q-alpha-limit-exceeded"));
  assert.ok(result.summary.maxQAlpha.value > MERIDIAN.limits.maxQAlpha!);
  assert.ok(!fly(MERIDIAN).events.some((e) => e.kind === "q-alpha-limit-exceeded"));
  assert.match(debrief(result, MERIDIAN_HARD_KICK), /turned while the air was still thick/);
});

test("a pitch schedule is followed", () => {
  const scheduled: Vehicle = {
    ...MERIDIAN,
    pitchProgram: { kind: "schedule", points: [[0, 90], [10, 90], [110, 30], [400, 0]] },
  };
  const { samples } = fly(scheduled);
  const at60 = samples.find((x) => Math.abs(x.t - 60) < 0.5)!;
  near(at60.pitch, 60, 0.5);
});

test("a sounding rocket on a spinning Earth lands west of the pad", () => {
  // It keeps the pad's eastward speed while climbing to a larger radius,
  // so it falls behind the ground turning underneath it.
  const { samples, summary } = fly(PATHFINDER);
  near(summary.rotationBoost, 408.4, 0.5);
  const last = samples[samples.length - 1]!;
  assert.ok(last.downrange < -1_000 && last.downrange > -20_000, `drifted ${last.downrange} m`);
});

test("Meridian inserts into the LEO contract in spec and keeps a margin", () => {
  const result = fly(MERIDIAN);
  const ins = result.summary.insertion!;
  assert.equal(ins.inSpec, true);
  assert.ok(result.events.some((e) => e.kind === "cutoff"));
  assert.ok(result.summary.propellantMargin > 0);
  near(ins.inclinationError, 0, 1e-9);
  assert.match(debrief(result, MERIDIAN), /IN SPEC/);
});

test("energy cutoff lands on the target's semi-major axis", () => {
  const orbit = fly(MERIDIAN).summary.orbit!;
  near(orbit.periapsis + orbit.apoapsis, 600_000, 100);
});

test("propellant margin is what the last stage still carries", () => {
  const { samples, summary } = fly(MERIDIAN);
  const upper = MERIDIAN.stages[1]!;
  near(samples[samples.length - 1]!.mass, MERIDIAN.payloadMass + upper.dryMass + summary.propellantMargin, 1e-6);
});

test("the Earth's spin is worth propellant", () => {
  const spinning = fly(MERIDIAN).summary;
  const still = fly(MERIDIAN, { rotatingEarth: false }).summary;
  assert.ok(spinning.propellantMargin > still.propellantMargin);
});

test("Port Avery cannot reach an equatorial orbit directly", () => {
  const result = simulateAscent(MERIDIAN, LEO_EQUATORIAL);
  const ins = result.summary.insertion!;
  assert.equal(result.outcome, "orbit");
  assert.equal(ins.inSpec, false);
  near(ins.inclinationError, 28.5, 1e-9);
  assert.match(writeDebrief(result, MERIDIAN, LEO_EQUATORIAL), /no launch from there goes directly into an orbit inclined less/);
});

test("a retrograde SSO costs Meridian the orbit", () => {
  const result = simulateAscent(MERIDIAN, SSO_500);
  assert.ok(result.summary.rotationBoost < 0);
  assert.notEqual(result.outcome, "orbit");
  assert.equal(result.summary.insertion!.inSpec, false);
  assert.ok(result.summary.maxQ.t < 200, "max-q should come from the ascent, not the fall");
  assert.match(writeDebrief(result, MERIDIAN, SSO_500), /from the Earth's spin/);
});
