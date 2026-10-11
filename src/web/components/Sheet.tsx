import { useEffect, useRef, type ReactNode } from "react";
import { useNarrow } from "../narrow.ts";

/**
 * A detail panel. On a wide screen it sits beside its list, as it always
 * did. On a phone it opens over everything as a full-screen sheet with a
 * Back button, only once something has been picked, and the phone's own
 * back gesture closes it.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const narrow = useNarrow();
  const active = narrow && open;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!active) return;
    // A history entry of our own, so the back gesture closes the sheet instead of leaving the game.
    history.pushState({ sheet: true }, "");
    const onPop = () => close.current();
    window.addEventListener("popstate", onPop);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = scroll;
    };
  }, [active]);

  if (!narrow) return <>{children}</>;
  if (!open) return null;
  const back = () => (history.state?.sheet ? history.back() : close.current());
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-head">
        <button type="button" className="btn" onClick={back}>
          ← Back
        </button>
        <span className="sheet-title">{title}</span>
      </div>
      <div className="sheet-body">{children}</div>
    </div>
  );
}
