import { simulateAscent } from "./ascent.ts";
import { CAUSE_LABELS, flownGnc, IMU, type Cause, type GncKnowledge, type GncTruth } from "./control.ts";
import { hashSeed } from "./random.ts";
import type { Campaign } from "./teststand.ts";
import type { Vehicle } from "./vehicle.ts";
import { rollWind } from "./wind.ts";
import { LEO_300, SUBORBITAL_TEST } from "../missions.ts";

/**
 * The tests that pin down a guided vehicle's attitude loop before it flies:
 *
 * - a modal survey on the stand: the stack hung soft and shaken, which
 *   measures its first bending mode (the notch filter is retuned to it) and,
 *   with simulant in the tanks, how strongly the propellant sloshes;
 * - IMU calibration in the GNC lab: the inertial unit's drift measured on a
 *   rate table so the flight software can take it out;
 * - hardware-in-the-loop (HITL) runs in the GNC lab: the flight computer and
 *   actuators fly the ascent against a simulation of the real vehicle in
 *   seeded winds. It finds errors in the gain schedule, and fixes them.
 */

export type GncTest = "modal" | "imu-cal" | "hitl";

export const GNC_TEST_LABELS: Record<GncTest, string> = { modal: "Modal survey", "imu-cal": "IMU calibration", hitl: "Hardware-in-the-loop" };

/** Cost ($k) and days. A modal survey scales with the stack it shakes. */
export function gncTestQuote(test: GncTest, vehicle: Vehicle): { cost: number; days: number } {
  switch (test) {
    case "modal": {
      const d = Math.max(...vehicle.stages.map((s) => s.diameter));
      return { cost: Math.round((25 + 15 * d) / 5) * 5, days: 8 };
    }
    case "imu-cal":
      return { cost: 15, days: 3 };
    case "hitl":
      return { cost: 40, days: 10 };
  }
}

/** HITL runs per campaign. */
export const HITL_RUNS = 10;

export const knowledgeFor = (campaign: Campaign, name: string): GncKnowledge => ((campaign.gncKnowledge ??= {})[name] ??= {});

/** Why a test can't be booked for this design, or null. */
export function gncTestBlocked(test: GncTest, vehicle: Vehicle, campaign: Campaign): string | null {
  if (!vehicle.control) return `The ${vehicle.name} has no attitude loop to test: it was drawn before the control model, or flies unguided.`;
  const known = campaign.gncKnowledge?.[vehicle.name];
  if (test === "modal" && known?.bending !== undefined) return `The ${vehicle.name}'s modes have been surveyed.`;
  if (test === "imu-cal" && known?.imuBias !== undefined) return `The ${vehicle.name}'s IMU has been calibrated.`;
  if (test === "hitl" && known?.hitl?.runs && (!known.hitl.flaw || known.flawFixed)) return `The ${vehicle.name}'s flight software has been run in the loop and is clean.`;
  return null;
}

/** Run a test: learn into the campaign's knowledge, and say what it showed. */
export function runGncTest(test: GncTest, campaign: Campaign, vehicle: Vehicle, seed: number): { text: string; bad: boolean } {
  const model = vehicle.control!;
  const truth = campaign.gncTruth?.[vehicle.name];
  if (!truth) throw new Error(`No ${vehicle.name} has been built to test.`);
  const known = knowledgeFor(campaign, vehicle.name);
  switch (test) {
    case "modal": {
      known.bending = truth.bending;
      known.slosh = truth.slosh;
      const real = model.bendingFrequency * truth.bending;
      const off = Math.round((truth.bending - 1) * 100);
      const slosh = truth.slosh.map((g, i) => `stage ${i + 1} ${g.toFixed(2)}`).join(", ");
      const strong = truth.slosh.some((g) => g > 0.5);
      const text = `Modal survey, ${vehicle.name}: first bending mode at ${real.toFixed(2)} Hz, ${off === 0 ? "as drawn" : `${off > 0 ? "+" : ""}${off}% against the drawing`}.${model.design.notch ? " The notch filter is retuned to it." : " There's no notch filter to tune."} Slosh gain ${slosh}${strong && !model.design.baffles ? ": strong, and the tanks have no baffles" : ""}.`;
      return { text, bad: (strong && !model.design.baffles) || (model.design.bandwidth / real) ** 2 > 0.25 };
    }
    case "imu-cal": {
      known.imuBias = truth.imuBias;
      const perHour = truth.imuBias * 3600;
      return { text: `IMU calibration, ${vehicle.name}: ${IMU[model.design.imu].label} drifting ${perHour.toFixed(2)}°/h. The flight software takes it out: what's left is a tenth of that.`, bad: false };
    }
    case "hitl": {
      const flight = flownGnc(model, truth, known);
      const causes = new Map<Cause, number>();
      let peak = 0;
      let losses = 0;
      let where: { stage: number; mach: number } | null = null;
      // The ascent it's built for: to orbit if it turns, straight up if not.
      const mission = vehicle.pitchProgram?.kind === "gravity-turn" ? LEO_300 : SUBORBITAL_TEST;
      for (let i = 0; i < HITL_RUNS; i++) {
        const r = simulateAscent(vehicle, mission, { dt: 0.1, wind: rollWind(hashSeed(`${seed}:hitl:${vehicle.name}:${known.hitl?.runs ?? 0}:${i}`)), gnc: { [vehicle.name]: flight } });
        peak = Math.max(peak, r.summary.control?.maxEffort.value ?? 0);
        const lost = r.events.find((e) => e.kind === "loss-of-control");
        if (lost) {
          losses += 1;
          if (lost.cause) causes.set(lost.cause, (causes.get(lost.cause) ?? 0) + 1);
          where ??= { stage: lost.stage, mach: lost.mach };
        }
      }
      const flaw = flight.flaw;
      known.hitl = { runs: (known.hitl?.runs ?? 0) + HITL_RUNS, losses, peakEffort: peak, flaw };
      if (flaw) known.flawFixed = true;
      const stageName = (i: number) => (vehicle.stages.length === 1 ? "the stage" : i === 0 ? "the booster" : i === 1 ? "the upper stage" : "the kick stage");
      const lostText =
        losses === 0
          ? `held attitude in all ${HITL_RUNS} runs`
          : `lost the vehicle in ${losses} of ${HITL_RUNS} runs (${[...causes].map(([c, n]) => `${CAUSE_LABELS[c]} ×${n}`).join(", ")}), first on ${stageName(where!.stage)} near Mach ${where!.mach.toFixed(1)}`;
      const flawText = flaw ? ` Found a gain-schedule error between Mach ${flaw.from.toFixed(1)} and ${flaw.to.toFixed(1)}: corrected in the flight software.` : " No software errors found.";
      return { text: `Hardware-in-the-loop, ${vehicle.name}: ${lostText}, peak gimbal use ${Math.round(peak * 100)}%.${flawText}`, bad: losses > 0 || flaw !== null };
    }
  }
}

/** What the company doesn't know about a guided vehicle's attitude loop, for a bid. */
export function gncUnknowns(vehicle: Vehicle, campaign: Campaign): string[] {
  if (!vehicle.control) return [];
  const known = campaign.gncKnowledge?.[vehicle.name];
  const out: string[] = [];
  if (known?.bending === undefined) out.push("Bending and slosh on the model: no modal survey.");
  if (known?.imuBias === undefined) out.push("IMU never calibrated: insertion carries its full drift.");
  if (!known?.hitl?.runs) out.push(known?.hitl?.flaw && !known.flawFixed ? "Flight software has a gain-schedule error a flight showed: HITL fixes it." : "Flight software never run hardware-in-the-loop.");
  return out;
}

/** Learn from a flight: what telemetry shows of the attitude loop. */
export function learnGncFromFlight(campaign: Campaign, vehicle: Vehicle, events: Array<{ kind: string; cause?: Cause; t: number }>, burned: number): void {
  if (!vehicle.control) return;
  const truth: GncTruth | undefined = campaign.gncTruth?.[vehicle.name];
  if (!truth) return;
  const known = knowledgeFor(campaign, vehicle.name);
  // A minute of powered flight shows the IMU's drift against the tracking radar.
  if (burned >= 60) known.imuBias ??= truth.imuBias;
  for (const e of events) {
    if (e.kind !== "loss-of-control" && e.kind !== "attitude-oscillation") continue;
    if (e.cause === "bending") known.bending ??= truth.bending;
    if (e.cause === "slosh") known.slosh ??= truth.slosh;
    if (e.cause === "software" && truth.flaw && !known.flawFixed) known.hitl ??= { runs: 0, losses: 0, peakEffort: 0, flaw: truth.flaw };
  }
}
