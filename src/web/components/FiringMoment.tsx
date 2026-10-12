import { useEffect, useRef, useState } from "react";
import type { Engine } from "../../sim/engine.ts";
import { FAILURE_LABELS } from "../../sim/hardware.ts";
import { FACILITIES, hardwareLoss, type TestReport } from "../../sim/teststand.ts";
import { game, type Moment } from "../game.ts";
import { money } from "../format.ts";
import { reducedMotion } from "../motion.ts";
import { COLORS } from "../palette.ts";
import { plannedBurn } from "../partTest.ts";
import { nozzleGeometry } from "./Rocket.tsx";

/** How long the playback runs, ms, whatever the firing's length. */
const PLAY_MS = 3200;

/** Thrust as a share of rated, against firing time: steady, and shaped by what went wrong and when. */
function thrust(report: TestReport, t: number): number {
  const f = report.findings[0];
  const ramp = Math.min(1, t / 0.8);
  const ripple = Math.sin(t * 3.1) * 0.6 + Math.sin(t * 7.7) * 0.3;
  if (f?.mode === "hard-start") return t < f.t ? ramp * 100 + (t / f.t) * 70 : 0;
  if (f && t >= f.t && f.mode !== "relight-failure") return 0;
  if (f?.mode === "combustion-instability" && t > f.t - 4) {
    const grow = (t - (f.t - 4)) / 4;
    return 100 + Math.sin(t * 19) * grow * 22 + ripple;
  }
  if (f?.mode === "burn-through" && t > f.t - 1.5) return 100 - ((t - (f.t - 1.5)) / 1.5) * 12 + ripple;
  return ramp * 100 + (t > 0.8 ? ripple : 0);
}

function verdict(report: TestReport, engine: Engine): { tone: "good" | "bad"; text: string } {
  const f = report.findings[0];
  if (f) {
    const loss = report.hardwareLost ? ` · test engine lost: ${money(hardwareLoss(engine).cost)} and ${hardwareLoss(engine).days} days` : "";
    return { tone: "bad", text: `${FAILURE_LABELS[f.mode].replace(/^./, (c) => c.toUpperCase())} at ${f.t.toFixed(1)} s${loss}` };
  }
  const isp = report.isp ? ` · Isp ${report.isp.measured >= report.isp.predicted ? "+" : "−"}${Math.abs((report.isp.measured / report.isp.predicted - 1) * 100).toFixed(1)}% against the drawings` : "";
  return { tone: "good", text: `Clean · ${report.fired.toFixed(0)} s proven${isp}` };
}

/**
 * A firing played back once it's done: the engine lights, thrust traces
 * across the planned seconds, and the verdict lands where the firing ended.
 * The timing is the real firing's; the trace's shape is drawn from what it found.
 */
export function FiringMoment({ moment }: { moment: Moment }) {
  const company = game.snapshot().company;
  const engine = company?.campaign.engines[moment.engine];
  const { report } = moment;
  const still = reducedMotion();
  const [k, setK] = useState(still ? 1 : 0);
  const [showReport, setShowReport] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    if (still) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const next = Math.min(1, (now - t0) / PLAY_MS);
      setK(next);
      if (next < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [still]);

  if (!engine || !company) return null;
  const done = k >= 1;
  const failed = report.findings.length > 0;
  const restart = report.findings.some((f) => f.mode === "relight-failure") || /clean restart/.test(report.text);
  const relit = /clean restart/.test(report.text);
  const burn = plannedBurn(company, engine);
  // The axis runs to the planned firing (and the restart after it), so a short run shows how short it fell.
  const span = Math.max(report.planned, report.fired, 2) * (restart ? 1.35 : 1);
  const t = report.fired * k;
  const firing = !done && (!failed || t < report.findings[0]!.t);
  const v = verdict(report, engine);

  // Thrust trace.
  const W = 400;
  const H = 150;
  const x = (s: number) => 34 + (s / span) * (W - 44);
  const y = (p: number) => H - 22 - (p / 140) * (H - 36);
  const pts: string[] = [`${x(0)},${y(0)}`];
  const stepS = Math.max(0.05, report.fired / 300);
  for (let s = 0; s <= t; s += stepS) pts.push(`${x(s).toFixed(1)},${y(thrust(report, s)).toFixed(1)}`);
  if (done || !firing) pts.push(`${x(Math.min(t, report.fired)).toFixed(1)},${y(0)}`);
  // The restart: a second, short burn after a coast, or a light that never catches.
  const restartAt = report.planned * 1.12;
  const second = done && restart ? (relit ? [restartAt, report.planned * 1.3] : [restartAt, restartAt + report.planned * 0.02]) : null;

  // Engine and plume.
  const size = 120;
  const g = nozzleGeometry(engine, size);
  const plumeLen = 130;
  const half = Math.max(8, g.exitWidth / 2);
  const plume = `M${g.cx - half} ${g.exitY} Q${g.cx - half * 0.7} ${g.exitY + plumeLen * 0.55} ${g.cx} ${g.exitY + plumeLen} Q${g.cx + half * 0.7} ${g.exitY + plumeLen * 0.55} ${g.cx + half} ${g.exitY}Z`;

  return (
    <div className="overlay moment-overlay" role="dialog" aria-modal="true" aria-label={`${engine.name} on the ${FACILITIES[report.facility === "flight" ? "sea-level" : report.facility].name}`}>
      <div className={`card moment ${done && failed ? "failed" : ""}`}>
        {done && failed && !still && <div className="moment-flash" aria-hidden="true" />}
        <div className="moment-head">
          <p className="label">
            Hot fire · {engine.name} · {report.facility === "flight" ? "flight" : FACILITIES[report.facility].name}
          </p>
          {!done && (
            <button type="button" className="btn quiet" onClick={() => (cancelAnimationFrame(raf.current), setK(1))}>
              Skip
            </button>
          )}
        </div>
        <div className="moment-body">
          <svg className="moment-engine" viewBox={`0 0 ${size} ${g.exitY + plumeLen + 4}`} width={size} height={g.exitY + plumeLen + 4} aria-hidden="true">
            <defs>
              <linearGradient id="plume-ok" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff6e0" />
                <stop offset="0.3" stopColor={COLORS.action} />
                <stop offset="0.8" stopColor={COLORS.data} stopOpacity="0.45" />
                <stop offset="1" stopColor={COLORS.data} stopOpacity="0" />
              </linearGradient>
            </defs>
            {firing && <path className="plume" d={plume} fill="url(#plume-ok)" />}
            <path d={g.d} fill={COLORS.raised} stroke={done && failed ? COLORS.bad : COLORS.data} strokeWidth={1.6} />
          </svg>
          <div className="moment-data">
            <div className="moment-clock">
              <span className="mono">T+{t.toFixed(1)} s</span>
              <span className="mono muted">{firing ? `${Math.round(thrust(report, t))}% thrust` : done ? "shut down" : "out"}</span>
            </div>
            <svg className="moment-trace" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Thrust against time">
              {[50, 100].map((p) => (
                <line key={p} x1={34} x2={W - 10} y1={y(p)} y2={y(p)} stroke={COLORS.line} />
              ))}
              <line x1={34} x2={34} y1={8} y2={H - 22} stroke={COLORS.lineStrong} />
              <line x1={34} x2={W - 10} y1={H - 22} y2={H - 22} stroke={COLORS.lineStrong} />
              <text x={4} y={y(100) + 4} fill={COLORS.muted} fontSize={10}>
                100%
              </text>
              <text x={34} y={H - 6} fill={COLORS.muted} fontSize={10}>
                0 s
              </text>
              <text x={W - 10} y={H - 6} fill={COLORS.muted} fontSize={10} textAnchor="end">
                {Math.round(report.planned)} s planned
              </text>
              {burn > 0 && burn <= span && (
                <g>
                  <line x1={x(burn)} x2={x(burn)} y1={8} y2={H - 22} stroke={COLORS.action} strokeDasharray="4 4" />
                  <text x={x(burn) - 4} y={18} fill={COLORS.action} fontSize={10} textAnchor="end">
                    {Math.round(burn)} s flight burn
                  </text>
                </g>
              )}
              <polyline points={pts.join(" ")} fill="none" stroke={done && failed ? COLORS.bad : COLORS.data} strokeWidth={2.2} strokeLinejoin="round" />
              {second && (
                <polyline
                  points={`${x(second[0]!)},${y(0)} ${x(second[0]!)},${y(relit ? 100 : 22)} ${x(second[1]!)},${y(relit ? 100 : 0)} ${x(second[1]!)},${y(0)}`}
                  fill="none"
                  stroke={relit ? COLORS.data : COLORS.bad}
                  strokeWidth={2.2}
                />
              )}
            </svg>
            <div className={`moment-verdict ${done ? "show" : ""} ${v.tone}`} role="status">
              {done ? v.text : ""}
            </div>
          </div>
        </div>
        {showReport && <pre className="report">{report.text}</pre>}
        <div className="actions">
          <button type="button" className="btn primary" disabled={!done} onClick={() => game.closeMoment()}>
            Done
          </button>
          <button type="button" className="btn quiet" disabled={!done} onClick={() => setShowReport(!showReport)}>
            {showReport ? "Hide the report" : "See the report"}
          </button>
        </div>
      </div>
    </div>
  );
}
