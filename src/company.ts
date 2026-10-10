import {
  accept,
  brief,
  build,
  fire,
  fixAero,
  fixEngine,
  fly,
  newCompany,
  retune,
  reputation,
  status,
  summary,
  tunnel,
  type ActionResult,
} from "./sim/company.ts";
import type { FailureMode } from "./sim/hardware.ts";
import type { Facility } from "./sim/teststand.ts";
import type { AeroFacility } from "./sim/tunnel.ts";
import { generateBoard, startingCash } from "./contracts.ts";
import { MISSIONS } from "./missions.ts";
import { ENGINES, VEHICLES } from "./vehicles.ts";

/**
 * Play a company run as a script of steps, in order:
 *
 *   board                         show the contract board
 *   brief:leo-150:meridian        the bid screen for a contract and a design
 *   accept:leo-150                sign a contract
 *   harrier-sl@140[/altitude]     hot-fire an engine
 *   tunnel:meridian:transonic     put a design's shape in a tunnel (cfd, subsonic, transonic)
 *   fix:harrier-vac:hard-start    fix a mode a test found (fix:aero:meridian:transonic-buffet for buffet)
 *   retune:meridian:leo-150       re-tune a design's pitch programme for a contract
 *   build:meridian                build a vehicle
 *   fly:meridian:leo-150          fly a built vehicle for a signed contract
 *   fly:pathfinder                fly a test flight (fly:meridian@leo-300 picks the mission)
 *   status                        cash, calendar and what's signed
 *
 * npm run company -- --seed 3 board accept:sounding build:pathfinder fly:pathfinder:sounding
 */

const args = process.argv.slice(2);
const seedAt = args.indexOf("--seed");
const seed = seedAt >= 0 ? Number(args.splice(seedAt, 2)[1]) : 1;
const steps = args.filter((a) => !a.startsWith("--"));

const board = generateBoard(seed);
const company = newCompany(seed, startingCash(seed), VEHICLES, Object.values(ENGINES), board);
const money = (k: number) => `$${(k / 1000).toFixed(2)}M`;

console.log(`COMPANY RUN, seed ${seed}. ${money(company.cash)} in the bank, one pad at Port Avery, one stand, day 0.`);
console.log("");

for (const step of steps) {
  if (company.dead) {
    console.log(`Skipping "${step}": the company is gone.`);
    continue;
  }
  console.log(`> ${step}`);
  try {
    const out = run(step);
    if (out) {
      console.log(out.text);
      for (const n of out.notices) console.log(n);
    }
  } catch (error) {
    console.log((error as Error).message);
  }
  console.log(`[day ${company.day}, ${money(company.cash)}, reputation ${reputation(company)}]`);
  console.log("");
}

console.log(summary(company));

function run(step: string): ActionResult | null {
  const [verb = "", ...rest] = step.split(":");
  if (step === "board") {
    console.log(boardText());
    return null;
  }
  if (step === "status") {
    console.log(status(company));
    return null;
  }
  switch (verb) {
    case "brief":
      console.log(brief(company, rest[0] ?? "", vehicleKey(rest[1])));
      return null;
    case "accept":
      return accept(company, rest[0] ?? "");
    case "tunnel":
      return tunnel(company, vehicleKey(rest[0]), (rest[1] ?? "") as AeroFacility);
    case "fix":
      return rest[0] === "aero"
        ? fixAero(company, vehicleKey(rest[1]), (rest[2] ?? "") as FailureMode)
        : fixEngine(company, engineOf(rest[0]), (rest[1] ?? "") as FailureMode);
    case "retune":
      return retune(company, vehicleKey(rest[0]), rest[1] ?? "");
    case "build":
      return build(company, vehicleKey(rest[0]));
    case "fly": {
      const [key = "", missionName] = (rest[0] ?? "").split("@");
      const vehicle = vehicleKey(key);
      if (rest[1]) return fly(company, vehicle, { contract: rest[1] });
      const steered = VEHICLES[vehicle]!.pitchProgram?.kind === "gravity-turn";
      const mission = MISSIONS[missionName ?? (steered ? "leo-300" : "suborbital")];
      if (!mission) throw new Error(`Unknown mission "${missionName}". Choose one of: ${Object.keys(MISSIONS).join(", ")}`);
      return fly(company, vehicle, { mission });
    }
  }
  const firing = /^([a-z0-9-]+)@(\d+(?:\.\d+)?)(?:\/(sea-level|altitude))?$/.exec(step);
  if (firing) {
    const [, engine = "", seconds = "0", facility = "sea-level"] = firing;
    return fire(company, engineOf(engine), Number(seconds), facility as Facility);
  }
  throw new Error(`Can't read step "${step}".`);
}

function boardText(): string {
  const lines = ["CONTRACT BOARD"];
  for (const c of company.board) {
    const state = company.closed[c.id] ?? (company.accepted.includes(c.id) ? "signed" : "open");
    const rep = c.minReputation > 0 ? `, reputation ${c.minReputation}+` : "";
    lines.push(`  ${c.id.padEnd(13)} ${c.title}. ${c.customer}. ${money(c.payout)}, penalty ${money(c.penalty)}, by day ${c.deadline}${rep}. [${state}]`);
  }
  return lines.join("\n");
}

function vehicleKey(key: string | undefined): string {
  if (!key || !VEHICLES[key]) throw new Error(`Unknown vehicle "${key ?? ""}". Choose one of: ${Object.keys(VEHICLES).join(", ")}`);
  return key;
}

function engineOf(key: string | undefined) {
  const engine = key ? ENGINES[key] : undefined;
  if (!engine) throw new Error(`Unknown engine "${key ?? ""}". Choose one of: ${Object.keys(ENGINES).join(", ")}`);
  return engine;
}
