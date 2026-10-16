import type { ReactNode } from "react";
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

  const rev = capsule ? String.fromCharCode(65 + capsule.known.revision) : "";
  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="card" aria-label="Capsule">
        <p className="label hdr-row">
          <span>Capsule</span>
          <span className="mono">CAP-1{capsule ? ` · REV ${rev}` : ""}</span>
        </p>
        {capsule ? (
          <div className="booster-line">
            <span className="stamp-tag held">DEVELOPED</span>
            <span className="part-sub">
              D {capsule.developedDay} · {CAPSULE.crew} CREW · ABORT SYSTEM REV {rev}
            </span>
          </div>
        ) : pending ? (
          <div className="booster-line">
            <span className="stamp-tag next">IN WORK</span>
            <span className="soft">{pending.endDay !== undefined ? `Done on day ${pending.endDay}.` : "Queued in the engineering office."}</span>
          </div>
        ) : (
          <div className="verb-group">
            <button type="button" className="btn primary" disabled={!orbital} onClick={() => game.schedule(capsuleJob())}>
              Develop the capsule <span className="note">{orbital ? `${money(CAPSULE.develop.cost)} · ${CAPSULE.develop.days} d` : "needs the orbital license"}</span>
            </button>
          </div>
        )}
      </section>

      {capsule && (
        <section className="card" aria-label="Abort system">
          <p className="label hdr-row">
            <span>Abort system</span>
            <span className="mono">REV {rev}</span>
          </p>
          <ul className="part-rows" style={{ marginBottom: 0 }}>
            <li className={`part-row ${capsule.known.padAbortPassed ? "tone-good" : ""}`}>
              <span className="part-tag">PAD</span>
              <div className="part-body">
                <span>Pad abort test</span>
                <span className="soft" style={{ fontSize: 14 }}>
                  The tower fires from the pad. Shows whether it fires and whether the parachutes open.
                </span>
              </div>
              <Chip tone={capsule.known.padAbortPassed ? "good" : "muted"}>{capsule.known.padAbortPassed ? "PASSED" : "NOT PASSED"}</Chip>
              <div className="part-verbs">
                <button type="button" className="btn" onClick={() => game.schedule(padAbortJob())}>
                  Book the range <span className="note">{money(1_500)} · 20 d</span>
                </button>
              </div>
            </li>
            <li className={`part-row ${capsule.known.inflightAbortPassed ? "tone-good" : ""}`}>
              <span className="part-tag">MAX-Q</span>
              <div className="part-body">
                <span>In-flight abort test</span>
                <span className="soft" style={{ fontSize: 14 }}>
                  On a real booster: the abort fires at max-q (above {MAX_Q_ABORT / 1000} kPa) and the booster is lost. Shows everything the pad abort does, and whether the capsule survives pulling away in
                  thick air.
                </span>
              </div>
              <Chip tone={capsule.known.inflightAbortPassed ? "good" : "muted"}>{capsule.known.inflightAbortPassed ? "PASSED" : "NOT PASSED"}</Chip>
              <div className="part-verbs">
                <AbortFlights company={company} />
              </div>
            </li>
          </ul>
          <div className="sect" style={{ marginTop: 18 }}>
            <span className="lbl">Flaws</span>
            <ul className="checklist">
              {ABORT_FLAWS.map((flaw) => {
                const open = capsule.known.open.includes(flaw);
                const fixed = capsule.known.fixed.includes(flaw);
                return (
                  <li key={flaw}>
                    <span className={open ? "bad" : fixed ? "good" : "muted"}>{open ? "▲" : fixed ? "✓" : "·"}</span>
                    <span className="stack" style={{ gap: 4 }}>
                      <span>{ABORT_FLAW_LABELS[flaw].charAt(0).toUpperCase() + ABORT_FLAW_LABELS[flaw].slice(1)}</span>
                      {open && (
                        <button type="button" className="btn primary" style={{ alignSelf: "flex-start" }} onClick={() => game.schedule(fixAbortJob(flaw))}>
                          Fix: {ABORT_FIXES[flaw].name} <span className="note">{money(ABORT_FIXES[flaw].cost)} · {ABORT_FIXES[flaw].days} d</span>
                        </button>
                      )}
                    </span>
                    <span className={`mono ${open ? "bad" : fixed ? "good" : "muted"}`}>{open ? "FOUND" : fixed ? "FIXED" : "NOT SEEN"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <section className="card" aria-label="Crew-rated rockets">
        <p className="label hdr-row">
          <span className="with-icon">
            Crew-rated rockets
            <Info label="About crew rating">
              A rocket may carry people once its engines are proven for their full burns, it has flown {CLEAN_FLIGHTS_FOR_CREW} clean orbital flights in a row, and both abort tests have passed on the current abort
              system. Station cargo flights count.
            </Info>
          </span>
          <span className="mono">{CLEAN_FLIGHTS_FOR_CREW} CLEAN IN A ROW</span>
        </p>
        <ul className="checklist">
          {Object.entries(company.designs)
            .filter(([, d]) => d.pitchProgram?.kind === "gravity-turn")
            .map(([key, d]) => {
              const r = crewRating(company, key, STATION);
              return (
                <li key={key}>
                  <span className={r.rated ? "good" : "muted"}>{r.rated ? "✓" : "·"}</span>
                  <span className="stack" style={{ gap: 2 }}>
                    <span>{d.name}</span>
                    {!r.rated && (
                      <span className="soft" style={{ fontSize: 13 }}>
                        {r.missing.join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className={`mono ${r.rated ? "good" : "muted"}`}>{r.rated ? "CREW-RATED" : "NOT RATED"}</span>
                </li>
              );
            })}
        </ul>
      </section>

      <Licence company={company} />

      {capsule && capsule.known.history.length > 0 && (
        <section className="card" aria-label="Abort test history">
          <p className="label hdr-row">
            <span>Abort system history</span>
            <span className="mono">{capsule.known.history.length}</span>
          </p>
          <ul className="log">
            {[...capsule.known.history].reverse().map((h, i) => (
              <li key={i}>
                <span className="muted">D {h.day}</span>
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
    <>
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
            Spend a {d.name} <span className="note">{ready === null ? "none built" : ready > company.day ? `on rollout · day ${ready}` : "ready"}</span>
          </button>
        );
      })}
    </>
  );
}

/** Liftoff thrust over weight with the capsule and tower on top: below 1.2 it barely leaves the pad. */
function strongEnough(d: { stages: Array<{ engine: { thrustVac: number }; engineCount: number; dryMass: number; propellantMass: number }> }, payload: number): boolean {
  const s0 = d.stages[0]!;
  const mass = payload + d.stages.reduce((sum, s) => sum + s.dryMass + s.propellantMass, 0);
  return (s0.engine.thrustVac * s0.engineCount * 0.9) / (mass * 9.80665) >= 1.2;
}

function Licence({ company }: { company: Company }) {
  const head = (stamp: ReactNode) => (
    <p className="label hdr-row">
      <span>Crewed-flight license</span>
      {stamp}
    </p>
  );
  if (company.licence === "crew") {
    return (
      <section className="card" aria-label="Crewed-flight license">
        {head(<span className="mono">LIC-CREW</span>)}
        <div className="booster-line">
          <span className="stamp-tag held">✓ HELD</span>
          <span className="soft">Crew rotations can be signed on the Contracts page.</span>
        </div>
      </section>
    );
  }
  const application = nextLicence(company, reputation(company));
  if (!application || application.tier !== "crew") {
    return (
      <section className="card" aria-label="Crewed-flight license">
        {head(<span className="mono">LIC-CREW</span>)}
        <div className="booster-line">
          <span className="stamp-tag locked">LOCKED</span>
          <span className="muted">After the {LICENCE_LABELS.orbital.toLowerCase()} license.</span>
        </div>
      </section>
    );
  }
  const met = application.requirements.filter((r) => r.met).length;
  return (
    <section className="card" aria-label="Crewed-flight license">
      {head(
        <span className="mono">
          {met}/{application.requirements.length} MET
        </span>,
      )}
      <div className="booster-line">
        <span className="stamp-tag next">NEXT</span>
        <span className="soft">Apply from Home › Company once every line is met.</span>
      </div>
      <ul className="checklist">
        {application.requirements.map((r) => (
          <li key={r.text}>
            <span className={r.met ? "good" : "warn"}>{r.met ? "✓" : "▲"}</span>
            <span>{r.text}</span>
            <span className="mono muted">{r.progress ? `${r.progress[0]}/${r.progress[1]}` : r.met ? "MET" : "OPEN"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
