import type { FlightEvent, Sample } from "../../sim/ascent.ts";
import { R_EARTH } from "../../sim/constants.ts";
import type { InsertionTarget } from "../../sim/mission.ts";
import type { OrbitElements } from "../../sim/orbit.ts";
import { COLORS } from "../palette.ts";

/**
 * The flight seen from above the trajectory plane: Earth to scale, the path
 * flown so far, the orbit the vehicle ended on, and where it coasted and
 * relit. The pad is at the top and the vehicle travels clockwise.
 */

const SIZE = 420;
/** Widest view, in Earth radii: anything bigger runs off the edge. */
const MAX_VIEW = 8;

type Props = {
  samples: Sample[];
  t: number;
  events: FlightEvent[];
  orbit: OrbitElements | null;
  target?: InsertionTarget;
  label: string;
};

export function OrbitPlot({ samples, t, events, orbit, target, label }: Props) {
  const furthest = Math.max(...samples.map((s) => R_EARTH + s.altitude));
  const orbitReach = orbit && Number.isFinite(orbit.apoapsis) ? R_EARTH + orbit.apoapsis : furthest * 3;
  const targetReach = target && Number.isFinite(target.apoapsis) ? R_EARTH + target.apoapsis : 0;
  const view = Math.min(MAX_VIEW * R_EARTH, Math.max(furthest, orbitReach, targetReach, 1.25 * R_EARTH) * 1.08);
  const k = SIZE / 2 / view;
  const c = SIZE / 2;
  const point = (r: number, theta: number): [number, number] => [c + r * Math.sin(theta) * k, c - r * Math.cos(theta) * k];
  const path = (pts: Array<[number, number]>) => (pts.length === 0 ? "" : "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L"));

  const flown = samples.filter((s) => s.t <= t).map((s) => point(R_EARTH + s.altitude, s.theta));
  const whole = samples.map((s) => point(R_EARTH + s.altitude, s.theta));

  // The orbit the flight ended on, drawn from its elements.
  let ellipse = "";
  if (orbit) {
    const e = orbit.eccentricity;
    const rp = R_EARTH + orbit.periapsis;
    const p = rp * (1 + e);
    const limit = e >= 1 ? Math.acos(-1 / e) - 0.05 : Math.PI;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 360; i++) {
      const nu = -limit + (2 * limit * i) / 360;
      const r = p / (1 + e * Math.cos(nu));
      if (r > view * 1.5 || r <= 0) continue;
      pts.push(point(r, orbit.periapsisAngle + nu));
    }
    ellipse = path(pts);
  }
  const offView = orbit && orbitReach > view;
  const marks = events.filter((e) => e.t <= t && ["relight", "coast", "transfer", "circularize", "escape", "staging", "engine-failure"].includes(e.kind));
  const sampleAt = (time: number) => samples.reduce((best, s) => (Math.abs(s.t - time) < Math.abs(best.t - time) ? s : best), samples[0]!);
  const now = samples.filter((s) => s.t <= t).at(-1) ?? samples[0]!;

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label} style={{ width: "100%", maxWidth: SIZE, height: "auto", display: "block", margin: "0 auto" }}>
      <defs>
        <radialGradient id="earth-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0.85" stopColor="#1b3a52" />
          <stop offset="1" stopColor={COLORS.ground} />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={R_EARTH * k * 1.03} fill="url(#earth-glow)" />
      <circle cx={c} cy={c} r={R_EARTH * k} fill="#173049" stroke={COLORS.dataDeep} />
      {target && Number.isFinite(target.apoapsis) && target.apoapsis === target.periapsis && (
        <circle cx={c} cy={c} r={(R_EARTH + target.apoapsis) * k} fill="none" stroke={COLORS.action} strokeDasharray="3 6" opacity={0.6} />
      )}
      {ellipse && <path d={ellipse} fill="none" stroke={COLORS.action} strokeWidth={1.5} strokeDasharray="6 5" />}
      <path d={path(whole)} fill="none" stroke={COLORS.data} strokeWidth={1.5} opacity={0.3} />
      <path d={path(flown)} fill="none" stroke={COLORS.data} strokeWidth={2.5} />
      {marks.map((e, i) => {
        const s = sampleAt(e.t);
        const [x, y] = point(R_EARTH + s.altitude, s.theta);
        const bad = e.kind === "engine-failure";
        return <circle key={i} cx={x} cy={y} r={4} fill={bad ? COLORS.bad : e.kind === "coast" ? COLORS.ground : COLORS.text} stroke={bad ? COLORS.bad : COLORS.text} strokeWidth={1.5} />;
      })}
      {(() => {
        const [x, y] = point(R_EARTH + now.altitude, now.theta);
        return <circle cx={x} cy={y} r={5} fill={COLORS.action} />;
      })()}
      <text x={c} y={c + 4} textAnchor="middle" fill={COLORS.muted} fontSize={11}>
        Earth
      </text>
      {offView && (
        <text x={SIZE - 8} y={SIZE - 8} textAnchor="end" fill={COLORS.action} fontSize={11}>
          {orbit && Number.isFinite(orbit.apoapsis) ? `orbit reaches ${Math.round(orbit.apoapsis / 1000).toLocaleString("en-US")} km, off the edge` : "escaping: the path leaves the view"}
        </text>
      )}
    </svg>
  );
}
