import type { Company } from "./company.ts";
import { SPACE_LINE } from "./licence.ts";

/**
 * Milestones the company has passed, worked out from its record each time
 * they're asked for. Nothing is stored, so old saves and new achievements
 * never disagree.
 */
export type Achievement = {
  id: string;
  title: string;
  text: string;
  earned: boolean;
  /** Day it was earned, when the record says. */
  day?: number;
  /** How far along an unearned one is. */
  progress?: [number, number];
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function achievements(company: Company): Achievement[] {
  const firings = Object.values(company.campaign.knowledge).flatMap((k) => k.history);
  const tunnelRuns = Object.values(company.campaign.aeroKnowledge).flatMap((k) => k.history);
  const space = company.flights.filter((f) => (f.outcome === "apogee" || f.outcome === "orbit") && f.apogee >= SPACE_LINE);
  const orbits = company.flights.filter((f) => f.outcome === "orbit");
  const built = sum(Object.values(company.built));
  const income = sum(company.ledger.filter((e) => e.category === "payout").map((e) => e.amount));
  const delivered = Object.values(company.closed).filter((s) => s === "delivered").length;
  const firstPayout = company.ledger.find((e) => e.category === "payout");
  const licenceDay = (tier: string) => company.ledger.find((e) => e.category === "licence" && e.note.toLowerCase().startsWith(tier))?.day;
  const seriesDone = new Map<string, number>();
  for (const c of company.board) {
    if (c.seriesId && company.closed[c.id] === "delivered") seriesDone.set(c.seriesId, (seriesDone.get(c.seriesId) ?? 0) + 1);
  }
  const bestSeries = Math.max(0, ...seriesDone.values());
  const cleanOrbits = streak(company);

  const list: Achievement[] = [
    { id: "first-firing", title: "First fire", text: "Fire an engine on the stand.", earned: firings.length > 0 },
    { id: "first-tunnel", title: "Into the wind", text: "Run a shape in the tunnel or through CFD.", earned: tunnelRuns.length > 0 },
    { id: "first-build", title: "Rolled out", text: "Build a vehicle.", earned: built > 0 },
    { id: "space", title: "Kármán line", text: "Fly above 100 km.", earned: space.length > 0, day: space[0]?.day },
    { id: "first-pay", title: "Paying customer", text: "Get paid for a flight.", earned: firstPayout !== undefined, day: firstPayout?.day },
    { id: "orbital-licence", title: "Cleared for orbit", text: "Earn the orbital license.", earned: company.licence !== "suborbital", day: licenceDay("orbital") },
    { id: "first-orbit", title: "Orbit", text: "Reach orbit.", earned: company.firstOrbitDay !== null, day: company.firstOrbitDay ?? undefined },
    { id: "fleet", title: "Production line", text: "Build 5 vehicles.", earned: built >= 5, progress: [Math.min(built, 5), 5] },
    { id: "deliveries", title: "Regular service", text: "Deliver 5 contracts.", earned: delivered >= 5, progress: [Math.min(delivered, 5), 5] },
    { id: "ten-million", title: "Eight figures", text: "Earn $10M from customers.", earned: income >= 10_000, progress: [Math.min(Math.round(income / 1000), 10), 10] },
    { id: "series", title: "Repeat customer", text: "Deliver 3 launches in one series.", earned: bestSeries >= 3, progress: [Math.min(bestSeries, 3), 3] },
    { id: "clean-streak", title: "Boringly reliable", text: "Reach orbit 3 times in a row without a failure.", earned: cleanOrbits >= 3, progress: [Math.min(cleanOrbits, 3), 3] },
    { id: "orbits-10", title: "Old hands", text: "Reach orbit 10 times.", earned: orbits.length >= 10, progress: [Math.min(orbits.length, 10), 10] },
  ];
  return list;
}

/** Longest run of orbital flights in a row that all reached orbit. */
function streak(company: Company): number {
  let best = 0;
  let run = 0;
  for (const f of company.flights) {
    if (f.outcome === "orbit") best = Math.max(best, ++run);
    else if (f.mission !== "Suborbital flight") run = 0;
  }
  return best;
}
