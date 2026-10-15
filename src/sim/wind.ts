import { hashSeed, rng } from "./random.ts";

/**
 * The wind a flight meets on the way up, along the ground track. Two parts:
 * the mean profile with its jet stream (the launch team's balloon measures
 * it on the day, so guidance flies with it) and the gusts on top, which no
 * balloon sees. Gusts are pink noise: summed octaves whose amplitude falls
 * as the square root of the wavelength shortens (power ∝ 1/f), the usual
 * shape of turbulence well above the inner scale.
 *
 * Only vehicles drawn with a control model fly in wind; the hand-drawn
 * rockets keep the still air they were tuned in.
 */

/** Profile sample spacing, m, and the height above which there's no wind worth counting. */
const STEP = 100;
const TOP = 30_000;
/** Gust wavelengths, m: six octaves from 6 km down to under 200 m. */
const OCTAVES = [6000, 3000, 1500, 750, 375, 188];

export type WindProfile = {
  /** Along-track wind at each sample, m/s, positive blowing downrange. */
  mean: number[];
  gust: number[];
  /** Jet-stream peak, for the debrief: m/s and m. */
  jet: { speed: number; altitude: number };
  /** RMS of the gusts below 15 km, m/s. */
  gustRms: number;
};

export const CALM: WindProfile = { mean: [0], gust: [0], jet: { speed: 0, altitude: 10_000 }, gustRms: 0 };

/** A day's wind from a seed. */
export function rollWind(seed: number): WindProfile {
  const r = rng(hashSeed(`${seed}:wind`));
  const jetAltitude = 9_000 + 4_000 * r();
  // Along-track part of a jet up to 45 m/s from any direction.
  const jetSpeed = 45 * r() * Math.cos(2 * Math.PI * r());
  const surface = 6 * (r() - 0.5);
  const gustRms = 0.5 + 1.5 * r();
  const phases = OCTAVES.map(() => 2 * Math.PI * r());
  const amps = OCTAVES.map((l) => Math.sqrt(l));
  const norm = Math.sqrt(amps.reduce((s, a) => s + (a * a) / 2, 0));
  const n = TOP / STEP + 1;
  const mean: number[] = [];
  const gust: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = i * STEP;
    // Gusts are strongest in the lower atmosphere and fade toward the stratosphere.
    const envelope = h < 15_000 ? 1 : Math.max(0, 1 - (h - 15_000) / 10_000);
    const g = OCTAVES.reduce((s, l, k) => s + amps[k]! * Math.sin((2 * Math.PI * h) / l + phases[k]!), 0) / norm;
    gust.push(gustRms * envelope * g);
    const fade = h < 20_000 ? 1 : Math.max(0, 1 - (h - 20_000) / 10_000);
    mean.push(fade * (surface * Math.exp(-h / 2_000) + jetSpeed * Math.exp(-(((h - jetAltitude) / 4_000) ** 2))));
  }
  return { mean, gust, jet: { speed: jetSpeed, altitude: jetAltitude }, gustRms };
}

/** Mean and gust along track at an altitude, m/s. */
export function windAt(p: WindProfile, altitude: number): { mean: number; gust: number } {
  if (altitude <= 0) return { mean: p.mean[0] ?? 0, gust: p.gust[0] ?? 0 };
  const f = altitude / STEP;
  const i = Math.floor(f);
  if (i >= p.mean.length - 1) return { mean: p.mean.at(-1) ?? 0, gust: p.gust.at(-1) ?? 0 };
  const t = f - i;
  return { mean: p.mean[i]! + (p.mean[i + 1]! - p.mean[i]!) * t, gust: p.gust[i]! + (p.gust[i + 1]! - p.gust[i]!) * t };
}

/** The flight's seed for the wind: the company's seed and which flight this is. */
export function flightWindSeed(seed: number, flight: number): number {
  return hashSeed(`${seed}:flight:${flight}`);
}
