import { useMemo, useState } from "react";
import { accept, bid, fly, posted, reputation, retune, wait, type Company } from "../../sim/company.ts";
import type { Contract } from "../../sim/contracts.ts";
import { COSTS } from "../../sim/cost.ts";
import { Chip, Facts } from "../components/Bits.tsx";
import { DESIGNS, game } from "../game.ts";
import { km, money } from "../format.ts";

type Props = { company: Company; version: number; goTo: (screen: "stand" | "tunnel" | "hangar") => void };

function status(company: Company, c: Contract): { text: string; tone: "good" | "warn" | "bad" | "muted" | undefined } {
  const closed = company.closed[c.id];
  if (closed === "delivered") return { text: "DELIVERED", tone: "good" };
  if (closed === "degraded") return { text: "OUT OF SPEC", tone: "warn" };
  if (closed === "failed") return { text: "FAILED", tone: "bad" };
  if (closed === "late") return { text: "LATE", tone: "bad" };
  if (company.accepted.includes(c.id)) return { text: "SIGNED", tone: "warn" };
  if (company.day > c.deadline) return { text: "EXPIRED", tone: "muted" };
  if (reputation(company) < c.minReputation) return { text: `NEEDS REP ${c.minReputation}`, tone: "muted" };
  return { text: "OPEN", tone: undefined };
}

function defaultDesign(c: Contract): string {
  return c.minApogee !== undefined ? "pathfinder" : "meridian";
}

export function Board({ company, version, goTo }: Props) {
  const board = posted(company);
  const firstOpen = board.find((c) => !company.closed[c.id] && company.day <= c.deadline) ?? board[0];
  const [selected, setSelected] = useState<string | undefined>(firstOpen?.id);
  const contract = board.find((c) => c.id === selected) ?? firstOpen;
  const [designChoice, setDesign] = useState<Record<string, string>>({});
  const design = contract ? (designChoice[contract.id] ?? defaultDesign(contract)) : "pathfinder";
  const upcoming = company.board.filter((c) => c.postedDay > company.day).map((c) => c.postedDay);
  const nextPosting = upcoming.length > 0 ? Math.min(...upcoming) : null;

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Contract board</h1>
        <span className="muted">Port Avery · 28.5° N · one pad · day {company.day}</span>
      </div>
      <div className="row">
        <section className="grow stack" aria-label="Contracts">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Contract</th>
                  <th scope="col" className="num">Pays</th>
                  <th scope="col" className="num">Penalty</th>
                  <th scope="col" className="num">Fly by</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {board.map((c) => {
                  const st = status(company, c);
                  return (
                    <tr key={c.id} className={`clickable ${c.id === contract?.id ? "selected" : ""}`} onClick={() => setSelected(c.id)}>
                      <td>
                        <button type="button" onClick={() => setSelected(c.id)} style={{ all: "unset", cursor: "pointer", fontWeight: 600 }}>
                          {c.title}
                        </button>
                        <div className="muted" style={{ fontSize: 14 }}>
                          {c.customer} · {c.payloadMass} kg
                        </div>
                      </td>
                      <td className="num">{money(c.payout)}</td>
                      <td className="num">{money(c.penalty)}</td>
                      <td className="num">{c.deadline}</td>
                      <td>
                        <Chip tone={st.tone}>{st.text}</Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="actions">
            {nextPosting !== null && (
              <span className="muted">
                {upcoming.length} more contract{upcoming.length > 1 ? "s" : ""} to be posted. Next around day {nextPosting}.
              </span>
            )}
            <button type="button" className="btn" onClick={() => game.act((c) => wait(c, 30))}>
              Wait 30 days · {money(30 * COSTS.overheadPerDay)}
            </button>
            {nextPosting !== null && (
              <button type="button" className="btn" onClick={() => game.act((c) => wait(c, nextPosting - c.day))}>
                Wait for the next posting
              </button>
            )}
          </div>
        </section>
        {contract && <BidPanel company={company} version={version} contract={contract} design={design} setDesign={(d) => setDesign({ ...designChoice, [contract.id]: d })} goTo={goTo} />}
      </div>
    </div>
  );
}

function BidPanel({
  company,
  version,
  contract,
  design,
  setDesign,
  goTo,
}: {
  company: Company;
  version: number;
  contract: Contract;
  design: string;
  setDesign: (d: string) => void;
  goTo: Props["goTo"];
}) {
  // The forecast flies the vehicle once; recompute only when something changed.
  const b = useMemo(() => bid(company, contract.id, design), [company, contract.id, design, version]);
  const signed = company.accepted.includes(contract.id);
  const built = company.inventory[design] ?? 0;
  const turns = DESIGNS[design]?.pitchProgram?.kind === "gravity-turn";
  const open = !company.closed[contract.id] && company.day <= contract.deadline;
  const testing = Math.max(0, b.daysLeft - b.build.days - COSTS.padDays);

  return (
    <aside className="side card" aria-label="Bid">
      <div className="stack" style={{ gap: 4 }}>
        <p className="label">Bid · {contract.customer}</p>
        <h2>{contract.title}</h2>
      </div>
      <label className="stack" style={{ gap: 6 }}>
        <span className="soft">Vehicle</span>
        <select value={design} onChange={(e) => setDesign(e.target.value)}>
          {Object.entries(DESIGNS).map(([key, d]) => (
            <option key={key} value={key}>
              {d.name}
              {(company.inventory[key] ?? 0) > 0 ? ` · ${company.inventory[key]} built` : ""}
            </option>
          ))}
        </select>
      </label>
      <Facts
        items={[
          ["Pays", <span className="good">{money(contract.payout)}</span>],
          ["Build", money(b.build.cost)],
          ["Penalty", <span className="bad">{money(contract.penalty)}</span>],
        ]}
      />
      {open && (
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }} className="muted">
            <span>Day {company.day}</span>
            <span>{b.daysLeft} days to fly</span>
            <span>Day {contract.deadline}</span>
          </div>
          <div role="img" aria-label={`Schedule: ${testing} days for tests, ${b.build.days} to build, ${COSTS.padDays} on the pad`} style={{ display: "flex", height: 14, borderRadius: 3, overflow: "hidden", background: "var(--ground)" }}>
            {b.fitsSchedule ? (
              <>
                <div style={{ flex: `${testing} 1 0`, background: "#26303a" }} />
                <div style={{ flex: `${b.build.days} 1 0`, background: "var(--cyan)" }} />
                <div style={{ flex: `${COSTS.padDays} 1 0`, background: "var(--amber)" }} />
              </>
            ) : (
              <div style={{ flex: 1, background: "var(--red)" }} />
            )}
          </div>
          <span className={b.fitsSchedule ? "muted" : "bad"} style={{ fontSize: 14 }}>
            {b.fitsSchedule
              ? `${testing} days of slack for tests, then a ${b.build.days}-day build and ${COSTS.padDays} days on the pad.`
              : `A ${b.build.days}-day build and ${COSTS.padDays} days on the pad no longer fit before the deadline.`}
          </span>
        </div>
      )}
      {contract.minApogee !== undefined && <span className="soft">Needs an apogee of {km(contract.minApogee, 0)}.</span>}
      {b.blockers.length > 0 && (
        <ul className="list bad">
          {b.blockers.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {b.regimes.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <p className="label">New regimes</p>
          <ul className="list">
            {b.regimes.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {b.unknowns.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <p className="label">Flying on trust</p>
          <ul className="list">
            {b.unknowns.map((u) => (
              <li key={u.subject + u.text}>
                <span className="mono warn" style={{ fontSize: 12, fontWeight: 600, flex: "0 0 auto" }}>
                  {u.subject === "Airframe" ? "AIRFRAME" : "ENGINE"}
                </span>
                <span>
                  {u.subject !== "Airframe" && <strong>{u.subject} </strong>}
                  {u.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="stack" style={{ gap: 6, padding: "14px 16px", borderRadius: 4, background: "var(--raised)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <p className="label">Forecast from what's known</p>
          <Chip tone={b.forecast.delivers ? "good" : "warn"}>{b.forecast.delivers ? "DELIVERS" : "MISSES"}</Chip>
        </div>
        <span className="mono" style={{ fontSize: 16 }}>
          {b.forecast.text}
        </span>
      </div>
      <div className="actions">
        {!signed && open && (
          <button type="button" className="btn primary" disabled={b.blockers.length > 0} onClick={() => game.act((c) => accept(c, contract.id))}>
            Sign contract
          </button>
        )}
        {signed && (
          <button
            type="button"
            className="btn primary"
            disabled={built === 0}
            title={built === 0 ? `Build a ${b.designName} first` : undefined}
            onClick={() => game.act((c) => fly(c, design, { contract: contract.id }), (r) => game.showFlight(r, design))}
          >
            Launch {b.designName}
          </button>
        )}
        <button type="button" className="btn" onClick={() => game.askBuild(design)}>
          Build · {money(b.build.cost)} · {b.build.days} d
        </button>
        {turns && contract.mission.target && open && (
          <button type="button" className="btn" onClick={() => game.actSlow("Re-tuning the pitch programme…", (c) => retune(c, design, contract.id))}>
            Re-tune for {contract.payloadMass} kg
          </button>
        )}
        <button type="button" className="btn" onClick={() => goTo("stand")}>
          Plan tests
        </button>
      </div>
    </aside>
  );
}
