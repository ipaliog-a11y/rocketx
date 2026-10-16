import { readyDay, reputation, type Company } from "../../sim/company.ts";
import { ABORT_FIXES, ABORT_FLAW_LABELS, ABORT_FLAWS, CAPSULE, CLEAN_FLIGHTS_FOR_CREW, crewRating, MAX_Q_ABORT } from "../../sim/crew.ts";
import { holds, LICENCE_LABELS, nextLicence } from "../../sim/licence.ts";
import { STATION } from "../../missions.ts";
import { Chip } from "../components/Bits.tsx";
import { game } from "../game.ts";
import { abortTestJob, capsuleJob, fixAbortJob, padAbortJob } from "../jobs.ts";
import { money } from "../format.ts";
import { Info } from "../components/Info.tsx";

/**
 * The road to flying people: the capsule, its abort system and the two
 * tests that prove it, which rockets are crew-rated, and what the regulator
 * still wants.
 */
export function Crew({ company }: { company: Company }) {
  const capsule = company.capsule;
  const pending = company.tasks.find((t) => t.spec.kind === "capsule");
  const orbital = holds(company, "orbital");

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="card" aria-label="Capsule">
        <p className="label">Capsule</p>
        {capsule ? (
          <span>
            <Chip tone="good">DEVELOPED</Chip> <span className="soft">day {capsule.developedDay} · abort system rev {String.fromCharCode(65 + capsule.known.revision)}</span>
          </span>
        ) : pending ? (
          <span className="soft">In development: {pending.endDay !== undefined ? `done on day ${pending.endDay}` : "queued in the engineering office"}.</span>
        ) : (
          <div className="actions">
            <button type="button" className="btn primary" disabled={!orbital} onClick={() => game.schedule(capsuleJob())}>
              Develop the capsule <span className="note">{money(CAPSULE.develop.cost)} · {CAPSULE.develop.days} d</span>
            </button>
            {!orbital && <span className="muted">Needs the orbital license first.</span>}
          </div>
        )}
      </section>

      {capsule && (
        <section className="card" aria-label="Abort system">
          <p className="label">Abort system</p>
          <div className="tracks">
            <div className="stack" style={{ gap: 6 }}>
              <strong>Pad abort test</strong>
              <span className="soft" style={{ fontSize: 14 }}>
                The tower fires from the pad. Shows whether it fires and whether the parachutes open.
              </span>
              <Chip tone={capsule.known.padAbortPassed ? "good" : "muted"}>{capsule.known.padAbortPassed ? "PASSED" : "NOT PASSED"}</Chip>
              <span className="actions">
                <button type="button" className="btn" onClick={() => game.schedule(padAbortJob())}>
                  Book the range <span className="note">{money(1_500)} · 20 d</span>
                </button>
              </span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <strong>In-flight abort test</strong>
              <span className="soft" style={{ fontSize: 14 }}>
                On a real booster: the abort fires at max-q (above {MAX_Q_ABORT / 1000} kPa) and the booster is lost. Shows everything the pad abort does, and whether the capsule survives pulling away in
                thick air.
              </span>
              <Chip tone={capsule.known.inflightAbortPassed ? "good" : "muted"}>{capsule.known.inflightAbortPassed ? "PASSED" : "NOT PASSED"}</Chip>
              <AbortFlights company={company} />
            </div>
          </div>
          <ul className="list" style={{ gap: 8 }}>
            {ABORT_FLAWS.map((flaw) => {
              const open = capsule.known.open.includes(flaw);
              const fixed = capsule.known.fixed.includes(flaw);
              return (
                <li key={flaw} style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center" }}>
                  <span style={{ flex: "1 1 220px" }}>{ABORT_FLAW_LABELS[flaw].charAt(0).toUpperCase() + ABORT_FLAW_LABELS[flaw].slice(1)}</span>
                  <Chip tone={open ? "bad" : fixed ? "good" : "muted"}>{open ? "FOUND" : fixed ? "FIXED" : "NOT SEEN"}</Chip>
                  {open && (
                    <button type="button" className="btn primary" onClick={() => game.schedule(fixAbortJob(flaw))}>
                      Fix: {ABORT_FIXES[flaw].name} <span className="note">{money(ABORT_FIXES[flaw].cost)} · {ABORT_FIXES[flaw].days} d</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card" aria-label="Crew-rated rockets">
        <p className="label">
          Crew-rated rockets
          <Info label="About crew rating">
            A rocket may carry people once its engines are proven for their full burns, it has flown {CLEAN_FLIGHTS_FOR_CREW} clean orbital flights in a row, and both abort tests have passed on the current abort
            system. Station cargo flights count.
          </Info>
        </p>
        <ul className="list" style={{ gap: 10 }}>
          {Object.entries(company.designs)
            .filter(([, d]) => d.pitchProgram?.kind === "gravity-turn")
            .map(([key, d]) => {
              const r = crewRating(company, key, STATION);
              return (
                <li key={key} className="stack" style={{ gap: 4, alignItems: "stretch" }}>
                  <span>
                    <strong>{d.name}</strong> <Chip tone={r.rated ? "good" : "muted"}>{r.rated ? "CREW-RATED" : "NOT RATED"}</Chip>
                  </span>
                  {!r.rated && <span className="soft" style={{ fontSize: 13 }}>{r.missing.join(" · ")}</span>}
                </li>
              );
            })}
        </ul>
      </section>

      <Licence company={company} />

      {capsule && capsule.known.history.length > 0 && (
        <section className="card" aria-label="Abort test history">
          <p className="label">Abort system history</p>
          <ul className="list">
            {[...capsule.known.history].reverse().map((h, i) => (
              <li key={i}>
                <span className="mono muted" style={{ flex: "0 0 64px" }}>
                  day {h.day}
                </span>
                <span>{h.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Rockets that could fly the in-flight abort: built or on the line, and strong enough to lift the capsule and tower. */
function AbortFlights({ company }: { company: Company }) {
  const lift = CAPSULE.mass + CAPSULE.tower.mass;
  const candidates = Object.entries(company.designs).filter(([, d]) => d.pitchProgram?.kind === "gravity-turn" && strongEnough(d, lift));
  if (candidates.length === 0) return <span className="muted">No design can lift the capsule and tower yet: draw a heavy-lift rocket first.</span>;
  return (
    <span className="actions">
      {candidates.map(([key, d]) => {
        const ready = readyDay(company, key);
        return (
          <button
            key={key}
            type="button"
            className="btn"
            disabled={ready === null}
            title={ready === null ? `Order a ${d.name} first` : undefined}
            onClick={() => game.schedule(abortTestJob(company, key, STATION, (r) => game.showFlight(r, key)))}
          >
            Spend a {d.name}
            {ready !== null && ready > company.day ? ` on rollout, day ${ready}` : ready === null ? " (none built)" : ""}
          </button>
        );
      })}
    </span>
  );
}

/** Liftoff thrust over weight with the capsule and tower on top: below 1.2 it barely leaves the pad. */
function strongEnough(d: { stages: Array<{ engine: { thrustVac: number }; engineCount: number; dryMass: number; propellantMass: number }> }, payload: number): boolean {
  const s0 = d.stages[0]!;
  const mass = payload + d.stages.reduce((sum, s) => sum + s.dryMass + s.propellantMass, 0);
  return (s0.engine.thrustVac * s0.engineCount * 0.9) / (mass * 9.80665) >= 1.2;
}

function Licence({ company }: { company: Company }) {
  if (company.licence === "crew") {
    return (
      <section className="card" aria-label="Crewed-flight license">
        <p className="label">Crewed-flight license</p>
        <span>
          <Chip tone="good">HELD</Chip> <span className="soft">Crew rotations can be signed on the Contracts page.</span>
        </span>
      </section>
    );
  }
  const application = nextLicence(company, reputation(company));
  if (!application || application.tier !== "crew") {
    return (
      <section className="card" aria-label="Crewed-flight license">
        <p className="label">Crewed-flight license</p>
        <span className="muted">After the {LICENCE_LABELS.orbital.toLowerCase()} license.</span>
      </section>
    );
  }
  return (
    <section className="card" aria-label="Crewed-flight license">
      <p className="label">Crewed-flight license · apply from Home › Company</p>
      <ul className="list" style={{ gap: 4 }}>
        {application.requirements.map((r) => (
          <li key={r.text}>
            <span className={r.met ? "good" : "muted"} style={{ flex: "0 0 20px" }}>
              {r.met ? "✓" : "·"}
            </span>
            <span>
              {r.text}
              {r.progress ? ` (${r.progress[0]}/${r.progress[1]})` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
