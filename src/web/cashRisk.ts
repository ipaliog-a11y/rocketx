import { strandedWith, type ActionResult, type Company } from "../sim/company.ts";
import { COSTS } from "../sim/cost.ts";
import { money } from "./format.ts";
import { deadlineRisks, type Job } from "./jobs.ts";

/**
 * What a job does to the company's cash: what is left once it is paid, with
 * payroll for its days and any deadline it pushes past, and what could be
 * left if it also goes wrong. "ends" means the run would be over; "low" that
 * the company would be close to it.
 */

/** Under this the cash shows red in the top bar: the company is close to the edge. */
export const LOW_CASH = 2_000;
/** Under this a job asks first even when it otherwise wouldn't: about a hundred days of payroll. */
const CRITICAL_CASH = 500;
/** A job that spends this much in all always asks. */
export const BIG_SPEND = 1_000;

export type CashRisk = {
  /** Cash once the job is paid, its payroll run and any deadline it misses charged. */
  after: number;
  /** `after`, if what could also go wrong does. */
  worst: number;
  level: "ok" | "low" | "ends";
  /** Why, in a sentence each. */
  reasons: string[];
  /** Whether this alone is reason to ask before doing it. */
  asks: boolean;
};

/** The risk to the cash of running `job` for `days` (its own days unless a track job runs longer). */
export function cashRisk<T extends ActionResult>(company: Company, job: Job<T>, days = job.days, cost = job.cost): CashRisk {
  const payroll = days * COSTS.overheadPerDay;
  const missed = deadlineRisks(company, days, job.forContract).filter((r) => company.day + days > r.contract.deadline);
  const penalties = missed.reduce((sum, r) => sum + r.contract.penalty, 0);
  const after = company.cash + (job.refund ?? 0) - cost - payroll - penalties;
  const exposure = job.exposure ?? [];
  const worst = after - exposure.reduce((sum, e) => sum + e.cost, 0);
  const reasons: string[] = [];
  const stuck = after >= 0 ? strandedWith(company, after, { ordering: job.orders, lost: missed.map((r) => r.contract.id) }) : null;

  let level: CashRisk["level"] = "ok";
  if (after < 0) {
    level = "ends";
    reasons.push(`It needs ${money(-after)} more than the company has. The cash runs out and the company is finished.`);
  } else if (stuck) {
    level = "ends";
    reasons.push(`It leaves ${money(after)}: not enough, with what signed contracts pay, to build and launch another orbital rocket (${money(stuck.needed)}). Nothing built can reach orbit, so the company is finished.`);
  } else {
    if (after < LOW_CASH) {
      level = "low";
      reasons.push(`It leaves ${money(after)}, about ${Math.floor(after / COSTS.overheadPerDay)} days of payroll.`);
    }
    if (worst < 0) {
      level = "low";
      reasons.push(...exposure.map((e) => e.text), `That would be more than the cash left: the company would be finished.`);
    }
  }
  if (penalties > 0 && level !== "ok") reasons.push(`That counts ${money(penalties)} of penalties for deadlines it misses.`);

  const crosses = company.cash >= LOW_CASH && after < LOW_CASH;
  const asks = level === "ends" || worst < 0 || crosses || after < CRITICAL_CASH || cost + payroll >= BIG_SPEND;
  return { after, worst, level, reasons, asks };
}
