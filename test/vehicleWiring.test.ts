import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { aeroShape, dragMultiplier, rollAeroTruth } from "../src/sim/airframe.ts";
import { assembleVehicle, checkVehicle, designQuote, specOf, type VehicleSpec } from "../src/sim/builder.ts";
import { newCompany } from "../src/sim/company.ts";
import { defaultFins, defaultGeometry } from "../src/sim/geometry.ts";
import { designSpec, runTask } from "../src/sim/schedule.ts";
import { tunnelRun, believedAero } from "../src/sim/tunnel.ts";
import { learnFromFlight } from "../src/sim/telemetry.ts";
import { generateBoard } from "../src/contracts.ts";
import { MISSIONS } from "../src/missions.ts";
import { ENGINES, VEHICLES } from "../src/vehicles.ts";

const meridian = Object.values(VEHICLES).find((v) => v.name === "Meridian")!;
const engines = Object.fromEntries(Object.values(ENGINES).map((e) => [e.name, e]));
const geometric = (name = "Meridian G"): VehicleSpec => ({ ...specOf(meridian), name, geometry: defaultGeometry(2) });
const LEO = MISSIONS["leo-300"]!;

test("a vehicle drawn without a geometry is built and flies exactly as before", () => {
  const spec = specOf(meridian);
  const v = assembleVehicle(spec, engines);
  assert.equal(v.geometry, undefined);
  assert.equal(v.fairing, undefined);
  assert.equal(v.structure, undefined);
  assert.deepEqual(designQuote(spec, []).newMaterials, undefined);
  assert.equal(aeroShape(v).key, `${spec.fairingDiameter}/${spec.stages.map((s) => s.diameter).join("-")}`);
  // Legacy truths carry no supersonic part, so drag is unchanged at every Mach.
  const truth = rollAeroTruth(v, 7);
  assert.equal(truth.supersonicFactor, undefined);
  assert.equal(dragMultiplier(truth, 2), truth.dragFactor);
});

test("drawn with a geometry: built-up drag, derived limits, a fairing that comes off at its altitude", () => {
  const v = { ...assembleVehicle(geometric(), engines), pitchProgram: meridian.pitchProgram };
  assert.notDeepEqual(v.dragCurve, meridian.dragCurve);
  assert.ok(v.limits.maxQAlpha! > 25_000 && v.limits.maxQAlpha! < 35_000);
  assert.ok(v.fairing!.mass > 0);
  const r = simulateAscent(v, LEO, {});
  const off = r.events.find((e) => e.kind === "fairing-jettison");
  assert.ok(off, "the fairing is jettisoned");
  assert.ok(off.altitude >= v.fairing!.jettisonAltitude && off.altitude < v.fairing!.jettisonAltitude + 2_000);
  assert.ok((off.value ?? 0) < 1135, "at 115 km the heating is under what a payload takes");
});

test("a shell weaker than its drawing buckles; structural failures off, or no truth given, it only records", () => {
  const v = { ...assembleVehicle(geometric(), engines), pitchProgram: meridian.pitchProgram };
  const weak = Object.fromEntries(v.structure!.stages.map((s) => [s.key, 0.4]));
  const r = simulateAscent(v, LEO, { structure: weak });
  const e = r.events.find((x) => x.kind === "structural-failure");
  assert.equal(e?.mode, "structural-buckling");
  assert.equal(r.outcome, "failure");
  assert.notEqual(simulateAscent(v, LEO, { structure: weak, structuralFailures: false }).outcome, "failure");
  assert.notEqual(simulateAscent(v, LEO, {}).outcome, "failure");
});

test("drawing one up rolls its shells' truth; a proof test reveals it; the bid's unknowns say so until then", () => {
  const c = newCompany(3, 30_000, VEHICLES, Object.values(ENGINES), generateBoard(3));
  const spec = geometric("Proofed");
  runTask(c, designSpec(c, spec));
  const key = Object.keys(c.designs).find((k) => c.designs[k]!.name === "Proofed")!;
  const v = c.designs[key]!;
  const sk = v.structure!.stages[0]!.key;
  assert.ok(c.campaign.structureTruth?.[sk] !== undefined);
  assert.equal(c.campaign.structureKnowledge?.[sk], undefined);
  runTask(c, { kind: "proof", design: key });
  assert.equal(c.campaign.structureKnowledge![sk]!.knockdown, c.campaign.structureTruth![sk]);
  assert.throws(() => runTask(c, { kind: "proof", design: key }), /proof-tested/);
});

test("tunnels learn only their own Mach range; a flight past Mach 1.5 measures the supersonic drag", () => {
  const c = newCompany(5, 30_000, VEHICLES, Object.values(ENGINES), generateBoard(5));
  runTask(c, designSpec(c, geometric("Shape")));
  const key = Object.keys(c.designs).find((k) => c.designs[k]!.name === "Shape")!;
  const v = c.designs[key]!;
  const shape = aeroShape(v).key;
  const truth = c.campaign.aeroTruth[shape]!;
  assert.ok(truth.supersonicFactor !== undefined);
  tunnelRun(c.campaign, v, "transonic");
  assert.equal(c.campaign.aeroKnowledge[shape]!.supersonicFactor ?? null, null, "the transonic tunnel doesn't reach it");
  assert.equal(believedAero(c.campaign)[shape]!.supersonicFactor, 1, "the model until measured");
  tunnelRun(c.campaign, v, "cfd");
  assert.equal(c.campaign.aeroKnowledge[shape]!.supersonicSource, "cfd");
  const r = simulateAscent({ ...v, pitchProgram: meridian.pitchProgram }, LEO, { aero: c.campaign.aeroTruth });
  learnFromFlight(c.campaign, v, r);
  assert.equal(c.campaign.aeroKnowledge[shape]!.supersonicSource, "flight");
  assert.equal(c.campaign.aeroKnowledge[shape]!.supersonicFactor, truth.supersonicFactor);
});

test("checks: continuous diameters, jettison height, and an unguided rocket needs a calibre of margin", () => {
  const one: VehicleSpec = { name: "Hopper", stages: [{ diameter: 0.73, tankLength: 3, engine: meridian.stages[0]!.engine.name, engineCount: 1 }], fairingDiameter: 0.73, payloadMass: 50, geometry: defaultGeometry(1) };
  const bare = checkVehicle(one, engines);
  assert.ok(!bare.problems.some((p) => /diameter the shop tools/.test(p)), "0.73 m is fine on a geometric design");
  assert.ok(bare.problems.some((p) => /Static margin/.test(p)));
  const finned = checkVehicle({ ...one, geometry: { ...defaultGeometry(1), fins: { ...defaultFins(0.73), span: 1.05, rootChord: 0.73 } } }, engines);
  assert.ok(!finned.problems.some((p) => /Static margin/.test(p)), finned.problems.join(" "));
  const low = checkVehicle({ ...one, geometry: { ...defaultGeometry(1), jettisonAltitude: 90_000 } }, engines);
  assert.ok(low.problems.some((p) => /Jettison above 100 km/.test(p)));
});
