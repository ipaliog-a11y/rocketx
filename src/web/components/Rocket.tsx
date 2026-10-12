import { useId } from "react";
import type { Engine } from "../../sim/engine.ts";
import type { Vehicle } from "../../sim/vehicle.ts";
import { COLORS } from "../palette.ts";

/**
 * A vehicle's side profile, drawn to scale from its real data: tank lengths
 * from propellant volume, nozzles from exit area. A blueprint, not art.
 */

/** Bulk density of kerosene and liquid oxygen together, kg/m³. */
const PROPELLANT_DENSITY = 1030;

type Part =
  | { kind: "fairing"; d: number; len: number }
  | { kind: "tank"; d: number; len: number; label: string }
  | { kind: "bay"; d: number; len: number }
  | { kind: "taper"; top: number; bottom: number; len: number }
  | { kind: "bells"; d: number; len: number; count: number; exit: number };

export function exitDiameter(engine: Engine): number {
  return Math.sqrt((4 * engine.exitArea) / Math.PI);
}

/** A bell expanded for near-vacuum: long, and wrong at sea level. */
export function isVacuumBell(engine: Engine): boolean {
  return engine.exitPressure < 20_000;
}

export function profile(vehicle: Vehicle): Part[] {
  const parts: Part[] = [];
  const stages = [...vehicle.stages].reverse();
  const top = stages[0]!;
  parts.push({ kind: "fairing", d: vehicle.fairingDiameter, len: vehicle.fairingDiameter * 2 });
  if (vehicle.fairingDiameter !== top.diameter) parts.push({ kind: "taper", top: vehicle.fairingDiameter, bottom: top.diameter, len: 0.5 });
  stages.forEach((stage, i) => {
    const area = (Math.PI * stage.diameter ** 2) / 4;
    parts.push({ kind: "tank", d: stage.diameter, len: stage.propellantMass / PROPELLANT_DENSITY / area, label: stage.name });
    const below = stages[i + 1];
    if (below) {
      if (below.diameter === stage.diameter) parts.push({ kind: "bay", d: stage.diameter, len: 0.6 });
      else parts.push({ kind: "taper", top: stage.diameter, bottom: below.diameter, len: 0.5 });
    }
  });
  const booster = vehicle.stages[0]!;
  const exit = exitDiameter(booster.engine);
  parts.push({ kind: "bay", d: booster.diameter, len: 0.5 });
  parts.push({
    kind: "bells",
    d: booster.diameter,
    len: exit * (isVacuumBell(booster.engine) ? 1.5 : 1.0),
    count: Math.min(3, booster.engineCount),
    exit,
  });
  return parts;
}

export function height(vehicle: Vehicle): number {
  return profile(vehicle).reduce((t, p) => t + p.len, 0);
}

export function width(vehicle: Vehicle): number {
  return Math.max(vehicle.fairingDiameter, ...vehicle.stages.map((s) => s.diameter));
}

type Props = { vehicle: Vehicle; scale: number; labels?: boolean };

export function Rocket({ vehicle, scale, labels = false }: Props) {
  // useId gives ":r1:"-style ids; SVG url(#…) references want plain ones.
  const hatch = `hatch${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const parts = profile(vehicle);
  const pad = 2;
  const w = width(vehicle) * scale + pad * 2;
  const h = height(vehicle) * scale + pad * 2;
  const cx = w / 2;
  let y = pad;
  const shapes = parts.map((p, i) => {
    const top = y;
    const len = p.len * scale;
    y += len;
    const stroke = { stroke: COLORS.data, strokeWidth: 1.2 };
    switch (p.kind) {
      case "fairing": {
        const half = (p.d * scale) / 2;
        return <path key={i} d={`M${cx - half} ${top + len} Q${cx - half} ${top} ${cx} ${top} Q${cx + half} ${top} ${cx + half} ${top + len} Z`} fill="#222c36" {...stroke} />;
      }
      case "tank": {
        const half = (p.d * scale) / 2;
        return (
          <g key={i}>
            <rect x={cx - half} y={top} width={half * 2} height={len} fill="#1a222b" {...stroke} />
            {labels && len > p.label.length * 7 + 12 && (
              <text x={cx} y={top + len / 2} fill={COLORS.muted} fontSize={11} textAnchor="middle" transform={`rotate(-90 ${cx} ${top + len / 2})`} dy={4}>
                {p.label}
              </text>
            )}
          </g>
        );
      }
      case "bay": {
        const half = (p.d * scale) / 2;
        return <rect key={i} x={cx - half} y={top} width={half * 2} height={len} fill={`url(#${hatch})`} {...stroke} />;
      }
      case "taper": {
        const a = (p.top * scale) / 2;
        const b = (p.bottom * scale) / 2;
        return <polygon key={i} points={`${cx - a},${top} ${cx + a},${top} ${cx + b},${top + len} ${cx - b},${top + len}`} fill="#222c36" {...stroke} />;
      }
      case "bells": {
        const slot = (p.d * scale) / p.count;
        const exit = p.exit * scale;
        const throat = Math.max(2, exit * 0.4);
        const left = cx - (p.d * scale) / 2;
        return (
          <g key={i}>
            {Array.from({ length: p.count }, (_, n) => {
              const c = left + slot * (n + 0.5);
              return (
                <polygon
                  key={n}
                  points={`${c - throat / 2},${top} ${c + throat / 2},${top} ${c + exit / 2},${top + len} ${c - exit / 2},${top + len}`}
                  fill="#3a2a12"
                  stroke={COLORS.action}
                  strokeWidth={1.2}
                />
              );
            })}
          </g>
        );
      }
    }
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <pattern id={hatch} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={6} height={6} fill="#1a222b" />
          <line x1={0} y1={0} x2={0} y2={6} stroke={COLORS.line} strokeWidth={3} />
        </pattern>
      </defs>
      {shapes}
    </svg>
  );
}

/** One engine's nozzle, side on: chamber, throat, then the bell out to the exit. */
/** An engine's outline in a box `size` wide: the path, its centre line, and where the bell ends. */
export function nozzleGeometry(engine: Engine, size: number): { d: string; cx: number; exitY: number; exitWidth: number; height: number } {
  const s = size / 0.75; // px per metre: the widest bell fills most of the box
  const cx = size / 2;
  const ex = exitDiameter(engine) * s;
  const cw = Math.min(size * 0.25, ex * 0.55);
  const tw = cw * 0.45;
  const ch = size * 0.22;
  const yT = ch + size * 0.07;
  const bell = Math.min(size * 1.15 - yT - 2, ex * (isVacuumBell(engine) ? 1.5 : 1.0));
  const yE = yT + bell;
  const flare = (ex / 2 - tw / 2) * 0.2;
  const d = `M${cx - cw / 2} 2 L${cx + cw / 2} 2 L${cx + cw / 2} ${ch} L${cx + tw / 2} ${yT} Q${cx + tw / 2 + flare} ${yT + bell * 0.7} ${cx + ex / 2} ${yE} L${cx - ex / 2} ${yE} Q${cx - tw / 2 - flare} ${yT + bell * 0.7} ${cx - tw / 2} ${yT} L${cx - cw / 2} ${ch} Z`;
  return { d, cx, exitY: yE, exitWidth: ex, height: size * 1.15 };
}

export function Nozzle({ engine, size = 110 }: { engine: Engine; size?: number }) {
  const g = nozzleGeometry(engine, size);
  return (
    <svg width={size} height={g.height} viewBox={`0 0 ${size} ${g.height}`} aria-hidden="true">
      <path d={g.d} fill="#1e2730" stroke={isVacuumBell(engine) ? COLORS.action : COLORS.data} strokeWidth={1.5} />
    </svg>
  );
}
