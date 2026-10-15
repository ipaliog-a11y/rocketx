import { CAUSE_LABELS } from "../../sim/control.ts";
import { useEffect, useRef, useState } from "react";
import type { Vehicle } from "../../sim/vehicle.ts";
import { height, Rocket } from "../components/Rocket.tsx";
import { reducedMotion } from "../motion.ts";
import { useNarrow } from "../narrow.ts";
import type { FlightEvent, FlightResult, Sample } from "../../sim/ascent.ts";
import type { FlightReport } from "../../sim/company.ts";
import { FAILURE_LABELS } from "../../sim/hardware.ts";
import { Chip, Facts } from "../components/Bits.tsx";
import { OrbitPlot } from "../components/OrbitPlot.tsx";
import { niceMax, Plot, ticks, type Marker } from "../components/Plot.tsx";
import { game } from "../game.ts";
import { km, kPa, money } from "../format.ts";
import { COLORS } from "../palette.ts";
import { Term } from "../components/Info.tsx";

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
  "fairing-jettison": "Fairing jettisoned",
  "attitude-oscillation": "Attitude oscillation",
};

function eventLabel(e: FlightEvent): string {
  if ((e.kind === "engine-failure" || e.kind === "structural-failure" || e.kind === "loss-of-control") && e.mode) return `Lost: ${e.cause ? CAUSE_LABELS[e.cause] : FAILURE_LABELS[e.mode]}`;
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
  const flies = report.result.samples.length > 1;
  const [phase, setPhase] = useState<"countdown" | "flight">(flies && !reducedMotion() ? "countdown" : "flight");
  const [showDebrief, setShowDebrief] = useState(!flies);
  const vehicle = game.snapshot().company?.designs[design];
  const budget = vehicle?.limits.maxDynamicPressure ?? 50_000;
  // News the flight brought (a first orbit, a licence) waits for the debrief.
  useEffect(() => {
    if (showDebrief) game.endCinema();
  }, [showDebrief]);
  if (phase === "countdown" && vehicle) {
    return (
      <div className="screen">
        <Countdown vehicle={vehicle} title={`${report.result.vehicle} · ${report.result.mission}`} onDone={() => setPhase("flight")} />
      </div>
    );
  }
  return (
    <div className="screen">
      <Replay result={report.result} budget={budget} title={`${report.result.vehicle} · ${report.result.mission}`} skip="Skip to debrief" onEnd={() => setShowDebrief(true)} />
      {showDebrief && <Debrief report={report} />}
    </div>
  );
}

/** Before the replay: the rocket on the pad, a count from three, and liftoff. */
function Countdown({ vehicle, title, onDone }: { vehicle: Vehicle; title: string; onDone: () => void }) {
  const [count, setCount] = useState(3);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const timers = [
      setTimeout(() => setCount(2), 700),
      setTimeout(() => setCount(1), 1400),
      setTimeout(() => setCount(0), 2100),
      setTimeout(() => done.current(), 3200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  const narrow = useNarrow();
  const scale = Math.min(14, (narrow ? 190 : 260) / height(vehicle));
  return (
    <section className="countdown card blueprint" aria-label="Countdown">
      <div className="countdown-head">
        <p className="label">{title}</p>
        <button type="button" className="btn quiet" onClick={() => done.current()}>
          Skip
        </button>
      </div>
      <div className="countdown-stage">
        <div className={`countdown-rocket ${count === 0 ? "lift" : ""}`}>
          <Rocket vehicle={vehicle} scale={scale} />
          <span className="countdown-plume" aria-hidden="true" />
        </div>
        <span className="countdown-pad" aria-hidden="true" />
        <span key={count} className="countdown-number mono" role="status" aria-live="assertive">
          {count > 0 ? `T−${count}` : "Liftoff"}
        </span>
      </div>
    </section>
  );
}

/** A trace drawn faintly behind the flight: another case of the same flight. */
export type Ghost = { result: FlightResult; color: string; label: string };

/**
 * The flight played back: altitude, orbit and dynamic pressure plots, the
 * live figures and the event list. Ghosts are other cases of the same
 * flight, drawn whole and faint behind it.
 */
export function Replay({ result: r, budget, title, skip, onEnd, ghosts = [], autoplay = true }: { result: FlightResult; budget: number; title: string; skip?: string; onEnd?: () => void; ghosts?: Ghost[]; autoplay?: boolean }) {
  const samples = r.samples;
  // A booster still on its way home keeps the replay running until it's down.
  const end = Math.max(samples[samples.length - 1]?.t ?? 0, r.recovery?.samples.at(-1)?.t ?? 0);
  // Without autoplay the whole flight shows first, and Play runs it from the pad.
  const [t, setT] = useState(autoplay ? 0 : end);
  const [playing, setPlaying] = useState(autoplay && samples.length > 1);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(5);
  const last = useRef<number | null>(null);
  const ended = useRef(onEnd);
  ended.current = onEnd;
  // A new flight starts from the pad.
  useEffect(() => {
    setT(autoplay ? 0 : end);
    setPlaying(autoplay && samples.length > 1);
  }, [r, autoplay, samples.length, end]);

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
          ended.current?.();
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
  const target = r.summary.insertion?.target;

  // Ground track when the vehicle turns over; altitude against time when it goes straight up.
  const maxRange = Math.max(...samples.map((s) => s.downrange)) / 1000;
  const ghostSamples = ghosts.flatMap((g) => g.result.samples);
  const turns = maxRange > 30;
  const xOf = (s: Sample) => (turns ? s.downrange / 1000 : s.t);
  // A transfer orbit's apogee would squash the climb flat: the orbit view shows those.
  const shownTarget = target && Number.isFinite(target.apoapsis) && target.apoapsis < 3_000_000 ? target : undefined;
  const maxAlt = Math.max(...samples.map((s) => s.altitude), ...ghostSamples.map((s) => Math.min(s.altitude, 3 * (shownTarget?.apoapsis ?? s.altitude))), shownTarget?.apoapsis ?? 0) / 1000;
  const xMax = niceMax(turns ? Math.max(maxRange, ...ghostSamples.map((s) => Math.min(s.downrange / 1000, maxRange * 1.5))) : Math.max(end, ...ghosts.map((g) => g.result.samples.at(-1)?.t ?? 0)));
  const yMax = niceMax(maxAlt * 1.08);
  // A booster coming home: its own trace, which runs back behind the pad on a return to the launch site.
  const home = turns ? r.recovery : undefined;
  const xMin = home ? Math.min(0, Math.floor(Math.min(...home.samples.map((s) => s.downrange)) / 10_000) * 10) : 0;
  const homeFlown = home ? home.samples.filter((s) => s.t <= t).map((s): [number, number] => [s.downrange / 1000, s.altitude / 1000]) : [];
  const homeLast = home?.samples.at(-1);
  const flown = samples.filter((s) => s.t <= t).map((s): [number, number] => [xOf(s), s.altitude / 1000]);
  const whole = samples.map((s): [number, number] => [xOf(s), s.altitude / 1000]);

  const shown = r.events.filter((e) => EVENT_LABELS[e.kind] !== undefined || e.mode !== undefined);
  const passed = shown.filter((e) => e.t <= t);
  const markers: Marker[] = r.events
    .filter((e) => e.t <= t && ["max-q", "staging", "orbit", "apogee", "engine-failure", "structural-failure", "loss-of-control"].includes(e.kind))
    .map((e) => {
      const s = at(samples, e.t);
      const lost = e.kind === "engine-failure" || e.kind === "structural-failure" || e.kind === "loss-of-control";
      return { x: xOf(s), y: s.altitude / 1000, color: lost ? COLORS.bad : COLORS.text, hollow: !lost, label: eventLabel(e) };
    });
  markers.push({ x: xOf(now), y: now.altitude / 1000, color: COLORS.action });
  if (home && homeLast && t >= homeLast.t) markers.push({ x: home.landedAt / 1000, y: 0, color: home.outcome === "landed" ? COLORS.text : COLORS.bad, hollow: home.outcome === "landed", label: home.outcome === "landed" ? "booster landed" : "booster lost" });

  const qMaxT = Math.min(end, Math.max(150, r.summary.maxQ.t * 2.5));
  const qSamples = samples.filter((s) => s.t <= qMaxT);
  const qTop = niceMax(Math.max(budget, r.summary.maxQ.value) * 1.1 / 1000);

  return (
    <>
      <div className="screen-head">
        <div className="stack" style={{ gap: 4 }}>
          <p className="label">{title}</p>
          <h1 className="mono">T+{t.toFixed(1)} s</h1>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => (t >= end ? (setT(0), setPlaying(true)) : setPlaying(!playing))}>
            {playing ? "Pause" : t >= end ? "Replay" : "Play"}
          </button>
          <div role="group" aria-label="Replay speed" className="actions" style={{ gap: 4 }}>
            {SPEEDS.map((s) => (
              <button key={s} type="button" className="btn" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                ×{s}
              </button>
            ))}
          </div>
          {skip && (
            <button type="button" className="btn" onClick={() => (setT(end), setPlaying(false), onEnd?.())}>
              {skip}
            </button>
          )}
        </div>
      </div>

      <label className="stack" style={{ gap: 6 }}>
        <span className="label">Replay</span>
        <input type="range" min={0} max={end} step={0.1} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} />
      </label>

      <div className="row">
        <div className="grow stack">
          <figure className="card" style={{ margin: 0 }}>
            <figcaption className="label">
              {turns ? "Altitude against ground track" : "Altitude against time"}
              {home ? " · white: the booster coming home" : ""}
            </figcaption>
            <Plot
              label="Ascent profile"
              x={{ min: xMin, max: xMax, ticks: [...(xMin < 0 ? [xMin] : []), ...ticks(xMax)], title: turns ? "km downrange" : "seconds" }}
              y={{ min: 0, max: yMax, ticks: ticks(yMax, 4), title: "km" }}
              series={[
                ...ghosts.map((g) => ({ points: g.result.samples.map((s): [number, number] => [xOf(s), s.altitude / 1000]).filter(([x, y]) => x <= xMax && y <= yMax), color: g.color, opacity: 0.55, dash: "3 4" })),
                { points: whole, color: COLORS.data, opacity: 0.3, dash: "6 5" },
                { points: flown, color: COLORS.data, width: 3 },
                ...(home ? [{ points: homeFlown, color: COLORS.text, width: 2, opacity: 0.85 }] : []),
              ]}
              rules={shownTarget ? [{ at: shownTarget.apoapsis / 1000, color: COLORS.action, label: `target ${km(shownTarget.apoapsis, 0)}`, labelAt: "start" }] : []}
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
            <figcaption className="label">
              <Term id="maxq">Dynamic pressure</Term> against the load budget
            </figcaption>
            <Plot
              height={220}
              label="Dynamic pressure over time"
              x={{ min: 0, max: qMaxT, ticks: ticks(qMaxT), title: "seconds" }}
              y={{ min: 0, max: qTop, ticks: ticks(qTop, 4), title: "kPa" }}
              series={[
                { points: qSamples.map((s): [number, number] => [s.t, s.dynamicPressure / 1000]), color: COLORS.data, opacity: 0.3 },
                { points: qSamples.filter((s) => s.t <= t).map((s): [number, number] => [s.t, s.dynamicPressure / 1000]), color: COLORS.data, width: 2.5 },
              ]}
              rules={[{ at: budget / 1000, color: COLORS.bad, label: `budget ${kPa(budget)}` }]}
              cursor={t <= qMaxT ? { at: t, color: COLORS.action } : undefined}
            />
          </figure>
        </div>
        <aside className="side stack">
          <Facts
            items={[
              ["Altitude", km(now.altitude)],
              ["Speed", `${Math.round(now.velocity)} m/s`],
              [<Term id="transonic">Mach</Term>, now.altitude < 150_000 ? now.mach.toFixed(2) : "—"],
              [<Term id="maxq">q</Term>, kPa(now.dynamicPressure)],
              ["Pitch", `${now.pitch.toFixed(1)}°`],
              ["Stage", ["Booster", "Upper", "Kick stage"][now.stage] ?? `Stage ${now.stage + 1}`],
            ]}
          />
          <div className="card">
            <p className="label">Events</p>
            <ol className="list mono" style={{ fontSize: 13 }}>
              {shown.map((e, i) => {
                  const done = e.t <= t;
                  const lost = e.kind === "engine-failure" || e.kind === "structural-failure" || e.kind === "loss-of-control";
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
      {ghosts.length > 0 && (
        <span className="muted" style={{ fontSize: 13 }}>
          Solid blue: the flight as modelled. {ghosts.map((g) => g.label).join(". ")}.
        </span>
      )}
    </>
  );
}

export function headline(r: FlightResult): { text: string; tone: "good" | "warn" | "bad" } {
  const s = r.summary;
  const lost = r.events.find((e) => e.kind === "engine-failure" || e.kind === "structural-failure" || e.kind === "loss-of-control");
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
      ["Gravity", s.losses.gravity, COLORS.dataDeep],
      ["Drag", s.losses.drag, COLORS.data],
      ["Back-pressure", s.losses.backPressure, "#8a5a1e"],
      ["Steering", s.losses.steering, COLORS.action],
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
              <p className="label">
                Where the engines' <Term id="dv">Δv</Term> went
              </p>
              <div style={{ display: "flex", height: 22, borderRadius: 3, overflow: "hidden" }} role="img" aria-label="Δv budget">
                <div style={{ flex: `${s.burnoutGroundSpeed} 1 0`, background: COLORS.text }} />
                {losses.map(([name, v, c]) => (
                  <div key={name} style={{ flex: `${v} 1 0`, background: c }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: 14 }} className="soft">
                <span>
                  <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, marginRight: 6, background: COLORS.text }} />
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
          {report.booster && (
            <div className={`card ${report.result.recovery?.outcome === "landed" ? "" : "alert"}`}>
              <p className="label">The booster</p>
              <span>{report.booster}</span>
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
