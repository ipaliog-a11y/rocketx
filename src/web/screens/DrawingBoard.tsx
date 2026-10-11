import { useState } from "react";
import { assembleVehicle, checkVehicle, designQuote, DIAMETERS, figures, maxEngines, specOf, stageRole, type VehicleSpec } from "../../sim/builder.ts";
import { posted, type Company } from "../../sim/company.ts";
import { vehicleCost } from "../../sim/cost.ts";
import { suggestBuilds, type Goal, type Suggestion } from "../../sim/guide.ts";
import { burnTime } from "../../sim/vehicle.ts";
import { circular, escape, gto, highCircular, lunar, SSO_500, SUBORBITAL_TEST } from "../../missions.ts";
import { Chip, Facts } from "../components/Bits.tsx";
import { height, Rocket } from "../components/Rocket.tsx";
import { game } from "../game.ts";
import { designJob } from "../jobs.ts";
import { money } from "../format.ts";

/** Orbits the guide can size for without a contract. */
const CUSTOM_ORBITS = [
  { id: "250/28.5", label: "LEO 250 km, 28.5°", mission: circular(250, 28.5) },
  { id: "300/28.5", label: "LEO 300 km, 28.5°", mission: circular(300, 28.5) },
  { id: "400/28.5", label: "LEO 400 km, 28.5°", mission: circular(400, 28.5) },
  { id: "350/40", label: "LEO 350 km, 40°", mission: circular(350, 40) },
  { id: "400/51.6", label: "LEO 400 km, 51.6° (station orbit)", mission: circular(400, 51.6) },
  { id: "sso", label: "SSO 500 km, 97.4°", mission: SSO_500 },
  { id: "nav", label: "1,200 km circular, 55° (relights)", mission: highCircular(1_200, 55) },
  { id: "gto", label: "Geostationary transfer (relights)", mission: gto() },
  { id: "tli", label: "Trans-lunar injection (relights)", mission: lunar() },
  { id: "c3", label: "Escape, C3 10 (relights)", mission: escape(10) },
];

const fit = (v: ReturnType<typeof assembleVehicle>, px: number) => Math.min(30, px / height(v));

export function DrawingBoard({ company, drawn }: { company: Company; drawn: (key: string) => void }) {
  const [spec, setSpec] = useState<VehicleSpec>(() => ({ ...specOf(company.designs.meridian ?? Object.values(company.designs)[0]!), name: "" }));
  const engines = company.campaign.engines;
  const names = Object.values(company.designs).map((d) => d.name);
  const check = checkVehicle(spec, engines, names);
  const blocked = check.problems.some((p) => /no engine|isn't a diameter|one or two stages/.test(p));
  const vehicle = blocked ? null : assembleVehicle(spec, engines);
  const f = vehicle ? figures(vehicle) : null;
  const build = vehicle ? vehicleCost(vehicle) : null;
  const quote = designQuote(spec, Object.values(company.designs));
  const engineList = Object.values(engines);

  const setStage = (i: number, change: Partial<VehicleSpec["stages"][number]>) =>
    setSpec({ ...spec, stages: spec.stages.map((s, j) => (j === i ? { ...s, ...change } : s)) });

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Guide company={company} use={(s) => setSpec({ ...s.spec, name: spec.name })} />
      <div className="row">
        <section className="grow stack" aria-label="Design" style={{ gap: 16 }}>
          <div className="actions">
            <label className="stack" style={{ gap: 4, flex: "2 1 220px" }}>
              <span className="soft">Name</span>
              <input className="name-input" style={{ fontSize: 18 }} value={spec.name} maxLength={30} placeholder="Name the design" onChange={(e) => setSpec({ ...spec, name: e.target.value })} />
            </label>
            <label className="stack" style={{ gap: 4, flex: "1 1 180px" }}>
              <span className="soft">Start from</span>
              <select value="" onChange={(e) => e.target.value && setSpec({ ...specOf(company.designs[e.target.value]!), name: spec.name })}>
                <option value="">Copy a design…</option>
                {Object.entries(company.designs).map(([k, d]) => (
                  <option key={k} value={k}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {spec.stages.map((s, i) => {
            const engine = engines[s.engine];
            const max = engine ? maxEngines(engine, s.diameter) : 1;
            const role = stageRole(spec.stages.length, i);
            const label = role.charAt(0).toUpperCase() + role.slice(1);
            return (
              <fieldset key={i} className="card stage-editor">
                <legend className="label">{label}</legend>
                <div className="editor-grid">
                  <label>
                    <span>Diameter</span>
                    <select value={s.diameter} onChange={(e) => setStage(i, { diameter: Number(e.target.value) })}>
                      {DIAMETERS.map((d) => (
                        <option key={d} value={d}>
                          {d} m
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Engine</span>
                    <select value={s.engine} onChange={(e) => setStage(i, { engine: e.target.value })}>
                      {engineList.map((e) => (
                        <option key={e.name} value={e.name}>
                          {e.name} · {(e.thrustVac / 1000).toFixed(1)} kN · {e.ispVac} s
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="stepper">
                    <span>Engines</span>
                    <span className="actions" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <button type="button" className="btn" aria-label="One engine fewer" disabled={s.engineCount <= 1} onClick={() => setStage(i, { engineCount: s.engineCount - 1 })}>
                        −
                      </button>
                      <output className="mono" style={{ minWidth: 36, textAlign: "center", fontWeight: 600 }}>
                        {s.engineCount}
                      </output>
                      <button type="button" className="btn" aria-label="One engine more" disabled={s.engineCount >= max} onClick={() => setStage(i, { engineCount: s.engineCount + 1 })}>
                        +
                      </button>
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      up to {max}
                    </span>
                  </div>
                </div>
                <label className="stack" style={{ gap: 6 }}>
                  <span className="soft">
                    Tank length <span className="mono">{s.tankLength.toFixed(1)} m</span>
                    {vehicle && <span className="muted"> · {vehicle.stages[i]!.propellantMass.toLocaleString("en-US")} kg propellant · {burnTime(vehicle.stages[i]!).toFixed(0)} s burn</span>}
                  </span>
                  <input type="range" min={0.5} max={20} step={0.5} value={s.tankLength} onChange={(e) => setStage(i, { tankLength: Number(e.target.value) })} />
                </label>
              </fieldset>
            );
          })}
          <div className="actions">
            {spec.stages.length < 3 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  // An upper stage gets a vacuum engine; a kick stage prefers a storable one, which restarts reliably.
                  const vac = engineList.find((e) => e.exitPressure < 20_000) ?? engineList[0]!;
                  const kick = engineList.find((e) => e.parts?.cycle === "storable") ?? vac;
                  const below = spec.stages.at(-1)!;
                  const added = spec.stages.length === 1 ? { diameter: below.diameter, tankLength: 2, engine: vac.name, engineCount: 1 } : { diameter: below.diameter, tankLength: 1, engine: kick.name, engineCount: 1 };
                  setSpec({ ...spec, stages: [...spec.stages, added] });
                }}
              >
                {spec.stages.length === 1 ? "Add an upper stage" : "Add a kick stage"}
              </button>
            )}
            {spec.stages.length > 1 && (
              <button type="button" className="btn" onClick={() => setSpec({ ...spec, stages: spec.stages.slice(0, -1) })}>
                Remove the {stageRole(spec.stages.length, spec.stages.length - 1)}
              </button>
            )}
            <label className="actions" style={{ gap: 8 }}>
              <span className="soft">Fairing</span>
              <select value={spec.fairingDiameter} onChange={(e) => setSpec({ ...spec, fairingDiameter: Number(e.target.value) })}>
                {DIAMETERS.map((d) => (
                  <option key={d} value={d}>
                    {d} m
                  </option>
                ))}
              </select>
            </label>
            <label className="actions" style={{ gap: 8 }}>
              <span className="soft">Payload</span>
              <input type="number" min={0} step={10} value={spec.payloadMass} onChange={(e) => setSpec({ ...spec, payloadMass: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 96 }} />
              <span className="muted">kg</span>
            </label>
          </div>
        </section>

        <aside className="side card" aria-label="The design on paper">
          <p className="label">On paper</p>
          <div style={{ display: "flex", gap: 18, alignItems: "flex-end" }}>
            {vehicle && (
              <div className="blueprint" style={{ borderRadius: 4, padding: "12px 16px 0", flex: "0 0 auto" }}>
                <Rocket vehicle={vehicle} scale={fit(vehicle, 260)} />
              </div>
            )}
            {f && build && (
              <Facts
                items={[
                  ["Liftoff mass", `${Math.round(f.liftoffMass).toLocaleString("en-US")} kg`],
                  ["Liftoff T/W", <span className={f.liftoffTW < 1.2 ? "bad" : undefined}>{f.liftoffTW.toFixed(2)}</span>],
                  ["Δv", `${(f.totalDeltaV / 1000).toFixed(2)} km/s`],
                  ...(f.deltaV.length > 1 ? [["Per stage", f.deltaV.map((d) => (d / 1000).toFixed(2)).join(" + ")] as [string, string]] : []),
                  ["Build", `${money(build.cost)} · ${build.days} d`],
                ]}
              />
            )}
          </div>
          <span className="muted" style={{ fontSize: 14 }}>
            Orbit from Port Avery takes about 9.5 km/s at 300 km, geostationary transfer about 11.5, escape about 12.5; a sounding flight to 100 km about 2.2.
          </span>
          {check.problems.map((p) => (
            <span key={p} className="bad">
              {p}
            </span>
          ))}
          {check.warnings.map((w) => (
            <span key={w} className="warn">
              {w}
            </span>
          ))}
          <div className="stack" style={{ gap: 4 }}>
            <span>
              Drawing it up: <strong className="mono">{money(quote.cost)}</strong> and <strong className="mono">{quote.days} days</strong>
            </span>
            <span className="muted" style={{ fontSize: 14 }}>
              {quote.newTanks.length === 0 && !quote.newFairing
                ? "The shop already has the tooling."
                : `New tooling: ${[...quote.newTanks.map((d) => `${d} m tanks`), ...(quote.newFairing ? [`${spec.fairingDiameter} m fairing`] : [])].join(", ")}.`}
            </span>
          </div>
          <div className="actions">
            <button type="button" className="btn primary" disabled={check.problems.length > 0} onClick={() => game.schedule(designJob(spec, quote, drawn))}>
              Draw it up · {money(quote.cost)} · {quote.days} d
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The guide: say what the rocket is for, and get three sized designs from the engines the company has. */
function Guide({ company, use }: { company: Company; use: (s: Suggestion) => void }) {
  const work = posted(company).filter((c) => !company.closed[c.id] && company.day <= c.deadline && c.kind !== "crew");
  const [source, setSource] = useState<string>(work[0]?.id ?? "custom");
  const [orbit, setOrbit] = useState("300/28.5");
  const [suborbital, setSuborbital] = useState(false);
  const [apogee, setApogee] = useState(120);
  const [payload, setPayload] = useState(150);
  const [results, setResults] = useState<Suggestion[] | null>(null);
  const [thinking, setThinking] = useState(false);

  const goal = (): Goal => {
    const c = work.find((x) => x.id === source);
    if (c) return { mission: c.mission, payloadMass: c.payloadMass, minApogee: c.minApogee };
    if (suborbital) return { mission: SUBORBITAL_TEST, payloadMass: payload, minApogee: apogee * 1000 };
    return { mission: CUSTOM_ORBITS.find((o) => o.id === orbit)!.mission, payloadMass: payload };
  };

  const run = () => {
    setThinking(true);
    setResults(null);
    // Let the button show it's working before the search ties up the page for a moment.
    setTimeout(() => {
      setResults(suggestBuilds(goal(), company.campaign.engines, Object.values(company.designs)));
      setThinking(false);
    }, 30);
  };

  return (
    <details className="card guide" open>
      <summary style={{ cursor: "pointer" }}>
        <span className="label">Guide</span> <span className="soft">What is it for? Get three designs sized from your engines.</span>
      </summary>
      <div className="actions" style={{ alignItems: "flex-end" }}>
        <label className="stack" style={{ gap: 4, flex: "2 1 260px" }}>
          <span className="soft">Job</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {work.map((c) => (
              <option key={c.id} value={c.id}>
                {company.accepted.includes(c.id) ? "Signed · " : ""}
                {c.title}
              </option>
            ))}
            <option value="custom">Something else…</option>
          </select>
        </label>
        {source === "custom" && (
          <>
            <label className="stack" style={{ gap: 4, flex: "1 1 220px" }}>
              <span className="soft">Where</span>
              <select value={suborbital ? "sub" : orbit} onChange={(e) => (e.target.value === "sub" ? setSuborbital(true) : (setSuborbital(false), setOrbit(e.target.value)))}>
                <option value="sub">Suborbital, straight up</option>
                {CUSTOM_ORBITS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {suborbital && (
              <label className="stack" style={{ gap: 4, flex: "0 1 120px" }}>
                <span className="soft">Apogee, km</span>
                <input type="number" min={80} max={300} step={5} value={apogee} onChange={(e) => setApogee(Math.max(80, Number(e.target.value) || 80))} />
              </label>
            )}
            <label className="stack" style={{ gap: 4, flex: "0 1 120px" }}>
              <span className="soft">Payload, kg</span>
              <input type="number" min={10} step={10} value={payload} onChange={(e) => setPayload(Math.max(10, Number(e.target.value) || 10))} />
            </label>
          </>
        )}
        <button type="button" className="btn primary" disabled={thinking} onClick={run}>
          {thinking ? "Sizing…" : "Suggest designs"}
        </button>
      </div>
      {results && results.length === 0 && (
        <span className="bad">Nothing the company's engines can build does this job. A bigger or better engine from the Engine shop might.</span>
      )}
      {results && results.length > 0 && (
        <div className="suggestions">
          {results.map((s) => (
            <div key={s.label} className="card" style={{ background: "var(--raised)", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <strong style={{ fontSize: 18 }}>{s.label}</strong>
                <Chip tone={s.margin >= 0.08 ? "good" : "warn"}>{`+${Math.round(s.margin * 100)}% MARGIN`}</Chip>
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-end" }}>
                <div className="blueprint" style={{ borderRadius: 4, padding: "8px 10px 0", flex: "0 0 auto" }}>
                  <Rocket vehicle={s.vehicle} scale={fit(s.vehicle, 150)} />
                </div>
                <ul className="list" style={{ fontSize: 14, gap: 4 }}>
                  {s.spec.stages.map((st, i) => (
                    <li key={i} className="stack" style={{ gap: 0 }}>
                      <span className="mono" style={{ fontSize: 13 }}>
                        {s.spec.stages.length > 1 ? (i === 0 ? "Booster " : "Upper ") : ""}
                        {st.diameter} × {st.tankLength} m
                      </span>
                      <span className="soft" style={{ fontSize: 13 }}>
                        {st.engineCount} × {st.engine}
                      </span>
                    </li>
                  ))}
                  <li className="muted">
                    {(s.figures.totalDeltaV / 1000).toFixed(2)} km/s · T/W {s.figures.liftoffTW.toFixed(2)}
                  </li>
                  <li className="muted">
                    Build {money(s.build.cost)} · draw up {money(s.design.cost)}
                  </li>
                </ul>
              </div>
              <span className="soft" style={{ fontSize: 14 }}>
                {s.note}
              </span>
              <button type="button" className="btn" onClick={() => use(s)}>
                Use this
              </button>
            </div>
          ))}
        </div>
      )}
      <span className="muted" style={{ fontSize: 13 }}>
        Sized with the rocket equation for typical engines and a sensible trajectory. A starting point: test, re-tune and read the forecast before you sign.
      </span>
    </details>
  );
}
