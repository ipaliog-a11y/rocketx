import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateAscent } from "../src/sim/ascent.ts";
import { IDEAL_AERO } from "../src/sim/airframe.ts";
import { accept, build, fly, newCompany, wait, type Company } from "../src/sim/company.ts";
import type { Contract } from "../src/sim/contracts.ts";
import { IDEAL_TRUTH } from "../src/sim/hardware.ts";
import { retunePitch } from "../src/sim/tuning.ts";
import { generateBoard } from "../src/contracts.ts";
import { ENGINES, MERIDIAN, PATHFINDER, VEHICLES } from "../src/vehicles.ts";

/** Engines a little short of their drawings, as a typical seed rolls them; no failures. */
const typical = (factor: number) =>
  Object.fromEntries(Object.values(ENGINES).map((e) => [e.name, { ...IDEAL_TRUTH, ispFactor: factor }]));

test("the generated board is seeded, varied and uniquely named", () => {
  assert.deepEqual(generateBoard(7), generateBoard(7));
  assert.notDeepEqual(generateBoard(7), generateBoard(8));
  for (const seed of [1, 2, 3]) {
    const board = generateBoard(seed);
    assert.ok(board.length > 50, `seed ${seed} posts ${board.length} contracts`);
    assert.equal(new Set(board.map((c) => c.id)).size, board.length);
    assert.ok(new Set(board.map((c) => c.kind)).size >= 8);
    for (const c of board) assert.ok(c.deadline > c.postedDay && c.payout > 0 && c.penalty >= 0, c.id);
  }
});

test("the hand-tested contracts stay on the board", () => {
  const ids = generateBoard(4).map((c) => c.id);
  for (const id of ["sounding", "microgravity", "leo-150", "leo-200", "sso-150", "equatorial", "rideshare-1"]) assert.ok(ids.includes(id), id);
});

test("every generated sounding contract is in reach of a Pathfinder with weak engines", () => {
  // The hand-tested microgravity anchor is meant to need good engines; this covers the generated work.
  const generatedWork = (c: Contract) => /-g\d+$|^aurora-/.test(c.id);
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const c of generateBoard(seed).filter((x) => x.minApogee !== undefined && generatedWork(x))) {
      const r = simulateAscent({ ...PATHFINDER, payloadMass: c.payloadMass }, c.mission, { hardware: typical(0.95) });
      assert.ok(r.summary.apogee >= c.minApogee!, `${c.id}: ${c.title} reaches ${(r.summary.apogee / 1000).toFixed(0)} km`);
    }
  }
});

test("the heaviest generated payload for each orbit can be put there with typical engines", () => {
  const heaviest = new Map<string, Contract>();
  for (const c of generateBoard(1)) {
    if (!c.mission.target || c.kind === "crew" || /^(leo|sso|equatorial|rideshare-)/.test(c.id)) continue;
    const prev = heaviest.get(c.mission.name);
    if (!prev || c.payloadMass > prev.payloadMass) heaviest.set(c.mission.name, c);
  }
  assert.ok(heaviest.size >= 3);
  for (const c of heaviest.values()) {
    const r = retunePitch({ ...MERIDIAN, payloadMass: c.payloadMass }, c.mission, { hardware: typical(0.975), aero: {} });
    assert.ok(r.inSpec, `${c.title} out of reach`);
  }
});

test("a series posts its instances at intervals and numbers them", () => {
  const board = generateBoard(3);
  const series = new Map<string, Contract[]>();
  for (const c of board) if (c.seriesId) series.set(c.seriesId, [...(series.get(c.seriesId) ?? []), c]);
  assert.ok([...series.keys()].some((k) => ["swarmlink", "meshnet", "lumen"].includes(k)));
  for (const [id, xs] of series) {
    const sorted = [...xs].sort((a, b) => a.seriesIndex! - b.seriesIndex!);
    sorted.forEach((c, i) => assert.equal(c.seriesIndex, i + 1, id));
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i]!.postedDay > sorted[i - 1]!.postedDay, id);
  }
});

const instance = (i: number, overrides: Partial<Contract> = {}): Contract => ({
  id: `probe-${i}`,
  kind: "sounding",
  customer: "Series U",
  title: `Probe ${i}`,
  seriesId: "probe",
  seriesIndex: i,
  mission: { name: "Suborbital flight", site: { name: "Port Avery", latitude: 28.5 } },
  payloadMass: 40,
  minApogee: 100_000,
  payout: 1_000,
  degradedShare: 0.5,
  penalty: 100,
  deadline: 400,
  minReputation: 0,
  postedDay: 0,
  refuses: [],
  ...overrides,
});

function seriesCompany(board: Contract[]): Company {
  const c = newCompany(1, 20_000, VEHICLES, Object.values(ENGINES), board);
  for (const name of Object.keys(c.campaign.truth)) c.campaign.truth[name] = IDEAL_TRUTH;
  for (const key of Object.keys(c.campaign.aeroTruth)) c.campaign.aeroTruth[key] = IDEAL_AERO;
  return c;
}

test("delivering a series instance raises the later ones' pay", () => {
  const c = seriesCompany([instance(1), instance(2), instance(3)]);
  accept(c, "probe-1");
  build(c, "pathfinder");
  fly(c, "pathfinder", { contract: "probe-1" });
  assert.equal(c.closed["probe-1"], "delivered");
  assert.equal(c.board.find((x) => x.id === "probe-2")!.payout, 1_050);
  assert.equal(c.board.find((x) => x.id === "probe-3")!.payout, 1_050);
});

test("missing a series instance withdraws the rest, but not one already signed", () => {
  const c = seriesCompany([instance(1, { deadline: 10 }), instance(2), instance(3)]);
  accept(c, "probe-1");
  accept(c, "probe-2");
  const { notices } = wait(c, 20);
  assert.equal(c.closed["probe-1"], "late");
  assert.equal(c.closed["probe-3"], "withdrawn");
  assert.equal(c.closed["probe-2"], undefined);
  assert.ok(notices.some((n) => /withdrawn the rest of the series/.test(n)));
  assert.throws(() => accept(c, "probe-3"), /no longer open/);
});
