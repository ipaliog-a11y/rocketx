import type { Bid } from "../../sim/company.ts";
import { COSTS } from "../../sim/cost.ts";
import { Chip } from "./Bits.tsx";

/** Pieces of a bid shared by the board (before signing) and the launch page (after). */

export function Schedule({ day, deadline, b }: { day: number; deadline: number; b: Bid }) {
  const testing = Math.max(0, b.daysLeft - b.build.days - COSTS.padDays);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }} className="muted">
        <span>Day {day}</span>
        <span>{b.daysLeft} days to fly</span>
        <span>Day {deadline}</span>
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
  );
}

export function Findings({ b }: { b: Bid }) {
  return (
    <>
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
    </>
  );
}

export function Forecast({ b }: { b: Bid }) {
  return (
    <div className="stack" style={{ gap: 6, padding: "14px 16px", borderRadius: 4, background: "var(--raised)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <p className="label">Forecast from what's known</p>
        <Chip tone={b.forecast.delivers ? "good" : "warn"}>{b.forecast.delivers ? "DELIVERS" : "MISSES"}</Chip>
      </div>
      <span className="mono" style={{ fontSize: 16 }}>
        {b.forecast.text}
      </span>
    </div>
  );
}

/** A design picker, with how many of each are built. */
export function DesignSelect({ label, value, onChange, designs, inventory }: { label: string; value: string; onChange: (key: string) => void; designs: Record<string, { name: string }>; inventory: Record<string, number> }) {
  return (
    <label className="stack" style={{ gap: 6 }}>
      <span className="soft">{label}</span>
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
    <div className="stack" style={{ gap: 4 }}>
      <span>
        <strong>Booster</strong>{" "}
        <span className="soft">{x.serial ? `${x.serial}, its flight ${x.flight}` : "a new one"}</span>{" "}
        {x.refusesFlown && <Chip tone="warn">NO FLOWN BOOSTERS</Chip>}
      </span>
      {x.note ? <span className="bad">{x.note}</span> : x.refusesFlown && <span className="soft">The customer wants a booster that hasn't flown until the company has a record of clean reflights.</span>}
    </div>
  );
}
