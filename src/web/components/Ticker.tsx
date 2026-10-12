import { useEffect, useState } from "react";
import { useDelta, useTween } from "../motion.ts";

/** How long a change stays beside its figure, ms. */
const DELTA_MS = 2400;

/**
 * A figure in the top bar that counts to its new value, with the change
 * beside it for a moment: green when it went the good way, red when not.
 */
export function Ticker({ value, format, delta, className, ms }: { value: number; format: (v: number) => string; delta?: (d: number) => string; className?: string; ms?: number }) {
  const shown = useTween(value, ms);
  const change = useDelta(value);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (change.key === 0) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), DELTA_MS);
    return () => clearTimeout(timer);
  }, [change.key]);
  return (
    <>
      <span className={className}>{format(shown)}</span>
      {delta && visible && (
        <span key={change.key} className={`delta ${change.delta > 0 ? "good" : "bad"}`} aria-hidden="true">
          {delta(change.delta)}
        </span>
      )}
    </>
  );
}
