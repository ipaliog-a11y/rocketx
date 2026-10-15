import { simulateAscent, type FlightResult } from "./ascent.ts";
import { aeroShape, SUPERSONIC_FACTOR, type AeroTruthTable } from "./airframe.ts";
import type { PitchProgram } from "./guidance.ts";
import { FAILURE_LABELS, type HardwareTruth } from "./hardware.ts";
import { missionPlan, type Mission } from "./mission.ts";
import { believedHardware, type Campaign } from "./teststand.ts";
import { believedAero } from "./tunnel.ts";
import type { Vehicle } from "./vehicle.ts";

/**
 * The trajectory office. Given the company's model of a vehicle (the
 * engines and airframe as measured, or as drawn where nothing was
 * measured), search the gravity-turn settings for the programme that
 * lands the mission's insertion target.
 *
 * The answer is only as good as the model. Tune on design Isp and fly real
 * Isp, and the insertion misses by however wrong the drawings were.
 *
 * Engine failures are left out of the model: no pitch programme steers
 * around a cracked chamber. Known buffet stays in, because a gentler
 * transonic pass can keep its load under the budget.
 */

/** What a re-tune costs the company. */
export const RETUNE_COST = { cost: 5, days: 3 };

/**
 * What a re-tune flies. `spread` is the same flight with what's still
 * unmeasured at either end of its range: a programme is judged on the worst
 * of them, so one unmeasured number can't drop the orbit into the ground.
 */
export type FlightModel = { hardware?: HardwareTruth; aero?: AeroTruthTable; spread?: AeroTruthTable[] };

/**
 * The supersonic drag a shape drawn with a geometry flies on the model until
 * a flight measures it: CFD narrows it to half. Returns the aero tables at
 * either end of that range, or none once it's measured.
 */
export function supersonicSpread(campaign: Campaign, vehicle: Vehicle, aero: AeroTruthTable): AeroTruthTable[] {
  const key = aeroShape(vehicle).key;
  const model = aero[key];
  if (model?.supersonicFactor === undefined) return [];
  const known = campaign.aeroKnowledge[key];
  if (known?.supersonicSource === "flight") return [];
  const m = model.supersonicFactor;
  let range: [number, number] = [...SUPERSONIC_FACTOR];
  if (known?.supersonicSource === "cfd") {
    const far = 1 + 2 * (m - 1);
    range = [Math.max(SUPERSONIC_FACTOR[0], Math.min(m, far)), Math.min(SUPERSONIC_FACTOR[1], Math.max(m, far))];
  }
  return range.map((f) => ({ ...aero, [key]: { ...model, supersonicFactor: f } }));
}

export type GravityTurn = Extract<PitchProgram, { kind: "gravity-turn" }>;

export type RetuneResult = {
  program: GravityTurn;
  /** The tuned programme flown against the model, at full resolution. */
  predicted: FlightResult;
  inSpec: boolean;
  /** Simulated flights the search used. */
  runs: number;
};

/** Search bounds, deg. */
const KICK: [number, number] = [1, 12];
const START: [number, number] = [-10, 60];
const END: [number, number] = [-30, 20];

/** Coarse grid that seeds the search; the landscape has narrow valleys a local search alone misses. */
const GRID = {
  kick: [3, 5, 6, 7, 8, 9],
  start: [0, 10, 20, 30, 40],
  end: [-25, -15, -5, 5],
};

/** Integration step for the search. Accurate to tens of metres in insertion at a fraction of the cost. */
const SEARCH_DT = 0.2;

type Params = [kick: number, start: number, end: number];

function programFrom(base: GravityTurn, [kick, start, end]: Params): GravityTurn {
  return { ...base, kickAngle: kick, upperStage: { startPitch: start, endPitch: end } };
}

/**
 * Lower is better. Inside tolerance, it trades insertion error against
 * propellant margin; outside, it grades how far off the orbit is, so a
 * search that starts short of orbit can find its way there.
 */
function score(result: FlightResult, vehicle: Vehicle, mission: Mission): number {
  const target = mission.target!;
  const { summary } = result;
  let penalty = 0;
  const qaLimit = vehicle.limits.maxQAlpha;
  if (qaLimit !== undefined && summary.maxQAlpha.value > qaLimit) penalty += 10 * (summary.maxQAlpha.value / qaLimit - 1) + 1;
  if (summary.maxQ.value > vehicle.limits.maxDynamicPressure) {
    penalty += 10 * (summary.maxQ.value / vehicle.limits.maxDynamicPressure - 1) + 1;
  }
  // Buffet is graded, not fatal, during the search, so the search can see a gentler pass helping.
  if (summary.maxBuffetLoad.value > vehicle.limits.maxDynamicPressure) {
    penalty += 100 * (summary.maxBuffetLoad.value / vehicle.limits.maxDynamicPressure - 1) + 100;
  }

  // A booster drawn to come back should come back: a steering that loses it costs more than a little insertion error.
  if (result.recovery && result.recovery.outcome !== "landed") penalty += 0.6;
  if (result.outcome === "failure") return 1_000 + penalty;
  const orbit = summary.orbit;
  if (result.outcome !== "orbit" || !orbit) {
    // Short of orbit: grade by how low the periapsis fell.
    const periapsis = orbit?.periapsis ?? -6_000_000;
    return 100 + Math.max(0, target.periapsis - periapsis) / 100_000 + penalty;
  }
  const ins = summary.insertion!;
  const error = Math.max(Math.abs(ins.periapsisError), Math.abs(ins.apoapsisError)) / target.tolerance.altitude;
  const lastStage = vehicle.stages[vehicle.stages.length - 1]!;
  const marginShare = summary.propellantMargin / lastStage.propellantMass;
  return Math.max(0, error - 0.5) - 0.5 * marginShare + penalty;
}

/** Re-tune the vehicle's gravity turn for the mission, flying the given model. */
export function retunePitch(vehicle: Vehicle, mission: Mission, model: FlightModel): RetuneResult {
  const base = vehicle.pitchProgram;
  if (base?.kind !== "gravity-turn") {
    throw new Error(`${vehicle.name} doesn't fly a gravity turn, so there is nothing to tune.`);
  }
  if (!mission.target) throw new Error(`${mission.name} has no insertion target to tune for.`);

  const hardware = model.hardware
    ? Object.fromEntries(
        Object.entries(model.hardware).map(([name, t]) => [
          name,
          { ...t, hardStart: false, instabilityOnset: null, thermalLife: Infinity },
        ]),
      )
    : undefined;
  const flightModel: FlightModel = { hardware, aero: model.aero };
  // A high-energy mission's pitch programme only flies the ascent to the
  // parking orbit; the burns after it steer themselves. Tune for that orbit.
  const plan = missionPlan(mission);
  const tuneFor: Mission = plan.burns.length > 0 ? { ...mission, name: `${mission.name} parking orbit`, target: plan.ascent } : mission;

  let runs = 0;
  const cache = new Map<string, number>();
  // The grid searches the model alone; the refinement scores the worst of the model and the spread.
  let robust = false;
  const evaluate = (p: Params): number => {
    const key = `${robust ? "r" : "m"}:${p.map((x) => x.toFixed(3)).join(",")}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const tables = robust ? [flightModel.aero, ...(model.spread ?? [])] : [flightModel.aero];
    let s = -Infinity;
    for (const aero of tables) {
      runs += 1;
      const flown = simulateAscent({ ...vehicle, pitchProgram: programFrom(base, p) }, tuneFor, {
        hardware: flightModel.hardware,
        aero,
        dt: SEARCH_DT,
        sampleInterval: Infinity,
        structuralFailures: false,
      });
      s = Math.max(s, score(flown, vehicle, tuneFor));
    }
    cache.set(key, s);
    return s;
  };

  // Seed with the current programme and a coarse grid; refine the best few.
  const current: Params = [base.kickAngle, base.upperStage?.startPitch ?? 0, base.upperStage?.endPitch ?? 0];
  const seeds: [Params, number][] = [[current, evaluate(current)]];
  for (const kick of GRID.kick) {
    for (const start of GRID.start) {
      for (const end of GRID.end) seeds.push([[kick, start, end], evaluate([kick, start, end])]);
    }
  }
  seeds.sort((a, b) => a[1] - b[1]);

  robust = (model.spread?.length ?? 0) > 0;
  const rescored: [Params, number][] = seeds.slice(0, 3).map(([p]) => [p, evaluate(p)]);
  let best = rescored.reduce((a, b) => (b[1] < a[1] ? b : a));
  for (const seed of rescored) {
    const refined = patternSearch(seed, evaluate);
    if (refined[1] < best[1]) best = refined;
  }

  const program = programFrom(base, best[0]);
  const predicted = simulateAscent({ ...vehicle, pitchProgram: program }, mission, flightModel);
  return { program, predicted, inSpec: predicted.summary.insertion?.inSpec ?? false, runs };
}

/** Compass search: try a step each way on each axis, halve the step when nothing improves. */
function patternSearch(start: [Params, number], evaluate: (p: Params) => number): [Params, number] {
  const bounds = [KICK, START, END];
  let [point, value] = start;
  let steps = [1, 5, 5];
  const minimum = [0.02, 0.1, 0.1];
  while (steps.some((s, i) => s >= minimum[i]!)) {
    let improved = false;
    for (let axis = 0; axis < 3; axis++) {
      if (steps[axis]! < minimum[axis]!) continue;
      for (const direction of [1, -1]) {
        const [lo, hi] = bounds[axis]!;
        const candidate = [...point] as Params;
        candidate[axis] = Math.min(hi, Math.max(lo, candidate[axis]! + direction * steps[axis]!));
        const v = evaluate(candidate);
        if (v < value) {
          point = candidate;
          value = v;
          improved = true;
          break;
        }
      }
    }
    if (!improved) steps = steps.map((s) => s / 2);
  }
  return [point, value];
}

/**
 * Re-tune from everything the campaign has measured so far, and charge the
 * trajectory office's time. Returns the re-tuned vehicle and a report.
 */
export function retuneFromTests(
  campaign: Campaign,
  vehicle: Vehicle,
  mission: Mission,
): { vehicle: Vehicle; result: RetuneResult; text: string } {
  const aero = believedAero(campaign);
  const result = retunePitch(vehicle, mission, { hardware: believedHardware(campaign), aero, spread: supersonicSpread(campaign, vehicle, aero) });
  campaign.spent += RETUNE_COST.cost;
  campaign.days += RETUNE_COST.days;

  const before = vehicle.pitchProgram as GravityTurn;
  const after = result.program;
  const deg = (x: number) => `${x.toFixed(1)}°`;
  const ramp = (p: GravityTurn) => (p.upperStage ? `${deg(p.upperStage.startPitch)} → ${deg(p.upperStage.endPitch)}` : "prograde");
  const lines = [
    `Trajectory office re-tune for ${mission.name}, flying the vehicle as measured.`,
    `  Kick ${deg(after.kickAngle)} (was ${deg(before.kickAngle)}); upper-stage ramp ${ramp(after)} (was ${ramp(before)}).`,
  ];
  const { summary, outcome } = result.predicted;
  const orbit = summary.orbit;
  const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
  if (outcome === "orbit" && orbit) {
    lines.push(
      `  Predicted ${km(orbit.periapsis)} × ${km(orbit.apoapsis)}, ${result.inSpec ? "in spec" : "out of spec"}, ${Math.round(summary.propellantMargin)} kg propellant margin.`,
    );
  } else if (outcome === "failure") {
    const e = result.predicted.events.find((x) => x.kind === "structural-failure");
    lines.push(
      `  No programme flies clear of the known ${e?.mode ? FAILURE_LABELS[e.mode] : "failure"}. The vehicle goes transonic in air too thick for it whatever the pitch; it needs the buffet fixed or less thrust low down. Programme unchanged.`,
    );
  } else {
    lines.push("  No programme reaches orbit with the vehicle as measured. It needs more Δv or less payload. Programme unchanged.");
  }
  lines.push(`  ${result.runs} simulated flights. $${RETUNE_COST.cost}k, ${RETUNE_COST.days} days.`);
  // Adopt the new programme only if it gets there; a better way to fail is still a failure.
  const adopted = outcome === "orbit" ? { ...vehicle, pitchProgram: after } : vehicle;
  return { vehicle: adopted, result, text: lines.join("\n") };
}
