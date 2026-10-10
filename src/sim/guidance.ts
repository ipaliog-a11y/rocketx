/**
 * Pitch programmes. Pitch is the thrust direction measured up from the
 * local horizon: 90° is straight up, 0° is flat along the ground track.
 *
 * The player designs the programme; nobody flies the rocket. A programme
 * that is too timid wastes Δv climbing straight up. One that is too
 * aggressive turns over in thick air and loads the airframe sideways.
 */
export type PitchProgram =
  /** Straight up the whole flight. A sounding rocket. */
  | { kind: "vertical" }
  /**
   * Rise vertically to `kickSpeed`, tip over by `kickAngle` degrees across
   * `kickDuration` seconds, hold that pitch until the velocity vector
   * catches up, then fly prograde so gravity does the turning.
   *
   * Prograde alone rarely ends level at the right height. `upperStage`
   * hands the stages above the booster a pitch ramp instead: linear from
   * `startPitch` at ignition to `endPitch` at burnout, in degrees.
   */
  | {
      kind: "gravity-turn";
      kickSpeed: number;
      kickAngle: number;
      kickDuration: number;
      upperStage?: { startPitch: number; endPitch: number };
    }
  /** Pitch in degrees against flight time, as [t, pitch] points. Holds the last value. */
  | { kind: "schedule"; points: ReadonlyArray<readonly [number, number]> };

export const VERTICAL: PitchProgram = { kind: "vertical" };

const DEG = Math.PI / 180;

export type GuidanceInput = {
  t: number;
  /** Time the pitch kick started, or null before it. */
  kickStart: number | null;
  /** Current flight-path angle above the horizon, rad. */
  flightPathAngle: number;
  /** Index of the burning stage, bottom stage 0. */
  stage: number;
  /** Share of the current stage's propellant already burned, 0–1. */
  stageBurnFraction: number;
};

/** Commanded pitch above the local horizon, rad. */
export function commandedPitch(program: PitchProgram, input: GuidanceInput): number {
  switch (program.kind) {
    case "vertical":
      return 90 * DEG;
    case "gravity-turn": {
      const ramp = program.upperStage;
      if (ramp && input.stage > 0) {
        return (ramp.startPitch + (ramp.endPitch - ramp.startPitch) * input.stageBurnFraction) * DEG;
      }
      if (input.kickStart === null) return 90 * DEG;
      const held = (90 - program.kickAngle) * DEG;
      const into = input.t - input.kickStart;
      if (into < program.kickDuration) return (90 - (program.kickAngle * into) / program.kickDuration) * DEG;
      return Math.min(held, input.flightPathAngle);
    }
    case "schedule":
      return interpolate(program.points, input.t) * DEG;
  }
}

/** True once the vehicle is fast enough for a gravity turn's kick to begin. */
export function kickDue(program: PitchProgram, speed: number): boolean {
  return program.kind === "gravity-turn" && speed >= program.kickSpeed;
}

function interpolate(points: ReadonlyArray<readonly [number, number]>, t: number): number {
  const first = points[0];
  if (!first) return 90;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < points.length; i++) {
    const [t1, p1] = points[i]!;
    if (t <= t1) {
      const [t0, p0] = points[i - 1]!;
      return p0 + ((p1 - p0) * (t - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1]![1];
}
