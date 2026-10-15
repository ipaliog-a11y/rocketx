import { useEffect, useMemo, useRef, useState } from "react";
import type { Company } from "../../sim/company.ts";
import type { Contract } from "../../sim/contracts.ts";
import { withCapsule } from "../../sim/crew.ts";
import type { Mission } from "../../sim/mission.ts";
import { bestSteering, simulate, type SimFlight, type Simulation } from "../../sim/simulator.ts";
import { DISPERSION_RUNS, runDispersions, type Dispersions } from "../../sim/dispersions.ts";
import { CAUSE_LABELS, type Cause } from "../../sim/control.ts";
import { FAILURE_LABELS, type FailureMode } from "../../sim/hardware.ts";
import type { Vehicle } from "../../sim/vehicle.ts";
import { LEO_300, SUBORBITAL_TEST } from "../../missions.ts";
import { Chip } from "../components/Bits.tsx";
import { DesignSelect } from "../components/BidParts.tsx";
import { game } from "../game.ts";
import { retuneJob, retuneTestJob, signedContracts } from "../jobs.ts";
import { km } from "../format.ts";
import { headline, Replay } from "./Flight.tsx";
import { COLORS } from "../palette.ts";
import { Info } from "../components/Info.tsx";

/** What a straight-up test flight has to reach to count as space, m. */
const SPACE = 100_000;

const WORST = COLORS.bad;
const BEST = COLORS.good;

export type SimFocus = { design?: string; contract?: string };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * The launch simulator: fly a design on paper before committing to it. Free
 * and instant, it uses only what tests have measured, nothing fails, and
 * failures already seen are flagged instead. Where something was never
 * measured, the worst and best cases fly too.
 */
export function Simulator({ company, focus }: { company: Company; focus?: SimFocus }) {
  const contracts = signedContracts(company);
  const [key, setKey] = useState(focus?.design && company.designs[focus.design] ? focus.design : Object.keys(company.designs)[0]!);
  const [target, setTarget] = useState<string>(focus?.contract && contracts.some((c) => c.id === focus.contract) ? focus.contract : "test");
  const design = company.designs[key]!;
  const contract = contracts.find((c) => c.id === target) ?? null;
  const turns = design.pitchProgram?.kind === "gravity-turn";
  const mission: Mission = contract?.mission ?? (turns ? LEO_300 : SUBORBITAL_TEST);
  const minApogee = contract ? contract.minApogee : mission.target ? undefined : SPACE;
  const crew = contract?.kind === "crew";
  const defaultPayload = contract ? contract.payloadMass : design.payloadMass;
  const [payload, setPayload] = useState(defaultPayload);
  const [steering, setSteering] = useState<"current" | "best">("current");
  const [range, setRange] = useState(true);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const best = useRef(new Map<string, Vehicle>());

  // A new design or target starts from its own payload and steering.
  useEffect(() => {
    setPayload(defaultPayload);
    setSteering("current");
  }, [key, target, defaultPayload]);

  const vehicle = useMemo<Vehicle>(() => (crew ? withCapsule(design) : { ...design, payloadMass: payload }), [design, payload, crew]);
  const canTune = turns && mission.target !== undefined;

  useEffect(() => {
    const cacheKey = `${key}|${mission.name}|${vehicle.payloadMass}|${company.day}`;
    const slow = steering === "best" && !best.current.has(cacheKey);
    setWorking(slow ? "Working out the best steering…" : "Simulating…");
    const timer = setTimeout(
      () => {
        try {
          let flown = vehicle;
          if (steering === "best" && canTune) {
            if (!best.current.has(cacheKey)) best.current.set(cacheKey, bestSteering(company.campaign, vehicle, mission));
            flown = best.current.get(cacheKey)!;
          }
          setSim(simulate(company.campaign, flown, mission, { minApogee, range }));
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
        setWorking(null);
      },
      slow ? 30 : 200,
    );
    return () => clearTimeout(timer);
    // company.day and the campaign change when tests land: the simulation follows what is known.
  }, [vehicle, mission, minApogee, range, steering, canTune, key, company, company.day]);

  const payloadMax = Math.max(2 * defaultPayload, defaultPayload + 1_000);

  return (
    <section className="stack" aria-label="Launch simulator" style={{ gap: 16 }}>
      <div className="card sim-controls">
        <DesignSelect label="Design" value={key} onChange={setKey} designs={company.designs} inventory={company.inventory} />
        <label className="stack" style={{ gap: 6 }}>
          <span className="soft">Flight</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="test">Test flight · {turns ? `LEO ${km(LEO_300.target!.apoapsis, 0)}` : "straight up to space"}</option>
            {contracts.map((c: Contract) => (
              <option key={c.id} value={c.id}>
                {c.title} · {c.payloadMass} kg
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 6 }}>
          <span className="soft">
            Payload · <span className="mono">{vehicle.payloadMass.toLocaleString("en-US")} kg</span>
            {crew ? " (capsule and tower)" : payload !== defaultPayload ? ` (${contract ? "contract" : "design"}: ${defaultPayload} kg)` : ""}
          </span>
          <input type="range" min={0} max={payloadMax} step={10} value={payload} disabled={crew} onChange={(e) => setPayload(Number(e.target.value))} />
        </label>
        <fieldset className="stack" style={{ gap: 6, border: 0, margin: 0, padding: 0 }}>
          <legend className="soft" style={{ padding: 0, marginBottom: 6 }}>
            Steering
          </legend>
          <span className="filter-chips">
            <button type="button" aria-pressed={steering === "current"} onClick={() => setSteering("current")}>
              As tuned now
            </button>
            <button type="button" aria-pressed={steering === "best"} disabled={!canTune} title={canTune ? undefined : "Straight up: nothing to steer"} onClick={() => setSteering("best")}>
              Best for this flight
            </button>
          </span>
        </fieldset>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={range} onChange={(e) => setRange(e.target.checked)} />
          <span>Show the range: worst and best cases of what isn't measured</span>
        </label>
      </div>

      {error && <div className="card alert">{error}</div>}
      {working && (
        <span className="muted" role="status">
          {working}
        </span>
      )}
      {sim && <Results company={company} sim={sim} designKey={key} contract={contract} steering={steering} canTune={canTune} />}
    </section>
  );
}

function outcomeText(f: SimFlight, minApogee?: number): string {
  if (minApogee !== undefined) return `apogee ${km(f.result.summary.apogee, 0)} against ${km(minApogee, 0)}`;
  return headline(f.result).text;
}

function Results({ company, sim, designKey, contract, steering, canTune }: { company: Company; sim: Simulation; designKey: string; contract: Contract | null; steering: "current" | "best"; canTune: boolean }) {
  const m = sim.modelled;
  const cases: SimFlight[] = [sim.worst, m, sim.best].filter((f): f is SimFlight => f !== undefined);
  const name = { worst: "Worst case", modelled: "As modelled", best: "Best case" } as const;
  const color = { worst: WORST, modelled: COLORS.data, best: BEST } as const;
  const ghosts = [
    ...(sim.worst ? [{ result: sim.worst.result, color: WORST, label: "Red dashes: worst case" }] : []),
    ...(sim.best ? [{ result: sim.best.result, color: BEST, label: "Green dashes: best case" }] : []),
  ];
  const budget = sim.vehicle.limits.maxDynamicPressure;
  const unmeasured = sim.isp.filter((k) => !k.measured);
  const [mc, setMc] = useState<{ done: number; result: Dispersions | null; runs: Dispersions["runs"] } | null>(null);
  const mcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A new simulation drops the old runs.
  useEffect(() => {
    setMc(null);
    return () => {
      if (mcTimer.current) clearTimeout(mcTimer.current);
    };
  }, [sim]);
  const canDisperse = !!(sim.vehicle.control || sim.vehicle.structure);
  const disperse = () => {
    const it = runDispersions(company.campaign, sim.vehicle, sim.mission, { minApogee: sim.minApogee });
    const runs: Dispersions["runs"] = [];
    setMc({ done: 0, result: null, runs });
    // One flight per tick, so the page keeps painting the progress.
    const tick = () => {
      const step = it.next();
      if (step.done) {
        setMc({ done: runs.length, result: step.value, runs: step.value.runs });
        mcTimer.current = null;
        return;
      }
      runs.push(step.value);
      setMc({ done: runs.length, result: null, runs: [...runs] });
      mcTimer.current = setTimeout(tick, 0);
    };
    mcTimer.current = setTimeout(tick, 30);
  };
  const mcGhosts = mc?.result
    ? mc.result.runs.map((r) => ({ result: r.result, color: r.lost ? WORST : COLORS.muted, label: r.lost ? "Red: dispersion runs lost" : "Grey: dispersion runs" }))
    : [];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card" style={{ gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <p className="label">Simulation · {sim.vehicle.name} · {sim.mission.name}</p>
          <span className="actions" style={{ gap: 6 }}>
            <Chip tone="muted">SIMULATION</Chip>
            <Chip tone={m.delivers ? "good" : "bad"}>{m.delivers ? "GETS THERE" : "FALLS SHORT"}</Chip>
          </span>
        </div>
        <ul className="list sim-cases">
          {cases.map((f) => (
            <li key={f.scenario}>
              <span className="sim-case-name">
                <span className="swatch" style={{ background: color[f.scenario] }} />
                {name[f.scenario]}
              </span>
              <span className={f.delivers ? "" : "bad"}>{outcomeText(f, sim.minApogee)}</span>
              <span className="mono soft">
                {f.spare !== null ? `≈ +${f.spare.toLocaleString("en-US")} kg spare` : sim.minApogee === undefined ? "no margin" : ""}
              </span>
            </li>
          ))}
        </ul>
        <span className="soft" style={{ fontSize: 14 }}>
          {m.spare !== null
            ? `As modelled, ${m.result.summary.propellantMargin.toFixed(0)} kg of propellant is left at shutdown: about ${m.spare.toLocaleString("en-US")} kg more payload would still get there.`
            : m.delivers
              ? "As modelled, it gets there."
              : "As modelled, it doesn't get there: lighten the payload, try the best steering, or change the design."}
          {sim.worst && !sim.worst.delivers && m.delivers ? " The worst case misses: what's unmeasured could cost the flight." : ""}
          {sim.worst?.delivers ? " Even the worst case gets there." : ""}
        </span>
        {steering === "best" && canTune && (
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => game.schedule(contract ? retuneJob(company, designKey, contract) : retuneTestJob(company, designKey, sim.mission))}
            >
              Re-tune the {sim.vehicle.name} to fly this
            </button>
            <Info label="About the best steering">The simulator only shows it: the rocket flies its own steering until the office re-tunes it.</Info>
          </div>
        )}
      </div>

      {sim.warnings.length > 0 && (
        <div className="card alert" style={{ gap: 6 }}>
          <p className="label bad">The real flight would meet these</p>
          <ul className="list" style={{ gap: 4 }}>
            {sim.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {canDisperse && <DispersionCard mc={mc} run={disperse} />}

      <Replay result={m.result} budget={budget} title="Replay of the modelled flight" ghosts={[...ghosts, ...mcGhosts]} autoplay={false} />

      <details className="card" open={unmeasured.length > 0 || sim.drag.source !== "tunnel"}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Where the range comes from</summary>
        <ul className="list" style={{ gap: 6, fontSize: 15 }}>
          {sim.isp.map((k) => (
            <li key={k.engine} style={{ display: "block" }}>
              <strong>{k.engine}</strong>{" "}
              <span className="soft">
                {k.measured ? `Isp measured: ${pct(k.model)} of the drawings.` : `Isp never measured: ${pct(k.lo)}–${pct(k.hi)} of the drawings. A firing on the test stand pins it down.`}
              </span>
            </li>
          ))}
          <li style={{ display: "block" }}>
            <strong>{sim.drag.shape}</strong>{" "}
            <span className="soft">
              {sim.drag.source === "tunnel"
                ? `Drag measured in the tunnel: ${pct(sim.drag.model.dragFactor)} of the hand curve.`
                : sim.drag.source === "cfd"
                  ? `Drag from CFD: ${pct(sim.drag.lo.dragFactor)}–${pct(sim.drag.hi.dragFactor)} of the hand curve. The subsonic tunnel measures it.`
                  : `Drag never measured: ${pct(sim.drag.lo.dragFactor)}–${pct(sim.drag.hi.dragFactor)} of the hand curve.`}{" "}
              {sim.drag.riseMeasured ? "Drag rise measured." : "Drag rise near Mach 1 unmeasured: the transonic tunnel shows it."}
            </span>
          </li>
        </ul>
      </details>

      {sim.unknowns.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>On trust · {sim.unknowns.length}</summary>
          <ul className="list" style={{ gap: 4, fontSize: 15 }}>
            {sim.unknowns.map((u, i) => (
              <li key={i} style={{ display: "block" }}>
                <strong>{u.subject}</strong> <span className="soft">{u.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const lossLabel = (k: string) => (k in CAUSE_LABELS ? CAUSE_LABELS[k as Cause] : k in FAILURE_LABELS ? FAILURE_LABELS[k as FailureMode] : k);

/** Monte Carlo dispersions: the flight in many days' wind, with what's untested drawn from its range. */
function DispersionCard({ mc, run }: { mc: { done: number; result: Dispersions | null; runs: Dispersions["runs"] } | null; run: () => void }) {
  const r = mc?.result;
  const busy = mc !== null && !r;
  return (
    <div className="card" style={{ gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <p className="label">
          Dispersions · {DISPERSION_RUNS} runs
          <Info label="About dispersions">
            The flight flown {DISPERSION_RUNS} times, each in a different day's wind, with whatever testing hasn't pinned down drawn from its range: the bending mode, slosh, the IMU's drift, an error in untested flight software, the real strength of shells never proof-tested. What's measured flies as measured. Unlike the runs above, failures count.
          </Info>
        </p>
        {r && <Chip tone={r.success >= 0.95 ? "good" : r.success >= 0.8 ? "warn" : "bad"}>{Math.round(r.success * 100)}% DELIVER</Chip>}
      </div>
      {!r && (
        <div className="actions" style={{ alignItems: "center" }}>
          <button type="button" className="btn" onClick={run} disabled={busy}>
            {busy ? `Run ${mc!.done} of ${DISPERSION_RUNS}…` : "Run dispersions"}
          </button>
          {busy && (
            <span role="progressbar" aria-valuemin={0} aria-valuemax={DISPERSION_RUNS} aria-valuenow={mc!.done} aria-label="Dispersion runs" style={{ flex: "1 1 120px", height: 4, background: "var(--line)", position: "relative" }}>
              <span style={{ position: "absolute", inset: 0, width: `${(mc!.done / DISPERSION_RUNS) * 100}%`, background: "var(--data, #5bb8e3)" }} />
            </span>
          )}
        </div>
      )}
      {r && (
        <>
          <ul className="list" style={{ gap: 4, fontSize: 15 }}>
            <li style={{ display: "block" }}>
              <strong>Delivered</strong> <span className="soft">{r.runs.filter((x) => x.delivers).length} of {r.runs.length} runs.</span>
            </li>
            {Object.keys(r.losses).length > 0 && (
              <li style={{ display: "block" }}>
                <strong className="bad">Lost</strong>{" "}
                <span className="soft">
                  {Object.entries(r.losses)
                    .map(([k, n]) => `${lossLabel(k)} ×${n}`)
                    .join(", ")}
                  .
                </span>
              </li>
            )}
            {r.effort.max > 0 && (
              <li style={{ display: "block" }}>
                <strong>Gimbal used</strong>{" "}
                <span className="soft">
                  typical {Math.round(r.effort.p50 * 100)}%, worst 1 in 20 {Math.round(r.effort.p95 * 100)}%, worst {Math.round(r.effort.max * 100)}%{r.effort.max > 1 ? " ▲ out of range" : ""}.
                </span>
              </li>
            )}
            {r.qAlphaBudget > 0 && (
              <li style={{ display: "block" }}>
                <strong>Side load q·α</strong>{" "}
                <span className="soft">
                  typical {(r.qAlpha.p50 / 1000).toFixed(1)}, worst 1 in 20 {(r.qAlpha.p95 / 1000).toFixed(1)}, worst {(r.qAlpha.max / 1000).toFixed(1)} kPa·° against a drawn {(r.qAlphaBudget / 1000).toFixed(1)}
                  {r.qAlpha.max > r.qAlphaBudget ? " ▲ over" : ""}.
                </span>
              </li>
            )}
            {r.reach.max > 0 && (
              <li style={{ display: "block" }}>
                <strong>{r.orbital ? "Perigee" : "Apogee"}</strong>{" "}
                <span className="soft">
                  {km(r.reach.p5, 0)} to {km(r.reach.p95, 0)} across nine runs in ten.
                </span>
              </li>
            )}
          </ul>
          <span className="soft" style={{ fontSize: 14 }}>
            The runs are drawn behind the replay below: grey delivered or flew on, red lost.
          </span>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={run}>
              Run again
            </button>
          </div>
        </>
      )}
    </div>
  );
}
