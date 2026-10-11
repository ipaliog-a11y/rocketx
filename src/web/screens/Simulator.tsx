import { useEffect, useMemo, useRef, useState } from "react";
import type { Company } from "../../sim/company.ts";
import type { Contract } from "../../sim/contracts.ts";
import { withCapsule } from "../../sim/crew.ts";
import type { Mission } from "../../sim/mission.ts";
import { bestSteering, simulate, type SimFlight, type Simulation } from "../../sim/simulator.ts";
import type { Vehicle } from "../../sim/vehicle.ts";
import { LEO_300, SUBORBITAL_TEST } from "../../missions.ts";
import { Chip } from "../components/Bits.tsx";
import { DesignSelect } from "../components/BidParts.tsx";
import { game } from "../game.ts";
import { retuneJob, retuneTestJob, signedContracts } from "../jobs.ts";
import { km } from "../format.ts";
import { headline, Replay } from "./Flight.tsx";
import { COLORS } from "../palette.ts";

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
      <span className="muted">
        Fly a design on paper before you build or sign: free, instant, and nothing fails. It uses what tests measured and the drawings for the rest. Known failures are flagged,
        and the range shows the worst and best of what was never measured.
      </span>

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
            <span className="muted" style={{ fontSize: 13 }}>
              The simulator only shows it: the rocket flies its own steering until the office re-tunes it.
            </span>
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

      <Replay result={m.result} budget={budget} title="Replay of the modelled flight" ghosts={ghosts} autoplay={false} />

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
