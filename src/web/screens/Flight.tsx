import { useEffect, useRef, useState } from "react";
import type { FlightEvent, FlightResult, Sample } from "../../sim/ascent.ts";
import type { FlightReport } from "../../sim/company.ts";
import { FAILURE_LABELS } from "../../sim/hardware.ts";
import { Chip, Facts } from "../components/Bits.tsx";
import { OrbitPlot } from "../components/OrbitPlot.tsx";
import { niceMax, Plot, ticks, type Marker } from "../components/Plot.tsx";
import { game } from "../game.ts";
import { km, kPa, money } from "../format.ts";

/** The watched launch: a replay of the flight the sim just flew, then the debrief. */

const SPEEDS = [1, 5, 20, 100] as const;

const EVENT_LABELS: Partial<Record<FlightEvent["kind"], string>> = {
  liftoff: "Liftoff",
  "pitch-kick": "Pitch kick",
  "mach-1": "Mach 1",
  "max-q": "Max-q",
  "q-limit-exceeded": "Load budget exceeded",
  "q-alpha-limit-exceeded": "Side-load budget exceeded",
  meco: "Engine cutoff",
  cutoff: "Guidance cutoff",
  staging: "Staging",
  orbit: "Orbit insertion",
  coast: "Coasting",
  relight: "Relight",
  transfer: "Transfer burn done",
  circularize: "Circularised",
  escape: "Escape burn done",
  apogee: "Apogee",
  impact: "Ground impact",
  "flow-separation": "Nozzle flow separating",
  "no-liftoff": "Held on the pad",
  "tower-jettison": "Abort tower jettisoned",
  abort: "Abort: capsule pulls clear",
};

function eventLabel(e: FlightEvent): string {
  if ((e.kind === "engine-failure" || e.kind === "structural-failure") && e.mode) return `Lost: ${FAILURE_LABELS[e.mode]}`;
  return EVENT_LABELS[e.kind] ?? e.kind;
}

function at(samples: Sample[], t: number): Sample {
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return samples[lo]!;
}

export function Flight({ report, design }: { report: FlightReport; design: string }) {
  const r = report.result;
  const samples = r.samples;
  const end = samples[samples.length - 1]?.t ?? 0;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(samples.length > 1);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(5);
  const [showDebrief, setShowDebrief] = useState(samples.length <= 1);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let frame = 0;
    const step = (now: number) => {
      const dt = last.current === null ? 0 : (now - last.current) / 1000;
      last.current = now;
      setT((prev) => {
        const next = Math.min(end, prev + dt * speed);
        if (next >= end) {
          setPlaying(false);
          setShowDebrief(true);
        }
        return next;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, end]);

  if (samples.length === 0) return null;
  const now = at(samples, t);
  const vehicle = game.snapshot().company?.designs[design];
  const budget = vehicle?.limits.maxDynamicPressure ?? 50_000;
  const target = r.summary.insertion?.target;

  // Ground track when the vehicle turns over; altitude against time when it goes straight up.
  const maxRange = Math.max(...samples.map((s) => s.downrange)) / 1000;
  const turns = maxRange > 30;
  const xOf = (s: Sample) => (turns ? s.downrange / 1000 : s.t);
  // A transfer orbit's apogee would squash the climb flat: the orbit view shows those.
  const shownTarget = target && Number.isFinite(target.apoapsis) && target.apoapsis < 3_000_000 ? target : undefined;
  const maxAlt = Math.max(...samples.map((s) => s.altitude), shownTarget?.apoapsis ?? 0) / 1000;
  const xMax = niceMax(turns ? maxRange : end);
  const yMax = niceMax(maxAlt * 1.08);
  const flown = samples.filter((s) => s.t <= t).map((s): [number, number] => [xOf(s), s.altitude / 1000]);
  const whole = samples.map((s): [number, number] => [xOf(s), s.altitude / 1000]);

  const shown = r.events.filter((e) => EVENT_LABELS[e.kind] !== undefined || e.mode !== undefined);
  const passed = shown.filter((e) => e.t <= t);
  const markers: Marker[] = r.events
    .filter((e) => e.t <= t && ["max-q", "staging", "orbit", "apogee", "engine-failure", "structural-failure"].includes(e.kind))
    .map((e) => {
      const s = at(samples, e.t);
      const lost = e.kind === "engine-failure" || e.kind === "structural-failure";
      return { x: xOf(s), y: s.altitude / 1000, color: lost ? "#ef6a5e" : "#e8ecef", hollow: !lost, label: eventLabel(e) };
    });
  markers.push({ x: xOf(now), y: now.altitude / 1000, color: "#f0a43a" });

  const qMaxT = Math.min(end, Math.max(150, r.summary.maxQ.t * 2.5));
  const qSamples = samples.filter((s) => s.t <= qMaxT);
  const qTop = niceMax(Math.max(budget, r.summary.maxQ.value) * 1.1 / 1000);

  return (
    <div className="screen">
      <div className="screen-head">
        <div className="stack" style={{ gap: 4 }}>
          <p className="label">
            {r.vehicle} · {r.mission}
          </p>
          <h1 className="mono">T+{t.toFixed(1)} s</h1>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => (t >= end ? (setT(0), setPlaying(true)) : setPlaying(!playing))}>
            {playing ? "Pause" : t >= end ? "Replay" : "Play"}
          </button>
          <div role="group" aria-label="Replay speed" className="actions" style={{ gap: 4 }}>
            {SPEEDS.map((s) => (
              <button key={s} type="button" className="btn" aria-pressed={speed === s} style={{ borderColor: speed === s ? "var(--amber)" : undefined }} onClick={() => setSpeed(s)}>
                ×{s}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => (setT(end), setPlaying(false), setShowDebrief(true))}>
            Skip to debrief
          </button>
        </div>
      </div>

      <label className="stack" style={{ gap: 6 }}>
        <span className="label">Replay</span>
        <input type="range" min={0} max={end} step={0.1} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} />
      </label>

      <div className="row">
        <div className="grow stack">
          <figure className="card" style={{ margin: 0 }}>
            <figcaption className="label">{turns ? "Altitude against ground track" : "Altitude against time"}</figcaption>
            <Plot
              label="Ascent profile"
              x={{ min: 0, max: xMax, ticks: ticks(xMax), title: turns ? "km downrange" : "seconds" }}
              y={{ min: 0, max: yMax, ticks: ticks(yMax, 4), title: "km" }}
              series={[
                { points: whole, color: "#5bb8e3", opacity: 0.3, dash: "6 5" },
                { points: flown, color: "#5bb8e3", width: 3 },
              ]}
              rules={shownTarget ? [{ at: shownTarget.apoapsis / 1000, color: "#f0a43a", label: `target ${km(shownTarget.apoapsis, 0)}`, labelAt: "start" }] : []}
              markers={markers}
            />
          </figure>
          {r.summary.inclination > 0 && (r.outcome === "orbit" || r.outcome === "escape" || r.events.some((e) => e.kind === "coast")) && (
            <figure className="card" style={{ margin: 0 }}>
              <figcaption className="label">From above the orbit</figcaption>
              <OrbitPlot samples={samples} t={t} events={r.events} orbit={t >= end ? r.summary.orbit : null} target={target} label="The flight seen from above the trajectory plane" />
              <span className="muted" style={{ fontSize: 13 }}>
                Blue: the path flown. Dashed amber: the orbit it ended on. White dots: staging, coasts and relights.
              </span>
            </figure>
          )}
          <figure className="card" style={{ margin: 0 }}>
            <figcaption className="label">Dynamic pressure against the load budget</figcaption>
            <Plot
              height={220}
              label="Dynamic pressure over time"
              x={{ min: 0, max: qMaxT, ticks: ticks(qMaxT), title: "seconds" }}
              y={{ min: 0, max: qTop, ticks: ticks(qTop, 4), title: "kPa" }}
              series={[
                { points: qSamples.map((s): [number, number] => [s.t, s.dynamicPressure / 1000]), color: "#5bb8e3", opacity: 0.3 },
                { points: qSamples.filter((s) => s.t <= t).map((s): [number, number] => [s.t, s.dynamicPressure / 1000]), color: "#5bb8e3", width: 2.5 },
              ]}
              rules={[{ at: budget / 1000, color: "#ef6a5e", label: `budget ${kPa(budget)}` }]}
              cursor={t <= qMaxT ? { at: t, color: "#f0a43a" } : undefined}
            />
          </figure>
        </div>
        <aside className="side stack">
          <Facts
            items={[
              ["Altitude", km(now.altitude)],
              ["Speed", `${Math.round(now.velocity)} m/s`],
              ["Mach", now.altitude < 150_000 ? now.mach.toFixed(2) : "—"],
              ["q", kPa(now.dynamicPressure)],
              ["Pitch", `${now.pitch.toFixed(1)}°`],
              ["Stage", ["Booster", "Upper", "Kick stage"][now.stage] ?? `Stage ${now.stage + 1}`],
            ]}
          />
          <div className="card">
            <p className="label">Events</p>
            <ol className="list mono" style={{ fontSize: 13 }}>
              {shown.map((e, i) => {
                  const done = e.t <= t;
                  const lost = e.kind === "engine-failure" || e.kind === "structural-failure";
                  return (
                    <li key={i} style={{ color: done ? (lost ? "var(--red-text)" : "var(--text)") : "var(--muted)" }}>
                      <span style={{ flex: "0 0 72px" }}>T+{e.t.toFixed(1)}</span>
                      <span>{eventLabel(e)}</span>
                    </li>
                  );
                })}
            </ol>
            <span className="muted" style={{ fontSize: 13 }}>
              {passed.length} of the flight's events so far.
            </span>
          </div>
        </aside>
      </div>

      {showDebrief && <Debrief report={report} />}
    </div>
  );
}

function headline(r: FlightResult): { text: string; tone: "good" | "warn" | "bad" } {
  const s = r.summary;
  const lost = r.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure");
  const abort = r.events.find((e) => e.kind === "abort");
  if (r.outcome === "abort" && abort) return { text: `In-flight abort test at T+${abort.t.toFixed(1)} s: the booster is spent`, tone: "warn" };
  if (lost?.mode) return { text: `Vehicle lost at T+${lost.t.toFixed(1)} s: ${FAILURE_LABELS[lost.mode]}${abort ? ": the abort fired" : ""}`, tone: "bad" };
  if (r.outcome === "no-liftoff") return { text: "Never left the pad", tone: "bad" };
  if (r.outcome === "orbit" && s.orbit) {
    const spec = s.insertion ? (s.insertion.inSpec ? ", in spec" : ", out of spec") : "";
    return { text: `Orbit ${km(s.orbit.periapsis)} × ${km(s.orbit.apoapsis)}${spec}`, tone: s.insertion && !s.insertion.inSpec ? "warn" : "good" };
  }
  if (r.outcome === "apogee") return { text: `Apogee ${km(s.apogee)}${s.insertion ? ", short of orbit" : ""}`, tone: s.insertion ? "bad" : "good" };
  return { text: "Came back down short of orbit", tone: "bad" };
}

function Debrief({ report }: { report: FlightReport }) {
  const r = report.result;
  const h = headline(r);
  const s = r.summary;
  const ideal = s.idealDeltaV;
  const losses = (
    [
      ["Gravity", s.losses.gravity, "#2e6e8e"],
      ["Drag", s.losses.drag, "#5bb8e3"],
      ["Back-pressure", s.losses.backPressure, "#8a5a1e"],
      ["Steering", s.losses.steering, "#f0a43a"],
    ] as Array<[string, number, string]>
  ).filter(([, v]) => v >= 0.5);
  const settlement = report.settlement;

  return (
    <section className="stack" aria-label="Debrief" style={{ gap: 18 }}>
      <div className="stack" style={{ gap: 6 }}>
        <p className="label">Debrief</p>
        <h2 className={h.tone} style={{ fontSize: 32 }}>
          {h.text}
        </h2>
      </div>
      <div className="row">
        <div className="grow stack">
          {ideal > 0 && r.outcome !== "failure" && (
            <div className="card">
              <p className="label">Where the engines' Δv went</p>
              <div style={{ display: "flex", height: 22, borderRadius: 3, overflow: "hidden" }} role="img" aria-label="Δv budget">
                <div style={{ flex: `${s.burnoutGroundSpeed} 1 0`, background: "#e8ecef" }} />
                {losses.map(([name, v, c]) => (
                  <div key={name} style={{ flex: `${v} 1 0`, background: c }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: 14 }} className="soft">
                <span>
                  <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, marginRight: 6, background: "#e8ecef" }} />
                  Ground speed {Math.round(s.burnoutGroundSpeed)} m/s
                </span>
                {losses.map(([name, v, c]) => (
                  <span key={name}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, marginRight: 6, background: c }} />
                    {name} {Math.round(v)} m/s
                  </span>
                ))}
              </div>
              <span className="muted" style={{ fontSize: 14 }}>
                {Math.round(ideal)} m/s delivered in total.
              </span>
            </div>
          )}
          <details className="card" open>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Engineer's debrief</summary>
            <pre className="report">{report.debrief}</pre>
          </details>
        </div>
        <aside className="side stack">
          {settlement && (
            <div className={`card ${settlement.status === "failed" ? "alert" : ""}`}>
              <p className="label">The customer</p>
              <span>{settlement.text}</span>
              <div className="actions">
                <Chip tone={settlement.status === "delivered" ? "good" : settlement.status === "degraded" ? "warn" : "bad"}>{settlement.status.toUpperCase()}</Chip>
                {settlement.payout > 0 && <span className="mono good">+{money(settlement.payout)}</span>}
                {settlement.penalty > 0 && <span className="mono bad">−{money(settlement.penalty)}</span>}
                <span className="mono soft">reputation {settlement.reputation >= 0 ? "+" : ""}{settlement.reputation}</span>
              </div>
            </div>
          )}
          {report.notices.length > 0 && (
            <div className="card">
              {report.notices.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
          )}
          <div className="card">
            <p className="label">What happens now</p>
            <span className="soft">Telemetry has gone into the company's knowledge: the test stand and tunnel screens now show what this flight reached.</span>
            <button type="button" className="btn primary" onClick={() => game.closeFlight()}>
              Back to work
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
