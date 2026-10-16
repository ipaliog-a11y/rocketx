import { useMemo } from "react";
import type { Company } from "../../sim/company.ts";
import { COSTS } from "../../sim/cost.ts";
import { Campus } from "../components/Campus.tsx";
import { FirstRun } from "../components/FirstRun.tsx";
import { glyphKind, Icon, MissionGlyph } from "../components/Icon.tsx";
import { money } from "../format.ts";
import { useGame } from "../game.ts";
import { useGo } from "../nav.ts";
import { flightStatuses, nextUp, type FlightStatus } from "../nextUp.ts";

/** What the signed flights' standing depends on: when none of it changes, neither do their forecasts. */
function signature(c: Company): string {
  return [
    c.day,
    c.cash,
    c.accepted.join(","),
    c.done.length,
    c.orders.length,
    Object.values(c.inventory).join(","),
    Object.values(c.designs).map((d) => d.stages.map((s) => s.engine.name).join("+")).join(","),
    c.flights.length,
  ].join("|");
}

let cache: { company: Company; sig: string; statuses: FlightStatus[] } | null = null;

/** Each signed flight's bid flies a forecast, a few hundred ms: keep them until something they depend on changes. */
function statusesOf(company: Company): FlightStatus[] {
  const sig = signature(company);
  if (cache?.company !== company || cache.sig !== sig) cache = { company, sig, statuses: flightStatuses(company) };
  return cache.statuses;
}

/** A short tag for what each next-up item is about, in the part tree's manner. */
const TAGS: Record<string, string> = { forecast: "FCST", shape: "AERO", engine: "ENG", licence: "LIC", work: "BID", build: "BLD" };
const tagOf = (key: string) => TAGS[key.split(":")[0]!] ?? key.slice(0, 4).toUpperCase();

/** Home › Today: what needs the player, the signed flights, and the campus. */
export function Today({ company }: { company: Company }) {
  const { version } = useGame();
  const go = useGo();
  const statuses = useMemo(() => statusesOf(company), [company, version]);
  const items = useMemo(() => nextUp(company, statuses), [company, statuses]);

  return (
    <div className="today">
      <FirstRun company={company} />
      <section className="card today-next" aria-labelledby="next-up">
        <p className="label hdr-row" id="next-up">
          <span>Next up</span>
          <span>NXT · {items.length}</span>
        </p>
        <ul className="next-rows">
          {items.map((item) => (
            <li key={item.key} className={`next-row tone-${item.tone}`}>
              <span className="next-tag mono" aria-hidden="true">
                {tagOf(item.key)}
              </span>
              <span className="next-words">
                <strong>{item.title}</strong>
                <span className="muted">{item.text}</span>
              </span>
              <span className="next-verbs">
                <button type="button" className="btn quiet" onClick={() => go(item.action.route)}>
                  {item.action.label}
                  <Icon name="next" size="sm" />
                </button>
                {item.alt && (
                  <button type="button" className="btn quiet" onClick={() => go(item.alt!.route)}>
                    {item.alt.label}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card today-flights" aria-labelledby="signed-flights">
        <p className="label hdr-row" id="signed-flights">
          <span>Signed flights</span>
          <span>FLT · {statuses.length}</span>
        </p>
        {statuses.length === 0 ? (
          <span className="muted">Nothing signed yet. Contracts on the board pay on delivery.</span>
        ) : (
          <div className="table-wrap flush">
            <table className="spec">
              <thead>
                <tr>
                  <th scope="col">Contract</th>
                  <th scope="col">Road to the pad</th>
                  <th scope="col" className="num">
                    Pays
                  </th>
                  <th scope="col" className="num">
                    Due
                  </th>
                </tr>
              </thead>
              <tbody>
                {statuses.map((s) => (
                  <Pipeline key={s.contract.id} company={company} status={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card today-campus" aria-labelledby="campus-head">
        <p className="label hdr-row" id="campus-head">
          <span>Port Avery</span>
          <span>SITE-1</span>
        </p>
        <Campus company={company} />
      </section>
    </div>
  );
}

type Step = { label: string; state: "done" | "now" | "todo" | "bad" };

const MARK: Record<Step["state"], string> = { done: "■", now: "■", todo: "□", bad: "▲" };

/** One signed flight's road to the pad: tested, built, forecast to deliver, flown. */
function Pipeline({ company, status: s }: { company: Company; status: FlightStatus }) {
  const go = useGo();
  const c = s.contract;
  const v = company.designs[s.design]!;
  const toTest = s.engines.size + (s.aero.length > 0 ? 1 : 0);
  const built = s.ready !== null && s.ready <= company.day;
  const left = c.deadline - company.day;
  const steps: Step[] = [
    { label: toTest === 0 ? "Tested" : `${toTest} to test`, state: toTest === 0 ? "done" : "now" },
    { label: built ? "Built" : s.ready !== null ? `Built d${s.ready}` : "Not built", state: built ? "done" : s.ready !== null ? "now" : s.bid.fitsSchedule ? "todo" : "bad" },
    { label: s.bid.forecast.delivers ? "Forecast ✓" : "Forecast ✗", state: s.bid.forecast.delivers ? "done" : "bad" },
    { label: "Launch", state: built && s.bid.forecast.delivers && toTest === 0 ? "now" : "todo" },
  ];
  const next = steps.find((st) => st.state !== "done") ?? steps.at(-1)!;
  const late = left < COSTS.padDays + 14;
  return (
    <tr className="clickable" onClick={() => go({ place: "launch", contract: c.id })}>
      <td>
        <button type="button" className="row-link" onClick={(e) => (e.stopPropagation(), go({ place: "launch", contract: c.id }))}>
          <MissionGlyph kind={glyphKind(c.mission, c.kind)} size={28} />
          <span className="stack" style={{ gap: 0 }}>
            <strong>{c.title}</strong>
            <span className="muted">{v.name}</span>
          </span>
        </button>
      </td>
      <td>
        <span className="steps mono" role="img" aria-label={steps.map((st) => st.label).join(", ")}>
          {steps.map((st) => (
            <span key={st.label} className={`step ${st.state}`} title={st.label}>
              {MARK[st.state]}
            </span>
          ))}
        </span>
        <span className={`step-now ${next.state}`}>{next.label}</span>
      </td>
      <td className="num good">{money(c.payout)}</td>
      <td className={`num ${late ? "bad" : ""}`}>
        {late ? "▲ " : ""}D {c.deadline}
        <span className="muted step-left">{left} d left</span>
      </td>
    </tr>
  );
}
