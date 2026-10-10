import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { aeroShape } from "../src/sim/airframe.ts";
import { assembleVehicle, checkVehicle, designQuote, figures, specOf, type VehicleSpec } from "../src/sim/builder.ts";
import { build, designVehicle, newCompany, retuneForMission } from "../src/sim/company.ts";
import { vehicleCost } from "../src/sim/cost.ts";
import { IDEAL_TRUTH } from "../src/sim/hardware.ts";
import { orbitDeltaV, suggestBuilds } from "../src/sim/guide.ts";
import { retunePitch } from "../src/sim/tuning.ts";
import { generateBoard } from "../src/contracts.ts";
import { LEO_300, SUBORBITAL_TEST } from "../src/missions.ts";
import { ENGINES, MERIDIAN, PATHFINDER, PATHFINDER_TWO_STAGE, VEHICLES } from "../src/vehicles.ts";

const engines = Object.fromEntries(Object.values(ENGINES).map((e) => [e.name, e]));
const typical = Object.fromEntries(Object.values(ENGINES).map((e) => [e.name, { ...IDEAL_TRUTH, ispFactor: 0.975 }]));

test("a preset redrawn on the drawing board comes out close to the hand-drawn one", () => {
  for (const v of [PATHFINDER_TWO_STAGE, MERIDIAN]) {
    const copy = assembleVehicle(specOf(v), engines);
    v.stages.forEach((s, i) => {
      assert.ok(Math.abs(copy.stages[i]!.dryMass / s.dryMass - 1) < 0.12, `${s.name} dry mass`);
      assert.ok(Math.abs(copy.stages[i]!.propellantMass / s.propellantMass - 1) < 0.03, `${s.name} propellant`);
    });
    assert.ok(Math.abs(figures(copy).totalDeltaV / figures(v).totalDeltaV - 1) < 0.02, `${v.name} Δv`);
  }
  // The hand-drawn Pathfinder is overbuilt; the drawing board's version is lighter.
  assert.ok(assembleVehicle(specOf(PATHFINDER), engines).stages[0]!.dryMass < PATHFINDER.stages[0]!.dryMass);
});

const meridianSpec = (): VehicleSpec => ({ ...specOf(MERIDIAN), name: "Meridian B" });

test("the drawing board refuses designs that can't work", () => {
  assert.deepEqual(checkVehicle(meridianSpec(), engines).problems, []);
  const bad = (change: (s: VehicleSpec) => void, pattern: RegExp) => {
    const s = meridianSpec();
    change(s);
    assert.ok(checkVehicle(s, engines, ["Meridian"]).problems.some((p) => pattern.test(p)), String(pattern));
  };
  bad((s) => (s.name = "meridian"), /already a design/);
  bad((s) => (s.stages[1]!.diameter = 1.5), /can't be wider than the booster/);
  bad((s) => (s.fairingDiameter = 0.8), /fairing can't be narrower/);
  bad((s) => (s.stages[0]!.engineCount = 40), /only \d+ Harrier-SL fit/);
  bad((s) => (s.stages[0]!.engine = "Harrier-Vac"), /separates at sea level/);
  bad((s) => (s.stages[0]!.engineCount = 3), /won't leave the pad/);
  bad((s) => (s.stages[0]!.tankLength = 18), /too slender/);
  const wide = meridianSpec();
  wide.fairingDiameter = 1.5;
  assert.ok(checkVehicle(wide, engines).warnings.some((w) => /Hammerhead/.test(w)));
});

test("tooling is paid only for diameters the company has never built", () => {
  const existing = [PATHFINDER, PATHFINDER_TWO_STAGE, MERIDIAN];
  assert.deepEqual(designQuote(meridianSpec(), existing), { cost: 60, days: 10, newTanks: [], newFairing: false });
  const big = meridianSpec();
  big.stages[0]!.diameter = 1.5;
  big.fairingDiameter = 1.5;
  big.stages[1]!.diameter = 1.5;
  const q = designQuote(big, existing);
  assert.deepEqual(q.newTanks, [1.5]);
  assert.equal(q.newFairing, true);
  assert.equal(q.cost, 60 + 250 + 80);
});

test("designing a vehicle charges the office and tooling, and adds the design and its shape", () => {
  const c = newCompany(1, 20_000, VEHICLES, Object.values(ENGINES), generateBoard(1));
  const spec = meridianSpec();
  spec.stages[0]!.diameter = 1.5;
  spec.stages[0]!.tankLength = 6;
  spec.stages[0]!.engineCount = 14;
  spec.fairingDiameter = 1.5;
  const quote = designQuote(spec, Object.values(c.designs));
  const { cash, day } = c;
  const { key } = designVehicle(c, spec);
  assert.equal(key, "meridian-b");
  assert.equal(c.day, day + quote.days);
  assert.ok(c.cash < cash - quote.cost);
  assert.ok(c.campaign.aeroTruth[aeroShape(c.designs[key]!).key]);
  build(c, key);
  assert.equal(c.orders.at(-1)!.design, key);
  assert.throws(() => designVehicle(c, spec), /already a design/);
  retuneForMission(c, key, LEO_300);
});

test("the guide's orbital picks reach the orbit when re-tuned on typical engines", () => {
  const picks = suggestBuilds({ mission: LEO_300, payloadMass: 150 }, engines, [PATHFINDER, PATHFINDER_TWO_STAGE, MERIDIAN]);
  assert.deepEqual(picks.map((p) => p.label), ["Cheapest", "Balanced", "Most margin"]);
  for (const p of picks) {
    assert.deepEqual(checkVehicle(p.spec, engines).problems, []);
    assert.ok(p.figures.totalDeltaV * 0.975 >= orbitDeltaV(LEO_300) * 1.04);
  }
  assert.ok(picks[0]!.build.cost + picks[0]!.design.cost <= picks[1]!.build.cost + picks[1]!.design.cost);
  const r = retunePitch(picks[0]!.vehicle, LEO_300, { hardware: typical });
  assert.equal(r.inSpec, true);
});

test("the guide's sounding picks really reach the apogee", () => {
  const picks = suggestBuilds({ mission: SUBORBITAL_TEST, payloadMass: 60, minApogee: 120_000 }, engines, [PATHFINDER]);
  assert.ok(picks.length > 0);
  for (const p of picks) {
    assert.equal(p.vehicle.stages.length, 1);
    const r = simulateAscent(p.vehicle, SUBORBITAL_TEST, { hardware: typical });
    assert.ok(r.summary.apogee >= 120_000, `${p.label}: ${Math.round(r.summary.apogee / 1000)} km`);
  }
});

test("presets are priced from their parts", () => {
  assert.ok(vehicleCost(PATHFINDER).cost < 1_000);
  assert.ok(Math.abs(vehicleCost(MERIDIAN).cost - 4_003) < 1);
});
