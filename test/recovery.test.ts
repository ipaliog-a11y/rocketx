import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { assembleVehicle, checkVehicle, fitControl, specOf, type VehicleSpec } from "../src/sim/builder.ts";
import { defaultGeometry } from "../src/sim/geometry.ts";
import { landingMargin } from "../src/sim/landing.ts";
import { defaultRecovery, flyHome, PAD_RADIUS, TOUCHDOWN_SPEED, type RecoveryDesign } from "../src/sim/recovery.ts";
import { MISSIONS } from "../src/missions.ts";
import { ENGINES, VEHICLES } from "../src/vehicles.ts";

const engines = Object.fromEntries(Object.values(ENGINES).map((e) => [e.name, e]));
const meridian = Object.values(VEHICLES).find((v) => v.name === "Meridian")!;
const LEO = MISSIONS["leo-300"]!;
const drawn = (recovery?: Partial<RecoveryDesign> & { mode?: RecoveryDesign["mode"] }): VehicleSpec =>
  fitControl({ ...specOf(meridian), payloadMass: 0, geometry: { ...defaultGeometry(2), ...(recovery ? { recovery: { ...defaultRecovery(recovery.mode), ...recovery } } : {}) } }, engines);
const flyable = (spec: VehicleSpec) => ({ ...assembleVehicle(spec, engines), pitchProgram: meridian.pitchProgram });
const boosterOf = (v: ReturnType<typeof flyable>) => {
  const b = v.stages[0]!;
  return { engine: b.engine, engineCount: b.engineCount, diameter: b.diameter, recovery: v.geometry!.recovery! };
};

test("legs, fins and a heat shield weigh on the booster; an expendable drawing has no flight home", () => {
  const plain = flyable(drawn());
  const back = flyable(drawn({ mode: "drone-ship" }));
  assert.ok(back.stages[0]!.dryMass > plain.stages[0]!.dryMass * 1.07);
  assert.equal(back.stages[1]!.dryMass, plain.stages[1]!.dryMass);
  assert.equal(simulateAscent(plain, LEO, {}).recovery, undefined);
});

test("the reserve held back costs the upper stage: less left at orbit", () => {
  const left = (spec: VehicleSpec) => simulateAscent(flyable(spec), LEO, {}).events.find((e) => e.kind === "cutoff")?.value ?? 0;
  const expended = left(drawn());
  assert.ok(left(drawn({ mode: "drone-ship", reserve: 0.12 })) < expended - 30, "reserve should cost propellant at orbit");
});

test("with enough reserve the booster lands on the drone ship; with too little it runs dry", () => {
  const r = simulateAscent(flyable(drawn({ mode: "drone-ship", reserve: 0.14 })), LEO, {});
  assert.equal(r.outcome, "orbit");
  const home = r.recovery!;
  assert.equal(home.outcome, "landed", `${home.cause}`);
  assert.ok(home.touchdown!.speed <= TOUCHDOWN_SPEED);
  assert.ok(home.touchdown!.miss < PAD_RADIUS["drone-ship"]);
  assert.deepEqual(home.burns.map((b) => b.name), ["entry", "landing"]);
  const dry = simulateAscent(flyable(drawn({ mode: "drone-ship", reserve: 0.04 })), LEO, {}).recovery!;
  // Too little to burn the entry and still land: it saves what it has for the landing, and the entry burns it.
  assert.equal(dry.outcome, "lost");
  assert.ok(dry.cause === "out-of-propellant" || dry.cause === "entry-heating", dry.cause);
});

test("the trip back to the pad costs more than the drone ship: the same reserve is short", () => {
  const ship = landingMargin(flyable(drawn({ mode: "drone-ship", reserve: 0.14 })), LEO)!;
  const pad = landingMargin(flyable(drawn({ mode: "rtls", reserve: 0.14 })), LEO)!;
  assert.ok(ship.propellant > 0 && ship.deltaV > 0);
  assert.ok(pad.propellant < 0, `${pad.propellant}`);
  assert.equal(pad.recovery!.burns[0]!.name, "boostback");
  assert.ok(Math.abs(pad.recovery!.landedAt) < 2_000, "it should have turned back to the pad");
});

test("an engine that won't relight can't come home", () => {
  const v = flyable(drawn({ mode: "drone-ship", reserve: 0.14 }));
  const sep = simulateAscent(v, LEO, {}).recovery!.separation;
  const r = flyHome(boosterOf(v), sep, { relightFails: true });
  assert.equal(r.cause, "no-relight");
  assert.equal(r.burns.length, 0);
});

test("grid fins: a landing in metres; without them it scatters by a hundred", () => {
  const v = flyable(drawn({ mode: "drone-ship", reserve: 0.14 }));
  const sep = simulateAscent(v, LEO, {}).recovery!.separation;
  const miss = (gridFins: boolean) => {
    let sum = 0;
    for (let seed = 1; seed <= 8; seed++) sum += flyHome({ ...boosterOf(v), recovery: { ...boosterOf(v).recovery, gridFins } }, sep, { seed }).touchdown?.miss ?? 1e4;
    return sum / 8;
  };
  assert.ok(miss(true) < 20, `${miss(true)}`);
  assert.ok(miss(false) > 4 * miss(true), `${miss(false)} vs ${miss(true)}`);
});

test("the entry burn keeps the base cool; without the propellant for it the entry runs hot", () => {
  const v = flyable(drawn({ mode: "drone-ship", reserve: 0.14 }));
  const sep = simulateAscent(v, LEO, {}).recovery!.separation;
  const full = flyHome(boosterOf(v), sep);
  const short = flyHome(boosterOf(v), { ...sep, propellant: 0 });
  assert.ok(full.burns.some((b) => b.name === "entry"));
  assert.ok(!short.burns.some((b) => b.name === "entry"));
  assert.ok(short.peakHeating > 1.5 * full.peakHeating, `${short.peakHeating} vs ${full.peakHeating} ${JSON.stringify(full.burns)} ${short.cause}`);
});

test("checks: a recoverable design needs legs and a booster to bring back", () => {
  assert.deepEqual(checkVehicle(drawn({ mode: "drone-ship" }), engines).problems, []);
  assert.ok(checkVehicle(drawn({ mode: "drone-ship", legs: false }), engines).problems.some((p) => /legs/.test(p)));
  assert.ok(checkVehicle(drawn({ mode: "drone-ship", reserve: 0.6 }), engines).problems.some((p) => /reserve/.test(p)));
  const one: VehicleSpec = { name: "Hop", stages: [{ diameter: 0.8, tankLength: 3, engine: meridian.stages[0]!.engine.name, engineCount: 1 }], fairingDiameter: 0.8, payloadMass: 50, geometry: { ...defaultGeometry(1), recovery: defaultRecovery() } };
  assert.ok(checkVehicle(one, engines).problems.some((p) => /single stage/.test(p)));
});

test("the paper check says when a big reserve stages the booster too low for the upper stage", () => {
  const m = landingMargin(flyable(drawn({ mode: "rtls", reserve: 0.3 })), LEO)!;
  assert.equal(m.ascent, "failure");
  assert.equal(m.ascentLoss?.kind, "loss-of-control");
  assert.equal(m.ascentLoss?.stage, 1);
  assert.ok(m.stagingQ > 5_000, `${m.stagingQ}`);
});
