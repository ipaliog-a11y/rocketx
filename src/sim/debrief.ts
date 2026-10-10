import type { FlightEvent, FlightResult } from "./ascent.ts";
import type { Vehicle } from "./vehicle.ts";

/**
 * Turns a flight into the engineer's debrief. Every line names the physics
 * that caused it; none of it reports a bare reliability number.
 */

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const kPa = (pa: number) => `${(pa / 1000).toFixed(1)} kPa`;
const ms = (v: number) => `${Math.round(v)} m/s`;
const tPlus = (t: number) => `T+${t.toFixed(1)} s`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

function eventLine(e: FlightEvent, vehicle: Vehicle): string {
  const at = `${tPlus(e.t).padEnd(9)}  ${km(e.altitude).padStart(8)}  ${ms(e.velocity).padStart(9)}  M${e.mach.toFixed(2)}`;
  const stage = vehicle.stages[e.stage]?.name ?? "";
  const label: Record<FlightEvent["kind"], string> = {
    ignition: `Ignition, ${stage}`,
    liftoff: `Liftoff, T/W ${e.value?.toFixed(2)}`,
    "no-liftoff": `Held on the pad, T/W ${e.value?.toFixed(2)}`,
    "flow-separation": `Nozzle flow separating at ${kPa(e.value ?? 0)} ambient`,
    "mach-1": "Mach 1",
    "max-q": `Max-q ${kPa(e.value ?? 0)}`,
    "q-limit-exceeded": `Load budget exceeded, q ${kPa(e.value ?? 0)}`,
    "accel-limit-exceeded": `Acceleration limit exceeded, ${e.value?.toFixed(1)} g`,
    meco: `Engine cutoff, ${stage}`,
    staging: `Stage separation, ${stage} ignites`,
    apogee: "Apogee",
    impact: "Ground impact",
    timeout: "Simulation time limit",
  };
  return `  ${at}  ${label[e.kind]}`;
}

export function debrief(result: FlightResult, vehicle: Vehicle): string {
  const { summary, events } = result;
  const lines: string[] = [];
  lines.push(`DEBRIEF: ${vehicle.name}`);
  lines.push("");

  if (result.outcome === "no-liftoff") {
    const e = events.find((x) => x.kind === "no-liftoff")!;
    lines.push(
      `The vehicle never left the pad. Sea-level thrust is ${pct(e.value ?? 0)} of its weight; it needs more than 100%.`,
    );
    lines.push("Fewer tanks, a lighter structure, or more thrust at sea level.");
    return lines.join("\n");
  }

  if (result.outcome === "apogee") lines.push(`Apogee ${km(summary.apogee)} at ${tPlus(summary.apogeeTime)}.`);
  else if (result.outcome === "impact") lines.push("The vehicle came back down before reaching apogee.");
  else lines.push("The flight was still going when the simulation stopped.");

  const limit = vehicle.limits.maxDynamicPressure;
  const q = summary.maxQ;
  const share = q.value / limit;
  lines.push(
    `Max-q ${kPa(q.value)} at ${tPlus(q.t)}, ${km(q.altitude)}, Mach ${q.mach.toFixed(2)}: ${pct(share)} of the ${kPa(limit)} load budget.`,
  );
  if (share > 1) {
    lines.push(
      "  The stack flew through air thicker than the structure was built for. Lower thrust through the transonic band, a slimmer fairing, or a stronger airframe.",
    );
  }

  const { gravity, drag, backPressure } = summary.losses;
  const ideal = summary.idealDeltaV;
  lines.push("");
  lines.push("Δv budget during powered flight:");
  lines.push(`  Delivered by engines (vacuum)  ${ms(ideal).padStart(9)}`);
  lines.push(`  Lost to gravity                ${ms(-gravity).padStart(9)}  ${pct(gravity / ideal).padStart(4)}`);
  lines.push(`  Lost to drag                   ${ms(-drag).padStart(9)}  ${pct(drag / ideal).padStart(4)}`);
  lines.push(`  Lost to back-pressure          ${ms(-backPressure).padStart(9)}  ${pct(backPressure / ideal).padStart(4)}`);
  lines.push(`  Velocity at burnout            ${ms(summary.burnoutVelocity).padStart(9)}`);

  const notes: string[] = [];
  if (drag / ideal > 0.12) {
    notes.push(
      `Drag took ${pct(drag / ideal)} of the Δv. The vehicle spent the ascent fighting the air instead of climbing. The frontal area or the transonic drag rise is the place to look.`,
    );
  }
  if (backPressure / ideal > 0.12) {
    notes.push(
      `Back-pressure took ${pct(backPressure / ideal)}. The nozzle exit is large for the air it fires into, so the atmosphere pushes back on it at low altitude.`,
    );
  }
  if (events.some((e) => e.kind === "flow-separation")) {
    notes.push(
      "The nozzle is over-expanded at ignition: exhaust pressure is below 40% of ambient, so the flow peels off the bell wall. Separated flow is lopsided and loads the nozzle sideways. A test-stand firing at sea level would show it.",
    );
  }
  if (events.some((e) => e.kind === "accel-limit-exceeded")) {
    notes.push(
      `Axial acceleration passed the ${vehicle.limits.maxAcceleration} g limit near burnout, as the tanks emptied and thrust stayed the same. Throttle down late in the burn or carry a heavier payload.`,
    );
  }
  if (notes.length > 0) {
    lines.push("");
    lines.push("Notes:");
    for (const n of notes) lines.push(`  - ${n}`);
  }

  lines.push("");
  lines.push("Timeline:");
  for (const e of events) lines.push(eventLine(e, vehicle));
  return lines.join("\n");
}
