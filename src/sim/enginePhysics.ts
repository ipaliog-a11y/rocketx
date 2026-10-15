import { G0 } from "./constants.ts";
import type { Engine } from "./engine.ts";
import { COOLINGS, CYCLES, engineUnitCost, INJECTORS, NOZZLES, partsProblems, type CycleOption, type EngineParts, type NozzleOption } from "./parts.ts";

/**
 * The engine as a design point, not a catalogue pick: chamber pressure,
 * nozzle expansion ratio, turbine inlet temperature and pump discharge (or
 * tank pressure on a pressure-fed engine). Thrust and Isp come from c* and
 * the thrust coefficient of an ideal nozzle; the feed cycle costs what
 * driving its pumps costs. The part choices (cycle, injector, cooling) stay
 * technologies with their own hidden quirks, and the nozzle part is the
 * band of ε the bell falls in.
 *
 * Calibration: every cycle's reference point (its usual chamber pressure,
 * a bell sized for the pad) reproduces the catalogue's Isp and thrust.
 * Away from it the physics decides.
 */

export type EngineDesign = {
  /** Chamber pressure, bar. */
  pc: number;
  /** Nozzle expansion ratio, exit area over throat area. */
  eps: number;
  /** Turbine inlet temperature, K. Gas-generator engines only. */
  t0?: number;
  /** Pump discharge pressure, bar; on a pressure-fed engine, the tank pressure. */
  pd: number;
};

/** Ratio of specific heats for kerolox combustion products in the nozzle. */
const GAMMA = 1.2;
/** Bulk propellant density for pump work, kg/m³. */
const RHO = 1030;
const PUMP_EFFICIENCY = 0.65;
/** Gas-generator turbine: fuel-rich gas cp, J/(kg·K), pressure ratio and efficiency. */
const TURBINE = { cp: 2500, gamma: 1.15, pressureRatio: 20, efficiency: 0.6 };
/** The turbine exhaust is dumped overboard at about this share of the main chamber's Isp. */
const EXHAUST_ISP_SHARE = 0.35;

/** Blades lose strength fast above this, K. */
export const BLADE_REDLINE = 950;
/** Injector stiffness: pump (or tank) pressure over chamber pressure at least this. */
export const MIN_PUMP_MARGIN = 1.2;
/** Above this stiffness the injector is as stable as it gets. */
const STIFF_MARGIN = 1.3;
/** A gas generator can't spare more of the flow than this for its turbine. */
export const MAX_TURBINE_FLOW = 0.06;
/** Electric pumps: motor power past the reference point this many times over is out of reach. */
const MOTOR_HEADROOM = 1.8;
/** Tanks that hold more than this are too heavy to fly, bar. */
export const MAX_TANK_PRESSURE = 35;

const PRESSURE_FED = (c: CycleOption) => c === "pressure-fed" || c === "storable";
const PA = 1e5;

/** Usual chamber pressure for each cycle, bar: where the catalogue figures hold. */
export const REFERENCE_PC: Record<CycleOption, number> = { "pressure-fed": 15, "electric-pump": 40, "gas-generator": 70, storable: 10 };
const REFERENCE_T0 = 900;
const REFERENCE_MARGIN = 1.35;

/** Slider ranges per cycle. */
export const DESIGN_RANGES: Record<CycleOption, { pc: [number, number]; pd: [number, number]; t0?: [number, number]; eps: [number, number] }> = {
  "pressure-fed": { pc: [6, 30], pd: [8, 40], eps: [2, 120] },
  "electric-pump": { pc: [20, 70], pd: [25, 100], eps: [3, 160] },
  "gas-generator": { pc: [40, 120], pd: [45, 180], t0: [700, 1100], eps: [4, 200] },
  storable: { pc: [5, 25], pd: [6, 35], eps: [2, 120] },
};

// ── Ideal nozzle ───────────────────────────────────────────────────────────

const g = GAMMA;
/** Exit-to-chamber pressure ratio at exit Mach M. */
const pressureAtMach = (m: number) => (1 + ((g - 1) / 2) * m * m) ** (-g / (g - 1));
/** Area ratio at exit Mach M. */
const areaAtMach = (m: number) => (1 / m) * ((2 / (g + 1)) * (1 + ((g - 1) / 2) * m * m)) ** ((g + 1) / (2 * (g - 1)));

/** Supersonic exit Mach for an expansion ratio, by bisection. */
export function exitMach(eps: number): number {
  let lo = 1;
  let hi = 30;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (areaAtMach(mid) < eps) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Exit pressure over chamber pressure for an expansion ratio. */
export function pressureRatio(eps: number): number {
  return pressureAtMach(exitMach(eps));
}

/** Expansion ratio that brings the exhaust down to this share of chamber pressure. */
export function epsForPressureRatio(pr: number): number {
  const m = Math.sqrt((2 / (g - 1)) * (pr ** (-(g - 1) / g) - 1));
  return areaAtMach(m);
}

const GAMMA_FN = Math.sqrt(g) * (2 / (g + 1)) ** ((g + 1) / (2 * (g - 1)));

/** Vacuum thrust coefficient of an ideal bell: thrust over chamber pressure times throat area. */
export function cfVac(eps: number): number {
  const pr = pressureRatio(eps);
  return GAMMA_FN * Math.sqrt(((2 * g) / (g - 1)) * (1 - pr ** ((g - 1) / g))) + eps * pr;
}

/** Characteristic velocity, m/s: higher chamber pressure holds back a little dissociation. */
export function cStar(pc: number): number {
  return 1780 * (1 + 0.02 * Math.log(pc / 70));
}

// ── Feed system ───────────────────────────────────────────────────────────

/** Pump work per kilogram of propellant, J/kg. */
export const pumpWork = (pd: number) => (pd * PA) / (RHO * PUMP_EFFICIENCY);

/** Turbine work per kilogram of gas at an inlet temperature, J/kg. */
export const turbineWork = (t0: number) =>
  TURBINE.cp * t0 * (1 - TURBINE.pressureRatio ** (-(TURBINE.gamma - 1) / TURBINE.gamma)) * TURBINE.efficiency;

/** Share of the propellant flow a gas generator burns to drive its pumps. */
export function turbineFlow(design: EngineDesign): number {
  return pumpWork(design.pd) / turbineWork(design.t0 ?? REFERENCE_T0);
}

/** What dumping the turbine exhaust does to the engine's Isp, as a factor. */
function feedFactor(cycle: CycleOption, design: EngineDesign): number {
  if (cycle !== "gas-generator") return 1;
  return 1 - (1 - EXHAUST_ISP_SHARE) * turbineFlow(design);
}

// ── Reference points ──────────────────────────────────────────────────────

/** The bell each nozzle part stands for at a cycle's usual chamber pressure: its catalogue exit pressure. */
export function referenceEps(cycle: CycleOption, nozzle: NozzleOption): number {
  return epsForPressureRatio(NOZZLES[nozzle].exitPressure / (REFERENCE_PC[cycle] * PA));
}

const NOZZLE_ORDER: NozzleOption[] = ["sea-level", "altitude", "vacuum", "large-vacuum"];

/** The nozzle part a bell counts as: the band of ε around each part's reference bell. */
export function nozzleFor(cycle: CycleOption, eps: number): NozzleOption {
  const refs = NOZZLE_ORDER.map((n) => referenceEps(cycle, n));
  for (let i = 0; i < refs.length - 1; i++) if (eps < Math.sqrt(refs[i]! * refs[i + 1]!)) return NOZZLE_ORDER[i]!;
  return "large-vacuum";
}

/** Where a set of parts sits on the new model: the cycle's usual pressure and the nozzle part's own bell. */
export function defaultDesign(parts: EngineParts): EngineDesign {
  const pc = REFERENCE_PC[parts.cycle];
  return {
    pc,
    eps: Math.round(referenceEps(parts.cycle, parts.nozzle) * 10) / 10,
    pd: Math.round(pc * REFERENCE_MARGIN * 10) / 10,
    ...(parts.cycle === "gas-generator" ? { t0: REFERENCE_T0 } : {}),
  };
}

/** The design point an engine was drawn to: its own, or for an engine from before the model, where its parts sit. */
export function designOf(engine: Engine): EngineDesign | null {
  if (engine.design) return engine.design;
  if (!engine.parts) return null;
  return { ...defaultDesign(engine.parts), eps: Math.round(epsForPressureRatio(engine.exitPressure / (REFERENCE_PC[engine.parts.cycle] * PA)) * 10) / 10 };
}

// ── Performance ───────────────────────────────────────────────────────────

/** Everything the model says about a design point. */
export type Performance = {
  /** The parts with the nozzle part set by ε. */
  parts: EngineParts;
  thrustVac: number;
  ispVac: number;
  exitArea: number;
  exitPressure: number;
  throatArea: number;
  ratedLife: number;
  unitCost: number;
  /** Dry mass, kg. */
  mass: number;
  /** Probability, on paper, of an acoustic instability: the injector's, raised by a soft feed. */
  instability: number;
  hardStart: number;
  /** Share of the flow a gas generator spends on its turbine; 0 otherwise. */
  turbineFlow: number;
  /** Pump (or tank) pressure over chamber pressure. */
  pumpMargin: number;
  /** Pump shaft power, kW. */
  pumpPower: number;
};

/**
 * The bell each cycle's catalogue figures are quoted with: a pad bell, except
 * storables, which are kick-stage engines and only make sense with a vacuum bell.
 */
const ANCHOR: Record<CycleOption, NozzleOption> = { "pressure-fed": "sea-level", "electric-pump": "sea-level", "gas-generator": "sea-level", storable: "vacuum" };

/** The reference engine for a cycle and size, which the catalogue numbers describe. */
function reference(parts: EngineParts) {
  const anchor = NOZZLES[ANCHOR[parts.cycle]];
  const ref = defaultDesign({ ...parts, nozzle: ANCHOR[parts.cycle] });
  const cf = cfVac(ref.eps);
  const physical = cStar(ref.pc) * cf * feedFactor(parts.cycle, ref);
  const thrust = parts.size * 1000 * anchor.thrust;
  const isp = CYCLES[parts.cycle].isp * anchor.isp;
  const throat = thrust / (ref.pc * PA * cf);
  const flow = thrust / (isp * G0);
  // Mass and the bell scale from the pad bell whatever the anchor.
  const padEps = referenceEps(parts.cycle, "sea-level");
  return { ref, cf, physical, isp, thrust, padThrust: parts.size * 1000, padEps, throat, power: flow * pumpWork(ref.pd) };
}

/** Instability chance for an injector at a feed stiffness. */
export function stiffnessFactor(margin: number): number {
  if (margin >= STIFF_MARGIN) return 1;
  const short = Math.min(1.5, (STIFF_MARGIN - margin) / (STIFF_MARGIN - MIN_PUMP_MARGIN));
  return 1 + 2 * short ** 1.5;
}

export function performance(partsIn: EngineParts, design: EngineDesign): Performance {
  const parts: EngineParts = { ...partsIn, nozzle: nozzleFor(partsIn.cycle, design.eps) };
  const cycle = CYCLES[parts.cycle];
  const cooling = COOLINGS[parts.cooling];
  const nozzle = NOZZLES[parts.nozzle];
  const ref = reference(parts);
  const cf = cfVac(design.eps);
  const feed = feedFactor(parts.cycle, design);
  // Isp scales from the catalogue's reference engine by what the physics changes.
  const ispVac = ref.isp * cooling.isp * ((cStar(design.pc) * cf * feed) / ref.physical);
  // The throat is the chamber's size; pressure and the bell set the thrust through it.
  const thrustVac = design.pc * PA * ref.throat * cf;
  const exitArea = design.eps * ref.throat;
  const exitPressure = design.pc * PA * pressureRatio(design.eps);
  const pumpMargin = design.pd / design.pc;
  const flow = thrustVac / (ispVac * G0);
  const pumpPower = PRESSURE_FED(parts.cycle) ? 0 : flow * pumpWork(design.pd);
  const ratedLife = cooling.life * nozzle.life * (ref.ref.pc / design.pc) ** 0.8;

  // Mass: the chamber's walls thicken with pressure (the throat is fixed), pumps grow with their power, the bell with its size.
  const tw = PRESSURE_FED(parts.cycle) ? 40 : 70;
  const refMass = ref.padThrust / (G0 * tw);
  const bell = (design.eps / ref.padEps) ** 0.4;
  const chamber = (design.pc / ref.ref.pc) ** 0.6;
  const pumps = PRESSURE_FED(parts.cycle) ? 0 : (pumpPower / ref.power) ** 0.7;
  const battery = parts.cycle === "electric-pump" ? (pumpPower / ref.power) * (ratedLife / (cooling.life * nozzle.life)) : 0;
  const mass = PRESSURE_FED(parts.cycle)
    ? refMass * (0.8 * chamber + 0.2 * bell)
    : parts.cycle === "electric-pump"
      ? refMass * (0.45 * chamber + 0.15 * pumps + 0.2 * battery + 0.2 * bell)
      : refMass * (0.55 * chamber + 0.25 * pumps + 0.2 * bell);

  // Hotter blades need costlier alloys; harder chambers costlier machining.
  const hot = ((design.t0 ?? REFERENCE_T0) - REFERENCE_T0) / 100;
  const unitCost = Math.round(engineUnitCost(parts, thrustVac) * (0.75 + 0.25 * Math.sqrt(design.pc / ref.ref.pc)) * Math.max(0.85, 1 + 0.15 * hot));

  return {
    parts,
    thrustVac: Math.round(thrustVac),
    ispVac: Math.round(ispVac * 100) / 100,
    exitArea: Math.round(exitArea * 10_000) / 10_000,
    exitPressure: Math.round(exitPressure),
    throatArea: ref.throat,
    ratedLife: Math.round(ratedLife),
    unitCost,
    mass: Math.round(mass * 10) / 10,
    instability: Math.min(0.9, INJECTORS[parts.injector].instability * stiffnessFactor(pumpMargin)),
    hardStart: cycle.hardStart,
    turbineFlow: parts.cycle === "gas-generator" ? turbineFlow(design) : 0,
    pumpMargin,
    pumpPower: pumpPower / 1000,
  };
}

// ── Limits ────────────────────────────────────────────────────────────────

export type LimitId = "pump-margin" | "blade-temp" | "turbine-power" | "motor-power" | "tank-pressure" | "size-for-cycle" | "separation-sl";

export type Limit = {
  id: LimitId;
  ok: boolean;
  /** A warning only: the design can be built, with a restriction. */
  warning?: boolean;
  /** "Pd/Pc 1.18 / min 1.20" */
  value: string;
  text: string;
};

/** Ambient pressure at sea level, Pa (kept here to avoid a cycle with constants for one number). */
const SEA_LEVEL = 101_325;
/** Exhaust separates from the wall below this share of ambient pressure (Summerfield). */
const SEPARATION_RATIO = 0.4;

/** Electric pump power the motor can deliver at this size, kW. */
export function motorLimit(parts: EngineParts): number {
  return (reference(parts).power * MOTOR_HEADROOM) / 1000;
}

/** Turbine-driven pump pressure the gas generator can reach at this inlet temperature, bar. */
export function maxDrivenPressure(t0: number): number {
  return (MAX_TURBINE_FLOW * turbineWork(t0) * RHO * PUMP_EFFICIENCY) / PA;
}

/** Every limit a design point runs into. */
export function designLimits(parts: EngineParts, design: EngineDesign, perf = performance(parts, design)): Limit[] {
  const limits: Limit[] = [];
  const f = (v: number, d = 2) => v.toFixed(d);
  limits.push({
    id: "pump-margin",
    ok: perf.pumpMargin >= MIN_PUMP_MARGIN,
    value: `${PRESSURE_FED(parts.cycle) ? "PT" : "Pd"}/Pc ${f(perf.pumpMargin)} / min ${f(MIN_PUMP_MARGIN)}`,
    text: "Feed pressure too close to chamber pressure: the injector can't stay stiff.",
  });
  if (parts.cycle === "gas-generator") {
    const t0 = design.t0 ?? REFERENCE_T0;
    limits.push({ id: "blade-temp", ok: t0 <= BLADE_REDLINE, value: `T0 ${Math.round(t0)} / max ${BLADE_REDLINE} K`, text: "Turbine blades above their redline." });
    limits.push({
      id: "turbine-power",
      ok: perf.turbineFlow <= MAX_TURBINE_FLOW,
      value: `Pd ${Math.round(design.pd)} / ${Math.round(maxDrivenPressure(t0))} bar`,
      text: "The turbine can't drive the pumps that hard.",
    });
  }
  if (parts.cycle === "electric-pump") {
    const cap = motorLimit(parts);
    limits.push({ id: "motor-power", ok: perf.pumpPower <= cap, value: `${Math.round(perf.pumpPower)} / ${Math.round(cap)} kW`, text: "More pump power than the motors can give." });
  }
  if (PRESSURE_FED(parts.cycle)) {
    limits.push({ id: "tank-pressure", ok: design.pd <= MAX_TANK_PRESSURE, value: `PT ${f(design.pd, 1)} / max ${MAX_TANK_PRESSURE} bar`, text: "Tanks that hold this are too heavy to fly." });
  }
  const problems = partsProblems(parts);
  limits.push({ id: "size-for-cycle", ok: problems.length === 0, value: `${parts.size} kN`, text: problems[0] ?? "" });
  limits.push({
    id: "separation-sl",
    ok: perf.exitPressure >= SEPARATION_RATIO * SEA_LEVEL,
    warning: true,
    value: `ε ${f(design.eps, 1)} / max ${f(seaLevelEps(parts.cycle, design.pc), 1)}`,
    text: "Separates at sea level: an upper-stage or altitude engine only.",
  });
  return limits;
}

/** The largest bell that still fires on the pad at a chamber pressure. */
export function seaLevelEps(_cycle: CycleOption, pc: number): number {
  return epsForPressureRatio((SEPARATION_RATIO * SEA_LEVEL) / (pc * PA));
}

/** Whether a design can be built: no hard limit broken. Separation is a warning, not a stop. */
export function buildable(limits: Limit[]): boolean {
  return limits.every((l) => l.ok || l.warning);
}

/** Put a design point together into an engine. */
export function designEngine(parts: EngineParts, design: EngineDesign, name: string, extra: Pick<Engine, "family" | "rev"> = {}): Engine {
  const p = performance(parts, design);
  return {
    name,
    thrustVac: p.thrustVac,
    ispVac: p.ispVac,
    exitArea: p.exitArea,
    exitPressure: p.exitPressure,
    ratedLife: p.ratedLife,
    parts: p.parts,
    unitCost: p.unitCost,
    design: { ...design },
    mass: p.mass,
    instability: p.instability,
    ...extra,
  };
}

/** Whether two design points are the same drawing, to the precision the sliders set. */
export function sameDesign(a: EngineDesign | undefined, b: EngineDesign | undefined): boolean {
  if (!a || !b) return a === b;
  const r = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 10));
  return r(a.pc) === r(b.pc) && r(a.eps) === r(b.eps) && r(a.pd) === r(b.pd) && r(a.t0) === r(b.t0);
}
