import { useState } from "react";
import { dragCoefficient } from "../../sim/aero.ts";
import { aeroShape, BUFFET_BAND, dragMultiplier } from "../../sim/airframe.ts";
import type { Company } from "../../sim/company.ts";
import { COSTS } from "../../sim/cost.ts";
import { AERO_FACILITIES, BUFFET_FIX, believedAero, type AeroFacility } from "../../sim/tunnel.ts";
import { Chip } from "../components/Bits.tsx";
import { Plot, type Series } from "../components/Plot.tsx";
import { height, Rocket } from "../components/Rocket.tsx";
import { game } from "../game.ts";
import { revisionLetter } from "../../sim/teststand.ts";
import { fixAeroJob, tunnelJob } from "../jobs.ts";
import { money, pct } from "../format.ts";
import { COLORS } from "../palette.ts";
import { Term } from "../components/Info.tsx";

/** What each facility can see, in the player's words. */
const SEES: Record<AeroFacility, Array<[boolean | "partly", string]>> = {
  cfd: [["partly", "Drag, about half of the way to the truth"], [false, "The real transonic drag rise"], [false, "Buffet"]],
  subsonic: [[true, "Drag, measured properly"], [false, "The transonic drag rise"], [false, "Buffet"]],
  transonic: [[true, "Drag, measured properly"], [true, "The transonic drag rise"], [true, "Buffet, and how hard it hits"]],
};

/** The company's shapes: designs that share an outer mould line share a shape. */
function shapes(company: Company): Array<{ key: string; label: string; design: string; users: string[] }> {
  const out = new Map<string, { key: string; label: string; design: string; users: string[] }>();
  for (const [design, v] of Object.entries(company.designs)) {
    const s = aeroShape(v);
    const entry = out.get(s.key) ?? { key: s.key, label: s.label, design, users: [] };
    entry.users.push(v.name);
    out.set(s.key, entry);
  }
  return [...out.values()];
}

/** The wind tunnel: a tab of Testing. `design` opens on that design's shape. */
export function Tunnel({ company, design }: { company: Company; design?: string }) {
  const all = shapes(company);
  const wanted = design && company.designs[design] ? aeroShape(company.designs[design]!).key : undefined;
  const [selected, setSelected] = useState(wanted ?? all[all.length - 1]!.key);
  const shape = all.find((s) => s.key === selected) ?? all[0]!;
  const vehicle = company.designs[shape.design]!;
  const known = company.campaign.aeroKnowledge[shape.key];
  const believed = believedAero(company.campaign)[shape.key];
  const buffetOpen = known?.open.includes("transonic-buffet") ?? false;

  const machs = Array.from({ length: 61 }, (_, i) => i * 0.05);
  const hand: Series = { points: machs.map((m) => [m, dragCoefficient(vehicle.dragCurve, m)]), color: COLORS.muted, dash: "5 4", width: 1.5 };
  const series: Series[] = [hand];
  // A shape drawn with a geometry has a supersonic part no tunnel here
  // reaches: past Mach 1.2 the curve stays the model until a flight past
  // Mach 1.5 measures it, so that stretch is drawn dashed.
  const geometric = believed?.supersonicFactor !== undefined;
  const supersonicMeasured = known?.supersonicSource === "flight";
  if (known?.dragSource && believed) {
    const at = (m: number): [number, number] => [m, dragCoefficient(vehicle.dragCurve, m) * dragMultiplier(believed, m)];
    const style = { color: known.dragSource === "tunnel" ? COLORS.action : COLORS.data, width: known.dragSource === "tunnel" ? 3 : 2 };
    const split = geometric && !supersonicMeasured ? BUFFET_BAND[1] : Infinity;
    series.push({ points: machs.filter((m) => m <= split + 1e-9).map(at), ...style, dash: known.dragSource === "cfd" ? "6 4" : undefined });
    if (split < Infinity) series.push({ points: machs.filter((m) => m >= split - 1e-9).map(at), ...style, width: 1.5, dash: "2 4" });
  }
  const peak = Math.max(...series.flatMap((s) => s.points.map((p) => p[1])));

  return (
    <>
      <div className="row">
        <section className="side stack" aria-label="Shapes" style={{ flexBasis: 360 }}>
          {all.map((s) => {
            const k = company.campaign.aeroKnowledge[s.key];
            const on = s.key === shape.key;
            // A shape that has flown through Mach 1 and lived is as proven as a shape gets.
            const flown = company.flights.some(
              (f) => (f.outcome === "orbit" || f.outcome === "apogee") && Object.values(company.designs).some((d) => d.name === f.design && aeroShape(d).key === s.key),
            );
            const state = k?.open.includes("transonic-buffet")
              ? { text: "BUFFET OPEN", tone: "bad" as const }
              : flown && k?.transonicRise != null
                ? { text: "FLIGHT-PROVEN", tone: "good" as const }
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
                className="card pickable"
                style={{ textAlign: "left", cursor: "pointer", flexDirection: "row", alignItems: "center", gap: 16, color: "var(--text)", font: "inherit" }}
              >
                <div style={{ transform: "rotate(-90deg)", flex: "0 0 72px", width: 72, height: 72, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Rocket vehicle={company.designs[s.design]!} scale={Math.min(9, 68 / height(company.designs[s.design]!))} />
                </div>
                <span className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
                  <strong>
                    {s.label}
                    {(k?.fixed.length ?? 0) > 0 && <span className="mono muted" style={{ fontWeight: 400 }}> · {revisionLetter(k!.fixed.length)}</span>}
                  </strong>
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
                {geometric && (supersonicMeasured ? " Supersonic drag measured in flight." : " Past Mach 1.2, dotted: the model; only a flight past Mach 1.5 measures it.")}
              </span>
            </div>
            <Plot
              label={`Drag coefficient for the ${shape.label}`}
              x={{ min: 0, max: 3, ticks: [0, 0.5, 1, 1.5, 2, 2.5, 3], format: (v) => `M${v}` }}
              y={{ min: 0, max: Math.max(0.8, Math.ceil(peak * 10) / 10), ticks: [0, 0.2, 0.4, 0.6, 0.8, 1.0].filter((t) => t <= Math.max(0.8, Math.ceil(peak * 10) / 10)), format: (v) => v.toFixed(1), title: "Cd" }}
              series={series}
              bands={[
                ...(buffetOpen ? [{ from: BUFFET_BAND[0], to: BUFFET_BAND[1], color: COLORS.bad, label: "buffet band" }] : []),
                ...(geometric && !supersonicMeasured ? [{ from: 1.5, to: 3, color: COLORS.faint, label: "MODEL · FLIGHT ONLY" }] : []),
              ]}
            />
          </div>

          <dl className="ro-row ro-3" aria-label="What the company knows about this shape">
            <div className="ro">
              <dt className="lbl">Drag vs hand curve</dt>
              <dd className="val">{known?.dragFactor != null ? pct(known.dragFactor - 1) : "unknown"}</dd>
              <span className="ro-sub">
                {known?.dragSource === "cfd" ? <><Term id="cfd">CFD</Term> ESTIMATE</> : known?.dragSource === "tunnel" ? "TUNNEL MEASUREMENT" : "NEVER MEASURED"}
              </span>
            </div>
            <div className="ro">
              <dt className="lbl">
                <Term id="transonic">Transonic</Term> rise
              </dt>
              <dd className="val">{known?.transonicRise != null ? `×${known.transonicRise.toFixed(2)}` : "unknown"}</dd>
            </div>
            <div className="ro">
              <dt className="lbl">
                <Term id="buffet">Buffet</Term>
              </dt>
              <dd className={`val ${buffetOpen ? "bad" : ""}`}>{known?.buffet == null ? "unknown" : known.buffet > 0 ? `${known.buffet.toFixed(2)}× q` : "none"}</dd>
            </div>
          </dl>

          {buffetOpen && (
            <div className="card alert">
              <p className="label bad">Open · transonic buffet</p>
              <span>
                Between Mach {BUFFET_BAND[0]} and {BUFFET_BAND[1]} the shock on the fairing shoulder oscillates. If {known?.buffet?.toFixed(2)}× dynamic pressure passes the structure's budget, the vehicle breaks up. No pitch programme helps much: every ascent goes transonic low down.
              </span>
              <span>
                <strong>Fix: {BUFFET_FIX.name}.</strong> <span className="soft">They break up the oscillation and add about 3% drag. Earlier tunnel data stops counting.</span>
              </span>
              <div className="verb-group">
                <button type="button" className="btn primary" onClick={() => game.schedule(fixAeroJob(shape.design, shape.label))}>
                  Fit {BUFFET_FIX.name.toLowerCase()} <span className="note">{money(BUFFET_FIX.cost)} · {BUFFET_FIX.days} d</span>
                </button>
              </div>
            </div>
          )}

          <div className="row" style={{ gap: 16 }}>
            {(Object.keys(AERO_FACILITIES) as AeroFacility[]).map((id) => {
              const f = AERO_FACILITIES[id];
              return (
                <div key={id} className="card" style={{ flex: "1 1 240px" }}>
                  <p className="label hdr-row">
                    <span>{f.name}</span>
                    <span className="mono">
                      {money(f.cost)} · {f.days} D
                    </span>
                  </p>
                  <ul className="checklist">
                    {SEES[id].map(([sees, text]) => (
                      <li key={text}>
                        <span className={sees === true ? "good" : sees === "partly" ? "warn" : "bad"}>{sees === true ? "✓" : sees === "partly" ? "~" : "✕"}</span>
                        <span>{text}</span>
                        <span className={`mono ${sees === true ? "good" : sees === "partly" ? "warn" : "muted"}`}>{sees === true ? "SEES" : sees === "partly" ? "PARTLY" : "BLIND"}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="verb-group" style={{ marginTop: "auto" }}>
                    <button type="button" className="btn" onClick={() => game.schedule(tunnelJob(shape.design, shape.label, id))}>
                      Book <span className="note">+{money(f.days * COSTS.overheadPerDay)} payroll</span>
                    </button>
                  </div>
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
    </>
  );
}
