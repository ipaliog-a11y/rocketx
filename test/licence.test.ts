import assert from "node:assert/strict";
import { test } from "node:test";
import { achievements } from "../src/sim/achievements.ts";
import { IDEAL_AERO } from "../src/sim/airframe.ts";
import { accept, applyForLicence, build, fire, fly, newCompany, rename, type Company } from "../src/sim/company.ts";
import { COSTS } from "../src/sim/cost.ts";
import { IDEAL_TRUTH } from "../src/sim/hardware.ts";
import { LICENCE_COSTS, nextLicence } from "../src/sim/licence.ts";
import { generateBoard } from "../src/contracts.ts";
import { LEO_300, SUBORBITAL_TEST } from "../src/missions.ts";
import { ENGINES, KESTREL_SL, VEHICLES } from "../src/vehicles.ts";

function company(): Company {
  const c = newCompany(1, 20_000, VEHICLES, Object.values(ENGINES), generateBoard(1), "Test Rocketry");
  for (const name of Object.keys(c.campaign.truth)) c.campaign.truth[name] = IDEAL_TRUTH;
  for (const key of Object.keys(c.campaign.aeroTruth)) c.campaign.aeroTruth[key] = IDEAL_AERO;
  return c;
}

test("a new company holds only the suborbital licence", () => {
  const c = company();
  assert.equal(c.licence, "suborbital");
  assert.equal(c.name, "Test Rocketry");
  assert.throws(() => accept(c, "leo-150"), /needs the orbital licence/);
  build(c, "meridian");
  assert.throws(() => fly(c, "meridian", { mission: LEO_300 }), /orbital licence/);
});

test("the orbital licence takes two flights above 100 km, a fee and a review", () => {
  const c = company();
  const before = nextLicence(c, 0)!;
  assert.equal(before.tier, "orbital");
  assert.equal(before.ready, false);
  assert.deepEqual(before.requirements[0]!.progress, [0, 2]);
  assert.throws(() => applyForLicence(c), /regulator wants/);

  build(c, "pathfinder");
  build(c, "pathfinder");
  fly(c, "pathfinder", { mission: SUBORBITAL_TEST });
  fly(c, "pathfinder", { mission: SUBORBITAL_TEST });
  assert.equal(nextLicence(c, 0)!.ready, true);

  const { cash, day } = c;
  applyForLicence(c);
  const { fee, days } = LICENCE_COSTS.orbital;
  assert.equal(c.licence, "orbital");
  assert.equal(c.day, day + days);
  assert.equal(c.cash, cash - fee - days * COSTS.overheadPerDay);
  // The regulator is satisfied; now it's the customer's own bar.
  assert.throws(() => accept(c, "leo-150"), /reputation of 1/);
});

test("nobody can hold a crew licence yet", () => {
  const c = company();
  c.licence = "orbital";
  const crew = nextLicence(c, 10)!;
  assert.equal(crew.tier, "crew");
  assert.equal(crew.ready, false);
  assert.ok(crew.requirements.some((r) => /launch-abort/.test(r.text) && !r.met));
});

test("renaming keeps a sensible name", () => {
  const c = company();
  rename(c, "  Halcyon Launch  ");
  assert.equal(c.name, "Halcyon Launch");
  assert.throws(() => rename(c, "   "), /needs a name/);
});

test("achievements are worked out from the record", () => {
  const c = company();
  const earned = () => achievements(c).filter((a) => a.earned).map((a) => a.id);
  assert.deepEqual(earned(), []);
  fire(c, KESTREL_SL, 10, "sea-level");
  build(c, "pathfinder");
  fly(c, "pathfinder", { mission: SUBORBITAL_TEST });
  assert.deepEqual(earned().sort(), ["first-build", "first-firing", "space"]);
  const fleet = achievements(c).find((a) => a.id === "fleet")!;
  assert.deepEqual(fleet.progress, [1, 5]);
});
