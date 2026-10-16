import assert from "node:assert/strict";
import { test } from "node:test";
import { checkVehicle } from "../src/sim/builder.ts";
import { newCompany } from "../src/sim/company.ts";
import { simulate } from "../src/sim/simulator.ts";
import { generateBoard } from "../src/contracts.ts";
import { circular, MISSIONS } from "../src/missions.ts";
import { MERIDIAN_SPEC, PATHFINDER_SPEC, STARTER_ENGINES, STARTERS } from "../src/starters.ts";

const engines = Object.fromEntries(STARTER_ENGINES.map((e) => [e.name, e]));
const company = () => newCompany(7, 12_000, STARTERS, STARTER_ENGINES, generateBoard(7));

test("the starting designs are drawing-board designs that pass the board's checks", () => {
  for (const spec of [PATHFINDER_SPEC, MERIDIAN_SPEC]) assert.deepEqual(checkVehicle(spec, engines).problems, [], spec.name);
  assert.ok(STARTERS.pathfinder!.structure, "Pathfinder has shells that can buckle");
  assert.ok(STARTERS.meridian!.structure, "Meridian has shells that can buckle");
  assert.ok(STARTERS.meridian!.control, "Meridian flies its attitude loop");
  assert.equal(STARTERS.pathfinder!.control, undefined, "Pathfinder is unguided, steadied by fins");
});

test("a new company rolls the starting designs' hidden shell and GNC truths, as if drawn on day 0", () => {
  const c = company();
  assert.ok(Object.keys(c.campaign.structureTruth ?? {}).length >= 3, "a truth for each starting shell");
  assert.ok(c.campaign.gncTruth?.["Meridian"], "Meridian has a GNC truth");
  assert.equal(c.campaign.gncTruth?.["Pathfinder"], undefined);
});

test("Pathfinder carries the board's heaviest sounding payload past what the board asks, on paper", () => {
  const c = company();
  for (const payload of [20, 80]) {
    const s = simulate(c.campaign, { ...STARTERS.pathfinder!, payloadMass: payload }, MISSIONS.suborbital!, { minApogee: 1, range: false });
    // Generated sounding work asks at most 85% of 146 − 0.31 × payload km.
    assert.ok(s.modelled.result.summary.apogee / 1000 > 0.85 * (146 - 0.31 * payload) + 20, `${payload} kg reaches ${(s.modelled.result.summary.apogee / 1000).toFixed(0)} km`);
  }
});

test("Meridian delivers its reference job, 200 kg to 300 km at 28.5°, on its own steering", () => {
  const s = simulate(company().campaign, STARTERS.meridian!, circular(300, 28.5), { range: false });
  assert.ok(s.modelled.delivers, "in spec without a re-tune");
  assert.ok((s.modelled.spare ?? 0) > 0);
});
