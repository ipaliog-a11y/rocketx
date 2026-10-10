import type { Contract } from "./sim/contracts.ts";
import { hashSeed, rng } from "./sim/random.ts";
import { LEO_300, LEO_EQUATORIAL, SSO_500, SUBORBITAL_TEST } from "./missions.ts";

type Template = Omit<Contract, "postedDay">;

/**
 * The opening board. Suborbital crumbs that a sounding rocket can earn,
 * LEO work that can recapitalise the company, one SSO contract that pays
 * well and punishes a greedy bid, and an equatorial customer the pad can't
 * serve. Payouts and deadlines vary by seed.
 *
 * Later, a rideshare broker posts LEO slots every few months, so a company
 * that stumbles early has work to recover toward while the payroll runs.
 */
const TEMPLATES: Template[] = [
  {
    id: "sounding",
    customer: "Halvorsen University",
    title: "Atmospheric probe above 100 km",
    mission: SUBORBITAL_TEST,
    payloadMass: 60,
    minApogee: 100_000,
    payout: 1_500,
    degradedShare: 0.5,
    penalty: 300,
    deadline: 150,
    minReputation: 0,
    refuses: [],
  },
  {
    id: "microgravity",
    customer: "Brightline Bio",
    title: "Microgravity experiment above 120 km",
    mission: SUBORBITAL_TEST,
    payloadMass: 80,
    minApogee: 120_000,
    payout: 1_800,
    degradedShare: 0.5,
    penalty: 400,
    deadline: 220,
    minReputation: 0,
    refuses: [],
  },
  {
    id: "leo-150",
    customer: "Ostrava Imaging",
    title: "150 kg imager to LEO 300 km",
    mission: LEO_300,
    payloadMass: 150,
    payout: 7_500,
    degradedShare: 0.5,
    penalty: 2_000,
    deadline: 420,
    minReputation: 1,
    refuses: [],
  },
  {
    id: "leo-200",
    customer: "Kestrel Comms",
    title: "200 kg relay to LEO 300 km",
    mission: LEO_300,
    payloadMass: 200,
    payout: 9_000,
    degradedShare: 0.5,
    penalty: 3_000,
    deadline: 480,
    minReputation: 1,
    refuses: ["hard-start", "burn-through", "combustion-instability", "transonic-buffet"],
  },
  {
    id: "sso-150",
    customer: "Meteorological Office",
    title: "150 kg weather sat to SSO 500 km",
    mission: SSO_500,
    payloadMass: 150,
    payout: 14_000,
    degradedShare: 0,
    penalty: 6_000,
    deadline: 450,
    minReputation: 2,
    refuses: ["hard-start", "burn-through", "combustion-instability", "transonic-buffet", "no-orbit"],
  },
  {
    id: "equatorial",
    customer: "Equinox Telecom",
    title: "120 kg pathfinder to equatorial LEO",
    mission: LEO_EQUATORIAL,
    payloadMass: 120,
    payout: 10_000,
    degradedShare: 0,
    penalty: 3_500,
    deadline: 400,
    minReputation: 1,
    refuses: [],
  },
];

/** Rideshare slots: posted around these days, open for this long. */
const RIDESHARE_POSTINGS = [200, 350, 500];
const RIDESHARE_WINDOW = 240;

export function generateBoard(seed: number): Contract[] {
  const random = rng(hashSeed(`${seed}:board`));
  const vary = (x: number, spread: number) => Math.round(x * (1 + spread * (2 * random() - 1)));
  const opening = TEMPLATES.map((t) => ({ ...t, payout: vary(t.payout, 0.15), deadline: vary(t.deadline, 0.2), postedDay: 0 }));
  const rideshares = RIDESHARE_POSTINGS.map((day, i): Contract => {
    const postedDay = vary(day, 0.15);
    return {
      id: `rideshare-${i + 1}`,
      customer: "Orbital Freight Exchange",
      title: `Rideshare slot ${i + 1}: 150 kg to LEO 300 km`,
      mission: LEO_300,
      payloadMass: 150,
      payout: vary(6_000, 0.15),
      degradedShare: 0.5,
      penalty: 1_500,
      deadline: postedDay + RIDESHARE_WINDOW,
      minReputation: 1,
      refuses: [],
      postedDay,
    };
  });
  return [...opening, ...rideshares];
}

/** Starting cash, $k. Some companies start leaner than others. */
export function startingCash(seed: number): number {
  const random = rng(hashSeed(`${seed}:cash`));
  return Math.round(9_000 + 5_000 * random());
}
