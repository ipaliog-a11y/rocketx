import { useCallback, useState } from "react";
import { reputation, summary } from "../sim/company.ts";
import { LICENCE_LABELS } from "../sim/licence.ts";
import { JobConfirm, JobProgress } from "./components/JobDialogs.tsx";
import { game, useGame } from "./game.ts";
import { money, signed } from "./format.ts";
import { Home } from "./screens/Company.tsx";
import { Contracts } from "./screens/Contracts.tsx";
import { Flight } from "./screens/Flight.tsx";
import { Rockets } from "./screens/Hangar.tsx";
import { NavContext, type Place, type Route } from "./nav.ts";
import { Launch } from "./screens/Launch.tsx";
import { NewGame } from "./screens/NewGame.tsx";
import { TestStand } from "./screens/TestStand.tsx";
import { WorkStrip } from "./screens/Work.tsx";
import { Icon, type IconName } from "./components/Icon.tsx";
import { Ticker } from "./components/Ticker.tsx";
import { FiringMoment } from "./components/FiringMoment.tsx";
import { MilestoneBanner } from "./components/Milestone.tsx";
import { useHold } from "./motion.ts";
import { AdvanceButton } from "./components/AdvanceButton.tsx";
import { HelpButton, HelpDialog } from "./components/Help.tsx";

/** Each place: its label, a shorter one for the phone's tab bar, and its icon. */
const PLACES: Array<[Place, string, string, IconName]> = [
  ["home", "Home", "Home", "home"],
  ["contracts", "Contracts", "Contracts", "contract"],
  ["rockets", "Rockets", "Rockets", "rocket"],
  ["testing", "Testing", "Testing", "stand"],
  ["launch", "Launch", "Launch", "pad"],
];

export function App() {
  const state = useGame();
  const [route, setRoute] = useState<Route>({ place: "home" });
  const go = useCallback((to: Route) => {
    game.closeFlight();
    setRoute({ ...to });
    window.scrollTo(0, 0);
  }, []);
  const routeKey = JSON.stringify(route);
  const company = state.company;
  // While a launch plays, the top bar keeps its money and reputation back for the debrief.
  const cash = useHold(company?.cash ?? 0, state.cinema);
  const shownRep = useHold(company ? reputation(company) : 0, state.cinema);
  if (!company) return <NewGame />;
  return (
    <NavContext.Provider value={go}>
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => go({ place: "home" })}>
          {company.name}
        </button>
        <nav className="nav" aria-label="Sections">
          {PLACES.map(([id, label, short, icon]) => (
            <button key={id} type="button" aria-label={label} aria-current={!state.flight && route.place === id ? "page" : undefined} onClick={() => go({ place: id })}>
              <Icon name={icon} className="nav-icon" />
              <span className="nav-long">{label}</span>
              <span className="nav-short" aria-hidden="true">
                {short}
              </span>
            </button>
          ))}
        </nav>
        <dl className="stats">
          <div title="Day">
            <dt>
              <Icon name="day" size="sm" />
              <span className="sr-only">Day</span>
            </dt>
            <dd>
              <Ticker value={company.day} format={(d) => String(Math.round(d))} ms={500} />
            </dd>
          </div>
          <div title="Cash">
            <dt>
              <Icon name="money" size="sm" />
              <span className="sr-only">Cash</span>
            </dt>
            <dd className={cash < 2_000 ? "bad" : undefined}>
              <Ticker value={cash} format={money} delta={(d) => `${d > 0 ? "+" : "−"}${money(Math.abs(d))}`} />
            </dd>
          </div>
          <div className="stat-licence" title="Launch license">
            <dt>
              <Icon name="licence" size="sm" />
              <span className="sr-only">Licence</span>
            </dt>
            <dd>{LICENCE_LABELS[company.licence].toUpperCase()}</dd>
          </div>
          <div title="Reputation">
            <dt>
              <Icon name="reputation" size="sm" />
              <span className="sr-only">Reputation</span>
            </dt>
            <dd className={shownRep > 0 ? "good" : shownRep < 0 ? "bad" : undefined}>
              <Ticker value={shownRep} format={(r) => signed(Math.round(r))} delta={(d) => signed(d)} />
            </dd>
          </div>
        </dl>
        <HelpButton />
        <AdvanceButton company={company} />
      </header>
      <WorkStrip company={company} open={() => go({ place: "home", tab: "work" })} />

      {state.flight ? (
        <Flight key={`flight-${state.flight.id}`} report={state.flight.report} design={state.flight.design} />
      ) : (
        <>
          {route.place === "home" && <Home key={routeKey} company={company} route={route} />}
          {route.place === "contracts" && <Contracts key={routeKey} company={company} version={state.version} route={route} />}
          {route.place === "rockets" && <Rockets key={routeKey} company={company} route={route} />}
          {route.place === "testing" && <TestStand key={routeKey} company={company} route={route} />}
          {route.place === "launch" && <Launch key={routeKey} company={company} version={state.version} route={route} />}
        </>
      )}

      <div className="notices" aria-live="polite">
        {state.notices.map((n) => (
          <div key={n.id} className={`notice ${n.tone === "info" ? "" : n.tone} ${n.title ? "result" : ""} ${n.leaving ? "leaving" : ""}`}>
            {n.title ? (
              <span className="notice-words">
                <span>{n.title}</span>
                <small>{n.sub}</small>
              </span>
            ) : (
              <span>{n.text}</span>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => game.dismiss(n.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <HelpDialog company={company} />
      {state.pending && !company.dead && <JobConfirm company={company} job={state.pending} />}
      {state.progress && <JobProgress key={`progress-${state.progress.id}`} progress={state.progress} />}
      {state.moment && !state.progress && <FiringMoment key={`moment-${state.moment.id}`} moment={state.moment} />}
      {state.milestones[0] && !state.progress && !state.moment && !state.pending && !state.cinema && <MilestoneBanner key={`milestone-${state.milestones[0].id}`} milestone={state.milestones[0]} />}

      {company.dead && !state.flight && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="The run is over">
          <div className="card">
            <h2 className="bad" style={{ fontSize: 30 }}>
              The company is finished
            </h2>
            <pre className="report">{summary(company)}</pre>
            <div className="actions">
              <button type="button" className="btn primary" onClick={() => game.quit()}>
                Start a new run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </NavContext.Provider>
  );
}
