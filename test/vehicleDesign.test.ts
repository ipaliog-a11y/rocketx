import assert from "node:assert/strict";
import { test } from "node:test";
import { newCompany } from "../src/sim/company.ts";
import { specOf } from "../src/sim/builder.ts";
import { generateBoard } from "../src/contracts.ts";
import { ENGINES, VEHICLES } from "../src/vehicles.ts";
import { drawQuote, nextRevisionName, readParam, revisionOf, vDraft, vehicleParts, vReadouts, withRecovery, writeParam } from "../src/web/vehicleDesign.ts";

const company = () => newCompany(3, 30_000, VEHICLES, Object.values(ENGINES), generateBoard(3));
const meridianOf = (c: ReturnType<typeof company>) => Object.values(c.designs).find((v) => v.name === "Meridian")!;

test("a released design opened unchanged shows no deltas; a moved parameter shows what it did", () => {
  const c = company();
  const base = meridianOf(c);
  const same = vDraft(c, specOf(base), base, []);
  assert.equal(same.changed, false);
  assert.ok(vReadouts(same, c.campaign.engines).every((r) => r.delta === null));
  const longer = vDraft(c, writeParam(specOf(base), "l0", readParam(withG(specOf(base)), "l0") + 2), base, []);
  assert.equal(longer.changed, true);
  const dv = vReadouts(longer, c.campaign.engines).find((r) => r.key === "dv")!;
  assert.ok(dv.delta! > 0, "longer booster tanks add Δv");
});

// writeParam attaches the default geometry, as the screen does.
const withG = (s: ReturnType<typeof specOf>) => writeParam(s, "payload", s.payloadMass);

test("the part tree follows the stack; parameters round-trip", () => {
  const c = company();
  const spec = specOf(meridianOf(c));
  assert.deepEqual(vehicleParts(spec).map((p) => p.tag), ["FRG-1", ...spec.stages.map((_, i) => `S${spec.stages.length - i}`), "FIN-1", "GNC-1", "REC-1", "PL-1"]);
  const s = writeParam(spec, "p0", 2.4);
  // The booster comes back at the reserve set; expended again, the recovery is gone.
  const back = writeParam(spec, "r:reserve", 15);
  assert.equal(readParam(back, "r:reserve"), 15);
  assert.equal(withRecovery(back, null).geometry?.recovery, undefined);
  assert.equal(readParam(s, "p0"), 2.4);
  assert.equal(readParam(writeParam(spec, "jettison", 120), "jettison"), 120);
});

test("a hard limit blocks the drawing with its reason", () => {
  const c = company();
  const base = meridianOf(c);
  const low = vDraft(c, writeParam(specOf(base), "jettison", 90), base, []);
  assert.ok(low.problems.some((p) => /100 km/.test(p)));
  assert.ok(drawQuote(c, low, "Meridian B").blocked);
  const fine = vDraft(c, writeParam(specOf(base), "jettison", 118), base, []);
  assert.equal(drawQuote(c, fine, "Meridian B").blocked ?? null, null, fine.problems.join(" "));
});

test("revisions are named by letter after the base", () => {
  const c = company();
  assert.deepEqual(nextRevisionName(c, "Meridian"), { name: "Meridian B", letter: "B" });
  assert.equal(revisionOf("Meridian C"), "C");
  assert.equal(revisionOf("Meridian"), "A");
});
