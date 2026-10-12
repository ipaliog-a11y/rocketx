import { useEffect, useRef, useState } from "react";

/**
 * Motion that JavaScript drives. The stylesheet's reduced-motion rule only
 * reaches CSS animations, so anything animated from script asks here first.
 */

const query = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

/** Whether the player has asked their system for less motion. */
export function reducedMotion(): boolean {
  return query?.matches ?? false;
}

const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

/** A number that eases from where it was to where it is now, instead of jumping. */
export function useTween(value: number, ms = 600): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const current = useRef(value);
  current.current = shown;
  useEffect(() => {
    if (reducedMotion() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = current.current;
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      setShown(start + (value - start) * easeOut(k));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    from.current = value;
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

/** The last change to a value, with a key that changes each time, so a "+$1.2M" can appear and fade. */
export function useDelta(value: number): { delta: number; key: number } {
  const last = useRef(value);
  const [change, setChange] = useState({ delta: 0, key: 0 });
  useEffect(() => {
    const delta = value - last.current;
    last.current = value;
    if (delta !== 0) setChange((c) => ({ delta, key: c.key + 1 }));
  }, [value]);
  return change;
}

/** Wait, unless the player wants less motion. */
export function after(ms: number, run: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(run, reducedMotion() ? 0 : ms);
}

/** A value that stays where it was while `hold` is on: the top bar keeps a launch's result back until its debrief. */
export function useHold<T>(value: T, hold: boolean): T {
  const kept = useRef(value);
  if (!hold) kept.current = value;
  return kept.current;
}
