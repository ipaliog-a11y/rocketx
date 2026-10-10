import { useState } from "react";
import { game } from "../game.ts";

export function NewGame() {
  const [seed, setSeed] = useState(() => 1 + Math.floor(Math.random() * 9999));
  return (
    <main className="screen" style={{ maxWidth: 760, margin: "0 auto", justifyContent: "center", gap: 24 }}>
      <p className="label">Untitled Launch Co.</p>
      <h1 style={{ fontSize: 44, lineHeight: 1.05 }}>You don't fly the rocket. You argue with physics until a contract can fly it.</h1>
      <p className="soft" style={{ fontSize: 19, margin: 0 }}>
        You are chief engineer of a launch startup with one pad, one test stand and a few million dollars. Fire engines, put shapes in the tunnel, sign contracts and watch the
        vehicle try. Every hidden flaw has a test that would have found it. Reach orbit before the money runs out.
      </p>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          game.start(seed);
        }}
      >
        <label className="stack" style={{ gap: 6 }}>
          <span className="soft">Seed: the situation you start in. The same seed always gives the same engines, airframes and board.</span>
          <span className="actions">
            <input type="number" min={1} value={seed} onChange={(e) => setSeed(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ width: 140 }} />
            <button type="button" className="btn" onClick={() => setSeed(1 + Math.floor(Math.random() * 9999))}>
              Random
            </button>
          </span>
        </label>
        <button type="submit" className="btn primary" style={{ alignSelf: "flex-start" }}>
          Found the company
        </button>
      </form>
    </main>
  );
}
