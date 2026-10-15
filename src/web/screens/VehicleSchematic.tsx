import type { KeyboardEvent, ReactNode } from "react";
import { layout, noseRadius, type BodySegment, type VehicleGeometry } from "../../sim/geometry.ts";
import type { VehicleSpec } from "../../sim/builder.ts";
import type { Vehicle } from "../../sim/vehicle.ts";

/**
 * The stack in side view, nose up, drawn to scale from the same layout the
 * aerodynamics, stability and structures models use: nose by its shape and
 * fineness, tanks, interstages, shoulders, fins and the engine bells. The
 * centre of mass (⊕) and centre of pressure (◇) at liftoff, with the static
 * margin between them. Every part is a button.
 */

const CX = 260;
const TOP = 24;
const ROOM = 500;

type Shape = { spec: VehicleSpec & { geometry: VehicleGeometry }; vehicle: Vehicle };

function geometryOf({ spec, vehicle }: Shape) {
  const stages = spec.stages.map((s, i) => ({ diameter: s.diameter, tankLength: s.tankLength, engine: vehicle.stages[i]!.engine, engineCount: s.engineCount }));
  const body = layout(spec.fairingDiameter, stages, spec.geometry);
  const length = body.reduce((sum, s) => sum + s.length, 0);
  const radius = Math.max(...body.map((s) => Math.max(s.r0, s.r1)));
  return { body, length, radius };
}

/** Outline of the body as one path, nose to tail and back. */
function outline(body: BodySegment[], geometry: VehicleGeometry, s: number, y0: number): string {
  const right: Array<[number, number]> = [];
  for (const seg of body) {
    if (seg.kind === "nose") {
      for (let i = 0; i <= 24; i++) {
        const x = (i / 24) * seg.length;
        right.push([noseRadius(geometry.nose.shape, seg.r1, seg.length, x), seg.x + x]);
      }
    } else {
      right.push([seg.r0, seg.x], [seg.r1, seg.x + seg.length]);
    }
  }
  const pt = ([r, x]: [number, number], side: 1 | -1) => `${(CX + side * r * s).toFixed(1)} ${(y0 + x * s).toFixed(1)}`;
  return `M${right.map((p) => pt(p, 1)).join(" L")} L${[...right].reverse().map((p) => pt(p, -1)).join(" L")} Z`;
}

function Part({ id, label, on, lim, pick, children }: { id: string; label: string; on: boolean; lim: boolean; pick: (id: string) => void; children: ReactNode }) {
  return (
    <g
      className={`sch-part ${on ? "on" : ""} ${lim ? "lim" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={on}
      aria-label={`${label}${lim ? ", at a limit" : ""}`}
      onClick={() => pick(id)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick(id);
        }
      }}
    >
      {children}
    </g>
  );
}

export function VehicleSchematic({
  draft,
  base,
  sel,
  lim,
  pick,
  name,
}: {
  draft: Shape;
  base: Shape | null;
  sel: string;
  lim: Record<string, boolean>;
  pick: (id: string) => void;
  name: string;
}) {
  const g = geometryOf(draft);
  const gb = base ? geometryOf(base) : null;
  const finSpan = draft.spec.geometry.fins?.span ?? 0;
  const s = Math.min(ROOM / Math.max(g.length + 1.5, gb ? gb.length + 1.5 : 0), 200 / Math.max(g.radius + finSpan, 0.3));
  const y = (x: number) => TOP + x * s;
  const segs = g.body;
  const find = (label: string) => segs.find((b) => b.label === label);
  const nose = segs[0]!;
  const bay = segs[1]!;
  const geo = draft.spec.geometry;
  const v = draft.vehicle;
  const n = draft.spec.stages.length;
  const labelX = CX + g.radius * s + Math.max(finSpan * s, 0) + 18;

  // Each stage's part: the transition above it, its tanks, and the bay below.
  const stageRange = (i: number) => {
    const tank = find(`stage ${i + 1} tanks`)!;
    const above = segs[segs.indexOf(tank) - 1];
    const below = segs[segs.indexOf(tank) + 1];
    const from = above && above.kind === "transition" ? above.x : tank.x;
    const to = below ? below.x + below.length : tank.x + tank.length;
    return { from, to, r: tank.r0 };
  };

  // Engine bells under the tail, as many as fit side by side to draw.
  const tail = segs.at(-1)!;
  const booster = v.stages[0]!;
  const exitR = Math.sqrt(booster.engine.exitArea / Math.PI);
  const shown = Math.min(booster.engineCount, Math.max(1, Math.floor((2 * tail.r1) / (2 * exitR * 1.1))));
  const bellLen = exitR * (booster.engine.exitPressure < 20_000 ? 3 : 2);
  const yTail = y(tail.x + tail.length);
  const fins = geo.fins && geo.fins.span > 0 ? geo.fins : null;

  const st = v.stability?.points[0];
  const cg = st ? y(st.cg) : null;
  const cp = st ? y(st.cp) : null;

  return (
    <svg className="schematic" viewBox="0 0 600 560" role="group" aria-label={`Vehicle schematic of ${name}: fairing, ${n} stage${n === 1 ? "" : "s"}, fins, centre of mass and centre of pressure. Select a part to edit.`}>
      <path className="corner" d="M4 20 V4 H20 M580 4 H596 V20 M596 540 V556 H580 M20 556 H4 V540" />
      {gb && base && <path className="base" d={outline(gb.body, base.spec.geometry, s, TOP)} />}

      <Part id="fairing" label="Fairing and nose" on={sel === "fairing"} lim={!!lim.fairing} pick={pick}>
        <rect className="hit" x={CX - nose.r1 * s - 6} y={y(0) - 4} width={2 * nose.r1 * s + 12} height={(nose.length + bay.length) * s + 8} />
        <path className="f" d={outline([nose, bay], geo, s, TOP)} />
        <path className="s" d={`M${CX - bay.r0 * s} ${y(bay.x)} H${CX + bay.r0 * s}`} style={{ strokeDasharray: "2 4" }} />
        <text className="v" x={labelX} y={y(nose.length * 0.6)}>
          FRG-1
        </text>
        <text x={labelX} y={y(nose.length * 0.6) + 16}>
          L/D {geo.nose.fineness.toFixed(2)}
        </text>
      </Part>

      {draft.spec.stages.map((_, i) => {
        const r = stageRange(i);
        const id = `stage-${i}`;
        const part = { from: r.from, to: r.to };
        const segsIn = segs.filter((b) => b.x >= part.from - 1e-6 && b.x + b.length <= part.to + 1e-6);
        return (
          <Part key={id} id={id} label={`Stage ${i + 1}`} on={sel === id} lim={!!lim[id]} pick={pick}>
            <rect className="hit" x={CX - r.r * s - 6} y={y(part.from)} width={2 * r.r * s + 12} height={(part.to - part.from) * s} />
            {segsIn.map((b) => (
              <path
                key={b.label}
                className="f"
                d={`M${CX - b.r0 * s} ${y(b.x)} L${CX + b.r0 * s} ${y(b.x)} L${CX + b.r1 * s} ${y(b.x + b.length)} L${CX - b.r1 * s} ${y(b.x + b.length)} Z`}
                style={b.label.includes("tanks") ? undefined : { strokeDasharray: "3 3" }}
              />
            ))}
            <text className="v" x={labelX} y={y((part.from + part.to) / 2)}>
              S{i + 1}
            </text>
            <text x={labelX} y={y((part.from + part.to) / 2) + 16}>
              Ø {(2 * r.r).toFixed(2)} m
            </text>
            {lim[id] && (
              <text className="alarm" x={labelX} y={y((part.from + part.to) / 2) + 32}>
                ▲ LIMIT
              </text>
            )}
          </Part>
        );
      })}

      <Part id="fins" label={fins ? `Fins, ${fins.count} at ${fins.span.toFixed(2)} m span` : "Fins: none"} on={sel === "fins"} lim={!!lim.fins} pick={pick}>
        <rect className="hit" x={CX - (tail.r1 + Math.max(fins?.span ?? 0.3, 0.3)) * s - 4} y={yTail - (fins?.rootChord ?? 0.5) * s - 4} width={2 * (tail.r1 + Math.max(fins?.span ?? 0.3, 0.3)) * s + 8} height={(fins?.rootChord ?? 0.5) * s + 8} />
        {fins ? (
          ([1, -1] as const).map((side) => {
            const root = fins.rootChord * s;
            const tip = fins.tipChord * s;
            const span = fins.span * s;
            const lead = span * Math.tan((fins.sweep * Math.PI) / 180);
            const x0 = CX + side * tail.r1 * s;
            const x1 = x0 + side * span;
            return <path key={side} className="f" d={`M${x0} ${yTail - root} L${x1} ${yTail - root + lead} L${x1} ${yTail - root + lead + tip} L${x0} ${yTail} Z`} />;
          })
        ) : (
          <text x={CX + tail.r1 * s + 10} y={yTail - 6}>
            NO FINS
          </text>
        )}
        {fins && (
          <text className="v" x={labelX} y={yTail - 4}>
            FIN-1
          </text>
        )}
      </Part>

      {geo.recovery && n > 1 && (() => {
        const rec = geo.recovery;
        const top = stageRange(0);
        const r0 = top.r * s;
        const legLen = Math.min(0.25 * (top.to - top.from), 3 * top.r) * s;
        const grid = Math.max(6, 0.3 * top.r * s);
        return (
          <Part id="rec" label={`Booster recovery: ${rec.mode === "rtls" ? "back to the pad" : "drone ship"}${rec.legs ? ", legs" : ""}${rec.gridFins ? ", grid fins" : ""}`} on={sel === "rec"} lim={!!lim.rec} pick={pick}>
            <rect className="hit" x={CX - r0 - grid - 6} y={y(top.from) - 4} width={2 * (r0 + grid) + 12} height={grid + 8} />
            {/* Grid fins stowed flat at the top of the booster. */}
            {rec.gridFins &&
              ([1, -1] as const).map((side) => <rect key={side} className="f" x={side > 0 ? CX + r0 : CX - r0 - grid} y={y(top.from) + 2} width={grid} height={grid * 0.7} style={{ strokeDasharray: "1 2" }} />)}
            {/* Legs folded up against the tail. */}
            {rec.legs &&
              ([1, -1] as const).map((side) => <path key={side} className="f" d={`M${CX + side * r0} ${yTail - legLen} L${CX + side * (r0 + 4)} ${yTail + 2}`} />)}
            <text className="v" x={labelX} y={y(top.from) + 16}>
              REC-1
            </text>
          </Part>
        );
      })()}

      {/* Engine bells under the tail, from the engine's own exit area. */}
      {Array.from({ length: shown }, (_, k) => {
        const spacing = (2 * tail.r1 * s) / shown;
        const cx = CX - tail.r1 * s + spacing * (k + 0.5);
        const rt = exitR * 0.35 * s;
        return <path key={k} className="feedline" d={`M${cx - rt} ${yTail} L${cx - exitR * s} ${yTail + bellLen * s} M${cx + rt} ${yTail} L${cx + exitR * s} ${yTail + bellLen * s} M${cx - exitR * s} ${yTail + bellLen * s} H${cx + exitR * s}`} />;
      })}
      {booster.engineCount > shown && (
        <text x={CX + tail.r1 * s + 10} y={yTail + bellLen * s}>
          ×{booster.engineCount}
        </text>
      )}

      {/* Centre of mass and centre of pressure at liftoff, and the margin between. */}
      {cg !== null && cp !== null && st && (
        <g aria-label={`Static margin ${st.margin.toFixed(2)} calibres at liftoff`}>
          <circle cx={CX} cy={cg} r={6} style={{ fill: "var(--ed-bg)", stroke: "var(--ed-text)" }} />
          <path d={`M${CX - 6} ${cg} H${CX + 6} M${CX} ${cg - 6} V${cg + 6}`} style={{ stroke: "var(--ed-text)" }} />
          <path d={`M${CX} ${cp - 7} L${CX + 7} ${cp} L${CX} ${cp + 7} L${CX - 7} ${cp} Z`} style={{ fill: "var(--ed-bg)", stroke: st.margin < 0 ? "var(--ed-alarm)" : "var(--ed-line)" }} />
          <path className="dim" d={`M${CX - g.radius * s - 30} ${cg} H${CX - g.radius * s - 14} M${CX - g.radius * s - 30} ${cp} H${CX - g.radius * s - 14} M${CX - g.radius * s - 22} ${cg} V${cp}`} />
          <text x={CX - g.radius * s - 34} y={(cg + cp) / 2 + 5} textAnchor="end" className={st.margin < 0 ? "alarm" : "v"}>
            {st.margin < 0 ? "▲ " : ""}SM {st.margin.toFixed(2)}
          </text>
          <text x={CX - g.radius * s - 34} y={(cg + cp) / 2 + 21} textAnchor="end">
            ⊕ CG ◇ CP
          </text>
        </g>
      )}
    </svg>
  );
}

/** Drawing scale, 1:n, at a 96 dpi sheet. */
export function vehicleScale(draft: Shape): number {
  const g = geometryOf(draft);
  const finSpan = draft.spec.geometry.fins?.span ?? 0;
  const s = Math.min(ROOM / (g.length + 1.5), 200 / Math.max(g.radius + finSpan, 0.3));
  return Math.max(1, Math.round(1 / (s * 0.000264583)));
}
