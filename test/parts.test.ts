import assert from "node:assert/strict";
import { test } from "node:test";
import { IDEAL_AERO } from "../src/sim/airframe.ts";
import { build, developEngine, developedParts, fire, newCompany, refinePart, reengine, REFINE, type Company } from "../src/sim/company.ts";
import { COSTS } from "../src/sim/cost.ts";
import { combineTruth, IDEAL_TRUTH, rollPartTruth, rollPartTruths, rollTruths, type PartTruth } from "../src/sim/hardware.ts";
import { assembleEngine, developmentCost, engineRanges, partKeys, partsProblems, type EngineParts } from "../src/sim/parts.ts";
import { applyFix, hotFire, newCampaign, seenAt } from "../src/sim/teststand.ts";
import { generateBoard } from "../src/contracts.ts";
import { ENGINES, HARRIER_SL, HARRIER_VAC, KESTREL_SL, VEHICLES } from "../src/vehicles.ts";

const NEUTRAL_PART: PartTruth = { ispFactor: 1, hardStart: false, instabilityOnset: null, lifeFactor: 1 };

/** A campaign with the two Harriers and every part neutral unless a test says otherwise. */
function harriers(overrides: Record<string, Partial<PartTruth>> = {}) {
  const engines = [HARRIER_SL, HARRIER_VAC];
  const partTruth = rollPartTruths(engines, 1);
  for (const key of Object.keys(partTruth)) partTruth[key] = { ...NEUTRAL_PART, ...overrides[key] };
  const truth = Object.fromEntries(engines.map((e) => [e.name, combineTruth(e, partTruth)]));
  return newCampaign(truth, {}, { engines, partTruth });
}

const keys = partKeys(HARRIER_SL.parts!);

test("parts assemble into an engine deterministically, with honest ranges", () => {
  const parts: EngineParts = { size: 25, cycle: "gas-generator", injector: "coaxial", cooling: "regenerative", nozzle: "vacuum" };
  const a = assembleEngine(parts, "Test");
  assert.deepEqual(a, assembleEngine(parts, "Test"));
  assert.ok(a.thrustVac > 25_000 && a.ispVac > 320 && a.exitPressure === 6_000);
  assert.ok(a.unitCost! > 0 && a.ratedLife! > 320);
  const r = engineRanges(a)!;
  assert.ok(r.isp[0] < r.isp[1] && r.isp[1] <= a.ispVac);
  assert.ok(r.life[0] < a.ratedLife! && r.life[1] > a.ratedLife!);
  assert.deepEqual(partsProblems({ ...parts, size: 9 }), ["Gas generator engines come in 25, 35, 50, 100, 250 kN, not 9 kN."]);
});

test("sister engines share their cycle, injector and cooling truths", () => {
  for (let seed = 0; seed < 50; seed++) {
    const t = rollTruths([HARRIER_SL, HARRIER_VAC], seed);
    const sl = t[HARRIER_SL.name]!;
    const vac = t[HARRIER_VAC.name]!;
    assert.equal(sl.hardStart, vac.hardStart, `seed ${seed}`);
    assert.equal(sl.instabilityOnset, vac.instabilityOnset, `seed ${seed}`);
    // Same liner, so the same share of each engine's rated life.
    assert.ok(Math.abs(sl.thermalLife / HARRIER_SL.ratedLife! - vac.thermalLife / HARRIER_VAC.ratedLife!) < 1e-9);
  }
  assert.deepEqual(rollPartTruth(keys.injector, 3), rollPartTruth(keys.injector, 3));
});

test("firing one Harrier proves the shared parts for the other, up to its cooling", () => {
  const campaign = harriers();
  hotFire(campaign, HARRIER_SL, 120, "sea-level");
  const vac = campaign.knowledge[HARRIER_VAC.name]!;
  assert.equal(vac.firings, 0);
  assert.equal(vac.startupProven, true);
  // 120 s stable on the injector; 120 of 150 s rated life on the liner is 240 of the Vac's 300.
  assert.equal(vac.provenDuration, 120);
  assert.equal(campaign.parts[keys.injector]!.stableSeconds, 120);
  assert.equal(campaign.parts[keys.cooling]!.lifeShare, 0.8);
  assert.equal(campaign.parts[keys.nozzle]!.firings, 1);
  assert.equal(campaign.parts[partKeys(HARRIER_VAC.parts!).nozzle], undefined);
});

test("an instability found on one Harrier is open on both, and one fix covers both", () => {
  const campaign = harriers({ [keys.injector]: { instabilityOnset: 40 } });
  hotFire(campaign, HARRIER_SL, 60, "sea-level");
  assert.deepEqual(campaign.knowledge[HARRIER_VAC.name]!.open, ["combustion-instability"]);
  assert.equal(seenAt(campaign.knowledge[HARRIER_VAC.name], "combustion-instability"), 40);

  // Baffles are paid for once and cover both engines. Startup proof lives on
  // the cycle, which the fix doesn't touch.
  const spent = campaign.spent;
  const { text } = applyFix(campaign, HARRIER_SL, "combustion-instability");
  assert.equal(campaign.spent - spent, 400);
  assert.match(text, /Harrier-Vac shares the part and gets the fix too/);
  for (const e of [HARRIER_SL, HARRIER_VAC]) {
    assert.equal(campaign.truth[e.name]!.instabilityOnset, null);
    assert.deepEqual(campaign.knowledge[e.name]!.open, []);
    assert.equal(campaign.knowledge[e.name]!.startupProven, true);
    assert.equal(campaign.knowledge[e.name]!.provenDuration, 0);
  }
  assert.equal(campaign.parts[keys.injector]!.revision, 1);
});

test("a burn-through predicts the sister's at the same share of rated life", () => {
  const campaign = harriers({ [keys.cooling]: { lifeFactor: 0.6 } });
  hotFire(campaign, HARRIER_SL, 200, "sea-level");
  assert.equal(seenAt(campaign.knowledge[HARRIER_SL.name], "burn-through"), 90);
  assert.equal(seenAt(campaign.knowledge[HARRIER_VAC.name], "burn-through"), 180);
});

function company(): Company {
  const c = newCompany(1, 30_000, VEHICLES, Object.values(ENGINES), generateBoard(1));
  for (const key of Object.keys(c.campaign.aeroTruth)) c.campaign.aeroTruth[key] = IDEAL_AERO;
  return c;
}

test("developing an engine charges only for parts the company doesn't build yet", () => {
  const c = company();
  const sister: EngineParts = { ...HARRIER_SL.parts!, nozzle: "vacuum" };
  const quote = developmentCost(sister, developedParts(c));
  assert.equal(quote.newParts.length, 1, "only the 25 kN vacuum bell is new");
  const { cash, day } = c;
  developEngine(c, sister, "Harrier-Vac Lite");
  assert.equal(c.day, day + quote.days);
  assert.equal(c.cash, cash - quote.cost - quote.days * COSTS.overheadPerDay);
  const truth = c.campaign.truth["Harrier-Vac Lite"]!;
  assert.equal(truth.hardStart, c.campaign.truth[HARRIER_SL.name]!.hardStart);
  assert.equal(truth.instabilityOnset, c.campaign.truth[HARRIER_SL.name]!.instabilityOnset);
  assert.ok(c.ledger.some((e) => e.category === "rnd"));
  assert.throws(() => developEngine(c, sister, "Harrier-Vac Lite"), /already an engine/);

  const fresh: EngineParts = { size: 35, cycle: "electric-pump", injector: "pintle", cooling: "regenerative", nozzle: "altitude" };
  assert.equal(developmentCost(fresh, developedParts(c)).newParts.length, 4);
});

test("a developed engine starts with what its shared parts already know", () => {
  const c = company();
  c.campaign.truth[HARRIER_SL.name] = { ...IDEAL_TRUTH, ispFactor: 0.97 };
  for (const key of Object.values(keys)) c.campaign.partTruth[key] = { ...NEUTRAL_PART };
  fire(c, HARRIER_SL, 100, "sea-level");
  developEngine(c, { ...HARRIER_SL.parts!, nozzle: "vacuum" }, "Harrier-Vac Lite");
  const known = c.campaign.knowledge["Harrier-Vac Lite"]!;
  assert.equal(known.startupProven, true);
  assert.ok(known.provenDuration > 0);
});

test("refining needs measured Isp, moves the truth up within the range, and clears the measurement", () => {
  const c = company();
  c.campaign.partTruth[keys.injector] = { ...NEUTRAL_PART, ispFactor: 0.96 };
  for (const e of [HARRIER_SL, HARRIER_VAC]) c.campaign.truth[e.name] = combineTruth(e, c.campaign.partTruth);
  assert.throws(() => refinePart(c, keys.injector), /Measure Isp/);
  assert.throws(() => refinePart(c, keys.cycle), /Only injectors and nozzles/);
  fire(c, HARRIER_SL, 30, "sea-level");
  const before = c.campaign.truth[HARRIER_VAC.name]!.ispFactor;
  const cash = c.cash;
  refinePart(c, keys.injector);
  assert.ok(Math.abs(c.campaign.partTruth[keys.injector]!.ispFactor - (0.96 + REFINE.step)) < 1e-9);
  assert.ok(c.campaign.truth[HARRIER_VAC.name]!.ispFactor > before, "the sister gains too");
  assert.equal(c.campaign.knowledge[HARRIER_SL.name]!.measuredIspFactor, null);
  assert.equal(c.cash, cash - REFINE.cost - REFINE.days * COSTS.overheadPerDay);
  assert.equal(c.campaign.parts[keys.injector]!.revision, 1);
});

test("re-engining a design is refused while any are built", () => {
  const c = company();
  developEngine(c, { ...KESTREL_SL.parts!, size: 9, nozzle: "large-vacuum" }, "Kestrel-Vac 9");
  reengine(c, "two-stage", 1, "Kestrel-Vac 9");
  assert.equal(c.designs["two-stage"]!.stages[1]!.engine.name, "Kestrel-Vac 9");
  build(c, "two-stage");
  assert.throws(() => reengine(c, "two-stage", 1, "Kestrel-Vac Mini"), /already built/);
  assert.throws(() => reengine(c, "two-stage", 5, "Kestrel-Vac Mini"), /no stage 6/);
});
