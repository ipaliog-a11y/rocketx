import assert from "node:assert/strict";
import { test } from "node:test";
import { fitControl, specOf, type VehicleSpec } from "../src/sim/builder.ts";
import { bid, boosterOf, build, cleanReflights, fly, newCompany, nextBooster, readyDay, refusesFlightProven, retireBooster, wait, type Company } from "../src/sim/company.ts";
import { vehicleCost } from "../src/sim/cost.ts";
import { boosterCost, FLIGHT_PROVEN_TRUST, REFURB, restackCost, wearFailure, wearRisk } from "../src/sim/fleet.ts";
import { defaultGeometry } from "../src/sim/geometry.ts";
import { defaultRecovery } from "../src/sim/recovery.ts";
import { designSpec, runTask } from "../src/sim/schedule.ts";
import type { Contract } from "../src/sim/contracts.ts";
import { generateBoard } from "../src/contracts.ts";
import { MISSIONS } from "../src/missions.ts";
import { ENGINES, VEHICLES } from "../src/vehicles.ts";

const engines = Object.fromEntries(Object.values(ENGINES).map((e) => [e.name, e]));
const meridian = Object.values(VEHICLES).find((v) => v.name === "Meridian")!;
const LEO = MISSIONS["leo-300"]!;
const spec = (): VehicleSpec => fitControl({ ...specOf(meridian), name: "Lander", payloadMass: 0, geometry: { ...defaultGeometry(2), recovery: { ...defaultRecovery("drone-ship"), reserve: 0.14 } } }, engines);

function companyWith(seed: number): { c: Company; key: string } {
  const c = newCompany(seed, 60_000, VEHICLES, Object.values(ENGINES), generateBoard(seed));
  c.licence = "orbital";
  runTask(c, designSpec(c, spec()));
  const key = Object.keys(c.designs).find((k) => c.designs[k]!.name === "Lander")!;
  c.designs[key] = { ...c.designs[key]!, pitchProgram: meridian.pitchProgram };
  return { c, key };
}

function flyNew(c: Company, key: string) {
  build(c, key);
  wait(c, readyDay(c, key)! - c.day);
  return fly(c, key, { mission: LEO });
}

/** A company whose first Lander reached orbit and landed. */
function landedOnce(): { c: Company; key: string } {
  for (let seed = 1; seed < 40; seed++) {
    const w = companyWith(seed);
    const r = flyNew(w.c, w.key);
    if (r.result.outcome === "orbit" && r.result.recovery?.outcome === "landed") return w;
  }
  throw new Error("no seed lands");
}

test("a booster that lands keeps its serial; the hangar readies it and a re-stack flies it again for less", () => {
  const { c, key } = landedOnce();
  const unit = c.boosters![0]!;
  assert.equal(unit.serial, "B1001");
  assert.equal(unit.status, "flown");
  assert.equal(unit.flights, 1);
  assert.deepEqual(c.flights.at(-1)!.booster, { serial: "B1001", flight: 1, landed: true });
  assert.ok(c.campaign.boosterTruth!.B1001!.wear >= 1);
  assert.throws(() => build(c, key, { booster: "B1001" }), /hangar/);

  const design = c.designs[key]!;
  const cash = c.cash;
  runTask(c, { kind: "refurb", serial: "B1001", depth: "turnaround" });
  assert.equal(unit.status, "ready");
  const refurb = Math.round((REFURB.turnaround.share * boosterCost(design)) / 5) * 5;
  assert.ok(cash - c.cash >= refurb);

  const restack = restackCost(design);
  assert.ok(restack.cost < vehicleCost(design).cost * 0.8, `${restack.cost} vs ${vehicleCost(design).cost}`);
  const before = c.cash;
  build(c, key, { booster: "B1001" });
  assert.equal(before - c.cash, restack.cost);
  assert.equal(unit.status, "stacked");
  wait(c, readyDay(c, key)! - c.day);
  assert.deepEqual(c.stacked![key], ["B1001"]);
  fly(c, key, { mission: LEO });
  assert.equal(unit.flights, 2);
  assert.equal(c.flights.at(-1)!.booster!.flight, 2);
  assert.deepEqual(c.stacked![key], []);
});

test("an overhaul takes out wear and says how much is left; a retired booster stays retired", () => {
  const { c } = landedOnce();
  const truth = c.campaign.boosterTruth!.B1001!;
  const wear = truth.wear;
  runTask(c, { kind: "refurb", serial: "B1001", depth: "overhaul" });
  assert.ok(Math.abs(truth.wear - wear * (1 - REFURB.overhaul.restores!)) < 1e-9);
  assert.ok(Math.abs(boosterOf(c, "B1001").inspected!.share - truth.wear / truth.life) < 1e-9);
  retireBooster(c, "B1001");
  assert.equal(boosterOf(c, "B1001").status, "retired");
  assert.throws(() => runTask(c, { kind: "refurb", serial: "B1001", depth: "turnaround" }), /retired/);
});

test("a booster flown past its life fails more often", () => {
  assert.equal(wearRisk({ life: 10, wear: 3 }), 0);
  assert.ok(wearRisk({ life: 10, wear: 14 }) > 0.2);
  const failures = (wear: number) => {
    let n = 0;
    for (let flight = 0; flight < 400; flight++) if (wearFailure({ life: 10, wear }, "B1007", flight, 5, 120)) n++;
    return n;
  };
  assert.equal(failures(4), 0);
  assert.ok(failures(15) > 60, `${failures(15)}`);
});

test("crew and series customers won't fly a booster that has flown until it has a record", () => {
  const { c } = companyWith(2);
  const crew = { kind: "crew" } as Contract;
  const series = { kind: "constellation", seriesId: "s1" } as Contract;
  const oneOff = { kind: "smallsat" } as Contract;
  assert.ok(refusesFlightProven(c, crew));
  assert.ok(refusesFlightProven(c, series));
  assert.ok(!refusesFlightProven(c, oneOff));
  const clean = { day: 0, design: "Lander", mission: "LEO", contract: null, outcome: "orbit" as const, apogee: 0, settlement: null, booster: { serial: "B1001", flight: 2, landed: true } };
  for (let i = 0; i < FLIGHT_PROVEN_TRUST; i++) c.flights.push(clean);
  assert.equal(cleanReflights(c), FLIGHT_PROVEN_TRUST);
  assert.ok(!refusesFlightProven(c, crew));
});

test("bids and launches name the booster; a new one can be asked for", () => {
  const { c, key } = landedOnce();
  runTask(c, { kind: "refurb", serial: "B1001", depth: "turnaround" });
  build(c, key, { booster: "B1001" });
  build(c, key);
  wait(c, Math.max(...c.orders.map((o) => o.readyDay)) - c.day);
  assert.deepEqual(nextBooster(c, key, null), { serial: "B1001", flight: 2, proven: 1, fresh: 1, cautious: false });
  const contract = c.board.find((x) => x.mission.target && !x.seriesId && x.kind !== "crew")!;
  const b = bid(c, contract.id, key);
  assert.deepEqual(b.booster, { serial: "B1001", flight: 2, refusesFlown: false });
  // Asked for a new one, the flight takes the new vehicle and leaves B1001 stacked.
  const r = fly(c, key, { mission: LEO, newBooster: true });
  assert.equal(r.booster?.startsWith(`Booster B${1001 + c.boosters!.length - 1}`), true, r.booster ?? "");
  assert.deepEqual(c.stacked![key], ["B1001"]);
  assert.throws(() => fly(c, key, { mission: LEO, newBooster: true }), /stacked on a booster that has flown/);
});
