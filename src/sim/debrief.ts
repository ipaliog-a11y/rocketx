import type { FlightEvent, FlightResult } from "./ascent.ts";
import { R_EARTH } from "./constants.ts";
import { aeroShape } from "./airframe.ts";
import { FAILURE_LABELS, type FailureMode } from "./hardware.ts";
import { EARTH_ROTATION, type Mission } from "./mission.ts";
import type { Campaign } from "./teststand.ts";
import { ATMOSPHERE_TOP } from "./atmosphere.ts";
import { SHORT_LIVED_PERIAPSIS } from "./orbit.ts";
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
const kPaDeg = (x: number) => `${(x / 1000).toFixed(1)} kPa·deg`;
const sign = (x: number) => (x >= 0 ? "+" : "−");
const signedKm = (m: number) => `${sign(m)}${km(Math.abs(m))}`;
const signedDeg = (d: number) => `${sign(d)}${Math.abs(d).toFixed(2)}°`;
const latitude = (lat: number) => `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"}`;

function eventLine(e: FlightEvent, vehicle: Vehicle): string {
  const mach = e.altitude < ATMOSPHERE_TOP ? `M${e.mach.toFixed(2)}` : "";
  const at = `${tPlus(e.t).padEnd(10)}  ${km(e.altitude).padStart(8)}  ${ms(e.velocity).padStart(9)}  ${mach.padEnd(6)}`;
  const stage = vehicle.stages[e.stage]?.name ?? "";
  const label: Record<FlightEvent["kind"], string> = {
    ignition: `Ignition, ${stage}`,
    liftoff: `Liftoff, T/W ${e.value?.toFixed(2)}`,
    "no-liftoff": `Held on the pad, T/W ${e.value?.toFixed(2)}`,
    "flow-separation": `Nozzle flow separating at ${kPa(e.value ?? 0)} ambient`,
    "pitch-kick": `Pitch kick, ${e.value ?? 0}°`,
    "mach-1": "Mach 1",
    "max-q": `Max-q ${kPa(e.value ?? 0)}`,
    "q-limit-exceeded": `Load budget exceeded, q ${kPa(e.value ?? 0)}`,
    "q-alpha-limit-exceeded": `Side-load budget exceeded, q·α ${kPaDeg(e.value ?? 0)}`,
    "accel-limit-exceeded": `Acceleration limit exceeded, ${e.value?.toFixed(1)} g`,
    meco: `Engine cutoff, ${stage}`,
    "structural-failure": `Structural failure: ${e.mode ? FAILURE_LABELS[e.mode] : ""}, load ${kPa(e.value ?? 0)}`,
    "engine-failure": `Engine failure: ${e.mode ? FAILURE_LABELS[e.mode] : ""}, ${vehicle.stages[e.stage]?.engine.name ?? ""}`,
    cutoff: `Guidance cutoff on target energy, ${Math.round(e.value ?? 0)} kg propellant left`,
    staging: `Stage separation, ${stage} ignites`,
    orbit: "Orbit insertion",
    apogee: "Apogee",
    impact: "Ground impact",
    timeout: "Simulation time limit",
  };
  return `  ${at}  ${label[e.kind]}`;
}

/**
 * `campaign`, when given, is what the stand had learned before this flight,
 * so a failure can be traced to the firing that would have caught it.
 */
export function debrief(result: FlightResult, vehicle: Vehicle, mission: Mission, campaign?: Campaign): string {
  const { summary, events } = result;
  const lines: string[] = [];
  lines.push(`DEBRIEF: ${vehicle.name}`);
  lines.push(
    `${mission.name}, from ${mission.site.name} (${latitude(mission.site.latitude)})` +
      (mission.target ? `, azimuth ${summary.azimuth.toFixed(1)}°, inclination ${summary.inclination.toFixed(1)}°.` : "."),
  );
  if (Math.abs(summary.rotationBoost) >= 1) {
    lines.push(
      summary.rotationBoost > 0
        ? `The Earth's spin gave the vehicle ${ms(summary.rotationBoost)} along its track before it left the pad.`
        : `This track runs against the Earth's spin: the vehicle starts ${ms(-summary.rotationBoost)} in the wrong direction and has to cancel it.`,
    );
  }
  lines.push("");

  if (result.outcome === "no-liftoff") {
    const e = events.find((x) => x.kind === "no-liftoff")!;
    lines.push(
      `The vehicle never left the pad. Sea-level thrust is ${pct(e.value ?? 0)} of its weight; it needs more than 100%.`,
    );
    lines.push("Fewer tanks, a lighter structure, or more thrust at sea level.");
    return lines.join("\n");
  }

  if (result.outcome === "failure") {
    failureLines(result, vehicle, campaign, lines);
    lines.push("");
  }

  const steered = (vehicle.pitchProgram?.kind ?? "vertical") !== "vertical";
  const orbit = summary.orbit;
  if (result.outcome === "orbit" && orbit) {
    lines.push(
      `Orbit ${km(orbit.periapsis)} × ${km(orbit.apoapsis)}, eccentricity ${orbit.eccentricity.toFixed(3)}. Inserted at ${tPlus(summary.burnoutTime)}, ${km(summary.burnoutDownrange)} downrange.`,
    );
    if (orbit.periapsis < SHORT_LIVED_PERIAPSIS) {
      lines.push("  Periapsis is low enough that air drag will bring the payload down within days.");
    }
  } else if (result.outcome === "apogee" || result.outcome === "impact") {
    lines.push(
      result.outcome === "apogee"
        ? `Apogee ${km(summary.apogee)} at ${tPlus(summary.apogeeTime)}.`
        : "The vehicle came back down without climbing any further after shutdown.",
    );
    if (steered && orbit) {
      const short = orbit.circularSpeed - summary.burnoutVelocity;
      const fpa = summary.burnoutFlightPathAngle;
      const at = `Short of orbit. Burnout at ${km(summary.burnoutAltitude)}, ${ms(summary.burnoutVelocity)}, flight path ${Math.abs(fpa).toFixed(1)}° ${fpa >= 0 ? "above" : "below"} the horizon.`;
      lines.push(
        short > 0
          ? `${at} A circular orbit at that height needs ${ms(orbit.circularSpeed)} flying level, so about ${ms(short)} more.`
          : `${at} That is fast enough for orbit at that height, but the path dips to a periapsis of ${km(orbit.periapsis)}, inside the atmosphere.`,
      );
    }
  } else if (result.outcome === "timeout") lines.push("The flight was still going when the simulation stopped.");

  if (summary.insertion) insertionLines(result, vehicle, mission, lines);
  lines.push("");

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

  if (steered) {
    const qa = summary.maxQAlpha;
    const qaLimit = vehicle.limits.maxQAlpha;
    const budget = qaLimit === undefined ? "" : `: ${pct(qa.value / qaLimit)} of the ${kPaDeg(qaLimit)} side-load budget`;
    lines.push(`Peak q·α ${kPaDeg(qa.value)} at ${tPlus(qa.t)}, ${km(qa.altitude)}, Mach ${qa.mach.toFixed(2)}${budget}.`);
  }

  const { gravity, drag, backPressure, steering } = summary.losses;
  const ideal = summary.idealDeltaV;
  lines.push("");
  lines.push("Δv budget during powered flight:");
  lines.push(`  Delivered by engines (vacuum)  ${ms(ideal).padStart(9)}`);
  lines.push(`  Lost to gravity                ${ms(-gravity).padStart(9)}  ${pct(gravity / ideal).padStart(4)}`);
  lines.push(`  Lost to drag                   ${ms(-drag).padStart(9)}  ${pct(drag / ideal).padStart(4)}`);
  lines.push(`  Lost to back-pressure          ${ms(-backPressure).padStart(9)}  ${pct(backPressure / ideal).padStart(4)}`);
  if (steered) {
    lines.push(`  Lost to steering               ${ms(-steering).padStart(9)}  ${pct(steering / ideal).padStart(4)}`);
  }
  lines.push(`  Ground speed at shutdown       ${ms(summary.burnoutGroundSpeed).padStart(9)}`);
  lines.push(`  Inertial speed at shutdown     ${ms(summary.burnoutVelocity).padStart(9)}`);

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
  if (steered && gravity / ideal > 0.2) {
    notes.push(
      `Gravity took ${pct(gravity / ideal)}. The climb stayed steep for too long, so the engines spent their burn holding the vehicle up instead of building horizontal speed. A firmer pitch kick turns over sooner.`,
    );
  }
  if (steering / ideal > 0.04) {
    notes.push(
      `Steering took ${pct(steering / ideal)}. Thrust pointed well away from the direction of travel, so part of every newton went into bending the path. The pitch programme is fighting the trajectory the previous stage left behind.`,
    );
  }
  if (events.some((e) => e.kind === "q-alpha-limit-exceeded")) {
    const qaLimit = vehicle.limits.maxQAlpha ?? 0;
    notes.push(
      `The vehicle turned while the air was still thick. q·α peaked at ${pct(summary.maxQAlpha.value / qaLimit)} of the side-load budget, and the airframe takes that as bending. Kick earlier and gentler, before dynamic pressure builds.`,
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

function insertionLines(result: FlightResult, vehicle: Vehicle, mission: Mission, lines: string[]): void {
  const { summary, events } = result;
  const ins = summary.insertion!;
  const target = ins.target;
  const tol = target.tolerance;
  lines.push("");
  lines.push(
    `Target ${km(target.periapsis)} × ${km(target.apoapsis)} at ${target.inclination.toFixed(1)}° (±${km(tol.altitude)}, ±${tol.inclination}°): ${ins.inSpec ? "IN SPEC" : "OUT OF SPEC"}.`,
  );
  if (ins.reachedOrbit) {
    lines.push(
      `  Periapsis ${signedKm(ins.periapsisError)}, apoapsis ${signedKm(ins.apoapsisError)}, inclination ${signedDeg(ins.inclinationError)}.`,
    );
  }

  const last = vehicle.stages[vehicle.stages.length - 1]!;
  if (events.some((e) => e.kind === "cutoff")) {
    lines.push(
      `  Guidance cut off with ${Math.round(summary.propellantMargin)} kg of propellant left in the ${last.name}, ${pct(summary.propellantMargin / last.propellantMass)} of its load.`,
    );
  } else if (summary.burnoutTime > 0) {
    lines.push("  The last stage burned to depletion before the orbit had the target's energy.");
    const dueEast = EARTH_ROTATION * R_EARTH * Math.cos((mission.site.latitude * Math.PI) / 180);
    if (summary.rotationBoost < dueEast - 50) {
      lines.push(
        `  This inclination gets ${ms(summary.rotationBoost)} from the Earth's spin. Due east from ${mission.site.name} gets ${ms(dueEast)}. The difference has to come out of the propellant.`,
      );
    }
  }
  if (ins.inSpec) return;

  const site = mission.site;
  if (Math.abs(ins.inclinationError) > tol.inclination && target.inclination < Math.abs(site.latitude)) {
    lines.push(
      `  ${site.name} sits at ${latitude(site.latitude)}, and no launch from there goes directly into an orbit inclined less than that. ${target.inclination.toFixed(1)}° needs a plane change in orbit or a pad nearer the equator.`,
    );
  }

  const shapeOff = Math.abs(ins.periapsisError) > tol.altitude || Math.abs(ins.apoapsisError) > tol.altitude;
  if (ins.reachedOrbit && shapeOff) {
    const fpa = summary.burnoutFlightPathAngle;
    const at = `Cutoff came at ${km(summary.burnoutAltitude)}`;
    if (Math.abs(fpa) > 1) {
      lines.push(
        `  ${at} while still ${fpa > 0 ? "climbing" : "descending"} at ${Math.abs(fpa).toFixed(1)}°, so the right energy went into an ellipse. The upper-stage pitch ramp should bring the vehicle level by cutoff.`,
      );
    } else if (summary.burnoutAltitude < target.periapsis) {
      lines.push(
        `  ${at}, below the target, so the right energy went into an ellipse: low periapsis, high apoapsis. The pitch programme needs to carry the vehicle higher before levelling out.`,
      );
    } else {
      lines.push(
        `  ${at}, above the target, so the orbit sags below it on the far side. The pitch programme levels out too high.`,
      );
    }
  }
}

const IN_FLIGHT: Record<Exclude<FailureMode, "flow-separation" | "transonic-buffet">, (engine: string, after: string) => string> = {
  "hard-start": (engine) => `hard start. The ${engine} chamber cracked as it lit.`,
  "combustion-instability": (engine, after) =>
    `combustion instability ${after} into the ${engine} burn. The pressure oscillation shook the stage apart.`,
  "burn-through": (engine, after) =>
    `chamber burn-through ${after} into the ${engine} burn. The jet through the liner cut into the stage.`,
};

function failureLines(result: FlightResult, vehicle: Vehicle, campaign: Campaign | undefined, lines: string[]): void {
  const structural = result.events.find((x) => x.kind === "structural-failure");
  if (structural) {
    buffetLines(structural, vehicle, campaign, lines);
    return;
  }
  const e = result.events.find((x) => x.kind === "engine-failure");
  if (!e?.mode || e.mode === "flow-separation" || e.mode === "transonic-buffet") return;
  const stage = vehicle.stages[e.stage]!;
  const engine = stage.engine.name;
  const ignition = result.events.filter((x) => x.kind === "ignition" && x.stage === e.stage)[0];
  const into = e.t - (ignition?.t ?? 0);
  const after = `${into.toFixed(1)} s`;
  lines.push(`Vehicle lost at ${tPlus(e.t)}, ${km(e.altitude)}: ${IN_FLIGHT[e.mode](engine, after)}`);

  if (!campaign) return;
  const known = campaign.knowledge[engine];
  if (!known || known.firings === 0) {
    lines.push(
      e.mode === "hard-start"
        ? `  ${engine} was never fired on the stand. Any firing would have shown the hard start.`
        : `  ${engine} was never fired on the stand. A ${Math.ceil(into)} s firing would have found this.`,
    );
  } else if (known.open.includes(e.mode)) {
    lines.push(`  The stand had already seen this on ${engine}. It flew unfixed.`);
  } else if (e.mode === "hard-start") {
    lines.push(`  No firing of the current ${engine} hardware got past ignition.`);
  } else {
    lines.push(
      `  The longest clean firing of the current ${engine} hardware was ${known.provenDuration.toFixed(1)} s. The flight needed it to run past ${after}.`,
    );
  }
}

function buffetLines(e: FlightEvent, vehicle: Vehicle, campaign: Campaign | undefined, lines: string[]): void {
  const shape = aeroShape(vehicle);
  lines.push(
    `Vehicle lost at ${tPlus(e.t)}, ${km(e.altitude)}, Mach ${e.mach.toFixed(2)}: transonic buffet. The shock on the fairing shoulder oscillated and drove the unsteady load past the ${kPa(vehicle.limits.maxDynamicPressure)} the structure was built for.`,
  );
  if (!campaign) return;
  const known = campaign.aeroKnowledge[shape.key];
  if (known?.open.includes("transonic-buffet")) {
    lines.push(`  The transonic tunnel had already seen buffet on the ${shape.label}. It flew unfixed.`);
  } else if (!known || known.runs === 0) {
    lines.push(`  The ${shape.label} was never tested. A transonic tunnel run would have shown the buffet.`);
  } else if (known.transonicRise === null) {
    const only = known.dragSource === "cfd" ? "It only saw CFD, which averages over moving shocks. " : "";
    lines.push(`  The ${shape.label} never went through the transonic tunnel. ${only}A transonic run would have shown the buffet.`);
  }
}
