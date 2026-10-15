import { useEffect, useRef, useState } from "react";
import { droppedOldSave, game } from "../game.ts";
import { Icon, type IconName } from "../components/Icon.tsx";
import { reducedMotion } from "../motion.ts";
import type { PadScene } from "../scene/launchPad.ts";

const DEFAULT_NAME = "Untitled Launch Co.";

const STEPS: Array<[IconName, string]> = [
  ["stand", "Test engines"],
  ["contract", "Win contracts"],
  ["orbit", "Reach orbit"],
];

/** The title screen: the pad at dusk under changing cameras, a name, and a button. */
export function NewGame() {
  const [seed, setSeed] = useState(() => 1 + Math.floor(Math.random() * 9999));
  const [name, setName] = useState("");
  const [shots, setShots] = useState<string[]>([]);
  const [shot, setShot] = useState(0);
  const [failed, setFailed] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const pad = useRef<PadScene | null>(null);
  const shown = name.trim() || DEFAULT_NAME;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  // The scene is three.js, loaded only here so the game itself stays light.
  useEffect(() => {
    let gone = false;
    import("../scene/launchPad.ts")
      .then(({ mountLaunchPad, canDraw }) => {
        if (gone || !host.current) return;
        if (!canDraw()) return setFailed(true);
        const scene = mountLaunchPad(host.current, { reduced: reducedMotion(), name: shown, onShot: setShot });
        pad.current = scene;
        setShots(scene.shots);
        // The name is painted in the game's font once it has loaded.
        void document.fonts?.ready.then(() => !gone && scene.setName(shownRef.current));
      })
      .catch(() => setFailed(true));
    return () => {
      gone = true;
      pad.current?.dispose();
      pad.current = null;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => pad.current?.setName(shown), 120);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <main className="title-screen">
      <div className={`pad-stage ${failed ? "flat" : ""}`} ref={host} aria-hidden="true" />
      <div className="pad-shade" aria-hidden="true" />

      <header className="title-head">
        <p className="title-kicker">A launch company game</p>
        <h1 className="title-name">{shown}</h1>
        <p className="title-tag">Test it. Fly it. Reach orbit before the money runs out.</p>
      </header>

      {shots.length > 0 && (
        <div className="title-cams" role="group" aria-label="Cameras">
          <span className="cam-live">
            <span className="rec" aria-hidden="true" /> Cam {shot + 1} · {shots[shot]}
          </span>
          <span className="cam-dots">
            {shots.map((s, i) => (
              <button key={s} type="button" aria-label={`Camera ${i + 1}: ${s}`} aria-pressed={i === shot} onClick={() => pad.current?.cut(i)} />
            ))}
          </span>
        </div>
      )}

      <form
        className="title-form"
        onSubmit={(e) => {
          e.preventDefault();
          game.start(seed, name);
        }}
      >
        {droppedOldSave && <span className="warn">Your earlier run came from an older version and can't be carried over.</span>}
        <ul className="title-steps" aria-label="What you do">
          {STEPS.map(([icon, text]) => (
            <li key={text}>
              <Icon name={icon} />
              {text}
            </li>
          ))}
        </ul>
        <label className="stack" style={{ gap: 6 }}>
          <span className="title-field">Name your company</span>
          <input value={name} maxLength={40} placeholder={DEFAULT_NAME} onChange={(e) => setName(e.target.value)} className="name-input" />
        </label>
        <button type="submit" className="btn primary title-go">
          <Icon name="launch" />
          Found the company
        </button>
        <details className="title-seed">
          <summary>Seed {seed}</summary>
          <span className="actions" style={{ marginTop: 8 }}>
            <input type="number" min={1} value={seed} aria-label="Seed" onChange={(e) => setSeed(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ width: 120 }} />
            <button type="button" className="btn" onClick={() => setSeed(1 + Math.floor(Math.random() * 9999))}>
              Random
            </button>
          </span>
          <span className="muted" style={{ fontSize: 13 }}>The same seed always deals the same engines, airframes and contracts.</span>
        </details>
      </form>
    </main>
  );
}
