import { useState } from "react";
import { dragCoefficient } from "../../sim/aero.ts";
import { aeroShape, BUFFET_BAND, dragMultiplier } from "../../sim/airframe.ts";
import { fixAero, tunnel, type Company } from "../../sim/company.ts";
import { COSTS } from "../../sim/cost.ts";
import { AERO_FACILITIES, BUFFET_FIX, believedAero, type AeroFacility } from "../../sim/tunnel.ts";
import { Chip } from "../components/Bits.tsx";
import { Plot, type Series } from "../components/Plot.tsx";
import { height, Rocket } from "../components/Rocket.tsx";
import { DESIGNS, game } from "../game.ts";
import { money, pct } from "../format.ts";

/** What each facility can see, in the player's words. */
const SEES: Record<AeroFacility, Array<[boolean | "partly", string]>> = {
  cfd: [["partly", "Drag, about half of the way to the truth"], [false, "The real transonic drag rise"], [false, "Buffet"]],
  subsonic: [[true, "Drag, measured properly"], [false, "The transonic drag rise"], [false, "Buffet"]],
  transonic: [[true, "Drag, measured properly"], [true, "The transonic drag rise"], [true, "Buffet, and how hard it hits"]],
};

/** The company's shapes: designs that share an outer mould line share a shape. */
function shapes(): Array<{ key: string; label: string; design: string; users: string[] }> {
  const out = new Map<string, { key: string; label: string; design: string; users: string[] }>();
  for (const [design, v] of Object.entries(DESIGNS)) {
    const s = aeroShape(v);
    const entry = out.get(s.key) ?? { key: s.key, label: s.label, design, users: [] };
    entry.users.push(v.name);
    out.set(s.key, entry);
  }
  return [...out.values()];
}

export function Tunnel({ company }: { company: Company }) {
  const all = shapes();
  const [selected, setSelected] = useState(all[all.length - 1]!.key);
  const shape = all.find((s) => s.key === selected) ?? all[0]!;
  const vehicle = DESIGNS[shape.design]!;
  const known = company.campaign.aeroKnowledge[shape.key];
  const believed = believedAero(company.campaign)[shape.key];
  const buffetOpen = known?.open.includes("transonic-buffet") ?? false;

  const machs = Array.from({ length: 61 }, (_, i) => i * 0.05);
  const hand: Series = { points: machs.map((m) => [m, dragCoefficient(vehicle.dragCurve, m)]), color: "#93a0ad", dash: "5 4", width: 1.5 };
  const series: Series[] = [hand];
  if (known?.dragSource && believed) {
    series.push({
      points: machs.map((m) => [m, dragCoefficient(vehicle.dragCurve, m) * dragMultiplier(believed, m)]),
      color: known.dragSource === "tunnel" ? "#f0a43a" : "#5bb8e3",
      width: known.dragSource === "tunnel" ? 3 : 2,
      dash: known.dragSource === "cfd" ? "6 4" : undefined,
    });
  }
  const peak = Math.max(...series.flatMap((s) => s.points.map((p) => p[1])));

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Wind tunnel</h1>
        <span className="muted">One shape per outer mould line. Designs that share a shape share what the tunnel learns.</span>
      </div>
      <div className="row">
        <section className="side stack" aria-label="Shapes" style={{ flexBasis: 360 }}>
          {all.map((s) => {
            const k = company.campaign.aeroKnowledge[s.key];
            const on = s.key === shape.key;
            const state = k?.open.includes("transonic-buffet")
              ? { text: "BUFFET OPEN", tone: "bad" as const }
              : k?.transonicRise != null
                ? { text: "MEASURED", tone: "good" as const }
                : k?.dragSource
                  ? { text: "PARTLY KNOWN", tone: "warn" as const }
                  : { text: "ON PAPER", tone: "muted" as const };
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected(s.key)}
                className="card"
                style={{ textAlign: "left", cursor: "pointer", flexDirection: "row", alignItems: "center", gap: 16, borderColor: on ? "var(--amber)" : undefined, background: on ? "var(--selected)" : undefined }}
              >
                <div style={{ transform: "rotate(-90deg)", flex: "0 0 72px", width: 72, height: 72, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Rocket vehicle={DESIGNS[s.design]!} scale={Math.min(9, 68 / height(DESIGNS[s.design]!))} />
                </div>
                <span className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
                  <strong>{s.label}</strong>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {s.users.join(", ")}
                  </span>
                  <span>
                    <Chip tone={state.tone}>{state.text}</Chip>
                  </span>
                </span>
              </button>
            );
          })}
        </section>

        <section className="grow stack" aria-label={shape.label} style={{ gap: 18 }}>
          <div className="card">
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "8px 20px" }}>
              <p className="label">Drag coefficient against Mach</p>
              <span className="soft" style={{ fontSize: 14 }}>
                Dashed grey: the hand curve.{" "}
                {known?.dragSource === "tunnel" ? "Amber: measured in a tunnel." : known?.dragSource === "cfd" ? "Dashed cyan: CFD's estimate." : "Nothing measured yet."}
              </span>
            </div>
            <Plot
              label={`Drag coefficient for the ${shape.label}`}
              x={{ min: 0, max: 3, ticks: [0, 0.5, 1, 1.5, 2, 2.5, 3], format: (v) => `M${v}` }}
              y={{ min: 0, max: Math.max(0.8, Math.ceil(peak * 10) / 10), ticks: [0, 0.2, 0.4, 0.6, 0.8, 1.0].filter((t) => t <= Math.max(0.8, Math.ceil(peak * 10) / 10)), format: (v) => v.toFixed(1), title: "Cd" }}
              series={series}
              bands={buffetOpen ? [{ from: BUFFET_BAND[0], to: BUFFET_BAND[1], color: "#ef6a5e", label: "buffet band" }] : []}
            />
          </div>

          <div className="row" style={{ gap: 16 }}>
            <div className="card" style={{ flex: "1 1 180px" }}>
              <span className="muted" style={{ fontSize: 13 }}>
                Drag against the hand curve
              </span>
              <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
                {known?.dragFactor != null ? pct(known.dragFactor - 1) : "unknown"}
              </span>
              <span className="muted" style={{ fontSize: 13 }}>
                {known?.dragSource === "cfd" ? "CFD estimate" : known?.dragSource === "tunnel" ? "tunnel measurement" : "never measured"}
              </span>
            </div>
            <div className="card" style={{ flex: "1 1 180px" }}>
              <span className="muted" style={{ fontSize: 13 }}>
                Transonic rise
              </span>
              <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
                {known?.transonicRise != null ? `×${known.transonicRise.toFixed(2)}` : "unknown"}
              </span>
            </div>
            <div className={`card ${buffetOpen ? "alert" : ""}`} style={{ flex: "1 1 180px" }}>
              <span className="muted" style={{ fontSize: 13 }}>
                Buffet
              </span>
              <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
                {known?.buffet == null ? "unknown" : known.buffet > 0 ? `${known.buffet.toFixed(2)}× q` : "none"}
              </span>
            </div>
          </div>

          {buffetOpen && (
            <div className="card alert">
              <p className="label bad">Open · transonic buffet</p>
              <span>
                Between Mach {BUFFET_BAND[0]} and {BUFFET_BAND[1]} the shock on the fairing shoulder oscillates. If {known?.buffet?.toFixed(2)}× dynamic pressure passes the structure's budget, the vehicle breaks up. No pitch programme helps much: every ascent goes transonic low down.
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 20px" }}>
                <span style={{ flex: "1 1 260px" }}>
                  <strong>Fix: {BUFFET_FIX.name}.</strong> <span className="soft">They break up the oscillation and add about 3% drag. Earlier tunnel data stops counting.</span>
                </span>
                <span className="mono soft">
                  {money(BUFFET_FIX.cost)} · {BUFFET_FIX.days} days
                </span>
                <button type="button" className="btn primary" onClick={() => game.act((c) => fixAero(c, shape.design, "transonic-buffet"))}>
                  Fit them
                </button>
              </div>
            </div>
          )}

          <div className="row" style={{ gap: 16 }}>
            {(Object.keys(AERO_FACILITIES) as AeroFacility[]).map((id) => {
              const f = AERO_FACILITIES[id];
              return (
                <div key={id} className="card" style={{ flex: "1 1 240px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <strong style={{ fontSize: 18 }}>{f.name.charAt(0).toUpperCase() + f.name.slice(1)}</strong>
                    <span className="mono soft">
                      {money(f.cost)} · {f.days} d
                    </span>
                  </div>
                  <ul className="list">
                    {SEES[id].map(([sees, text]) => (
                      <li key={text}>
                        <span className={sees === true ? "good" : sees === "partly" ? "warn" : "bad"} style={{ fontWeight: 700, flex: "0 0 auto" }}>
                          {sees === true ? "✓" : sees === "partly" ? "~" : "✕"}
                        </span>
                        <span>{text}</span>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn" onClick={() => game.act((c) => tunnel(c, shape.design, id))}>
                    Book · +{money(f.days * COSTS.overheadPerDay)} payroll
                  </button>
                </div>
              );
            })}
          </div>

          {known && known.history.length > 0 && (
            <div className="card">
              <p className="label">Run log</p>
              {[...known.history].reverse().map((r, i) => (
                <pre key={i} className="report">
                  {r.text}
                </pre>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
