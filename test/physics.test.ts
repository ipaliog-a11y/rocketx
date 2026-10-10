import assert from "node:assert/strict";
import { test } from "node:test";
import { dragCoefficient, SLENDER_ROCKET } from "../src/sim/aero.ts";
import { atmosphereAt } from "../src/sim/atmosphere.ts";
import { G0, P_SEA_LEVEL } from "../src/sim/constants.ts";
import { flowSeparates, ispAt, thrustAt } from "../src/sim/engine.ts";
import { idealDeltaV } from "../src/sim/vehicle.ts";
import { KESTREL_SL, KESTREL_VAC, PATHFINDER, PATHFINDER_TWO_STAGE } from "../src/vehicles.ts";

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);

test("sea-level atmosphere matches the 1976 standard", () => {
  const atm = atmosphereAt(0);
  near(atm.temperature, 288.15, 1e-9);
  near(atm.pressure, 101_325, 1e-6);
  near(atm.density, 1.225, 0.001);
  near(atm.speedOfSound, 340.29, 0.05);
});

test("atmosphere hits published values at layer boundaries", () => {
  // Geometric altitudes for 11 km and 20 km geopotential.
  near(atmosphereAt(11_019).pressure, 22_632, 5);
  near(atmosphereAt(20_063).pressure, 5_474.9, 2);
  near(atmosphereAt(11_019).temperature, 216.65, 0.01);
});

test("atmosphere thins monotonically and ends in vacuum", () => {
  let last = Infinity;
  for (let h = 0; h < 150_000; h += 500) {
    const p = atmosphereAt(h).pressure;
    assert.ok(p < last, `pressure rose at ${h} m`);
    last = p;
  }
  assert.equal(atmosphereAt(200_000).density, 0);
});

test("drag curve interpolates and clamps", () => {
  near(dragCoefficient(SLENDER_ROCKET, 0), 0.3, 1e-12);
  near(dragCoefficient(SLENDER_ROCKET, 1.05), 0.55, 1e-12);
  near(dragCoefficient(SLENDER_ROCKET, 1.0), 0.5, 1e-12);
  near(dragCoefficient(SLENDER_ROCKET, 50), 0.22, 1e-12);
  assert.ok(dragCoefficient(SLENDER_ROCKET, 1.1) > dragCoefficient(SLENDER_ROCKET, 0.5), "no transonic rise");
});

test("thrust drops with ambient pressure by p·A_e", () => {
  near(thrustAt(KESTREL_SL, 0), KESTREL_SL.thrustVac, 1e-9);
  near(thrustAt(KESTREL_SL, P_SEA_LEVEL), KESTREL_SL.thrustVac - P_SEA_LEVEL * KESTREL_SL.exitArea, 1e-6);
  near(ispAt(KESTREL_SL, 0), KESTREL_SL.ispVac, 1e-9);
  assert.ok(ispAt(KESTREL_VAC, P_SEA_LEVEL) < ispAt(KESTREL_SL, P_SEA_LEVEL), "vacuum bell should be worse at sea level");
});

test("vacuum bell separates at sea level, sea-level bell does not", () => {
  assert.equal(flowSeparates(KESTREL_VAC, P_SEA_LEVEL), true);
  assert.equal(flowSeparates(KESTREL_SL, P_SEA_LEVEL), false);
  assert.equal(flowSeparates(KESTREL_VAC, 1_000), false);
});

test("ideal Δv follows the rocket equation per stage", () => {
  const [dv] = idealDeltaV(PATHFINDER);
  const m0 = 600 + 1_100 + 80;
  near(dv!, KESTREL_SL.ispVac * G0 * Math.log(m0 / (m0 - 1_100)), 1e-9);

  const [booster, upper] = idealDeltaV(PATHFINDER_TWO_STAGE);
  const upperMass = 170 + 400 + 80;
  near(booster!, KESTREL_SL.ispVac * G0 * Math.log((700 + 1_500 + upperMass) / (700 + upperMass)), 1e-9);
  near(upper!, KESTREL_VAC.ispVac * G0 * Math.log(upperMass / (upperMass - 400)), 1e-9);
});
