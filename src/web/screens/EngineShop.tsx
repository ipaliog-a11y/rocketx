import { useState } from "react";
import { developedParts, type Company } from "../../sim/company.ts";
import { P_SEA_LEVEL } from "../../sim/constants.ts";
import { flowSeparates, ispAt, thrustAt } from "../../sim/engine.ts";
import {
  assembleEngine,
  COOLINGS,
  CYCLES,
  developmentCost,
  engineRanges,
  INJECTORS,
  NOZZLES,
  partKey,
  partLabel,
  partsProblems,
  SIZES,
  type ChamberSize,
  type EngineParts,
  type Slot,
} from "../../sim/parts.ts";
import { Chip, Facts } from "../components/Bits.tsx";
import { Nozzle } from "../components/Rocket.tsx";
import { game } from "../game.ts";
import { developJob } from "../jobs.ts";
import { money } from "../format.ts";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A name the player can keep: cycle, size and nozzle. */
function suggestName(parts: EngineParts, taken: Record<string, unknown>): string {
  const stem = { "pressure-fed": "Wren", "electric-pump": "Swift", "gas-generator": "Osprey" }[parts.cycle];
  const suffix = { "sea-level": "", altitude: "-A", vacuum: "-V", "large-vacuum": "-XV" }[parts.nozzle];
  const base = `${stem}-${parts.size}${suffix}`;
  let name = base;
  for (let i = 2; taken[name]; i++) name = `${base} ${i}`;
  return name;
}

/** One option's card: what it does, the numbers that matter, and whether the company already builds it. */
function Option({
  on,
  disabled,
  title,
  text,
  facts,
  partKeyFor,
  developed,
  develop,
  onPick,
}: {
  on: boolean;
  disabled?: string;
  title: string;
  text: string;
  facts: string;
  partKeyFor: string;
  developed: Set<string>;
  develop: number;
  onPick: () => void;
}) {
  const have = developed.has(partKeyFor);
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled !== undefined}
      title={disabled}
      onClick={onPick}
      className="card option"
      style={{ borderColor: on ? "var(--amber)" : undefined, background: on ? "var(--selected)" : undefined }}
    >
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <strong>{title}</strong>
        {have ? <Chip tone="good">IN PRODUCTION</Chip> : <Chip tone="warn">{`NEW +${money(develop)}`}</Chip>}
      </span>
      <span className="soft" style={{ fontSize: 14 }}>
        {disabled ?? text}
      </span>
      <span className="mono muted" style={{ fontSize: 12 }}>
        {facts}
      </span>
    </button>
  );
}

export function EngineShop({ company, done }: { company: Company; done: () => void }) {
  const [parts, setParts] = useState<EngineParts>({ size: 25, cycle: "gas-generator", injector: "coaxial", cooling: "film", nozzle: "vacuum" });
  const [name, setName] = useState(() => suggestName(parts, company.campaign.engines));
  const [named, setNamed] = useState(false);
  const developed = new Set(developedParts(company));
  const set = (p: Partial<EngineParts>) => {
    const next = { ...parts, ...p };
    setParts(next);
    if (!named) setName(suggestName(next, company.campaign.engines));
  };

  const engine = assembleEngine(parts, name.trim() || "Unnamed");
  const ranges = engineRanges(engine)!;
  const quote = developmentCost(parts, developed);
  const problems = partsProblems(parts);
  const taken = company.campaign.engines[name.trim()] !== undefined;
  const separates = flowSeparates(engine, P_SEA_LEVEL);
  const keyFor = (slot: Slot, option: string) => partKey({ ...parts, [slot]: option } as EngineParts, slot);

  return (
    <div className="row">
      <section className="grow stack" aria-label="Choose parts" style={{ gap: 18 }}>
        <p className="muted" style={{ margin: 0 }}>
          An engine is four parts at one chamber size. Parts already in production cost nothing to reuse and bring what tests have learned about them; a new part costs
          development and starts unproven.
        </p>
        <fieldset className="slot">
          <legend className="label">Chamber size</legend>
          <div className="actions" style={{ gap: 8 }}>
            {SIZES.map((size) => (
              <button key={size} type="button" className={`btn ${parts.size === size ? "primary" : ""}`} aria-pressed={parts.size === size} onClick={() => set({ size: size as ChamberSize })}>
                {size} kN
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="slot">
          <legend className="label">Feed cycle · owns the start sequence</legend>
          <div className="options">
            {Object.entries(CYCLES).map(([id, o]) => (
              <Option
                key={id}
                on={parts.cycle === id}
                disabled={o.sizes.includes(parts.size) ? undefined : `Only at ${o.sizes.join(", ")} kN.`}
                title={o.label}
                text={o.text}
                facts={`Isp ~${o.isp} s base · hard-start risk ${pct(o.hardStart)} · cost ×${o.cost}`}
                partKeyFor={keyFor("cycle", id)}
                developed={developed}
                develop={o.develop}
                onPick={() => set({ cycle: id as EngineParts["cycle"] })}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="slot">
          <legend className="label">Injector · owns combustion stability</legend>
          <div className="options">
            {Object.entries(INJECTORS).map(([id, o]) => (
              <Option
                key={id}
                on={parts.injector === id}
                title={o.label}
                text={o.text}
                facts={`delivers ${pct(o.isp[0])}–${pct(o.isp[1])} of design Isp · instability risk ${pct(o.instability)}`}
                partKeyFor={keyFor("injector", id)}
                developed={developed}
                develop={o.develop}
                onPick={() => set({ injector: id as EngineParts["injector"] })}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="slot">
          <legend className="label">Chamber cooling · owns chamber life</legend>
          <div className="options">
            {Object.entries(COOLINGS).map(([id, o]) => (
              <Option
                key={id}
                on={parts.cooling === id}
                title={o.label}
                text={o.text}
                facts={`rated ${o.life} s · real life ${pct(o.lifeRange[0])}–${pct(o.lifeRange[1])} of rated · Isp ×${o.isp}`}
                partKeyFor={keyFor("cooling", id)}
                developed={developed}
                develop={o.develop}
                onPick={() => set({ cooling: id as EngineParts["cooling"] })}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="slot">
          <legend className="label">Nozzle · owns expansion and flow separation</legend>
          <div className="options">
            {Object.entries(NOZZLES).map(([id, o]) => (
              <Option
                key={id}
                on={parts.nozzle === id}
                title={o.label}
                text={o.text}
                facts={`exit ${o.exitPressure / 1000} kPa · Isp ×${o.isp} · thrust ×${o.thrust}`}
                partKeyFor={keyFor("nozzle", id)}
                developed={developed}
                develop={o.develop}
                onPick={() => set({ nozzle: id as EngineParts["nozzle"] })}
              />
            ))}
          </div>
        </fieldset>
      </section>

      <aside className="side card" aria-label="The engine on paper" style={{ position: "sticky", top: 12 }}>
        <p className="label">On paper</p>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div className="blueprint" style={{ borderRadius: 4, padding: 8, flex: "0 0 auto" }}>
            <Nozzle engine={engine} size={96} />
          </div>
          <label className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
            <span className="soft">Name</span>
            <input
              className="name-input"
              style={{ fontSize: 18, width: "100%" }}
              value={name}
              maxLength={30}
              onChange={(e) => {
                setName(e.target.value);
                setNamed(true);
              }}
            />
            {taken && <span className="bad" style={{ fontSize: 13 }}>An engine already has this name.</span>}
          </label>
        </div>
        <Facts
          items={[
            ["Thrust, vacuum", `${(engine.thrustVac / 1000).toFixed(1)} kN`],
            ["Thrust, sea level", separates ? <span className="bad">separates</span> : `${(thrustAt(engine, P_SEA_LEVEL) / 1000).toFixed(1)} kN`],
            ["Isp, vacuum", `${Math.round(ranges.isp[0])}–${Math.round(ranges.isp[1])} s`],
            ["Isp, sea level", separates ? "—" : `${Math.round(ispAt(engine, P_SEA_LEVEL))} s on paper`],
            ["Chamber life", `${Math.round(ranges.life[0])}–${Math.round(ranges.life[1])} s`],
            ["Exit pressure", `${engine.exitPressure / 1000} kPa`],
            ["Hard start", pct(ranges.hardStart)],
            ["Instability", pct(ranges.instability)],
            ["Unit cost", money(engine.unitCost ?? 0)],
          ]}
        />
        {separates && <span className="warn">This bell separates on a sea-level stand and on the pad. It can only be tested in the altitude cell and only flies on an upper stage.</span>}
        <div className="stack" style={{ gap: 4 }}>
          <span>
            Development: <strong className="mono">{money(quote.cost)}</strong> and <strong className="mono">{quote.days} days</strong>
          </span>
          <span className="muted" style={{ fontSize: 14 }}>
            {quote.newParts.length === 0 ? "Every part is already in production." : `New: ${quote.newParts.map(partLabel).join(", ")}.`}
          </span>
        </div>
        {problems.map((p) => (
          <span key={p} className="bad">
            {p}
          </span>
        ))}
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={problems.length > 0 || taken || name.trim().length === 0}
            onClick={() => game.schedule({ ...developJob(parts, name.trim(), quote), onDone: done })}
          >
            Develop · {money(quote.cost)} · {quote.days} d
          </button>
        </div>
        <span className="muted" style={{ fontSize: 14 }}>
          Ranges are what the parts promise. The real numbers sit somewhere inside, and only firings say where.
        </span>
      </aside>
    </div>
  );
}
