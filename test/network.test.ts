import assert from "node:assert/strict";
import { test } from "node:test";
import { build, fly, newCompany, wait, type Company } from "../src/sim/company.ts";
import { runTask } from "../src/sim/schedule.ts";
import { advanceMarket } from "../src/sim/market.ts";
import { charterNetwork, charterProblem, NETWORK, networkMission, orderSatellites, revenueFor, rollLife, working } from "../src/sim/network.ts";
import { IDEAL_TRUTH } from "../src/sim/hardware.ts";
import { IDEAL_AERO } from "../src/sim/airframe.ts";
import { generateBoard, startingCash } from "../src/contracts.ts";
import { STARTER_ENGINES, STARTERS } from "../src/starters.ts";
import { upgradeCompany } from "../src/sim/schedule.ts";

const fresh = (seed = 3): Company => newCompany(seed, 40_000, STARTERS, STARTER_ENGINES, generateBoard(seed));

/** A company cleared for the network: orbital license, market era 2. */
function cleared(): Company {
  const c = fresh();
  c.licence = "orbital";
  c.record.push({ day: 0, tag: "delivered", reputation: 4, note: "test" });
  advanceMarket(c, 4);
  return c;
}

test("the charter waits for the orbital license and market era 2", () => {
  const c = fresh();
  assert.match(charterProblem(c)!, /orbital license/);
  c.licence = "orbital";
  assert.match(charterProblem(c)!, /era 2/);
  advanceMarket(c, 4);
  assert.equal(charterProblem(c), null);
  runTask(c, { kind: "charter" });
  assert.ok(c.network, "chartered once the office finishes");
  assert.equal(c.network!.charteredDay, NETWORK.charter.days);
  assert.match(charterProblem(c)!, /already/);
});

test("satellites are paid for when ordered and arrive two months later", () => {
  const c = cleared();
  charterNetwork(c);
  const cash = c.cash;
  orderSatellites(c, 5);
  assert.equal(c.cash, cash - 5 * NETWORK.satCost);
  wait(c, NETWORK.satDays - 1);
  assert.equal(c.network!.stored, 0);
  wait(c, 1);
  assert.equal(c.network!.stored, 5);
});

test("no service below the minimum, partial up to the plan, full at the plan", () => {
  assert.equal(revenueFor(NETWORK.minimum - 1), 0);
  assert.equal(revenueFor(NETWORK.minimum), Math.round((NETWORK.fullRevenue * NETWORK.minimum) / NETWORK.planned));
  assert.equal(revenueFor(NETWORK.planned), NETWORK.fullRevenue);
  assert.equal(revenueFor(NETWORK.planned + 10), NETWORK.fullRevenue);
});

test("each month bills the service for the satellites working and charges ground operations", () => {
  const c = cleared();
  charterNetwork(c);
  for (let i = 0; i < NETWORK.minimum; i++) c.network!.sats.push({ id: i + 1, launched: c.day, end: c.day + 10_000 });
  const cash = c.cash;
  wait(c, NETWORK.month);
  assert.equal(c.cash, cash - NETWORK.month * 5 + revenueFor(NETWORK.minimum) - NETWORK.operations);
  assert.ok(c.ledger.some((e) => e.category === "network"));
  assert.equal(c.network!.serviceDay, c.day);
});

test("satellites stop at the end of their hidden lives", () => {
  const c = cleared();
  charterNetwork(c);
  c.network!.sats.push({ id: 1, launched: 0, end: 40 }, { id: 2, launched: 0, end: 400 });
  wait(c, 50);
  assert.equal(working(c.network, c.day), 1);
  assert.equal(c.network!.sats[0]!.failed, 40);
  // Lives are seeded: about five years, a few early.
  const lives = Array.from({ length: 200 }, (_, i) => rollLife(7, i));
  assert.deepEqual(lives, Array.from({ length: 200 }, (_, i) => rollLife(7, i)));
  assert.ok(lives.some((d) => d <= NETWORK.infant.days));
  const median = [...lives].sort((a, b) => a - b)[100]!;
  assert.ok(Math.abs(median - NETWORK.life) < 0.15 * NETWORK.life);
});

test("a deploy flight to orbit puts the batch in service; a lost rocket loses it", () => {
  const c = cleared();
  for (const n of Object.keys(c.campaign.truth)) c.campaign.truth[n] = IDEAL_TRUTH;
  for (const k of Object.keys(c.campaign.aeroTruth)) c.campaign.aeroTruth[k] = IDEAL_AERO;
  c.campaign.structureTruth = Object.fromEntries(Object.keys(c.campaign.structureTruth ?? {}).map((k) => [k, 1.2]));
  charterNetwork(c);
  c.network!.stored = 2;
  build(c, "meridian");
  const report = fly(c, "meridian", { deploy: 2 });
  assert.equal(c.network!.stored, 0);
  assert.equal(report.result.outcome, "orbit");
  assert.equal(c.network!.sats.length, 2);
  assert.ok(c.network!.sats.every((s) => s.launched === c.day));
  assert.equal(report.result.events.length > 0, true);
  assert.equal(networkMission().target!.inclination, NETWORK.inclination);
  assert.throws(() => fly(c, "meridian", { deploy: 1 }), /Only 0|Build one/);

  // A hard start on the pad: the batch goes down with the rocket.
  c.network!.stored = 3;
  c.campaign.truth["Harrier-SL"] = { ...IDEAL_TRUTH, hardStart: true };
  build(c, "meridian");
  const lost = fly(c, "meridian", { deploy: 3 });
  assert.notEqual(lost.result.outcome, "orbit");
  assert.equal(c.network!.stored, 0);
  assert.equal(c.network!.sats.length, 2, "nothing added");
  assert.match(lost.text, /3 network satellites lost/);
});

test("an old save has no network until it charters one", () => {
  const c = fresh();
  delete c.network;
  upgradeCompany(c);
  assert.equal(c.network, undefined);
  wait(c, 60);
  assert.equal(c.ledger.some((e) => e.category === "satellites"), false);
});
