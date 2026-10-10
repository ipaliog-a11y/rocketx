/** Drag coefficient against Mach number, as [mach, cd] points sorted by Mach. */
export type DragCurve = ReadonlyArray<readonly [number, number]>;

/**
 * A slender rocket with a reasonable ogive fairing. Flat subsonic, a sharp
 * transonic rise that peaks just past Mach 1, then a slow supersonic decay.
 * The transonic hump is where a fat fairing gets punished.
 */
export const SLENDER_ROCKET: DragCurve = [
  [0, 0.3],
  [0.6, 0.3],
  [0.8, 0.34],
  [0.95, 0.45],
  [1.05, 0.55],
  [1.2, 0.54],
  [1.5, 0.47],
  [2, 0.4],
  [3, 0.32],
  [5, 0.26],
  [10, 0.22],
];

/** Linear interpolation on the curve, clamped at both ends. */
export function dragCoefficient(curve: DragCurve, mach: number): number {
  const first = curve[0]!;
  if (mach <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const [m1, c1] = curve[i]!;
    if (mach <= m1) {
      const [m0, c0] = curve[i - 1]!;
      return c0 + ((c1 - c0) * (mach - m0)) / (m1 - m0);
    }
  }
  return curve[curve.length - 1]![1];
}

/** Dynamic pressure q = ½ρv², Pa. */
export function dynamicPressure(density: number, speed: number): number {
  return 0.5 * density * speed * speed;
}

/** Frontal reference area of a cylinder of the given diameter, m². */
export function referenceArea(diameter: number): number {
  return (Math.PI * diameter * diameter) / 4;
}
