import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Company } from "../../sim/company.ts";
import { GLOSSARY } from "../glossary.ts";
import { Tabs } from "./Bits.tsx";
import { GuideSteps } from "./FirstRun.tsx";
import { Icon } from "./Icon.tsx";

type HelpTab = "start" | "glossary";
type HelpState = { open: boolean; tab: HelpTab; term?: string };

let help: HelpState = { open: false, tab: "start" };
const listeners = new Set<() => void>();
const set = (next: HelpState) => {
  help = next;
  for (const l of listeners) l();
};

/** Open Help, on the guide or on the glossary at a term. */
export function openHelp(tab: HelpTab, term?: string): void {
  set({ open: true, tab, term });
}

function useHelp(): HelpState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => help,
  );
}

/** The ? in the top bar. */
export function HelpButton() {
  return (
    <button type="button" className="btn quiet help-btn" aria-label="Help: getting started and glossary" title="Help" onClick={() => openHelp("start")}>
      <Icon name="info" />
      <span className="help-long">Help</span>
    </button>
  );
}

/** Getting started and the glossary, over whatever is on screen. */
export function HelpDialog({ company }: { company: Company }) {
  const state = useHelp();
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDListElement>(null);

  useEffect(() => {
    if (!state.open) return;
    setQuery("");
    const key = (e: KeyboardEvent) => e.key === "Escape" && set({ ...help, open: false });
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [state.open]);

  // Opened on a term: bring it into view.
  useEffect(() => {
    if (state.open && state.tab === "glossary" && state.term) list.current?.querySelector(`#term-${state.term}`)?.scrollIntoView({ block: "center" });
  }, [state.open, state.tab, state.term]);

  if (!state.open) return null;
  const close = () => set({ ...help, open: false });
  const q = query.trim().toLowerCase();
  const terms = GLOSSARY.filter((e) => !q || e.term.toLowerCase().includes(q) || e.text.toLowerCase().includes(q));

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Help" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="card help">
        <div className="help-head">
          <h2>Help</h2>
          <button type="button" className="btn quiet" onClick={close} aria-label="Close help">
            Close
          </button>
        </div>
        <Tabs<HelpTab>
          label="Help sections"
          value={state.tab}
          onChange={(tab) => set({ ...help, tab, term: undefined })}
          tabs={[
            ["start", "Getting started"],
            ["glossary", "Glossary"],
          ]}
        />
        {state.tab === "start" ? (
          <div className="stack">
            <span className="soft">
              You run a launch company. Contracts pay for payloads delivered; rockets are built from engines with hidden flaws. Test what you'll fly, sign what you can deliver, then fly it.
            </span>
            <GuideSteps company={company} after={close} />
            <span className="muted" style={{ fontSize: 14 }}>
              Home › Today lists what needs you next. Not sure what to build? “Suggest a rocket” on any contract opens the sizing guide (Rockets › Drawing board) on that job. Tap an <span className="info static">i</span> beside a title for what a page is for, and an underlined term for what it means.
            </span>
          </div>
        ) : (
          <div className="stack">
            <label className="stack" style={{ gap: 4 }}>
              <span className="sr-only">Search the glossary</span>
              <input type="search" className="help-search" placeholder="Search terms" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </label>
            <dl className="glossary" ref={list}>
              {terms.map((e) => (
                <div key={e.id} id={`term-${e.id}`} className={e.id === state.term ? "on" : ""}>
                  <dt>{e.term}</dt>
                  <dd>{e.text}</dd>
                </div>
              ))}
              {terms.length === 0 && <span className="muted">No term matches “{query}”.</span>}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
