import assert from "node:assert/strict";
import { test } from "node:test";
import { P_SEA_LEVEL } from "../src/sim/constants.ts";
import { flowSeparates } from "../src/sim/engine.ts";
import {
  BLADE_REDLINE,
  buildable,
  cfVac,
  defaultDesign,
  designEngine,
  designLimits,
  designOf,
  epsForPressureRatio,
  maxDrivenPressure,
  MIN_PUMP_MARGIN,
  nozzleFor,
  performance,
  pressureRatio,
  sameDesign,
  seaLevelEps,
} from "../src/sim/enginePhysics.ts";
import { combineTruth, rollPartTruths } from "../src/sim/hardware.ts";
import { assembleEngine, CYCLES, COOLINGS, NOZZLES, type EngineParts, type NozzleOption } from "../src/sim/parts.ts";
import { engineMass } from "../src/sim/builder.ts";

const GG: EngineParts = { size: 100, cycle: "gas-generator", injector: "coaxial", cooling: "regenerative", nozzle: "sea-level" };
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("the ideal nozzle: expansion ratio and pressure ratio invert each other, and Cf grows with the bell", () => {
  for (const eps of [3, 10, 40, 150]) near(epsForPressureRatio(pressureRatio(eps)), eps, eps * 1e-6, `ε ${eps}`);
  const cfs = [4, 8, 20, 60, 150].map(cfVac);
  for (let i = 1; i < cfs.length; i++) assert.ok(cfs[i]! > cfs[i - 1]!, "Cf_vac rises with ε");
  near(cfVac(8), 1.71, 0.02, "Cf_vac at ε 8, γ 1.2");
});

test("each cycle's reference point reproduces the catalogue: Isp, thrust, cost and mass", () => {
  for (const cycle of ["pressure-fed", "electric-pump", "gas-generator"] as const) {
    const parts: EngineParts = { ...GG, size: CYCLES[cycle].sizes[1]!, cycle };
    const old = assembleEngine(parts, "old");
    const p = performance(parts, defaultDesign(parts));
    near(p.ispVac, CYCLES[cycle].isp * COOLINGS[parts.cooling].isp, 0.6, `${cycle} Isp`);
    assert.equal(p.thrustVac, parts.size * 1000, `${cycle} thrust`);
    near(p.unitCost, old.unitCost!, 1, `${cycle} cost`);
    near(p.mass, engineMass(old), 1, `${cycle} mass`);
  }
});

test("other bells land within a few percent of the catalogue, and each default sits in its own nozzle band", () => {
  for (const nozzle of Object.keys(NOZZLES) as NozzleOption[]) {
    const parts = { ...GG, nozzle };
    const d = defaultDesign(parts);
    assert.equal(nozzleFor("gas-generator", d.eps), nozzle);
    const p = performance(parts, d);
    near(p.ispVac / assembleEngine(parts, "x").ispVac, 1, 0.012, `${nozzle} Isp`);
  }
});

test("a bigger bell: more vacuum Isp, less at sea level past the optimum, and separation exactly at 40% of ambient", () => {
  const at = (eps: number) => designEngine(GG, { ...defaultDesign(GG), eps }, "x");
  assert.ok(at(40).ispVac > at(12).ispVac);
  assert.ok(at(40).exitPressure < at(12).exitPressure);
  const edge = seaLevelEps("gas-generator", 70);
  assert.equal(flowSeparates(at(edge * 0.98), P_SEA_LEVEL), false);
  assert.equal(flowSeparates(at(edge * 1.02), P_SEA_LEVEL), true);
  const sep = (eps: number) => designLimits(GG, { ...defaultDesign(GG), eps }).find((l) => l.id === "separation-sl")!;
  assert.equal(sep(edge * 1.02).ok, false);
  assert.ok(sep(edge * 1.02).warning, "separation is a warning: an upper-stage engine is still buildable");
  assert.ok(buildable(designLimits(GG, { ...defaultDesign(GG), eps: edge * 1.5 })));
});

test("chamber pressure: thrust through the same throat, better T/W, shorter life, and the feed must keep up", () => {
  const base = defaultDesign(GG);
  const lo = performance(GG, base);
  const hi = performance(GG, { ...base, pc: 100, pd: 135 });
  near(hi.thrustVac / lo.thrustVac, 100 / 70, 0.01, "thrust ∝ Pc");
  assert.ok(hi.thrustVac / hi.mass > lo.thrustVac / lo.mass, "T/W improves");
  assert.ok(hi.ratedLife < lo.ratedLife, "chamber life falls");
  assert.ok(hi.unitCost > lo.unitCost);
  const soft = designLimits(GG, { ...base, pc: 100, pd: 100 * (MIN_PUMP_MARGIN - 0.02) });
  assert.equal(soft.find((l) => l.id === "pump-margin")!.ok, false);
  assert.equal(buildable(soft), false);
});

test("a soft feed raises the instability chance; a stiff one leaves the injector's own", () => {
  const base = defaultDesign(GG);
  const stiff = performance(GG, { ...base, pd: base.pc * 1.4 });
  const soft = performance(GG, { ...base, pd: base.pc * 1.22 });
  assert.equal(stiff.instability, 0.22);
  assert.ok(soft.instability > stiff.instability);
});

test("the gas generator: hotter gas means less turbine flow and more Isp, up to the blade redline", () => {
  const base = defaultDesign(GG);
  const cool = performance(GG, { ...base, t0: 800 });
  const hot = performance(GG, { ...base, t0: 940 });
  assert.ok(hot.turbineFlow < cool.turbineFlow);
  assert.ok(hot.ispVac > cool.ispVac);
  assert.ok(hot.unitCost > cool.unitCost);
  const over = designLimits(GG, { ...base, t0: BLADE_REDLINE + 10 });
  assert.equal(over.find((l) => l.id === "blade-temp")!.ok, false);
  // More pump pressure than the turbine can drive at that temperature.
  const t0 = 800;
  const driven = designLimits(GG, { ...base, pc: 110, t0, pd: maxDrivenPressure(t0) + 5 });
  assert.equal(driven.find((l) => l.id === "turbine-power")!.ok, false);
  assert.equal(driven.find((l) => l.id === "pump-margin")!.ok, true);
});

test("pressure-fed tanks have a ceiling; a cycle can't be built at a size it doesn't come in", () => {
  const pf: EngineParts = { ...GG, size: 25, cycle: "pressure-fed" };
  assert.equal(designLimits(pf, { ...defaultDesign(pf), pd: 38 }).find((l) => l.id === "tank-pressure")!.ok, false);
  const wrong: EngineParts = { ...GG, size: 600, cycle: "pressure-fed" };
  assert.equal(designLimits(wrong, defaultDesign(wrong)).find((l) => l.id === "size-for-cycle")!.ok, false);
});

test("an engine from before the model gets the design point its parts and exit pressure imply", () => {
  const old = assembleEngine({ ...GG, nozzle: "vacuum" }, "old");
  const d = designOf(old)!;
  assert.equal(d.pc, 70);
  assert.equal(nozzleFor("gas-generator", d.eps), "vacuum");
  assert.ok(sameDesign(d, { ...d }));
  assert.ok(!sameDesign(d, { ...d, pc: 71 }));
});

test("the soft-feed instability roll is seeded: same engine, same seed, same truth", () => {
  const base = defaultDesign({ ...GG, injector: "pintle" });
  const soft = designEngine({ ...GG, injector: "pintle" }, { ...base, pd: base.pc * 1.2 }, "Soft");
  const table = rollPartTruths([soft], 7);
  for (const k of Object.keys(table)) table[k] = { ...table[k]!, instabilityOnset: null };
  const a = combineTruth(soft, table, 7);
  const b = combineTruth(soft, table, 7);
  assert.deepEqual(a, b);
  // Across many seeds the added chance shows up at about the expected rate.
  let unstable = 0;
  for (let seed = 0; seed < 400; seed++) if (combineTruth(soft, table, seed).instabilityOnset !== null) unstable++;
  const added = (soft.instability! - 0.08) / (1 - 0.08);
  near(unstable / 400, added, 0.06, "added instability rate");
});
