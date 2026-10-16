import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { aeroShape, IDEAL_AERO } from "../src/sim/airframe.ts";
import {
  accept,
  bid,
  brief,
  build,
  buyLine,
  LEARNING,
  LINE_COSTS,
  readyDay,
  fire,
  fly,
  newCompany,
  posted,
  reputation,
  summary,
  wait,
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
  kind: "sounding",
  customer: "Test U",
  title: "Probe",
  mission: SUBORBITAL_TEST,
  payloadMass: 60,
  minApogee: 100_000,
  payout: 1_500,
  degradedShare: 0.5,
  penalty: 300,
  deadline: 150,
  minReputation: 0,
  refuses: [],
  postedDay: 0,
};
const leo: Contract = {
  id: "leo",
  kind: "smallsat",
  customer: "Test Sat",
  title: "LEO",
  mission: LEO_300,
  payloadMass: 200,
  payout: 9_000,
  degradedShare: 0.5,
  penalty: 3_000,
  deadline: 400,
  minReputation: 1,
  refuses: ["burn-through"],
  postedDay: 0,
};

/**
 * A company whose hidden hardware is perfect unless a test says otherwise.
 * It already holds the orbital licence: these tests are about engineering
 * and money, not the regulator (test/licence.test.ts covers that).
 */
function company(cash = 12_000, engines: Partial<Record<string, EngineTruth>> = {}): Company {
  const c = newCompany(1, cash, VEHICLES, Object.values(ENGINES), [sounding, leo]);
  c.licence = "orbital";
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
  assert.ok(startingCash(4) >= 11_000 && startingCash(4) <= 16_000);
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

test("a contract flown on time pays; a build costs cash up front and the launch waits for rollout", () => {
  const c = company();
  accept(c, "sounding");
  build(c, "pathfinder");
  const built = vehicleCost(PATHFINDER);
  assert.equal(c.day, 0, "the company keeps working while the line builds");
  assert.equal(c.cash, 12_000 - built.cost);
  assert.equal(c.inventory.pathfinder ?? 0, 0);
  assert.deepEqual(c.orders, [{ design: "pathfinder", line: 0, startDay: 0, readyDay: built.days }]);
  assert.equal(readyDay(c, "pathfinder"), built.days);

  const report = fly(c, "pathfinder", { contract: "sounding" });
  assert.equal(report.result.outcome, "apogee");
  assert.equal(c.inventory.pathfinder, 0);
  assert.equal(c.day, built.days + COSTS.padDays);
  const days = built.days + COSTS.padDays;
  assert.equal(c.cash, 12_000 - built.cost - COSTS.launchFee - days * COSTS.overheadPerDay + 1_500);
  assert.equal(c.closed.sounding, "delivered");
  assert.equal(reputation(c), 1);
});

test("orders queue on a busy line, and another line builds in parallel", () => {
  const c = company(20_000);
  const days = vehicleCost(PATHFINDER).days;
  build(c, "pathfinder");
  build(c, "pathfinder");
  // The second takes less time: the line learned on the first.
  assert.deepEqual(c.orders.map((o) => o.readyDay), [days, days + Math.round(days * LEARNING.rate)]);
  const { notices } = wait(c, days);
  assert.equal(c.inventory.pathfinder, 1);
  assert.ok(notices.some((n) => /rolled out of line 1/.test(n)));

  const cash = c.cash;
  buyLine(c);
  assert.equal(c.cash, cash - LINE_COSTS[0]!.cost);
  assert.equal(c.lines.length, 2);
  wait(c, LINE_COSTS[0]!.days);
  build(c, "pathfinder");
  build(c, "pathfinder");
  const lines = c.orders.slice(-2).map((o) => o.line).sort();
  assert.deepEqual(lines, [0, 1], "two lines take the two new orders");
  buyLine(c);
  assert.throws(() => buyLine(c), /as many as the site holds/);
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
  build(c, "pathfinder");
  wait(c, sounding.deadline + 1);
  assert.ok(c.day > sounding.deadline);
  assert.equal(c.closed.sounding, "late");
  assert.ok(c.ledger.some((e) => e.category === "penalty" && e.amount === -300));
  assert.equal(c.record.at(-1)!.tag, "late");
});

test("running out of cash ends the run", () => {
  const c = company(1_500);
  c.firstOrbitDay = 0; // past the LEO gate, so only negative cash ends it
  build(c, "pathfinder");
  assert.equal(c.dead, false);
  const out = build(c, "pathfinder");
  assert.equal(c.dead, true);
  assert.ok(out.notices.some((n) => /company is dead/.test(n)));
  assert.throws(() => build(c, "pathfinder"), /company is gone/);
  assert.match(summary(c), /THE COMPANY DIED/);
});

test("a flight's payout lands before the books are checked: payroll on the pad can't kill a company being paid", () => {
  const built = vehicleCost(PATHFINDER);
  const days = built.days + COSTS.padDays;
  // Ten thousand short of the build, the launch and the payroll, until the customer pays.
  const short = built.cost + COSTS.launchFee + days * COSTS.overheadPerDay - 10;
  const paid = company(short);
  paid.firstOrbitDay = 0;
  accept(paid, "sounding");
  build(paid, "pathfinder");
  fly(paid, "pathfinder", { contract: "sounding" });
  assert.equal(paid.dead, false);
  assert.equal(paid.cash, 1_500 - 10);

  // A test flight earns nothing: the same books end the run once it lands.
  const unpaid = company(short);
  unpaid.firstOrbitDay = 0;
  build(unpaid, "pathfinder");
  const out = fly(unpaid, "pathfinder", { mission: SUBORBITAL_TEST });
  assert.equal(unpaid.dead, true);
  assert.ok(out.notices.some((n) => /company is dead/.test(n)));
});

test("before first orbit, a company that can't afford an orbital vehicle is finished", () => {
  const meridian = vehicleCost(MERIDIAN).cost + COSTS.launchFee;
  const c = company(meridian + 500);
  fire(c, KESTREL_SL, 30, "sea-level");
  assert.equal(c.dead, false);
  const out = fire(c, KESTREL_SL, 300, "sea-level");
  assert.equal(c.dead, true);
  assert.ok(out.notices.some((n) => /can't afford another try at LEO/.test(n)));

  // A built orbital vehicle, or money owed on a signed contract, keeps it alive.
  const built = company(meridian + vehicleCost(MERIDIAN).days * COSTS.overheadPerDay);
  build(built, "meridian");
  assert.equal(built.dead, false);
});

test("stand time is charged to the company", () => {
  const c = company();
  fire(c, KESTREL_SL, 30, "sea-level");
  const report = c.campaign.knowledge[KESTREL_SL.name]!.history[0]!;
  assert.equal(c.cash, 12_000 - report.cost - report.days * COSTS.overheadPerDay);
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

test("time costs payroll, and later contracts appear on the board over time", () => {
  const c = newCompany(1, 12_000, VEHICLES, Object.values(ENGINES), generateBoard(1));
  assert.ok(!posted(c).some((x) => x.id.startsWith("rideshare")));
  assert.throws(() => accept(c, "rideshare-1"), /isn't on the board yet/);
  wait(c, 300);
  assert.equal(c.cash, 12_000 - 300 * COSTS.overheadPerDay);
  assert.ok(posted(c).some((x) => x.id === "rideshare-1"));
});

test("the bid is structured data the UI can lay out", () => {
  const c = company();
  const b = bid(c, "leo", "meridian");
  assert.equal(b.designName, "Meridian");
  assert.deepEqual(b.build, vehicleCost(MERIDIAN));
  assert.ok(b.blockers.some((x) => /reputation of 1/.test(x)));
  assert.ok(b.regimes.includes("The Meridian has never flown."));
  assert.equal(b.forecast.delivers, true);
  assert.equal(b.fitsSchedule, true);
  assert.match(brief(c, "leo", "meridian"), /Forecast from what's known: .* in spec/);
});

test("every launch lands in the flight log", () => {
  const c = company();
  accept(c, "sounding");
  build(c, "pathfinder");
  build(c, "pathfinder");
  const report = fly(c, "pathfinder", { contract: "sounding" });
  fly(c, "pathfinder", { mission: SUBORBITAL_TEST });
  assert.equal(c.flights.length, 2);
  assert.deepEqual(c.flights[0], {
    day: c.flights[0]!.day,
    design: "Pathfinder",
    mission: SUBORBITAL_TEST.name,
    contract: sounding.title,
    outcome: "apogee",
    apogee: c.flights[0]!.apogee,
    settlement: "delivered",
  });
  assert.ok(c.flights[0]!.apogee > 100_000);
  assert.equal(c.flights[1]!.contract, null);
  assert.equal(report.settlement?.status, "delivered");
  assert.match(report.debrief, /^DEBRIEF: Pathfinder/);
});
