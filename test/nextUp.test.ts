import assert from "node:assert/strict";
import { test } from "node:test";
import { accept, newCompany, posted } from "../src/sim/company.ts";
import { generateBoard } from "../src/contracts.ts";
import { ENGINES, VEHICLES } from "../src/vehicles.ts";
import { flightStatuses, nextUp } from "../src/web/nextUp.ts";

const fresh = () => newCompany(3, 10_000, VEHICLES, Object.values(ENGINES), generateBoard(3));

test("with nothing signed, next up says to find work and where the licence stands", () => {
  const c = fresh();
  const items = nextUp(c);
  assert.ok(items.some((i) => i.key === "work" && i.action.route.place === "contracts"));
  assert.ok(items.some((i) => i.key === "licence" && /of/.test(i.title)));
});

test("a signed flight on untested hardware lists the engines to fire, the build, and the shape", () => {
  const c = fresh();
  const sounding = posted(c).find((x) => x.minApogee !== undefined && x.minReputation <= 0)!;
  accept(c, sounding.id);
  const items = nextUp(c, flightStatuses(c), 20);
  assert.ok(!items.some((i) => i.key === "work"));
  const fire = items.filter((i) => i.action.label === "Fire");
  assert.ok(fire.length > 0, "an engine to fire");
  assert.ok(fire.every((i) => i.action.route.place === "testing" && i.action.route.engine));
  assert.ok(items.some((i) => i.key === `build:${sounding.id}`), "no rocket built yet");
  assert.ok(items.some((i) => i.key.startsWith("shape:") && i.action.route.tab === "tunnel"));
  // Most pressing first.
  const order = { bad: 0, caution: 1, good: 2, data: 3 };
  assert.deepEqual(items.map((i) => order[i.tone]), [...items.map((i) => order[i.tone])].sort((a, b) => a - b));
});

test("each signed flight has a status the pipeline can draw", () => {
  const c = fresh();
  const sounding = posted(c).find((x) => x.minApogee !== undefined && x.minReputation <= 0)!;
  accept(c, sounding.id);
  const [s] = flightStatuses(c);
  assert.equal(s!.contract.id, sounding.id);
  assert.equal(s!.ready, null);
  assert.ok(s!.engines.size > 0);
});

test("a flight that can't be done offers the sizing guide on that contract", () => {
  const c = fresh();
  const sounding = posted(c).find((x) => x.minApogee !== undefined && x.minReputation <= 0)!;
  accept(c, sounding.id);
  // A payload no design here can lift: the forecast misses, and the guide is the way out.
  c.board.find((x) => x.id === sounding.id)!.payloadMass = 50_000;
  const miss = nextUp(c, flightStatuses(c), 20).find((i) => i.key === `forecast:${sounding.id}`);
  assert.ok(miss, "the forecast misses");
  assert.equal(miss.action.label, "Simulate");
  assert.deepEqual(miss.alt?.route, { place: "rockets", tab: "board", contract: sounding.id });
});
