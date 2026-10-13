import { useState } from "react";
import { developedParts, REFINE, type Company } from "../../sim/company.ts";
import { DEFAULT_RATED_LIFE } from "../../sim/engine.ts";
import { FAILURE_LABELS } from "../../sim/hardware.ts";
import { optionSpec, parsePartKey, partLabel, SLOTS, type Slot } from "../../sim/parts.ts";
import { enginesUsing, revisionLetter, type PartKnowledge } from "../../sim/teststand.ts";
import { Chip } from "../components/Bits.tsx";
import { game } from "../game.ts";
import { refineJob } from "../jobs.ts";
import { money, pct } from "../format.ts";
import { flownUpper, ispRange, partNeed, planPartTest, plannedBurn, refineWorth } from "../partTest.ts";
import type { Focus } from "./TestStand.tsx";
import { Term } from "../components/Info.tsx";

const SLOT_TITLES: Record<Slot, string> = {
  cycle: "Feed cycles · start sequence",
  injector: "Injectors · combustion stability and mixing",
  cooling: "Chamber cooling · chamber life",
  nozzle: "Nozzles · expansion",
};

type Maturity = { text: string; tone: "good" | "warn" | "bad" | "muted" };

/**
 * Where a part stands, from its record alone: never fired, fired, proven
 * past every burn the designs ask of it, or flown.
 */
function maturity(company: Company, key: string, part: PartKnowledge | undefined): Maturity {
  if (part && part.open.length > 0) return { text: `OPEN · ${part.open.map((m) => FAILURE_LABELS[m].toUpperCase()).join(", ")}`, tone: "bad" };
  if (!part || part.firings + part.flights === 0) return { text: "PROTOTYPE", tone: "muted" };
  if (part.flights > 0) return { text: "FLIGHT-PROVEN", tone: "good" };
  // Qualified: proven for every burn asked of it, in the terms its slot owns. A relight or an Isp reading is extra.
  const need = partNeed(company, key);
  const qualified = need === null || need.kind === "relight" || need.kind === "isp";
  return qualified ? { text: "QUALIFIED", tone: "good" } : { text: "FIRED", tone: "warn" };
}

/** What the record says about this part, in the terms its slot cares about. */
function evidence(company: Company, key: string, part: PartKnowledge | undefined): string {
  const { slot } = parsePartKey(key);
  if (!part) return "Nothing fired yet.";
  const users = enginesUsing(company.campaign, key);
  switch (slot) {
    case "cycle": {
      const start = part.startupProven ? "Startup proven on the current revision." : "No clean start on the current revision.";
      if (part.relightProven) return `${start} Relit in vacuum.`;
      return `${start} Never restarted in vacuum.${users.some((e) => flownUpper(company, e.name)) ? "" : " No design flies it on an upper stage."}`;
    }
    case "injector":
      return `Stable for ${part.stableSeconds.toFixed(1)} s on the current revision.`;
    case "cooling":
      return `Ran ${Math.round(part.lifeShare * 100)}% of rated life without burning through${users.length > 0 ? `: ${users.map((e) => `${(part.lifeShare * (e.ratedLife ?? DEFAULT_RATED_LIFE)).toFixed(0)} s on ${e.name}`).join(", ")}` : ""}.`;
    case "nozzle":
      return part.altitudeTested ? "Measured above the air: altitude cell or flight." : "Not measured above the air.";
  }
}

/** What the part still lacks, and a way to the stand to prove it. */
function TestAction({ company, partKey, test }: { company: Company; partKey: string; test: (focus: Focus) => void }) {
  const need = partNeed(company, partKey);
  const users = enginesUsing(company.campaign, partKey);
  if (need?.kind === "fix") {
    return (
      <div className="stack" style={{ gap: 4 }}>
        <span className="actions">
          <button type="button" className="btn" onClick={() => test({ engine: users[0]!.name })}>
            Fix it on the stand
          </button>
        </span>
        <span className="muted" style={{ fontSize: 13 }}>
          The fix is on the {users[0]!.name}'s page, and covers every engine with this part.
        </span>
      </div>
    );
  }
  const plan = planPartTest(company, partKey);
  if (!plan) return <span className="muted" style={{ fontSize: 13 }}>Nothing left to prove.</span>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="actions">
        <button type="button" className="btn primary" onClick={() => test({ engine: plan.engine, facility: plan.facility, seconds: plan.seconds, restart: plan.restart, why: plan.why })}>
          Test it · {plan.engine} · {money(plan.cost)}
        </button>
      </span>
      <span className="muted" style={{ fontSize: 13 }}>
        {plan.why}
      </span>
    </div>
  );
}

type Filter = "all" | "needs" | Slot;

const FILTERS: Array<[Filter, string]> = [
  ["all", "All"],
  ["needs", "Needs work"],
  ["cycle", "Cycles"],
  ["injector", "Injectors"],
  ["cooling", "Cooling"],
  ["nozzle", "Nozzles"],
];

export function Parts({ company, test }: { company: Company; test: (focus: Focus) => void }) {
  const keys = developedParts(company);
  const [filter, setFilter] = useState<Filter>("all");
  const shown = keys.filter((k) => filter === "all" || (filter === "needs" ? partNeed(company, k) !== null : parsePartKey(k).slot === filter));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="filter-chips" role="group" aria-label="Show parts">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
            {id === "needs" ? ` · ${keys.filter((k) => partNeed(company, k) !== null).length}` : ""}
          </button>
        ))}
      </div>
      {SLOTS.map((slot) => {
        const mine = shown.filter((k) => parsePartKey(k).slot === slot);
        if (mine.length === 0) return null;
        return (
          <section key={slot} className="stack" style={{ gap: 8 }} aria-label={SLOT_TITLES[slot]}>
            <p className="label">{SLOT_TITLES[slot]}</p>
            <div className="part-grid">
              {mine.map((key) => (
                <PartCard key={key} company={company} partKey={key} test={test} />
              ))}
            </div>
          </section>
        );
      })}
      {shown.length === 0 && <span className="muted">Nothing here needs work.</span>}
    </div>
  );
}

/** The one number that matters for a part, in its slot's terms, with how far along it is. */
function keyFigure(company: Company, key: string, part: PartKnowledge | undefined): { text: string; progress?: number } {
  const { slot, option } = parsePartKey(key);
  const users = enginesUsing(company.campaign, key);
  const isp = users.map((e) => company.campaign.knowledge[e.name]?.measuredIspFactor).find((f) => f != null);
  const ispText = isp != null ? ` · Isp ${pct(isp - 1)}` : "";
  switch (slot) {
    case "cycle": {
      const upper = users.some((e) => flownUpper(company, e.name));
      return { text: `Start ${part?.startupProven ? "✓" : "✗"} · Relight ${part?.relightProven ? "✓" : upper ? "✗" : "—"}` };
    }
    case "injector": {
      const needed = Math.max(...users.map((e) => plannedBurn(company, e)));
      const stable = part?.stableSeconds ?? 0;
      return { text: `Stable ${stable.toFixed(0)} / ${needed.toFixed(0)} s${ispText}`, progress: stable / needed };
    }
    case "cooling": {
      const needed = Math.max(...users.map((e) => plannedBurn(company, e) / (e.ratedLife ?? DEFAULT_RATED_LIFE)));
      const share = part?.lifeShare ?? 0;
      return { text: `Life ${Math.round(share * 100)}% / ${Math.round(needed * 100)}% of rated`, progress: share / needed };
    }
    case "nozzle":
      return { text: `${option === "sea-level" ? "Sea-level bell" : part?.altitudeTested ? "Measured in vacuum" : "Vacuum unmeasured"}${ispText}` };
  }
}

/** What a part still needs, in a few words. */
function nextStep(company: Company, key: string): string | null {
  const need = partNeed(company, key);
  if (!need) return null;
  switch (need.kind) {
    case "fix":
      return `needs a fix: ${FAILURE_LABELS[need.mode]}`;
    case "start":
      return "needs a clean start";
    case "relight":
      return "needs a relight";
    case "stable":
      return `needs ${need.seconds.toFixed(0)} s stable`;
    case "life":
      return `needs ${Math.round(need.share * 100)}% of rated life`;
    case "vacuum":
      return "needs the altitude cell";
    case "isp":
      return "Isp not measured";
  }
}

/** A part in two lines; tap it for the record, the test plan and refining. */
function PartCard({ company, partKey, test }: { company: Company; partKey: string; test: (focus: Focus) => void }) {
  const [open, setOpen] = useState(false);
  const { slot, option } = parsePartKey(partKey);
  const part = company.campaign.parts[partKey];
  const m = maturity(company, partKey, part);
  const users = enginesUsing(company.campaign, partKey);
  const figure = keyFigure(company, partKey, part);
  const next = nextStep(company, partKey);
  const refinable = slot === "injector" || slot === "nozzle";
  return (
    <div className={`card part-card ${open ? "open" : ""}`}>
      <button type="button" className="part-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="part-title">
          <strong>{partLabel(partKey)}</strong>
          <span className="mono muted" style={{ fontSize: 12 }}>
            {revisionLetter(part?.revision ?? 0).replace("Rev ", "")}
          </span>
          <Chip tone={m.tone}>{m.text}</Chip>
        </span>
        <span className="part-figure mono">{figure.text}</span>
        {figure.progress !== undefined && (
          <span className="mini-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.round(figure.progress * 100))}%` }} className={figure.progress >= 1 ? "full" : ""} />
          </span>
        )}
        <span className="part-next">
          <span className={next?.startsWith("needs a fix") ? "bad" : next ? "warn" : "good"}>{next ?? "nothing left to prove"}</span>
          <span className="muted" aria-hidden="true">
            {open ? "▴" : "▾"}
          </span>
        </span>
      </button>
      {open && (
        <div className="stack" style={{ gap: 10 }}>
          <span className="soft" style={{ fontSize: 14 }}>
            {evidence(company, partKey, part)}
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            {part ? `${part.firings} firing${part.firings === 1 ? "" : "s"}, ${part.flights} flight${part.flights === 1 ? "" : "s"}` : "Never run"} · on {users.map((e) => e.name).join(", ")}
          </span>
          {part && part.notes.length > 0 && (
            <ul className="list" style={{ fontSize: 13, gap: 4 }}>
              {part.notes.map((n) => (
                <li key={n} className="muted">
                  {n}
                </li>
              ))}
            </ul>
          )}
          <TestAction company={company} partKey={partKey} test={test} />
          {refinable && <RefinePanel company={company} partKey={partKey} />}
          <span className="muted" style={{ fontSize: 12 }}>
            {optionSpec(slot, option).text}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Refining, made visible: the Isp the part's engines deliver now, how much
 * room its type leaves, what the last refinement bought once re-measured,
 * and what another one is worth on each design.
 */
function RefinePanel({ company, partKey }: { company: Company; partKey: string }) {
  const part = company.campaign.parts[partKey];
  const users = enginesUsing(company.campaign, partKey);
  const measuredOf = (name: string) => company.campaign.knowledge[name]?.measuredIspFactor ?? null;
  const measured = users.filter((e) => measuredOf(e.name) !== null);
  const refinements = part?.refinements ?? 0;
  const range = ispRange(partKey)!;
  const last = part?.refined?.at(-1);
  const worth = refineWorth(company, partKey);
  const room = (range[1] - range[0]) * 100;
  // A narrow type can't give a whole step: say what it can.
  const step = Math.min(REFINE.step * 100, room);

  return (
    <div className="stack refine" style={{ gap: 6 }}>
      <span style={{ fontSize: 14 }}>
        <span className="muted">
          Delivered <Term id="isp">Isp</Term>:
        </span>{" "}
        {measured.length > 0 ? (
          <>
            {measured.map((e) => `${e.name} ${pct(measuredOf(e.name)! - 1)}`).join(" · ")}
            <span className="muted"> against the drawings</span>
          </>
        ) : (
          <span className="muted">not measured on the current revision.</span>
        )}
      </span>
      <span className="muted" style={{ fontSize: 13 }}>
        This type delivers {(range[0] * 100).toFixed(1)}–{(range[1] * 100).toFixed(1)}% of its drawn Isp.{" "}
        {room < 1 ? "There is almost nothing to win back by refining it." : `Each refinement wins back about ${(REFINE.step * 100).toFixed(1)}%, less near the top.`}
      </span>
      {last && (
        <span style={{ fontSize: 13 }}>
          <span className="muted">Last refinement ({revisionLetter(last.revision)}):</span>{" "}
          {Object.entries(last.before)
            .filter(([name, before]) => before !== null || measuredOf(name) !== null)
            .map(([name, before]) => {
              const now = measuredOf(name);
              const was = before === null ? "unmeasured" : pct(before - 1);
              return now === null ? `${name} ${was} → not measured since: fire it again` : `${name} ${was} → ${pct(now - 1)}`;
            })
            .join(" · ")}
        </span>
      )}
      {worth.length > 0 && refinements < REFINE.max && room >= 1 && (
        <span className="muted" style={{ fontSize: 13 }}>
          Another refinement is worth about{" "}
          {worth
            .slice(0, 3)
            .map((w) => `${w.design} +${Math.round(w.deltaV)} m/s${w.payload >= 1 ? ` (≈ +${Math.round(w.payload)} kg payload)` : ""}`)
            .join(" · ")}
          .
        </span>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={measured.length === 0 || refinements >= REFINE.max}
          title={measured.length === 0 ? "Measure Isp on an engine with this part first" : undefined}
          onClick={() => game.schedule(refineJob(partKey))}
        >
          Refine · {step < REFINE.step * 100 ? "≤" : "≈"} +{step.toFixed(1)}% Isp · {money(REFINE.cost)} · {REFINE.days} d
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {refinements >= REFINE.max ? "Refined as far as it goes." : measured.length === 0 ? "Needs measured Isp: fire an engine with it for 5 s or more." : `${REFINE.max - refinements} of ${REFINE.max} left`}
        </span>
      </div>
    </div>
  );
}
