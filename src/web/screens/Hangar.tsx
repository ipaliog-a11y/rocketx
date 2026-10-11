import { useState } from "react";
import { buildDays, readyDay, reengine, type Company } from "../../sim/company.ts";
import { holds, missionLicence } from "../../sim/licence.ts";
import { vehicleCost } from "../../sim/cost.ts";
import { burnTime, idealDeltaV, stackMass } from "../../sim/vehicle.ts";
import { LEO_300, SUBORBITAL_TEST } from "../../missions.ts";
import { Chip, Facts, Stack, Tabs } from "../components/Bits.tsx";
import { height, Rocket } from "../components/Rocket.tsx";
import { game } from "../game.ts";
import { buildJob, retuneTestJob, testFlightJob } from "../jobs.ts";
import { DrawingBoard } from "./DrawingBoard.tsx";
import { Factory } from "./Factory.tsx";
import { Crew } from "./Crew.tsx";
import { Simulator, type SimFocus } from "./Simulator.tsx";
import { km, money } from "../format.ts";
import { Icon } from "../components/Icon.tsx";
import { COLORS } from "../palette.ts";

type Tab = "lineup" | "design" | "sim" | "board" | "factory" | "crew" | "record";

/** Ideal Δv a 300 km orbit from Port Avery takes in this sim, losses included, m/s. */
const LEO_NEEDS = 9_400;

export function Hangar({ company, focus }: { company: Company; focus?: SimFocus }) {
  const [tab, setTab] = useState<Tab>(focus ? "sim" : "lineup");
  const [key, setKey] = useState("meridian");
  const [simFocus, setSimFocus] = useState<SimFocus | undefined>(focus);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Hangar</h1>
        <Tabs<Tab>
          label="Hangar views"
          value={tab}
          onChange={setTab}
          tabs={[
            ["lineup", "Line-up"],
            ["design", "Design"],
            ["sim", "Simulator"],
            ["board", "Drawing board"],
            ["factory", "Factory"],
            ["crew", "Crew"],
            ["record", "Flight record"],
          ]}
        />
      </div>
      {tab === "lineup" && <LineUp company={company} open={(k) => (setKey(k), setTab("design"))} />}
      {tab === "design" && <Design company={company} designKey={company.designs[key] ? key : "meridian"} simulate={(k) => (setSimFocus({ design: k }), setTab("sim"))} />}
      {tab === "sim" && <Simulator key={JSON.stringify(simFocus ?? {})} company={company} focus={simFocus} />}
      {tab === "board" && <DrawingBoard company={company} drawn={(k) => (setKey(k), setTab("design"))} />}
      {tab === "factory" && <Factory company={company} />}
      {tab === "crew" && <Crew company={company} />}
      {tab === "record" && <Record company={company} />}
    </div>
  );
}

function LineUp({ company, open }: { company: Company; open: (key: string) => void }) {
  const scale = 30;
  return (
    <section className="stack" aria-label="Design line-up">
      <p className="muted" style={{ margin: 0 }}>
        Every design to the same scale. Choose one to open its drawing.
      </p>
      <div className="card blueprint" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-around", gap: 28, paddingBottom: 0, position: "relative" }}>
        {Object.entries(company.designs).map(([key, v]) => {
          const dv = idealDeltaV(v).reduce((a, b) => a + b, 0);
          const stock = company.inventory[key] ?? 0;
          return (
            <button key={key} type="button" onClick={() => open(key)} style={{ all: "unset", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <Rocket vehicle={v} scale={scale} />
              <span style={{ height: 2, width: 110, background: "var(--line-strong)" }} />
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "10px 0 18px" }}>
                <strong style={{ fontSize: 17 }}>{v.name}</strong>
                <span className="mono muted" style={{ fontSize: 13 }}>
                  {height(v).toFixed(1)} m · {stackMass(v, 0).toLocaleString("en-US")} kg
                </span>
                <span className="mono soft" style={{ fontSize: 13 }}>
                  Δv {(dv / 1000).toFixed(2)} km/s
                </span>
                {stock > 0 && <Chip tone="good">{stock} BUILT</Chip>}
              </span>
            </button>
          );
        })}
        <div aria-hidden="true" style={{ position: "absolute", left: 20, top: 16, display: "flex", flexDirection: "column", gap: 4 }} className="mono muted">
          <span style={{ width: scale * 5, height: 6, border: "1px solid var(--muted)", borderTop: 0 }} />
          <span style={{ fontSize: 12 }}>5 m</span>
        </div>
      </div>
    </section>
  );
}

const COLOURS = [COLORS.text, COLORS.data, COLORS.dataDeep, COLORS.action, "#8a5a1e"];

function Design({ company, designKey, simulate }: { company: Company; designKey: string; simulate: (key: string) => void }) {
  const v = company.designs[designKey]!;
  const { cost, days: firstDays } = vehicleCost(v);
  const days = buildDays(company, designKey);
  const built = company.built[designKey] ?? 0;
  const dv = idealDeltaV(v);
  const total = dv.reduce((a, b) => a + b, 0);
  const stock = company.inventory[designKey] ?? 0;
  const ready = readyDay(company, designKey);
  const inLine = company.orders.filter((o) => o.design === designKey).length;
  const turns = v.pitchProgram?.kind === "gravity-turn";
  const mission = turns ? LEO_300 : SUBORBITAL_TEST;
  const liftoff = stackMass(v, 0);
  const pad = v.stages[0]!.engine.thrustVac * v.stages[0]!.engineCount; // vacuum figure; the pad sees less
  const mass = [
    { name: `Payload ${v.payloadMass} kg`, value: v.payloadMass },
    ...[...v.stages].reverse().flatMap((s) => [
      { name: `${s.name} propellant ${s.propellantMass.toLocaleString("en-US")} kg`, value: s.propellantMass },
      { name: `${s.name} structure ${s.dryMass.toLocaleString("en-US")} kg`, value: s.dryMass },
    ]),
  ].map((p, i) => ({ ...p, color: COLOURS[i % COLOURS.length]! }));

  return (
    <section className="row" aria-label={`${v.name} drawing`}>
      <div className="card blueprint" style={{ flex: "0 0 auto", alignItems: "center", padding: "24px 48px 0" }}>
        <Rocket vehicle={v} scale={36} labels />
        <span style={{ height: 2, width: 150, background: "var(--line-strong)" }} />
        <span className="mono muted" style={{ fontSize: 12, padding: "10px 0 16px" }}>
          {height(v).toFixed(1)} m tall
        </span>
      </div>
      <div className="grow stack" style={{ gap: 18 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 16px" }}>
          <h2 style={{ fontSize: 26 }}>{v.name}</h2>
          {stock > 0 ? <Chip tone="good">{stock} ON THE GROUND</Chip> : <Chip tone="muted">NONE BUILT</Chip>}
        </div>
        <Facts
          items={[
            ["Liftoff mass", `${liftoff.toLocaleString("en-US")} kg`],
            ["Payload", `${v.payloadMass} kg`],
            ...v.stages.map((s, i): [string, string] => [i === 0 ? "Booster" : "Upper", `${s.engine.name} ×${s.engineCount}`]),
            ["Burns", v.stages.map((s) => `${burnTime(s).toFixed(0)} s`).join(" + ")],
            ["Vacuum T/W", (pad / (liftoff * 9.80665)).toFixed(2)],
            ["Load budget", `${v.limits.maxDynamicPressure / 1000} kPa`],
            ["Build", `${money(cost)} · ${days} d${days < firstDays ? ` (first took ${firstDays}: ${built} built)` : ""}`],
          ]}
        />
        <Engines company={company} designKey={designKey} />
        <div className="stack" style={{ gap: 8 }}>
          <p className="label">Where the mass goes at liftoff</p>
          <Stack parts={mass} label={mass.map((m) => m.name).join(", ")} />
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <p className="label">Δv on paper, per stage</p>
          <div className="bar" style={{ height: 20, display: "flex" }}>
            {dv.map((d, i) => (
              <div key={i} style={{ width: `${(d / 10_000) * 100}%`, background: i === 0 ? COLORS.dataDeep : "var(--cyan)" }} />
            ))}
            <div className="mark" style={{ left: `${(LEO_NEEDS / 10_000) * 100}%` }} />
          </div>
          <span className="soft" style={{ fontSize: 14 }}>
            {dv.map((d) => (d / 1000).toFixed(2)).join(" + ")} = {(total / 1000).toFixed(2)} km/s. The white line is about what LEO 300 km takes from Port Avery.
          </span>
        </div>
        <p className="soft" style={{ margin: 0 }}>
          {turns
            ? `Gravity turn: ${v.pitchProgram?.kind === "gravity-turn" ? `${v.pitchProgram.kickAngle.toFixed(1)}° kick at ${v.pitchProgram.kickSpeed} m/s` : ""}, then the upper stage ramps its pitch for a direct insertion. Re-tune it from the bid screen once tests have measured the real vehicle.`
            : "Straight up the whole flight. A sounding rocket: it never turns over, so it can't reach orbit."}
        </p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => game.schedule(buildJob(company, designKey))}>
            Order one · {money(cost)} · {days} days
          </button>
          <button
            type="button"
            className="btn"
            disabled={ready === null || !holds(company, missionLicence(mission))}
            title={!holds(company, missionLicence(mission)) ? "Orbital test flights need the orbital licence" : ready === null ? `Order a ${v.name} first` : undefined}
            onClick={() => game.schedule(testFlightJob(company, designKey, mission, (r) => game.showFlight(r, designKey)))}
          >
            Test flight · {mission.target ? `LEO ${km(mission.target.apoapsis, 0)}` : "straight up"}
            {ready !== null && ready > company.day ? ` on rollout, day ${ready}` : ""}
          </button>
          <button type="button" className="btn quiet" onClick={() => simulate(designKey)}>
            <Icon name="simulate" size="sm" />
            Simulate
          </button>
          {turns && (
            <button type="button" className="btn" onClick={() => game.schedule(retuneTestJob(company, designKey, mission))}>
              Re-tune for {mission.name}
            </button>
          )}
        </div>
        {inLine > 0 && (
          <span className="soft" style={{ fontSize: 14 }}>
            {inLine} on the production line; the next rolls out on day {ready}.
          </span>
        )}
        <span className="muted" style={{ fontSize: 14 }}>
          A test flight earns no money, but telemetry teaches what the flight reached, and a design's first orbit counts as heritage with customers.
        </span>
      </div>
    </section>
  );
}

function Record({ company }: { company: Company }) {
  return (
    <section className="row" aria-label="Flight record">
      {Object.entries(company.designs).map(([key, v]) => {
        const xp = company.experience[key];
        const flights = company.flights.filter((f) => f.design === v.name);
        return (
          <div key={key} className="card" style={{ flex: "1 1 300px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <strong style={{ fontSize: 18 }}>{v.name}</strong>
              <span className="mono muted" style={{ fontSize: 13 }}>
                {xp?.flights ?? 0} flight{xp?.flights === 1 ? "" : "s"}
              </span>
            </div>
            <div className="actions" style={{ gap: 6 }}>
              <Chip tone={(xp?.orbits ?? 0) > 0 ? "good" : "muted"}>{(xp?.orbits ?? 0) > 0 ? "ORBIT ✓" : "ORBIT"}</Chip>
              {xp && xp.orbits > 0 && <Chip>{`UP TO ${km(xp.maxApoapsis, 0).toUpperCase()}`}</Chip>}
              {xp && xp.maxPayload > 0 && <Chip>{`${xp.maxPayload} KG`}</Chip>}
              {xp?.inclinations.map((i) => <Chip key={i}>{`${i}°`}</Chip>)}
            </div>
            {flights.length === 0 ? (
              <span className="muted">Never flown.</span>
            ) : (
              <ul className="list" style={{ fontSize: 15 }}>
                {flights.map((f, i) => (
                  <li key={i}>
                    <span className="mono muted" style={{ flex: "0 0 64px" }}>
                      day {f.day}
                    </span>
                    <span>
                      {f.contract ?? `Test flight, ${f.mission}`} · {f.settlement ?? f.outcome}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Which engine each stage flies. Swapping keeps the tanks and engine count,
 * so the preview shows what changes: thrust to weight, burn time and Δv.
 */
function Engines({ company, designKey }: { company: Company; designKey: string }) {
  const v = company.designs[designKey]!;
  const engines = Object.values(company.campaign.engines);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const built = company.inventory[designKey] ?? 0;
  const g = 9.80665;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="label">Engines</p>
      {v.stages.map((stage, i) => {
        const pick = picks[i] ?? stage.engine.name;
        const engine = company.campaign.engines[pick] ?? stage.engine;
        const preview = { ...v, stages: v.stages.map((s, j) => (j === i ? { ...s, engine } : s)) };
        const mass = stackMass(preview, i);
        const tw = (engine.thrustVac * stage.engineCount) / (mass * g);
        const dvNow = idealDeltaV(v)[i]!;
        const dvNew = idealDeltaV(preview)[i]!;
        const changed = pick !== stage.engine.name;
        return (
          <div key={i} className="card" style={{ padding: "12px 14px", gap: 8, background: "var(--raised)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px", alignItems: "center" }}>
              <strong style={{ flex: "1 1 140px" }}>
                {stage.name} · {stage.engineCount} ×
              </strong>
              <label className="sr-only" htmlFor={`engine-${i}`}>
                Engine for {stage.name}
              </label>
              <select id={`engine-${i}`} value={pick} onChange={(e) => setPicks({ ...picks, [i]: e.target.value })} style={{ flex: "2 1 200px" }}>
                {engines.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.name} · {(e.thrustVac / 1000).toFixed(1)} kN · {e.ispVac} s
                  </option>
                ))}
              </select>
            </div>
            <span className="mono soft" style={{ fontSize: 13 }}>
              T/W {tw.toFixed(2)} · burn {burnTime(preview.stages[i]!).toFixed(0)} s · Δv {(dvNew / 1000).toFixed(2)} km/s
              {changed && <span className={dvNew >= dvNow ? "good" : "bad"}> ({dvNew >= dvNow ? "+" : "−"}{Math.abs(dvNew - dvNow).toFixed(0)} m/s)</span>}
            </span>
            {changed && (
              <div className="actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={built > 0}
                  onClick={() => game.act((c) => reengine(c, designKey, i, pick), () => setPicks({ ...picks, [i]: pick }))}
                >
                  Fit {pick}
                </button>
                {built > 0 ? (
                  <span className="muted" style={{ fontSize: 14 }}>
                    {built} built with the old engines. Fly them first.
                  </span>
                ) : (
                  i === 0 && tw < 1.2 && <span className="bad" style={{ fontSize: 14 }}>Too little thrust to leave the pad well.</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
