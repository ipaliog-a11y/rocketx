import { useMemo } from "react";
import { achievements } from "../../sim/achievements.ts";
import { END_LABELS, lessonsFrom, summarize, type Archive } from "../../sim/archive.ts";
import { summary, type Company } from "../../sim/company.ts";
import { FAILURE_LABELS, type FailureMode } from "../../sim/hardware.ts";
import { optionSpec, type Slot } from "../../sim/parts.ts";
import { money, signed } from "../format.ts";
import { game } from "../game.ts";

/**
 * The end of a run: how it went, how the score adds up, the autopsy, and
 * what goes into the archive for the next company. One screen whether the
 * company died, retired or met the board.
 */
export function RunReport({ company, archive }: { company: Company; archive: Archive }) {
  const run = useMemo(() => summarize(company), [company]);
  const learned = useMemo(() => lessonsFrom(company), [company]);
  const list = achievements(company).filter((a) => a.earned);
  // This run is the archive's last once recorded; "new" means first earned in it.
  const thisRun = company.archived ? archive.played : archive.played + 1;
  const scores = [...archive.runs.slice(0, company.archived ? -1 : undefined).map((r) => r.score)];
  const best = scores.length > 0 ? Math.max(...scores) : null;
  const rank = 1 + scores.filter((s) => s > run.score).length;
  const dead = company.dead;
  const partLessons = Object.entries(learned.parts).map(([key, e]) => {
    const [slot, option] = key.split(":") as [Slot, string];
    const modes = (Object.entries(e.modes) as Array<[FailureMode, number]>).map(([m]) => FAILURE_LABELS[m]);
    return `${optionSpec(slot, option).label} ${slot === "cooling" || slot === "nozzle" ? "" : slot}`.trim() + (modes.length > 0 ? `: ${modes.join(", ")}` : ": no problems seen");
  });
  const other = [
    ...Object.entries(learned.materials).map(([m, e]) => `${m} shells: knock-down ${e.min.toFixed(2)}${e.max > e.min ? `–${e.max.toFixed(2)}` : ""}`),
    ...(["hammerhead", "flush"] as const).filter((k) => learned.noses[k].tested > 0).map((k) => `${k === "hammerhead" ? "Hammerhead" : "Flush"} fairings: buffet on ${learned.noses[k].buffet} of ${learned.noses[k].tested}`),
    ...(learned.gnc.tested > 0 ? [`flight computers: ${learned.gnc.flaws} software flaw${learned.gnc.flaws === 1 ? "" : "s"} in ${learned.gnc.tested}`] : []),
  ];

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="The run is over">
      <div className="card run-report">
        <p className="label hdr-row">
          <span>Run report · {END_LABELS[run.how]}</span>
          <span className="mono">
            RUN {thisRun} · SEED {company.seed}
          </span>
        </p>
        <div className="run-head">
          <div>
            <h2 className={dead ? "bad" : undefined}>{run.outcome}</h2>
            <span className="soft">
              {company.name} · day {run.endDay}
            </span>
          </div>
          <div className="run-score">
            <span className="mono">{run.score}</span>
            <small>{best === null ? "FIRST RUN" : run.score > best ? "NEW BEST" : `#${rank} OF ${scores.length + 1} · BEST ${best}`}</small>
          </div>
        </div>

        <dl className="ro-row ro-4">
          <div className="ro">
            <dt className="lbl">Cash</dt>
            <dd className={`val ${run.cash < 0 ? "bad" : ""}`}>
              {(run.cash / 1000).toFixed(1)}
              <small>$M</small>
            </dd>
            <span className="ro-sub">STARTED {money(run.startingCash).toUpperCase()}</span>
          </div>
          <div className="ro">
            <dt className="lbl">Reputation</dt>
            <dd className={`val ${run.reputation > 0 ? "good" : run.reputation < 0 ? "bad" : ""}`}>{signed(run.reputation)}</dd>
            <span className="ro-sub">MARKET ERA {run.era}</span>
          </div>
          <div className="ro">
            <dt className="lbl">Orbits</dt>
            <dd className="val">{run.orbits}</dd>
            <span className="ro-sub">{run.firstOrbitDay === null ? "NONE" : `FIRST D ${run.firstOrbitDay}`}</span>
          </div>
          <div className="ro">
            <dt className="lbl">Deliveries</dt>
            <dd className="val">{run.deliveries}</dd>
            <span className="ro-sub">{run.launches} LAUNCHES</span>
          </div>
        </dl>

        <div className="run-cols">
          <section aria-labelledby="score-head">
            <p className="label" id="score-head">
              How the score adds up
            </p>
            <ul className="checklist">
              {run.parts.map((p) => (
                <li key={p.label}>
                  <span className={p.points < 0 ? "bad" : "good"}>{p.points < 0 ? "−" : "+"}</span>
                  <span>
                    {p.label}
                    {p.count !== 1 || p.each !== p.points ? (
                      <span className="muted">
                        {" "}
                        · {p.count} × {p.each}
                      </span>
                    ) : null}
                  </span>
                  <span className="mono">{p.points}</span>
                </li>
              ))}
              {run.parts.length === 0 && (
                <li>
                  <span className="muted">·</span>
                  <span className="muted">Nothing scored.</span>
                  <span className="mono">0</span>
                </li>
              )}
            </ul>
          </section>
          <section aria-labelledby="pm-head">
            <p className="label" id="pm-head">
              Post-mortem
            </p>
            <ul className="run-lines">
              {run.postMortem.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
        </div>

        <div className="run-cols">
          <section aria-labelledby="ach-run-head">
            <p className="label hdr-row" id="ach-run-head">
              <span>Achievements</span>
              <span className="mono">{list.length}</span>
            </p>
            {list.length === 0 ? (
              <span className="muted">None this run.</span>
            ) : (
              <ul className="run-tags">
                {list.map((a) => {
                  const fresh = (archive.career[a.id] ?? thisRun) === thisRun;
                  return (
                    <li key={a.id} className={fresh ? "fresh" : undefined}>
                      {a.title}
                      {fresh && <small> NEW</small>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section aria-labelledby="learn-head">
            <p className="label" id="learn-head">
              Into the archive
            </p>
            {partLessons.length + other.length === 0 ? (
              <span className="muted">Nothing tested, nothing learned for next time.</span>
            ) : (
              <ul className="run-lines">
                {[...partLessons, ...other].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <span className="muted run-note">The next company starts with fresh hardware: what carries over is how often each kind of part showed its problems.</span>
          </section>
        </div>

        <details className="run-record">
          <summary>Full record</summary>
          <pre className="report">{summary(company)}</pre>
        </details>

        <div className="actions">
          <button type="button" className="btn primary" onClick={() => game.quit()}>
            Start a new run <span className="note">archive: {thisRun} run{thisRun === 1 ? "" : "s"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
