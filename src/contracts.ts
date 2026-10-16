import type { Contract } from "./sim/contracts.ts";
import { hashSeed, rng } from "./sim/random.ts";
import { circular, escape, gto, highCircular, LEO_300, LEO_EQUATORIAL, lunar, SSO_500, SUBORBITAL_TEST } from "./missions.ts";

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
    kind: "sounding",
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
    kind: "microgravity",
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
    kind: "smallsat",
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
    kind: "smallsat",
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
    kind: "weather",
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
    kind: "smallsat",
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
      kind: "rideshare",
      seriesId: "rideshare",
      seriesIndex: i + 1,
      customer: "Orbital Freight Exchange",
      title: `Rideshare slot ${i + 1}: 150 kg to LEO 300 km`,
      mission: LEO_300,
      payloadMass: 150,
      payout: vary(7_000, 0.15),
      degradedShare: 0.5,
      penalty: 1_500,
      deadline: postedDay + RIDESHARE_WINDOW,
      minReputation: 1,
      refuses: [],
      postedDay,
    };
  });
  return [...opening, ...rideshares, ...generated(seed)].sort((a, b) => a.postedDay - b.postedDay || a.deadline - b.deadline);
}

/*
 * Generated work, on top of the hand-tested board above. Each archetype is
 * a kind of customer with parameter ranges; the seed picks the customer,
 * the numbers and the posting days. Ranges stay inside what the company's
 * preset launchers can do with typical engines (measured by re-tuning the
 * Meridian at 97.5% of design Isp), with a margin, so every contract is
 * winnable with the right testing.
 */

/** Sounding: apogee the Pathfinder reaches with typical engines, km, by payload kg. */
const soundingReach = (payload: number) => 146 - 0.31 * payload;

/** Orbits the Meridian serves from Port Avery, with the payload it lifts there with typical engines, kg. */
const ORBITS: Array<{ km: number; inc: number; capacity: number }> = [
  { km: 250, inc: 28.5, capacity: 240 },
  { km: 300, inc: 28.5, capacity: 200 },
  { km: 350, inc: 28.5, capacity: 160 },
  { km: 400, inc: 28.5, capacity: 140 },
  { km: 350, inc: 40, capacity: 160 },
  { km: 300, inc: 51.6, capacity: 180 },
  { km: 400, inc: 51.6, capacity: 120 },
];

/** How much of an orbit's typical capacity a generated payload may use. */
const CAPACITY_MARGIN = 0.85;

const FAILURE_TAGS: Contract["refuses"] = ["hard-start", "burn-through", "combustion-instability", "transonic-buffet"];

function generated(seed: number): Contract[] {
  const random = rng(hashSeed(`${seed}:generated`));
  const between = (lo: number, hi: number) => lo + (hi - lo) * random();
  const int = (lo: number, hi: number) => Math.round(between(lo, hi));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const step = (x: number, by: number) => Math.round(x / by) * by;
  const out: Contract[] = [];
  let n = 0;
  const id = (kind: string) => `${kind}-g${++n}`;

  // Suborbital science, a steady trickle: what a young company lives on
  // while it earns its orbital licence.
  const SCIENCE = [
    { kind: "sounding", customers: ["Tidewater Institute", "Aldane Polytechnic", "Northreach College", "Halvorsen University"], what: ["Upper-atmosphere probe", "Ionosphere sounding", "Airglow camera", "Cosmic-ray counter", "Noctilucent cloud sampler"], payload: [20, 70], floor: 90, rate: [1_000, 1_400] },
    { kind: "microgravity", customers: ["Brightline Bio", "Corvid Pharma", "Lattice Materials"], what: ["Protein crystal run", "Alloy solidification rig", "Fluid physics cell", "Plant-root experiment"], payload: [40, 80], floor: 105, rate: [1_500, 2_000] },
    { kind: "tech-demo", customers: ["Aster Avionics", "Quill Sensors", "Helix Dynamics"], what: ["Star tracker flight test", "Heat-shield sample", "GPS receiver at altitude", "Deployable antenna test"], payload: [15, 40], floor: 100, rate: [900, 1_300] },
  ] as const;
  for (let day = int(15, 35); day < 1_000; day += int(35, 70)) {
    const a = pick(SCIENCE);
    const payload = step(between(a.payload[0], a.payload[1]), 5);
    const reach = soundingReach(payload) * CAPACITY_MARGIN;
    const apogee = step(between(a.floor, Math.max(a.floor, reach)), 5);
    const window = int(110, 190);
    out.push({
      id: id(a.kind),
      kind: a.kind,
      customer: pick(a.customers),
      title: `${pick(a.what)} above ${apogee} km`,
      mission: SUBORBITAL_TEST,
      payloadMass: payload,
      minApogee: apogee * 1000,
      payout: step(between(a.rate[0], a.rate[1]) + 6 * payload + 12 * (apogee - 90), 10),
      degradedShare: 0.5,
      penalty: step(between(200, 400), 10),
      deadline: day + window,
      minReputation: 0,
      postedDay: day,
      refuses: [],
    });
  }

  // A university that flies a campaign every season: suborbital, recurring.
  {
    const start = int(60, 120);
    const every = int(110, 150);
    const count = 4;
    const payload = step(between(30, 60), 5);
    const apogee = step(Math.min(soundingReach(payload) * CAPACITY_MARGIN, between(100, 115)), 5);
    for (let i = 0; i < count; i++) {
      const day = start + i * every;
      out.push({
        id: `aurora-${i + 1}`,
        kind: "sounding",
        customer: "Tidewater Institute",
        title: `Aurora campaign ${i + 1} of ${count}: ${payload} kg above ${apogee} km`,
        seriesId: "aurora",
        seriesIndex: i + 1,
        mission: SUBORBITAL_TEST,
        payloadMass: payload,
        minApogee: apogee * 1000,
        payout: step(between(1_500, 1_800), 10),
        degradedShare: 0.5,
        penalty: 300,
        deadline: day + 140,
        minReputation: 0,
        postedDay: day,
        refuses: [],
      });
    }
  }

  // Orbital one-offs: imaging smallsats, rideshare cubesat dispensers.
  const orbital = (kind: "smallsat" | "rideshare", day: number): Contract => {
    const orbit = pick(ORBITS);
    const max = orbit.capacity * CAPACITY_MARGIN;
    const payload = step(kind === "rideshare" ? between(50, Math.min(110, max)) : between(Math.min(90, max), max), 5);
    const smallsat = kind === "smallsat";
    const customer = smallsat ? pick(["Ostrava Imaging", "Pallas Earthwatch", "Verdant Analytics", "Cobalt Radar", "Gannet Maritime"]) : pick(["Orbital Freight Exchange", "Cubeway Dispensers"]);
    const what = smallsat ? pick(["imager", "radar sat", "AIS receiver", "hyperspectral camera"]) : "cubesat dispenser";
    // A Meridian costs about $5.4M built, flown and paid for, so even a
    // light payload has to cover that. Height and inclination add a premium.
    const premium = (orbit.km - 300) * 6 + (orbit.inc - 28.5) * 25;
    const payout = step(
      smallsat ? between(5_800, 6_600) + payload * between(15, 22) + premium : between(5_300, 6_000) + payload * 10 + premium,
      50,
    );
    return {
      id: id(kind),
      kind,
      customer,
      title: `${payload} kg ${what} to ${orbit.km} km, ${orbit.inc}°`,
      mission: circular(orbit.km, orbit.inc),
      payloadMass: payload,
      payout,
      degradedShare: 0.5,
      penalty: step(payout * between(0.2, 0.3), 50),
      deadline: day + int(240, 330),
      minReputation: smallsat ? int(1, 2) : 1,
      postedDay: day,
      refuses: smallsat && random() < 0.4 ? FAILURE_TAGS : [],
    };
  };
  for (let day = int(150, 220); day < 1_000; day += int(50, 90)) out.push(orbital(random() < 0.6 ? "smallsat" : "rideshare", day));

  // Weather service: polar-ish coverage from a 51.6° orbit, no use out of spec.
  for (let day = int(260, 340); day < 1_000; day += int(220, 300)) {
    const payload = step(between(70, 100), 5);
    const payout = step(between(9_000, 11_000), 50);
    out.push({
      id: id("weather"),
      kind: "weather",
      customer: pick(["Meteorological Office", "Polar Weather Consortium"]),
      title: `${payload} kg storm tracker to 400 km, 51.6°`,
      mission: circular(400, 51.6),
      payloadMass: payload,
      payout,
      degradedShare: 0,
      penalty: step(payout * 0.4, 50),
      deadline: day + int(270, 330),
      minReputation: 2,
      postedDay: day,
      refuses: [...FAILURE_TAGS, "no-orbit"],
    });
  }

  // Constellations: one customer, a batch every month or two. Each batch is
  // its own contract; miss or fail one and the rest are withdrawn.
  const CONSTELLATIONS = [
    { series: "swarmlink", customer: "Swarmlink", sats: 5, each: 20, km: 400, inc: 51.6 },
    { series: "meshnet", customer: "Meshnet Orbital", sats: 6, each: 20, km: 350, inc: 40 },
    { series: "lumen", customer: "Lumen Broadband", sats: 6, each: 25, km: 300, inc: 28.5 },
  ];
  for (const [k, c] of CONSTELLATIONS.entries()) {
    const start = int(300, 380) + k * int(140, 200);
    const every = int(40, 60);
    const count = int(6, 10);
    const payload = c.sats * c.each;
    const base = step(1_500 + payload * between(44, 50) + (c.km - 300) * 5, 50);
    for (let i = 0; i < count; i++) {
      const day = start + i * every;
      if (day >= 1_100) break;
      out.push({
        id: `${c.series}-${i + 1}`,
        kind: "constellation",
        customer: c.customer,
        title: `${c.customer} batch ${i + 1} of ${count}: ${c.sats} × ${c.each} kg to ${c.km} km, ${c.inc}°`,
        seriesId: c.series,
        seriesIndex: i + 1,
        mission: circular(c.km, c.inc),
        payloadMass: payload,
        payout: base,
        degradedShare: 0.3,
        penalty: step(base * 0.3, 50),
        deadline: day + 120,
        minReputation: 2,
        postedDay: day,
        refuses: [],
      });
    }
  }

  // Space agencies: well-paid science, picky about the record.
  for (let day = int(380, 460); day < 1_000; day += int(180, 260)) {
    const orbit = pick(ORBITS.filter((o) => o.inc > 28.5));
    const payload = step(between(80, orbit.capacity * CAPACITY_MARGIN), 5);
    const payout = step(between(11_000, 15_000), 100);
    out.push({
      id: id("agency"),
      kind: "agency",
      customer: pick(["National Space Agency", "Eurasian Space Agency"]),
      title: `${payload} kg science satellite to ${orbit.km} km, ${orbit.inc}°`,
      mission: circular(orbit.km, orbit.inc),
      payloadMass: payload,
      payout,
      degradedShare: 0.25,
      penalty: step(payout * 0.35, 100),
      deadline: day + int(300, 380),
      minReputation: 3,
      postedDay: day,
      refuses: [...FAILURE_TAGS, "no-orbit", "late"],
    });
  }

  // Crew rotations to the station: two astronauts in the company's capsule.
  // They need the crew licence and a crew-rated rocket, so they come late.
  for (const [i, day] of [800, 950, 1_100].entries()) {
    out.push({
      id: `crew-${i + 1}`,
      kind: "crew",
      customer: "National Space Agency",
      title: `Crew rotation ${i + 1}: two astronauts to the station`,
      seriesId: "crew",
      seriesIndex: i + 1,
      licence: "crew",
      mission: circular(400, 51.6),
      payloadMass: 2_400,
      payout: 130_000,
      degradedShare: 0,
      penalty: 40_000,
      deadline: day + 240,
      minReputation: 6,
      postedDay: day + int(-20, 20),
      refuses: [...FAILURE_TAGS, "no-orbit", "late", "crew-lost"],
    });
  }
  // Student payloads: small, poorly paid, and open to any company. A firm
  // whose record has scared off everyone else can still fly these and win
  // its reputation back one delivery at a time.
  for (let day = int(40, 80); day < 1_000; day += int(70, 110)) {
    const payload = step(between(10, 30), 5);
    const apogee = step(between(90, 105), 5);
    out.push({
      id: id("student"),
      kind: "sounding",
      customer: pick(["Northreach College", "Aldane Polytechnic", "Tidewater Institute"]),
      title: `Student payload above ${apogee} km`,
      mission: SUBORBITAL_TEST,
      payloadMass: payload,
      minApogee: apogee * 1000,
      payout: step(between(600, 900), 10),
      degradedShare: 0.5,
      penalty: 50,
      deadline: day + int(150, 200),
      minReputation: -10,
      postedDay: day,
      refuses: [],
    });
  }


  // High-energy work for a company that has grown: geostationary transfer,
  // navigation orbits, the Moon and beyond, and a mega-constellation. These
  // fly via a parking orbit, a coast and relights. Payloads are sized for
  // what a 100 kN gas-generator booster with a vacuum upper and kick stage
  // can do with typical engines, with a margin.
  const BIG_FAILURES: Contract["refuses"] = [...FAILURE_TAGS, "relight-failure", "no-orbit"];
  for (let day = int(380, 460); day < 1_100; day += int(120, 180)) {
    const payload = step(between(150, 380), 10);
    const payout = step(14_000 + 60 * payload + between(-1_500, 1_500), 100);
    out.push({
      id: id("geo"),
      kind: "geo",
      customer: pick(["Equinox Telecom", "Meridiana Broadcast", "Sahel Connect", "Polaris Relay"]),
      title: `${payload} kg comsat to GTO`,
      mission: gto(),
      payloadMass: payload,
      payout,
      degradedShare: 0.3,
      penalty: step(payout * 0.3, 100),
      deadline: day + int(300, 400),
      minReputation: 3,
      postedDay: day,
      refuses: BIG_FAILURES,
    });
  }
  for (let day = int(340, 420); day < 1_100; day += int(150, 220)) {
    const payload = step(between(100, 300), 10);
    const payout = step(9_000 + 30 * payload, 100);
    out.push({
      id: id("navigation"),
      kind: "navigation",
      customer: pick(["Wayfinder Navigation", "Continental Positioning"]),
      title: `${payload} kg navigation sat to 1,200 km, 55°`,
      mission: highCircular(1_200, 55),
      payloadMass: payload,
      payout,
      degradedShare: 0.5,
      penalty: step(payout * 0.3, 100),
      deadline: day + int(280, 360),
      minReputation: 3,
      postedDay: day,
      refuses: [...FAILURE_TAGS, "relight-failure"],
    });
  }
  for (let day = int(500, 600); day < 1_100; day += int(250, 350)) {
    const payload = step(between(50, 250), 10);
    const payout = step(20_000 + 60 * payload, 100);
    out.push({
      id: id("lunar"),
      kind: "lunar",
      customer: pick(["National Space Agency", "Selene Robotics", "Eurasian Space Agency"]),
      title: `${payload} kg lunar probe: trans-lunar injection`,
      mission: lunar(),
      payloadMass: payload,
      payout,
      degradedShare: 0,
      penalty: step(payout * 0.35, 100),
      deadline: day + int(300, 380),
      minReputation: 4,
      postedDay: day,
      refuses: BIG_FAILURES,
    });
  }
  for (let day = int(620, 720); day < 1_100; day += int(300, 400)) {
    const payload = step(between(30, 150), 10);
    const c3 = Math.round(between(5, 12));
    const payout = step(30_000 + 100 * payload + 400 * c3, 100);
    out.push({
      id: id("deep"),
      kind: "deep-space",
      customer: pick(["National Space Agency", "Eurasian Space Agency", "Asteroid Prospecting Ltd"]),
      title: `${payload} kg deep-space probe, C3 ${c3} km²/s²`,
      mission: escape(c3),
      payloadMass: payload,
      payout,
      degradedShare: 0,
      penalty: step(payout * 0.35, 100),
      deadline: day + int(320, 400),
      minReputation: 5,
      postedDay: day,
      refuses: BIG_FAILURES,
    });
  }
  {
    // Skyweb: a broadband mega-constellation, a batch every month. Two or
    // three production lines and a big launcher keep up; one line can't.
    const start = int(440, 520);
    const count = 12;
    const sats = int(20, 30);
    const payload = sats * 25;
    const base = step(12_000 + 20 * payload, 100);
    let day = start;
    for (let i = 0; i < count; i++, day += int(28, 35)) {
      out.push({
        id: `skyweb-${i + 1}`,
        kind: "megaconstellation",
        customer: "Skyweb",
        title: `Skyweb batch ${i + 1} of ${count}: ${sats} × 25 kg to 550 km, 53°`,
        seriesId: "skyweb",
        seriesIndex: i + 1,
        mission: circular(550, 53),
        payloadMass: payload,
        payout: base,
        degradedShare: 0.3,
        penalty: step(base * 0.25, 100),
        deadline: day + 90,
        minReputation: 3,
        postedDay: day,
        refuses: [],
      });
    }
  }
  {
    // Station resupply: the capsule flown without crew, full of cargo. The
    // stepping stone to crew: it needs only the orbital licence and builds
    // the clean record a crew-rated rocket needs.
    let day = int(520, 600);
    for (let i = 0; i < 6; i++, day += int(80, 110)) {
      const payout = step(between(75_000, 90_000), 500);
      out.push({
        id: `cargo-${i + 1}`,
        kind: "cargo",
        customer: "National Space Agency",
        title: `Station resupply ${i + 1} of 6: the capsule with cargo to 400 km, 51.6°`,
        seriesId: "cargo",
        seriesIndex: i + 1,
        mission: circular(400, 51.6),
        payloadMass: 2_400,
        payout,
        degradedShare: 0,
        penalty: step(payout * 0.25, 500),
        deadline: day + 150,
        minReputation: 4,
        postedDay: day,
        refuses: [...FAILURE_TAGS, "no-orbit", "crew-lost"],
      });
    }
  }
  return out;
}

/** Starting cash, $k. Some companies start leaner than others. */
export function startingCash(seed: number): number {
  const random = rng(hashSeed(`${seed}:cash`));
  return Math.round(9_000 + 5_000 * random());
}
