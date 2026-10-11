import { simulateAscent, type FlightResult } from "./ascent.ts";
import { aeroShape, DRAG_FACTOR, IDEAL_AERO, TRANSONIC_RISE, type AeroTruth, type AeroTruthTable } from "./airframe.ts";
import { G0 } from "./constants.ts";
import type { Engine } from "./engine.ts";
import { FAILURE_LABELS, IDEAL_TRUTH, ISP_FACTOR, type HardwareTruth } from "./hardware.ts";
import { missionPlan, type Mission } from "./mission.ts";
import { INJECTORS, NOZZLES, partKeys } from "./parts.ts";
import { believedHardware, FIXES, flightUnknowns, seenAt, type Campaign, type Unknown } from "./teststand.ts";
import { believedAero } from "./tunnel.ts";
import { retunePitch } from "./tuning.ts";
import { burnTime, idealDeltaV, type Vehicle } from "./vehicle.ts";

/**
 * The launch simulator. It flies a design on paper, free and instantly,
 * from what the company knows: measured Isp and drag where tests measured
 * them, the drawings everywhere else. Nothing fails in it, but failures the
 * company has already seen are flagged against the flight's timeline.
 *
 * It never reads the hidden truth. Where something was never measured, it
 * flies the catalogue's worst and best cases as well, so the spread shows
 * what testing would pin down.
 */

export type Scenario = "worst" | "modelled" | "best";

/** What the company knows about one engine's Isp, as a share of the drawings. */
export type IspKnowledge = { engine: string; model: number; lo: number; hi: number; measured: boolean };

/** What the company knows about a shape's drag. */
export type DragKnowledge = { shape: string; model: AeroTruth; lo: AeroTruth; hi: AeroTruth; source: "none" | "cfd" | "tunnel"; riseMeasured: boolean };

export type SimFlight = {
  scenario: Scenario;
  result: FlightResult;
  /** Reached what the mission asks: in-spec insertion, or the apogee wanted. */
  delivers: boolean;
  /** Extra payload this case could still carry to the same target, kg, estimated from the propellant left. Null if it doesn't get there. */
  spare: number | null;
};

export type Simulation = {
  vehicle: Vehicle;
  mission: Mission;
  /** The apogee a sounding mission wants, m. */
  minApogee?: number;
  modelled: SimFlight;
  /** Present when something was never measured, so the outcome has a spread. */
  worst?: SimFlight;
  best?: SimFlight;
  isp: IspKnowledge[];
  drag: DragKnowledge;
  /** Problems tests already found that this flight would meet, and loads past the airframe's budget. */
  warnings: string[];
  /** What the flight takes on trust. */
  unknowns: Unknown[];
};

/** An engine's Isp: measured, or the range its parts allow (after any fixes that cost Isp, and above any refinement's starting point). */
export function ispKnowledge(campaign: Campaign, engine: Engine): IspKnowledge {
  const known = campaign.knowledge[engine.name];
  const model = believedHardware(campaign)[engine.name]?.ispFactor ?? 1;
  const measured = known?.measuredIspFactor ?? null;
  if (measured !== null) return { engine: engine.name, model: measured, lo: measured, hi: measured, measured: true };
  let [lo, hi] = ISP_FACTOR;
  if (engine.parts) {
    const keys = partKeys(engine.parts);
    const injector = INJECTORS[engine.parts.injector].isp;
    const nozzle = NOZZLES[engine.parts.nozzle].ispRange;
    lo = injector[0] * nozzle[0];
    hi = injector[1] * nozzle[1];
    // A refinement never makes a part worse than it measured just before it.
    for (const key of [keys.injector, keys.nozzle]) {
      const before = campaign.parts[key]?.refined?.at(-1)?.before[engine.name];
      if (before != null) lo = Math.max(lo, before);
    }
  }
  for (const mode of known?.fixed ?? []) {
    const fix = FIXES[mode];
    if (!fix?.costsIsp) continue;
    const penalty = fix.apply(IDEAL_TRUTH).ispFactor;
    lo *= penalty;
    hi *= penalty;
  }
  return { engine: engine.name, model, lo: Math.min(lo, model), hi: Math.max(hi, model), measured: false };
}

/** A shape's drag: measured in a tunnel, half-measured by CFD, or the hand curve with its usual error. */
export function dragKnowledge(campaign: Campaign, vehicle: Vehicle): DragKnowledge {
  const shape = aeroShape(vehicle);
  const known = campaign.aeroKnowledge[shape.key];
  const model = believedAero(campaign)[shape.key] ?? IDEAL_AERO;
  const source = known?.dragFactor != null ? (known.dragSource ?? "cfd") : "none";
  let drag: [number, number] = [...DRAG_FACTOR];
  if (source === "tunnel") drag = [model.dragFactor, model.dragFactor];
  else if (source === "cfd") {
    // CFD gets about half the error: the truth lies between its figure and twice as far from the hand curve.
    const far = 1 + 2 * (model.dragFactor - 1);
    drag = [Math.max(DRAG_FACTOR[0], Math.min(model.dragFactor, far)), Math.min(DRAG_FACTOR[1], Math.max(model.dragFactor, far))];
  }
  const riseMeasured = known?.transonicRise != null;
  const rise: [number, number] = riseMeasured ? [model.transonicRise, model.transonicRise] : [...TRANSONIC_RISE];
  return {
    shape: shape.label,
    model,
    lo: { ...model, dragFactor: Math.min(drag[0], model.dragFactor), transonicRise: Math.min(rise[0], model.transonicRise) },
    hi: { ...model, dragFactor: Math.max(drag[1], model.dragFactor), transonicRise: Math.max(rise[1], model.transonicRise) },
    source,
    riseMeasured,
  };
}

/** Every engine flies, whatever tests found: only Isp is left of the hardware. */
function cleanHardware(isp: IspKnowledge[], pick: (k: IspKnowledge) => number): HardwareTruth {
  return Object.fromEntries(isp.map((k) => [k.engine, { ...IDEAL_TRUTH, ispFactor: pick(k) }]));
}

function enginesOf(vehicle: Vehicle): Engine[] {
  const seen = new Map<string, Engine>();
  for (const s of vehicle.stages) seen.set(s.engine.name, s.engine);
  return [...seen.values()];
}

/**
 * Extra payload the same flight could carry, kg: the Δv the propellant left
 * in the last stage is worth, traded for mass through the rocket equation.
 */
export function sparePayload(vehicle: Vehicle, result: FlightResult, ispFactor: number): number {
  const margin = result.summary.propellantMargin;
  const last = vehicle.stages[vehicle.stages.length - 1]!;
  const end = result.samples[result.samples.length - 1]?.mass ?? 0;
  if (margin <= 0 || end <= margin) return 0;
  const spareDv = last.engine.ispVac * ispFactor * G0 * Math.log(end / (end - margin));
  const total = (p: number) => idealDeltaV({ ...vehicle, payloadMass: p }).reduce((a, b) => a + b, 0);
  const want = total(vehicle.payloadMass) - spareDv;
  let lo = vehicle.payloadMass;
  let hi = vehicle.payloadMass + 100_000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (total(mid) > want) lo = mid;
    else hi = mid;
  }
  return Math.max(0, Math.floor((lo - vehicle.payloadMass) / 5) * 5);
}

function delivers(result: FlightResult, minApogee?: number): boolean {
  if (minApogee !== undefined) return result.summary.apogee >= minApogee;
  return result.summary.insertion?.inSpec ?? false;
}

/** Failures tests have already seen that this flight would run into, and loads past the airframe's budget. */
function warningsFor(campaign: Campaign, vehicle: Vehicle, mission: Mission, result: FlightResult): string[] {
  const out: string[] = [];
  const relights = missionPlan(mission).burns.length > 0;
  const burns = new Map<string, number>();
  vehicle.stages.forEach((s) => burns.set(s.engine.name, Math.max(burns.get(s.engine.name) ?? 0, burnTime(s))));
  for (const [name, burn] of burns) {
    const known = campaign.knowledge[name];
    if (!known) continue;
    for (const mode of known.open) {
      const t = seenAt(known, mode);
      const label = FAILURE_LABELS[mode];
      if (mode === "hard-start") out.push(`Known ${label} on the ${name}: it would not survive ignition.`);
      else if (mode === "relight-failure") {
        if (relights) out.push(`Known ${label} on the ${name}: this mission needs it to restart.`);
      } else if (t !== undefined && t < burn) out.push(`Known ${label} on the ${name} at ${t.toFixed(0)} s: this flight burns it for ${burn.toFixed(0)} s.`);
      else if (t === undefined) out.push(`Known ${label} on the ${name}.`);
    }
  }
  const s = result.summary;
  const limits = vehicle.limits;
  if (s.maxQ.value > limits.maxDynamicPressure) out.push(`Max-q ${(s.maxQ.value / 1000).toFixed(1)} kPa is over the airframe's ${(limits.maxDynamicPressure / 1000).toFixed(0)} kPa budget.`);
  if (limits.maxQAlpha !== undefined && s.maxQAlpha.value > limits.maxQAlpha) out.push("The side load at max-q is over the airframe's budget: the steering turns too hard in thick air.");
  if (s.maxBuffetLoad.value > limits.maxDynamicPressure) out.push(`Known transonic buffet peaks at ${(s.maxBuffetLoad.value / 1000).toFixed(1)} kPa, over the ${(limits.maxDynamicPressure / 1000).toFixed(0)} kPa budget: the real flight breaks up near Mach ${s.maxBuffetLoad.mach.toFixed(1)}.`);
  if (result.events.some((e) => e.kind === "flow-separation")) out.push("A nozzle separates in thick air on this flight.");
  return out;
}

/** The pitch programme a re-tune would fly for this mission, from what is known. Slow: a few seconds. */
export function bestSteering(campaign: Campaign, vehicle: Vehicle, mission: Mission): Vehicle {
  const isp = enginesOf(vehicle).map((e) => ispKnowledge(campaign, e));
  const shape = aeroShape(vehicle).key;
  const result = retunePitch(vehicle, mission, { hardware: cleanHardware(isp, (k) => k.model), aero: { [shape]: dragKnowledge(campaign, vehicle).model } });
  return { ...vehicle, pitchProgram: result.program };
}

/** Fly the vehicle (payload and steering already set) on paper: as modelled, and at both ends of what is unknown. */
export function simulate(campaign: Campaign, vehicle: Vehicle, mission: Mission, options: { minApogee?: number; range?: boolean } = {}): Simulation {
  const isp = enginesOf(vehicle).map((e) => ispKnowledge(campaign, e));
  const drag = dragKnowledge(campaign, vehicle);
  const shape = aeroShape(vehicle).key;
  const lastEngine = vehicle.stages[vehicle.stages.length - 1]!.engine.name;
  const fly = (scenario: Scenario): SimFlight => {
    const pick = (k: IspKnowledge) => (scenario === "worst" ? k.lo : scenario === "best" ? k.hi : k.model);
    const aero: AeroTruthTable = { [shape]: scenario === "worst" ? drag.hi : scenario === "best" ? drag.lo : drag.model };
    const result = simulateAscent(vehicle, mission, { hardware: cleanHardware(isp, pick), aero, structuralFailures: false });
    const ok = delivers(result, options.minApogee);
    const lastIsp = isp.find((k) => k.engine === lastEngine)!;
    return { scenario, result, delivers: ok, spare: ok && options.minApogee === undefined ? sparePayload(vehicle, result, pick(lastIsp)) : null };
  };
  const modelled = fly("modelled");
  const uncertain = isp.some((k) => k.hi - k.lo > 1e-6) || drag.hi.dragFactor - drag.lo.dragFactor > 1e-6 || drag.hi.transonicRise - drag.lo.transonicRise > 1e-6;
  const range = (options.range ?? true) && uncertain;
  return {
    vehicle,
    mission,
    minApogee: options.minApogee,
    modelled,
    worst: range ? fly("worst") : undefined,
    best: range ? fly("best") : undefined,
    isp,
    drag,
    warnings: warningsFor(campaign, vehicle, mission, modelled.result),
    unknowns: flightUnknowns(vehicle, campaign, mission),
  };
}
