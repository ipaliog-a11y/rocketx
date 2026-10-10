import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { aeroShape, IDEAL_AERO } from "../src/sim/airframe.ts";
import {
  accept,
  brief,
  build,
  fire,
  fly,
  newCompany,
  reputation,
  summary,
  type Company,
} from "../src/sim/company.ts";
import { settle, type Contract } from "../src/sim/contracts.ts";
import { COSTS, vehicleCost } from "../src/sim/cost.ts";
import { IDEAL_TRUTH, type EngineTruth } from "../src/sim/hardware.ts";
import { generateBoard, startingCash } from "../src/contracts.ts";
import { LEO_300, SUBORBITAL_TEST } from "../src/missions.ts";
import { ENGINES, HARRIER_SL, KESTREL_SL, MERIDIAN, PATHFINDER, VEHICLES } from "../src/vehicles.ts";

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);

const sounding: Contract = {
  id: "sounding",
  customer: "Test U",
  title: "Probe",
  mission: SUBORBITAL_TEST,
  payloadMass: 60,
  minApogee: 100_000,
  payout: 1_500,
  penalty: 300,
  deadline: 150,
  minReputation: 0,
  refuses: [],
};
const leo: Contract = {
  id: "leo",
  customer: "Test Sat",
  title: "LEO",
  mission: LEO_300,
  payloadMass: 200,
  payout: 9_000,
  penalty: 3_000,
  deadline: 400,
  minReputation: 1,
  refuses: ["burn-through"],
};

/** A company whose hidden hardware is perfect unless a test says otherwise. */
function company(cash = 12_000, engines: Partial<Record<string, EngineTruth>> = {}): Company {
  const c = newCompany(1, cash, VEHICLES, Object.values(ENGINES), [sounding, leo]);
  for (const name of Object.keys(c.campaign.truth)) c.campaign.truth[name] = engines[name] ?? IDEAL_TRUTH;
  for (const key of Object.keys(c.campaign.aeroTruth)) c.campaign.aeroTruth[key] = IDEAL_AERO;
  return c;
}

test("vehicle cost scales with engines and structure", () => {
  const meridian = vehicleCost(MERIDIAN);
  const pathfinder = vehicleCost(PATHFINDER);
  assert.ok(meridian.cost > 3 * pathfinder.cost);
  assert.equal(pathfinder.days, COSTS.buildDays + COSTS.buildDaysPerStage + COSTS.buildDaysPerEngine);
  assert.equal(meridian.days, COSTS.buildDays + 2 * COSTS.buildDaysPerStage + 10 * COSTS.buildDaysPerEngine);
});

test("the board and starting cash are seeded", () => {
  assert.deepEqual(generateBoard(4), generateBoard(4));
  assert.notDeepEqual(generateBoard(4), generateBoard(5));
  for (const c of generateBoard(4)) assert.ok(c.payout > 0 && c.deadline > 0);
  assert.equal(startingCash(4), startingCash(4));
  assert.ok(startingCash(4) >= 9_000 && startingCash(4) <= 14_000);
});

test("customers settle on what the flight did", () => {
  const up = simulateAscent({ ...PATHFINDER, payloadMass: 60 }, SUBORBITAL_TEST);
  assert.equal(settle(sounding, up).status, "delivered");
  assert.equal(settle({ ...sounding, minApogee: 500_000 }, up).tag, "short");

  const orbit = simulateAscent(MERIDIAN, LEO_300);
  const delivered = settle(leo, orbit);
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.payout, 9_000);

  const offTarget = simulateAscent({ ...MERIDIAN, payloadMass: 150 }, LEO_300);
  assert.equal(offTarget.outcome, "orbit");
  const degraded = settle(leo, offTarget);
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.payout, 4_500);

  const lost = simulateAscent(MERIDIAN, LEO_300, { hardware: { [HARRIER_SL.name]: { ...IDEAL_TRUTH, thermalLife: 40 } } });
  const failed = settle(leo, lost);
  assert.equal(failed.status, "failed");
  assert.equal(failed.tag, "burn-through");
  assert.equal(failed.penalty, 3_000);
});

test("signing needs the reputation and a record the customer accepts", () => {
  const c = company();
  assert.throws(() => accept(c, "leo"), /wants a reputation of 1/);
  c.record.push({ day: 0, tag: "delivered", reputation: 1, note: "x" });
  c.record.push({ day: 0, tag: "burn-through", reputation: 0, note: "y" });
  assert.throws(() => accept(c, "leo"), /won't sign .* burn-through/);
  accept(c, "sounding");
  assert.throws(() => accept(c, "sounding"), /no longer open/);
});

test("a contract flown on time pays, and builds and launches cost cash and days", () => {
  const c = company();
  accept(c, "sounding");
  build(c, "pathfinder");
  const built = vehicleCost(PATHFINDER);
  assert.equal(c.day, built.days);
  assert.equal(c.cash, 12_000 - built.cost);
  assert.equal(c.inventory.pathfinder, 1);

  const report = fly(c, "pathfinder", { contract: "sounding" });
  assert.equal(report.result.outcome, "apogee");
  assert.equal(c.inventory.pathfinder, 0);
  assert.equal(c.day, built.days + COSTS.padDays);
  assert.equal(c.cash, 12_000 - built.cost - COSTS.launchFee + 1_500);
  assert.equal(c.closed.sounding, "delivered");
  assert.equal(reputation(c), 1);
});

test("flying needs a built vehicle and a signed contract", () => {
  const c = company();
  assert.throws(() => fly(c, "pathfinder", { mission: SUBORBITAL_TEST }), /Build one first/);
  build(c, "pathfinder");
  assert.throws(() => fly(c, "pathfinder", { contract: "sounding" }), /isn't signed/);
});

test("a missed deadline costs the penalty and a late mark", () => {
  const c = company();
  accept(c, "sounding");
  for (let i = 0; i < 6; i++) build(c, "pathfinder");
  assert.ok(c.day > sounding.deadline);
  assert.equal(c.closed.sounding, "late");
  assert.ok(c.ledger.some((e) => e.category === "penalty" && e.amount === -300));
  assert.equal(c.record.at(-1)!.tag, "late");
});

test("running out of cash ends the run", () => {
  const c = company(1_500);
  build(c, "pathfinder");
  assert.equal(c.dead, false);
  const out = build(c, "pathfinder");
  assert.equal(c.dead, true);
  assert.ok(out.notices.some((n) => /company is dead/.test(n)));
  assert.throws(() => build(c, "pathfinder"), /company is gone/);
  assert.match(summary(c), /THE COMPANY DIED/);
});

test("stand time is charged to the company", () => {
  const c = company();
  fire(c, KESTREL_SL, 30, "sea-level");
  const report = c.campaign.knowledge[KESTREL_SL.name]!.history[0]!;
  assert.equal(c.cash, 12_000 - report.cost);
  assert.equal(c.day, report.days);
});

test("a flight teaches what it reached", () => {
  const c = company(12_000, { [KESTREL_SL.name]: { ...IDEAL_TRUTH, ispFactor: 0.97 } });
  build(c, "pathfinder");
  fly(c, "pathfinder", { mission: SUBORBITAL_TEST });
  const engine = c.campaign.knowledge[KESTREL_SL.name]!;
  near(engine.provenDuration, 83, 1);
  near(engine.measuredIspFactor!, 0.97, 1e-12);
  const airframe = c.campaign.aeroKnowledge[aeroShape(PATHFINDER).key]!;
  assert.equal(airframe.dragSource, "tunnel");
  assert.equal(airframe.buffet, 0);
});

test("a failed flight opens the failure mode and marks the record", () => {
  const c = company(12_000, { [KESTREL_SL.name]: { ...IDEAL_TRUTH, instabilityOnset: 20 } });
  build(c, "pathfinder");
  fly(c, "pathfinder", { mission: SUBORBITAL_TEST });
  assert.deepEqual(c.campaign.knowledge[KESTREL_SL.name]!.open, ["combustion-instability"]);
  assert.equal(c.record.at(-1)!.tag, "combustion-instability");
});

test("first orbit is recorded", () => {
  const c = company(20_000);
  c.record.push({ day: 0, tag: "delivered", reputation: 1, note: "x" });
  accept(c, "leo");
  build(c, "meridian");
  fly(c, "meridian", { contract: "leo" });
  assert.equal(c.firstOrbitDay, c.day);
  assert.equal(c.closed.leo, "delivered");
});

test("the bid screen names new regimes, unknowns and a forecast", () => {
  const c = newCompany(1, 12_000, VEHICLES, Object.values(ENGINES), generateBoard(1));
  const leoBrief = brief(c, "leo-150", "meridian");
  assert.match(leoBrief, /The Meridian has never flown/);
  assert.match(leoBrief, /Harrier-Vac: Never fired/);
  assert.match(leoBrief, /Forecast from what's known/);
  assert.match(brief(c, "equatorial", "meridian"), /can't launch directly into 0°/);
  assert.match(brief(c, "sso-150", "meridian"), /Retrograde/);
});
