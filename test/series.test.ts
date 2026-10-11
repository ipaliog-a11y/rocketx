import assert from "node:assert/strict";
import { test } from "node:test";
import { accept, commitSeries, newCompany, objectionTo, reputation, seriesBonus, seriesCompletion, seriesOf, uncommitted, type Company } from "../src/sim/company.ts";
import { generateBoard } from "../src/contracts.ts";
import { ENGINES, VEHICLES } from "../src/vehicles.ts";

/** A company that can sign a suborbital series: the first one on the board. */
function setup(): { c: Company; id: string } {
  const c = newCompany(1, 50_000, VEHICLES, Object.values(ENGINES), generateBoard(1));
  const first = c.board.filter((x) => x.seriesId && x.seriesIndex === 1 && x.minReputation <= 0 && !x.mission.target).sort((a, b) => a.postedDay - b.postedDay)[0]!;
  c.day = first.postedDay;
  return { c, id: first.seriesId! };
}

test("committing to a series signs every remaining launch, posted or only announced", () => {
  const { c, id } = setup();
  const launches = seriesOf(c, id);
  assert.ok(launches.length >= 2);
  assert.ok(launches.some((l) => l.postedDay > c.day), "some launches are not posted yet");
  commitSeries(c, id);
  for (const l of launches) assert.ok(c.accepted.includes(l.id), l.title);
  assert.deepEqual(uncommitted(c, id), []);
  assert.throws(() => commitSeries(c, id), /Nothing left/);
});

test("a commitment picks up whatever was not already signed by hand", () => {
  const { c, id } = setup();
  const [first, ...rest] = seriesOf(c, id);
  accept(c, first!.id);
  assert.equal(uncommitted(c, id).length, rest.length);
  commitSeries(c, id);
  assert.equal(c.accepted.filter((a) => seriesOf(c, id).some((l) => l.id === a)).length, rest.length + 1);
});

test("the bonus is paid once every launch is delivered, however it was signed", () => {
  const { c, id } = setup();
  const launches = seriesOf(c, id);
  const bonus = seriesBonus(c, id);
  assert.ok(bonus > 0);
  const cash = c.cash;
  for (const l of launches.slice(0, -1)) c.closed[l.id] = "delivered";
  assert.deepEqual(seriesCompletion(c, launches.at(-2)!), [], "not until the last");
  c.closed[launches.at(-1)!.id] = "delivered";
  assert.equal(seriesCompletion(c, launches.at(-1)!).length, 1);
  assert.equal(c.cash, cash + bonus);
});

test("no bonus when any launch was lost, late or withdrawn", () => {
  const { c, id } = setup();
  const launches = seriesOf(c, id);
  for (const l of launches) c.closed[l.id] = "delivered";
  c.closed[launches[0]!.id] = "failed";
  const cash = c.cash;
  assert.deepEqual(seriesCompletion(c, launches.at(-1)!), []);
  assert.equal(c.cash, cash);
});

test("a failed test flight goes on the record but costs no reputation, and customers don't hold it against the company", () => {
  const { c } = setup();
  const picky = c.board.find((x) => x.refuses.length > 0)!;
  const before = reputation(c);
  c.record.push({ day: c.day, tag: picky.refuses[0]!, reputation: 0, note: "Pathfinder test flight", test: true });
  assert.equal(reputation(c), before);
  assert.equal(objectionTo(c, picky), undefined);
  c.record.push({ day: c.day, tag: picky.refuses[0]!, reputation: -1, note: picky.title });
  assert.ok(objectionTo(c, picky), "a lost customer payload still counts");
});
