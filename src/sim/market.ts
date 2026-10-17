import { eraWork } from "../contracts.ts";
import type { Company } from "./company.ts";
import { hashSeed, rng } from "./random.ts";

/**
 * Market eras. As a company's reputation grows, bigger customers come to it
 * and the market it sees moves to heavier satellites: light one-off work
 * thins out and buses and platforms the starting Meridian can't lift are
 * posted instead. Eras open the first time reputation reaches their
 * threshold and never close.
 */
export const ERAS = [
  { era: 1, reputation: -Infinity, keep: 1, label: "Smallsats", text: "Smallsats and rideshares up to about 250 kg." },
  { era: 2, reputation: 4, keep: 0.5, label: "Satellite buses", text: "Customers now want 300–600 kg buses and SSO imagers. Light one-off work thins to about half." },
  { era: 3, reputation: 8, keep: 0.25, label: "Heavy platforms", text: "Customers now want 1–2.5 t buses and SSO platforms. Light one-off work thins to about a quarter." },
] as const;

export type MarketState = { era: number; since: Record<number, number> };

export function eraFor(reputation: number): number {
  return ERAS.filter((e) => reputation >= e.reputation).at(-1)!.era;
}

export function marketOf(company: Company): MarketState {
  return (company.market ??= { era: 1, since: { 1: 0 } });
}

/** Light one-off orbital work: the market thins it once heavier customers arrive. */
const light = (kind: string, seriesId?: string) => (kind === "smallsat" || kind === "rideshare") && !seriesId;

/** Whether a light contract is still posted in an era with this keep share: the same roll every time. */
export function kept(seed: number, id: string, keep: number): boolean {
  return rng(hashSeed(`${seed}:keep:${id}`))() < keep;
}

/**
 * Open every era the company's reputation has reached. On the day one opens,
 * light one-off work not yet posted thins out and the era's own work is
 * posted from then on. Returns notices.
 */
export function advanceMarket(company: Company, reputation: number): string[] {
  const market = marketOf(company);
  const notices: string[] = [];
  for (const e of ERAS) {
    if (e.era <= market.era || reputation < e.reputation) continue;
    const day = company.day;
    market.era = e.era;
    market.since[e.era] = day;
    const signed = new Set(company.accepted);
    company.board = company.board.filter((c) => c.postedDay <= day || signed.has(c.id) || !light(c.kind, c.seriesId) || kept(company.seed, c.id, e.keep));
    const work = eraWork(company.seed, e.era).map((c) => ({ ...c, postedDay: c.postedDay + day, deadline: c.deadline + day }));
    company.board = [...company.board, ...work].sort((a, b) => a.postedDay - b.postedDay || a.deadline - b.deadline);
    notices.push(`Day ${day}: the market moves on. ${e.text}`);
  }
  return notices;
}
