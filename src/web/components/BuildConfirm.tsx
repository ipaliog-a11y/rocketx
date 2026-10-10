import { useEffect } from "react";
import type { Company } from "../../sim/company.ts";
import { COSTS, vehicleCost } from "../../sim/cost.ts";
import { DESIGNS, game } from "../game.ts";
import { money } from "../format.ts";

/**
 * The go-ahead for a build: what it costs in money and days, what the
 * payroll adds while the shop works, and what the calendar does to any
 * signed contract.
 */
export function BuildConfirm({ company, designKey }: { company: Company; designKey: string }) {
  const v = DESIGNS[designKey];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && game.cancelBuild();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!v) return null;

  const { cost, days } = vehicleCost(v);
  const payroll = days * COSTS.overheadPerDay;
  const total = cost + payroll;
  const after = company.cash - total;
  const ready = company.day + days;
  const stock = company.inventory[designKey] ?? 0;
  const missed = company.accepted
    .map((id) => company.board.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined && c.deadline < ready);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="build-title" onClick={(e) => e.target === e.currentTarget && game.cancelBuild()}>
      <div className="card" style={{ maxWidth: 480 }}>
        <h2 id="build-title">Build a {v.name}?</h2>
        <dl className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <dt>Build cost</dt>
            <dd>{money(cost)}</dd>
          </div>
          <div>
            <dt>Time in the shop</dt>
            <dd>{days} days</dd>
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
            <dt>Ready on</dt>
            <dd>day {ready}</dd>
          </div>
          <div>
            <dt>Cash after</dt>
            <dd className={after < 0 ? "bad" : undefined}>{money(after)}</dd>
          </div>
        </dl>
        {stock > 0 && (
          <span className="soft">
            You already have {stock} on the ground.
          </span>
        )}
        {missed.map((c) => (
          <span key={c.id} className="warn">
            "{c.title}" is due on day {c.deadline}. This build runs past it.
          </span>
        ))}
        {after < 0 && <span className="bad">That's more cash than the company has. Building it ends the run.</span>}
        <div className="actions">
          <button type="button" className="btn primary" autoFocus onClick={() => game.confirmBuild()}>
            Build · {money(cost)} · {days} days
          </button>
          <button type="button" className="btn" onClick={() => game.cancelBuild()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
