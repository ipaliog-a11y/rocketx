import { useState } from "react";
import { reputation, summary } from "../sim/company.ts";
import { COSTS } from "../sim/cost.ts";
import { BuildConfirm } from "./components/BuildConfirm.tsx";
import { game, useGame } from "./game.ts";
import { money, signed } from "./format.ts";
import { Board } from "./screens/Board.tsx";
import { Flight } from "./screens/Flight.tsx";
import { Hangar } from "./screens/Hangar.tsx";
import { Ledger } from "./screens/Ledger.tsx";
import { NewGame } from "./screens/NewGame.tsx";
import { TestStand } from "./screens/TestStand.tsx";
import { Tunnel } from "./screens/Tunnel.tsx";

type Screen = "board" | "hangar" | "stand" | "tunnel" | "ledger";

const SCREENS: Array<[Screen, string]> = [
  ["board", "Board"],
  ["hangar", "Hangar"],
  ["stand", "Test stand"],
  ["tunnel", "Tunnel"],
  ["ledger", "Ledger"],
];

export function App() {
  const state = useGame();
  const [screen, setScreen] = useState<Screen>("board");
  const [confirmQuit, setConfirmQuit] = useState(false);
  const company = state.company;
  if (!company) return <NewGame />;

  const rep = reputation(company);
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Untitled Launch Co.</div>
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
            <dt>BURN</dt>
            <dd>{money(COSTS.overheadPerDay)}/day</dd>
          </div>
          <div>
            <dt>REPUTATION</dt>
            <dd className={rep > 0 ? "good" : rep < 0 ? "bad" : undefined}>{signed(rep)}</dd>
          </div>
        </dl>
        {confirmQuit ? (
          <span className="actions">
            <span className="soft">Abandon this run?</span>
            <button type="button" className="btn" onClick={() => (setConfirmQuit(false), game.quit())}>
              Abandon
            </button>
            <button type="button" className="btn" onClick={() => setConfirmQuit(false)}>
              Keep playing
            </button>
          </span>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirmQuit(true)}>
            New run
          </button>
        )}
      </header>

      {state.flight ? (
        <Flight key={state.flight.id} report={state.flight.report} design={state.flight.design} />
      ) : (
        <>
          {screen === "board" && <Board company={company} version={state.version} goTo={setScreen} />}
          {screen === "hangar" && <Hangar company={company} />}
          {screen === "stand" && <TestStand company={company} />}
          {screen === "tunnel" && <Tunnel company={company} />}
          {screen === "ledger" && <Ledger company={company} />}
        </>
      )}

      <div className="notices" aria-live="polite">
        {state.notices.map((n) => (
          <div key={n.id} className={`notice ${n.tone === "bad" ? "bad" : ""}`}>
            <span>{n.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => game.dismiss(n.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      {state.pendingBuild && !company.dead && <BuildConfirm company={company} designKey={state.pendingBuild} />}

      {state.busy && <div className="busy">{state.busy}</div>}

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
