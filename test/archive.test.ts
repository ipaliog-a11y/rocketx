import assert from "node:assert/strict";
import { test } from "node:test";
import { fire, newCompany, retire, REVIEW_DAY, runOver, wait, type Company } from "../src/sim/company.ts";
import { combineTruth } from "../src/sim/hardware.ts";
import { emptyArchive, lessonFor, lessonsFrom, materialLesson, MAX_RUNS, outcomeOf, postMortem, recordRun, SCORE, scoreRun, startingCashOf } from "../src/sim/archive.ts";
import { upgradeCompany } from "../src/sim/schedule.ts";
import { generateBoard } from "../src/contracts.ts";
import { STARTER_ENGINES, STARTERS } from "../src/starters.ts";

const fresh = (seed = 3, cash = 40_000): Company => newCompany(seed, cash, STARTERS, STARTER_ENGINES, generateBoard(seed));

/** A company whose parts have one known problem: the first injector goes unstable. */
function unstable(seed = 3): Company {
  const c = fresh(seed);
  for (const key of Object.keys(c.campaign.partTruth)) {
    c.campaign.partTruth[key] = { ispFactor: 1, hardStart: false, instabilityOnset: key.startsWith("injector:") ? 2 : null, lifeFactor: 1.5, relightFails: false };
  }
  for (const e of Object.values(c.campaign.engines)) c.campaign.truth[e.name] = combineTruth(e, c.campaign.partTruth);
  return c;
}

test("retiring ends the run alive, and nothing more can be done", () => {
  const c = fresh();
  wait(c, 10);
  retire(c);
  assert.equal(runOver(c), true);
  assert.equal(c.dead, false);
  assert.deepEqual(c.ended, { day: 10, how: "retired" });
  assert.throws(() => wait(c, 1), /retired/);
});

test("the board's review closes the books on day 1825, and time stops there", () => {
  const c = fresh(3, 1_000_000);
  wait(c, REVIEW_DAY - 5);
  assert.equal(runOver(c), false);
  const out = wait(c, 30);
  assert.equal(c.day, REVIEW_DAY);
  assert.deepEqual(c.ended, { day: REVIEW_DAY, how: "review" });
  assert.ok(out.notices.some((n) => /board reviews/.test(n)));
  assert.throws(() => wait(c, 1), /five-year review/);
});

test("an old save has no ending and carries on", () => {
  const c = JSON.parse(JSON.stringify(fresh())) as Company;
  delete c.ended;
  upgradeCompany(c);
  assert.equal(runOver(c), false);
  wait(c, 5);
});

test("the starting cash is read back from the books", () => {
  const c = fresh(3, 12_345);
  wait(c, 40);
  fire(c, c.campaign.engines[STARTER_ENGINES[0]!.name]!, 5, "sea-level");
  assert.equal(startingCashOf(c), 12_345);
});

test("the score adds up its parts, and a dead company keeps three quarters", () => {
  const c = fresh();
  c.closed = { a: "delivered", b: "delivered", c: "failed" };
  c.flights.push({ day: 300, design: "meridian", mission: "LEO", contract: null, outcome: "orbit", apogee: 300_000, settlement: null });
  c.firstOrbitDay = 300;
  c.record.push({ day: 300, tag: "delivered", reputation: 2, note: "test" });
  c.cash += 5_000;
  c.ledger.push({ day: 300, category: "payout", amount: 5_000, note: "test" });
  const { score, parts } = scoreRun(c);
  assert.equal(score, parts.reduce((s, p) => s + p.points, 0));
  const by = Object.fromEntries(parts.map((p) => [p.label, p.points]));
  assert.equal(by["Deliveries"], 2 * SCORE.delivery);
  assert.equal(by["Orbits"], SCORE.orbit);
  assert.equal(by["Reputation"], 2 * SCORE.reputation);
  assert.equal(by["Profit, $M"], 5 * SCORE.profitPerM);
  c.dead = true;
  c.deathCause = "bankrupt";
  const dead = scoreRun(c);
  assert.equal(dead.score, score - Math.round(score / 4));
  assert.equal(outcomeOf(c), "Dead after 1 orbit");
});

test("outcomes run from dead before orbit to sustainable launcher", () => {
  const c = fresh();
  assert.equal(outcomeOf(c), "Suborbital outfit");
  c.firstOrbitDay = 300;
  assert.equal(outcomeOf(c), "Niche contractor");
  c.market = { era: 2, since: { 1: 0, 2: 400 } };
  for (let i = 0; i < 10; i++) c.closed[`d${i}`] = "delivered";
  c.cash += 1_000;
  c.ledger.push({ day: 400, category: "payout", amount: 1_000, note: "test" });
  assert.equal(outcomeOf(c), "Sustainable launcher");
  const d = fresh();
  d.dead = true;
  assert.equal(outcomeOf(d), "Dead before orbit");
});

test("the post-mortem names how the money ran out and the last setbacks", () => {
  const c = fresh(3, 3_000);
  c.record.push({ day: 50, tag: "combustion-instability", reputation: 0, note: "Pathfinder test flight", test: true });
  c.record.push({ day: 80, tag: "late", reputation: -1, note: "Aurora sounding" });
  c.ledger.push({ day: 90, category: "test", amount: -9_000, note: "firings" });
  c.cash -= 9_000;
  c.dead = true;
  c.deathCause = "bankrupt";
  const lines = postMortem(c);
  assert.match(lines[0]!, /cash ran out/);
  assert.match(lines[1]!, /biggest spend was testing/);
  assert.ok(lines.some((l) => /combustion instability on a test flight/.test(l)));
  assert.ok(lines.some((l) => /missed deadline/.test(l)));
});

test("lessons are tallies of what tests showed, never the truths themselves", () => {
  const c = unstable();
  const harrier = c.campaign.engines["Harrier-SL"]!;
  fire(c, harrier, 30, "sea-level");
  const lessons = lessonsFrom(c);
  const injector = Object.entries(lessons.parts).find(([k]) => k.startsWith("injector:"))!;
  assert.equal(injector[1].tested, 1);
  assert.equal(injector[1].modes["combustion-instability"], 1);
  // Nothing from the truth tables: only counts.
  assert.ok(!JSON.stringify(lessons).includes("instabilityOnset"));
});

test("recording runs merges lessons, keeps career achievements once, and keeps the last fifty runs", () => {
  let archive = emptyArchive();
  const a = unstable(3);
  fire(a, a.campaign.engines["Harrier-SL"]!, 30, "sea-level");
  assert.throws(() => recordRun(archive, a), /isn't over/);
  retire(a);
  archive = recordRun(archive, a);
  const b = unstable(4);
  fire(b, b.campaign.engines["Harrier-SL"]!, 30, "sea-level");
  retire(b);
  archive = recordRun(archive, b);
  assert.equal(archive.played, 2);
  const key = Object.keys(archive.lessons.parts).find((k) => k.startsWith("injector:"))!;
  assert.equal(archive.lessons.parts[key]!.tested, 2);
  assert.equal(archive.lessons.parts[key]!.modes["combustion-instability"], 2);
  assert.equal(archive.career["first-firing"], 1, "first earned in run 1, not overwritten by run 2");
  const [slot, option] = key.split(":") as ["injector", string];
  assert.match(lessonFor(archive, slot, option)!, /combustion instability in 2 of 2 past/);
  assert.equal(lessonFor(archive, "nozzle", "vacuum"), null);
  assert.equal(materialLesson(archive, "composite"), null);
  for (let i = 0; i < MAX_RUNS; i++) archive = recordRun(archive, a);
  assert.equal(archive.runs.length, MAX_RUNS);
  assert.equal(archive.played, MAX_RUNS + 2);
  assert.equal(archive.runs[0]!.seed, 3, "the oldest dropped");
});
