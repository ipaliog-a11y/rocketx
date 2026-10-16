import type { Bid } from "../../sim/company.ts";
import { COSTS } from "../../sim/cost.ts";
import { Chip } from "./Bits.tsx";

/** Pieces of a bid shared by the board (before signing) and the launch page (after). */

export function Schedule({ day, deadline, b }: { day: number; deadline: number; b: Bid }) {
  const testing = Math.max(0, b.daysLeft - b.build.days - COSTS.padDays);
  return (
    <div className="sched">
      <span className="lbl">Schedule</span>
      <div className="sched-bar" role="img" aria-label={`Schedule: ${testing} days for tests, ${b.build.days} to build, ${COSTS.padDays} on the pad`}>
        {b.fitsSchedule ? (
          <>
            <i className="t" style={{ flex: `${testing} 1 0` }} />
            <i className="b" style={{ flex: `${b.build.days} 1 0` }} />
            <i className="p" style={{ flex: `${COSTS.padDays} 1 0` }} />
          </>
        ) : (
          <i className="x" style={{ flex: 1 }} />
        )}
      </div>
      <div className="scale mono">
        <span>D {day}</span>
        <span>{b.daysLeft} d to fly</span>
        <span>D {deadline}</span>
      </div>
      {b.fitsSchedule ? (
        <div className="sched-key mono">
          <span>
            <i className="t" />
            Tests {testing} d
          </span>
          <span>
            <i className="b" />
            Build {b.build.days} d
          </span>
          <span>
            <i className="p" />
            Pad {COSTS.padDays} d
          </span>
        </div>
      ) : (
        <span className="bad" style={{ fontSize: 14 }}>
          A {b.build.days}-day build and {COSTS.padDays} days on the pad no longer fit before the deadline.
        </span>
      )}
    </div>
  );
}

export function Findings({ b }: { b: Bid }) {
  return (
    <>
      {b.blockers.length > 0 && (
        <ul className="checklist" aria-label="Blockers">
          {b.blockers.map((t) => (
            <li key={t}>
              <span className="bad">▲</span>
              <span>{t}</span>
              <span className="mono bad">BLOCKS</span>
            </li>
          ))}
        </ul>
      )}
      {b.regimes.length > 0 && (
        <div className="sect">
          <span className="lbl">New regimes</span>
          <ul className="checklist">
            {b.regimes.map((r) => (
              <li key={r}>
                <span className="warn">△</span>
                <span>{r}</span>
                <span className="mono muted">NEW</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {b.unknowns.length > 0 && (
        <div className="sect">
          <span className="lbl">Flying on trust</span>
          <ul className="checklist">
            {b.unknowns.map((u) => (
              <li key={u.subject + u.text}>
                <span className="warn">?</span>
                <span>
                  {u.subject !== "Airframe" && <strong>{u.subject} </strong>}
                  {u.text}
                </span>
                <span className="mono warn">{u.subject === "Airframe" ? "AIRFRAME" : "ENGINE"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function Forecast({ b }: { b: Bid }) {
  return (
    <div className={`forecast ${b.forecast.delivers ? "ok" : "miss"}`}>
      <div className="forecast-head">
        <span className="lbl">Forecast from what's known</span>
        <span className={`stamp-tag ${b.forecast.delivers ? "held" : "caution"}`}>{b.forecast.delivers ? "DELIVERS" : "MISSES"}</span>
      </div>
      <span className="mono">{b.forecast.text}</span>
    </div>
  );
}

/** A design picker, with how many of each are built. */
export function DesignSelect({ label, value, onChange, designs, inventory }: { label: string; value: string; onChange: (key: string) => void; designs: Record<string, { name: string }>; inventory: Record<string, number> }) {
  return (
    <label className="stack" style={{ gap: 6 }}>
      <span className="lbl">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(designs).map(([key, d]) => (
          <option key={key} value={key}>
            {d.name}
            {(inventory[key] ?? 0) > 0 ? ` · ${inventory[key]} built` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A reusable design's booster for this flight: one that has flown or a new one, and whether the customer will fly on the first. */
export function BoosterNote({ b }: { b: Bid }) {
  const x = b.booster;
  if (!x) return null;
  return (
    <div className="sect">
      <div className="booster-line">
        <span className="lbl">Booster</span>
        <span className="mono">{x.serial ? `${x.serial} · flight ${x.flight}` : "NEW"}</span>
        {x.refusesFlown && <Chip tone="warn">NO FLOWN BOOSTERS</Chip>}
      </div>
      {x.note ? <span className="bad">{x.note}</span> : x.refusesFlown && <span className="soft">The customer wants a booster that hasn't flown until the company has a record of clean reflights.</span>}
    </div>
  );
}
