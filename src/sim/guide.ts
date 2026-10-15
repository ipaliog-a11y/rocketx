import { simulateAscent } from "./ascent.ts";
import { assembleVehicle, designQuote, fitControl, DIAMETERS, figures, MAX_SLENDERNESS, maxEngines, type DesignQuote, type Figures, type VehicleSpec } from "./builder.ts";
import { P_SEA_LEVEL } from "./constants.ts";
import { vehicleCost } from "./cost.ts";
import { flowSeparates, type Engine } from "./engine.ts";
import type { HardwareTruth } from "./hardware.ts";
import { MU_EARTH, R_EARTH } from "./constants.ts";
import { missionPlan, type Mission } from "./mission.ts";
import { defaultFins, defaultGeometry, GEOMETRY_RANGES, MATERIALS } from "./geometry.ts";
import { hashSeed } from "./random.ts";
import { rollWind } from "./wind.ts";
import { unguidedProblems } from "./stability.ts";
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

/**
 * Δv a mission takes, m/s. Low orbits use the fitted ascent figure; higher
 * ones add the burns after the parking orbit, from vis-viva: a Hohmann
 * raise and circularisation, or the escape burn to the asked-for C3.
 */
export function missionDeltaV(mission: Mission): number {
  const plan = missionPlan(mission);
  if (plan.burns.length === 0) return orbitDeltaV(mission);
  const parking = plan.ascent!;
  let dv = orbitDeltaV({ ...mission, target: parking });
  const r1 = R_EARTH + parking.periapsis;
  const v1 = Math.sqrt(MU_EARTH / r1);
  for (const burn of plan.burns) {
    if (burn.until.kind === "energy") dv += Math.sqrt(2 * burn.until.energy + (2 * MU_EARTH) / r1) - v1;
    else if (burn.name === "transfer") {
      const r2 = R_EARTH + burn.until.altitude;
      dv += v1 * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
    } else {
      // Circularise at the high point of the transfer ellipse.
      const target = mission.target!;
      const r2 = R_EARTH + target.apoapsis;
      const r3 = R_EARTH + burn.until.altitude;
      const atApo = Math.sqrt(MU_EARTH / r2) * Math.sqrt((2 * r1) / (r1 + r2));
      dv += Math.sqrt(MU_EARTH / r2) * Math.sqrt((2 * r3) / (r2 + r3)) - atApo;
    }
  }
  return dv;
}

/** Δv a vertical flight to an apogee takes, m/s: fitted to the Pathfinder. */
export function apogeeDeltaV(apogee: number): number {
  return 6.9 * Math.sqrt(apogee);
}

const typicalHardware = (engines: Engine[]): HardwareTruth =>
  Object.fromEntries(engines.map((e) => [e.name, { ispFactor: TYPICAL_ISP, hardStart: false, instabilityOnset: null, thermalLife: Infinity }]));

const lengths = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => Math.round((from + i * step) * 10) / 10);

/**
 * Fewest engines that give at least `tw`, or null if even a full cluster
 * can't. Each engine adds thrust and its own mass, so the count comes
 * straight from the masses of a one-engine version.
 */
function enoughEngines(spec: VehicleSpec, stage: number, tw: number, engines: Record<string, Engine>, cap: number): VehicleSpec | null {
  const s = spec.stages[stage]!;
  const engine = engines[s.engine]!;
  const max = Math.min(cap, maxEngines(engine, s.diameter));
  const withCount = (n: number): VehicleSpec => ({ ...spec, stages: spec.stages.map((x, i) => (i === stage ? { ...x, engineCount: n } : x)) });
  const one = assembleVehicle(withCount(1), engines);
  const f = figures(one);
  const mass = f.liftoffMass === 0 ? 0 : stage === 0 ? f.liftoffMass : f.liftoffMass - one.stages.slice(0, stage).reduce((a, st) => a + st.dryMass + st.propellantMass, 0);
  const perEngine = stage === 0 ? (f.liftoffTW * mass * 9.80665) : f.thrustToWeight[stage]! * mass * 9.80665;
  const engineMass = one.stages[stage]!.dryMass - assembleVehicle(withCount(0), engines).stages[stage]!.dryMass;
  const denominator = perEngine - tw * 9.80665 * engineMass;
  if (denominator <= 0) return null;
  const n = Math.max(1, Math.ceil((tw * 9.80665 * (mass - engineMass)) / denominator - 1e-9));
  return n <= max ? withCount(n) : null;
}

type Candidate = { spec: VehicleSpec; vehicle: Vehicle; figures: Figures; margin: number; firstCost: number };

/**
 * A candidate drawn as it will be built: the default shape and build, and on
 * an unguided single-stage rocket fins big enough for a calibre of margin.
 * The search runs on the quick model; the picks are re-drawn on the real
 * one, their margin scaled by what that does to Δv.
 */
export function asBuilt(c: Candidate, engines: Record<string, Engine>): Candidate {
  const geometry = defaultGeometry(c.spec.stages.length);
  let spec: VehicleSpec = { ...c.spec, geometry };
  let vehicle = assembleVehicle(spec, engines);
  if (spec.stages.length === 1) {
    const d = spec.stages[0]!.diameter;
    for (const k of [0.6, 0.8, 1.0, 1.2, 1.5]) {
      spec = { ...c.spec, geometry: { ...geometry, fins: { ...defaultFins(d), span: k * d, rootChord: Math.max(1, k) * d } } };
      vehicle = assembleVehicle(spec, engines);
      if (unguidedProblems(vehicle.stability!).length === 0) break;
    }
  }
  if (vehicle.control) {
    spec = fitControl(spec, engines);
    vehicle = assembleVehicle(spec, engines);
  }
  const f = figures(vehicle);
  const margin = (1 + c.margin) * (f.totalDeltaV / c.figures.totalDeltaV) - 1;
  return { spec, vehicle, figures: f, margin, firstCost: c.firstCost };
}

/** Three picks from the candidates that clear the bar: cheapest, a comfortable margin, and the most margin for the money. */
function pick(candidates: Candidate[], existing: Vehicle[], minMargin: number, note: (c: Candidate) => string, fit: (c: Candidate) => Candidate = (c) => c): Suggestion[] {
  const ok = candidates.filter((c) => c.margin >= minMargin).sort((a, b) => a.firstCost - b.firstCost);
  if (ok.length === 0) return [];
  const cheapest = ok[0]!;
  const balanced = ok.find((c) => c.margin >= minMargin * 2 && c !== cheapest);
  const most = ok.filter((c) => c.firstCost <= cheapest.firstCost * 1.5 && c !== cheapest && c !== balanced).sort((a, b) => b.margin - a.margin)[0];
  const out: Suggestion[] = [];
  const add = (label: Suggestion["label"], picked: Candidate | undefined) => {
    if (!picked) return;
    const c = fit(picked);
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
        // Fly it as it will be built: its real shape, with fins.
        const built = asBuilt(c, engines);
        const r = simulateAscent(built.vehicle, goal.mission, { hardware: typicalHardware(all) });
        return { ...built, margin: r.outcome === "apogee" ? r.summary.apogee / apogee - 1 : -1 };
      });
    return pick(flown, existing, 0.05, (c) => `Flies to about ${Math.round((apogee * (1 + c.margin)) / 1000)} km with typical engines. Prove the ${c.vehicle.stages[0]!.engine.name} for the full ${burnTime(c.vehicle.stages[0]!).toFixed(0)} s burn first.`);
  }

  // Orbit: a booster that works on the pad under an upper stage of the same
  // or the next smaller diameter, sized for the job's Δv with typical engines.
  const needed = missionDeltaV(goal.mission);
  const relights = missionPlan(goal.mission).burns.length > 0;
  // Beyond about 11 km/s two stages run out: add a kick stage on the best of them.
  const kicked = needed > 11_000;
  const floor = kicked ? -0.45 : 0;
  const candidates: Candidate[] = [];
  for (const d of DIAMETERS.filter((x) => x >= 0.8)) {
    const uppers = DIAMETERS.filter((x) => x <= d).slice(-2);
    for (const engine of padEngines) {
      // Heavy-lift cores run long: past 16 m only on the 3 m class and up.
      for (const len of lengths(2, d >= 3 ? 26 : 16, 1)) {
        for (const ud of uppers) {
          for (const upper of all) {
            for (const ulen of lengths(0.5, ud >= 3 ? 9 : 6, 0.5)) {
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
              if (margin < floor) continue;
              candidates.push({ spec, vehicle, figures: f, margin, firstCost: firstCost(spec, vehicle) });
            }
          }
        }
      }
    }
  }
  let pool = candidates;
  if (kicked) {
    // Put a kick stage on the cheapest two-stage bases: storable or vacuum engines, the upper's diameter or smaller.
    const kickEngines = all.filter((e) => e.parts?.cycle === "storable" || e.exitPressure < 20_000);
    // The cheapest bases and the most capable ones: a kick stage can't rescue a booster that's far too small.
    const byCost = [...candidates].sort((a, b) => a.firstCost - b.firstCost).slice(0, 150);
    const byMargin = [...candidates].sort((a, b) => b.margin - a.margin).slice(0, 250);
    const bases = [...new Set([...byCost, ...byMargin])];
    pool = [];
    for (const b of bases) {
      const ud = b.spec.stages[1]!.diameter;
      for (const kd of DIAMETERS.filter((x) => x <= ud).slice(-2)) {
        for (const kick of kickEngines) {
          for (const klen of lengths(0.5, 4, 0.5)) {
            const base: VehicleSpec = { ...b.spec, stages: [...b.spec.stages, { diameter: kd, tankLength: klen, engine: kick.name, engineCount: 1 }], fairingDiameter: Math.max(kd, 0.6) };
            const withKick = enoughEngines(base, 2, 0.3, engines, 4);
            const spec = withKick && enoughEngines(withKick, 0, 1.3, engines, 20);
            if (!spec) continue;
            const tanks = spec.stages.reduce((sum, st) => sum + st.tankLength, 0);
            if (tanks / spec.stages[0]!.diameter > MAX_SLENDERNESS) continue;
            const vehicle = assembleVehicle(spec, engines);
            const f = figures(vehicle);
            const margin = (f.totalDeltaV * TYPICAL_ISP) / needed - 1;
            if (margin < 0) continue;
            pool.push({ spec, vehicle, figures: f, margin, firstCost: firstCost(spec, vehicle) });
          }
        }
      }
    }
  }
  // Coasts, relights and long low-thrust upper burns cost more than the fit
  // for direct ascents knows about: ask for more margin when they're involved.
  // Re-draw the most promising on the real shape and build before picking.
  // Drawn on the real shape, build and avionics, a stack loses a couple of
  // points of margin; the cheapest that still clear the bar with that to
  // spare are the ones worth re-drawing, alongside the cheapest outright and
  // the most capable.
  const minMargin = relights ? 0.1 : 0.04;
  const byCost = [...pool].sort((a, b) => a.firstCost - b.firstCost);
  const shortlist = [
    ...new Set([
      ...byCost.slice(0, 20),
      ...byCost.filter((c) => c.margin >= minMargin + 0.02).slice(0, 30),
      ...byCost.filter((c) => c.margin >= minMargin + 0.05).slice(0, 15),
      ...[...pool].sort((a, b) => b.margin - a.margin).slice(0, 15),
    ]),
  ].map((c) => asBuilt(c, engines));
  return pick(shortlist, existing, minMargin, (c) => {
    const engines = [...new Set(c.vehicle.stages.map((st) => st.engine.name))];
    const restart = relights ? ` Restart-test the ${c.vehicle.stages.at(-1)!.engine.name} in the altitude cell: this mission relights it after a coast.` : "";
    return `${(c.figures.totalDeltaV / 1000).toFixed(2)} km/s on paper against about ${(needed / 1000).toFixed(2)} needed. Test the ${engines.join(", ")}, run the shape in the tunnel, and re-tune before trusting a forecast.${restart}`;
  }, (c) => flightFit(c, goal.mission, engines));
}

/**
 * Fly a guided pick once in calm air on its job and speed up its attitude
 * loop if the airframe diverges anywhere along the way (staging in thick
 * air is where the paper checks can't see), so what the guide suggests
 * holds attitude as drawn.
 */
function flightFit(c: Candidate, mission: Mission, engines: Record<string, Engine>): Candidate {
  let spec = c.spec;
  let vehicle = c.vehicle;
  for (let i = 0; i < 3 && vehicle.control && spec.geometry; i++) {
    const r = simulateAscent(vehicle, mission, { structuralFailures: false });
    const div = r.summary.control?.maxDivergence ?? 0;
    const bw = vehicle.control.design.bandwidth;
    if (div <= 0.3 || bw >= 3) break;
    // No faster than keeps the bending mode clear: the loop gain there under a fifth, notch or not.
    const fb = vehicle.control.bendingFrequency;
    const ceiling = Math.floor(fb * Math.sqrt(0.2 / (vehicle.control.design.notch ? 0.1 : 1)) * 10) / 10;
    const next = Math.min(3, ceiling, Math.ceil(((bw * div) / 0.28) * 10) / 10);
    if (next <= bw) break;
    spec = { ...spec, geometry: { ...spec.geometry, control: { ...vehicle.control.design, bandwidth: next } } };
    vehicle = { ...assembleVehicle(spec, engines), pitchProgram: vehicle.pitchProgram };
  }
  // Shells for the wind: fly a few days' weather and pressurise the tanks
  // until the drawing carries the worst side load even if the real shell
  // turns out at the weak end of its material's knock-down.
  if (vehicle.control && spec.geometry) {
    let worst = 0;
    for (let i = 1; i <= WIND_DAYS; i++) {
      const r = simulateAscent(vehicle, mission, { structuralFailures: false, wind: rollWind(hashSeed(`guide:${i}`)) });
      worst = Math.max(worst, r.summary.maxQAlpha.value);
    }
    const weakest = Math.min(...spec.geometry.stages.map((g) => MATERIALS[g.material].knockdown[0]));
    // A re-tuned steering programme and a worse day load it more than these few: a quarter on top.
    const needed = (WIND_ALLOWANCE * worst) / weakest;
    for (let i = 0; i < 16 && spec.geometry && (vehicle.limits.maxQAlpha ?? Infinity) < needed; i++) {
      const g = spec.geometry;
      const stages = g.stages.map((st) =>
        st.ullage < GEOMETRY_RANGES.ullage[1] ? { ...st, ullage: Math.min(GEOMETRY_RANGES.ullage[1], st.ullage + 0.5) } : { ...st, safetyFactor: Math.min(GEOMETRY_RANGES.safetyFactor[1], st.safetyFactor + 0.1) },
      );
      if (stages.every((st, k) => st.ullage === g.stages[k]!.ullage && st.safetyFactor === g.stages[k]!.safetyFactor)) break;
      spec = { ...spec, geometry: { ...g, stages } };
      vehicle = { ...assembleVehicle(spec, engines), pitchProgram: vehicle.pitchProgram };
    }
  }
  if (spec === c.spec) return c;
  const f = figures(vehicle);
  return { ...c, spec, vehicle, figures: f, margin: (1 + c.margin) * (f.totalDeltaV / c.figures.totalDeltaV) - 1 };
}

const WIND_ALLOWANCE = 1.25;
/** Days of weather the guide sizes a guided pick's shells for. */
const WIND_DAYS = 6;
