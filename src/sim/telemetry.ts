import type { FlightResult } from "./ascent.ts";
import { aeroShape, BUFFET_BAND } from "./airframe.ts";
import { knowledgeOf, learnParts, refreshFromParts, type Campaign, type TestReport } from "./teststand.ts";
import type { Vehicle } from "./vehicle.ts";

/** Running needed before telemetry can pin down Isp, s. */
const STEADY_STATE = 5;

/**
 * What a flight teaches. Telemetry sees what a stand or tunnel would have,
 * for whatever the flight actually reached: each stage's burn as far as it
 * got, real vacuum running for upper stages, and the transonic band once
 * the vehicle is through it. Expensive data, but real.
 */
export function learnFromFlight(campaign: Campaign, vehicle: Vehicle, result: FlightResult): void {
  vehicle.stages.forEach((stage, index) => {
    const ignition = result.events.find((e) => e.kind === "ignition" && e.stage === index);
    if (!ignition) return;
    // A stage can burn more than once: on the way up, then after each coast.
    // Its running time is the sum of the burns.
    const lastT = result.events[result.events.length - 1]!.t;
    let burned = 0;
    let from: number | null = ignition.t;
    for (const e of result.events) {
      if (e.stage !== index || e.t < ignition.t) continue;
      if ((e.kind === "relight" || e.kind === "ignition") && from === null) from = e.t;
      if (from !== null && ["meco", "cutoff", "engine-failure", "transfer", "circularize", "escape", "staging"].includes(e.kind) && e.t > from) {
        burned += e.t - from;
        from = null;
      }
    }
    if (from !== null) burned += lastT - from;
    const failure = result.events.find((e) => e.stage === index && e.kind === "engine-failure");
    const truth = campaign.truth[stage.engine.name];
    if (!truth) return;
    const known = knowledgeOf(campaign, stage.engine);
    known.firings += 1;
    const report: TestReport = {
      engine: stage.engine.name,
      facility: "flight",
      planned: burned,
      fired: burned,
      findings: [],
      isp: null,
      hardwareLost: false,
      cost: 0,
      days: 0,
      text: `Flight telemetry: ${stage.engine.name} ran ${burned.toFixed(1)} s.`,
    };
    if (failure?.mode) {
      report.findings.push({ mode: failure.mode, t: burned, text: `${failure.mode} at ${burned.toFixed(1)} s in flight` });
      if (!known.open.includes(failure.mode)) known.open.push(failure.mode);
      known.seen[failure.mode] = burned;
    }
    if (burned > 0.3) known.startupProven = true;
    known.provenDuration = Math.max(known.provenDuration, burned);
    if (burned >= STEADY_STATE) {
      known.measuredIspFactor = truth.ispFactor;
      if (index > 0) known.altitudeTested = true;
    }
    known.history.push(report);
    // A relight in flight that wasn't followed by a relight failure proves the restart.
    const relit = result.events.some((e) => e.kind === "relight" && e.stage === index) && failure?.mode !== "relight-failure";
    if (relit) known.relightProven = true;
    learnParts(campaign, stage.engine, burned, report.findings, "flight", burned >= STEADY_STATE && index > 0, relit);
  });
  refreshFromParts(campaign);

  // Through the transonic band and out the other side: the airframe's real
  // drag and any buffet are on the recorder.
  const shape = aeroShape(vehicle).key;
  const aero = campaign.aeroTruth[shape];
  if (!aero) return;
  const through = result.samples.some((s) => s.mach > BUFFET_BAND[1]);
  const brokeUp = result.events.some((e) => e.kind === "structural-failure");
  if (!through && !brokeUp) return;
  const known = (campaign.aeroKnowledge[shape] ??= {
    runs: 0,
    dragFactor: null,
    dragSource: null,
    transonicRise: null,
    buffet: null,
    open: [],
    fixed: [],
    history: [],
  });
  known.runs += 1;
  known.dragFactor = aero.dragFactor;
  known.dragSource = "tunnel";
  known.transonicRise = aero.transonicRise;
  known.buffet = aero.buffet;
  if (aero.buffet > 0 && !known.open.includes("transonic-buffet")) known.open.push("transonic-buffet");
}
