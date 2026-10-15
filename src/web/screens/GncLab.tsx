import { useState } from "react";
import type { Company } from "../../sim/company.ts";
import { BENDING_LIMIT, designPoint, DIVERGENCE_LIMIT, IMU, IMU_RESIDUAL, type ControlModel, type GncKnowledge } from "../../sim/control.ts";
import { GNC_TEST_LABELS, gncTestBlocked, gncTestQuote, HITL_RUNS, type GncTest } from "../../sim/gncTests.ts";
import type { Vehicle } from "../../sim/vehicle.ts";
import { PanelHeader, Stamp, Verb } from "../design/kit.tsx";
import { money } from "../format.ts";
import { game } from "../game.ts";
import { gncJob } from "../jobs.ts";
import { useGo } from "../nav.ts";

/**
 * Testing › GNC lab: a guided design's attitude loop against the modes it
 * has to stay clear of, on one frequency axis, and the three tests that
 * pin them down: the modal survey, IMU calibration and hardware-in-the-loop.
 */

const TESTS: GncTest[] = ["modal", "imu-cal", "hitl"];
const REVEALS: Record<GncTest, string> = {
  modal: "Bending mode and slosh, measured. The notch retunes to the real mode.",
  "imu-cal": "The IMU's drift. The flight software takes it out.",
  hitl: `${HITL_RUNS} ascents on the bench in seeded winds. Finds and fixes gain-schedule errors.`,
};

/** Has this test been done, and what did it show, in a few words. */
function result(test: GncTest, v: Vehicle, k: GncKnowledge | undefined): string | null {
  const model = v.control!;
  if (test === "modal" && k?.bending !== undefined) return `BENDING ${(model.bendingFrequency * k.bending).toFixed(2)} HZ · SLOSH ${k.slosh?.map((g) => g.toFixed(2)).join(" / ")}`;
  if (test === "imu-cal" && k?.imuBias !== undefined) return `DRIFT ${(k.imuBias * 3600).toFixed(2)}°/H → ${(k.imuBias * 3600 * IMU_RESIDUAL).toFixed(3)}°/H`;
  if (test === "hitl" && k?.hitl?.runs) return `${k.hitl.losses} OF ${k.hitl.runs} LOST · PEAK ${Math.round(k.hitl.peakEffort * 100)}% GIMBAL${k.hitl.flaw ? " · GAIN ERROR FIXED" : ""}`;
  if (test === "hitl" && k?.hitl?.flaw) return "GAIN ERROR SEEN IN FLIGHT · NOT YET FIXED";
  return null;
}

/** The loop and the modes on a log frequency axis. */
function FrequencyStrip({ v, k }: { v: Vehicle; k: GncKnowledge | undefined }) {
  const model = v.control as ControlModel;
  const d = model.design;
  const dp = designPoint(model);
  const W = 680;
  const L = 130;
  const R = 520;
  const [f0, f1] = [0.05, 20];
  const x = (f: number) => L + ((Math.log10(Math.min(f1, Math.max(f0, f))) - Math.log10(f0)) / (Math.log10(f1) - Math.log10(f0))) * (R - L);
  const rows = ["LOOP", "AIRFRAME", "BENDING", ...model.configs.map((_, i) => `SLOSH S${i + 1}`)];
  const y = (i: number) => 36 + i * 40;
  const H = y(rows.length) + 26;
  const bendDrawn = model.bendingFrequency;
  const bendKnown = k?.bending !== undefined ? model.bendingFrequency * k.bending : null;
  const notchAt = d.notch ? (bendKnown ?? bendDrawn) : null;
  const divergeLimit = DIVERGENCE_LIMIT * d.bandwidth;
  const reach = d.bandwidth / Math.sqrt(BENDING_LIMIT);
  const bendSeen = (dp.bendingGain * (d.notch ? 0.1 : 1)) > BENDING_LIMIT;
  const slosh = model.configs.map((c) => [1.2, 4].map((g) => Math.sqrt((1.84 * g * 9.81) / c.tankRadius) / (2 * Math.PI)) as [number, number]);
  const ticks = [0.1, 0.3, 1, 3, 10];
  const summary = `Loop at ${d.bandwidth.toFixed(1)} Hz. Airframe diverges at ${dp.divergenceHz.toFixed(2)} Hz, limit ${divergeLimit.toFixed(2)} Hz. Bending mode ${bendKnown ? `measured at ${bendKnown.toFixed(2)}` : `drawn at ${bendDrawn.toFixed(2)}`} Hz${d.notch ? ", notched" : ""}. Slosh ${slosh.map(([a, b]) => `${a.toFixed(1)} to ${b.toFixed(1)}`).join(" and ")} Hz${d.baffles ? ", baffled" : ", no baffles"}.`;
  return (
    <svg className="schematic lab-strip" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} style={{ width: "100%", height: "auto" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={16} y2={H - 22} style={{ stroke: "var(--ed-grid)" }} />
          <text x={x(t)} y={H - 6} textAnchor="middle" style={{ fill: "var(--ed-muted)" }}>
            {t}
          </text>
        </g>
      ))}
      <text x={R} y={H - 6} textAnchor="end" style={{ fill: "var(--ed-muted)" }} dy={-14}>
        HZ
      </text>
      {rows.map((label, i) => (
        <text key={label} x={8} y={y(i) + 4} style={{ fill: "var(--ed-muted)", letterSpacing: "0.1em" }}>
          {label}
        </text>
      ))}
      {/* The loop's crossover, and how far its reach goes. */}
      <rect x={x(f0)} y={y(0) - 6} width={x(d.bandwidth) - x(f0)} height={12} style={{ fill: "var(--ed-line-dim)", opacity: 0.5 }} />
      <line x1={x(d.bandwidth)} x2={x(d.bandwidth)} y1={16} y2={H - 22} style={{ stroke: "var(--ed-accent)", strokeWidth: 2 }} />
      <text x={x(d.bandwidth) + 6} y={y(0) + 4} style={{ fill: "var(--ed-accent)" }}>
        {d.bandwidth.toFixed(1)}
      </text>
      {/* Airframe divergence: must sit under half the crossover. */}
      {dp.divergenceHz > 0 ? (
        <>
          <line x1={x(divergeLimit)} x2={x(divergeLimit)} y1={y(1) - 10} y2={y(1) + 10} style={{ stroke: "var(--ed-alarm)", strokeDasharray: "3 3" }} />
          <circle cx={x(dp.divergenceHz)} cy={y(1)} r={5} style={{ fill: dp.divergence > DIVERGENCE_LIMIT * 0.9 ? "var(--ed-alarm)" : "var(--ed-line)" }} />
          <text x={x(dp.divergenceHz) + 8} y={y(1) + 4} className={dp.divergence > DIVERGENCE_LIMIT * 0.9 ? "alarm" : ""} style={{ fill: dp.divergence > DIVERGENCE_LIMIT * 0.9 ? "var(--ed-alarm)" : "var(--ed-text)" }}>
            {dp.divergence > DIVERGENCE_LIMIT * 0.9 ? "▲ " : ""}
            {dp.divergenceHz.toFixed(2)}
          </text>
        </>
      ) : (
        <text x={L} y={y(1) + 4} style={{ fill: "var(--ed-muted)" }}>
          STABLE: NOTHING TO CATCH
        </text>
      )}
      {/* Bending: drawn dashed, measured solid, the notch as a box, and where the loop still reaches. */}
      <rect x={x(f0)} y={y(2) - 3} width={x(reach) - x(f0)} height={6} style={{ fill: "var(--ed-grid)" }} />
      {notchAt && <rect x={x(notchAt * 0.9)} y={y(2) - 10} width={x(notchAt * 1.1) - x(notchAt * 0.9)} height={20} style={{ fill: "none", stroke: "var(--ed-line)" }} />}
      <line x1={x(bendDrawn)} x2={x(bendDrawn)} y1={y(2) - 12} y2={y(2) + 12} style={{ stroke: "var(--ed-text)", strokeDasharray: "2 3" }} />
      {bendKnown && <line x1={x(bendKnown)} x2={x(bendKnown)} y1={y(2) - 12} y2={y(2) + 12} style={{ stroke: "var(--ed-text)", strokeWidth: 2 }} />}
      <text x={x(bendKnown ?? bendDrawn) + 8} y={y(2) + 4} style={{ fill: bendSeen ? "var(--ed-alarm)" : "var(--ed-text)" }}>
        {bendSeen ? "▲ " : ""}
        {(bendKnown ?? bendDrawn).toFixed(2)} {bendKnown ? "MEASURED" : "DRAWN"}
      </text>
      {/* Slosh: the first mode sweeps up as the stage accelerates. */}
      {slosh.map(([a, b], i) => {
        const near = !d.baffles && d.bandwidth >= a * 0.8 && d.bandwidth <= b * 1.2;
        return (
          <g key={i}>
            <rect x={x(a)} y={y(3 + i) - 5} width={Math.max(2, x(b) - x(a))} height={10} style={{ fill: d.baffles ? "var(--ed-grid)" : near ? "var(--ed-alarm)" : "var(--ed-line-dim)", opacity: near ? 0.7 : 1 }} />
            <text x={x(b) + 8} y={y(3 + i) + 4} style={{ fill: near ? "var(--ed-alarm)" : "var(--ed-muted)" }}>
              {near ? "▲ CROSSES LOOP" : d.baffles ? "BAFFLED" : "CLEAR"}
              {k?.slosh ? ` · GAIN ${k.slosh[i]?.toFixed(2)}` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function GncLab({ company, design }: { company: Company; design?: string }) {
  const go = useGo();
  const guided = Object.entries(company.designs).filter(([, v]) => v.control);
  const [sel, setSel] = useState(design && company.designs[design]?.control ? design : (guided.at(-1)?.[0] ?? null));
  const v = sel ? company.designs[sel] : undefined;

  if (!v || !v.control || !sel) {
    return (
      <section className="ed ed-lab" aria-label="GNC lab">
        <div className="ed-sheet" style={{ padding: 20, gap: 12 }}>
          <PanelHeader title="GNC LAB" id="LAB-1" />
          <span className="mono">NO GUIDED DESIGN DRAWN ON THE CONTROL MODEL YET.</span>
          <span className="muted">Draw a stack with two or more stages on Rockets › Drawing board: its attitude loop comes here to be tested.</span>
          <span>
            <Verb label="TO DRAWING BOARD" note="ROCKETS" onClick={() => go({ place: "rockets", tab: "board" })} />
          </span>
        </div>
      </section>
    );
  }

  const k = company.campaign.gncKnowledge?.[v.name];
  const d = v.control.design;
  const booked = (test: GncTest) => company.tasks.some((t) => t.spec.kind === "gnc" && t.spec.design === sel && t.spec.test === test);
  const done = TESTS.filter((t) => result(t, v, k) !== null && !(t === "hitl" && !k?.hitl?.runs));
  const notes = company.done.filter((x) => x.title.endsWith(`· ${v.name}`) && TESTS.some((t) => x.title.startsWith(GNC_TEST_LABELS[t]))).slice(-3);
  const stamp = done.length === 3 ? { text: "QUALIFIED", tone: "line" as const, sub: "LOOP TESTED" } : { text: `${done.length} OF 3`, tone: "muted" as const, sub: "TESTS DONE" };

  return (
    <section className="ed ed-lab" aria-label="GNC lab">
      <div className="ed-tree">
        <div className="head">
          <PanelHeader title="GUIDED DESIGNS" id="LAB-1" />
        </div>
        <div role="group" aria-label="Designs" style={{ display: "flex", flexDirection: "column" }}>
          {guided.map(([key, g]) => {
            const kk = company.campaign.gncKnowledge?.[g.name];
            const n = TESTS.filter((t) => result(t, g, kk) !== null && !(t === "hitl" && !kk?.hitl?.runs)).length;
            return (
              <button key={key} type="button" className="part-row" aria-pressed={key === sel} onClick={() => setSel(key)}>
                <span className="tag">GNC</span>
                <span className="name">{g.name.toUpperCase()}</span>
                <span className="st">{n}/3</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ed-sheet">
        <div className="ed-bar lbl">
          <span>{v.name.toUpperCase()} / LOOP AND MODES</span>
          <span>
            {d.bandwidth.toFixed(1)} HZ · {d.gimbal.toFixed(1)}° · {d.actuatorRate}°/S · {IMU[d.imu].label.toUpperCase()}
          </span>
        </div>
        <div style={{ padding: "12px 16px" }}>
          <FrequencyStrip v={v} k={k} />
          <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
            Amber: the loop's crossover. Red dashes: the fastest airframe divergence it can catch. Bending: dashed as drawn, solid once measured; the box is the notch. Slosh sweeps up as the stage accelerates; near the loop without baffles it rings.
          </p>
        </div>
        <div className="tb-row" style={{ gridTemplateColumns: "minmax(0,1fr) 220px" }}>
          <div className="specs" style={{ padding: "12px 16px" }}>
            {notes.length === 0 ? (
              <span className="muted mono" style={{ fontSize: 13 }}>NO GNC TESTS ON THIS DESIGN YET.</span>
            ) : (
              notes.map((n) => (
                <div key={n.id} style={{ display: "block", fontSize: 13, padding: "4px 0" }}>
                  <span className="mono muted">D-{n.day} </span>
                  {n.text}
                </div>
              ))
            )}
          </div>
          <Stamp {...stamp} />
        </div>
      </div>

      <div className="ed-strip">
        <PanelHeader title="TESTS" id={v.name.toUpperCase()} />
        {TESTS.map((t) => {
          const blocked = gncTestBlocked(t, v, company.campaign);
          const r = result(t, v, k);
          const q = gncTestQuote(t, v);
          return (
            <div key={t} style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 12, borderBottom: "1px solid var(--ed-grid)" }}>
              <div className="ed-crow" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span className="lbl" style={{ color: "var(--ed-text)" }}>
                  {GNC_TEST_LABELS[t]}
                </span>
                <span className="mono" style={{ fontSize: 12, color: r ? "var(--ed-line)" : "var(--ed-muted)" }}>
                  {r ? "● DONE" : booked(t) ? "BOOKED" : "○ NOT RUN"}
                </span>
              </div>
              <span style={{ fontSize: 13 }}>{REVEALS[t]}</span>
              {r && <span className="mono cyan" style={{ fontSize: 12 }}>{r}</span>}
              <Verb
                label={booked(t) ? "BOOKED" : blocked ? "DONE" : `BOOK ${t === "modal" ? "ON THE STAND" : "IN THE LAB"}`}
                note={`${money(q.cost)} · ${q.days} D`}
                go={!blocked && !booked(t)}
                disabled={!!blocked || booked(t)}
                onClick={() => game.schedule(gncJob(company, sel, t))}
              />
            </div>
          );
        })}
        <Verb label="SIMULATE DISPERSIONS" note="ROCKETS" onClick={() => go({ place: "rockets", tab: "sim", design: sel })} />
        <Verb label="TO DRAWING BOARD" note="CHANGE THE LOOP" onClick={() => go({ place: "rockets", tab: "board" })} />
      </div>

      <div className="ed-log" aria-live="polite">
        <span className="cyan">&gt; lab {v.name.toLowerCase()}</span>
        <span className="cursor" aria-hidden="true" />
        <span className="muted" style={{ marginLeft: "auto" }}>
          KS-GNC 1.0 · QUASI-STATIC TRIM, LOOP GROWTH MODEL
        </span>
      </div>
    </section>
  );
}
