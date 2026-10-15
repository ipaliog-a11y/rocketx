import { useEffect, useState } from "react";
import type { Company } from "../../sim/company.ts";
import { COSTS } from "../../sim/cost.ts";
import { game, type Progress } from "../game.ts";
import { deadlineRisks, type Job } from "../jobs.ts";
import { quoteTask, TRACKS } from "../../sim/schedule.ts";
import { money } from "../format.ts";
import { cashRisk, type CashRisk } from "../cashRisk.ts";

/** Above a dialog's facts: the job would end the company, or leave it close to the edge. */
function CashBanner({ risk, note }: { risk: CashRisk; note?: string }) {
  if (risk.level === "ok") return null;
  const ends = risk.level === "ends";
  return (
    <div className={`warn-banner ${ends ? "bad" : "caution"}`} role="alert">
      <strong>{ends ? "This ends the company" : "Cash runs low"}</strong>
      {risk.reasons.map((r) => (
        <span key={r}>{r}</span>
      ))}
      {note && <span className="soft">{note}</span>}
    </div>
  );
}

/**
 * The go-ahead for a job: what it costs in money and days, what payroll
 * adds meanwhile, and what the calendar does to every signed contract.
 */
export function JobConfirm({ company, job }: { company: Company; job: Job }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && game.cancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (job.task) return <TrackConfirm company={company} job={job} />;

  const payroll = job.days * COSTS.overheadPerDay;
  const total = job.cost + payroll;
  const risk = cashRisk(company, job);
  const ends = risk.level === "ends";
  const risks = deadlineRisks(company, job.days, job.forContract);
  const tone = ends ? "bad" : risk.level === "low" ? "warn" : undefined;
  const go = ends ? `${job.verb} and end the run` : risks.length > 0 || risk.level === "low" ? `${job.verb} anyway` : job.verb;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="job-title" onClick={(e) => e.target === e.currentTarget && game.cancel()}>
      <div className={`card ${ends || risks.length > 0 ? "alert" : risk.level === "low" ? "caution" : ""}`} style={{ maxWidth: 520 }}>
        {risks.length > 0 && <p className="label bad">Deadline warning</p>}
        <h2 id="job-title">{job.title}</h2>
        <CashBanner risk={risk} />
        {job.refund !== undefined ? (
          <dl className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <dt>Comes back</dt>
              <dd className="good">{money(job.refund)}</dd>
            </div>
            <div>
              <dt>Cash after</dt>
              <dd>{money(risk.after)}</dd>
            </div>
          </dl>
        ) : (
          <dl className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <dt>Cost</dt>
              <dd>{money(job.cost)}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>
                {job.days} day{job.days === 1 ? "" : "s"}
              </dd>
            </div>
            <div>
              <dt>Payroll meanwhile</dt>
              <dd>{money(payroll)}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{money(total)}</dd>
            </div>
            <div>
              <dt>Done on</dt>
              <dd>day {company.day + job.days}</dd>
            </div>
            <div>
              <dt>Cash after</dt>
              <dd className={tone}>{money(risk.after)}</dd>
            </div>
          </dl>
        )}
        {risks.map((r) => (
          <span key={r.contract.id} className="bad">
            {r.text}
          </span>
        ))}
        {job.caveat && <span className="muted">{job.caveat}</span>}
        <div className="actions">
          <button type="button" className={`btn ${ends ? "danger" : "primary"}`} autoFocus={!ends} onClick={() => game.confirm()}>
            {go}
            {job.refund !== undefined ? ` · ${money(job.refund)} back` : `${job.cost > 0 ? ` · ${money(job.cost)}` : ""}${job.days > 0 ? ` · ${job.days} d` : ""}`}
          </button>
          <button type="button" className={`btn ${ends ? "primary" : ""}`} autoFocus={ends} onClick={() => game.cancel()}>
            {job.refund !== undefined ? "Keep it" : risks.length > 0 ? "Abort" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The days passing: a bar that fills over a couple of seconds and a day counter that runs with it. */
export function JobProgress({ progress }: { progress: Progress }) {
  const { fromDay, toDay, ms } = progress;
  const [day, setDay] = useState(fromDay);
  useEffect(() => {
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / ms);
      setDay(Math.round(fromDay + (toDay - fromDay) * t));
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [fromDay, toDay, ms]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={progress.doing} aria-busy="true">
      <div className="card" style={{ maxWidth: 480 }}>
        <p className="label">{progress.crunching ? "Writing it up" : "In progress"}</p>
        <h2>{progress.doing}</h2>
        <div className="progress-bar" role="progressbar" aria-valuemin={fromDay} aria-valuemax={toDay} aria-valuenow={day}>
          <div style={{ ["--ms" as string]: `${ms}ms` }} />
        </div>
        <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
          <span className="muted">day {fromDay}</span>
          <span style={{ fontWeight: 600 }}>day {day}</span>
          <span className="muted">day {toDay}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The go-ahead for work on a track: start it now and let the calendar run
 * to its end, or put it on the plan and keep working while it waits its turn.
 */
function TrackConfirm({ company, job }: { company: Company; job: Job }) {
  let q: ReturnType<typeof quoteTask>;
  try {
    q = quoteTask(company, (job.quote ?? job.task)!(company));
  } catch (error) {
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="job-title" onClick={(e) => e.target === e.currentTarget && game.cancel()}>
        <div className="card alert" style={{ maxWidth: 520 }}>
          <h2 id="job-title">{job.title}</h2>
          <span className="bad">{(error as Error).message}</span>
          <div className="actions">
            <button type="button" className="btn" autoFocus onClick={() => game.cancel()}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }
  const now = q.end - company.day;
  const payroll = now * COSTS.overheadPerDay;
  const risks = deadlineRisks(company, now, job.forContract);
  const waits = q.start > company.day;
  // Planned, it is paid now and the payroll runs as the plan does: by day q.end the cash is the same either way.
  const risk = cashRisk(company, job, now, q.cost);
  const ends = risk.level === "ends";
  const tone = ends ? "bad" : risk.level === "low" ? "warn" : undefined;
  const anyway = risks.length > 0 || risk.level === "low";

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="job-title" onClick={(e) => e.target === e.currentTarget && game.cancel()}>
      <div className={`card ${ends || risks.length > 0 ? "alert" : risk.level === "low" ? "caution" : ""}`} style={{ maxWidth: 560 }}>
        <p className="label">{TRACKS[q.track].name}</p>
        <h2 id="job-title">{job.title}</h2>
        <CashBanner risk={risk} note={risk.level !== "ok" ? `Started now or added to the plan, the cash is the same by day ${q.end}.` : undefined} />
        <dl className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <dt>Cost</dt>
            <dd>{money(q.cost)}</dd>
          </div>
          <div>
            <dt>Takes</dt>
            <dd>
              {q.days} day{q.days === 1 ? "" : "s"}
            </dd>
          </div>
          <div>
            <dt>Starts</dt>
            <dd>{waits ? `day ${q.start}` : "today"}</dd>
          </div>
          <div>
            <dt>Done on</dt>
            <dd>day {q.end}</dd>
          </div>
          <div>
            <dt>Cash after, day {q.end}</dt>
            <dd className={tone}>{money(risk.after)}</dd>
          </div>
        </dl>
        {waits && q.after.length > 0 && <span className="soft">Waits for: {q.after.join(" · ")}.</span>}
        {job.caveat && <span className="muted">{job.caveat}</span>}
        <div className="choice">
          <div className="stack" style={{ gap: 6 }}>
            <strong>Start now</strong>
            <span className="soft" style={{ fontSize: 14 }}>
              The calendar runs {now} day{now === 1 ? "" : "s"} to day {q.end}, {money(payroll)} of payroll. Anything else on the plan that finishes by then finishes too.
            </span>
            {risks.map((r) => (
              <span key={r.contract.id} className="bad" style={{ fontSize: 14 }}>
                {r.text}
              </span>
            ))}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <strong>Add to the plan</strong>
            <span className="soft" style={{ fontSize: 14 }}>
              Paid now and booked on the {TRACKS[q.track].name.toLowerCase()}; the calendar stays on day {company.day}. Book other work, then advance once and it all runs side by side.
            </span>
          </div>
        </div>
        <div className="actions">
          <button type="button" className={`btn ${ends ? "danger" : risks.length > 0 ? "" : "primary"}`} autoFocus={!ends && risks.length === 0} onClick={() => game.startNow()}>
            {ends ? "Start now and end the run" : anyway ? "Start now anyway" : "Start now"} · {now} d
          </button>
          <button type="button" className={`btn ${ends ? "danger" : risks.length > 0 ? "primary" : ""}`} autoFocus={!ends && risks.length > 0} onClick={() => game.plan()}>
            {ends ? "Add to plan anyway" : "Add to plan"} · {money(q.cost)}
          </button>
          <button type="button" className={`btn ${ends ? "primary" : ""}`} autoFocus={ends} onClick={() => game.cancel()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
