import { createContext, useContext } from "react";
import type { Facility } from "../sim/teststand.ts";

/**
 * Where the player is: one of five places, named by what they're doing,
 * and optionally a tab and a thing to open there. Any view can send the
 * player somewhere with `go`, and lands on the right tab with it open.
 */
export type Place = "home" | "contracts" | "rockets" | "testing" | "launch";

export type Route = {
  place: Place;
  tab?: string;
  /** Testing: the engine to select, and a firing to set up for it. */
  engine?: string;
  facility?: Facility;
  seconds?: number;
  restart?: boolean;
  why?: string;
  /** Rockets: the design to open or simulate; Launch: the design to fly. */
  design?: string;
  /** Contracts and Launch: the contract to open; Rockets › Simulator: the flight to simulate. */
  contract?: string;
};

export const NavContext = createContext<(route: Route) => void>(() => {});

/** Send the player somewhere. */
export function useGo(): (route: Route) => void {
  return useContext(NavContext);
}
