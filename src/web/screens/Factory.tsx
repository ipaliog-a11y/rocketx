import { LINE_COSTS, type Company } from "../../sim/company.ts";
import { REFURB, restackCost, type BoosterUnit } from "../../sim/fleet.ts";
import { Chip } from "../components/Bits.tsx";
import { game } from "../game.ts";
import { lineJob, refurbJob, restackJob, retireJob } from "../jobs.ts";
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
        {(company.boosters ?? []).length > 0 && <Boosters company={company} />}
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
                <span>
                  {company.designs[key]?.name ?? key}
                  {(company.stacked?.[key]?.length ?? 0) > 0 && <span className="muted"> · on {company.stacked![key]!.join(", ")}</span>}
                </span>
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

const STATUS: Record<BoosterUnit["status"], { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  flown: { label: "FLOWN · NEEDS THE HANGAR", tone: "warn" },
  refurbishing: { label: "IN THE HANGAR", tone: "muted" },
  ready: { label: "READY TO STACK", tone: "good" },
  stacked: { label: "STACKED", tone: "muted" },
  lost: { label: "LOST", tone: "bad" },
  retired: { label: "RETIRED", tone: "muted" },
};

/** The recoverable boosters: each serial, what it has flown, and what it needs next. */
function Boosters({ company }: { company: Company }) {
  const fleet = [...(company.boosters ?? [])].sort((a, b) => Number(a.status === "lost" || a.status === "retired") - Number(b.status === "lost" || b.status === "retired"));
  return (
    <div className="card stack" aria-label="Boosters">
      <strong style={{ fontSize: 18 }}>Boosters</strong>
      <span className="muted" style={{ fontSize: 14 }}>
        A booster that lands comes back here. Turn it around ({Math.round(REFURB.turnaround.share * 100)}% of its cost, {REFURB.turnaround.days} days) or overhaul it ({Math.round(REFURB.overhaul.share * 100)}%, {REFURB.overhaul.days} days, and you learn how worn it is), then stack a new upper stage on it.
      </span>
      <ul className="list" style={{ gap: 12 }}>
        {fleet.map((b) => {
          const design = company.designs[b.design];
          const booked = company.tasks.find((t) => t.spec.kind === "refurb" && t.spec.serial === b.serial);
          const status = booked ? STATUS.refurbishing : STATUS[b.status];
          const gone = b.status === "lost" || b.status === "retired";
          return (
            <li key={b.serial} className="stack" style={{ gap: 6, opacity: gone ? 0.6 : 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong className="mono">{b.serial}</strong>
                <span>{design?.name ?? b.design}</span>
                <span className="mono muted" style={{ fontSize: 13 }}>
                  {b.flights} flight{b.flights === 1 ? "" : "s"} · last day {b.lastFlight}
                </span>
                <span style={{ marginLeft: "auto" }}>
                  <Chip tone={status.tone}>{booked?.endDay !== undefined ? `HANGAR · DAY ${booked.endDay}` : status.label}</Chip>
                </span>
              </div>
              {b.inspected && !gone && (
                <span className="mono" style={{ fontSize: 13 }}>
                  Wear at overhaul, day {b.inspected.day}: {Math.round(b.inspected.share * 100)}% of its life{b.inspected.share >= 0.75 ? " ▲ NEAR THE END" : ""}
                </span>
              )}
              {!gone && !booked && design && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {b.status === "ready" && (
                    <button type="button" className="btn primary" onClick={() => game.schedule(restackJob(company, b.design, b.serial))}>
                      Stack a {design.name} · {money(restackCost(design).cost)}
                    </button>
                  )}
                  {b.status === "flown" && (
                    <button type="button" className="btn primary" onClick={() => game.schedule(refurbJob(company, b.serial, "turnaround"))}>
                      Turn around · {money(refurbJob(company, b.serial, "turnaround").cost)}
                    </button>
                  )}
                  {(b.status === "flown" || b.status === "ready") && (
                    <button type="button" className="btn" onClick={() => game.schedule(refurbJob(company, b.serial, "overhaul"))}>
                      Overhaul · {money(refurbJob(company, b.serial, "overhaul").cost)}
                    </button>
                  )}
                  {(b.status === "flown" || b.status === "ready") && (
                    <button type="button" className="btn" onClick={() => game.schedule(retireJob(b.serial))}>
                      Retire
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
