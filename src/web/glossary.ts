/**
 * The game's terms of art, in plain words. A term shows its entry where it
 * appears on screen, and Help lists them all.
 */
export type GlossaryEntry = { id: string; term: string; text: string };

export const GLOSSARY: GlossaryEntry[] = [
  { id: "isp", term: "Isp (specific impulse)", text: "How much push an engine gets from each kilogram of propellant, in seconds. Higher Isp means more Δv from the same tanks. The stand measures the real figure against the drawings." },
  { id: "dv", term: "Δv (delta-v)", text: "How much a rocket can change its speed, in m/s or km/s. Every mission needs a certain amount: about 2.2 km/s to go 100 km up, about 9.5 km/s for a 300 km orbit, more for GTO or escape." },
  { id: "tw", term: "T/W (thrust to weight)", text: "Thrust divided by weight at liftoff. Below 1 the rocket can't leave the pad; around 1.3–1.6 is usual. Too low wastes Δv fighting gravity." },
  { id: "maxq", term: "Max-q and dynamic pressure", text: "Dynamic pressure (q, in kPa) is how hard the air pushes on the rocket. It peaks at max-q, about a minute after liftoff. Each airframe has a load budget it must stay under." },
  { id: "kpa", term: "kPa", text: "Kilopascals, the unit of pressure. Sea level is about 101 kPa. Dynamic pressure on a rocket peaks at a few tens of kPa." },
  { id: "transonic", term: "Mach and transonic", text: "Mach is speed over the speed of sound. Around Mach 1 (transonic) drag rises sharply and the airflow can shake the fairing." },
  { id: "buffet", term: "Buffet", text: "Unsteady airflow near Mach 1 shaking the vehicle, worst at a fairing that is wider than the stack below it. Too much breaks the vehicle up. Only the transonic tunnel sees it; vortex generators cure it for a little drag." },
  { id: "cfd", term: "CFD", text: "Computational fluid dynamics: drag worked out on a computer. Cheap and quick, and about half right. It can't see the transonic drag rise or buffet." },
  { id: "flow-separation", term: "Flow separation", text: "A nozzle shaped for vacuum is too wide for thick air: the exhaust peels off the wall and the bell can tear. Vacuum nozzles only get a start check on the sea-level stand." },
  { id: "hard-start", term: "Hard start", text: "Propellant pools in the chamber before it lights, then burns all at once and cracks it. Shows up in the first fraction of a second. Fixed in the engine's cycle." },
  { id: "instability", term: "Combustion instability", text: "The flame starts to resonate like an organ pipe until it shakes the engine apart, some seconds into a firing. Fixed with injector baffles, for a little Isp." },
  { id: "burn-through", term: "Burn-through", text: "The chamber wall wears through after running too long. How long it lasts depends on the cooling. Only a long enough firing finds it." },
  { id: "relight", term: "Relight", text: "Starting an engine again in vacuum after a coast, needed to circularise or to reach GTO. Only a restart test in the altitude cell proves it." },
  { id: "margin", term: "Propellant margin", text: "Propellant left in the last stage when it shuts down at the target. Margin can be traded for payload." },
  { id: "gravity-turn", term: "Gravity turn", text: "The way a rocket bends over to orbit: a small kick to one side early on, then gravity turns it the rest of the way while the upper stage steers to its target." },
  { id: "retune", term: "Re-tune (pitch programme)", text: "Working out the steering for a flight from what tests have measured: the kick angle and how the upper stage pitches. Do it after the last test, for the payload you'll fly." },
  { id: "apogee", term: "Apogee", text: "The highest point of a flight or an orbit. Sounding flights are judged on it." },
  { id: "apsis", term: "Periapsis and apoapsis", text: "The lowest and highest points of an orbit. An orbit is written periapsis × apoapsis, in km." },
  { id: "inclination", term: "Inclination", text: "The angle of an orbit's plane to the equator. A pad can only launch straight into an inclination at least as large as its latitude." },
  { id: "leo", term: "LEO", text: "Low Earth orbit, a few hundred km up: about 9.5 km/s of Δv from the pad." },
  { id: "sso", term: "SSO", text: "Sun-synchronous orbit: nearly polar (about 97–98°), so the satellite passes over every place at the same local time. Launched against the Earth's spin, so it costs more Δv." },
  { id: "gto", term: "GTO", text: "Geostationary transfer orbit: from a low perigee up to 35,786 km. Needs a coast and a relight." },
  { id: "network", term: "Company network", text: "The company's own constellation, opened with market era 2. Charter it, buy satellites, launch them on your own rockets. Service income starts with 12 working and is full at 24; satellites last about five years, so it keeps needing launches." },
  { id: "market-era", term: "Market era", text: "Where the market stands for your company. At reputation 4 customers start asking for 375–450 kg buses and SSO imagers; at 8, for 1–2.5 t buses and platforms. Light one-off work to low orbit (smallsats, rideshares, weather and agency satellites) thins each time, so growing means bigger rockets. An era never closes." },
  { id: "c3", term: "C3", text: "Energy left over after escaping the Earth, in km²/s². Lunar and deep-space probes need a C3 at or above a target." },
  { id: "heritage", term: "Heritage", text: "What a design has already done: orbits reached, highest orbit, heaviest payload. Customers trust a design more for work it has done before." },
  { id: "reputation", term: "Reputation", text: "What customers think of the company. Deliveries raise it, failed or late contracts lower it. Some contracts need a minimum, and below zero the orbital license is out of reach." },
  { id: "series", term: "Series", text: "A run of recurring contracts from one customer. Commit to the whole series and deliver every one for a bonus at the end." },
  { id: "licence", term: "License tiers", text: "Suborbital, orbital and crewed flight. Each opens new work; the regulator wants a record first, and the application takes a fee and some days." },
  { id: "abort-tower", term: "Abort tower", text: "A small rocket on top of the crew capsule that pulls it clear if the launcher fails. Dropped once the rocket is through the thick air." },
];

const BY_ID = new Map(GLOSSARY.map((e) => [e.id, e]));

export function glossary(id: string): GlossaryEntry {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`No glossary entry "${id}".`);
  return entry;
}
