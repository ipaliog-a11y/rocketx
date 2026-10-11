import assert from "node:assert/strict";
import { test } from "node:test";
import { build, buildDays, fire, LEARNING, learningFactor, newCompany, nextSlot, wait, type Company } from "../src/sim/company.ts";
import { COSTS, vehicleCost } from "../src/sim/cost.ts";
import { IDEAL_TRUTH, type EngineTruth } from "../src/sim/hardware.ts";
import { book, buyUnit, cancelTask, quoteTask, TRACKS } from "../src/sim/schedule.ts";
import { FACILITIES, FIXES, HARDWARE_LOSS } from "../src/sim/teststand.ts";
import { generateBoard } from "../src/contracts.ts";
import { ENGINES, HARRIER_SL, HARRIER_VAC, KESTREL_SL, VEHICLES } from "../src/vehicles.ts";

function company(truth: Record<string, EngineTruth> = {}): Company {
  const c = newCompany(1, 50_000, VEHICLES, Object.values(ENGINES), generateBoard(1));
  for (const name of Object.keys(c.campaign.truth)) c.campaign.truth[name] = truth[name] ?? IDEAL_TRUTH;
  return c;
}

const fireSpec = (engine: string, seconds: number, facility: "sea-level" | "altitude" = "sea-level") => ({ kind: "fire" as const, engine, seconds, facility, restart: false });

test("jobs on different tracks run side by side, and show nothing until they finish", () => {
  const c = company();
  book(c, fireSpec(HARRIER_SL.name, 30));
  book(c, fireSpec(HARRIER_VAC.name, 30, "altitude"));
  assert.equal(c.day, 0, "booking doesn't move the clock");
  assert.equal(c.campaign.knowledge[HARRIER_SL.name]?.firings ?? 0, 0, "no result before the days pass");
  const days = Math.max(FACILITIES["sea-level"].days, FACILITIES.altitude.days);
  wait(c, days);
  assert.equal(c.campaign.knowledge[HARRIER_SL.name]!.firings, 1);
  assert.equal(c.campaign.knowledge[HARRIER_VAC.name]!.firings, 1);
  assert.equal(c.tasks.length, 0);
  // Serial, the two would have taken the sum.
  assert.ok(days < FACILITIES["sea-level"].days + FACILITIES.altitude.days);
});

test("a result lands on the day its job finishes, mid-wait", () => {
  const c = company();
  book(c, fireSpec(HARRIER_SL.name, 30));
  wait(c, 30);
  const firing = c.done.find((d) => d.track === "stand")!;
  assert.equal(firing.day, FACILITIES["sea-level"].days);
});

test("jobs on one track queue in booking order", () => {
  const c = company();
  book(c, fireSpec(HARRIER_SL.name, 30));
  const q = quoteTask(c, fireSpec(KESTREL_SL.name, 30));
  assert.equal(q.start, FACILITIES["sea-level"].days, "waits for the stand");
  const { task } = book(c, fireSpec(KESTREL_SL.name, 30));
  assert.equal(task.startDay, undefined);
  wait(c, q.end);
  assert.equal(c.done.find((d) => d.title === task.title)!.day, q.end);
});

test("a firing waits for a fix to its parts booked before it, even with the stand free", () => {
  const c = company({ [HARRIER_SL.name]: { ...IDEAL_TRUTH, instabilityOnset: 10 } });
  fire(c, HARRIER_SL, 30, "sea-level");
  const open = c.campaign.knowledge[HARRIER_SL.name]!.open;
  assert.deepEqual(open, ["combustion-instability"]);
  // The stand is busy building a new test engine; let it finish.
  wait(c, HARDWARE_LOSS.days);
  const today = c.day;
  book(c, { kind: "fix-engine", engine: HARRIER_SL.name, mode: "combustion-instability" });
  const q = quoteTask(c, fireSpec(HARRIER_VAC.name, 30, "altitude"));
  const fix = FIXES["combustion-instability"]!;
  assert.equal(q.start, today + fix.days, "the Vac shares the injector, so it fires on the fixed one");
  const { task } = book(c, fireSpec(HARRIER_VAC.name, 30, "altitude"));
  wait(c, q.end - c.day);
  assert.equal(c.done.find((d) => d.title === task.title)!.day, q.end);
  assert.deepEqual(c.campaign.knowledge[HARRIER_VAC.name]!.open, []);
});

test("a destroyed test engine keeps its stand busy while a new one is built", () => {
  const c = company({ [KESTREL_SL.name]: { ...IDEAL_TRUTH, instabilityOnset: 5 } });
  book(c, fireSpec(KESTREL_SL.name, 30));
  const next = book(c, fireSpec(HARRIER_SL.name, 30)).task;
  wait(c, 60);
  const start = FACILITIES["sea-level"].days + HARDWARE_LOSS.days;
  assert.equal(c.done.find((d) => d.title === next.title)!.day, start + FACILITIES["sea-level"].days);
});

test("a job not yet started can be cancelled for its money back", () => {
  const c = company();
  book(c, fireSpec(HARRIER_SL.name, 30));
  const cash = c.cash;
  const { task } = book(c, fireSpec(KESTREL_SL.name, 30));
  assert.ok(c.cash < cash);
  cancelTask(c, task.id);
  assert.equal(c.cash, cash);
  assert.throws(() => cancelTask(c, c.tasks[0]!.id), /has started/);
});

test("a second stand takes jobs once it is set up", () => {
  const c = company();
  buyUnit(c, "stand");
  const setup = TRACKS.stand.extra[0]!.days;
  wait(c, setup);
  book(c, fireSpec(HARRIER_SL.name, 30));
  const { task } = book(c, fireSpec(KESTREL_SL.name, 30));
  assert.equal(task.startDay, c.day, "both stands fire at once");
});

test("time on the tracks is charged as payroll once, not per job", () => {
  const c = company();
  const cash = c.cash;
  const a = book(c, fireSpec(HARRIER_SL.name, 30)).task;
  const b = book(c, fireSpec(HARRIER_VAC.name, 30, "altitude")).task;
  wait(c, FACILITIES.altitude.days);
  const spent = a.cost + b.cost + FACILITIES.altitude.days * COSTS.overheadPerDay;
  assert.ok(Math.abs(cash - c.cash - spent) < 1e-6, `${cash - c.cash} vs ${spent}`);
});

test("the factory learns: repeat builds of a design get faster, down to a floor", () => {
  const c = company();
  const first = vehicleCost(c.designs.pathfinder!).days;
  assert.equal(buildDays(c, "pathfinder"), first);
  build(c, "pathfinder");
  assert.equal(buildDays(c, "pathfinder"), Math.round(first * LEARNING.rate), "the second takes 85% of the time");
  assert.equal(nextSlot(c, "pathfinder").readyDay - nextSlot(c, "pathfinder").startDay, buildDays(c, "pathfinder"));
  assert.equal(buildDays(c, "meridian"), vehicleCost(c.designs.meridian!).days, "each design learns on its own");
  assert.equal(learningFactor(1000), LEARNING.floor);
});

test("an engine identical to one the company has can't be developed again", () => {
  const c = company();
  assert.throws(() => book(c, { kind: "develop", name: "Harrier-SL Copy", parts: { ...HARRIER_SL.parts! } }), /already this engine/);
  const parts = { ...HARRIER_SL.parts!, nozzle: "vacuum" as const };
  book(c, { kind: "develop", name: "Harrier-V2", parts });
  assert.throws(() => book(c, { kind: "develop", name: "Harrier-V3", parts }), /Harrier-V2 is already this engine/, "nor one already being developed");
});
