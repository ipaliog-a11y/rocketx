import type { Category, Company } from "../../sim/company.ts";
import type { Tag } from "../../sim/contracts.ts";
import { FAILURE_LABELS } from "../../sim/hardware.ts";
import { Chip } from "../components/Bits.tsx";
import { money, signed } from "../format.ts";

export const LABELS: Record<Category, string> = {
  test: "Tests",
  fix: "Fixes",
  analysis: "Analysis",
  build: "Vehicles built",
  launch: "Launch fees",
  licence: "Licences",
  overhead: "Payroll",
  payout: "Contract payouts",
  penalty: "Penalties",
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
    default:
      return FAILURE_LABELS[tag];
  }
}

/** The ledger and the record: the Company page's money tab. */
export function LedgerTab({ company }: { company: Company }) {
  const totals = new Map<Category, number>();
  for (const e of company.ledger) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  const spent = [...totals.values()].filter((v) => v < 0).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="row">
        <section className="grow stack" aria-label="Money">
          <div className="card">
            <p className="label">Where the money went</p>
            {[...totals.entries()]
              .sort((a, b) => a[1] - b[1])
              .map(([cat, v]) => (
                <div key={cat} className="stack" style={{ gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{LABELS[cat]}</span>
                    <span className={`mono ${v > 0 ? "good" : ""}`}>{money(v)}</span>
                  </div>
                  {v < 0 && (
                    <div className="bar" style={{ height: 8 }}>
                      <div className="fill" style={{ width: `${(v / spent) * 100}%`, background: "var(--cyan)" }} />
                    </div>
                  )}
                </div>
              ))}
            {totals.size === 0 && <span className="muted">Nothing spent yet.</span>}
          </div>
          <div className="table-wrap">
            <table>
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
                      <td className="num">{e.day}</td>
                      <td>
                        {LABELS[e.category]} · <span className="soft">{e.note}</span>
                      </td>
                      <td className={`num ${e.amount > 0 ? "good" : ""}`}>{money(e.amount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="side stack">
          <div className="card">
            <p className="label">The record customers read</p>
            {company.record.length === 0 && <span className="muted">Nothing on it yet.</span>}
            <ul className="list">
              {company.record.map((r, i) => (
                <li key={i}>
                  <span className="mono muted" style={{ flex: "0 0 64px" }}>
                    day {r.day}
                  </span>
                  <span style={{ flex: 1 }}>
                    {tagText(r.tag)} <span className="muted">· {r.note}</span>
                  </span>
                  <Chip tone={r.reputation > 0 ? "good" : r.reputation < 0 ? "bad" : "muted"}>{signed(r.reputation)}</Chip>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <p className="label">Flights</p>
            {company.flights.length === 0 && <span className="muted">Nothing has flown.</span>}
            <ul className="list">
              {company.flights.map((f, i) => (
                <li key={i}>
                  <span className="mono muted" style={{ flex: "0 0 64px" }}>
                    day {f.day}
                  </span>
                  <span>
                    {f.design} · {f.contract ?? f.mission} · {f.settlement ?? f.outcome}
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
