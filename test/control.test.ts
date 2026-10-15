import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { assembleVehicle, checkVehicle, fitControl, specOf, type VehicleSpec } from "../src/sim/builder.ts";
import { configAt, controlStep, defaultControl, designPoint, newLoop, OSC_LOST, type ControlDesign, type GncFlight } from "../src/sim/control.ts";
import { defaultGeometry } from "../src/sim/geometry.ts";
import { rollWind, windAt } from "../src/sim/wind.ts";
import { MISSIONS } from "../src/missions.ts";
import { ENGINES, VEHICLES } from "../src/vehicles.ts";

const engines = Object.fromEntries(Object.values(ENGINES).map((e) => [e.name, e]));
const meridian = Object.values(VEHICLES).find((v) => v.name === "Meridian")!;
const LEO = MISSIONS["leo-300"]!;
const drawn = (control: Partial<ControlDesign> = {}): VehicleSpec => ({ ...specOf(meridian), geometry: { ...defaultGeometry(2), control: { ...defaultControl(2), ...control } } });
const flyable = (spec: VehicleSpec) => ({ ...assembleVehicle(spec, engines), pitchProgram: meridian.pitchProgram });
const clean: GncFlight = { bending: 1, notchAt: null, slosh: [0.3, 0.3], imuBias: 0, flaw: null };

test("trim: the gimbal angle balances the air's moment about the centre of mass", () => {
  const v = flyable(drawn());
  const model = v.control!;
  const c = configAt(model, 0, 0.5, 1.3);
  const step = { stage: 0, burned: 0.5, mach: 1.3, q: 30_000, alpha: (2 * Math.PI) / 180, thrust: 500_000, axial: 20, massRatio: 1.5, dt: 1 };
  const loop = newLoop();
  const r = controlStep(model, clean, step, loop);
  const hand = (Math.asin((30_000 * c.area * c.cnAlpha * step.alpha * Math.abs(c.cg - c.cp)) / (500_000 * (c.nozzle - c.cg))) * 180) / Math.PI;
  assert.ok(Math.abs(r.delta - (hand + loop.amp * 0.5)) < 1e-6, `${r.delta} vs ${hand}`);
  // More gimbal range, less of it used.
  const wide = { ...model, design: { ...model.design, gimbal: 8 } };
  assert.ok(controlStep(wide, clean, step, newLoop()).effort < r.effort);
});

test("an airframe that diverges faster than the loop can catch is lost; a faster loop holds it", () => {
  const slow = flyable(drawn({ bandwidth: 0.3 }));
  const r = simulateAscent(slow, LEO, {});
  const lost = r.events.find((e) => e.kind === "loss-of-control");
  assert.equal(lost?.cause, "divergence");
  assert.ok(checkVehicle(drawn({ bandwidth: 0.3 }), engines).problems.some((p) => /diverges/.test(p)));
  const fast = flyable(drawn({ bandwidth: 1.5 }));
  assert.notEqual(simulateAscent(fast, LEO, {}).outcome, "failure");
});

test("the bending mode: no notch couples a fast loop; a notch at the real frequency holds; at a wrong one it doesn't", () => {
  const spec = drawn({ bandwidth: 3, notch: false });
  const v = flyable(spec);
  assert.ok(designPoint(v.control!).bendingGain > 0.25);
  const bare = simulateAscent(v, LEO, { gnc: { [v.name]: clean } });
  assert.equal(bare.events.find((e) => e.kind === "loss-of-control")?.mode, "control-structure-coupling");
  const notched = flyable(drawn({ bandwidth: 3, notch: true }));
  const right = { ...clean, bending: 0.85, notchAt: notched.control!.bendingFrequency * 0.85 };
  assert.notEqual(simulateAscent(notched, LEO, { gnc: { [notched.name]: right } }).outcome, "failure");
  const wrong = { ...clean, bending: 0.85, notchAt: notched.control!.bendingFrequency };
  assert.equal(simulateAscent(notched, LEO, { gnc: { [notched.name]: wrong } }).events.find((e) => e.kind === "loss-of-control")?.cause, "bending");
});

test("slosh near the loop rings it up without baffles; baffles take it out", () => {
  const model = flyable(drawn({ baffles: false })).control!;
  const step = { stage: 0, burned: 0.5, mach: 1.3, q: 30_000, alpha: 0, thrust: 500_000, axial: 0, massRatio: 1.5, dt: 0.05 };
  // Find the acceleration that puts the slosh mode on the loop's frequency.
  const r = configAt(model, 0, 0.5, 1.3).tankRadius;
  const axial = (2 * Math.PI * model.design.bandwidth) ** 2 * r / 1.84;
  const sloshy = { ...clean, slosh: [0.8, 0.8] };
  assert.ok(controlStep(model, sloshy, { ...step, axial }, newLoop()).growth > 0);
  const baffled = { ...model, design: { ...model.design, baffles: true } };
  assert.ok(controlStep(baffled, sloshy, { ...step, axial }, newLoop()).growth < 0);
});

test("a gain-schedule error in its Mach band loses the vehicle", () => {
  const v = flyable(drawn());
  const flawed = { ...clean, flaw: { from: 1.2, to: 1.6, gain: 1 } };
  const r = simulateAscent(v, LEO, { gnc: { [v.name]: flawed } });
  const lost = r.events.find((e) => e.kind === "loss-of-control");
  assert.equal(lost?.cause, "software");
  assert.ok(lost!.mach >= 1.2 && lost!.mach <= 1.7);
  assert.ok((r.summary.control?.maxOscillation.value ?? 0) >= OSC_LOST);
});

test("IMU drift moves the insertion; a calibrated tenth of it barely does", () => {
  const v = flyable(drawn());
  const miss = (bias: number) => {
    const r = simulateAscent(v, LEO, { gnc: { [v.name]: { ...clean, imuBias: bias } } });
    return Math.abs((r.summary.orbit?.periapsis ?? 0) - (simulateAscent(v, LEO, { gnc: { [v.name]: clean } }).summary.orbit?.periapsis ?? 0));
  };
  const tactical = 10 / 3600;
  assert.ok(miss(tactical) > 5 * miss(tactical * 0.1), `${miss(tactical)} vs ${miss(tactical * 0.1)}`);
});

test("wind is seeded, calm above 30 km, and pink: long waves carry more than short ones", () => {
  const a = rollWind(7);
  assert.deepEqual(a, rollWind(7));
  assert.notDeepEqual(a.gust, rollWind(8).gust);
  assert.equal(Math.abs(windAt(a, 40_000).gust), 0);
  // Differences over a short step are smaller than over a long one.
  const diff = (lag: number) => {
    let s = 0;
    for (let h = 0; h < 12_000; h += 100) s += (windAt(a, h + lag).gust - windAt(a, h).gust) ** 2;
    return s;
  };
  assert.ok(diff(200) < diff(2000));
});

test("vehicles without the control model ignore wind and GNC options entirely", () => {
  const legacy = meridian;
  const calm = simulateAscent(legacy, LEO, {});
  const windy = simulateAscent(legacy, LEO, { wind: rollWind(3), gnc: { [legacy.name]: { ...clean, imuBias: 0.01 } } });
  assert.deepEqual(windy.summary, calm.summary);
  assert.equal(calm.summary.control, undefined);
  // An unguided sounding rocket flies on its fins: no loop.
  const one = assembleVehicle({ name: "Hop", stages: [{ diameter: 0.8, tankLength: 3, engine: meridian.stages[0]!.engine.name, engineCount: 1 }], fairingDiameter: 0.8, payloadMass: 50, geometry: defaultGeometry(1) }, engines);
  assert.equal(one.control, undefined);
});

test("checks: authority, and the guide's sizing clears a drawing the default loop can't fly", () => {
  assert.ok(checkVehicle(drawn({ gimbal: 0.5 }), engines).problems.some((p) => /gimbal/.test(p)));
  const pathfinder2 = Object.values(VEHICLES).find((v) => v.name === "Pathfinder two-stage")!;
  const spec: VehicleSpec = { ...specOf(pathfinder2), geometry: defaultGeometry(2) };
  assert.ok(checkVehicle(spec, engines).problems.length > 0);
  assert.deepEqual(checkVehicle(fitControl(spec, engines), engines).problems, []);
});
