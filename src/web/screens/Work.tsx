import { useState } from "react";
import type { Company } from "../../sim/company.ts";
import { useNarrow } from "../narrow.ts";
import { COSTS } from "../../sim/cost.ts";
import { project, TRACK_ORDER, TRACKS, type Task } from "../../sim/schedule.ts";
import { game } from "../game.ts";
import { waitJob } from "../jobs.ts";
import { money } from "../format.ts";
import { Chip } from "../components/Bits.tsx";
import { Info } from "../components/Info.tsx";

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

/** A short tag for each track, for the tag column. */
const TRACK_TAGS: Record<string, string> = { stand: "SLS", cell: "ALT", office: "ENG", tunnel: "TUN", lab: "GNC", hangar: "HGR", range: "RNG", regulator: "REG" };

/** The company's work: each track, what it is doing and has queued, more capacity, and what finished lately. */
export function Work({ company }: { company: Company }) {
  const rows = timeline(company);
  const busy = TRACK_ORDER.filter((t) => rows.some((r) => r.task.track === t && r.task.startDay !== undefined)).length;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card" aria-label="Work tracks">
        <p className="label hdr-row">
          <span className="with-icon">
            Work tracks
            <Info label="About work tracks">Payroll runs at {money(COSTS.overheadPerDay)} a day whatever the tracks are doing: parallel work is how the company gets more out of each day.</Info>
          </span>
          <span className="mono">
            {busy}/{TRACK_ORDER.length} BUSY
          </span>
        </p>
        <ul className="part-rows two">
          {TRACK_ORDER.map((track) => {
            const spec = TRACKS[track];
            const units = company.units[track];
            const extra = spec.extra[units.length - 1];
            const mine = rows.filter((r) => r.task.track === track).sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.task.id - b.task.id);
            const running = mine.some((r) => r.task.startDay !== undefined);
            return (
              <li key={track} className={`part-row ${running ? "tone-action" : ""}`} aria-label={spec.name}>
                <span className="part-tag">{TRACK_TAGS[track] ?? track.slice(0, 3).toUpperCase()}</span>
                <div className="part-body">
                  <span>{spec.name}</span>
                  <span className="part-sub">
                    {units.length} UNIT{units.length === 1 ? "" : "S"}
                    {units.some((d) => d > company.day) ? ` · ONE MORE FROM D ${Math.max(...units)}` : ""}
                  </span>
                  {mine.length > 0 && (
                    <ul className="task-rows">
                      {mine.map(({ task, start, end }) => (
                        <TaskRow key={task.id} company={company} task={task} start={start} end={end} />
                      ))}
                    </ul>
                  )}
                </div>
                <Chip tone={running ? "warn" : mine.length > 0 ? "muted" : "good"}>{running ? "BUSY" : mine.length > 0 ? "QUEUED" : "IDLE"}</Chip>
                {extra && (
                  <div className="part-verbs">
                    <button type="button" className="btn quiet" onClick={() => game.buyUnit(track)}>
                      Add {extra.name} <span className="note">{money(extra.cost)} · {extra.days} d</span>
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="card" aria-label="Recent results">
        <p className="label hdr-row">
          <span>Recent results</span>
          <span className="mono">LAST {Math.min(12, company.done.length)}</span>
        </p>
        {company.done.length === 0 && <span className="muted">Nothing finished yet.</span>}
        <ul className="log">
          {[...company.done].reverse().slice(0, 12).map((d, i) => (
            <li key={`${d.id}-${i}`}>
              <span className="muted">D {d.day}</span>
              <span className="stack" style={{ gap: 4 }}>
                <span>
                  <span className="lbl">{TRACKS[d.track].name}</span> {d.summary}
                </span>
                {d.text && d.text !== d.summary && (
                  <details>
                    <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
                      Full report
                    </summary>
                    <pre className="report">{d.text}</pre>
                  </details>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TaskRow({ company, task, start, end }: { company: Company; task: Task; start?: number; end?: number }) {
  const running = task.startDay !== undefined;
  const span = running && end !== undefined ? Math.max(1, end - task.startDay!) : 1;
  const done = running ? Math.min(1, (company.day - task.startDay!) / span) : 0;
  return (
    <li className="task-row">
      <span>
        {task.title}
        {task.parent !== undefined && <span className="muted"> (after a lost engine)</span>}
      </span>
      {running && (
        <span className="hairline" aria-hidden="true">
          <i style={{ width: `${Math.round(done * 100)}%` }} />
        </span>
      )}
      <span className="part-sub">
        {running ? `D ${task.startDay} → ${end}` : start !== undefined ? `QUEUED · D ${start} → ${end}` : "QUEUED"}
        {!running && (
          <button type="button" className="btn quiet task-cancel" onClick={() => game.cancelTask(task.id)}>
            Cancel <span className="note">{money(task.cost)} back</span>
          </button>
        )}
      </span>
    </li>
  );
}
