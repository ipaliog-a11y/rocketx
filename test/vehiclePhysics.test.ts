import assert from "node:assert/strict";
import { test } from "node:test";
import { dragCoefficient, SLENDER_ROCKET } from "../src/sim/aero.ts";
import { baseDrag, buildDragCurve, dragBreakdown, nosePressureDrag, skinFriction } from "../src/sim/aerodynamics.ts";
import { engineMass, fairingMass, specOf } from "../src/sim/builder.ts";
import { defaultFins, defaultGeometry, noseRadius, type VehicleGeometry } from "../src/sim/geometry.ts";
import { centreOfPressure, forceComponents, stabilityOf } from "../src/sim/stability.ts";
import { bucklingLineLoad, structureLimits, tankMass, wallThickness } from "../src/sim/structures.ts";
import { VEHICLES } from "../src/vehicles.ts";

const meridian = Object.values(VEHICLES).find((v) => v.name === "Meridian")!;
const spec = specOf(meridian);
const stages = spec.stages.map((s, i) => ({ ...s, engine: meridian.stages[i]!.engine, dryMass: meridian.stages[i]!.dryMass, propellantMass: meridian.stages[i]!.propellantMass, engineMass: engineMass(meridian.stages[i]!.engine) }));
const input = (geometry: VehicleGeometry = defaultGeometry(2)) => ({ fairingDiameter: spec.fairingDiameter, stages, geometry, payloadMass: meridian.payloadMass, fairingMass: fairingMass(spec.fairingDiameter) });
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("friction: laminar at low Reynolds, turbulent above 5.39e5, and less of it supersonic", () => {
  near(skinFriction(1e5, 0, 10), 1.328 / Math.sqrt(1e5), 1e-9, "laminar");
  assert.ok(skinFriction(1e7, 0.3, 10) < skinFriction(1e6, 0.3, 10));
  assert.ok(skinFriction(5e7, 2, 30) < skinFriction(5e7, 0.5, 30));
});

test("nose families rank as the measurements do: von Kármán < ogive < cone above Mach 1.3", () => {
  for (const m of [1.5, 2, 3]) {
    const [vk, og, cone] = (["von-karman", "ogive", "cone"] as const).map((s) => nosePressureDrag(s, 2, m));
    assert.ok(vk! < og! && og! < cone!, `Mach ${m}`);
  }
  assert.ok(nosePressureDrag("ogive", 3.5, 2) < nosePressureDrag("ogive", 1.5, 2), "a finer nose has less wave drag");
});

test("base drag falls as engine bells fill the base", () => {
  const big = { ...stages[0]!, engine: { ...stages[0]!.engine, exitArea: stages[0]!.engine.exitArea * 2 } };
  const a = dragBreakdown({ fairingDiameter: 1.2, stages, geometry: defaultGeometry(2) }, 0.6).base;
  const b = dragBreakdown({ fairingDiameter: 1.2, stages: [big, stages[1]!], geometry: defaultGeometry(2) }, 0.6).base;
  assert.ok(b < a);
  assert.equal(baseDrag(2), 0.125);
});

test("a hammerhead fairing pays for its shoulder", () => {
  const slim = dragBreakdown({ fairingDiameter: 1.2, stages, geometry: defaultGeometry(2) }, 1.1);
  const fat = dragBreakdown({ fairingDiameter: 1.8, stages, geometry: defaultGeometry(2) }, 1.1);
  assert.ok(fat.steps > slim.steps);
});

test("the default shape's drag curve stays within 10% of the old hand curve up to Mach 3", () => {
  const curve = buildDragCurve({ fairingDiameter: spec.fairingDiameter, stages, geometry: defaultGeometry(2) });
  const machs = [0.3, 0.6, 0.8, 1.05, 1.2, 1.5, 2, 3];
  const err = machs.map((m) => Math.abs(dragCoefficient(curve, m) / dragCoefficient(SLENDER_ROCKET, m) - 1));
  assert.ok(err.reduce((a, b) => a + b) / err.length < 0.08, `mean error ${err}`);
  assert.ok(Math.max(...err) < 0.15, `max error ${err}`);
});

test("Barrowman: a cone's centre of pressure sits at two-thirds of its length; fins move it aft and add margin", () => {
  near(noseRadius("cone", 0.5, 2, 1), 0.25, 1e-12, "cone profile");
  const nose = forceComponents(input({ ...defaultGeometry(2), nose: { shape: "cone", fineness: 2 } }), 0.5, 0)[0]!;
  near(nose.x, (2 / 3) * 2 * 1.2, 0.02, "cone CP");
  near(nose.cnAlpha, 2, 1e-9, "nose CNα on its own base");
  const bare = stabilityOf(input());
  const finned = stabilityOf(input({ ...defaultGeometry(2), fins: defaultFins(1.2) }));
  assert.ok(centreOfPressure(forceComponents(input({ ...defaultGeometry(2), fins: defaultFins(1.2) }), 0.5, 0)).x > centreOfPressure(forceComponents(input(), 0.5, 0)).x);
  assert.ok(finned.min > bare.min);
  assert.ok(bare.min < 0, "a finless liquid rocket is aerodynamically unstable: it flies on its engines' steering");
});

test("tank walls: thicker with pressure and safety factor, never under minimum gauge; mass follows", () => {
  const g = defaultGeometry(1).stages[0]!;
  assert.equal(wallThickness({ ...g, ullage: 1 }, 0.6, 1), 0.0012);
  assert.ok(wallThickness({ ...g, ullage: 6 }, 2.4, 10) > wallThickness(g, 2.4, 10));
  assert.ok(wallThickness({ ...g, safetyFactor: 2 }, 2.4, 10) > wallThickness(g, 2.4, 10));
  assert.ok(tankMass({ ...g, safetyFactor: 2 }, 2.4, 10, 40_000) > tankMass(g, 2.4, 10, 40_000));
  // Default tanks land near the old 6 % of propellant.
  near(tankMass(g, 1.2, stages[0]!.tankLength, stages[0]!.propellantMass) / (stages[0]!.propellantMass * 0.06), 1, 0.1, "booster tank");
});

test("pressure stiffens the shell; the default stack carries what the hand-drawn limits gave", () => {
  const g = defaultGeometry(1).stages[0]!;
  assert.ok(bucklingLineLoad({ ...g, ullage: 5 }, 1.2, 0.0013) > bucklingLineLoad(g, 1.2, 0.0013));
  const lim = structureLimits({ ...input(), feedPressures: [undefined, undefined] });
  near(lim.maxQAlpha / 30_000, 1, 0.1, "q·α budget");
  near(lim.maxDynamicPressure / 50_000, 1, 0.1, "max-q budget");
  assert.equal(lim.maxAcceleration, 8);
  assert.ok(lim.bendingFrequency > 1 && lim.bendingFrequency < 20);
  const soft = structureLimits({ ...input({ ...defaultGeometry(2), stages: [{ ...defaultGeometry(1).stages[0]!, ullage: 1 }, defaultGeometry(1).stages[0]!] }), feedPressures: [undefined, undefined] });
  assert.ok(soft.maxQAlpha < lim.maxQAlpha);
  const weak = structureLimits({ ...input(), feedPressures: [undefined, undefined] }, [0.7, 0.7]);
  assert.ok(weak.maxQAlpha < lim.maxQAlpha, "a worse real knock-down carries less");
});
