import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { glossary } from "../glossary.ts";
import { openHelp } from "./Help.tsx";

const hoverable = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(hover: hover)").matches : false;

/** Width of a popover, px, and the gap it keeps from the screen's edges. */
const WIDTH = 320;
const EDGE = 12;

/**
 * A popover tied to a trigger: tap or click opens it, and on a desktop so
 * does hovering. Escape, a tap elsewhere, or scrolling away closes it. It
 * sits above the trigger, or below when there's no room, and never off screen.
 */
function usePopover() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Once closed, hovering doesn't reopen it until the pointer has left and come back.
  const quiet = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean; width: number } | null>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - EDGE * 2);
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - width / 2), window.innerWidth - width - EDGE);
    const height = pop.current?.offsetHeight ?? 120;
    const below = r.top < height + EDGE + 8;
    setPlace({ left, width, below, top: below ? r.bottom + 8 : r.top - height - 8 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => ((quiet.current = true), setOpen(false), setPinned(false));
    const key = (e: KeyboardEvent) => e.key === "Escape" && (close(), trigger.current?.focus());
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !pop.current?.contains(t)) close();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", close, { passive: true, capture: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const triggerProps = {
    ref: trigger,
    "aria-expanded": open,
    "aria-controls": id,
    onClick: () => (pinned ? ((quiet.current = true), setOpen(false), setPinned(false)) : (setOpen(true), setPinned(true))),
    onMouseEnter: () => hoverable && !quiet.current && setOpen(true),
    onMouseLeave: () => {
      quiet.current = false;
      if (hoverable && !pinned) setOpen(false);
    },
  };
  const render = (content: ReactNode) =>
    open
      ? createPortal(
          <div
            ref={pop}
            id={id}
            role="note"
            className={`pop ${place?.below ? "below" : ""}`}
            style={place ? { left: place.left, top: place.top, width: place.width } : { visibility: "hidden", left: 0, top: 0 }}
          >
            {content}
          </div>,
          document.body,
        )
      : null;
  return { triggerProps, render, close: () => ((quiet.current = true), setOpen(false), setPinned(false)) };
}

/** A small "i" that explains what's around it. */
export function Info({ children, label = "What's this?" }: { children: ReactNode; label?: string }) {
  const { triggerProps, render } = usePopover();
  return (
    <>
      <button type="button" className="info" aria-label={label} {...triggerProps}>
        i
      </button>
      {render(children)}
    </>
  );
}

/** A term of art, underlined: its glossary entry on tap or hover. */
export function Term({ id, children }: { id: string; children: ReactNode }) {
  const entry = glossary(id);
  const { triggerProps, render, close } = usePopover();
  return (
    <>
      <button type="button" className="term" {...triggerProps}>
        {children}
      </button>
      {render(
        <>
          <strong>{entry.term}</strong>
          <span>{entry.text}</span>
          <button type="button" className="link" onClick={() => (close(), openHelp("glossary", id))}>
            All terms →
          </button>
        </>,
      )}
    </>
  );
}
