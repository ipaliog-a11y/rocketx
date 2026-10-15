import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleVehicle } from "../src/sim/builder.ts";
import { vehicleCost } from "../src/sim/cost.ts";
import { payback, reflightCost } from "../src/sim/fleet.ts";
import { suggestBuilds } from "../src/sim/guide.ts";
import { landingMargin } from "../src/sim/landing.ts";
import { IDEAL_TRUTH } from "../src/sim/hardware.ts";
import { escape, LEO_300 } from "../src/missions.ts";
import { ENGINES, VEHICLES } from "../src/vehicles.ts";

const engines = Object.fromEntries(Object.values(ENGINES).map((e) => [e.name, e]));
const existing = Object.values(VEHICLES);
const typical = Object.fromEntries(Object.keys(engines).map((n) => [n, { ...IDEAL_TRUTH, ispFactor: 0.975 }]));

test("payback: the flight on which reuse has cost less than expending", () => {
  assert.equal(payback(8_000, 2_000, 4_500), 3);
  assert.equal(payback(4_000, 1_000, 4_500), 1);
  assert.equal(payback(8_000, 5_000, 4_500), null);
});

test("the guide sizes a reusable stack and its reserve together: it lands on paper and still reaches orbit", () => {
  const expendable = suggestBuilds({ mission: LEO_300, payloadMass: 150 }, engines, existing);
  const picks = suggestBuilds({ mission: LEO_300, payloadMass: 150, reuse: "drone-ship" }, engines, existing);
  assert.ok(picks.length > 0, picks.reason);
  for (const p of picks) {
    const r = p.reuse!;
    assert.equal(r.mode, "drone-ship");
    assert.equal(p.spec.geometry?.recovery?.reserve, r.reserve);
    const v = { ...assembleVehicle(p.spec, engines), payloadMass: 150 };
    const m = landingMargin(v, LEO_300, { hardware: typical })!;
    assert.equal(m.ascent, "orbit");
    assert.equal(m.recovery?.outcome, "landed");
    assert.ok(m.deltaV >= 100, `${m.deltaV}`);
    assert.ok(p.margin >= 0.04, `${p.margin}`);
    // Dearer than expending, cheaper to fly again, and it pays back.
    assert.ok(p.build.cost > expendable[0]!.build.cost);
    assert.deepEqual(r.reflight, reflightCost(assembleVehicle(p.spec, engines)));
    assert.ok(r.reflight.cost < expendable[0]!.build.cost);
    assert.ok(r.payback !== null && r.payback >= 2, `${r.payback}`);
    assert.match(p.note, /drone-ship landing/);
    assert.equal(vehicleCost(p.vehicle).cost, p.build.cost);
  }
});

test("asked for reuse where it can't be had, the guide says why", () => {
  const kicked = suggestBuilds({ mission: escape(10), payloadMass: 100, reuse: "drone-ship" }, engines, existing);
  assert.equal(kicked.length, 0);
  assert.match(kicked.reason!, /kick stage/);
  const pad = suggestBuilds({ mission: LEO_300, payloadMass: 150, reuse: "rtls" }, engines, existing);
  if (pad.length === 0) assert.ok(pad.reason && pad.reason.length > 0);
  else for (const p of pad) assert.equal(p.reuse!.mode, "rtls");
});
