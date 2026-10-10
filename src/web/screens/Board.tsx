import { useMemo, useState } from "react";
import { accept, bid, posted, reputation, type Company } from "../../sim/company.ts";
import type { Contract } from "../../sim/contracts.ts";
import { COSTS } from "../../sim/cost.ts";
import { DesignSelect, Findings, Forecast, Schedule } from "../components/BidParts.tsx";
import { Chip, Facts } from "../components/Bits.tsx";
import { DESIGNS, defaultDesign, game } from "../game.ts";
import { waitJob } from "../jobs.ts";
import { km, money } from "../format.ts";

type Props = { company: Company; version: number; goTo: (screen: "launch") => void };

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
            <button type="button" className="btn" onClick={() => game.schedule(waitJob(30, "Waiting for the board"))}>
              Wait 30 days · {money(30 * COSTS.overheadPerDay)}
            </button>
            {nextPosting !== null && (
              <button type="button" className="btn" onClick={() => game.schedule(waitJob(nextPosting - company.day, "Waiting for the next posting"))}>
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
  const open = !company.closed[contract.id] && company.day <= contract.deadline;

  return (
    <aside className="side card" aria-label="Bid">
      <div className="stack" style={{ gap: 4 }}>
        <p className="label">Bid · {contract.customer}</p>
        <h2>{contract.title}</h2>
      </div>
      <DesignSelect label="Bid it with" value={design} onChange={setDesign} designs={DESIGNS} inventory={company.inventory} />
      <Facts
        items={[
          ["Pays", <span className="good">{money(contract.payout)}</span>],
          ["Build", money(b.build.cost)],
          ["Penalty", <span className="bad">{money(contract.penalty)}</span>],
        ]}
      />
      {open && <Schedule day={company.day} deadline={contract.deadline} b={b} />}
      {contract.minApogee !== undefined && <span className="soft">Needs an apogee of {km(contract.minApogee, 0)}.</span>}
      <Findings b={b} />
      <Forecast b={b} />
      {signed ? (
        <div className="actions">
          <span className="soft">Signed. Build, re-tune and fly it from the Launch page.</span>
          <button type="button" className="btn primary" onClick={() => goTo("launch")}>
            Go to Launch
          </button>
        </div>
      ) : (
        open && (
          <div className="actions">
            <button type="button" className="btn primary" disabled={b.blockers.length > 0} onClick={() => game.act((c) => accept(c, contract.id))}>
              Sign contract
            </button>
            <span className="muted" style={{ fontSize: 14 }}>
              Signing commits you to day {contract.deadline}. Missing it costs {money(contract.penalty)}.
            </span>
          </div>
        )
      )}
    </aside>
  );
}
