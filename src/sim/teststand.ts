import { DEFAULT_RATED_LIFE, massFlow, flowSeparates, ispAt, thrustAt, type Engine } from "./engine.ts";
import { G0, P_SEA_LEVEL } from "./constants.ts";
import {
  asBuilt,
  FAILURE_LABELS,
  firstFailure,
  IDEAL_TRUTH,
  type EngineTruth,
  type FailureMode,
  type HardwareTruth,
  type PartTruth,
  type PartTruthTable,
} from "./hardware.ts";
import { OWNER, partKeys, partLabel, type Slot } from "./parts.ts";
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
  altitude: { name: "altitude cell", ambient: 3_000, setup: 200, perSecond: 1.5, days: 10 },
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
  /** Where the data came from. A flight counts: telemetry sees what the stand would have. */
  facility: Facility | "flight";
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
  /**
   * When each open mode shows up, s. For an engine built from parts this can
   * come from a sister engine's firing: a burn-through at 60% of one
   * engine's rated life predicts 60% of this one's.
   */
  seen: Partial<Record<FailureMode, number>>;
  history: TestReport[];
};

/**
 * What the company has learned about one part, from every engine built
 * with it: the stand and flights alike.
 */
export type PartKnowledge = {
  firings: number;
  flights: number;
  /** Cycle: an engine with this start sequence has lit cleanly. */
  startupProven: boolean;
  /** Injector: longest running without instability on the current revision, s. */
  stableSeconds: number;
  /** Cooling: most of the rated life run without burning through, as a share. */
  lifeShare: number;
  /** Nozzle: measured in the altitude cell or in flight above the air. */
  altitudeTested: boolean;
  /** Modes this part owns that tests have seen and nobody fixed. */
  open: FailureMode[];
  /** When each open mode showed up: seconds, or a share of rated life for cooling. */
  seen: Partial<Record<FailureMode, number>>;
  fixed: FailureMode[];
  /** Revisions since the first drawing: fixes and refinements. 0 is Rev A. */
  revision: number;
  /** Refinements applied: R&D that closes the gap to the top of the part's range. */
  refinements: number;
  /** What changed at each revision. */
  notes: string[];
};

export type Campaign = {
  /** Hidden from the player. Fixes change it; tests read it. */
  truth: HardwareTruth;
  /** Hidden truth of every part, for engines built from parts. Fixes change these too. */
  partTruth: PartTruthTable;
  /** Every engine design the company has, by name. */
  engines: Record<string, Engine>;
  knowledge: Record<string, EngineKnowledge>;
  /** What tests have learned about each part, by part key. */
  parts: Record<string, PartKnowledge>;
  /** Hidden aero truth per outer shape. */
  aeroTruth: AeroTruthTable;
  aeroKnowledge: Record<string, AeroKnowledge>;
  /** $k spent on firings, lost hardware and fixes. */
  spent: number;
  /** Calendar days used by firings, rebuilds and fixes. */
  days: number;
};

export function newCampaign(
  truth: HardwareTruth,
  aeroTruth: AeroTruthTable = {},
  extras: { engines?: Engine[]; partTruth?: PartTruthTable } = {},
): Campaign {
  const engines = Object.fromEntries((extras.engines ?? []).map((e) => [e.name, e]));
  return { truth, partTruth: extras.partTruth ?? {}, engines, knowledge: {}, parts: {}, aeroTruth, aeroKnowledge: {}, spent: 0, days: 0 };
}

export function blankEngineKnowledge(): EngineKnowledge {
  return { firings: 0, startupProven: false, provenDuration: 0, measuredIspFactor: null, altitudeTested: false, open: [], fixed: [], seen: {}, history: [] };
}

export function knowledgeOf(campaign: Campaign, engine: Engine): EngineKnowledge {
  campaign.engines[engine.name] ??= engine;
  const known = (campaign.knowledge[engine.name] ??= blankEngineKnowledge());
  known.seen ??= {};
  return known;
}

export function partKnowledgeOf(campaign: Campaign, key: string): PartKnowledge {
  return (campaign.parts[key] ??= {
    firings: 0,
    flights: 0,
    startupProven: false,
    stableSeconds: 0,
    lifeShare: 0,
    altitudeTested: false,
    open: [],
    seen: {},
    fixed: [],
    revision: 0,
    refinements: 0,
    notes: [],
  });
}

/** When an open failure mode shows up on this engine, s, or undefined if it isn't open. */
export function seenAt(known: EngineKnowledge | undefined, mode: FailureMode): number | undefined {
  if (!known?.open.includes(mode)) return undefined;
  return known.seen?.[mode] ?? [...known.history].reverse().flatMap((r) => r.findings).find((f) => f.mode === mode)?.t;
}

/** Engines in the campaign that are built with a part. */
export function enginesUsing(campaign: Campaign, key: string): Engine[] {
  return Object.values(campaign.engines).filter((e) => e.parts && Object.values(partKeys(e.parts)).includes(key));
}

/** "Rev B" */
export const revisionLetter = (revision: number): string => `Rev ${String.fromCharCode(65 + Math.min(revision, 25))}`;

/**
 * Teach an engine's parts what a run showed: a firing on the stand or a
 * stage's burn in flight. `fired` is how long it ran, s.
 */
export function learnParts(campaign: Campaign, engine: Engine, fired: number, findings: Finding[], where: Facility | "flight", steady: boolean): void {
  if (!engine.parts) return;
  const keys = partKeys(engine.parts);
  const rated = engine.ratedLife ?? DEFAULT_RATED_LIFE;
  const lit = fired > HARD_START_AT || !findings.some((f) => f.mode === "hard-start");
  for (const slot of Object.keys(keys) as Slot[]) {
    const part = partKnowledgeOf(campaign, keys[slot]);
    if (where === "flight") part.flights += 1;
    else part.firings += 1;
    if (!lit) continue;
    if (slot === "cycle") part.startupProven = true;
    if (slot === "injector") part.stableSeconds = Math.max(part.stableSeconds, fired);
    if (slot === "cooling") part.lifeShare = Math.max(part.lifeShare, fired / rated);
    if (slot === "nozzle" && steady && (where === "altitude" || where === "flight")) part.altitudeTested = true;
  }
  for (const f of findings) {
    const slot = OWNER[f.mode];
    if (!slot) continue;
    const part = partKnowledgeOf(campaign, keys[slot]);
    if (!part.open.includes(f.mode)) part.open.push(f.mode);
    part.seen[f.mode] = slot === "cooling" ? f.t / rated : f.t;
  }
}

/**
 * Rewrite what is known about every engine built from parts from what is
 * known about its parts. An engine that has never fired can still be
 * partly proven, by its sisters.
 */
export function refreshFromParts(campaign: Campaign): void {
  for (const engine of Object.values(campaign.engines)) {
    if (!engine.parts) continue;
    const keys = partKeys(engine.parts);
    const known = knowledgeOf(campaign, engine);
    const rated = engine.ratedLife ?? DEFAULT_RATED_LIFE;
    const part = (slot: Slot) => campaign.parts[keys[slot]];
    known.startupProven = part("cycle")?.startupProven ?? false;
    const life = Math.round((part("cooling")?.lifeShare ?? 0) * rated * 1e6) / 1e6;
    known.provenDuration = Math.min(part("injector")?.stableSeconds ?? 0, life);
    if (part("nozzle")?.altitudeTested) known.altitudeTested = true;
    for (const [mode, slot] of Object.entries(OWNER) as Array<[FailureMode, Slot]>) {
      const p = part(slot);
      if (p?.open.includes(mode)) {
        if (!known.open.includes(mode)) known.open.push(mode);
        const at = p.seen[mode];
        if (at !== undefined) known.seen[mode] = slot === "cooling" ? at * rated : at;
      } else if (p) {
        known.open = known.open.filter((m) => m !== mode);
        delete known.seen[mode];
      }
      if (p?.fixed.includes(mode) && !known.fixed.includes(mode)) known.fixed.push(mode);
    }
  }
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
  for (const f of findings) {
    if (!known.open.includes(f.mode)) known.open.push(f.mode);
    known.seen[f.mode] = f.t;
  }
  learnParts(campaign, engine, fired, findings, facility, steady);

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
  refreshFromParts(campaign);
  return report;
}

type Fix = {
  name: string;
  cost: number;
  days: number;
  /** What the fix does to the real hardware, including what it costs in performance. */
  apply: (truth: EngineTruth) => EngineTruth;
  /** The same change, made to the part that owns the mode. */
  applyPart: (truth: PartTruth) => PartTruth;
  /** The fix changes Isp, so earlier Isp measurements no longer hold. */
  costsIsp: boolean;
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
    applyPart: (t) => ({ ...t, hardStart: false }),
    costsIsp: false,
    text: "Oxidiser lead and a hotter igniter: propellant now lights as it arrives instead of pooling.",
  },
  "combustion-instability": {
    name: "injector baffles",
    cost: 400,
    days: 45,
    apply: (t) => ({ ...t, instabilityOnset: null, ispFactor: t.ispFactor * 0.995 }),
    applyPart: (t) => ({ ...t, instabilityOnset: null, ispFactor: t.ispFactor * 0.995 }),
    costsIsp: true,
    text: "Baffles on the injector face break up the acoustic mode. They also mix propellant a little worse: about 0.5% Isp.",
  },
  "burn-through": {
    name: "film cooling",
    cost: 250,
    days: 30,
    apply: (t) => ({ ...t, thermalLife: t.thermalLife * 1.6, ispFactor: t.ispFactor * 0.99 }),
    applyPart: (t) => ({ ...t, lifeFactor: t.lifeFactor * 1.6, ispFactor: t.ispFactor * 0.99 }),
    costsIsp: true,
    text: "A ring of fuel injected along the wall shields the liner. That fuel barely burns, so it costs about 1% Isp.",
  },
};

export type FixReport = { engine: string; mode: FailureMode; cost: number; days: number; text: string };

/**
 * Fix a failure mode the stand has seen. The fixed engine is new hardware,
 * so everything proven about the old one has to be proven again.
 */
export function applyFix(campaign: Campaign, engine: Engine, mode: FailureMode): FixReport {
  const slot = OWNER[mode];
  if (engine.parts && slot) return applyPartFix(campaign, engine, mode, slot);
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

/**
 * Fix a mode in the part that owns it: a new revision of that part, so every
 * engine built with it gets the fix, paid for once. Only what was proven
 * about that part has to be proven again; the rest of the engine stands.
 */
function applyPartFix(campaign: Campaign, engine: Engine, mode: FailureMode, slot: Slot): FixReport {
  const key = partKeys(engine.parts!)[slot];
  const part = partKnowledgeOf(campaign, key);
  const known = knowledgeOf(campaign, engine);
  if (!part.open.includes(mode) && !known.open.includes(mode)) {
    throw new Error(`${engine.name} has no observed ${mode} to fix. The stand has to see a problem before it can be fixed.`);
  }
  const fix = FIXES[mode];
  if (!fix) {
    throw new Error(`${mode} on ${engine.name} has no fix on the stand. It comes from the nozzle shape: change the bell.`);
  }
  if (campaign.partTruth[key]) campaign.partTruth[key] = fix.applyPart(campaign.partTruth[key]);
  const covered = enginesUsing(campaign, key);
  for (const e of covered) {
    const truth = campaign.truth[e.name];
    if (truth) campaign.truth[e.name] = fix.apply(truth);
    const k = knowledgeOf(campaign, e);
    k.open = k.open.filter((m) => m !== mode);
    delete k.seen[mode];
    if (!k.fixed.includes(mode)) k.fixed.push(mode);
    if (fix.costsIsp) k.measuredIspFactor = null;
  }

  part.open = part.open.filter((m) => m !== mode);
  delete part.seen[mode];
  if (!part.fixed.includes(mode)) part.fixed.push(mode);
  part.revision += 1;
  part.notes.push(`${revisionLetter(part.revision)}: ${fix.name}.`);
  if (slot === "cycle") part.startupProven = false;
  if (slot === "injector") part.stableSeconds = 0;
  if (slot === "cooling") part.lifeShare = 0;
  refreshFromParts(campaign);

  campaign.spent += fix.cost;
  campaign.days += fix.days;
  const others = covered.filter((e) => e.name !== engine.name).map((e) => e.name);
  return {
    engine: engine.name,
    mode,
    cost: fix.cost,
    days: fix.days,
    text: `${partLabel(key)} goes to ${revisionLetter(part.revision)}: ${fix.name}. ${fix.text} $${fix.cost}k, ${fix.days} days.${others.length > 0 ? ` ${others.join(" and ")} share${others.length === 1 ? "s" : ""} the part and ${others.length === 1 ? "gets" : "get"} the fix too.` : ""} What was proven about this part has to be proven again.`,
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
    const inherited = known && known.firings === 0 && (known.startupProven || known.provenDuration > 0 || known.open.length > 0);
    if (!known || (known.firings === 0 && !inherited)) {
      add(`Never fired. Startup, combustion stability, chamber life over the ${burnText} burn and real Isp are all on paper.`);
      continue;
    }
    if (inherited) add("Never fired itself. What is known comes from engines that share its parts.");
    for (const mode of known.open) {
      const t = seenAt(known, mode);
      if ((mode === "burn-through" || mode === "combustion-instability") && t !== undefined) {
        const margin = t / burn - 1;
        add(
          margin > 0
            ? `Known ${FAILURE_LABELS[mode]} at ${t.toFixed(1)} s on the stand, not fixed. The flight burns it for ${burnText}, a ${Math.round(margin * 100)}% margin.`
            : `Known ${FAILURE_LABELS[mode]} at ${t.toFixed(1)} s on the stand, not fixed. The flight burns it for ${burnText}: it will fail in flight.`,
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
    believed[name] = {
      ispFactor: known?.measuredIspFactor ?? 1,
      hardStart: seenAt(known, "hard-start") !== undefined,
      instabilityOnset: seenAt(known, "combustion-instability") ?? null,
      thermalLife: seenAt(known, "burn-through") ?? Infinity,
    };
  }
  return believed;
}
