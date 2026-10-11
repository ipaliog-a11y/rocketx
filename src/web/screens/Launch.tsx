import { useMemo, useState } from "react";
import { bid, readyDay, type Company } from "../../sim/company.ts";
import type { Contract } from "../../sim/contracts.ts";
import { CAPSULE, crewRating } from "../../sim/crew.ts";
import { STATION } from "../../missions.ts";
import { COSTS } from "../../sim/cost.ts";
import { DesignSelect, Findings, Forecast, Schedule } from "../components/BidParts.tsx";
import { Chip, Facts } from "../components/Bits.tsx";
import { height, Rocket } from "../components/Rocket.tsx";
import { defaultDesign, game } from "../game.ts";
import { buildJob, launchJob, retuneJob, signedContracts } from "../jobs.ts";
import { km, money } from "../format.ts";
import { Sheet } from "../components/Sheet.tsx";
import type { SimFocus } from "./Simulator.tsx";

type Props = { company: Company; version: number; goTo: (screen: "contracts" | "stand" | "tunnel") => void; simulate: (focus: SimFocus) => void };

/** A design with a vehicle on the ground or on the line: what the player most likely means to fly. */
function readyDesign(company: Company): string | undefined {
  return Object.keys(company.designs).find((k) => readyDay(company, k) !== null);
}

/** Days left on a contract, coloured by whether a launch still fits. */
function countdown(company: Company, c: Contract): { text: string; tone: "good" | "warn" | "bad" } {
  const left = c.deadline - company.day;
  if (left < COSTS.padDays) return { text: `${left} D LEFT`, tone: "bad" };
  if (left < COSTS.padDays + 30) return { text: `${left} D LEFT`, tone: "warn" };
  return { text: `${left} D LEFT`, tone: "good" };
}

export function Launch({ company, version, goTo, simulate }: Props) {
  const signed = signedContracts(company);
  const [selected, setSelected] = useState<string | undefined>(signed[0]?.id);
  const contract = signed.find((c) => c.id === selected) ?? signed[0];
  const [choice, setChoice] = useState<Record<string, string>>({});
  // On a phone the launch preparation opens over the list once a contract is picked. With just one signed, it shows straight away.
  const [sheet, setSheet] = useState(false);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Launch</h1>
        <span className="muted">Signed contracts: build the vehicle, re-tune it for the payload, and fly before the deadline.</span>
      </div>
      {signed.length === 0 || !contract ? (
        <div className="card" style={{ alignItems: "flex-start" }}>
          <h2>Nothing signed</h2>
          <span className="soft">Sign a contract on the Contracts page, then come back here to fly it.</span>
          <button type="button" className="btn primary" onClick={() => goTo("contracts")}>
            Go to Contracts
          </button>
        </div>
      ) : (
        <div className="row">
          <section className="side stack" aria-label="Signed contracts" style={{ flexBasis: 340 }}>
            {signed.map((c) => {
              const on = c.id === contract.id;
              const cd = countdown(company, c);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setSelected(c.id);
                    setSheet(true);
                  }}
                  className="card"
                  style={{ textAlign: "left", cursor: "pointer", gap: 6, borderColor: on ? "var(--amber)" : undefined, background: on ? "var(--selected)" : undefined }}
                >
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <strong style={{ fontSize: 17 }}>{c.title}</strong>
                    <Chip tone={cd.tone}>{cd.text}</Chip>
                  </span>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {c.customer} · {c.payloadMass} kg · due day {c.deadline}
                  </span>
                  <span className="mono" style={{ fontSize: 14 }}>
                    <span className="good">{money(c.payout)}</span> <span className="muted">· penalty</span> <span className="bad">{money(c.penalty)}</span>
                  </span>
                </button>
              );
            })}
          </section>
          {(() => {
            const prep = (
              <Prep
                key={contract.id}
                company={company}
                version={version}
                contract={contract}
                design={choice[contract.id] ?? readyDesign(company) ?? defaultDesign(contract)}
                setDesign={(d) => setChoice({ ...choice, [contract.id]: d })}
                goTo={goTo}
                simulate={simulate}
              />
            );
            return signed.length === 1 ? (
              prep
            ) : (
              <Sheet open={sheet} onClose={() => setSheet(false)} title={contract.title}>
                {prep}
              </Sheet>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function Prep({ company, version, contract, design, setDesign, goTo, simulate }: { company: Company; version: number; contract: Contract; design: string; setDesign: (d: string) => void; goTo: Props["goTo"]; simulate: Props["simulate"] }) {
  // Signing is behind us here: drop the blocker that says so.
  const b = useMemo(() => {
    const raw = bid(company, contract.id, design);
    return { ...raw, blockers: raw.blockers.filter((t) => t !== "Already signed.") };
  }, [company, contract.id, design, version]);
  const v = company.designs[design]!;
  const built = company.inventory[design] ?? 0;
  const ready = readyDay(company, design);
  const onLine = company.orders.filter((o) => o.design === design).length;
  const turns = v.pitchProgram?.kind === "gravity-turn";
  const left = contract.deadline - company.day;

  return (
    <section className="grow row" aria-label={`Prepare ${contract.title}`}>
      <div className="card blueprint" style={{ flex: "0 0 auto", alignItems: "center", padding: "20px 36px 0" }}>
        <Rocket vehicle={v} scale={Math.min(26, 300 / height(v))} />
        <span style={{ height: 2, width: 110, background: "var(--line-strong)" }} />
        <span style={{ padding: "10px 0 14px" }}>{built > 0 ? <Chip tone="good">{built} READY</Chip> : onLine > 0 ? <Chip tone="warn">{`READY DAY ${ready}`}</Chip> : <Chip tone="muted">NONE BUILT</Chip>}</span>
      </div>
      <div className="grow card" style={{ flexBasis: 420 }}>
        <div className="stack" style={{ gap: 4 }}>
          <p className="label">{contract.customer}</p>
          <h2>{contract.title}</h2>
        </div>
        <DesignSelect label="Fly it on" value={design} onChange={setDesign} designs={company.designs} inventory={company.inventory} />
        <Facts
          items={[
            ["Payload", `${contract.payloadMass} kg`],
            ["Due", `day ${contract.deadline}`],
            ["Days left", <span className={left < COSTS.padDays ? "bad" : undefined}>{left}</span>],
            ["Launch", `${money(COSTS.launchFee)} · ${COSTS.padDays} d`],
          ]}
        />
        {ready === null && <Schedule day={company.day} deadline={contract.deadline} b={b} />}
        {ready !== null && ready > company.day && (
          <span className={ready + 7 > contract.deadline ? "bad" : "soft"}>
            A {v.name} is on the production line and rolls out on day {ready}
            {ready + 7 > contract.deadline ? ", too late for this contract." : `. Launching then still makes day ${contract.deadline}.`}
          </span>
        )}
        {contract.minApogee !== undefined && <span className="soft">Needs an apogee of {km(contract.minApogee, 0)}.</span>}
        {(contract.kind === "crew" || contract.kind === "cargo") && <StationNote company={company} design={design} crew={contract.kind === "crew"} />}
        <Findings b={b} />
        <Forecast b={b} />
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={ready === null || (contract.kind === "crew" && !crewRating(company, design, contract.mission).rated)}
            title={ready === null ? `Order a ${v.name} first` : contract.kind === "crew" && !crewRating(company, design, contract.mission).rated ? `The ${v.name} isn't crew-rated` : undefined}
            onClick={() => game.schedule(launchJob(company, design, contract, (r) => game.showFlight(r, design)))}
          >
            {ready !== null && ready > company.day ? `Launch on rollout · day ${ready}` : `Launch ${v.name}`}
          </button>
          <button type="button" className="btn" onClick={() => game.schedule(buildJob(company, design))}>
            Order · {money(b.build.cost)} · {b.build.days} d
          </button>
          {turns && contract.mission.target && (
            <button type="button" className="btn" onClick={() => game.schedule(retuneJob(company, design, contract))}>
              Re-tune for {contract.payloadMass} kg
            </button>
          )}
          <button type="button" className="btn" onClick={() => simulate({ design, contract: contract.id })}>
            Simulate
          </button>
          <button type="button" className="btn" onClick={() => goTo("stand")}>
            Plan tests
          </button>
        </div>
        {turns && contract.mission.target && (
          <span className="muted" style={{ fontSize: 14 }}>
            A re-tune flies the pitch programme against what tests have measured. Do it after the last test, before you launch.
          </span>
        )}
      </div>
    </section>
  );
}

/** What flying the capsule means for this launch: crew aboard and whether the rocket may carry them, or cargo. */
function StationNote({ company, design, crew }: { company: Company; design: string; crew: boolean }) {
  if (!company.capsule) return <span className="bad">This flight needs the company's capsule. Develop it from Hangar → Crew.</span>;
  if (!crew) return <span className="soft">The capsule flies with cargo and no crew, without its abort tower.</span>;
  const rating = crewRating(company, design, STATION);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span>
        <strong>{CAPSULE.crew} crew aboard</strong> <span className="soft">in the capsule, under its {CAPSULE.tower.mass} kg abort tower.</span>
      </span>
      {rating.rated ? <span className="good">Crew-rated.</span> : <span className="bad">Not crew-rated: {rating.missing.join(" · ")}</span>}
    </div>
  );
}
