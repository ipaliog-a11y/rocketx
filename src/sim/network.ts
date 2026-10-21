import { circular } from "../missions.ts";
import type { Company } from "./company.ts";
import { holds } from "./licence.ts";
import { marketOf } from "./market.ts";
import type { Mission } from "./mission.ts";
import { hashSeed, rng } from "./random.ts";
import { orbitDeltaV } from "./guide.ts";
import { idealDeltaV, type Vehicle } from "./vehicle.ts";

/**
 * The company's own constellation. Chartered once the market has moved to
 * buses (era 2), it needs satellites bought from a supplier and the
 * company's own rockets to put them up. It earns nothing until enough are
 * working to give coverage, then a monthly service income that grows to
 * full at the planned size. Satellites wear out after about five years, a
 * few early, so a network keeps needing launches.
 */
export const NETWORK = {
  /** The network's orbit: a direct ascent from Port Avery, no coast or relight. */
  km: 400,
  inclination: 51.6,
  /** One satellite, kg, and the dispenser that carries a batch, kg. */
  satMass: 20,
  dispenser: 10,
  /** The engineering office's charter: the satellite bus and the ground segment. $k and days. */
  charter: { cost: 6_000, days: 120 },
  /** A satellite from the supplier, $k, and how long it takes to arrive. */
  satCost: 250,
  satDays: 60,
  /** Working satellites for coverage to start, and for full coverage. */
  minimum: 12,
  planned: 24,
  /** Service income at full coverage, $k a month, and ground operations from the charter on. */
  fullRevenue: 3_000,
  operations: 50,
  /** Billing period, days. */
  month: 30,
  /** A satellite's design life, days, give or take this share, and the chance it fails in its first months. */
  life: 5 * 365,
  lifeSpread: 0.3,
  infant: { chance: 0.05, days: 90 },
} as const;

export type Satellite = {
  id: number;
  /** Its slot in the planned pattern, 0 to planned − 1. */
  slot?: number;
  /** Reached its slot from an in-spec orbit; out of spec it spent half its fuel getting there. */
  inSpec?: boolean;
  launched: number;
  /** The day it stops working. Hidden from the player until it does. */
  end: number;
  /** Set once it has stopped. */
  failed?: number;
};

export type Network = {
  charteredDay: number;
  /** Satellites delivered and waiting for a launch. */
  stored: number;
  orders: Array<{ count: number; readyDay: number }>;
  sats: Satellite[];
  nextSat: number;
  /** The next billing day. */
  nextBill: number;
  /** The first day the network gave coverage, for the milestone. */
  serviceDay?: number;
};

export const networkMission = (): Mission => ({ ...circular(NETWORK.km, NETWORK.inclination), name: `Network orbit, ${NETWORK.km} km, ${NETWORK.inclination}°` });

/** A batch's payload, kg. */
export const batchMass = (count: number) => count * NETWORK.satMass + NETWORK.dispenser;

/** Why the company can't charter a network yet, or null if it can. */
export function charterProblem(company: Company): string | null {
  if (company.network) return "The company already has a network.";
  if (company.tasks.some((t) => t.spec.kind === "charter")) return "The network's charter is already in the office.";
  if (!holds(company, "orbital")) return "A network needs the orbital license.";
  if (marketOf(company).era < 2) return "Investors want an orbital record first: the network opens with market era 2 (reputation 4).";
  return null;
}

export function charterNetwork(company: Company): Network {
  return (company.network = { charteredDay: company.day, stored: 0, orders: [], sats: [], nextSat: 1, nextBill: company.day + NETWORK.month });
}

export const working = (network: Network | undefined, day: number) => (network?.sats ?? []).filter((s) => s.launched <= day && s.end > day).length;

/** Service income for this many working satellites, $k a month. */
export function revenueFor(count: number): number {
  if (count < NETWORK.minimum) return 0;
  return Math.round(NETWORK.fullRevenue * Math.min(1, count / NETWORK.planned));
}

/** A satellite's working life from deployment, days: seeded, so the same run gives the same lives. */
export function rollLife(seed: number, id: number): number {
  const r = rng(hashSeed(`${seed}:sat:${id}`));
  if (r() < NETWORK.infant.chance) return Math.max(1, Math.round(NETWORK.infant.days * r()));
  return Math.round(NETWORK.life * (1 + NETWORK.lifeSpread * (2 * r() - 1)));
}

/** Put a batch into service: a full life in spec, half (spent reaching the orbit) when out of spec. */
export function deploySats(company: Company, count: number, inSpec: boolean): Satellite[] {
  const network = company.network!;
  const added: Satellite[] = [];
  // New satellites take the empty slots first, lowest first; past the plan they double up as spares.
  const taken = new Set(network.sats.filter((s) => s.end > company.day && s.slot !== undefined).map((s) => s.slot!));
  const free = Array.from({ length: NETWORK.planned }, (_, i) => i).filter((i) => !taken.has(i));
  for (let i = 0; i < count; i++) {
    const id = network.nextSat++;
    const life = rollLife(company.seed, id);
    const slot = free.shift() ?? (id - 1) % NETWORK.planned;
    added.push({ id, slot, inSpec, launched: company.day, end: company.day + (inSpec ? life : Math.max(1, Math.round(life / 2))) });
  }
  network.sats.push(...added);
  return added;
}

/**
 * What the days up to today did to the network: deliveries arrive, satellites
 * stop at the end of their lives, and each month the service bills and the
 * ground segment costs. Moves the company's money. Returns notices.
 */
export function networkTick(company: Company): string[] {
  const network = company.network;
  if (!network) return [];
  const notices: string[] = [];
  for (const order of network.orders.filter((o) => o.readyDay <= company.day)) {
    network.stored += order.count;
    notices.push(`Day ${order.readyDay}: ${order.count} satellite${order.count === 1 ? "" : "s"} delivered and waiting for a launch.`);
  }
  network.orders = network.orders.filter((o) => o.readyDay > company.day);
  const ended = network.sats.filter((s) => s.failed === undefined && s.end <= company.day);
  for (const s of ended) s.failed = s.end;
  if (ended.length > 0) notices.push(`Network: ${ended.length} satellite${ended.length === 1 ? "" : "s"} stopped working. ${working(network, company.day)} working.`);
  while (network.nextBill <= company.day) {
    const day = network.nextBill;
    const count = working(network, day);
    const revenue = revenueFor(count);
    if (revenue > 0) {
      company.cash += revenue;
      company.ledger.push({ day, category: "network", amount: revenue, note: `Network service · ${count} satellites` });
      if (network.serviceDay === undefined) network.serviceDay = day;
    }
    company.cash -= NETWORK.operations;
    company.ledger.push({ day, category: "satellites", amount: -NETWORK.operations, note: "Network ground operations" });
    network.nextBill += NETWORK.month;
  }
  return notices;
}

/** Order satellites from the supplier: paid now, delivered in two months. */
export function orderSatellites(company: Company, count: number): string {
  const network = company.network;
  if (!network) throw new Error("Charter the network first.");
  if (!Number.isInteger(count) || count < 1) throw new Error("Order at least one satellite.");
  const cost = count * NETWORK.satCost;
  company.cash -= cost;
  company.ledger.push({ day: company.day, category: "satellites", amount: -cost, note: `${count} network satellite${count === 1 ? "" : "s"}` });
  network.orders.push({ count, readyDay: company.day + NETWORK.satDays });
  return `Ordered ${count} satellite${count === 1 ? "" : "s"}: delivered on day ${company.day + NETWORK.satDays}.`;
}

/** Typical engines deliver this share of their drawings' Isp, and the sizing guide's Δv margin for a direct ascent. */
const TYPICAL_ISP = 0.975;
const MARGIN = 0.04;

/**
 * How many satellites a design carries to the network's orbit on paper: the
 * sizing guide's estimate, typical engines and its usual margin. Quick
 * enough for a screen; a re-tune and the forecast settle the real flight.
 */
export function paperCapacity(vehicle: Vehicle): number {
  if (vehicle.pitchProgram?.kind !== "gravity-turn") return 0;
  const need = orbitDeltaV(networkMission()) * (1 + MARGIN);
  const dv = (payload: number) => idealDeltaV({ ...vehicle, payloadMass: payload }).reduce((a, b) => a + b, 0) * TYPICAL_ISP;
  if (dv(batchMass(1)) < need) return 0;
  let n = 1;
  while (n < 60 && dv(batchMass(n + 1)) >= need) n++;
  return n;
}
