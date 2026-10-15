import assert from "node:assert/strict";
import { test } from "node:test";
import { newCompany } from "../src/sim/company.ts";
import { generateBoard } from "../src/contracts.ts";
import { BLADE_REDLINE, defaultDesign, designOf, seaLevelEps } from "../src/sim/enginePhysics.ts";
import { runTask, twinOf } from "../src/sim/schedule.ts";
import type { EngineParts } from "../src/sim/parts.ts";
import { ENGINES, VEHICLES } from "../src/vehicles.ts";
import { commitQuote, curveFor, draft, families, readouts, revisionName, stamp } from "../src/web/engineDesign.ts";

const company = () => newCompany(3, 30_000, VEHICLES, Object.values(ENGINES), generateBoard(3));
const GG: EngineParts = { size: 25, cycle: "gas-generator", injector: "coaxial", cooling: "film", nozzle: "sea-level" };

test("engines group into programmes with drawing IDs; starting engines are Rev A of their own programme", () => {
  const c = company();
  const fams = families(c);
  assert.ok(fams.length > 0);
  assert.equal(fams[0]!.id, "ENG-01");
  for (const f of fams) assert.equal(f.revisions[0]!.rev, 0);
});

test("an engine drawn before the model shows its own figures until a parameter moves", () => {
  const c = company();
  const base = Object.values(c.campaign.engines).find((e) => e.parts)!;
  const same = draft(base.parts!, designOf(base)!, base);
  assert.equal(same.changed, false);
  assert.equal(same.engine, base, "the released revision flies its own numbers");
  assert.ok(readouts(same).every((r) => r.delta === null));
  const moved = draft(base.parts!, { ...designOf(base)!, pc: designOf(base)!.pc + 5 }, base);
  assert.equal(moved.changed, true);
  assert.ok(readouts(moved).some((r) => r.delta !== null && r.delta !== 0));
});

test("a limit stamps NO-GO and blocks the commit; a clean change is a DRAFT", () => {
  const c = company();
  const base = Object.values(c.campaign.engines).find((e) => e.parts?.cycle === "gas-generator")!;
  const hot = draft(base.parts!, { ...designOf(base)!, t0: BLADE_REDLINE + 20 }, base);
  assert.equal(hot.ok, false);
  assert.equal(stamp(hot, 0, undefined, c.day).text, "✕ NO-GO");
  assert.match(commitQuote(c, hot, revisionName(base.name, 1)).blocked!, /LIMITS/);
  const tidy = draft(base.parts!, { ...designOf(base)!, t0: 920 }, base);
  assert.equal(stamp(tidy, 0, undefined, c.day).text, "DRAFT");
  assert.equal(commitQuote(c, tidy, revisionName(base.name, 1)).blocked, null);
});

test("committing a revision develops an engine at that design point, in the same programme", () => {
  const c = company();
  const base = Object.values(c.campaign.engines).find((e) => e.parts?.cycle === "gas-generator")!;
  const design = { ...designOf(base)!, pc: designOf(base)!.pc + 10, pd: (designOf(base)!.pc + 10) * 1.35 };
  const d = draft(base.parts!, design, base);
  const name = revisionName(base.name, 1);
  runTask(c, { kind: "develop", name, parts: d.parts, design, family: base.name, rev: 1 });
  const made = c.campaign.engines[name]!;
  assert.deepEqual(made.design, design);
  assert.equal(made.family, base.name);
  assert.equal(made.rev, 1);
  assert.ok(made.thrustVac > base.thrustVac * 1.05, "more chamber pressure, more thrust");
  assert.ok(c.campaign.truth[name], "a truth is rolled for the new revision");
  const fam = families(c).find((f) => f.name === base.name)!;
  assert.deepEqual(fam.revisions.map((r) => r.rev), [0, 1]);
  // The same drawing again is a twin; a different point is not.
  assert.equal(twinOf(c, d.parts, design), name);
  assert.equal(twinOf(c, d.parts, { ...design, pc: design.pc + 1 }), null);
});

test("the nozzle curve: Isp vac rises with ε, a redline where the bell separates at sea level", () => {
  const curve = curveFor("nozzle", GG, defaultDesign(GG))!;
  const a = curve.a.ys;
  assert.ok(a.at(-1)! > a[0]!);
  assert.equal(curve.redlines[0]!.label, "SEP @ SL");
  assert.ok(Math.abs(curve.redlines[0]!.x - seaLevelEps("gas-generator", 70)) < 1e-9);
  assert.ok(curve.b!.ys.some((y) => Number.isNaN(y)), "no sea-level trace once the flow separates");
  assert.deepEqual(curve.bands!.map((b) => b.label), ["ALT", "VAC", "XL"]);
});
