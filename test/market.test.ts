import assert from "node:assert/strict";
import { test } from "node:test";
import { accept, newCompany, wait, type Company } from "../src/sim/company.ts";
import { upgradeCompany } from "../src/sim/schedule.ts";
import { advanceMarket, eraFor, kept } from "../src/sim/market.ts";
import { eraWork, generateBoard, startingCash } from "../src/contracts.ts";
import { STARTER_ENGINES, STARTERS } from "../src/starters.ts";

const fresh = (seed = 3): Company => newCompany(seed, startingCash(seed), STARTERS, STARTER_ENGINES, generateBoard(seed));
const rep = (c: Company, points: number) => c.record.push({ day: c.day, tag: "delivered", reputation: points, note: "test" });
const light = (c: Company, after: number) => c.board.filter((x) => (x.kind === "smallsat" || x.kind === "rideshare") && !x.seriesId && x.postedDay > after);

test("eras open at reputation 4 and 8", () => {
  assert.equal(eraFor(-3), 1);
  assert.equal(eraFor(3), 1);
  assert.equal(eraFor(4), 2);
  assert.equal(eraFor(7), 2);
  assert.equal(eraFor(8), 3);
});

test("an era opens on the first tick after reputation reaches it, and never closes", () => {
  const c = fresh();
  wait(c, 10);
  assert.equal(c.market!.era, 1);
  rep(c, 4);
  wait(c, 1);
  assert.equal(c.market!.era, 2);
  assert.equal(c.market!.since[2], 11);
  rep(c, -10);
  wait(c, 1);
  assert.equal(c.market!.era, 2, "a fall in reputation doesn't take the market back");
});

test("an era thins unposted light one-off work and adds its own, from the day it opens", () => {
  const c = fresh();
  wait(c, 100);
  const before = light(c, 100).map((x) => x.id);
  const posted = c.board.filter((x) => x.postedDay <= 100).map((x) => x.id);
  const series = c.board.filter((x) => x.seriesId).map((x) => x.id);
  advanceMarket(c, 4);
  const after = light(c, 100).map((x) => x.id);
  // Half, give or take, and exactly the ones the seeded roll keeps.
  assert.deepEqual(after, before.filter((id) => kept(c.seed, id, 0.5)));
  assert.ok(after.length < before.length);
  for (const id of [...posted, ...series]) assert.ok(c.board.some((x) => x.id === id), `${id} stays`);
  const work = c.board.filter((x) => x.kind === "bus" || x.kind === "platform");
  assert.ok(work.length > 5);
  assert.ok(work.every((x) => x.postedDay > 100 && x.minReputation === 4));
  assert.ok(work.every((x) => x.payloadMass >= 300 && x.payloadMass <= 600));
  assert.deepEqual(c.board.map((x) => x.postedDay), [...c.board.map((x) => x.postedDay)].sort((a, b) => a - b));
});

test("a light contract already signed is never thinned", () => {
  const c = fresh();
  c.licence = "orbital";
  rep(c, 2);
  const target = light(c, 0).find((x) => !kept(c.seed, x.id, 0.25))!;
  assert.ok(target, "some light contract the era-3 roll would drop");
  c.accepted.push(target.id);
  advanceMarket(c, 8);
  assert.ok(c.board.some((x) => x.id === target.id));
  assert.equal(c.market!.era, 3);
  assert.ok(c.board.some((x) => x.kind === "bus" && x.payloadMass >= 1_000), "era 3 posts heavy buses");
  assert.ok(c.board.some((x) => x.minReputation === 4), "jumping two eras opens both");
});

test("era work is the same for the same seed, and starts within weeks of the era", () => {
  assert.deepEqual(eraWork(5, 2), eraWork(5, 2));
  assert.notDeepEqual(eraWork(5, 2), eraWork(6, 2));
  assert.ok(eraWork(5, 2)[0]!.postedDay <= 15);
});

test("an old save upgrades into era 1 and moves up on its next tick", () => {
  const c = fresh();
  delete c.market;
  rep(c, 5);
  upgradeCompany(c);
  assert.equal(c.market!.era, 1);
  wait(c, 1);
  assert.equal(c.market!.era, 2);
});
