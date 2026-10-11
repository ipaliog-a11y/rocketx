import assert from "node:assert/strict";
import { test } from "node:test";
import { fire, newCompany, type Company } from "../src/sim/company.ts";
import { combineTruth } from "../src/sim/hardware.ts";
import { partKeys } from "../src/sim/parts.ts";
import { partKnowledgeOf } from "../src/sim/teststand.ts";
import { generateBoard } from "../src/contracts.ts";
import { ENGINES, HARRIER_SL, HARRIER_VAC, VEHICLES } from "../src/vehicles.ts";
import { partNeed, planPartTest } from "../src/web/partTest.ts";

/** A company whose hardware has no hidden faults, so planned firings come out clean. */
function clean(): Company {
  const c = newCompany(1, 20_000, VEHICLES, Object.values(ENGINES), generateBoard(1));
  for (const key of Object.keys(c.campaign.partTruth)) {
    c.campaign.partTruth[key] = { ispFactor: 1, hardStart: false, instabilityOnset: null, lifeFactor: 1.5, relightFails: false };
  }
  for (const e of Object.values(c.campaign.engines)) c.campaign.truth[e.name] = combineTruth(e, c.campaign.partTruth);
  return c;
}

const keys = partKeys(HARRIER_SL.parts!);
const vacNozzle = partKeys(HARRIER_VAC.parts!).nozzle;

test("an unfired cycle plans a short start firing on an engine that can run at sea level", () => {
  const plan = planPartTest(clean(), keys.cycle)!;
  assert.deepEqual([plan.engine, plan.facility, plan.seconds, plan.restart], [HARRIER_SL.name, "sea-level", 5, false]);
});

test("a vacuum nozzle plans the altitude cell", () => {
  const plan = planPartTest(clean(), vacNozzle)!;
  assert.equal(plan.engine, HARRIER_VAC.name);
  assert.equal(plan.facility, "altitude");
});

test("a shared injector is proven for the longer burn, on an engine whose chamber lasts that long", () => {
  const c = clean();
  const need = partNeed(c, keys.injector);
  assert.equal(need?.kind, "stable");
  const plan = planPartTest(c, keys.injector)!;
  assert.ok(need?.kind === "stable" && plan.seconds >= need.seconds);
  assert.equal(plan.engine, HARRIER_VAC.name, "the Harrier-SL's chamber is rated shorter than the Vac's burn");
  assert.equal(plan.facility, "altitude");
});

test("once the cycle starts, an upper-stage engine plans the restart test, then nothing is left", () => {
  const c = clean();
  fire(c, c.campaign.engines[HARRIER_SL.name]!, 5, "sea-level");
  assert.equal(partNeed(c, keys.cycle)?.kind, "relight");
  const plan = planPartTest(c, keys.cycle)!;
  assert.deepEqual([plan.engine, plan.facility, plan.restart], [HARRIER_VAC.name, "altitude", true]);
  fire(c, c.campaign.engines[plan.engine]!, plan.seconds, plan.facility, plan.restart);
  assert.equal(partNeed(c, keys.cycle), null);
  assert.equal(planPartTest(c, keys.cycle), null);
});

test("following the plans proves the injector and its Isp", () => {
  const c = clean();
  for (let i = 0; i < 4; i++) {
    const plan = planPartTest(c, keys.injector);
    if (!plan) break;
    fire(c, c.campaign.engines[plan.engine]!, plan.seconds, plan.facility, plan.restart);
  }
  assert.equal(partNeed(c, keys.injector), null);
});

test("an open fault asks for the fix, not another firing", () => {
  const c = clean();
  partKnowledgeOf(c.campaign, keys.injector).open.push("combustion-instability");
  assert.deepEqual(partNeed(c, keys.injector), { kind: "fix", mode: "combustion-instability" });
  assert.equal(planPartTest(c, keys.injector), null);
});
