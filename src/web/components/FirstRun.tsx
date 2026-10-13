import { useState } from "react";
import type { Company } from "../../sim/company.ts";
import { useGo, type Route } from "../nav.ts";
import { Icon } from "./Icon.tsx";

/** The three things a new company does first, each ticked off by what the company has done. */
export function guideSteps(company: Company): Array<{ title: string; why: string; done: boolean; route: Route; action: string }> {
  const fired = Object.values(company.campaign.knowledge).some((k) => k.firings > 0);
  const flown = company.flights.length > 0;
  return [
    {
      title: "Fire an engine on the stand",
      why: "Every engine has hidden flaws, and every flaw has a test that would find it. A firing is cheap next to a lost rocket.",
      done: fired,
      route: { place: "testing" },
      action: "Testing",
    },
    {
      title: "Sign a contract",
      why: "Contracts pay on delivery. Start with a sounding flight: up past 100 km and back, on a rocket you already have.",
      done: company.accepted.length > 0 || flown,
      route: { place: "contracts" },
      action: "Contracts",
    },
    {
      title: "Build it and fly it",
      why: "Order a rocket, then launch it from the Launch page before the deadline. Each flight's telemetry teaches what it reached.",
      done: flown,
      route: { place: "launch" },
      action: "Launch",
    },
  ];
}

const key = (company: Company) => `rocketx.guide.hidden.${company.seed}.${company.name}`;

function hidden(company: Company): boolean {
  try {
    return localStorage.getItem(key(company)) === "1";
  } catch {
    return false;
  }
}

/** The steps as a list, with a link to each place. */
export function GuideSteps({ company, after }: { company: Company; after?: () => void }) {
  const go = useGo();
  return (
    <ol className="guide-steps">
      {guideSteps(company).map((s, i) => (
        <li key={s.title} className={s.done ? "done" : ""}>
          <span className="guide-mark" aria-hidden="true">
            {s.done ? <Icon name="check" size="sm" /> : i + 1}
          </span>
          <span className="guide-words">
            <strong>
              {s.title}
              {s.done && <span className="sr-only"> (done)</span>}
            </strong>
            <span className="muted">{s.why}</span>
          </span>
          {!s.done && (
            <button type="button" className="btn quiet" onClick={() => (after?.(), go(s.route))}>
              {s.action}
              <Icon name="next" size="sm" />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

/** A new company's first steps, at the top of Home until they're done or put away. */
export function FirstRun({ company }: { company: Company }) {
  const [gone, setGone] = useState(() => hidden(company));
  const steps = guideSteps(company);
  if (gone || steps.every((s) => s.done)) return null;
  const hide = () => {
    try {
      localStorage.setItem(key(company), "1");
    } catch {
      // Storage can be blocked: it just shows again next time.
    }
    setGone(true);
  };
  return (
    <section className="card first-run" aria-labelledby="first-run">
      <div className="first-run-head">
        <p className="label" id="first-run">
          Getting started · {steps.filter((s) => s.done).length} of {steps.length}
        </p>
        <button type="button" className="btn quiet" onClick={hide}>
          Hide
        </button>
      </div>
      <GuideSteps company={company} />
      <span className="muted" style={{ fontSize: 13 }}>
        The ? in the top bar brings this back, with a glossary of the terms.
      </span>
    </section>
  );
}
