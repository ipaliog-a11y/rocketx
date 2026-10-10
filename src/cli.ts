import { simulateAscent } from "./sim/ascent.ts";
import { debrief } from "./sim/debrief.ts";
import { MISSIONS } from "./missions.ts";
import { VEHICLES } from "./vehicles.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const [vehicleName = "pathfinder", missionName] = args.filter((a) => !a.startsWith("--"));
const vehicle = VEHICLES[vehicleName];
if (!vehicle) {
  console.error(`Unknown vehicle "${vehicleName}". Choose one of: ${Object.keys(VEHICLES).join(", ")}`);
  process.exit(1);
}

// Vehicles that steer default to the LEO contract; sounding rockets fly a test.
const defaultMission = vehicle.pitchProgram && vehicle.pitchProgram.kind !== "vertical" ? "leo-300" : "suborbital";
const mission = MISSIONS[missionName ?? defaultMission];
if (!mission) {
  console.error(`Unknown mission "${missionName}". Choose one of: ${Object.keys(MISSIONS).join(", ")}`);
  process.exit(1);
}

const result = simulateAscent(vehicle, mission);
console.log(json ? JSON.stringify(result, null, 2) : debrief(result, vehicle, mission));
