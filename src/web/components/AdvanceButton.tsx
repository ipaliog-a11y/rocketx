import type { Company } from "../../sim/company.ts";
import { game } from "../game.ts";
import { waitJob } from "../jobs.ts";
import { timeline } from "../screens/Work.tsx";
import { Icon } from "./Icon.tsx";

/** The next day something happens: a job finishes, a rocket rolls out, or new work is posted. */
export function nextEvent(company: Company): { day: number; why: string } | null {
  const events: Array<{ day: number; why: string }> = [];
  for (const r of timeline(company)) if (r.end !== undefined && r.end > company.day) events.push({ day: r.end, why: `${r.task.title} finishes` });
  for (const o of company.orders) if (o.readyDay > company.day) events.push({ day: o.readyDay, why: `a ${company.designs[o.design]?.name ?? o.design} rolls out` });
  for (const c of company.board) if (c.postedDay > company.day) events.push({ day: c.postedDay, why: "new work is posted" });
  if (events.length === 0) return null;
  return events.reduce((a, b) => (b.day < a.day ? b : a));
}

/** Move the calendar to the next thing that happens, from any screen. */
export function AdvanceButton({ company }: { company: Company }) {
  const next = nextEvent(company);
  if (!next) return null;
  const days = next.day - company.day;
  return (
    <button
      type="button"
      className="btn primary advance-btn"
      title={`Advance ${days} day${days === 1 ? "" : "s"}: ${next.why} on day ${next.day}`}
      onClick={() => game.schedule(waitJob(days, `Waiting until ${next.why}`, `Advance ${days} day${days === 1 ? "" : "s"} to day ${next.day}?`, "Advance"))}
    >
      <Icon name="next" size="sm" />
      <span className="advance-long">Advance · day {next.day}</span>
      <span className="advance-short" aria-hidden="true">
        {next.day}
      </span>
    </button>
  );
}
