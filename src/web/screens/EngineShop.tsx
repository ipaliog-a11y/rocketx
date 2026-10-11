import { useState, type ReactNode } from "react";
import { developedParts, type Company } from "../../sim/company.ts";
import { twinOf } from "../../sim/schedule.ts";
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
  const stem = { "pressure-fed": "Wren", "electric-pump": "Swift", "gas-generator": "Osprey", storable: "Petrel" }[parts.cycle];
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
      <span className="mono muted" style={{ fontSize: 12 }}>
        {disabled ?? facts}
      </span>
      {on && (
        <span className="soft" style={{ fontSize: 14 }}>
          {text}
        </span>
      )}
    </button>
  );
}

/** One slot: a single line with the choice, opening into its options. */
function SlotPicker({ title, owns, open, toggle, choice, have, children }: { title: string; owns: string; open: boolean; toggle: () => void; choice: string; have: boolean; children: ReactNode }) {
  return (
    <fieldset className={`slot slot-picker ${open ? "open" : ""}`}>
      <legend className="sr-only">{title}</legend>
      <button type="button" className="slot-head" aria-expanded={open} onClick={toggle}>
        <span className="stack" style={{ gap: 2 }}>
          <span className="label">
            {title} <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>· {owns}</span>
          </span>
          <strong>{choice}</strong>
        </span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {have ? <Chip tone="good">IN PRODUCTION</Chip> : <Chip tone="warn">NEW</Chip>}
          <span className="muted" aria-hidden="true">
            {open ? "▴" : "▾"}
          </span>
        </span>
      </button>
      {open && children}
    </fieldset>
  );
}

export function EngineShop({ company, done, show }: { company: Company; done: () => void; show: (engine: string) => void }) {
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
  const twin = twinOf(company, parts);
  const separates = flowSeparates(engine, P_SEA_LEVEL);
  const keyFor = (slot: Slot, option: string) => partKey({ ...parts, [slot]: option } as EngineParts, slot);
  // One slot's options open at a time; the rest show what is chosen.
  const [openSlot, setOpenSlot] = useState<Slot | null>(null);
  const choiceOf = (slot: Slot): string => {
    switch (slot) {
      case "cycle":
        return CYCLES[parts.cycle].label;
      case "injector":
        return INJECTORS[parts.injector].label;
      case "cooling":
        return COOLINGS[parts.cooling].label;
      case "nozzle":
        return NOZZLES[parts.nozzle].label;
    }
  };

  return (
    <div className="row">
      <section className="grow stack" aria-label="Choose parts" style={{ gap: 18 }}>
        <p className="muted" style={{ margin: 0 }}>
          Four parts at one chamber size. Parts in production are free and keep what tests learned; new ones cost development and start unproven.
        </p>
        <div className="slot">
          <span className="label">Chamber size</span>
          <div className="filter-chips" role="group" aria-label="Chamber size">
            {SIZES.map((size) => (
              <button key={size} type="button" aria-pressed={parts.size === size} onClick={() => set({ size: size as ChamberSize })}>
                {size} kN
              </button>
            ))}
          </div>
        </div>
        <SlotPicker title="Feed cycle" owns="owns the start sequence" open={openSlot === "cycle"} toggle={() => setOpenSlot(openSlot === "cycle" ? null : "cycle")} choice={choiceOf("cycle")} have={developed.has(keyFor("cycle", parts.cycle))}>
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
        </SlotPicker>
        <SlotPicker title="Injector" owns="owns combustion stability" open={openSlot === "injector"} toggle={() => setOpenSlot(openSlot === "injector" ? null : "injector")} choice={choiceOf("injector")} have={developed.has(keyFor("injector", parts.injector))}>
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
        </SlotPicker>
        <SlotPicker title="Chamber cooling" owns="owns chamber life" open={openSlot === "cooling"} toggle={() => setOpenSlot(openSlot === "cooling" ? null : "cooling")} choice={choiceOf("cooling")} have={developed.has(keyFor("cooling", parts.cooling))}>
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
        </SlotPicker>
        <SlotPicker title="Nozzle" owns="owns expansion and flow separation" open={openSlot === "nozzle"} toggle={() => setOpenSlot(openSlot === "nozzle" ? null : "nozzle")} choice={choiceOf("nozzle")} have={developed.has(keyFor("nozzle", parts.nozzle))}>
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
        </SlotPicker>
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
        {separates && <span className="warn">This bell separates at sea level: altitude cell and upper stages only.</span>}
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
        {twin ? (
          <div className="stack" style={{ gap: 8 }}>
            <span className="warn">
              This is the {twin}: the same parts at the same size{company.campaign.engines[twin] ? "" : ", already being developed"}. A second one would cost money and teach nothing.
            </span>
            {company.campaign.engines[twin] && (
              <span className="actions">
                <button type="button" className="btn primary" onClick={() => show(twin)}>
                  Open the {twin} on the stand
                </button>
              </span>
            )}
          </div>
        ) : (
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
        )}
        <span className="muted" style={{ fontSize: 13 }}>
          Ranges are what the parts promise; only firings say where the real numbers sit.
        </span>
      </aside>
    </div>
  );
}
