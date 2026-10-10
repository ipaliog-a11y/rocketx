import { developedParts, REFINE, type Company } from "../../sim/company.ts";
import { DEFAULT_RATED_LIFE } from "../../sim/engine.ts";
import { FAILURE_LABELS } from "../../sim/hardware.ts";
import { optionSpec, parsePartKey, partLabel, SLOTS, type Slot } from "../../sim/parts.ts";
import { enginesUsing, revisionLetter, type PartKnowledge } from "../../sim/teststand.ts";
import { burnTime } from "../../sim/vehicle.ts";
import { Chip } from "../components/Bits.tsx";
import { game } from "../game.ts";
import { refineJob } from "../jobs.ts";
import { money } from "../format.ts";

const SLOT_TITLES: Record<Slot, string> = {
  cycle: "Feed cycles · start sequence",
  injector: "Injectors · combustion stability and mixing",
  cooling: "Chamber cooling · chamber life",
  nozzle: "Nozzles · expansion",
};

type Maturity = { text: string; tone: "good" | "warn" | "bad" | "muted" };

/** The longest burn any design asks of an engine, s. */
function longestBurn(company: Company, engineName: string): number {
  let burn = 0;
  for (const d of Object.values(company.designs)) for (const s of d.stages) if (s.engine.name === engineName) burn = Math.max(burn, burnTime(s));
  return burn;
}

/**
 * Where a part stands, from its record alone: never fired, fired, proven
 * past every burn the designs ask of it, or flown.
 */
function maturity(company: Company, key: string, part: PartKnowledge | undefined): Maturity {
  if (part && part.open.length > 0) return { text: `OPEN · ${part.open.map((m) => FAILURE_LABELS[m].toUpperCase()).join(", ")}`, tone: "bad" };
  if (!part || part.firings + part.flights === 0) return { text: "PROTOTYPE", tone: "muted" };
  if (part.flights > 0) return { text: "FLIGHT-PROVEN", tone: "good" };
  // Qualified: proven for everything the designs ask of it, in the terms its slot owns.
  const { slot, option } = parsePartKey(key);
  const flown = enginesUsing(company.campaign, key).filter((e) => longestBurn(company, e.name) > 0);
  const qualified =
    slot === "cycle"
      ? part.startupProven
      : slot === "nozzle"
        ? option === "sea-level" || part.altitudeTested
        : flown.length > 0 &&
          flown.every((e) =>
            slot === "injector"
              ? part.stableSeconds >= longestBurn(company, e.name)
              : part.lifeShare * (e.ratedLife ?? DEFAULT_RATED_LIFE) >= longestBurn(company, e.name),
          );
  return qualified ? { text: "QUALIFIED", tone: "good" } : { text: "FIRED", tone: "warn" };
}

/** What the record says about this part, in the terms its slot cares about. */
function evidence(company: Company, key: string, part: PartKnowledge | undefined): string {
  const { slot } = parsePartKey(key);
  if (!part) return "Nothing fired yet.";
  const users = enginesUsing(company.campaign, key);
  switch (slot) {
    case "cycle":
      return part.startupProven ? "Startup proven on the current revision." : "No clean start on the current revision.";
    case "injector":
      return `Stable for ${part.stableSeconds.toFixed(1)} s on the current revision.`;
    case "cooling":
      return `Ran ${Math.round(part.lifeShare * 100)}% of rated life without burning through${users.length > 0 ? `: ${users.map((e) => `${(part.lifeShare * (e.ratedLife ?? DEFAULT_RATED_LIFE)).toFixed(0)} s on ${e.name}`).join(", ")}` : ""}.`;
    case "nozzle":
      return part.altitudeTested ? "Measured above the air: altitude cell or flight." : "Not measured above the air.";
  }
}

export function Parts({ company }: { company: Company }) {
  const keys = developedParts(company);
  return (
    <div className="stack" style={{ gap: 24 }}>
      <span className="muted">
        Everything an engine is made of. What a firing or a flight learns lands on the parts, and every engine built with a part shares it. Fixes and refinements make a new
        revision.
      </span>
      {SLOTS.map((slot) => (
        <section key={slot} className="stack" aria-label={SLOT_TITLES[slot]}>
          <p className="label">{SLOT_TITLES[slot]}</p>
          <div className="achievements">
            {keys
              .filter((k) => parsePartKey(k).slot === slot)
              .map((key) => {
                const part = company.campaign.parts[key];
                const m = maturity(company, key, part);
                const users = enginesUsing(company.campaign, key);
                const refinable = slot === "injector" || slot === "nozzle";
                const measured = users.some((e) => company.campaign.knowledge[e.name]?.measuredIspFactor != null);
                const refinements = part?.refinements ?? 0;
                return (
                  <div key={key} className="card" style={{ gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <strong>{partLabel(key)}</strong>
                      <span className="mono muted" style={{ fontSize: 13 }}>
                        {revisionLetter(part?.revision ?? 0)}
                      </span>
                    </div>
                    <span>
                      <Chip tone={m.tone}>{m.text}</Chip>
                    </span>
                    <span className="soft" style={{ fontSize: 14 }}>
                      {evidence(company, key, part)}
                    </span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {part ? `${part.firings} firing${part.firings === 1 ? "" : "s"}, ${part.flights} flight${part.flights === 1 ? "" : "s"}` : "Never run"} · used by {users.map((e) => e.name).join(", ")}
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
                    {refinable && (
                      <div className="actions">
                        <button
                          type="button"
                          className="btn"
                          disabled={!measured || refinements >= REFINE.max}
                          title={!measured ? "Measure Isp on an engine with this part first" : undefined}
                          onClick={() => game.schedule(refineJob(key))}
                        >
                          Refine · {money(REFINE.cost)} · {REFINE.days} d
                        </button>
                        <span className="muted" style={{ fontSize: 13 }}>
                          {refinements >= REFINE.max ? "Refined as far as it goes." : !measured ? "Needs measured Isp." : `${REFINE.max - refinements} of ${REFINE.max} left`}
                        </span>
                      </div>
                    )}
                    <span className="muted" style={{ fontSize: 12 }}>
                      {optionSpec(slot, parsePartKey(key).option).text}
                    </span>
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
