import { simulateAscent } from "./sim/ascent.ts";
import { debrief } from "./sim/debrief.ts";
import { rollTruths, type FailureMode } from "./sim/hardware.ts";
import {
  applyFix,
  believedHardware,
  flightUnknowns,
  hotFire,
  newCampaign,
  type Facility,
} from "./sim/teststand.ts";
import { MISSIONS } from "./missions.ts";
import { ENGINES, VEHICLES } from "./vehicles.ts";

/**
 * Run a test campaign, then fly. Steps run in the order given:
 *
 *   harrier-sl@5             fire on the sea-level stand for 5 s
 *   harrier-vac@300/altitude fire in the altitude cell for 300 s
 *   fix:harrier-sl:hard-start  fix a mode the stand has seen
 *
 * npm run campaign -- meridian leo-300 --seed 7 harrier-sl@5 harrier-sl@150 --reveal
 */

const USAGE = "Usage: campaign <vehicle> [mission] [--seed N] [--reveal] [engine@seconds[/altitude] | fix:engine:mode ...]";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const seed = Number(flag("--seed") ?? 1);
const reveal = args.includes("--reveal");
const words = args.filter((a) => !a.startsWith("--"));

const vehicleName = words.shift();
const vehicle = vehicleName ? VEHICLES[vehicleName] : undefined;
if (!vehicle) fail(`Unknown vehicle "${vehicleName ?? ""}". Choose one of: ${Object.keys(VEHICLES).join(", ")}`);
const steered = vehicle.pitchProgram && vehicle.pitchProgram.kind !== "vertical";
const missionName = words[0] && MISSIONS[words[0]] ? words.shift()! : steered ? "leo-300" : "suborbital";
const mission = MISSIONS[missionName]!;

const campaign = newCampaign(rollTruths(Object.values(ENGINES), seed));
console.log(`TEST CAMPAIGN: ${vehicle.name}, seed ${seed}`);
console.log("");

for (const step of words) {
  if (step.startsWith("fix:")) {
    const [, engineKey = "", mode = ""] = step.split(":");
    try {
      console.log(applyFix(campaign, engineOf(engineKey), mode as FailureMode).text);
    } catch (error) {
      console.log((error as Error).message);
    }
  } else {
    const match = /^([a-z0-9-]+)@(\d+(?:\.\d+)?)(?:\/(sea-level|altitude))?$/.exec(step);
    if (!match) fail(`Can't read step "${step}". ${USAGE}`);
    const [, engineKey = "", seconds = "0", facility = "sea-level"] = match;
    console.log(hotFire(campaign, engineOf(engineKey), Number(seconds), facility as Facility).text);
  }
  console.log("");
}

console.log(`Campaign total: $${Math.round(campaign.spent)}k, ${campaign.days} days.`);
console.log("");
const unknowns = flightUnknowns(vehicle, campaign);
console.log(unknowns.length === 0 ? "Flying with nothing on trust." : "Flying on trust:");
for (const u of unknowns) console.log(`  ${u.engine}: ${u.text}`);
console.log("");

// What the company expects, flying its model of the engines.
const forecast = simulateAscent(vehicle, mission, { hardware: believedHardware(campaign) });
const predicted = forecast.summary.insertion;
const orbit = forecast.summary.orbit;
const km = (m: number) => `${(m / 1000).toFixed(0)} km`;
console.log(
  `Prediction from test data: ${
    forecast.outcome === "orbit" && orbit
      ? `${km(orbit.periapsis)} × ${km(orbit.apoapsis)}${predicted ? `, ${predicted.inSpec ? "in spec" : "out of spec"}` : ""}, ${Math.round(forecast.summary.propellantMargin)} kg propellant margin.`
      : `no orbit (${forecast.outcome}). The engines as measured can't do this mission.`
  }`,
);
console.log("");

const result = simulateAscent(vehicle, mission, { hardware: campaign.truth });
console.log(debrief(result, vehicle, mission, campaign));

if (reveal) {
  console.log("");
  console.log("Hidden truth (not visible in play):");
  for (const stage of vehicle.stages) {
    const t = campaign.truth[stage.engine.name]!;
    console.log(
      `  ${stage.engine.name}: Isp ×${t.ispFactor.toFixed(3)}, hard start ${t.hardStart ? "yes" : "no"}, instability ${t.instabilityOnset === null ? "none" : `at ${t.instabilityOnset.toFixed(1)} s`}, chamber life ${t.thermalLife.toFixed(0)} s`,
    );
  }
}

function engineOf(key: string) {
  const engine = ENGINES[key];
  if (!engine) fail(`Unknown engine "${key}". Choose one of: ${Object.keys(ENGINES).join(", ")}`);
  return engine;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
