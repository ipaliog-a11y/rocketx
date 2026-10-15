import { useId, useRef, useState, type ReactNode } from "react";
import "./design.css";

/**
 * The design office's instruments (UI-DESIGN.md §4): a curve slider, a
 * readout, a stamp, a title block. Built once here; the engine, vehicle and
 * control screens use the same pieces.
 */

const fmt = (v: number, dec: number) => (Number.isFinite(v) ? v.toFixed(dec) : "—");
const signed = (v: number, dec: number) => {
  const s = Math.abs(v).toFixed(dec);
  if (Number(s) === 0) return "±0";
  return `${v > 0 ? "+" : "−"}${s}`;
};

/** A short uppercase header with an ID on the right: "PARAMETER STRIP · NZ-1". */
export function PanelHeader({ title, id }: { title: string; id?: string }) {
  return (
    <div className="hdr lbl">
      <span>{title}</span>
      {id && <span>{id}</span>}
    </div>
  );
}

export type CurveTrace = { label: string; ys: number[] };
export type CurveSpec = {
  xs: number[];
  a: CurveTrace;
  b?: CurveTrace;
  redlines: Array<{ x: number; label: string; dotted?: boolean }>;
  bands?: Array<{ x: number; label: string }>;
};

const PLOT = { l: 44, r: 314, t: 12, b: 150 };

/**
 * A parameter set by dragging a marker along its own performance curve, so
 * the trade is visible while it moves. Also a range input (arrow keys) and a
 * number input (typed values). Limits are dashed red lines with ▲ and a word.
 */
export function CurveSlider({
  curve,
  sym,
  name,
  unit,
  min,
  max,
  step,
  dec,
  value,
  onChange,
}: {
  curve: CurveSpec;
  sym: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  dec: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const all = [...curve.a.ys, ...(curve.b?.ys ?? [])].filter(Number.isFinite);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.1 || 1;
  lo -= pad;
  hi += pad;
  const ydec = hi - lo < 5 ? 2 : hi - lo < 50 ? 1 : 0;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const sx = (v: number) => PLOT.l + ((clamp(v) - min) / (max - min)) * (PLOT.r - PLOT.l);
  const sy = (v: number) => PLOT.b - ((v - lo) / (hi - lo)) * (PLOT.b - PLOT.t);
  const path = (ys: number[]) => {
    let d = "";
    let pen = false;
    ys.forEach((y, k) => {
      if (!Number.isFinite(y)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${sx(curve.xs[k]!).toFixed(1)} ${sy(y).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const yAt = (ys: number[], x: number) => {
    const i = curve.xs.findIndex((v) => v >= x);
    if (i <= 0) return ys[0]!;
    const t = (x - curve.xs[i - 1]!) / (curve.xs[i]! - curve.xs[i - 1]!);
    return ys[i - 1]! + (ys[i]! - ys[i - 1]!) * t;
  };
  const snap = (v: number) => clamp(Math.round(v / step) * step);
  const fromPointer = (clientX: number) => {
    const box = svg.current!.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * 320;
    onChange(snap(min + ((px - PLOT.l) / (PLOT.r - PLOT.l)) * (max - min)));
  };
  const mx = sx(value);
  const ya = yAt(curve.a.ys, value);
  const yb = curve.b ? yAt(curve.b.ys, value) : NaN;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="ed-legend">
        <span>
          <svg width="18" height="4" aria-hidden="true">
            <path d="M0 2 H18" style={{ stroke: "var(--ed-line)", strokeWidth: 2 }} />
          </svg>
          {curve.a.label}
        </span>
        {curve.b && (
          <span>
            <svg width="18" height="4" aria-hidden="true">
              <path d="M0 2 H18" style={{ stroke: "var(--ed-line)", strokeWidth: 2, strokeDasharray: "4 3" }} />
            </svg>
            {curve.b.label}
          </span>
        )}
        <span className="accent" style={{ marginLeft: "auto" }}>
          ○ NOW
        </span>
      </div>
      <svg
        ref={svg}
        className="curve"
        viewBox="0 0 320 172"
        role="img"
        aria-label={`Trade-off curve for ${name}: ${curve.a.label}${curve.b ? ` and ${curve.b.label}` : ""}. Drag to set; or use the slider below.`}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          fromPointer(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && fromPointer(e.clientX)}
      >
        <path className="axis" d={`M${PLOT.l} ${PLOT.t} V${PLOT.b} H${PLOT.r}`} />
        <path className="gridl" d={`M${PLOT.l} ${(PLOT.t + PLOT.b) / 2} H${PLOT.r} M${PLOT.l + (PLOT.r - PLOT.l) / 3} ${PLOT.t} V${PLOT.b} M${PLOT.l + ((PLOT.r - PLOT.l) * 2) / 3} ${PLOT.t} V${PLOT.b}`} />
        {curve.bands?.map((b) => (
          <g key={b.label}>
            <line className="band" x1={sx(b.x)} x2={sx(b.x)} y1={PLOT.b - 10} y2={PLOT.b} />
            <text x={sx(b.x) + 3} y={PLOT.b - 3}>
              {b.label}
            </text>
          </g>
        ))}
        {curve.redlines
          .filter((r) => r.x >= min && r.x <= max)
          .map((r, i) => {
            const x = sx(r.x);
            const far = x > 220;
            return (
              <g key={r.label}>
                <line className={`red ${r.dotted ? "dotted" : ""}`} x1={x} x2={x} y1={PLOT.t} y2={PLOT.b} />
                <text className="alarm" x={far ? x - 6 : x + 6} y={26 + i * 16} textAnchor={far ? "end" : "start"}>
                  ▲ {r.label}
                </text>
              </g>
            );
          })}
        {curve.b && <path className="trace b" d={path(curve.b.ys)} />}
        <path className="trace" d={path(curve.a.ys)} />
        <line className="now" x1={mx} x2={mx} y1={PLOT.t} y2={PLOT.b} />
        {Number.isFinite(ya) && <circle className="marker" cx={mx} cy={sy(ya)} r={5} />}
        {Number.isFinite(yb) && <circle className="marker" cx={mx} cy={sy(yb)} r={3.5} style={{ strokeWidth: 1.5 }} />}
        <text x={38} y={18} textAnchor="end">
          {hi.toFixed(ydec)}
        </text>
        <text x={38} y={152} textAnchor="end">
          {lo.toFixed(ydec)}
        </text>
        <text x={PLOT.l} y={168}>
          {fmt(min, dec)}
        </text>
        <text x={PLOT.r} y={168} textAnchor="end">
          {fmt(max, dec)} {unit}
        </text>
      </svg>
      <label className="lbl" htmlFor={`${id}-range`}>
        ADJUST {sym}
      </label>
      <input
        id={`${id}-range`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={`${sym} ${fmt(value, dec)} ${unit}`}
        onChange={(e) => onChange(snap(Number(e.target.value)))}
      />
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="number"
          aria-label={`${name} value, ${unit}`}
          min={min}
          max={max}
          step={step}
          value={typed ?? fmt(value, dec)}
          style={{ width: 120 }}
          onChange={(e) => {
            setTyped(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
          onBlur={() => {
            const v = Number(typed);
            if (typed !== null && Number.isFinite(v)) onChange(snap(v));
            setTyped(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <span className="mono muted">{unit}</span>
      </span>
    </div>
  );
}

export type ReadoutData = { key: string; label: string; value: number; dec: number; unit: string; lo: number; hi: number; delta: number | null; tag?: string };

/** Label, big number, unit, a thin bar between the scale's ends, Δ against the revision, and a ▲ tag at a limit. */
export function Readout({ r, rev }: { r: ReadoutData; rev: string }) {
  const pct = Math.max(2, Math.min(100, ((r.value - r.lo) / (r.hi - r.lo)) * 100));
  return (
    <div className={`readout ${r.tag ? "lim" : ""}`}>
      <div className="lbl">{r.label}</div>
      <div className="val">
        <span className="n">{r.tag && r.value === 0 ? "—" : fmt(r.value, r.dec)}</span>
        <span className="u">{r.unit}</span>
      </div>
      <div className="meter" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="foot">
        <span>{r.delta === null || Number(Math.abs(r.delta).toFixed(r.dec)) === 0 ? `REV ${rev}` : `Δ ${signed(r.delta, r.dec)}`}</span>
        {r.tag && <span className="alarm">{r.tag}</span>}
      </div>
    </div>
  );
}

/** A rubber stamp: GO, NO-GO, DRAFT, RELEASED. */
export function Stamp({ text, tone, sub }: { text: string; tone: "alarm" | "muted" | "line"; sub: string }) {
  return (
    <div className="stamp-cell" role="status" aria-label={`${text}: ${sub}`}>
      <div className={`stamp ${tone}`}>{text}</div>
      <div className="mono muted" style={{ fontSize: 12 }}>
        {sub}
      </div>
    </div>
  );
}

/** A drawing's title block. */
export function TitleBlock({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="titleblock">
      {rows.map(([k, v]) => (
        <div key={k}>
          <div className="lbl">{k}</div>
          <div className="v">{v}</div>
        </div>
      ))}
    </div>
  );
}

/** One verb on the object, with a note on the right: "COMMIT REV C · BLOCKED". */
export function Verb({ label, note, onClick, disabled, go, pressed }: { label: string; note?: string; onClick: () => void; disabled?: boolean; go?: boolean; pressed?: boolean }) {
  return (
    <button type="button" className={`verb ${go ? "go" : ""}`} onClick={onClick} disabled={disabled} aria-pressed={pressed}>
      <span>{label}</span>
      {note && <span className="note">{note}</span>}
    </button>
  );
}
