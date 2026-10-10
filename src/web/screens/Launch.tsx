import { useMemo, useState } from "react";
import { bid, type Company } from "../../sim/company.ts";
import type { Contract } from "../../sim/contracts.ts";
import { COSTS } from "../../sim/cost.ts";
import { DesignSelect, Findings, Forecast, Schedule } from "../components/BidParts.tsx";
import { Chip, Facts } from "../components/Bits.tsx";
import { height, Rocket } from "../components/Rocket.tsx";
import { defaultDesign, game } from "../game.ts";
import { buildJob, launchJob, retuneJob, signedContracts } from "../jobs.ts";
import { km, money } from "../format.ts";

type Props = { company: Company; version: number; goTo: (screen: "contracts" | "stand" | "tunnel") => void };

/** Days left on a contract, coloured by whether a launch still fits. */
function countdown(company: Company, c: Contract): { text: string; tone: "good" | "warn" | "bad" } {
  const left = c.deadline - company.day;
  if (left < COSTS.padDays) return { text: `${left} D LEFT`, tone: "bad" };
  if (left < COSTS.padDays + 30) return { text: `${left} D LEFT`, tone: "warn" };
  return { text: `${left} D LEFT`, tone: "good" };
}

export function Launch({ company, version, goTo }: Props) {
  const signed = signedContracts(company);
  const [selected, setSelected] = useState<string | undefined>(signed[0]?.id);
  const contract = signed.find((c) => c.id === selected) ?? signed[0];
  const [choice, setChoice] = useState<Record<string, string>>({});

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
                  onClick={() => setSelected(c.id)}
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
          <Prep
            key={contract.id}
            company={company}
            version={version}
            contract={contract}
            design={choice[contract.id] ?? defaultDesign(contract)}
            setDesign={(d) => setChoice({ ...choice, [contract.id]: d })}
            goTo={goTo}
          />
        </div>
      )}
    </div>
  );
}

function Prep({ company, version, contract, design, setDesign, goTo }: { company: Company; version: number; contract: Contract; design: string; setDesign: (d: string) => void; goTo: Props["goTo"] }) {
  // Signing is behind us here: drop the blocker that says so.
  const b = useMemo(() => {
    const raw = bid(company, contract.id, design);
    return { ...raw, blockers: raw.blockers.filter((t) => t !== "Already signed.") };
  }, [company, contract.id, design, version]);
  const v = company.designs[design]!;
  const built = company.inventory[design] ?? 0;
  const turns = v.pitchProgram?.kind === "gravity-turn";
  const left = contract.deadline - company.day;

  return (
    <section className="grow row" aria-label={`Prepare ${contract.title}`}>
      <div className="card blueprint" style={{ flex: "0 0 auto", alignItems: "center", padding: "20px 36px 0" }}>
        <Rocket vehicle={v} scale={Math.min(26, 300 / height(v))} />
        <span style={{ height: 2, width: 110, background: "var(--line-strong)" }} />
        <span style={{ padding: "10px 0 14px" }}>{built > 0 ? <Chip tone="good">{built} READY</Chip> : <Chip tone="muted">NONE BUILT</Chip>}</span>
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
        {built === 0 && <Schedule day={company.day} deadline={contract.deadline} b={b} />}
        {contract.minApogee !== undefined && <span className="soft">Needs an apogee of {km(contract.minApogee, 0)}.</span>}
        <Findings b={b} />
        <Forecast b={b} />
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={built === 0}
            title={built === 0 ? `Build a ${v.name} first` : undefined}
            onClick={() => game.schedule(launchJob(company, design, contract, (r) => game.showFlight(r, design)))}
          >
            Launch {v.name}
          </button>
          <button type="button" className="btn" onClick={() => game.schedule(buildJob(company, design))}>
            Build · {money(b.build.cost)} · {b.build.days} d
          </button>
          {turns && contract.mission.target && (
            <button type="button" className="btn" onClick={() => game.schedule(retuneJob(company, design, contract))}>
              Re-tune for {contract.payloadMass} kg
            </button>
          )}
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
