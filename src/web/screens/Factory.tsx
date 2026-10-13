import { LINE_COSTS, type Company } from "../../sim/company.ts";
import { Chip } from "../components/Bits.tsx";
import { game } from "../game.ts";
import { lineJob } from "../jobs.ts";
import { money } from "../format.ts";

/** The production lines: what each is building, what is queued, and what is ready on the ground. */
export function Factory({ company }: { company: Company }) {
  const job = lineJob(company);
  const ready = Object.entries(company.inventory).filter(([, n]) => n > 0);
  return (
    <div className="row">
      <section className="grow stack" aria-label="Production lines">
        {company.lines.map((free, i) => {
          const orders = company.orders.filter((o) => o.line === i).sort((a, b) => a.startDay - b.startDay);
          const current = orders.find((o) => o.startDay <= company.day);
          const settingUp = free > company.day && orders.length === 0;
          const next = orders.find((o) => o.startDay > company.day);
          const name = (key: string) => company.designs[key]?.name ?? key;
          return (
            <div key={i} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <strong style={{ fontSize: 18 }}>Line {i + 1}</strong>
                {current ? (
                  <Chip tone="warn">BUILDING</Chip>
                ) : next ? (
                  <Chip tone="muted">{`STARTS DAY ${next.startDay}`}</Chip>
                ) : settingUp ? (
                  <Chip tone="muted">{`SETTING UP · DAY ${free}`}</Chip>
                ) : (
                  <Chip tone="good">FREE</Chip>
                )}
              </div>
              {current && (
                <div className="stack" style={{ gap: 6 }}>
                  <span>
                    {name(current.design)} · rolls out on day {current.readyDay}
                  </span>
                  <div
                    className="bar"
                    role="progressbar"
                    aria-label={`${name(current.design)} build`}
                    aria-valuemin={current.startDay}
                    aria-valuemax={current.readyDay}
                    aria-valuenow={company.day}
                  >
                    <div className="fill" style={{ width: `${((company.day - current.startDay) / (current.readyDay - current.startDay)) * 100}%`, background: "var(--amber)" }} />
                  </div>
                  <span className="mono muted" style={{ fontSize: 13 }}>
                    day {current.startDay} → {current.readyDay} · {current.readyDay - company.day} days to go
                  </span>
                </div>
              )}
              {orders.filter((o) => o !== current).length > 0 && (
                <ul className="list" style={{ fontSize: 14 }}>
                  {orders
                    .filter((o) => o !== current)
                    .map((o, j) => (
                      <li key={j} className="soft">
                        Queued: {name(o.design)}, day {o.startDay} → {o.readyDay}
                      </li>
                    ))}
                </ul>
              )}
              {orders.length === 0 && !settingUp && <span className="muted">Waiting for an order. Order vehicles from Rockets › Design or a signed flight.</span>}
            </div>
          );
        })}
      </section>
      <aside className="side stack">
        <div className="card">
          <p className="label">On the ground</p>
          {ready.length === 0 && <span className="muted">Nothing built and waiting.</span>}
          <ul className="list">
            {ready.map(([key, n]) => (
              <li key={key}>
                <span className="mono" style={{ flex: "0 0 36px" }}>
                  {n} ×
                </span>
                <span>{company.designs[key]?.name ?? key}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <p className="label">Expand</p>
          {job ? (
            <>
              <span className="soft">
                Line {company.lines.length + 1}: {money(job.cost)}, ready {LINE_COSTS[company.lines.length - 1]!.days} days after you buy it.
                {company.lines.length === 1 ? " Two lines can keep up with a launch every month or so." : " Three lines can keep a constellation customer supplied."}
              </span>
              <button type="button" className="btn primary" onClick={() => game.schedule(job)}>
                Buy line {company.lines.length + 1} · {money(job.cost)}
              </button>
            </>
          ) : (
            <span className="muted">The site holds {company.lines.length} lines. That's all of them.</span>
          )}
        </div>
      </aside>
    </div>
  );
}
