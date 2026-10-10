import { simulateAscent } from "./sim/ascent.ts";
import { debrief } from "./sim/debrief.ts";
import { VEHICLES } from "./vehicles.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const name = args.find((a) => !a.startsWith("--")) ?? "pathfinder";
const vehicle = VEHICLES[name];

if (!vehicle) {
  console.error(`Unknown vehicle "${name}". Choose one of: ${Object.keys(VEHICLES).join(", ")}`);
  process.exit(1);
}

const result = simulateAscent(vehicle);
console.log(json ? JSON.stringify(result, null, 2) : debrief(result, vehicle));
