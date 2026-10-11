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
import { Launch } from "./screens/Launch.tsx";
import { NewGame } from "./screens/NewGame.tsx";
import { TestStand } from "./screens/TestStand.tsx";
import { Tunnel } from "./screens/Tunnel.tsx";
import { WorkStrip } from "./screens/Work.tsx";

type Screen = "company" | "contracts" | "launch" | "hangar" | "stand" | "tunnel";

/** Each screen: its label, a shorter one for the phone's tab bar, and a line-drawn icon (24-unit box). */
const SCREENS: Array<[Screen, string, string, string]> = [
  ["company", "Company", "Company", "M4 21V8l8-5 8 5v13M9 21v-6h6v6M3 21h18"],
  ["contracts", "Contracts", "Contracts", "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"],
  ["launch", "Launch", "Launch", "M12 2c3 3 4 7 4 11l-4 3-4-3c0-4 1-8 4-11zM8 13l-3 4 3 1M16 13l3 4-3 1M10 19l2 3 2-3"],
  ["hangar", "Hangar", "Hangar", "M3 21V10l9-6 9 6v11M7 21v-8h10v8M7 17h10"],
  ["stand", "Test stand", "Stand", "M12 3c2 3 4 5 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-2-1-4 0-7zM6 21h12M9 17v4M15 17v4"],
  ["tunnel", "Tunnel", "Tunnel", "M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h9"],
];

export function App() {
  const state = useGame();
  const [screen, setScreen] = useState<Screen>("company");
  const [companyTab, setCompanyTab] = useState<CompanyTab>("overview");
  const company = state.company;
  if (!company) return <NewGame />;

  const rep = reputation(company);
  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => (game.closeFlight(), setScreen("company"))}>
          {company.name}
        </button>
        <nav className="nav" aria-label="Sections">
          {SCREENS.map(([id, label, short, icon]) => (
            <button key={id} type="button" aria-label={label} aria-current={!state.flight && screen === id ? "page" : undefined} onClick={() => (game.closeFlight(), setScreen(id), window.scrollTo(0, 0))}>
              <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d={icon} />
              </svg>
              <span className="nav-long">{label}</span>
              <span className="nav-short" aria-hidden="true">
                {short}
              </span>
            </button>
          ))}
        </nav>
        <dl className="stats">
          <div>
            <dt>DAY</dt>
            <dd>{company.day}</dd>
          </div>
          <div>
            <dt>CASH</dt>
            <dd className={company.cash < 2_000 ? "bad" : undefined}>{money(company.cash)}</dd>
          </div>
          <div className="stat-licence">
            <dt>LICENCE</dt>
            <dd>{LICENCE_LABELS[company.licence].toUpperCase()}</dd>
          </div>
          <div>
            <dt>
              <span className="nav-long">REPUTATION</span>
              <span className="nav-short">REP</span>
            </dt>
            <dd className={rep > 0 ? "good" : rep < 0 ? "bad" : undefined}>{signed(rep)}</dd>
          </div>
        </dl>
      </header>
      <WorkStrip company={company} open={() => (game.closeFlight(), setCompanyTab("work"), setScreen("company"))} />

      {state.flight ? (
        <Flight key={state.flight.id} report={state.flight.report} design={state.flight.design} />
      ) : (
        <>
          {screen === "company" && <Company company={company} tab={companyTab} setTab={setCompanyTab} />}
          {screen === "contracts" && <Contracts company={company} version={state.version} goTo={setScreen} />}
          {screen === "launch" && <Launch company={company} version={state.version} goTo={setScreen} />}
          {screen === "hangar" && <Hangar company={company} />}
          {screen === "stand" && <TestStand company={company} />}
          {screen === "tunnel" && <Tunnel company={company} />}
        </>
      )}

      <div className="notices" aria-live="polite">
        {state.notices.map((n) => (
          <div key={n.id} className={`notice ${n.tone === "info" ? "" : n.tone}`}>
            <span>{n.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => game.dismiss(n.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      {state.pending && !company.dead && <JobConfirm company={company} job={state.pending} />}
      {state.progress && <JobProgress key={state.progress.id} progress={state.progress} />}

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
