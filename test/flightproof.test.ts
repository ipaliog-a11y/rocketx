import assert from "node:assert/strict";
import { test } from "node:test";
import { IDEAL_AERO } from "../src/sim/airframe.ts";
import { build, fly, newCompany } from "../src/sim/company.ts";
import { IDEAL_TRUTH } from "../src/sim/hardware.ts";
import { flightUnknowns } from "../src/sim/teststand.ts";
import { generateBoard } from "../src/contracts.ts";
import { SUBORBITAL_TEST } from "../src/missions.ts";
import { ENGINES, KESTREL_SL, VEHICLES } from "../src/vehicles.ts";

test("a clean flight proves its engines without any stand firing", () => {
  const c = newCompany(1, 60_000, VEHICLES, Object.values(ENGINES), generateBoard(1));
  for (const name of Object.keys(c.campaign.truth)) c.campaign.truth[name] = { ...IDEAL_TRUTH, ispFactor: 0.97 };
  for (const key of Object.keys(c.campaign.aeroTruth)) c.campaign.aeroTruth[key] = IDEAL_AERO;
  build(c, "pathfinder");
  const r = fly(c, "pathfinder", { mission: SUBORBITAL_TEST });
  assert.equal(r.result.outcome, "apogee");
  const known = c.campaign.knowledge[KESTREL_SL.name]!;
  assert.equal(known.history.every((h) => h.facility === "flight"), true, "never on the stand");
  assert.equal(known.measuredIspFactor, 0.97);
  assert.deepEqual(flightUnknowns(c.designs.pathfinder!, c.campaign, SUBORBITAL_TEST), [], "nothing left on trust: the whole burn was flown");
});
