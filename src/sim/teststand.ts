import { massFlow, flowSeparates, ispAt, thrustAt, type Engine } from "./engine.ts";
import { G0, P_SEA_LEVEL } from "./constants.ts";
import {
  asBuilt,
  FAILURE_LABELS,
  firstFailure,
  IDEAL_TRUTH,
  type EngineTruth,
  type FailureMode,
  type HardwareTruth,
} from "./hardware.ts";
import { aeroShape, type AeroTruthTable } from "./airframe.ts";
import { aeroUnknowns, type AeroKnowledge } from "./tunnel.ts";
import { burnTime, type Vehicle } from "./vehicle.ts";

/**
 * Engine test campaigns. A hot-fire is one firing on one facility for a
 * chosen duration; longer and higher-fidelity firings cost more cash and
 * calendar. A firing only reveals what it reaches: a 30 s run says nothing
 * about a chamber that burns through at 110 s.
 */

export type Facility = "sea-level" | "altitude";

type FacilitySpec = {
  name: string;
  /** Back pressure on the nozzle, Pa. */
  ambient: number;
  /** Setup cost per firing, $k. */
  setup: number;
  /** Running cost per second of firing, $k. */
  perSecond: number;
  /** Calendar days per firing. */
  days: number;
};

export const FACILITIES: Record<Facility, FacilitySpec> = {
  "sea-level": { name: "sea-level stand", ambient: P_SEA_LEVEL, setup: 25, perSecond: 1.5, days: 4 },
  altitude: { name: "altitude cell", ambient: 3_000, setup: 200, perSecond: 4, days: 10 },
};

/** Cost and delay of building a replacement engine after a test destroys one. */
export const HARDWARE_LOSS = { cost: 350, days: 25 };

/** Ignition transient: a hard start shows up this far into the firing, s. */
const HARD_START_AT = 0.3;
/** The stand trips on side loads this far into a separated firing, s. */
const SEPARATION_TRIP_AT = 2;
/** Firing needed past the start transient before Isp can be measured, s. */
const STEADY_STATE = 5;

export type Finding = { mode: FailureMode; t: number; text: string };

export type TestReport = {
  engine: string;
  facility: Facility;
  planned: number;
  /** How long the engine actually ran, s. */
  fired: number;
  findings: Finding[];
  /** Isp at the facility's back pressure, when the firing reached steady state. */
  isp: { predicted: number; measured: number; ambient: number } | null;
  hardwareLost: boolean;
  cost: number;
  days: number;
  text: string;
};

/** What the company has learned about one engine design. */
export type EngineKnowledge = {
  firings: number;
  /** At least one firing got past ignition on the current hardware. */
  startupProven: boolean;
  /** Longest clean running on the current hardware, s. */
  provenDuration: number;
  /** Measured Isp as a share of the design figure, once known. */
  measuredIspFactor: number | null;
  /** Fired in the altitude cell, so vacuum performance is measured, not inferred. */
  altitudeTested: boolean;
  /** Failure modes seen and not yet fixed. */
  open: FailureMode[];
  /** Failure modes seen and fixed. */
  fixed: FailureMode[];
  history: TestReport[];
};

export type Campaign = {
  /** Hidden from the player. Fixes change it; tests read it. */
  truth: HardwareTruth;
  knowledge: Record<string, EngineKnowledge>;
  /** Hidden aero truth per outer shape. */
  aeroTruth: AeroTruthTable;
  aeroKnowledge: Record<string, AeroKnowledge>;
  /** $k spent on firings, lost hardware and fixes. */
  spent: number;
  /** Calendar days used by firings, rebuilds and fixes. */
  days: number;
};

export function newCampaign(truth: HardwareTruth, aeroTruth: AeroTruthTable = {}): Campaign {
  return { truth, knowledge: {}, aeroTruth, aeroKnowledge: {}, spent: 0, days: 0 };
}

function knowledgeOf(campaign: Campaign, engine: Engine): EngineKnowledge {
  return (campaign.knowledge[engine.name] ??= {
    firings: 0,
    startupProven: false,
    provenDuration: 0,
    measuredIspFactor: null,
    altitudeTested: false,
    open: [],
    fixed: [],
    history: [],
  });
}

function truthOf(campaign: Campaign, engine: Engine): EngineTruth {
  const truth = campaign.truth[engine.name];
  if (!truth) throw new Error(`No hardware truth for ${engine.name}`);
  return truth;
}

const kPa = (pa: number) => `${(pa / 1000).toFixed(1)} kPa`;

/** Fire an engine on a facility for up to `duration` seconds. */
export function hotFire(campaign: Campaign, engine: Engine, duration: number, facility: Facility): TestReport {
  const truth = truthOf(campaign, engine);
  const known = knowledgeOf(campaign, engine);
  const stand = FACILITIES[facility];
  const findings: Finding[] = [];

  let fired = duration;
  let hardwareLost = false;
  const failure = firstFailure(truth);
  const separates = flowSeparates(engine, stand.ambient);

  if (failure?.mode === "hard-start") {
    fired = HARD_START_AT;
    hardwareLost = true;
    findings.push({
      mode: "hard-start",
      t: fired,
      text: `Hard start at T+${fired} s: propellant pooled in the chamber before the igniter caught and lit all at once. The pressure spike cracked the chamber.`,
    });
  } else if (separates) {
    fired = Math.min(duration, SEPARATION_TRIP_AT);
    findings.push({
      mode: "flow-separation",
      t: fired,
      text: `Flow separation: exhaust leaves the bell at ${kPa(engine.exitPressure)}, under 40% of the ${kPa(stand.ambient)} around the stand, so the jet peeled off the nozzle wall. Side loads trip the stand limits by T+${SEPARATION_TRIP_AT} s. This bell needs the altitude cell.`,
    });
  } else if (failure && failure.t < duration) {
    fired = failure.t;
    hardwareLost = true;
    const at = `T+${failure.t.toFixed(1)} s`;
    findings.push(
      failure.mode === "combustion-instability"
        ? {
            mode: failure.mode,
            t: fired,
            text: `Combustion instability at ${at}: chamber pressure locked onto an acoustic mode of the chamber and the oscillation grew until the redline cut the engine. The injector face is damaged.`,
          }
        : {
            mode: failure.mode,
            t: fired,
            text: `Burn-through at ${at}: the chamber wall ran hotter than the coolant could carry away and a hot streak opened the liner.`,
          },
    );
  }

  // Isp is measurable once the firing settles, unless the flow is separated.
  const steady = !separates && fired >= STEADY_STATE;
  const real = asBuilt(engine, truth);
  const isp = steady
    ? { predicted: ispAt(engine, stand.ambient), measured: ispAt(real, stand.ambient), ambient: stand.ambient }
    : null;

  // Learn what the firing reached.
  known.firings += 1;
  if (fired > HARD_START_AT) {
    known.startupProven = true;
    known.provenDuration = Math.max(known.provenDuration, fired);
  }
  if (isp) {
    // Back-pressure is known from the drawings, so vacuum Isp follows from a sea-level reading.
    const measuredVac = (thrustAt(real, stand.ambient) + stand.ambient * engine.exitArea) / (massFlow(engine) * G0);
    known.measuredIspFactor = measuredVac / engine.ispVac;
  }
  if (facility === "altitude" && steady) known.altitudeTested = true;
  for (const f of findings) if (!known.open.includes(f.mode)) known.open.push(f.mode);

  const cost = stand.setup + stand.perSecond * fired + (hardwareLost ? HARDWARE_LOSS.cost : 0);
  const days = stand.days + (hardwareLost ? HARDWARE_LOSS.days : 0);
  campaign.spent += cost;
  campaign.days += days;

  const lines = [`${engine.name}, ${stand.name}, ${duration} s planned, ${fired.toFixed(1)} s fired.`];
  for (const f of findings) lines.push(`  ${f.text}`);
  if (findings.length === 0) lines.push(`  Clean firing.`);
  if (isp) {
    const delta = isp.measured / isp.predicted - 1;
    lines.push(
      `  Isp ${isp.measured.toFixed(1)} s at ${kPa(isp.ambient)} against ${isp.predicted.toFixed(1)} s predicted (${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%).`,
    );
  }
  if (hardwareLost) lines.push(`  Test engine destroyed. A replacement costs $${HARDWARE_LOSS.cost}k and ${HARDWARE_LOSS.days} days.`);
  lines.push(`  $${Math.round(cost)}k, ${days} days.`);

  const report: TestReport = { engine: engine.name, facility, planned: duration, fired, findings, isp, hardwareLost, cost, days, text: lines.join("\n") };
  known.history.push(report);
  return report;
}

type Fix = {
  name: string;
  cost: number;
  days: number;
  /** What the fix does to the real hardware, including what it costs in performance. */
  apply: (truth: EngineTruth) => EngineTruth;
  text: string;
};

/**
 * Fixes for the modes a stand can find. Each one solves a problem and
 * charges for it somewhere else. Flow separation has no fix here: it comes
 * from the nozzle's shape, so the answer is a different nozzle.
 */
export const FIXES: Partial<Record<FailureMode, Fix>> = {
  "hard-start": {
    name: "rework the start sequence",
    cost: 150,
    days: 20,
    apply: (t) => ({ ...t, hardStart: false }),
    text: "Oxidiser lead and a hotter igniter: propellant now lights as it arrives instead of pooling.",
  },
  "combustion-instability": {
    name: "injector baffles",
    cost: 400,
    days: 45,
    apply: (t) => ({ ...t, instabilityOnset: null, ispFactor: t.ispFactor * 0.995 }),
    text: "Baffles on the injector face break up the acoustic mode. They also mix propellant a little worse: about 0.5% Isp.",
  },
  "burn-through": {
    name: "film cooling",
    cost: 250,
    days: 30,
    apply: (t) => ({ ...t, thermalLife: t.thermalLife * 1.6, ispFactor: t.ispFactor * 0.99 }),
    text: "A ring of fuel injected along the wall shields the liner. That fuel barely burns, so it costs about 1% Isp.",
  },
};

export type FixReport = { engine: string; mode: FailureMode; cost: number; days: number; text: string };

/**
 * Fix a failure mode the stand has seen. The fixed engine is new hardware,
 * so everything proven about the old one has to be proven again.
 */
export function applyFix(campaign: Campaign, engine: Engine, mode: FailureMode): FixReport {
  const known = knowledgeOf(campaign, engine);
  if (!known.open.includes(mode)) {
    throw new Error(`${engine.name} has no observed ${mode} to fix. The stand has to see a problem before it can be fixed.`);
  }
  const fix = FIXES[mode];
  if (!fix) {
    throw new Error(`${mode} on ${engine.name} has no fix on the stand. It comes from the nozzle shape: change the bell.`);
  }
  const truth = truthOf(campaign, engine);
  campaign.truth[engine.name] = fix.apply(truth);

  known.open = known.open.filter((m) => m !== mode);
  known.fixed.push(mode);
  known.startupProven = false;
  known.provenDuration = 0;
  known.measuredIspFactor = null;
  known.altitudeTested = false;

  campaign.spent += fix.cost;
  campaign.days += fix.days;
  return {
    engine: engine.name,
    mode,
    cost: fix.cost,
    days: fix.days,
    text: `${engine.name}: ${fix.name}. ${fix.text} $${fix.cost}k, ${fix.days} days. Earlier firings no longer count for this hardware.`,
  };
}

/** Something a flight would take on trust. `subject` is the engine or the airframe it concerns. */
export type Unknown = { subject: string; text: string };

/**
 * What a vehicle would be flying on trust: every way its engines or its
 * shape could surprise it that no firing or tunnel run has ruled out. This is the bid screen's
 * "regimes this vehicle has never seen" for propulsion.
 */
export function flightUnknowns(vehicle: Vehicle, campaign: Campaign): Unknown[] {
  const uses = new Map<string, { engine: Engine; burn: number; upper: boolean }>();
  vehicle.stages.forEach((stage, i) => {
    const prior = uses.get(stage.engine.name);
    uses.set(stage.engine.name, {
      engine: stage.engine,
      burn: Math.max(prior?.burn ?? 0, burnTime(stage)),
      upper: (prior?.upper ?? false) || i > 0,
    });
  });

  const unknowns: Unknown[] = [];
  for (const { engine, burn, upper } of uses.values()) {
    const add = (text: string) => unknowns.push({ subject: engine.name, text });
    const known = campaign.knowledge[engine.name];
    const burnText = `${burn.toFixed(0)} s`;
    if (!known || known.firings === 0) {
      add(`Never fired. Startup, combustion stability, chamber life over the ${burnText} burn and real Isp are all on paper.`);
      continue;
    }
    for (const mode of known.open) {
      const seen = [...known.history].reverse().flatMap((r) => r.findings).find((f) => f.mode === mode);
      if ((mode === "burn-through" || mode === "combustion-instability") && seen) {
        const margin = seen.t / burn - 1;
        add(
          margin > 0
            ? `Known ${FAILURE_LABELS[mode]} at ${seen.t.toFixed(1)} s on the stand, not fixed. The flight burns it for ${burnText}, a ${Math.round(margin * 100)}% margin.`
            : `Known ${FAILURE_LABELS[mode]} at ${seen.t.toFixed(1)} s on the stand, not fixed. The flight burns it for ${burnText}: it will fail in flight.`,
        );
      } else {
        add(`Known ${FAILURE_LABELS[mode]}, not fixed.`);
      }
    }
    if (!known.startupProven) add("No firing of the current hardware has got past ignition.");
    if (known.provenDuration < burn) {
      add(
        `Longest clean running is ${known.provenDuration.toFixed(1)} s; the flight needs ${burnText}. Stability and chamber life beyond that are unknown.`,
      );
    }
    if (known.measuredIspFactor === null) add("Isp never measured. Trajectory and propellant margin rest on the design figure.");
    if (upper && !known.altitudeTested) add("Never fired in the altitude cell. Vacuum performance is an inference.");
  }
  if (campaign.aeroTruth[aeroShape(vehicle).key]) unknowns.push(...aeroUnknowns(vehicle, campaign));
  return unknowns;
}

/**
 * The engines as the company believes them to be: measured Isp where a
 * firing measured it, the design figure where not, and only the failures
 * the stand has seen and nobody fixed, because a model can only predict
 * what it knows. Flying this gives the pre-flight prediction.
 */
export function believedHardware(campaign: Campaign): HardwareTruth {
  const believed: HardwareTruth = {};
  for (const name of Object.keys(campaign.truth)) {
    const known = campaign.knowledge[name];
    const seen = (mode: FailureMode) =>
      known?.open.includes(mode)
        ? [...known.history].reverse().flatMap((r) => r.findings).find((f) => f.mode === mode)
        : undefined;
    believed[name] = {
      ispFactor: known?.measuredIspFactor ?? 1,
      hardStart: seen("hard-start") !== undefined,
      instabilityOnset: seen("combustion-instability")?.t ?? null,
      thermalLife: seen("burn-through")?.t ?? Infinity,
    };
  }
  return believed;
}
