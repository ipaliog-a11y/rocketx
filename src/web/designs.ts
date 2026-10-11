import type { Contract } from "../sim/contracts.ts";
import type { Vehicle } from "../sim/vehicle.ts";
import { MERIDIAN, PATHFINDER, PATHFINDER_FAT_FAIRING, PATHFINDER_TWO_STAGE } from "../vehicles.ts";

/** The designs a player starts with. The other sim variants are command-line teaching cases. */
export const DESIGNS: Record<string, Vehicle> = {
  pathfinder: PATHFINDER,
  "fat-fairing": PATHFINDER_FAT_FAIRING,
  "two-stage": PATHFINDER_TWO_STAGE,
  meridian: MERIDIAN,
};

/** The design a contract's bid opens on: sounding work takes the Pathfinder, orbits the Meridian. */
export function defaultDesign(c: Contract): string {
  return c.minApogee !== undefined ? "pathfinder" : "meridian";
}
