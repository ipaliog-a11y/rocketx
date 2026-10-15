import assert from "node:assert/strict";
import { test } from "node:test";
import { accept, newCompany, posted, strandedWith } from "../src/sim/company.ts";
import { generateBoard } from "../src/contracts.ts";
import { COSTS, vehicleCost } from "../src/sim/cost.ts";
import { ENGINES, VEHICLES } from "../src/vehicles.ts";
import { cashRisk, LOW_CASH } from "../src/web/cashRisk.ts";
import { buildJob, cancelJob, designFor, launchJob, unitJob, waitJob } from "../src/web/jobs.ts";

const fresh = () => newCompany(3, 10_000, VEHICLES, Object.values(ENGINES), generateBoard(3));
const orbital = (c: ReturnType<typeof fresh>) => Object.keys(c.designs).filter((k) => c.designs[k]!.pitchProgram?.kind === "gravity-turn");

test("a short wait with money in the bank is fine and doesn't ask", () => {
  const c = fresh();
  const r = cashRisk(c, waitJob(10, "waiting"));
  assert.equal(r.level, "ok");
  assert.equal(r.after, c.cash - 10 * COSTS.overheadPerDay);
  assert.equal(r.asks, false);
});

test("a job that leaves the cash under the red line is low, and asks", () => {
  const c = fresh();
  c.firstOrbitDay = 1; // past the first orbit, low cash is only low
  c.cash = LOW_CASH + 100;
  const r = cashRisk(c, waitJob(30, "waiting"));
  assert.equal(r.level, "low");
  assert.ok(r.asks);
  assert.match(r.reasons[0]!, /days of payroll/);
});

test("a big spend always asks, even when the money is there", () => {
  const c = fresh();
  c.cash = 100_000;
  assert.ok(cashRisk(c, waitJob(250, "waiting")).asks);
});

test("a launch whose penalty is more than the cash left warns, and asks", () => {
  const c = fresh();
  const contract = posted(c).find((x) => x.minReputation <= 0)!;
  accept(c, contract.id);
  contract.penalty = c.cash * 2;
  const r = cashRisk(c, launchJob(c, designFor(c, contract), contract, () => {}));
  assert.equal(r.level, "low");
  assert.ok(r.worst < 0 && r.after > LOW_CASH);
  assert.ok(r.reasons.some((t) => /If the flight fails/.test(t)));
  assert.ok(r.asks);
});

test("spending more than the company has ends it", () => {
  const c = fresh();
  c.cash = 100;
  const r = cashRisk(c, unitJob(c, "stand")!);
  assert.equal(r.level, "ends");
  assert.ok(r.after < 0);
  assert.ok(r.asks);
});

test("before first orbit, spending what another orbital try needs ends the company", () => {
  const c = fresh();
  const need = strandedWith(c, 0);
  assert.ok(need, "a fresh company has an orbital design it hasn't built");
  c.cash = need.needed + 500;
  const r = cashRisk(c, unitJob(c, "stand")!);
  assert.ok(r.after >= 0);
  assert.equal(r.level, "ends");
  assert.match(r.reasons[0]!, /orbital rocket/);
});

test("ordering an orbital rocket is never the spend that strands the company", () => {
  const c = fresh();
  const key = orbital(c)[0]!;
  c.cash = vehicleCost(c.designs[key]!).cost + 300;
  const r = cashRisk(c, buildJob(c, key));
  assert.notEqual(r.level, "ends");
  assert.equal(r.level, "low");
});

test("a wait past a signed deadline counts the penalty", () => {
  const c = fresh();
  const contract = posted(c).find((x) => x.minReputation <= 0)!;
  accept(c, contract.id);
  const days = contract.deadline - c.day + 1;
  const r = cashRisk(c, waitJob(days, "waiting"));
  assert.equal(r.after, c.cash - days * COSTS.overheadPerDay - contract.penalty);
});

test("calling off a queued job brings its money back", () => {
  const c = fresh();
  const task = { id: 1, title: "A firing", cost: 400 } as Parameters<typeof cancelJob>[0];
  const r = cashRisk(c, cancelJob(task));
  assert.equal(r.after, c.cash + 400);
  assert.equal(r.level, "ok");
});
