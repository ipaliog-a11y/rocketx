import { dragCoefficient } from "./aero.ts";
import { aeroShape, BUFFET_BAND, dragMultiplier, IDEAL_AERO, type AeroTruth, type AeroTruthTable } from "./airframe.ts";
import type { FailureMode } from "./hardware.ts";
import type { Campaign, Unknown } from "./teststand.ts";
import type { Vehicle } from "./vehicle.ts";

/**
 * Aerodynamic test campaigns. Three ways to ask the air a question, each
 * cheaper and blinder than the next:
 *
 * - CFD is nearly free and gets drag roughly right, but its steady
 *   turbulence model averages over moving shocks. It never shows buffet
 *   and smooths the transonic drag rise away.
 * - The subsonic tunnel measures drag properly, below the transonic band.
 * - The transonic tunnel measures the drag rise and shows buffet.
 */

export type AeroFacility = "cfd" | "subsonic" | "transonic";

type AeroFacilitySpec = { name: string; cost: number; days: number };

export const AERO_FACILITIES: Record<AeroFacility, AeroFacilitySpec> = {
  cfd: { name: "CFD", cost: 10, days: 2 },
  subsonic: { name: "subsonic tunnel", cost: 60, days: 7 },
  transonic: { name: "transonic tunnel", cost: 180, days: 14 },
};

/** CFD's estimate lands this share of the way from the hand curve to the truth. */
const CFD_FIDELITY = 0.5;

/** Mach numbers the reports quote drag at. */
const SUBSONIC_MACH = 0.5;
const TRANSONIC_MACH = 1.05;

export type AeroKnowledge = {
  runs: number;
  /** Believed drag over the hand curve, and how it was learned. */
  dragFactor: number | null;
  dragSource: "cfd" | "tunnel" | null;
  /** Measured peak of the transonic rise, once a transonic run has seen it. */
  transonicRise: number | null;
  /** Buffet severity seen in the transonic tunnel; 0 if it looked and saw none. */
  buffet: number | null;
  /** Believed supersonic drag over the model, on a shape drawn with a geometry: CFD's half-right figure, or a flight's. */
  supersonicFactor?: number | null;
  supersonicSource?: "cfd" | "flight" | null;
  open: FailureMode[];
  fixed: FailureMode[];
  history: TunnelReport[];
};

export type TunnelReport = {
  shape: string;
  facility: AeroFacility;
  dragFactor: number;
  transonicRise: number | null;
  buffet: number | null;
  cost: number;
  days: number;
  text: string;
};

function knowledgeOf(campaign: Campaign, key: string): AeroKnowledge {
  return (campaign.aeroKnowledge[key] ??= {
    runs: 0,
    dragFactor: null,
    dragSource: null,
    transonicRise: null,
    buffet: null,
    open: [],
    fixed: [],
    history: [],
  });
}

function truthOf(campaign: Campaign, vehicle: Vehicle): AeroTruth {
  const shape = aeroShape(vehicle);
  const truth = campaign.aeroTruth[shape.key];
  if (!truth) throw new Error(`No aero truth for the ${shape.label}`);
  return truth;
}

const signedPct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;

/** Put the vehicle's shape through one facility. */
export function tunnelRun(campaign: Campaign, vehicle: Vehicle, facility: AeroFacility): TunnelReport {
  const shape = aeroShape(vehicle);
  const truth = truthOf(campaign, vehicle);
  const known = knowledgeOf(campaign, shape.key);
  const spec = AERO_FACILITIES[facility];
  const lines = [`${spec.name}, ${shape.label}.`];
  const cd = (mach: number) => dragCoefficient(vehicle.dragCurve, mach);

  let dragFactor: number;
  let transonicRise: number | null = null;
  let buffet: number | null = null;

  if (facility === "cfd") {
    dragFactor = 1 + (truth.dragFactor - 1) * CFD_FIDELITY;
    if (known.dragSource !== "tunnel") {
      known.dragFactor = dragFactor;
      known.dragSource = "cfd";
    }
    lines.push(`  Drag ${signedPct(dragFactor - 1)} against the hand curve across the Mach range.`);
    if (truth.supersonicFactor !== undefined && known.supersonicSource !== "flight") {
      known.supersonicFactor = 1 + (truth.supersonicFactor - 1) * CFD_FIDELITY;
      known.supersonicSource = "cfd";
      lines.push(`  Above Mach 1.3: ${signedPct(known.supersonicFactor - 1)}, half right at best. No tunnel here reaches it; a flight past Mach 1.5 measures it.`);
    }
    lines.push(
      "  CFD's steady turbulence model averages over moving shocks: it smooths the transonic rise and can't show buffet.",
    );
  } else {
    dragFactor = truth.dragFactor;
    known.dragFactor = dragFactor;
    known.dragSource = "tunnel";
    lines.push(
      `  Cd ${(cd(SUBSONIC_MACH) * dragFactor).toFixed(3)} at Mach ${SUBSONIC_MACH} against ${cd(SUBSONIC_MACH).toFixed(3)} predicted (${signedPct(dragFactor - 1)}).`,
    );
  }

  if (facility === "transonic") {
    transonicRise = truth.transonicRise;
    buffet = truth.buffet;
    known.transonicRise = transonicRise;
    known.buffet = buffet;
    const measured = cd(TRANSONIC_MACH) * dragMultiplier(truth, TRANSONIC_MACH);
    lines.push(
      `  Cd ${measured.toFixed(3)} at Mach ${TRANSONIC_MACH} against ${cd(TRANSONIC_MACH).toFixed(3)} predicted (${signedPct(measured / cd(TRANSONIC_MACH) - 1)}). The hand curve ${transonicRise > 1.1 ? "undersold the drag rise" : "had the drag rise about right"}.`,
    );
    if (buffet > 0) {
      lines.push(
        `  Buffet from Mach ${BUFFET_BAND[0]} to ${BUFFET_BAND[1]}: the shock on the fairing shoulder oscillates, and the unsteady load reaches ${buffet.toFixed(2)}× dynamic pressure.`,
      );
      if (!known.open.includes("transonic-buffet")) known.open.push("transonic-buffet");
    } else {
      lines.push("  No buffet: the flow over the shoulder stays steady through Mach 1.");
    }
  }

  known.runs += 1;
  campaign.spent += spec.cost;
  campaign.days += spec.days;
  lines.push(`  $${spec.cost}k, ${spec.days} days.`);
  const report: TunnelReport = { shape: shape.label, facility, dragFactor, transonicRise, buffet, cost: spec.cost, days: spec.days, text: lines.join("\n") };
  known.history.push(report);
  return report;
}

/** Vortex generators on the shoulder: they break up the shock oscillation and add a little drag. */
export const BUFFET_FIX = { name: "vortex generators on the fairing shoulder", cost: 120, days: 21, dragPenalty: 1.03 };

/**
 * Fix buffet the transonic tunnel has seen. The changed shoulder is a new
 * shape, so drag and the transonic band have to be measured again.
 */
export function applyAeroFix(campaign: Campaign, vehicle: Vehicle, mode: FailureMode): string {
  const shape = aeroShape(vehicle);
  const known = knowledgeOf(campaign, shape.key);
  if (mode !== "transonic-buffet") throw new Error(`${mode} isn't an aerodynamic problem.`);
  if (!known.open.includes(mode)) {
    throw new Error(`No buffet has been seen on the ${shape.label}. The tunnel has to see a problem before it can be fixed.`);
  }
  const truth = truthOf(campaign, vehicle);
  campaign.aeroTruth[shape.key] = { ...truth, buffet: 0, dragFactor: truth.dragFactor * BUFFET_FIX.dragPenalty };
  known.open = known.open.filter((m) => m !== mode);
  known.fixed.push(mode);
  known.dragFactor = null;
  known.dragSource = null;
  known.transonicRise = null;
  known.buffet = null;
  campaign.spent += BUFFET_FIX.cost;
  campaign.days += BUFFET_FIX.days;
  return `${shape.label}: ${BUFFET_FIX.name}. They break up the shock oscillation and add about 3% drag. $${BUFFET_FIX.cost}k, ${BUFFET_FIX.days} days. Earlier tunnel data no longer counts for this shape.`;
}

/** The aero the company believes in: measured where measured, the hand curve where not, and only buffet it has seen. */
export function believedAero(campaign: Campaign): AeroTruthTable {
  const believed: AeroTruthTable = {};
  for (const key of Object.keys(campaign.aeroTruth)) {
    const known = campaign.aeroKnowledge[key];
    believed[key] = {
      dragFactor: known?.dragFactor ?? IDEAL_AERO.dragFactor,
      transonicRise: known?.transonicRise ?? IDEAL_AERO.transonicRise,
      buffet: known?.open.includes("transonic-buffet") ? (known.buffet ?? 0) : 0,
      // A shape drawn with a geometry has a supersonic part of its own: the model until something measures it.
      ...(campaign.aeroTruth[key]!.supersonicFactor !== undefined ? { supersonicFactor: known?.supersonicFactor ?? 1 } : {}),
    };
  }
  return believed;
}

/** What the vehicle's shape flies on trust. */
export function aeroUnknowns(vehicle: Vehicle, campaign: Campaign): Unknown[] {
  const shape = aeroShape(vehicle);
  const known = campaign.aeroKnowledge[shape.key];
  const add = (text: string): Unknown => ({ subject: "Airframe", text });
  if (!known || known.runs === 0) {
    return [add(`Aerodynamics on paper. Drag, the transonic drag rise and buffet on the ${shape.label} are ${vehicle.geometry ? "the build-up model's" : "hand"} estimates.`)];
  }
  const unknowns: Unknown[] = [];
  if (known.open.includes("transonic-buffet")) {
    unknowns.push(add(`Known transonic buffet at ${(known.buffet ?? 0).toFixed(2)}× dynamic pressure, not fixed.`));
  }
  if (known.dragSource === "cfd") unknowns.push(add("Drag known only from CFD, which smooths over the transonic band."));
  if (known.dragSource === null) unknowns.push(add("Drag never measured on the current shape."));
  if (known.transonicRise === null) {
    unknowns.push(add("Transonic band never in a tunnel. Buffet and the real drag rise near Mach 1 are unknown."));
  }
  if (campaign.aeroTruth[shape.key]?.supersonicFactor !== undefined && known.supersonicSource !== "flight") {
    unknowns.push(add("Supersonic drag is on the model: no flight past Mach 1.5 yet, and no tunnel here reaches it."));
  }
  return unknowns;
}
