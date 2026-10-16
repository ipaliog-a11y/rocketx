import { useState } from "react";
import type { Company } from "../../sim/company.ts";
import { useNarrow } from "../narrow.ts";
import { COSTS } from "../../sim/cost.ts";
import { project, TRACK_ORDER, TRACKS, type Task } from "../../sim/schedule.ts";
import { game } from "../game.ts";
import { waitJob } from "../jobs.ts";
import { money } from "../format.ts";

/** When every booked job starts and ends, if the calendar runs on. */
export function timeline(company: Company) {
  const p = project(company).tasks;
  return company.tasks.map((t) => ({ task: t, start: t.startDay ?? p.get(t.id)?.start, end: t.endDay ?? p.get(t.id)?.end }));
}

const advanceTo = (company: Company, day: number, why: string) => {
  const n = day - company.day;
  game.schedule(waitJob(n, why, `Advance ${n} day${n === 1 ? "" : "s"} to day ${day}?`, "Advance", true));
};

/** The plan at a glance, under the top bar on every screen: what each track is doing, and a way to let it run. */
export function WorkStrip({ company, open }: { company: Company; open: () => void }) {
  const narrow = useNarrow();
  const [expanded, setExpanded] = useState(false);
  if (company.tasks.length === 0) return null;
  const rows = timeline(company);
  const ends = rows.map((r) => r.end).filter((d): d is number => d !== undefined);
  const next = Math.min(...ends);
  const last = Math.max(...ends);
  const folded = narrow && !expanded;
  return (
    <section className={`workstrip ${folded ? "folded" : ""}`} aria-label="The plan">
      {narrow ? (
        <button type="button" className="chip-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          Plan · {company.tasks.length} {expanded ? "▴" : "▾"}
        </button>
      ) : (
        <span className="label">Plan</span>
      )}
      {!folded && (
      <span className="work-items">
        {TRACK_ORDER.map((track) => {
          const mine = rows.filter((r) => r.task.track === track);
          if (mine.length === 0) return null;
          const running = mine.filter((r) => r.task.startDay !== undefined);
          const queued = mine.length - running.length;
          return (
            <span key={track} className="work-item">
              <span className="muted">{TRACKS[track].name}:</span> {running.length > 0 ? running.map((r) => `${r.task.title} → day ${r.end}`).join(", ") : "waiting"}
              {queued > 0 && <span className="muted"> · +{queued} queued</span>}
            </span>
          );
        })}
      </span>
      )}
      <span className="actions" style={{ gap: 8 }}>
        {/* The top bar's Advance goes to the next finish; this runs the whole plan. */}
        {Number.isFinite(last) && last > next && (
          <button type="button" className="btn" onClick={() => advanceTo(company, last, "Working through the plan")}>
            All done <span className="note">day {last}</span>
          </button>
        )}
        {!folded && (
          <button type="button" className="btn" onClick={open}>
            Schedule
          </button>
        )}
      </span>
    </section>
  );
}

/** The company's work: each track, what it is doing and has queued, more capacity, and what finished lately. */
export function Work({ company }: { company: Company }) {
  const rows = timeline(company);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="tracks">
        {TRACK_ORDER.map((track) => {
          const spec = TRACKS[track];
          const units = company.units[track];
          const extra = spec.extra[units.length - 1];
          const mine = rows.filter((r) => r.task.track === track).sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.task.id - b.task.id);
          return (
            <section key={track} className="card" aria-label={spec.name} style={{ gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <strong>{spec.name}</strong>
                <span className="muted" style={{ fontSize: 13 }}>
                  {units.length} unit{units.length === 1 ? "" : "s"}
                  {units.some((d) => d > company.day) ? ` · one more from day ${Math.max(...units)}` : ""}
                </span>
              </div>
              {mine.length === 0 && <span className="muted">Idle.</span>}
              <ul className="list" style={{ gap: 6 }}>
                {mine.map(({ task, start, end }) => (
                  <TaskRow key={task.id} company={company} task={task} start={start} end={end} />
                ))}
              </ul>
              {extra && (
                <span className="actions">
                  <button type="button" className="btn" onClick={() => game.buyUnit(track)}>
                    Add {extra.name} <span className="note">{money(extra.cost)} · {extra.days} d</span>
                  </button>
                </span>
              )}
            </section>
          );
        })}
      </div>
      <section className="card" aria-label="Recent results">
        <p className="label">Recent results</p>
        {company.done.length === 0 && <span className="muted">Nothing finished yet.</span>}
        <ul className="list">
          {[...company.done].reverse().slice(0, 12).map((d, i) => (
            <li key={`${d.id}-${i}`} className="stack" style={{ gap: 4, alignItems: "stretch" }}>
              <span>
                <span className="mono muted">day {d.day}</span> · <span className="soft">{TRACKS[d.track].name}</span> · {d.summary}
              </span>
              {d.text && d.text !== d.summary && (
                <details>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
                    Full report
                  </summary>
                  <pre className="report">{d.text}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>
      <span className="muted" style={{ fontSize: 14 }}>
        Payroll runs at {money(COSTS.overheadPerDay)} a day whatever the tracks are doing: parallel work is how the company gets more out of each day.
      </span>
    </div>
  );
}

function TaskRow({ company, task, start, end }: { company: Company; task: Task; start?: number; end?: number }) {
  const running = task.startDay !== undefined;
  const span = running && end !== undefined ? Math.max(1, end - task.startDay!) : 1;
  const done = running ? Math.min(1, (company.day - task.startDay!) / span) : 0;
  return (
    <li className="stack" style={{ gap: 4, alignItems: "stretch" }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span>
          {task.title}
          {task.parent !== undefined && <span className="muted"> (after a lost engine)</span>}
        </span>
        <span className="mono muted" style={{ fontSize: 13 }}>
          {running ? `day ${task.startDay} → ${end}` : start !== undefined ? `queued · day ${start} → ${end}` : "queued"}
        </span>
      </span>
      {running ? (
        <div className="task-bar" aria-hidden="true">
          <div style={{ width: `${Math.round(done * 100)}%` }} />
        </div>
      ) : (
        <span className="actions">
          <button type="button" className="btn" onClick={() => game.cancelTask(task.id)}>
            Cancel <span className="note">{money(task.cost)} back</span>
          </button>
        </span>
      )}
    </li>
  );
}
