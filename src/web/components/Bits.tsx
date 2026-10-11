import type { ReactNode } from "react";

/** Small shared pieces: tabs, a proof bar, a chip, a fact grid. */

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<[T, string]>; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map(([id, text]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * How much of a requirement has been shown to hold: a fill to `proven` and a
 * mark at `required`, on a scale with headroom past both.
 */
export function ProofBar({ proven, required, failedAt, label }: { proven: number; required: number; failedAt?: number; label: string }) {
  const scale = Math.max(required, proven, failedAt ?? 0) * 1.15 || 1;
  return (
    <div className="bar" role="img" aria-label={label}>
      <div className="fill" style={{ width: `${(proven / scale) * 100}%`, background: "var(--cyan)" }} />
      {failedAt !== undefined && <div className="mark" style={{ left: `${(failedAt / scale) * 100}%`, background: "var(--red)" }} />}
      <div className="mark" style={{ left: `${(required / scale) * 100}%` }} />
    </div>
  );
}

export function Chip({ tone, children }: { tone?: "good" | "warn" | "bad" | "muted"; children: ReactNode }) {
  return <span className={`chip ${tone ?? ""}`}>{children}</span>;
}

export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="facts">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A stacked horizontal bar of named parts. */
export function Stack({ parts, label }: { parts: Array<{ value: number; color: string; name: string }>; label: string }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div role="img" aria-label={label} style={{ display: "flex", height: 20, borderRadius: 3, overflow: "hidden" }}>
        {parts.map((p) => (
          <div key={p.name} style={{ flex: `${p.value} 1 0`, background: p.color }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 14 }} className="soft">
        {parts.map((p) => (
          <span key={p.name}>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, marginRight: 6, background: p.color }} />
            {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}
