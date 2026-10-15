import type { Engine } from "./engine.ts";

/**
 * The vehicle's shape and build as design choices, not catalogue picks: the
 * nose (shape and fineness), the fins, when the fairing comes off, and for
 * each stage its tank material, ullage pressure and structural safety
 * factor. A vehicle drawn with a geometry flies on the build-up models
 * (aerodynamics.ts, stability.ts, structures.ts); one without keeps the
 * hand-drawn curve and limits it was drawn with.
 */

export type NoseShape = "cone" | "ogive" | "power-half" | "von-karman";
export type Material = "al-2219" | "al-li" | "stainless" | "composite";
export type FinSection = "square" | "rounded" | "airfoil";

export type StageGeometry = {
  material: Material;
  /** Ullage (tank) pressure, bar. Pressure-fed stages hold their engine's feed pressure instead. */
  ullage: number;
  /** Design safety factor on the tank walls: thicker walls, more mass, more margin. */
  safetyFactor: number;
};

export type FinSet = {
  count: 3 | 4;
  /** Exposed span from the body, m. */
  span: number;
  rootChord: number;
  tipChord: number;
  /** Leading-edge sweep, degrees. */
  sweep: number;
  section: FinSection;
  /** Thickness, m. */
  thickness: number;
};

export type VehicleGeometry = {
  nose: { shape: NoseShape; fineness: number };
  /** Fairing jettison altitude, m. */
  jettisonAltitude: number;
  /** Fins on the booster's tail, or none. */
  fins?: FinSet;
  /** One per stage, booster first. */
  stages: StageGeometry[];
};

export const NOSE_LABELS: Record<NoseShape, string> = { cone: "Cone", ogive: "Tangent ogive", "power-half": "Power series ½", "von-karman": "Von Kármán (LD-Haack)" };

export type MaterialSpec = {
  label: string;
  /** Allowable stress, Pa. */
  stress: number;
  /** Young's modulus, Pa. */
  modulus: number;
  /** Density, kg/m³. */
  density: number;
  /** Thinnest wall the shop can make, m. */
  minGauge: number;
  /** Multiplier on structure cost per kg. */
  cost: number;
  /** One-off qualification when the company first builds with it, $k. */
  qualify: number;
  /** Range of the real buckling knock-down against the drawing's. */
  knockdown: [number, number];
};

export const MATERIALS: Record<Material, MaterialSpec> = {
  "al-2219": { label: "Aluminium 2219", stress: 350e6, modulus: 73e9, density: 2840, minGauge: 0.0012, cost: 1, qualify: 0, knockdown: [0.8, 1.1] },
  "al-li": { label: "Aluminium-lithium 2195", stress: 490e6, modulus: 76e9, density: 2700, minGauge: 0.0012, cost: 1.6, qualify: 250, knockdown: [0.78, 1.1] },
  stainless: { label: "Stainless 301", stress: 900e6, modulus: 200e9, density: 7900, minGauge: 0.0008, cost: 0.6, qualify: 120, knockdown: [0.85, 1.1] },
  composite: { label: "Carbon composite", stress: 600e6, modulus: 70e9, density: 1600, minGauge: 0.002, cost: 2.5, qualify: 400, knockdown: [0.6, 1.15] },
};

export const DEFAULT_STAGE: StageGeometry = { material: "al-2219", ullage: 3, safetyFactor: 1.4 };

export function defaultGeometry(stageCount: number): VehicleGeometry {
  return { nose: { shape: "ogive", fineness: 2 }, jettisonAltitude: 115_000, stages: Array.from({ length: stageCount }, () => ({ ...DEFAULT_STAGE })) };
}

/** A default fin set sized to a stage diameter. */
export function defaultFins(diameter: number): FinSet {
  return { count: 4, span: 0.6 * diameter, rootChord: 1.0 * diameter, tipChord: 0.4 * diameter, sweep: 35, section: "rounded", thickness: Math.max(0.006, 0.02 * diameter) };
}

/** Ranges for the design sliders. */
export const GEOMETRY_RANGES = {
  diameter: [0.6, 4.0] as [number, number],
  tankLength: [0.5, 30] as [number, number],
  fineness: [1.5, 4] as [number, number],
  ullage: [1, 8] as [number, number],
  safetyFactor: [1.25, 2.0] as [number, number],
  jettison: [80_000, 160_000] as [number, number],
  finSpan: [0, 1.5] as [number, number],
};

// ── The outer mould line ────────────────────────────────────────────────

/** A body of revolution segment, nose tip at x = 0, x increasing aft. */
export type BodySegment = { kind: "nose" | "cylinder" | "transition"; x: number; length: number; r0: number; r1: number; label: string };

/** What the layout needs of each stage. */
export type StageShape = { diameter: number; tankLength: number; engine: Engine; engineCount: number };

/** Bay lengths, m: payload bay under the nose, interstage, and the engine bay under the booster. */
const PAYLOAD_BAY = 1.0;
const INTERSTAGE = 0.6;
const ENGINE_BAY = 0.5;
const TRANSITION = 0.6;

/** Lay the stack out from the nose tip down: nose, payload bay, then each stage with interstages and transitions. */
export function layout(fairingDiameter: number, stages: StageShape[], geometry: VehicleGeometry): BodySegment[] {
  const out: BodySegment[] = [];
  let x = 0;
  const push = (kind: BodySegment["kind"], length: number, r0: number, r1: number, label: string) => {
    out.push({ kind, x, length, r0, r1, label });
    x += length;
  };
  const rf = fairingDiameter / 2;
  push("nose", geometry.nose.fineness * fairingDiameter, 0, rf, "nose");
  push("cylinder", PAYLOAD_BAY * fairingDiameter, rf, rf, "payload bay");
  let r = rf;
  // Top stage first.
  for (let i = stages.length - 1; i >= 0; i--) {
    const s = stages[i]!;
    const rs = s.diameter / 2;
    if (Math.abs(rs - r) > 1e-6) push("transition", TRANSITION + Math.abs(rs - r), r, rs, i === stages.length - 1 ? "fairing shoulder" : `interstage ${i + 1}`);
    r = rs;
    push("cylinder", s.tankLength, rs, rs, `stage ${i + 1} tanks`);
    push("cylinder", i === 0 ? ENGINE_BAY : INTERSTAGE * s.diameter, rs, rs, i === 0 ? "engine bay" : `interstage ${i}`);
  }
  return out;
}

export const bodyLength = (body: BodySegment[]) => body.reduce((sum, s) => sum + s.length, 0);
export const maxRadius = (body: BodySegment[]) => Math.max(...body.map((s) => Math.max(s.r0, s.r1)));

/** Radius of the nose at a fraction of its length from the tip, for a shape. */
export function noseRadius(shape: NoseShape, R: number, L: number, x: number): number {
  const t = Math.min(1, Math.max(0, x / L));
  switch (shape) {
    case "cone":
      return R * t;
    case "power-half":
      return R * Math.sqrt(t);
    case "von-karman": {
      const theta = Math.acos(1 - 2 * t);
      return (R / Math.sqrt(Math.PI)) * Math.sqrt(theta - Math.sin(2 * theta) / 2);
    }
    case "ogive": {
      // Tangent ogive: an arc tangent to the cylinder at the base.
      const rho = (R * R + L * L) / (2 * R);
      const xx = t * L;
      return Math.sqrt(rho * rho - (L - xx) ** 2) + R - rho;
    }
  }
}

/** Volume of the nose, m³, by integrating its profile. */
export function noseVolume(shape: NoseShape, R: number, L: number): number {
  const n = 64;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const r = noseRadius(shape, R, L, ((i + 0.5) / n) * L);
    v += Math.PI * r * r * (L / n);
  }
  return v;
}

/** Planform (side-view) area of the nose, m². */
export function nosePlanform(shape: NoseShape, R: number, L: number): number {
  const n = 64;
  let a = 0;
  for (let i = 0; i < n; i++) a += 2 * noseRadius(shape, R, L, ((i + 0.5) / n) * L) * (L / n);
  return a;
}

/** Wetted area of the nose, m². */
export function noseWetted(shape: NoseShape, R: number, L: number): number {
  const n = 64;
  let a = 0;
  let prev = 0;
  for (let i = 1; i <= n; i++) {
    const r = noseRadius(shape, R, L, (i / n) * L);
    a += Math.PI * (r + prev) * Math.hypot(L / n, r - prev);
    prev = r;
  }
  return a;
}

/** Fin planform area of one fin, m². */
export const finArea = (f: FinSet) => ((f.rootChord + f.tipChord) / 2) * f.span;
