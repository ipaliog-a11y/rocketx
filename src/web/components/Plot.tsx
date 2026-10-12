import { COLORS } from "../palette.ts";
/**
 * A small line plot in SVG: enough for trajectories, load curves and drag
 * curves. Data in, scaled paths out; no chart library.
 */

export type Series = { points: Array<[number, number]>; color: string; width?: number; dash?: string; opacity?: number };
export type Marker = { x: number; y: number; color: string; label?: string; hollow?: boolean; anchor?: "start" | "end" };
export type Band = { from: number; to: number; color: string; label?: string };
export type Rule = { at: number; color: string; label?: string; dash?: boolean; labelAt?: "start" | "end" };
type Axis = { min: number; max: number; ticks: number[]; format?: (v: number) => string; title?: string };

type Props = {
  x: Axis;
  y: Axis;
  series: Series[];
  markers?: Marker[];
  /** Vertical bands across the plot, in x units. */
  bands?: Band[];
  /** Horizontal rules, in y units. */
  rules?: Rule[];
  /** A vertical cursor, in x units. */
  cursor?: { at: number; color: string };
  height?: number;
  label: string;
};

const W = 720;
const M = { left: 56, right: 18, top: 16, bottom: 40 };

export function Plot({ x, y, series, markers = [], bands = [], rules = [], cursor, height = 280, label }: Props) {
  const iw = W - M.left - M.right;
  const ih = height - M.top - M.bottom;
  // An empty range (a flight over at T+0) would divide by zero.
  const sx = (v: number) => ((v - x.min) / (x.max - x.min || 1)) * iw;
  const sy = (v: number) => ih - ((v - y.min) / (y.max - y.min || 1)) * ih;
  const fx = x.format ?? String;
  const fy = y.format ?? String;
  const path = (pts: Array<[number, number]>) =>
    pts.length === 0 ? "" : "M" + pts.map(([a, b]) => `${sx(a).toFixed(1)} ${sy(b).toFixed(1)}`).join(" L");

  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} style={{ width: "100%", height: "auto", display: "block" }}>
      <g transform={`translate(${M.left} ${M.top})`}>
        {bands.map((b, i) => (
          <g key={`b${i}`}>
            <rect x={sx(b.from)} y={0} width={Math.max(0, sx(b.to) - sx(b.from))} height={ih} fill={b.color} fillOpacity={0.12} />
            {b.label && (
              <text x={(sx(b.from) + sx(b.to)) / 2} y={ih - 6} fill={b.color} fontSize={11} textAnchor="middle">
                {b.label}
              </text>
            )}
          </g>
        ))}
        {y.ticks.map((t) => (
          <g key={`y${t}`}>
            <line x1={0} x2={iw} y1={sy(t)} y2={sy(t)} stroke="#222b34" />
            <text x={-10} y={sy(t) + 4} fill={COLORS.muted} fontSize={12} textAnchor="end">
              {fy(t)}
            </text>
          </g>
        ))}
        {x.ticks.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={ih + 22} fill={COLORS.muted} fontSize={12} textAnchor="middle">
            {fx(t)}
          </text>
        ))}
        <line x1={0} x2={iw} y1={ih} y2={ih} stroke={COLORS.lineStrong} />
        <line x1={0} x2={0} y1={0} y2={ih} stroke={COLORS.lineStrong} />
        {x.title && (
          <text x={iw} y={ih + 36} fill={COLORS.muted} fontSize={11} textAnchor="end">
            {x.title}
          </text>
        )}
        {y.title && (
          <text x={4} y={10} fill={COLORS.muted} fontSize={11}>
            {y.title}
          </text>
        )}
        {rules.map((r, i) => (
          <g key={`r${i}`}>
            <line x1={0} x2={iw} y1={sy(r.at)} y2={sy(r.at)} stroke={r.color} strokeDasharray={r.dash === false ? undefined : "4 4"} />
            {r.label && (
              <text x={r.labelAt === "start" ? 8 : iw - 4} y={sy(r.at) - 6} fill={r.color} fontSize={12} textAnchor={r.labelAt === "start" ? "start" : "end"}>
                {r.label}
              </text>
            )}
          </g>
        ))}
        {series.map((s, i) => (
          <path
            key={`s${i}`}
            d={path(s.points)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width ?? 2}
            strokeDasharray={s.dash}
            strokeOpacity={s.opacity ?? 1}
            strokeLinejoin="round"
          />
        ))}
        {cursor && <line x1={sx(cursor.at)} x2={sx(cursor.at)} y1={0} y2={ih} stroke={cursor.color} strokeWidth={2} />}
        {markers.map((m, i) => (
          <g key={`m${i}`}>
            <circle cx={sx(m.x)} cy={sy(m.y)} r={5} fill={m.hollow ? COLORS.ground : m.color} stroke={m.color} strokeWidth={2} />
            {m.label && (
              <text x={sx(m.x) + (m.anchor === "end" ? -10 : 10)} y={sy(m.y) - 8} fill={COLORS.text} fontSize={12} textAnchor={m.anchor ?? "start"}>
                {m.label}
              </text>
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Round tick positions covering 0..max. */
export function ticks(max: number, count = 5): number[] {
  // A flight that dies on the pad has nothing to scale: one tick, not an endless loop.
  if (!(max > 0) || !Number.isFinite(max)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function niceMax(max: number, count = 5): number {
  const t = ticks(max, count);
  const last = t[t.length - 1] ?? max;
  return last >= max ? last : last + (t[1] ?? max);
}
