import { useEffect } from "react";
import { game, type Milestone } from "../game.ts";
import { Icon } from "./Icon.tsx";

/** A big thing done: a banner that lands, holds for a few seconds, and goes. */
export function MilestoneBanner({ milestone }: { milestone: Milestone }) {
  useEffect(() => {
    const timer = setTimeout(() => game.dismissMilestone(milestone.id), 5000);
    return () => clearTimeout(timer);
  }, [milestone.id]);
  return (
    <div className="milestone" role="status" aria-live="polite">
      <button type="button" className="milestone-card" onClick={() => game.dismissMilestone(milestone.id)} aria-label={`${milestone.title}. ${milestone.text} Dismiss`}>
        <span className="milestone-icon">
          <Icon name={milestone.icon} />
        </span>
        <span className="milestone-words">
          <span className="label">Milestone</span>
          <strong>{milestone.title}</strong>
          <span className="soft">{milestone.text}</span>
        </span>
      </button>
    </div>
  );
}
