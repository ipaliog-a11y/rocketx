import { useState } from "react";
import type { Company } from "../../sim/company.ts";
import { COSTS } from "../../sim/cost.ts";
import { flowSeparates, type Engine } from "../../sim/engine.ts";
import { FAILURE_LABELS, type FailureMode } from "../../sim/hardware.ts";
import { partKeys, partLabel } from "../../sim/parts.ts";
import { FACILITIES, FIXES, HARDWARE_LOSS, revisionLetter, seenAt as seenAtKnown, type EngineKnowledge, type Facility } from "../../sim/teststand.ts";
import { burnTime } from "../../sim/vehicle.ts";
import { Chip, ProofBar, Tabs } from "../components/Bits.tsx";
import { isVacuumBell, Nozzle } from "../components/Rocket.tsx";
import { game } from "../game.ts";
import { fireJob, fixEngineJob } from "../jobs.ts";
import { money, pct } from "../format.ts";
import { EngineShop } from "./EngineShop.tsx";
import { Parts } from "./Parts.tsx";

type EngineUse = { engine: Engine; burn: number; upper: boolean; usedBy: string[] };

/**
 * Every engine the company has, with the longest burn any design asks of it.
 * An engine no design flies yet is planned against its rated life.
 */
function engineUses(company: Company): EngineUse[] {
  const uses = new Map<string, EngineUse>();
  for (const design of Object.values(company.designs)) {
    design.stages.forEach((stage, i) => {
      const u = uses.get(stage.engine.name) ?? { engine: stage.engine, burn: 0, upper: false, usedBy: [] };
      u.burn = Math.max(u.burn, burnTime(stage));
      u.upper ||= i > 0;
      if (!u.usedBy.includes(design.name)) u.usedBy.push(design.name);
      uses.set(stage.engine.name, u);
    });
  }
  for (const engine of Object.values(company.campaign.engines)) {
    if (!uses.has(engine.name)) uses.set(engine.name, { engine, burn: engine.ratedLife ?? 120, upper: engine.exitPressure < 40_000, usedBy: [] });
  }
  return [...uses.values()];
}

/** When an open failure mode shows up, seconds into the firing: seen on this engine or on one sharing the part. */
const seenAt = (known: EngineKnowledge | undefined, mode: FailureMode): number | undefined => seenAtKnown(known, mode);

function statusOf(known: EngineKnowledge | undefined, burn: number): { text: string; tone: "good" | "warn" | "bad" | "muted" } {
  if (known && known.open.length > 0) return { text: known.open.map((m) => FAILURE_LABELS[m].toUpperCase()).join(" · "), tone: "bad" };
  const inherited = known !== undefined && (known.startupProven || known.provenDuration > 0);
  if (!known || (known.firings === 0 && !inherited)) return { text: "NEVER FIRED", tone: "muted" };
  if (known.provenDuration >= burn && known.measuredIspFactor !== null) return { text: "PROVEN", tone: "good" };
  return { text: "PARTLY PROVEN", tone: "warn" };
}

type Tab = "firing" | "shop" | "parts";

export function TestStand({ company }: { company: Company }) {
  const [tab, setTab] = useState<Tab>("firing");
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Test stand</h1>
        <Tabs<Tab>
          label="Test stand views"
          value={tab}
          onChange={setTab}
          tabs={[
            ["firing", "Firing"],
            ["shop", "Engine shop"],
            ["parts", "Parts"],
          ]}
        />
      </div>
      {tab === "firing" && <Firing company={company} />}
      {tab === "shop" && <EngineShop company={company} done={() => setTab("firing")} />}
      {tab === "parts" && <Parts company={company} />}
    </div>
  );
}

function Firing({ company }: { company: Company }) {
  const uses = engineUses(company);
  const [selected, setSelected] = useState(uses[0]!.engine.name);
  const use = uses.find((u) => u.engine.name === selected) ?? uses[0]!;

  return (
    <>
      <span className="muted">A firing proves only what it reaches. Bars show proven running against the longest flight burn. Engines that share a part share what the stand learns about it.</span>
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
                    {u.usedBy.length > 0 ? `${u.usedBy.join(" / ")} · ${u.burn.toFixed(0)} s burn` : `No design flies it yet · ${u.burn.toFixed(0)} s rated`}
                  </span>
                  {u.engine.parts && <PartLine company={company} engine={u.engine} />}
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
    </>
  );
}

/** The engine's parts in one line, with their revisions. */
function PartLine({ company, engine }: { company: Company; engine: Engine }) {
  const keys = partKeys(engine.parts!);
  return (
    <span className="soft" style={{ fontSize: 13 }}>
      {Object.values(keys)
        .map((k) => {
          const rev = company.campaign.parts[k]?.revision ?? 0;
          return `${partLabel(k).split(" · ")[0]}${rev > 0 ? ` ${revisionLetter(rev)}` : ""}`;
        })
        .join(" · ")}
    </span>
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
                  <strong>Fix: {fix.name}.</strong> <span className="soft">{fix.text} {engine.parts ? "A new revision of the part: every engine built with it gets the fix, and what was proven about that part has to be proven again." : "Earlier firings stop counting."}</span>
                </span>
                <span className="mono soft">
                  {money(fix.cost)} · {fix.days} days
                </span>
                <button type="button" className="btn primary" onClick={() => game.schedule(fixEngineJob(engine, mode))}>
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
          <button type="button" className="btn primary" onClick={() => game.schedule(fireJob(engine, duration, facility, runs))}>
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
