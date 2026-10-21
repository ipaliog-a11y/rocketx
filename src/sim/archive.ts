import { achievements } from "./achievements.ts";
import { describeTag, reputation, runOver, type Category, type Company } from "./company.ts";
import { FAILURE_LABELS, type FailureMode } from "./hardware.ts";
import { MATERIALS, type Material } from "./geometry.ts";
import { optionSpec, parsePartKey, type Slot } from "./parts.ts";
import { working } from "./network.ts";

/**
 * What outlives a company. One company is one run; the firm can die, and
 * the player's knowledge persists. Hidden truths are rolled again for every
 * run, so no measured number carries over: what carries is how often each
 * kind of part, material, shape and flight computer showed its problems,
 * the runs themselves, and their post-mortems.
 */

export type ScorePart = { label: string; count: number; each: number; points: number };

export type RunEnd = "bankrupt" | "stranded" | "retired" | "review";

export type RunSummary = {
  seed: number;
  name: string;
  endDay: number;
  how: RunEnd;
  cash: number;
  startingCash: number;
  reputation: number;
  licence: string;
  firstOrbitDay: number | null;
  orbits: number;
  deliveries: number;
  launches: number;
  era: number;
  networkWorking: number;
  /** Achievement ids earned. */
  achievements: string[];
  score: number;
  parts: ScorePart[];
  outcome: string;
  postMortem: string[];
};

/** Tallies across runs. Counts of what tests and flights showed, never a truth. */
export type Lessons = {
  /** By `slot:option`: parts built and tested, and how many showed each failure mode. */
  parts: Record<string, { tested: number; modes: Partial<Record<FailureMode, number>> }>;
  /** By material: shells proof-tested or flown, and the knock-downs measured. */
  materials: Record<string, { tested: number; min: number; max: number }>;
  /** By fairing kind: shapes measured through the transonic range, and how many buffeted. */
  noses: Record<"hammerhead" | "flush", { tested: number; buffet: number }>;
  /** Flight computers run on the HITL rig, and software flaws it found. */
  gnc: { tested: number; flaws: number };
};

export type Archive = {
  version: 1;
  /** Oldest first, the last few dozen. */
  runs: RunSummary[];
  /** Runs played in all, including any dropped from the list. */
  played: number;
  lessons: Lessons;
  /** Each achievement ever earned, and the run (1-based) that first earned it. */
  career: Record<string, number>;
};

export const MAX_RUNS = 50;

export const emptyArchive = (): Archive => ({ version: 1, runs: [], played: 0, lessons: { parts: {}, materials: {}, noses: { hammerhead: { tested: 0, buffet: 0 }, flush: { tested: 0, buffet: 0 } }, gnc: { tested: 0, flaws: 0 } }, career: {} });

/** What the company started with: the first balance in its books. */
export function startingCashOf(company: Company): number {
  const moved = company.ledger.reduce((sum, e) => sum + e.amount, 0);
  return Math.round(company.cash - moved);
}

/** How the run ended, or null while it goes on. */
export function endOf(company: Company): RunEnd | null {
  if (company.dead) return company.deathCause ?? "bankrupt";
  return company.ended?.how ?? null;
}

export const END_LABELS: Record<RunEnd, string> = {
  bankrupt: "Ran out of cash",
  stranded: "Couldn't afford another try at orbit",
  retired: "Retired",
  review: "Closed at the five-year review",
};

/** Points for each thing, and the share a dead company keeps. */
export const SCORE = { delivery: 10, orbit: 5, reputation: 10, profitPerM: 2, achievement: 15, satellite: 2, deadKeeps: 0.75, earlyOrbitBy: 1095 } as const;

/** The run's score, part by part, so the report can show how it adds up. */
export function scoreRun(company: Company): { score: number; parts: ScorePart[] } {
  const deliveries = Object.values(company.closed).filter((s) => s === "delivered").length;
  const orbits = company.flights.filter((f) => f.outcome === "orbit").length;
  const profit = Math.max(0, Math.floor((company.cash - startingCashOf(company)) / 1000));
  const earned = achievements(company).filter((a) => a.earned).length;
  const early = company.firstOrbitDay === null ? 0 : Math.max(0, Math.floor((SCORE.earlyOrbitBy - company.firstOrbitDay) / 10));
  const sats = working(company.network, company.day);
  const part = (label: string, count: number, each: number): ScorePart => ({ label, count, each, points: count * each });
  const parts = [
    part("Deliveries", deliveries, SCORE.delivery),
    part("Orbits", orbits, SCORE.orbit),
    part("Reputation", reputation(company), SCORE.reputation),
    part("Profit, $M", profit, SCORE.profitPerM),
    part("Achievements", earned, SCORE.achievement),
    part(`First orbit, 10-day spans before day ${SCORE.earlyOrbitBy}`, early, 1),
    part("Satellites working", sats, SCORE.satellite),
  ].filter((p) => p.count !== 0);
  let score = parts.reduce((sum, p) => sum + p.points, 0);
  if (company.dead && score > 0) {
    const lost = -Math.round(score * (1 - SCORE.deadKeeps));
    parts.push({ label: "The company died", count: 1, each: lost, points: lost });
    score += lost;
  }
  return { score, parts };
}

/** A name for how the run went, from dead to industry leader. */
export function outcomeOf(company: Company): string {
  const orbits = company.flights.filter((f) => f.outcome === "orbit").length;
  if (company.dead) return orbits === 0 ? "Dead before orbit" : `Dead after ${orbits} orbit${orbits === 1 ? "" : "s"}`;
  if (company.firstOrbitDay === null) return "Suborbital outfit";
  const era = company.market?.era ?? 1;
  const deliveries = Object.values(company.closed).filter((s) => s === "delivered").length;
  if (era >= 3 && (company.network?.serviceDay !== undefined || company.licence === "crew")) return "Industry leader";
  if (era >= 2 && deliveries >= 10 && company.cash > startingCashOf(company)) return "Sustainable launcher";
  return "Niche contractor";
}

const LABELS: Partial<Record<Category, string>> = { test: "testing", fix: "fixes", rnd: "R&D", analysis: "analysis", build: "building vehicles", launch: "launch fees", licence: "licences", facility: "facilities", overhead: "overhead", penalty: "penalties", satellites: "network satellites" };
const $M = (k: number) => `$${(Math.abs(k) / 1000).toFixed(1)}M`;

/**
 * The autopsy: how the run ended, where the money went if it ran out, and
 * the last setbacks on the record. Plain sentences a player can point at.
 */
export function postMortem(company: Company): string[] {
  const lines: string[] = [];
  const how = endOf(company);
  const orbits = company.flights.filter((f) => f.outcome === "orbit").length;
  if (how === "bankrupt" || how === "stranded") {
    const spent = new Map<Category, number>();
    for (const e of company.ledger) if (e.amount < 0) spent.set(e.category, (spent.get(e.category) ?? 0) - e.amount);
    const total = [...spent.values()].reduce((a, b) => a + b, 0);
    const [top, amount] = [...spent.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["overhead", 0];
    lines.push(
      how === "bankrupt"
        ? `The cash ran out on day ${company.day}.`
        : `On day ${company.day}, with ${$M(company.cash)} and nothing built that could reach orbit, there was no money for another try.`,
    );
    if (total > 0) lines.push(`The biggest spend was ${LABELS[top] ?? top}: ${$M(amount)}, ${Math.round((amount / total) * 100)}% of everything spent.`);
  } else if (how) {
    lines.push(
      `${how === "retired" ? "Retired" : "Reviewed"} on day ${company.ended!.day} with ${$M(company.cash)} in hand${company.firstOrbitDay !== null ? `, ${orbits} orbit${orbits === 1 ? "" : "s"} flown, the first on day ${company.firstOrbitDay}` : ", never having reached orbit"}.`,
    );
  }
  const setbacks = company.record.filter((r) => r.reputation < 0 || (r.test && r.tag !== "demonstrated" && r.tag !== "delivered")).slice(-3);
  for (const r of setbacks) lines.push(`Day ${r.day}: ${describeTag(r.tag)}${r.test ? " on a test flight" : ""} (${r.note}).`);
  if (setbacks.length === 0 && how) lines.push("No setbacks on the record.");
  return lines;
}

/** Fairing wider than the widest stage, read back from a shape key. */
function hammerheadKey(key: string): boolean {
  const [fairing, stack] = key.replace(/^g:/, "").split("/");
  const widest = Math.max(...(stack ?? "0").split("-").map(Number));
  return Number(fairing) > widest;
}

/** What this run's tests and flights showed, as tallies to add to the archive. */
export function lessonsFrom(company: Company): Lessons {
  const out = emptyArchive().lessons;
  const c = company.campaign;
  for (const [key, k] of Object.entries(c.parts ?? {})) {
    if (k.firings + k.flights === 0) continue;
    const { slot, option } = parsePartKey(key);
    const entry = (out.parts[`${slot}:${option}`] ??= { tested: 0, modes: {} });
    entry.tested += 1;
    for (const mode of new Set<FailureMode>([...k.open, ...k.fixed, ...(Object.keys(k.seen) as FailureMode[])])) entry.modes[mode] = (entry.modes[mode] ?? 0) + 1;
  }
  for (const [key, k] of Object.entries(c.structureKnowledge ?? {})) {
    if (k.tests === 0) continue;
    const material = key.split("@")[0]!;
    const m = (out.materials[material] ??= { tested: 0, min: k.knockdown, max: k.knockdown });
    m.tested += 1;
    m.min = Math.min(m.min, k.knockdown);
    m.max = Math.max(m.max, k.knockdown);
  }
  for (const [key, k] of Object.entries(c.aeroKnowledge ?? {})) {
    const buffeted = (k.buffet ?? 0) > 0 || k.open.includes("transonic-buffet") || k.fixed.includes("transonic-buffet");
    if (k.buffet === null && !buffeted) continue;
    const n = out.noses[hammerheadKey(key) ? "hammerhead" : "flush"];
    n.tested += 1;
    if (buffeted) n.buffet += 1;
  }
  for (const k of Object.values(c.gncKnowledge ?? {})) {
    if (!k.hitl || k.hitl.runs === 0) continue;
    out.gnc.tested += 1;
    if (k.hitl.flaw) out.gnc.flaws += 1;
  }
  return out;
}

function mergeLessons(a: Lessons, b: Lessons): Lessons {
  const out: Lessons = structuredClone(a);
  for (const [key, e] of Object.entries(b.parts)) {
    const t = (out.parts[key] ??= { tested: 0, modes: {} });
    t.tested += e.tested;
    for (const [mode, n] of Object.entries(e.modes) as Array<[FailureMode, number]>) t.modes[mode] = (t.modes[mode] ?? 0) + n;
  }
  for (const [key, e] of Object.entries(b.materials)) {
    const t = out.materials[key];
    out.materials[key] = t ? { tested: t.tested + e.tested, min: Math.min(t.min, e.min), max: Math.max(t.max, e.max) } : { ...e };
  }
  for (const kind of ["hammerhead", "flush"] as const) {
    out.noses[kind].tested += b.noses[kind].tested;
    out.noses[kind].buffet += b.noses[kind].buffet;
  }
  out.gnc.tested += b.gnc.tested;
  out.gnc.flaws += b.gnc.flaws;
  return out;
}

/** The run, summed up for the archive. */
export function summarize(company: Company): RunSummary {
  const { score, parts } = scoreRun(company);
  return {
    seed: company.seed,
    name: company.name,
    endDay: company.ended?.day ?? company.day,
    how: endOf(company) ?? "retired",
    cash: company.cash,
    startingCash: startingCashOf(company),
    reputation: reputation(company),
    licence: company.licence,
    firstOrbitDay: company.firstOrbitDay,
    orbits: company.flights.filter((f) => f.outcome === "orbit").length,
    deliveries: Object.values(company.closed).filter((s) => s === "delivered").length,
    launches: company.flights.length,
    era: company.market?.era ?? 1,
    networkWorking: working(company.network, company.day),
    achievements: achievements(company)
      .filter((a) => a.earned)
      .map((a) => a.id),
    score,
    parts,
    outcome: outcomeOf(company),
    postMortem: postMortem(company),
  };
}

/** The archive with this run added. The run must be over. */
export function recordRun(archive: Archive, company: Company): Archive {
  if (!runOver(company)) throw new Error("The run isn't over yet.");
  const run = summarize(company);
  const played = archive.played + 1;
  const career = { ...archive.career };
  for (const id of run.achievements) career[id] ??= played;
  return { version: 1, runs: [...archive.runs, run].slice(-MAX_RUNS), played, lessons: mergeLessons(archive.lessons, lessonsFrom(company)), career };
}

/** The best run so far, by score. */
export function bestRun(archive: Archive): RunSummary | undefined {
  return [...archive.runs].sort((a, b) => b.score - a.score)[0];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What past runs showed about one part option, or null if none tested it. */
export function lessonFor(archive: Archive | null, slot: Slot, option: string): string | null {
  const e = archive?.lessons.parts[`${slot}:${option}`];
  if (!e || e.tested === 0) return null;
  const modes = (Object.entries(e.modes) as Array<[FailureMode, number]>).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const label = optionSpec(slot, option).label.toLowerCase();
  const noun = { cycle: `${label} cycles`, injector: `${label} injectors`, cooling: `chambers with ${label}`, nozzle: `${label}s` }[slot];
  if (modes.length === 0) return `No problems seen in ${e.tested} past ${e.tested === 1 ? noun.replace(/s( with|$)/, "$1") : noun}.`;
  return `${modes.map(([mode, n]) => `${FAILURE_LABELS[mode]} in ${n} of ${e.tested}`).join(", ")} past ${noun}.`;
}

/** What past runs measured about a material's shells, or null. */
export function materialLesson(archive: Archive | null, material: Material): string | null {
  const e = archive?.lessons.materials[material];
  if (!e || e.tested === 0) return null;
  const [lo, hi] = MATERIALS[material].knockdown;
  return `${plural(e.tested, "past shell")} measured: knock-down ${e.min.toFixed(2)}${e.max > e.min ? `–${e.max.toFixed(2)}` : ""} (the catalogue says ${lo.toFixed(2)}–${hi.toFixed(2)}).`;
}

/** What past runs saw of buffet on hammerhead or flush fairings, or null. */
export function noseLesson(archive: Archive | null, hammerhead: boolean): string | null {
  const e = archive?.lessons.noses[hammerhead ? "hammerhead" : "flush"];
  if (!e || e.tested === 0) return null;
  return `Buffet on ${e.buffet} of ${plural(e.tested, `past ${hammerhead ? "hammerhead" : "flush"} fairing`)} measured through Mach 1.`;
}
