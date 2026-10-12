import { useState } from "react";
import { reputation, summary } from "../sim/company.ts";
import { LICENCE_LABELS } from "../sim/licence.ts";
import { JobConfirm, JobProgress } from "./components/JobDialogs.tsx";
import { game, useGame } from "./game.ts";
import { money, signed } from "./format.ts";
import { Company, type CompanyTab } from "./screens/Company.tsx";
import { Contracts } from "./screens/Contracts.tsx";
import { Flight } from "./screens/Flight.tsx";
import { Hangar } from "./screens/Hangar.tsx";
import type { SimFocus } from "./screens/Simulator.tsx";
import { Launch } from "./screens/Launch.tsx";
import { NewGame } from "./screens/NewGame.tsx";
import { TestStand } from "./screens/TestStand.tsx";
import { Tunnel } from "./screens/Tunnel.tsx";
import { WorkStrip } from "./screens/Work.tsx";
import { Icon, type IconName } from "./components/Icon.tsx";
import { Ticker } from "./components/Ticker.tsx";
import { FiringMoment } from "./components/FiringMoment.tsx";
import { MilestoneBanner } from "./components/Milestone.tsx";
import { useHold } from "./motion.ts";

type Screen = "company" | "contracts" | "launch" | "hangar" | "stand" | "tunnel";

/** Each screen: its label, a shorter one for the phone's tab bar, and its icon. */
const SCREENS: Array<[Screen, string, string, IconName]> = [
  ["company", "Company", "Company", "company"],
  ["contracts", "Contracts", "Contracts", "contract"],
  ["launch", "Launch", "Launch", "launch"],
  ["hangar", "Hangar", "Hangar", "hangar"],
  ["stand", "Test stand", "Stand", "stand"],
  ["tunnel", "Tunnel", "Tunnel", "tunnel"],
];

export function App() {
  const state = useGame();
  const [screen, setScreen] = useState<Screen>("company");
  const [companyTab, setCompanyTab] = useState<CompanyTab>("overview");
  const [simFocus, setSimFocus] = useState<SimFocus | undefined>();
  const simulate = (focus: SimFocus) => (setSimFocus({ ...focus }), setScreen("hangar"), window.scrollTo(0, 0));
  const company = state.company;
  // While a launch plays, the top bar keeps its money and reputation back for the debrief.
  const cash = useHold(company?.cash ?? 0, state.cinema);
  const shownRep = useHold(company ? reputation(company) : 0, state.cinema);
  if (!company) return <NewGame />;
  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => (game.closeFlight(), setScreen("company"))}>
          {company.name}
        </button>
        <nav className="nav" aria-label="Sections">
          {SCREENS.map(([id, label, short, icon]) => (
            <button key={id} type="button" aria-label={label} aria-current={!state.flight && screen === id ? "page" : undefined} onClick={() => (game.closeFlight(), setSimFocus(undefined), setScreen(id), window.scrollTo(0, 0))}>
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
          <div className="stat-licence" title="Launch licence">
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
      </header>
      <WorkStrip company={company} open={() => (game.closeFlight(), setCompanyTab("work"), setScreen("company"))} />

      {state.flight ? (
        <Flight key={`flight-${state.flight.id}`} report={state.flight.report} design={state.flight.design} />
      ) : (
        <>
          {screen === "company" && <Company company={company} tab={companyTab} setTab={setCompanyTab} />}
          {screen === "contracts" && <Contracts company={company} version={state.version} goTo={setScreen} />}
          {screen === "launch" && <Launch company={company} version={state.version} goTo={setScreen} simulate={simulate} />}
          {screen === "hangar" && <Hangar key={JSON.stringify(simFocus ?? {})} company={company} focus={simFocus} />}
          {screen === "stand" && <TestStand company={company} />}
          {screen === "tunnel" && <Tunnel company={company} />}
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
  );
}
