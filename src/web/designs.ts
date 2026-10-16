import type { Contract } from "../sim/contracts.ts";
import type { Vehicle } from "../sim/vehicle.ts";
import { STARTERS } from "../starters.ts";

/** The designs a player starts with: drawing-board designs, so they fly the full physics. */
export const DESIGNS: Record<string, Vehicle> = STARTERS;

/** The design a contract's bid opens on: sounding work takes the Pathfinder, orbits the Meridian. */
export function defaultDesign(c: Contract): string {
  return c.minApogee !== undefined ? "pathfinder" : "meridian";
}
