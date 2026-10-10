import { useState } from "react";
import { reputation, summary } from "../sim/company.ts";
import { LICENCE_LABELS } from "../sim/licence.ts";
import { JobConfirm, JobProgress } from "./components/JobDialogs.tsx";
import { game, useGame } from "./game.ts";
import { money, signed } from "./format.ts";
import { Company } from "./screens/Company.tsx";
import { Contracts } from "./screens/Contracts.tsx";
import { Flight } from "./screens/Flight.tsx";
import { Hangar } from "./screens/Hangar.tsx";
import { Launch } from "./screens/Launch.tsx";
import { NewGame } from "./screens/NewGame.tsx";
import { TestStand } from "./screens/TestStand.tsx";
import { Tunnel } from "./screens/Tunnel.tsx";

type Screen = "company" | "contracts" | "launch" | "hangar" | "stand" | "tunnel";

const SCREENS: Array<[Screen, string]> = [
  ["company", "Company"],
  ["contracts", "Contracts"],
  ["launch", "Launch"],
  ["hangar", "Hangar"],
  ["stand", "Test stand"],
  ["tunnel", "Tunnel"],
];

export function App() {
  const state = useGame();
  const [screen, setScreen] = useState<Screen>("company");
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
          {SCREENS.map(([id, label]) => (
            <button key={id} type="button" aria-current={!state.flight && screen === id ? "page" : undefined} onClick={() => (game.closeFlight(), setScreen(id))}>
              {label}
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
          <div>
            <dt>LICENCE</dt>
            <dd>{LICENCE_LABELS[company.licence].toUpperCase()}</dd>
          </div>
          <div>
            <dt>REPUTATION</dt>
            <dd className={rep > 0 ? "good" : rep < 0 ? "bad" : undefined}>{signed(rep)}</dd>
          </div>
        </dl>
      </header>

      {state.flight ? (
        <Flight key={state.flight.id} report={state.flight.report} design={state.flight.design} />
      ) : (
        <>
          {screen === "company" && <Company company={company} />}
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
