import { LINE_COSTS, type Company } from "../../sim/company.ts";
import { REFURB, restackCost, type BoosterUnit } from "../../sim/fleet.ts";
import { Chip } from "../components/Bits.tsx";
import { Info } from "../components/Info.tsx";
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
        <div className="card">
          <p className="label hdr-row">
            <span>Production lines</span>
            <span className="mono">{company.lines.length} LINE{company.lines.length === 1 ? "" : "S"}</span>
          </p>
          <ul className="part-rows">
            {company.lines.map((free, i) => {
              const orders = company.orders.filter((o) => o.line === i).sort((a, b) => a.startDay - b.startDay);
              const current = orders.find((o) => o.startDay <= company.day);
              const settingUp = free > company.day && orders.length === 0;
              const next = orders.find((o) => o.startDay > company.day);
              const queued = orders.filter((o) => o !== current);
              const name = (key: string) => company.designs[key]?.name ?? key;
              const tone = current ? "tone-action" : next || settingUp ? "" : "tone-good";
              return (
                <li key={i} className={`part-row ${tone}`}>
                  <span className="part-tag">L{i + 1}</span>
                  <div className="part-body">
                    {current ? (
                      <>
                        <span>{name(current.design)}</span>
                        <span
                          className="hairline"
                          role="progressbar"
                          aria-label={`${name(current.design)} build`}
                          aria-valuemin={current.startDay}
                          aria-valuemax={current.readyDay}
                          aria-valuenow={company.day}
                        >
                          <i style={{ width: `${((company.day - current.startDay) / (current.readyDay - current.startDay)) * 100}%` }} />
                        </span>
                        <span className="part-sub">
                          D {current.startDay} → {current.readyDay} · {current.readyDay - company.day} d to go
                        </span>
                      </>
                    ) : (
                      <span className="muted">{settingUp ? "Setting up the line." : orders.length === 0 ? "Waiting for an order from Rockets › Design or a signed flight." : "Idle until its next order starts."}</span>
                    )}
                    {queued.map((o, j) => (
                      <span key={j} className="part-sub">
                        QUEUED · {name(o.design)} · D {o.startDay} → {o.readyDay}
                      </span>
                    ))}
                  </div>
                  {current ? (
                    <Chip tone="warn">BUILDING</Chip>
                  ) : next ? (
                    <Chip tone="muted">{`STARTS D ${next.startDay}`}</Chip>
                  ) : settingUp ? (
                    <Chip tone="muted">{`SETTING UP · D ${free}`}</Chip>
                  ) : (
                    <Chip tone="good">FREE</Chip>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        {(company.boosters ?? []).length > 0 && <Boosters company={company} />}
      </section>
      <aside className="side stack">
        <div className="card">
          <p className="label">On the ground</p>
          {ready.length === 0 && <span className="muted">Nothing built and waiting.</span>}
          {ready.length > 0 && (
            <ul className="checklist">
              {ready.map(([key, n]) => (
                <li key={key}>
                  <span className="good">{n}×</span>
                  <span>{company.designs[key]?.name ?? key}</span>
                  <span className="mono muted">{(company.stacked?.[key]?.length ?? 0) > 0 ? `ON ${company.stacked![key]!.join(", ")}` : "READY"}</span>
                </li>
              ))}
            </ul>
          )}
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
                Buy line {company.lines.length + 1} <span className="note">{money(job.cost)}</span>
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
  flown: { label: "FLOWN · TO HANGAR", tone: "warn" },
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
    <div className="card" aria-label="Boosters">
      <p className="label hdr-row">
        <span className="with-icon">
          Boosters
          <Info label="About boosters">
            A booster that lands comes back here. Turn it around ({Math.round(REFURB.turnaround.share * 100)}% of its cost, {REFURB.turnaround.days} days) or overhaul it ({Math.round(REFURB.overhaul.share * 100)}%, {REFURB.overhaul.days} days, and you learn how worn it is), then stack a new upper stage on it.
          </Info>
        </span>
        <span className="mono">{fleet.filter((b) => b.status !== "lost" && b.status !== "retired").length} IN FLEET</span>
      </p>
      <ul className="part-rows">
        {fleet.map((b) => {
          const design = company.designs[b.design];
          const booked = company.tasks.find((t) => t.spec.kind === "refurb" && t.spec.serial === b.serial);
          const status = booked ? STATUS.refurbishing : STATUS[b.status];
          const gone = b.status === "lost" || b.status === "retired";
          const tone = gone ? "gone" : status.tone === "good" ? "tone-good" : status.tone === "warn" ? "tone-warn" : "";
          return (
            <li key={b.serial} className={`part-row ${tone}`}>
              <span className="part-tag">{b.serial}</span>
              <div className="part-body">
                <span>{design?.name ?? b.design}</span>
                <span className="part-sub">
                  {b.flights} FLIGHT{b.flights === 1 ? "" : "S"} · LAST D {b.lastFlight}
                </span>
                {b.inspected && !gone && (
                  <span className={`part-sub ${b.inspected.share >= 0.75 ? "warn" : ""}`}>
                    WEAR {Math.round(b.inspected.share * 100)}% AT OVERHAUL D {b.inspected.day}
                    {b.inspected.share >= 0.75 ? " ▲ NEAR THE END" : ""}
                  </span>
                )}
              </div>
              <Chip tone={status.tone}>{booked?.endDay !== undefined ? `HANGAR · D ${booked.endDay}` : status.label}</Chip>
              {!gone && !booked && design && (b.status === "ready" || b.status === "flown") && (
                <div className="part-verbs">
                  {b.status === "ready" && (
                    <button type="button" className="btn primary" onClick={() => game.schedule(restackJob(company, b.design, b.serial))}>
                      Stack a {design.name} <span className="note">{money(restackCost(design).cost)}</span>
                    </button>
                  )}
                  {b.status === "flown" && (
                    <button type="button" className="btn primary" onClick={() => game.schedule(refurbJob(company, b.serial, "turnaround"))}>
                      Turn around <span className="note">{money(refurbJob(company, b.serial, "turnaround").cost)}</span>
                    </button>
                  )}
                  <button type="button" className="btn" onClick={() => game.schedule(refurbJob(company, b.serial, "overhaul"))}>
                    Overhaul <span className="note">{money(refurbJob(company, b.serial, "overhaul").cost)}</span>
                  </button>
                  <button type="button" className="btn quiet" onClick={() => game.schedule(retireJob(b.serial))}>
                    Retire
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
