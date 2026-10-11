import assert from "node:assert/strict";
import { test } from "node:test";
import { aeroShape } from "../src/sim/airframe.ts";
import { newCompany } from "../src/sim/company.ts";
import { IDEAL_TRUTH } from "../src/sim/hardware.ts";
import { dragKnowledge, ispKnowledge, simulate, sparePayload } from "../src/sim/simulator.ts";
import { generateBoard } from "../src/contracts.ts";
import { LEO_300, SUBORBITAL_TEST } from "../src/missions.ts";
import { ENGINES, HARRIER_SL, HARRIER_VAC, MERIDIAN, PATHFINDER, VEHICLES } from "../src/vehicles.ts";

const fresh = () => newCompany(7, 10_000, VEHICLES, Object.values(ENGINES), generateBoard(7));

test("the simulator never reads the hidden truth", () => {
  const a = fresh();
  const b = fresh();
  b.campaign.truth[HARRIER_SL.name] = { ...IDEAL_TRUTH, ispFactor: 0.9, hardStart: true };
  b.campaign.aeroTruth[aeroShape(MERIDIAN).key] = { dragFactor: 1.3, transonicRise: 1.6, buffet: 3 };
  const sa = simulate(a.campaign, MERIDIAN, LEO_300);
  const sb = simulate(b.campaign, MERIDIAN, LEO_300);
  assert.equal(sa.modelled.result.summary.burnoutVelocity, sb.modelled.result.summary.burnoutVelocity);
  assert.deepEqual(sb.warnings, sa.warnings);
});

test("a known failure is flagged, not flown", () => {
  const c = fresh();
  const known = (c.campaign.knowledge[HARRIER_SL.name] ??= { firings: 1, startupProven: true, provenDuration: 40, measuredIspFactor: null, altitudeTested: false, relightProven: false, open: [], fixed: [], seen: {}, history: [] });
  known.open.push("combustion-instability");
  known.seen["combustion-instability"] = 41;
  const sim = simulate(c.campaign, MERIDIAN, LEO_300);
  assert.ok(!sim.modelled.result.events.some((e) => e.kind === "engine-failure"));
  assert.ok(sim.warnings.some((w) => /combustion instability.*41 s/i.test(w)), sim.warnings.join(" | "));
});

test("the range spans the unknowns and closes as tests measure them", () => {
  const c = fresh();
  const open = simulate(c.campaign, MERIDIAN, LEO_300);
  assert.ok(open.worst && open.best);
  const v = (s: typeof open.modelled) => s.result.summary.idealDeltaV - s.result.summary.losses.drag;
  assert.ok(v(open.worst!) < v(open.modelled) && v(open.modelled) <= v(open.best!) + 1e-6);

  // Measure both engines' Isp and the shape's drag and drag rise: nothing is left to spread.
  for (const e of [HARRIER_SL, HARRIER_VAC]) {
    const k = (c.campaign.knowledge[e.name] ??= { firings: 1, startupProven: true, provenDuration: 0, measuredIspFactor: null, altitudeTested: false, relightProven: false, open: [], fixed: [], seen: {}, history: [] });
    k.measuredIspFactor = 0.97;
  }
  c.campaign.aeroKnowledge[aeroShape(MERIDIAN).key] = { runs: 2, dragFactor: 1.04, dragSource: "tunnel", transonicRise: 1.2, buffet: 0, open: [], fixed: [], history: [] };
  assert.deepEqual(ispKnowledge(c.campaign, HARRIER_SL), { engine: HARRIER_SL.name, model: 0.97, lo: 0.97, hi: 0.97, measured: true });
  assert.equal(dragKnowledge(c.campaign, MERIDIAN).hi.dragFactor, 1.04);
  const closed = simulate(c.campaign, MERIDIAN, LEO_300);
  assert.equal(closed.worst, undefined);
  assert.equal(closed.best, undefined);
});

test("CFD narrows the drag range without closing it", () => {
  const c = fresh();
  c.campaign.aeroKnowledge[aeroShape(MERIDIAN).key] = { runs: 1, dragFactor: 1.03, dragSource: "cfd", transonicRise: null, buffet: null, open: [], fixed: [], history: [] };
  const d = dragKnowledge(c.campaign, MERIDIAN);
  assert.ok(Math.abs(d.lo.dragFactor - 1.03) < 1e-9 && Math.abs(d.hi.dragFactor - 1.06) < 1e-9);
});

test("propellant left over is worth payload, and a lighter payload leaves more", () => {
  const c = fresh();
  const heavy = simulate(c.campaign, MERIDIAN, LEO_300).modelled;
  const light = simulate(c.campaign, { ...MERIDIAN, payloadMass: MERIDIAN.payloadMass - 30 }, LEO_300).modelled;
  if (heavy.delivers && light.delivers) assert.ok((light.spare ?? 0) >= (heavy.spare ?? 0));
  assert.equal(sparePayload(MERIDIAN, { ...heavy.result, summary: { ...heavy.result.summary, propellantMargin: 0 } }, 1), 0);
});

test("a sounding rocket is judged on apogee", () => {
  const c = fresh();
  const sim = simulate(c.campaign, PATHFINDER, SUBORBITAL_TEST, { minApogee: 100_000 });
  assert.equal(sim.modelled.delivers, sim.modelled.result.summary.apogee >= 100_000);
  assert.equal(sim.modelled.spare, null);
});
