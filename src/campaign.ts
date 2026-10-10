import { simulateAscent } from "./sim/ascent.ts";
import { debrief } from "./sim/debrief.ts";
import { aeroShape, rollAeroTruths } from "./sim/airframe.ts";
import { FAILURE_LABELS, rollTruths, type FailureMode } from "./sim/hardware.ts";
import { AERO_FACILITIES, applyAeroFix, believedAero, tunnelRun, type AeroFacility } from "./sim/tunnel.ts";
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
 *   tunnel:transonic         put the vehicle's shape in the transonic tunnel
 *                            (also tunnel:cfd, tunnel:subsonic)
 *   fix:aero:transonic-buffet  fix buffet the tunnel has seen
 *
 * npm run campaign -- meridian leo-300 --seed 7 harrier-sl@5 harrier-sl@150 --reveal
 */

const USAGE =
  "Usage: campaign <vehicle> [mission] [--seed N] [--reveal] [engine@seconds[/altitude] | tunnel:facility | fix:engine:mode | fix:aero:mode ...]";

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

const campaign = newCampaign(rollTruths(Object.values(ENGINES), seed), rollAeroTruths(Object.values(VEHICLES), seed));
console.log(`TEST CAMPAIGN: ${vehicle.name}, seed ${seed}`);
console.log("");

for (const step of words) {
  if (step.startsWith("fix:")) {
    const [, target = "", mode = ""] = step.split(":");
    try {
      console.log(
        target === "aero"
          ? applyAeroFix(campaign, vehicle, mode as FailureMode)
          : applyFix(campaign, engineOf(target), mode as FailureMode).text,
      );
    } catch (error) {
      console.log((error as Error).message);
    }
  } else if (step.startsWith("tunnel:")) {
    const facility = step.slice("tunnel:".length);
    if (!(facility in AERO_FACILITIES)) fail(`Unknown tunnel "${facility}". Choose one of: ${Object.keys(AERO_FACILITIES).join(", ")}`);
    console.log(tunnelRun(campaign, vehicle, facility as AeroFacility).text);
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
for (const u of unknowns) console.log(`  ${u.subject}: ${u.text}`);
console.log("");

// What the company expects, flying its model of the engines.
const forecast = simulateAscent(vehicle, mission, { hardware: believedHardware(campaign), aero: believedAero(campaign) });
const predicted = forecast.summary.insertion;
const orbit = forecast.summary.orbit;
const km = (m: number) => `${(m / 1000).toFixed(0)} km`;
console.log(
  `Prediction from test data: ${
    forecast.outcome === "orbit" && orbit
      ? `${km(orbit.periapsis)} × ${km(orbit.apoapsis)}${predicted ? `, ${predicted.inSpec ? "in spec" : "out of spec"}` : ""}, ${Math.round(forecast.summary.propellantMargin)} kg propellant margin.`
      : forecast.outcome === "failure"
        ? `vehicle lost to a known ${forecastFailure()}.`
        : !mission.target && forecast.outcome === "apogee"
          ? `apogee ${km(forecast.summary.apogee)}.`
          : `no orbit (${forecast.outcome}). The vehicle as measured can't do this mission.`
  }`,
);
console.log("");

const result = simulateAscent(vehicle, mission, { hardware: campaign.truth, aero: campaign.aeroTruth });
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
  const shape = aeroShape(vehicle);
  const a = campaign.aeroTruth[shape.key]!;
  console.log(
    `  Airframe (${shape.label}): drag ×${a.dragFactor.toFixed(3)}, transonic rise ×${a.transonicRise.toFixed(2)}, buffet ${a.buffet > 0 ? `${a.buffet.toFixed(2)}× q` : "none"}`,
  );
}

function forecastFailure(): string {
  const e = forecast.events.find((x) => x.kind === "engine-failure" || x.kind === "structural-failure");
  return e?.mode ? `${FAILURE_LABELS[e.mode]} at T+${e.t.toFixed(1)} s` : "failure";
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
