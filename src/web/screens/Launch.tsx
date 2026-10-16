import { useMemo, useState } from "react";
import { bid, nextBooster, readyDay, type Company } from "../../sim/company.ts";
import type { Contract } from "../../sim/contracts.ts";
import { CAPSULE, crewRating } from "../../sim/crew.ts";
import { STATION } from "../../missions.ts";
import { COSTS } from "../../sim/cost.ts";
import { BoosterNote, DesignSelect, Findings, Forecast, Schedule } from "../components/BidParts.tsx";
import { Chip, Facts, Tabs } from "../components/Bits.tsx";
import { height, Rocket } from "../components/Rocket.tsx";
import { game } from "../game.ts";
import { buildJob, designFor, launchJob, retuneJob, signedContracts } from "../jobs.ts";
import { km, money } from "../format.ts";
import { Sheet } from "../components/Sheet.tsx";
import { useGo, type Route } from "../nav.ts";
import { Factory } from "./Factory.tsx";
import { Crew } from "./Crew.tsx";
import { glyphKind, Icon, MissionGlyph } from "../components/Icon.tsx";
import { Info } from "../components/Info.tsx";

type Props = { company: Company; version: number; route: Route };
type Tab = "flights" | "factory" | "crew";

/** What each tab is for, behind the ⓘ beside the title. */
const LAUNCH_INTROS: Record<Tab, string> = {
  flights: "Your signed contracts: build the vehicle, re-tune it for the payload, and fly before the deadline. Missing a deadline costs the penalty and reputation.",
  factory: "Vehicles are built on production lines while the company gets on with everything else. Orders go to the line that frees up first and roll out on their ready day. More lines build more vehicles at once, and each repeat of a design builds faster.",
  crew: `A ${CAPSULE.mass.toLocaleString("en-US")} kg capsule for ${CAPSULE.crew} crew under a ${CAPSULE.tower.mass} kg abort tower, dropped at T+${CAPSULE.tower.jettisonAt} s. If the rocket fails, the tower pulls the capsule clear and it comes down on parachutes, if the abort system works. Station cargo flies the same capsule without crew or tower.`,
};

/** Days left on a contract, coloured by whether a launch still fits. */
function countdown(company: Company, c: Contract): { text: string; tone: "good" | "warn" | "bad" } {
  const left = c.deadline - company.day;
  if (left < COSTS.padDays) return { text: `${left} D LEFT`, tone: "bad" };
  if (left < COSTS.padDays + 30) return { text: `${left} D LEFT`, tone: "warn" };
  return { text: `${left} D LEFT`, tone: "good" };
}

/** Launch: build it and fly it. The signed flights, the factory, and the crew side. */
export function Launch({ company, version, route }: Props) {
  const first = (["flights", "factory", "crew"] as const).find((t) => t === route.tab) ?? "flights";
  const [tab, setTab] = useState<Tab>(first);
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>
          Launch
          <Info label="About this page">{LAUNCH_INTROS[tab]}</Info>
        </h1>
        <Tabs<Tab>
          label="Launch views"
          value={tab}
          onChange={setTab}
          tabs={[
            ["flights", signedContracts(company).length > 0 ? `Flights · ${signedContracts(company).length}` : "Flights"],
            ["factory", company.orders.length > 0 ? `Factory · ${company.orders.length}` : "Factory"],
            ["crew", "Crew"],
          ]}
        />
      </div>
      {tab === "flights" && <Flights company={company} version={version} route={route} />}
      {tab === "factory" && <Factory company={company} />}
      {tab === "crew" && <Crew company={company} />}
    </div>
  );
}

function Flights({ company, version, route }: Props) {
  const go = useGo();
  const signed = signedContracts(company);
  const [selected, setSelected] = useState<string | undefined>(route.contract && signed.some((c) => c.id === route.contract) ? route.contract : signed[0]?.id);
  const contract = signed.find((c) => c.id === selected) ?? signed[0];
  const [choice, setChoice] = useState<Record<string, string>>(route.contract && route.design ? { [route.contract]: route.design } : {});
  // On a phone the launch preparation opens over the list once a contract is picked, or straight away when a link sent us to one.
  const [sheet, setSheet] = useState(route.contract !== undefined);

  return (
    <>
      {signed.length === 0 || !contract ? (
        <div className="card" style={{ alignItems: "flex-start" }}>
          <h2>Nothing signed</h2>
          <span className="soft">Sign a contract on the Contracts page, then come back here to fly it.</span>
          <button type="button" className="btn primary" onClick={() => go({ place: "contracts" })}>
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
                  className="card glyph-card pickable"
                  style={{ textAlign: "left", cursor: "pointer", gap: 6, color: "var(--text)", font: "inherit" }}
                >
                  <MissionGlyph kind={glyphKind(c.mission, c.kind)} size={44} />
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
                design={choice[contract.id] ?? designFor(company, contract)}
                setDesign={(d) => setChoice({ ...choice, [contract.id]: d })}
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
    </>
  );
}

function Prep({ company, version, contract, design, setDesign }: { company: Company; version: number; contract: Contract; design: string; setDesign: (d: string) => void }) {
  const go = useGo();
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
  // A flown booster is stacked and a new one is on the ground too: the player can pick the new one.
  const [newBooster, setNewBooster] = useState(false);
  const booster = b.booster ? nextBooster(company, design, contract) : null;
  const canChoose = !!booster?.serial && booster.fresh > 0 && !booster.cautious;

  return (
    <section className="grow row" aria-label={`Prepare ${contract.title}`}>
      <div className="card blueprint" style={{ flex: "0 0 auto", alignItems: "center", padding: "20px 36px 0" }}>
        <Rocket vehicle={v} scale={Math.min(26, 300 / height(v))} />
        <span style={{ height: 2, width: 110, background: "var(--line-strong)" }} />
        <span style={{ padding: "10px 0 14px" }}>{built > 0 ? <Chip tone="good">{built} READY</Chip> : onLine > 0 ? <Chip tone="warn">{`READY DAY ${ready}`}</Chip> : <Chip tone="muted">NONE BUILT</Chip>}</span>
      </div>
      <div className="grow card" style={{ flexBasis: 420 }}>
        <p className="label hdr-row">
          <span>Flight prep · {contract.customer}</span>
          <span className="mono">{contract.id.toUpperCase()}</span>
        </p>
        <div className="sheet-title">
          <h2>{contract.title}</h2>
        </div>
        <DesignSelect label="Fly it on" value={design} onChange={setDesign} designs={company.designs} inventory={company.inventory} />
        <Facts
          items={[
            ["Payload", `${contract.payloadMass} kg`],
            ["Due", `day ${contract.deadline}`],
            ["Days left", <span className={left < COSTS.padDays ? "bad" : undefined}>{left}</span>],
            ["Launch", `${money(COSTS.launchFee)} · ${COSTS.padDays} d`],
            ...(contract.minApogee !== undefined ? [["Apogee", `≥ ${km(contract.minApogee, 0)}`] as [string, string]] : []),
          ]}
        />
        {ready === null && <Schedule day={company.day} deadline={contract.deadline} b={b} />}
        {ready !== null && ready > company.day && (
          <span className={ready + 7 > contract.deadline ? "bad" : "soft"}>
            A {v.name} is on the production line and rolls out on day {ready}
            {ready + 7 > contract.deadline ? ", too late for this contract." : `. Launching then still makes day ${contract.deadline}.`}
          </span>
        )}
        {(contract.kind === "crew" || contract.kind === "cargo") && <StationNote company={company} design={design} crew={contract.kind === "crew"} />}
        <Findings b={b} />
        <BoosterNote b={b} />
        {canChoose && (
          <label className="with-icon" style={{ gap: 8 }}>
            <input type="checkbox" checked={newBooster} onChange={(e) => setNewBooster(e.target.checked)} />
            <span>Fly a new booster instead of {booster!.serial}</span>
          </label>
        )}
        <Forecast b={b} />
        <div className="verb-group">
          <button
            type="button"
            className="btn primary"
            disabled={ready === null || (contract.kind === "crew" && !crewRating(company, design, contract.mission).rated)}
            title={ready === null ? `Order a ${v.name} first` : contract.kind === "crew" && !crewRating(company, design, contract.mission).rated ? `The ${v.name} isn't crew-rated` : undefined}
            onClick={() => game.schedule(launchJob(company, design, contract, (r) => game.showFlight(r, design), canChoose && newBooster))}
          >
            {ready !== null && ready > company.day ? `Launch on rollout` : `Launch ${v.name}`}
            <span className="note">{ready === null ? "order one first" : ready > company.day ? `day ${ready}` : `${money(COSTS.launchFee)} · ${COSTS.padDays} d`}</span>
          </button>
          <button type="button" className="btn" onClick={() => game.schedule(buildJob(company, design))}>
            Order a {v.name} <span className="note">{money(b.build.cost)} · {b.build.days} d</span>
          </button>
          {turns && contract.mission.target && (
            <span className="with-icon">
              <button type="button" className="btn" style={{ flex: 1 }} onClick={() => game.schedule(retuneJob(company, design, contract))}>
                Re-tune <span className="note">for {contract.payloadMass} kg</span>
              </button>
              <Info label="About re-tuning">A re-tune works out the steering against what tests have measured, for this payload and orbit. Do it after the last test, before you launch.</Info>
            </span>
          )}
        </div>
        <div className="verb-row">
          <button type="button" className="btn quiet" onClick={() => go({ place: "rockets", tab: "sim", design, contract: contract.id })}>
            <Icon name="simulate" size="sm" />
            Simulate
          </button>
          {contract.kind !== "crew" && (
            <button type="button" className="btn quiet" onClick={() => go({ place: "rockets", tab: "board", contract: contract.id })}>
              <Icon name="rocket" size="sm" />
              Suggest a rocket
            </button>
          )}
          <button type="button" className="btn quiet" onClick={() => go({ place: "testing" })}>
            <Icon name="stand" size="sm" />
            Plan tests
          </button>
        </div>
      </div>
    </section>
  );
}

/** What flying the capsule means for this launch: crew aboard and whether the rocket may carry them, or cargo. */
function StationNote({ company, design, crew }: { company: Company; design: string; crew: boolean }) {
  if (!company.capsule) return <span className="bad">This flight needs the company's capsule. Develop it from Launch › Crew.</span>;
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
