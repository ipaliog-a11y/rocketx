import { useMemo, useState } from "react";
import { readyDay, type Company } from "../../sim/company.ts";
import { marketOf } from "../../sim/market.ts";
import { batchMass, charterProblem, NETWORK, orderSatellites, paperCapacity, revenueFor, working } from "../../sim/network.ts";
import { Chip } from "../components/Bits.tsx";
import { Info } from "../components/Info.tsx";
import { money } from "../format.ts";
import { game } from "../game.ts";
import { buildJob, charterJob, deployJob, retuneDeployJob } from "../jobs.ts";

/** The company's own constellation: charter it, buy satellites, launch them, and watch the service. */
export function Network({ company, version }: { company: Company; version: number }) {
  const network = company.network;
  const problem = charterProblem(company);
  const chartering = company.tasks.find((t) => t.spec.kind === "charter");
  const live = working(network, company.day);
  const onOrder = (network?.orders ?? []).reduce((n, o) => n + o.count, 0);
  const [count, setCount] = useState(6);
  const orbital = Object.keys(company.designs).filter((k) => company.designs[k]!.pitchProgram?.kind === "gravity-turn");
  const carries = useMemo(() => Object.fromEntries(orbital.map((k) => [k, paperCapacity(company.designs[k]!)])), [version, orbital.join()]);

  return (
    <div className="row">
      <section className="grow stack" aria-label="Network">
        <div className="card">
          <p className="label hdr-row">
            <span className="with-icon">
              Company network
              <Info label="About the network">
                The company's own constellation at {NETWORK.km} km, {NETWORK.inclination}°. Satellites come from a supplier; your rockets put them up. Service starts with {NETWORK.minimum} working and pays in full ({money(NETWORK.fullRevenue)} a
                month) at {NETWORK.planned}. Satellites last about five years, a few fail early, so the network keeps needing launches. Ground operations cost {money(NETWORK.operations)} a month.
              </Info>
            </span>
            <span className="mono">NET-1</span>
          </p>
          {!network ? (
            <>
              <div className="booster-line">
                <span className={`stamp-tag ${chartering ? "next" : problem ? "locked" : "next"}`}>{chartering ? "IN WORK" : problem ? "LOCKED" : "OPEN"}</span>
                <span className="soft">
                  {chartering
                    ? `The office is chartering the network${chartering.endDay !== undefined ? `: done on day ${chartering.endDay}` : ""}.`
                    : problem ?? `Customers will pay for coverage. Market era ${marketOf(company).era}.`}
                </span>
              </div>
              {!chartering && (
                <div className="verb-group">
                  <button type="button" className="btn primary" disabled={problem !== null} onClick={() => game.schedule(charterJob())}>
                    Charter the network <span className="note">{problem ? "not yet" : `${money(NETWORK.charter.cost)} · ${NETWORK.charter.days} d`}</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <dl className="ro-row ro-4">
                <div className="ro">
                  <dt className="lbl">Working</dt>
                  <dd className={`val ${live >= NETWORK.minimum ? "good" : ""}`}>
                    {live}
                    <small>/ {NETWORK.planned}</small>
                  </dd>
                  <span className="ro-bar" aria-hidden="true">
                    <i className={live >= NETWORK.minimum ? "good" : undefined} style={{ width: `${Math.max(2, Math.min(100, (live / NETWORK.planned) * 100))}%` }} />
                  </span>
                  <span className="ro-sub">{live >= NETWORK.minimum ? "IN SERVICE" : `SERVICE AT ${NETWORK.minimum}`}</span>
                </div>
                <div className="ro">
                  <dt className="lbl">Service</dt>
                  <dd className="val">
                    {(revenueFor(live) / 1000).toFixed(2)}
                    <small>$M / mo</small>
                  </dd>
                  <span className="ro-sub">FULL {money(NETWORK.fullRevenue).toUpperCase()}</span>
                </div>
                <div className="ro">
                  <dt className="lbl">Waiting</dt>
                  <dd className="val">{network.stored}</dd>
                  <span className="ro-sub">DELIVERED, NOT FLOWN</span>
                </div>
                <div className="ro">
                  <dt className="lbl">On order</dt>
                  <dd className="val">{onOrder}</dd>
                  <span className="ro-sub">{network.orders[0] ? `NEXT D ${network.orders[0].readyDay}` : "NONE"}</span>
                </div>
              </dl>
            </>
          )}
        </div>

        {network && (
          <div className="card">
            <p className="label hdr-row">
              <span>Satellites</span>
              <span className="mono">
                {live} WORKING · {network.sats.length - live} LOST
              </span>
            </p>
            {network.sats.length === 0 ? (
              <span className="muted">None in orbit yet.</span>
            ) : (
              <ul className="part-rows two">
                {[...network.sats].reverse().map((s) => {
                  const dead = s.end <= company.day;
                  return (
                    <li key={s.id} className={`part-row ${dead ? "gone" : "tone-good"}`}>
                      <span className="part-tag">S{String(s.id).padStart(2, "0")}</span>
                      <div className="part-body">
                        <span className="part-sub">
                          UP D {s.launched} · {dead ? `STOPPED D ${s.end}` : `${company.day - s.launched} D IN ORBIT`}
                        </span>
                      </div>
                      <Chip tone={dead ? "muted" : "good"}>{dead ? "LOST" : "WORKING"}</Chip>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      {network && (
        <aside className="side stack">
          <div className="card">
            <p className="label hdr-row">
              <span>Order satellites</span>
              <span className="mono">{NETWORK.satMass} KG EACH</span>
            </p>
            <div className="booster-line">
              <span className="stepper" role="group" aria-label="Satellites to order" style={{ display: "inline-flex", flexDirection: "row", alignItems: "center", gap: 4 }}>
                <button type="button" className="btn" aria-label="Fewer" disabled={count <= 1} onClick={() => setCount(Math.max(1, count - 1))}>
                  −
                </button>
                <output className="mono" style={{ minWidth: 32, textAlign: "center", fontSize: 18 }}>
                  {count}
                </output>
                <button type="button" className="btn" aria-label="More" onClick={() => setCount(Math.min(30, count + 1))}>
                  +
                </button>
              </span>
              <span className="soft">delivered in {NETWORK.satDays} days</span>
            </div>
            <div className="verb-group">
              <button type="button" className="btn primary" onClick={() => game.act((c) => ({ text: orderSatellites(c, count), notices: [] }))}>
                Order {count} <span className="note">{money(count * NETWORK.satCost)}</span>
              </button>
            </div>
          </div>
          <div className="card">
            <p className="label hdr-row">
              <span className="with-icon">
                Launch a batch
                <Info label="About launching satellites">
                  A batch goes up in a {NETWORK.dispenser} kg dispenser. How many a rocket carries is the sizing guide's paper estimate, with typical engines and a margin; re-tune it for the batch before you fly, and the forecast at launch has the last word. Out of spec, the satellites spend half their life
                  reaching their slots.
                </Info>
              </span>
              <span className="mono">{network.stored} WAITING</span>
            </p>
            {orbital.length === 0 && <span className="muted">No orbital design yet.</span>}
            <ul className="part-rows">
              {orbital.map((key) => {
                const v = company.designs[key]!;
                const max = carries[key] ?? 0;
                const n = Math.min(max, network.stored);
                const ready = readyDay(company, key);
                return (
                  <li key={key} className={`part-row ${max > 0 ? "" : "gone"}`}>
                    <span className="part-tag">{(company.inventory[key] ?? 0) > 0 ? `${company.inventory[key]}×` : "—"}</span>
                    <div className="part-body">
                      <span>{v.name}</span>
                      <span className="part-sub">{max > 0 ? `ABOUT ${max} ON PAPER` : "CAN'T REACH THE NETWORK ORBIT"}</span>
                    </div>
                    <span />
                    {max > 0 && (
                      <div className="part-verbs">
                        {ready === null ? (
                          <button type="button" className="btn" onClick={() => game.schedule(buildJob(company, key))}>
                            Order one <span className="note">to fly a batch</span>
                          </button>
                        ) : (
                          <>
                            <button type="button" className="btn primary" disabled={n < 1} onClick={() => game.schedule(deployJob(company, key, n, (r) => game.showFlight(r, key)))}>
                              Launch {n} <span className="note">{n < 1 ? "none waiting" : ready > company.day ? `rollout D ${ready}` : `${(batchMass(n) / 1000).toFixed(2)} t`}</span>
                            </button>
                            <button type="button" className="btn quiet" disabled={n < 1} onClick={() => game.schedule(retuneDeployJob(company, key, Math.max(1, n)))}>
                              Re-tune <span className="note">for {Math.max(1, n)}</span>
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}
