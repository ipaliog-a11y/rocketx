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
        <p className="label" id="next-up">
          Next up · {items.length}
        </p>
        <ul className="next-list">
          {items.map((item) => (
            <li key={item.key} className={`next-item tone-${item.tone}`}>
              <button type="button" onClick={() => go(item.action.route)}>
                <span className="next-words">
                  <strong>{item.title}</strong>
                  <span className="muted">{item.text}</span>
                </span>
                <span className="next-go">
                  {item.action.label}
                  <Icon name="next" size="sm" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card today-flights" aria-labelledby="signed-flights">
        <p className="label" id="signed-flights">
          Signed flights · {statuses.length}
        </p>
        {statuses.length === 0 && <span className="muted">Nothing signed yet. Contracts on the board pay on delivery.</span>}
        <div className="pipelines">
          {statuses.map((s) => (
            <Pipeline key={s.contract.id} company={company} status={s} />
          ))}
        </div>
      </section>

      <section className="today-campus" aria-label="The campus">
        <p className="label">Port Avery</p>
        <Campus company={company} />
      </section>
    </div>
  );
}

type Step = { label: string; state: "done" | "now" | "todo" | "bad" };

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
  return (
    <button type="button" className="pipe glyph-card" onClick={() => go({ place: "launch", contract: c.id })}>
      <MissionGlyph kind={glyphKind(c.mission, c.kind)} size={40} />
      <span className="pipe-top">
        <strong>{c.title}</strong>
        <span className="mono good">{money(c.payout)}</span>
      </span>
      <span className="pipe-steps">
        {steps.map((st) => (
          <span key={st.label} className={`pipe-step ${st.state}`}>
            {st.label}
          </span>
        ))}
      </span>
      <span className={`pipe-meta ${left < COSTS.padDays + 14 ? "bad" : "muted"}`}>
        {v.name} · {left} days left · due day {c.deadline}
      </span>
    </button>
  );
}
