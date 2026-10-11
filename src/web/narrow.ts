import { useSyncExternalStore } from "react";

/** Below this width the game lays out for a phone: one column, a bottom tab bar, details as full-screen sheets, px. */
export const NARROW = 700;

const query = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(`(max-width: ${NARROW}px)`) : null;

function subscribe(listener: () => void): () => void {
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}

/** Whether the screen is phone-sized right now; follows rotation and resizing. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => query?.matches ?? false, () => false);
}
