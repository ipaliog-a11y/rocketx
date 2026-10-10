import { useState } from "react";
import { fire, fixEngine, type Company } from "../../sim/company.ts";
import { COSTS } from "../../sim/cost.ts";
import { flowSeparates, type Engine } from "../../sim/engine.ts";
import { FAILURE_LABELS, type FailureMode } from "../../sim/hardware.ts";
import { FACILITIES, FIXES, HARDWARE_LOSS, type EngineKnowledge, type Facility } from "../../sim/teststand.ts";
import { burnTime } from "../../sim/vehicle.ts";
import { Chip, ProofBar } from "../components/Bits.tsx";
import { isVacuumBell, Nozzle } from "../components/Rocket.tsx";
import { DESIGNS, game } from "../game.ts";
import { money, pct } from "../format.ts";

type EngineUse = { engine: Engine; burn: number; upper: boolean; usedBy: string[] };

/** Every engine the company's designs use, with the longest burn any of them asks of it. */
function engineUses(): EngineUse[] {
  const uses = new Map<string, EngineUse>();
  for (const design of Object.values(DESIGNS)) {
    design.stages.forEach((stage, i) => {
      const u = uses.get(stage.engine.name) ?? { engine: stage.engine, burn: 0, upper: false, usedBy: [] };
      u.burn = Math.max(u.burn, burnTime(stage));
      u.upper ||= i > 0;
      if (!u.usedBy.includes(design.name)) u.usedBy.push(design.name);
      uses.set(stage.engine.name, u);
    });
  }
  return [...uses.values()];
}

/** When the stand last saw an open failure mode, seconds into the firing. */
function seenAt(known: EngineKnowledge | undefined, mode: FailureMode): number | undefined {
  if (!known?.open.includes(mode)) return undefined;
  return [...known.history].reverse().flatMap((r) => r.findings).find((f) => f.mode === mode)?.t;
}

function statusOf(known: EngineKnowledge | undefined, burn: number): { text: string; tone: "good" | "warn" | "bad" | "muted" } {
  if (!known || known.firings === 0) return { text: "NEVER FIRED", tone: "muted" };
  if (known.open.length > 0) return { text: known.open.map((m) => FAILURE_LABELS[m].toUpperCase()).join(" · "), tone: "bad" };
  if (known.provenDuration >= burn && known.measuredIspFactor !== null) return { text: "PROVEN", tone: "good" };
  return { text: "PARTLY PROVEN", tone: "warn" };
}

export function TestStand({ company }: { company: Company }) {
  const uses = engineUses();
  const [selected, setSelected] = useState(uses[0]!.engine.name);
  const use = uses.find((u) => u.engine.name === selected) ?? uses[0]!;

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Test stand</h1>
        <span className="muted">A firing proves only what it reaches. Bars show proven running against the longest flight burn.</span>
      </div>
      <div className="row">
        <section className="side stack" aria-label="Engines" style={{ flexBasis: 420 }}>
          {uses.map((u) => {
            const known = company.campaign.knowledge[u.engine.name];
            const st = statusOf(known, u.burn);
            const failedAt = (["combustion-instability", "burn-through"] as const).map((m) => seenAt(known, m)).find((t) => t !== undefined);
            const on = u.engine.name === use.engine.name;
            return (
              <button
                key={u.engine.name}
                type="button"
                onClick={() => setSelected(u.engine.name)}
                aria-pressed={on}
                className="card"
                style={{ textAlign: "left", cursor: "pointer", flexDirection: "row", alignItems: "center", gap: 16, borderColor: on ? "var(--amber)" : undefined, background: on ? "var(--selected)" : undefined }}
              >
                <Nozzle engine={u.engine} size={64} />
                <span className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: 18 }}>{u.engine.name}</strong>
                    <Chip tone={st.tone}>{st.text}</Chip>
                  </span>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {u.usedBy.join(" / ")} · {u.burn.toFixed(0)} s burn
                  </span>
                  <ProofBar
                    proven={known?.provenDuration ?? 0}
                    required={u.burn}
                    failedAt={failedAt}
                    label={`${(known?.provenDuration ?? 0).toFixed(1)} s proven of a ${u.burn.toFixed(0)} s burn`}
                  />
                </span>
              </button>
            );
          })}
        </section>
        <EngineDetail key={use.engine.name} company={company} use={use} />
      </div>
    </div>
  );
}

function EngineDetail({ company, use }: { company: Company; use: EngineUse }) {
  const { engine, burn } = use;
  const known = company.campaign.knowledge[engine.name];
  const [facility, setFacility] = useState<Facility>(use.upper || isVacuumBell(engine) ? "altitude" : "sea-level");
  const [duration, setDuration] = useState(Math.ceil((burn * 1.1) / 5) * 5);
  const spec = FACILITIES[facility];

  // Where would this firing stop, as far as the company knows?
  const stops: Array<[number, string]> = [];
  if (known?.open.includes("hard-start")) stops.push([0.3, "the known hard start"]);
  if (flowSeparates(engine, spec.ambient)) stops.push([2, `flow separation: this bell can't run against ${(spec.ambient / 1000).toFixed(0)} kPa`]);
  for (const mode of ["combustion-instability", "burn-through"] as const) {
    const t = seenAt(known, mode);
    if (t !== undefined && t < duration) stops.push([t, `the known ${FAILURE_LABELS[mode]} at ${t.toFixed(1)} s`]);
  }
  stops.sort((a, b) => a[0] - b[0]);
  const stop = stops[0];
  const runs = stop ? Math.min(stop[0], duration) : duration;
  const cost = spec.setup + spec.perSecond * runs;
  const last = known?.history.at(-1);
  const measured = known?.measuredIspFactor ?? null;

  return (
    <section className="grow stack" aria-label={`${engine.name} campaign`} style={{ gap: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 16px" }}>
        <h2 style={{ fontSize: 26 }}>{engine.name}</h2>
        <span className="muted">
          {(engine.thrustVac / 1000).toFixed(1)} kN vacuum · Isp {engine.ispVac} s on paper · rated {engine.ratedLife ?? 300} s · exit {(engine.exitPressure / 1000).toFixed(0)} kPa
        </span>
      </div>

      <div className="row" style={{ gap: 16 }}>
        <div className="card" style={{ flex: "1 1 200px" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Proven running
          </span>
          <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
            {(known?.provenDuration ?? 0).toFixed(1)} s <span className="muted" style={{ fontSize: 14 }}>of {burn.toFixed(0)} s</span>
          </span>
        </div>
        <div className="card" style={{ flex: "1 1 200px" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Isp against the drawings
          </span>
          <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
            {measured === null ? "not measured" : pct(measured - 1)}
          </span>
        </div>
        <div className="card" style={{ flex: "1 1 200px" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Vacuum running
          </span>
          <span style={{ fontSize: 18, fontWeight: 600 }}>{known?.altitudeTested ? "Measured in the cell" : use.upper ? "Never in vacuum" : "Not needed"}</span>
        </div>
      </div>

      {(known?.open ?? []).map((mode) => {
        const fix = FIXES[mode];
        const t = seenAt(known, mode);
        return (
          <div key={mode} className="card alert">
            <p className="label bad">
              Open · {FAILURE_LABELS[mode]}
              {t !== undefined ? ` at ${t.toFixed(1)} s` : ""}
            </p>
            {fix ? (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 20px" }}>
                <span style={{ flex: "1 1 260px" }}>
                  <strong>Fix: {fix.name}.</strong> <span className="soft">{fix.text} Earlier firings stop counting.</span>
                </span>
                <span className="mono soft">
                  {money(fix.cost)} · {fix.days} days
                </span>
                <button type="button" className="btn primary" onClick={() => game.act((c) => fixEngine(c, engine, mode))}>
                  Apply fix
                </button>
              </div>
            ) : (
              <span className="soft">This comes from the nozzle's shape. No stand fix: it needs a different bell.</span>
            )}
          </div>
        );
      })}

      <form className="card" onSubmit={(e) => e.preventDefault()} aria-label="Plan a firing">
        <p className="label">Plan a firing</p>
        <fieldset style={{ margin: 0, padding: 0, border: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <legend className="soft" style={{ marginBottom: 8 }}>
            Facility
          </legend>
          {(Object.keys(FACILITIES) as Facility[]).map((id) => {
            const f = FACILITIES[id];
            const on = facility === id;
            return (
              <label key={id} className="stack" style={{ gap: 4, padding: "10px 12px", border: `1px solid ${on ? "var(--amber)" : "var(--line)"}`, borderRadius: 4, background: on ? "var(--selected)" : undefined, cursor: "pointer" }}>
                <span style={{ fontWeight: 600 }}>
                  <input type="radio" name="facility" checked={on} onChange={() => setFacility(id)} style={{ marginRight: 8 }} />
                  {f.name.charAt(0).toUpperCase() + f.name.slice(1)}
                </span>
                <span className="muted" style={{ fontSize: 14 }}>
                  {(f.ambient / 1000).toFixed(f.ambient < 10_000 ? 0 : 1)} kPa back pressure
                </span>
                <span className="mono soft" style={{ fontSize: 13 }}>
                  ${f.setup}k + ${f.perSecond}k/s · {f.days} days
                </span>
              </label>
            );
          })}
        </fieldset>
        <label className="stack" style={{ gap: 8 }}>
          <span className="soft">Duration</span>
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input type="range" min={5} max={Math.ceil((burn * 1.6) / 5) * 5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ flex: 1 }} />
            <output className="mono" style={{ minWidth: 64, textAlign: "right", fontWeight: 600 }}>
              {duration} s
            </output>
          </span>
        </label>
        <ProofBar proven={runs} required={burn} label={`This firing would run ${runs.toFixed(1)} s of a ${burn.toFixed(0)} s flight burn`} />
        <span className={stop ? "bad" : duration >= burn ? "good" : "warn"}>
          {stop
            ? `Expect it to stop at ${stop[0].toFixed(1)} s: ${stop[1]}.`
            : duration >= burn
              ? `Covers the ${burn.toFixed(0)} s flight burn, if the hardware lives that long.`
              : `Proves at most ${duration} s of a ${burn.toFixed(0)} s burn.`}
        </span>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => game.act((c) => fire(c, engine, duration, facility))}>
            Fire · {money(cost)} · {spec.days} days
          </button>
          <span className="muted" style={{ fontSize: 14 }}>
            Plus {money(spec.days * COSTS.overheadPerDay)} payroll. If the engine fails: +{money(HARDWARE_LOSS.cost)} and {HARDWARE_LOSS.days} days for a new one.
          </span>
        </div>
      </form>

      {last && (
        <div className="card">
          <p className="label">Last firing</p>
          <pre className="report">{last.text}</pre>
        </div>
      )}
      {known && known.history.length > 1 && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Earlier firings ({known.history.length - 1})</summary>
          {[...known.history].reverse().slice(1).map((r, i) => (
            <pre key={i} className="report">
              {r.text}
            </pre>
          ))}
        </details>
      )}
    </section>
  );
}
