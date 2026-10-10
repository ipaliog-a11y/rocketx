import { simulateAscent } from "./ascent.ts";
import { assembleVehicle, designQuote, DIAMETERS, figures, MAX_SLENDERNESS, maxEngines, type DesignQuote, type Figures, type VehicleSpec } from "./builder.ts";
import { P_SEA_LEVEL } from "./constants.ts";
import { vehicleCost } from "./cost.ts";
import { flowSeparates, type Engine } from "./engine.ts";
import type { HardwareTruth } from "./hardware.ts";
import type { Mission } from "./mission.ts";
import { burnTime, type Vehicle } from "./vehicle.ts";

/**
 * The design office's sizing guide. Given a job (an orbit or an apogee and
 * a payload), it searches stage sizes and engine choices among the engines
 * the company has, and sizes them with the rocket equation against what the
 * job needs. It is a starting point: the numbers assume typical engines and
 * a sensible trajectory, so a design still wants testing, a re-tune and a
 * forecast before anyone signs.
 */

export type Goal = { mission: Mission; payloadMass: number; minApogee?: number };

export type Suggestion = {
  label: "Cheapest" | "Balanced" | "Most margin";
  spec: VehicleSpec;
  vehicle: Vehicle;
  figures: Figures;
  /** Δv with typical engines over what the job needs, minus one; apogee over the target for sounding work. */
  margin: number;
  /** Build cost of one vehicle, $k, and its build days. */
  build: { cost: number; days: number };
  design: DesignQuote;
  note: string;
};

/** Typical engines deliver this share of their drawings' Isp. */
const TYPICAL_ISP = 0.975;

/**
 * Δv a circular orbit from Port Avery takes, m/s: fitted to the Meridian's
 * measured capacity at each altitude and inclination with typical engines.
 */
export function orbitDeltaV(mission: Mission): number {
  const t = mission.target!;
  const km = (t.apoapsis + t.periapsis) / 2000;
  return 9_500 + 4.6 * (km - 300) + 6.3 * (t.inclination - 28.5);
}

/** Δv a vertical flight to an apogee takes, m/s: fitted to the Pathfinder. */
export function apogeeDeltaV(apogee: number): number {
  return 6.9 * Math.sqrt(apogee);
}

const typicalHardware = (engines: Engine[]): HardwareTruth =>
  Object.fromEntries(engines.map((e) => [e.name, { ispFactor: TYPICAL_ISP, hardStart: false, instabilityOnset: null, thermalLife: Infinity }]));

const lengths = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => Math.round((from + i * step) * 10) / 10);

/** Fewest engines that give at least `tw`, or null if even a full cluster can't. */
function enoughEngines(spec: VehicleSpec, stage: number, tw: number, engines: Record<string, Engine>, cap: number): VehicleSpec | null {
  const s = spec.stages[stage]!;
  const max = Math.min(cap, maxEngines(engines[s.engine]!, s.diameter));
  for (let n = 1; n <= max; n++) {
    const candidate = { ...spec, stages: spec.stages.map((x, i) => (i === stage ? { ...x, engineCount: n } : x)) };
    const f = figures(assembleVehicle(candidate, engines));
    if ((stage === 0 ? f.liftoffTW : f.thrustToWeight[stage]!) >= tw) return candidate;
  }
  return null;
}

type Candidate = { spec: VehicleSpec; vehicle: Vehicle; figures: Figures; margin: number; firstCost: number };

/** Three picks from the candidates that clear the bar: cheapest, a comfortable margin, and the most margin for the money. */
function pick(candidates: Candidate[], existing: Vehicle[], minMargin: number, note: (c: Candidate) => string): Suggestion[] {
  const ok = candidates.filter((c) => c.margin >= minMargin).sort((a, b) => a.firstCost - b.firstCost);
  if (ok.length === 0) return [];
  const cheapest = ok[0]!;
  const balanced = ok.find((c) => c.margin >= minMargin * 2 && c !== cheapest);
  const most = ok.filter((c) => c.firstCost <= cheapest.firstCost * 1.5 && c !== cheapest && c !== balanced).sort((a, b) => b.margin - a.margin)[0];
  const out: Suggestion[] = [];
  const add = (label: Suggestion["label"], c: Candidate | undefined) => {
    if (!c) return;
    out.push({ label, spec: c.spec, vehicle: c.vehicle, figures: c.figures, margin: c.margin, build: vehicleCost(c.vehicle), design: designQuote(c.spec, existing), note: note(c) });
  };
  add("Cheapest", cheapest);
  add("Balanced", balanced);
  add("Most margin", most);
  return out;
}

/**
 * Suggest up to three designs for a goal from the company's engines.
 * `existing` is the company's designs: their tooling is free to reuse.
 */
export function suggestBuilds(goal: Goal, engines: Record<string, Engine>, existing: Vehicle[], name = "New design"): Suggestion[] {
  const all = Object.values(engines);
  const padEngines = all.filter((e) => !flowSeparates(e, P_SEA_LEVEL));
  const firstCost = (spec: VehicleSpec, v: Vehicle) => vehicleCost(v).cost + designQuote(spec, existing).cost;

  if (!goal.mission.target) {
    // Sounding work: one stage, straight up. Size with the rocket equation,
    // then fly the cheapest candidates to make sure they really get there.
    const apogee = goal.minApogee ?? 100_000;
    const needed = apogeeDeltaV(apogee);
    const sized: Candidate[] = [];
    for (const d of [0.6, 0.8, 1.0]) {
      for (const len of lengths(1, 8, 0.5).filter((l) => l / d <= MAX_SLENDERNESS)) {
        for (const engine of padEngines) {
          const base: VehicleSpec = { name, stages: [{ diameter: d, tankLength: len, engine: engine.name, engineCount: 1 }], fairingDiameter: d, payloadMass: goal.payloadMass };
          const spec = enoughEngines(base, 0, 1.5, engines, 4);
          if (!spec) continue;
          const vehicle = assembleVehicle(spec, engines);
          const f = figures(vehicle);
          const margin = (f.totalDeltaV * TYPICAL_ISP) / needed - 1;
          if (margin < 0) continue;
          sized.push({ spec, vehicle, figures: f, margin, firstCost: firstCost(spec, vehicle) });
        }
      }
    }
    const flown = sized
      .sort((a, b) => a.firstCost - b.firstCost)
      .slice(0, 24)
      .map((c) => {
        const r = simulateAscent(c.vehicle, goal.mission, { hardware: typicalHardware(all) });
        return { ...c, margin: r.outcome === "apogee" ? r.summary.apogee / apogee - 1 : -1 };
      });
    return pick(flown, existing, 0.05, (c) => `Flies to about ${Math.round((apogee * (1 + c.margin)) / 1000)} km with typical engines. Prove the ${c.vehicle.stages[0]!.engine.name} for the full ${burnTime(c.vehicle.stages[0]!).toFixed(0)} s burn first.`);
  }

  // Orbit: a booster that works on the pad under an upper stage of the same
  // or the next smaller diameter, sized for the job's Δv with typical engines.
  const needed = orbitDeltaV(goal.mission);
  const candidates: Candidate[] = [];
  for (const d of DIAMETERS.filter((x) => x >= 0.8)) {
    const uppers = DIAMETERS.filter((x) => x <= d).slice(-2);
    for (const engine of padEngines) {
      for (const len of lengths(2, 16, 1)) {
        for (const ud of uppers) {
          for (const upper of all) {
            for (const ulen of lengths(0.5, 6, 0.5)) {
              if ((len + ulen) / d > MAX_SLENDERNESS) continue;
              const base: VehicleSpec = {
                name,
                stages: [
                  { diameter: d, tankLength: len, engine: engine.name, engineCount: 1 },
                  { diameter: ud, tankLength: ulen, engine: upper.name, engineCount: 1 },
                ],
                fairingDiameter: Math.max(ud, 0.6),
                payloadMass: goal.payloadMass,
              };
              const withUpper = enoughEngines(base, 1, 0.7, engines, 4);
              const spec = withUpper && enoughEngines(withUpper, 0, 1.3, engines, 20);
              if (!spec) continue;
              const vehicle = assembleVehicle(spec, engines);
              const f = figures(vehicle);
              const margin = (f.totalDeltaV * TYPICAL_ISP) / needed - 1;
              if (margin < 0) continue;
              candidates.push({ spec, vehicle, figures: f, margin, firstCost: firstCost(spec, vehicle) });
            }
          }
        }
      }
    }
  }
  return pick(candidates, existing, 0.04, (c) => {
    const [b, u] = c.vehicle.stages;
    return `${(c.figures.totalDeltaV / 1000).toFixed(2)} km/s on paper against about ${(needed / 1000).toFixed(2)} needed. Test the ${b!.engine.name}${u && u.engine.name !== b!.engine.name ? ` and ${u.engine.name}` : ""}, run the shape in the tunnel, and re-tune before trusting a forecast.`;
  });
}
