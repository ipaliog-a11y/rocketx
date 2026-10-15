import { useEffect, useRef, useState } from "react";
import type { Company } from "../../sim/company.ts";
import { COSTS } from "../../sim/cost.ts";
import { flowSeparates, type Engine } from "../../sim/engine.ts";
import { FAILURE_LABELS, type FailureMode } from "../../sim/hardware.ts";
import { partKeys, partLabel } from "../../sim/parts.ts";
import { FACILITIES, FIXES, firingCost, fixQuote, hardwareLoss, runRate, RESTART_TEST, revisionLetter, START_CHECK, seenAt as seenAtKnown, type EngineKnowledge, type Facility } from "../../sim/teststand.ts";
import { burnTime } from "../../sim/vehicle.ts";
import { Chip, Facts, ProofBar, Tabs } from "../components/Bits.tsx";
import { isVacuumBell, Nozzle } from "../components/Rocket.tsx";
import { game } from "../game.ts";
import { fireJob, fixEngineJob } from "../jobs.ts";
import { money, pct } from "../format.ts";
import { EngineDesign } from "./EngineDesign.tsx";
import { Parts } from "./Parts.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { Tunnel } from "./Tunnel.tsx";
import type { Route } from "../nav.ts";
import { Info, Term } from "../components/Info.tsx";

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

type Tab = "engines" | "parts" | "shop" | "tunnel";

/** What each tab is for, behind the ⓘ beside the title. */
const TESTING_INTROS: Record<Tab, string> = {
  engines: "Fire engines on the sea-level stand or in the altitude cell. Each bar is proven running against the longest burn a design asks of that engine. Engines that share a part share what the stand learns about it.",
  parts: "Every engine is built from four parts: cycle, injector, cooling and nozzle. What tests learn lands on the part, so every engine built with it shares the knowledge, the faults and the fixes. Tap a part for its record and what it still needs.",
  shop: "The drawing board for engines. Select a part, set its parameter along its curve, and every readout follows the engine model. Commit makes the next revision; a released revision goes to the stand. Parts already in production keep what tests learned.",
  tunnel: "One shape per outer mould line: designs that share a shape share what the tunnel learns. CFD is cheap and half right; the subsonic tunnel measures drag; the transonic tunnel also sees the drag rise and buffet.",
};

/** An engine to open on the Engines tab, with a firing already planned: from the Parts page or a link elsewhere. */
export type Focus = { engine: string; facility?: Facility; seconds?: number; restart?: boolean; why?: string };

/**
 * Testing: everything the company doesn't know yet. Engines on the stands,
 * the parts they share, new engines from the shop, and shapes in the tunnel.
 */
export function TestStand({ company, route }: { company: Company; route: Route }) {
  const first = (["engines", "parts", "shop", "tunnel"] as const).find((t) => t === route.tab) ?? "engines";
  const [tab, setTab] = useState<Tab>(first);
  const [focus, setFocus] = useState<Focus | null>(
    route.engine ? { engine: route.engine, facility: route.facility, seconds: route.seconds, restart: route.restart, why: route.why } : null,
  );
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>
          Testing
          <Info label={`About ${tab === "engines" ? "the engines" : tab === "parts" ? "parts" : tab === "shop" ? "engine design" : "the wind tunnel"}`}>{TESTING_INTROS[tab]}</Info>
        </h1>
        <Tabs<Tab>
          label="Testing views"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setFocus(null);
          }}
          tabs={[
            ["engines", "Engines"],
            ["parts", "Parts"],
            ["shop", "Design"],
            ["tunnel", "Wind tunnel"],
          ]}
        />
      </div>
      {tab === "engines" && <Firing company={company} focus={focus} />}
      {tab === "shop" && (
        <EngineDesign
          company={company}
          show={(engine) => {
            setFocus({ engine });
            setTab("engines");
          }}
        />
      )}
      {tab === "parts" && (
        <Parts
          company={company}
          test={(f) => {
            setFocus(f);
            setTab("engines");
          }}
        />
      )}
      {tab === "tunnel" && <Tunnel company={company} design={route.design} />}
    </div>
  );
}

function Firing({ company, focus }: { company: Company; focus: Focus | null }) {
  const uses = engineUses(company);
  const [selected, setSelected] = useState(focus?.engine ?? uses[0]!.engine.name);
  // On a phone the engine's page opens over the list: when one is tapped, or when the Parts page sent us to one.
  const [sheet, setSheet] = useState(focus !== null);
  const use = uses.find((u) => u.engine.name === selected) ?? uses[0]!;

  return (
    <>
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
                onClick={() => {
                  setSelected(u.engine.name);
                  setSheet(true);
                }}
                aria-pressed={on}
                className="card pickable"
                style={{ textAlign: "left", cursor: "pointer", flexDirection: "row", alignItems: "center", gap: 12, padding: "10px 14px", color: "var(--text)", font: "inherit" }}
              >
                <Nozzle engine={u.engine} size={40} />
                <span className="stack" style={{ gap: 5, flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <strong style={{ fontSize: 17 }}>{u.engine.name}</strong>
                    <Chip tone={st.tone}>{st.text}</Chip>
                  </span>
                  <span className="muted" style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {u.usedBy.length > 0 ? `${u.usedBy[0]}${u.usedBy.length > 1 ? ` +${u.usedBy.length - 1}` : ""} · ${u.burn.toFixed(0)} s burn` : `No design flies it · ${u.burn.toFixed(0)} s rated`}
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
        <Sheet open={sheet} onClose={() => setSheet(false)} title={use.engine.name}>
          <EngineDetail key={use.engine.name} company={company} use={use} plan={focus?.engine === use.engine.name ? focus : undefined} />
        </Sheet>
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

function EngineDetail({ company, use, plan }: { company: Company; use: EngineUse; plan?: Focus }) {
  const { engine, burn } = use;
  const known = company.campaign.knowledge[engine.name];
  const [facility, setFacility] = useState<Facility>(plan?.facility ?? (use.upper || isVacuumBell(engine) ? "altitude" : "sea-level"));
  const [duration, setDuration] = useState(plan?.seconds ?? Math.ceil((burn * 1.1) / 5) * 5);
  const [restartWanted, setRestart] = useState(plan?.restart ?? false);
  const longest = Math.max(Math.ceil((burn * 1.6) / 5) * 5, plan?.seconds ?? 0);
  // Arriving from the Parts page: bring the planned firing on screen.
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    const at = top.current?.getBoundingClientRect().top;
    if (plan && at !== undefined && (at < 0 || at > window.innerHeight * 0.6)) top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [plan]);
  const spec = FACILITIES[facility];
  const restart = restartWanted && facility === "altitude";

  // Where would this firing stop, as far as the company knows?
  const stops: Array<[number, string]> = [];
  if (known?.open.includes("hard-start")) stops.push([0.3, "the known hard start"]);
  // A vacuum bell on the sea-level stand only gets a start check.
  const startCheck = flowSeparates(engine, spec.ambient);
  const planned = startCheck ? START_CHECK : duration;
  for (const mode of ["combustion-instability", "burn-through"] as const) {
    const t = seenAt(known, mode);
    if (t !== undefined && t < planned) stops.push([t, `the known ${FAILURE_LABELS[mode]} at ${t.toFixed(1)} s`]);
  }
  stops.sort((a, b) => a[0] - b[0]);
  const stop = stops[0];
  const runs = stop ? Math.min(stop[0], planned) : planned;
  const cost = firingCost(engine, facility, runs, restart);
  const days = spec.days + (restart ? RESTART_TEST.days : 0);
  const last = known?.history.at(-1);
  const measured = known?.measuredIspFactor ?? null;

  return (
    <section ref={top} className="grow stack" aria-label={`${engine.name} campaign`} style={{ gap: 18, scrollMarginTop: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 16px" }}>
        <h2 style={{ fontSize: 26 }}>{engine.name}</h2>
        <span className="muted" style={{ fontSize: 14 }}>
          {(engine.thrustVac / 1000).toFixed(1)} kN · Isp {engine.ispVac} s · rated {engine.ratedLife ?? 300} s · exit {(engine.exitPressure / 1000).toFixed(0)} kPa
        </span>
        {engine.parts && <PartLine company={company} engine={engine} />}
        <span className="muted" style={{ fontSize: 13 }}>
          {use.usedBy.length > 0 ? `Flies on ${use.usedBy.join(", ")}` : "No design flies it yet"}
        </span>
      </div>
      {plan?.why && (
        <div className="card" role="note" style={{ borderColor: "var(--cyan)" }}>
          <span>
            <span className="label">From the Parts page</span> {plan.why} The firing below is set up for it.
          </span>
        </div>
      )}

      <Facts
        items={[
          ["Proven", `${(known?.provenDuration ?? 0).toFixed(0)} / ${burn.toFixed(0)} s`],
          [<><Term id="isp">Isp</Term> vs drawings</>, measured === null ? "—" : pct(measured - 1)],
          ["Vacuum", known?.altitudeTested ? "measured" : use.upper ? "never" : "not needed"],
          ...(use.upper
            ? [["Relight", known?.open.includes("relight-failure") ? "fails" : known?.relightProven ? "proven" : "never tried"] as [string, string]]
            : []),
        ]}
      />

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
                  <strong>Fix: {fix.name}.</strong> <span className="soft">{fix.text}</span>{" "}
                  <span className="muted">{engine.parts ? "Fixes every engine with the part; its proof starts over." : "Earlier firings stop counting."}</span>
                </span>
                <span className="mono soft">
                  {money(fixQuote(mode, engine).cost)} · {fixQuote(mode, engine).days} days
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
        <fieldset style={{ margin: 0, padding: 0, border: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <legend className="sr-only">Facility</legend>
          {(Object.keys(FACILITIES) as Facility[]).map((id) => {
            const f = FACILITIES[id];
            const on = facility === id;
            return (
              <label
                key={id}
                className={`stack pick-tile pickable ${on ? "on" : ""}`}
                title={`${(f.ambient / 1000).toFixed(f.ambient < 10_000 ? 0 : 1)} kPa back pressure`}
                style={{ gap: 2, padding: "8px 10px", borderRadius: 4, cursor: "pointer" }}
              >
                <span style={{ fontWeight: 600 }}>
                  <input type="radio" name="facility" checked={on} onChange={() => setFacility(id)} style={{ marginRight: 6 }} />
                  {f.name.charAt(0).toUpperCase() + f.name.slice(1)}
                </span>
                <span className="mono soft" style={{ fontSize: 12 }}>
                  {f.days} days
                  <br />${f.setup}k + ${runRate(engine, id)}k/s
                </span>
                {flowSeparates(engine, f.ambient) && (
                  <span className="warn" style={{ fontSize: 13 }}>
                    Start check only
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>
        {startCheck ? (
          <div className="stack" style={{ gap: 4 }}>
            <span className="soft">Duration</span>
            <span>
              <strong className="mono">{START_CHECK} s</strong>{" "}
              <span className="soft">Lit and shut down before the bell's flow separates: a start check only.</span>
            </span>
          </div>
        ) : (
          <label className="stack" style={{ gap: 8 }}>
            <span className="soft">Duration</span>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="range" min={5} max={longest} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ flex: 1 }} />
              <output className="mono" style={{ minWidth: 64, textAlign: "right", fontWeight: 600 }}>
                {duration} s
              </output>
            </span>
          </label>
        )}
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", opacity: facility === "altitude" ? 1 : 0.5 }}>
          <input type="checkbox" checked={restart} disabled={facility !== "altitude"} onChange={(e) => setRestart(e.target.checked)} />
          <span className="soft">
            Restart test: relight in vacuum, as after a coast.
            {facility !== "altitude" && <span className="muted"> Altitude cell only.</span>}
            {known?.relightProven ? <span className="good"> Already proven.</span> : ""}
          </span>
        </label>
        <ProofBar proven={runs} required={burn} label={`This firing would run ${runs.toFixed(1)} s of a ${burn.toFixed(0)} s flight burn`} />
        <span className={stop ? "bad" : startCheck ? "warn" : duration >= burn ? "good" : "warn"}>
          {stop
            ? `Expect it to stop at ${stop[0].toFixed(1)} s: ${stop[1]}.`
            : startCheck
              ? `A start check proves the engine lights, not the ${burn.toFixed(0)} s burn.`
              : duration >= burn
              ? `Covers the ${burn.toFixed(0)} s flight burn, if the hardware lives that long.`
              : `Proves at most ${duration} s of a ${burn.toFixed(0)} s burn.`}
        </span>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => game.schedule(fireJob(engine, planned, facility, runs, restart))}>
            {startCheck ? "Start check" : restart ? "Fire and restart" : "Fire"} · {money(cost)} · {days} days
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            +{money(days * COSTS.overheadPerDay)} payroll · a lost engine costs {money(hardwareLoss(engine).cost)} and {hardwareLoss(engine).days} d
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
