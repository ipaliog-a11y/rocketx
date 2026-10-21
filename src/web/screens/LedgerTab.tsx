import type { Category, Company } from "../../sim/company.ts";
import type { Tag } from "../../sim/contracts.ts";
import { FAILURE_LABELS } from "../../sim/hardware.ts";
import { Chip } from "../components/Bits.tsx";
import { money, signed } from "../format.ts";

export const LABELS: Record<Category, string> = {
  test: "Tests",
  fix: "Fixes",
  rnd: "R&D",
  analysis: "Analysis",
  build: "Vehicles built",
  launch: "Launch fees",
  licence: "Licenses",
  facility: "Facilities",
  overhead: "Payroll",
  payout: "Contract payouts",
  penalty: "Penalties",
  satellites: "Network satellites",
  network: "Network service",
};

function tagText(tag: Tag): string {
  switch (tag) {
    case "delivered":
      return "Delivered";
    case "demonstrated":
      return "Orbital demonstration";
    case "no-orbit":
      return "Payload never reached orbit";
    case "short":
      return "Experiment flown short";
    case "insertion-miss":
      return "Orbit out of spec";
    case "late":
      return "Missed a deadline";
    case "crew-lost":
      return "Crew lost";
    default:
      return FAILURE_LABELS[tag];
  }
}

/** The ledger and the record: Home's ledger tab. */
export function LedgerTab({ company }: { company: Company }) {
  const totals = new Map<Category, number>();
  for (const e of company.ledger) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  const spent = [...totals.values()].filter((v) => v < 0).reduce((a, b) => a + b, 0);

  const sorted = [...totals.entries()].sort((a, b) => a[1] - b[1]);
  return (
    <>
      <div className="row">
        <section className="grow stack" aria-label="Money">
          <div className="card">
            <p className="label hdr-row">
              <span>Where the money went</span>
              <span className="mono">{money(spent)}</span>
            </p>
            {totals.size === 0 ? (
              <span className="muted">Nothing spent yet.</span>
            ) : (
              <ul className="money-rows">
                {sorted.map(([cat, v]) => (
                  <li key={cat}>
                    <span>{LABELS[cat]}</span>
                    <span className={`mono ${v > 0 ? "good" : ""}`}>{money(v)}</span>
                    {v < 0 && (
                      <span className="ro-bar" aria-hidden="true">
                        <i style={{ width: `${(v / spent) * 100}%` }} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card">
            <p className="label hdr-row">
              <span>Ledger</span>
              <span className="mono">LAST {Math.min(40, company.ledger.length)}</span>
            </p>
            <div className="table-wrap flush">
              <table className="spec compact">
                <thead>
                  <tr>
                    <th scope="col" className="num">Day</th>
                    <th scope="col">Item</th>
                    <th scope="col" className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {[...company.ledger]
                    .reverse()
                    .slice(0, 40)
                    .map((e, i) => (
                      <tr key={i}>
                        <td className="num mono">{e.day}</td>
                        <td>
                          {LABELS[e.category]} · <span className="soft">{e.note}</span>
                        </td>
                        <td className={`num mono ${e.amount > 0 ? "good" : ""}`}>{money(e.amount)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        <aside className="side stack">
          <div className="card">
            <p className="label hdr-row">
              <span>The record customers read</span>
              <span className="mono">{company.record.length}</span>
            </p>
            {company.record.length === 0 && <span className="muted">Nothing on it yet.</span>}
            <ul className="log three">
              {company.record.map((r, i) => (
                <li key={i}>
                  <span className="muted">D {r.day}</span>
                  <span>
                    {tagText(r.tag)} <span className="muted">· {r.note}</span>
                  </span>
                  <Chip tone={r.reputation > 0 ? "good" : r.reputation < 0 ? "bad" : "muted"}>{r.test ? "TEST · 0" : signed(r.reputation)}</Chip>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <p className="label hdr-row">
              <span>Flights</span>
              <span className="mono">{company.flights.length}</span>
            </p>
            {company.flights.length === 0 && <span className="muted">Nothing has flown.</span>}
            <ul className="log">
              {company.flights.map((f, i) => (
                <li key={i}>
                  <span className="muted">D {f.day}</span>
                  <span>
                    {f.design} · {f.contract ?? f.mission} · <span className="mono">{(f.settlement ?? f.outcome).toUpperCase()}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}
