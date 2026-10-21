import type { Achievement } from "../../sim/achievements.ts";
import { bestRun, END_LABELS, type Archive } from "../../sim/archive.ts";
import { FAILURE_LABELS, type FailureMode } from "../../sim/hardware.ts";
import { MATERIALS, type Material } from "../../sim/geometry.ts";
import { optionSpec, type Slot } from "../../sim/parts.ts";
import { Chip } from "../components/Bits.tsx";
import { Info } from "../components/Info.tsx";

const SLOT_NAMES: Record<Slot, string> = { cycle: "Cycle", injector: "Injector", cooling: "Cooling", nozzle: "Nozzle" };

/** Home › Archive: what outlives the company. Past runs, achievements across runs, and lessons by kind of part. */
export function ArchiveTab({ archive, list }: { archive: Archive; list: Achievement[] }) {
  const best = bestRun(archive);
  const last = archive.runs.at(-1);
  const parts = Object.entries(archive.lessons.parts).sort((a, b) => a[0].localeCompare(b[0]));
  const materials = Object.entries(archive.lessons.materials) as Array<[Material, { tested: number; min: number; max: number }]>;
  const noses = (["hammerhead", "flush"] as const).filter((k) => archive.lessons.noses[k].tested > 0);
  const career = Object.keys(archive.career).length;

  if (archive.played === 0) {
    return (
      <div className="card" style={{ alignItems: "flex-start" }}>
        <p className="label">Archive</p>
        <span className="soft">Empty so far. When this company dies, retires, or meets the board's five-year review, its score, its post-mortem and what its tests showed come here, and the next company starts with them.</span>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <dl className="ro-row ro-4">
        <div className="ro">
          <dt className="lbl">Runs</dt>
          <dd className="val">{archive.played}</dd>
          <span className="ro-sub">ENDED</span>
        </div>
        <div className="ro">
          <dt className="lbl">Best score</dt>
          <dd className="val">{best?.score ?? 0}</dd>
          <span className="ro-sub">{best ? best.name.toUpperCase() : "—"}</span>
        </div>
        <div className="ro">
          <dt className="lbl">Best outcome</dt>
          <dd className="val word">{best?.outcome ?? "—"}</dd>
          <span className="ro-sub">{best ? `SEED ${best.seed}` : ""}</span>
        </div>
        <div className="ro">
          <dt className="lbl">Achievements</dt>
          <dd className="val">
            {career}
            <small>/ {list.length}</small>
          </dd>
          <span className="ro-sub">ACROSS RUNS</span>
        </div>
      </dl>

      <div className="row">
        <section className="grow stack" aria-label="Runs">
          <div className="card">
            <p className="label hdr-row">
              <span>Runs</span>
              <span className="mono">{archive.runs.length < archive.played ? `LAST ${archive.runs.length}` : `${archive.played}`}</span>
            </p>
            <div className="table-wrap flush">
              <table className="spec compact">
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      #
                    </th>
                    <th scope="col">Company</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Ended</th>
                    <th scope="col" className="num">
                      Day
                    </th>
                    <th scope="col" className="num">
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...archive.runs].reverse().map((r, i) => (
                    <tr key={i}>
                      <td className="num mono">{archive.played - i}</td>
                      <td>
                        {r.name}
                        <span className="muted mono"> · {r.seed}</span>
                      </td>
                      <td className={r.how === "bankrupt" || r.how === "stranded" ? "bad" : undefined}>{r.outcome}</td>
                      <td className="muted">{END_LABELS[r.how]}</td>
                      <td className="num mono">{r.endDay}</td>
                      <td className="num mono">
                        {r === best ? <Chip tone="good">{r.score}</Chip> : r.score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <p className="label hdr-row">
              <span className="with-icon">
                Lessons
                <Info label="About lessons">
                  What tests and flights showed in past runs, by kind of part. Every company gets fresh hardware with its own hidden faults, so a lesson is how often a kind of part had a problem, not whether this one will: it tells you what to test first.
                </Info>
              </span>
              <span className="mono">{parts.length} PART KINDS</span>
            </p>
            {parts.length === 0 ? (
              <span className="muted">No parts tested yet.</span>
            ) : (
              <div className="table-wrap flush">
                <table className="spec compact">
                  <thead>
                    <tr>
                      <th scope="col">Part</th>
                      <th scope="col" className="num">
                        Tested
                      </th>
                      <th scope="col">Problems seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parts.map(([key, e]) => {
                      const [slot, option] = key.split(":") as [Slot, string];
                      const modes = (Object.entries(e.modes) as Array<[FailureMode, number]>).sort((a, b) => b[1] - a[1]);
                      return (
                        <tr key={key}>
                          <td>
                            <span className="muted mono">{SLOT_NAMES[slot].toUpperCase()} </span>
                            {optionSpec(slot, option).label}
                          </td>
                          <td className="num mono">{e.tested}</td>
                          <td>{modes.length === 0 ? <span className="muted">none</span> : modes.map(([m, n]) => `${FAILURE_LABELS[m]} ${n} of ${e.tested}`).join(" · ")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {(materials.length > 0 || noses.length > 0 || archive.lessons.gnc.tested > 0) && (
              <ul className="log">
                {materials.map(([m, e]) => (
                  <li key={m}>
                    <span className="muted">SHELL</span>
                    <span>
                      {MATERIALS[m]?.label ?? m}: knock-down {e.min.toFixed(2)}
                      {e.max > e.min ? `–${e.max.toFixed(2)}` : ""} over {e.tested} measured
                    </span>
                  </li>
                ))}
                {noses.map((k) => (
                  <li key={k}>
                    <span className="muted">AERO</span>
                    <span>
                      {k === "hammerhead" ? "Hammerhead" : "Flush"} fairings: buffet on {archive.lessons.noses[k].buffet} of {archive.lessons.noses[k].tested} measured through Mach 1
                    </span>
                  </li>
                ))}
                {archive.lessons.gnc.tested > 0 && (
                  <li>
                    <span className="muted">GNC</span>
                    <span>
                      Flight software: a flaw found in {archive.lessons.gnc.flaws} of {archive.lessons.gnc.tested} computers on the HITL rig
                    </span>
                  </li>
                )}
              </ul>
            )}
          </div>
        </section>

        <aside className="side stack">
          {last && (
            <div className="card">
              <p className="label hdr-row">
                <span>Last run</span>
                <span className="mono">{last.score}</span>
              </p>
              <strong>{last.outcome}</strong>
              <span className="muted">
                {last.name} · {END_LABELS[last.how].toLowerCase()} on day {last.endDay}
              </span>
              <ul className="run-lines">
                {last.postMortem.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="card">
            <p className="label hdr-row">
              <span>Achievements across runs</span>
              <span className="mono">
                {career} / {list.length}
              </span>
            </p>
            <ul className="log">
              {list.map((a) => (
                <li key={a.id}>
                  <span className={archive.career[a.id] ? "good" : "muted"}>{archive.career[a.id] ? `RUN ${archive.career[a.id]}` : "—"}</span>
                  <span className={archive.career[a.id] ? undefined : "muted"}>
                    <strong>{a.title}</strong> · {a.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
