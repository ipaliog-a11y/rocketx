import { useEffect, useMemo, useRef, useState } from "react";
import { maxEngines, specOf, stageRole, type VehicleSpec } from "../../sim/builder.ts";
import { posted, type Company } from "../../sim/company.ts";
import { defaultFins, MATERIALS, NOSE_LABELS, type FinSection, type Material, type NoseShape } from "../../sim/geometry.ts";
import { suggestBuilds, type Goal, type Suggestion } from "../../sim/guide.ts";
import { UNGUIDED_MARGIN } from "../../sim/stability.ts";
import { circular, escape, gto, highCircular, lunar, SSO_500, SUBORBITAL_TEST } from "../../missions.ts";
import { CurveSlider, PanelHeader, Readout, Stamp, TitleBlock, Verb } from "../design/kit.tsx";
import { money } from "../format.ts";
import { game } from "../game.ts";
import { designJob, proofJob } from "../jobs.ts";
import { reducedMotion } from "../motion.ts";
import { useGo } from "../nav.ts";
import {
  crossing,
  drawQuote,
  nextRevisionName,
  readParam,
  revisionOf,
  SYSTEMS,
  vCurve,
  vDraft,
  vehicleParams,
  vehicleParts,
  vReadouts,
  vSpecRows,
  withGeometry,
  writeParam,
} from "../vehicleDesign.ts";
import { VehicleSchematic, vehicleScale } from "./VehicleSchematic.tsx";

/**
 * Rockets › Drawing board: the vehicle on the drawing board. Pick a design,
 * select a part of the stack, set its parameters along their curves, and
 * every readout follows the builder: drag from the shape, limits from the
 * shells, static margin from Barrowman. Draw up makes the next revision;
 * the sizing guide below suggests a stack for a job.
 */

const NEW = "new";
const ORBITS = [
  { id: "250/28.5", label: "LEO 250 KM, 28.5°", mission: circular(250, 28.5) },
  { id: "300/28.5", label: "LEO 300 KM, 28.5°", mission: circular(300, 28.5) },
  { id: "400/51.6", label: "LEO 400 KM, 51.6°", mission: circular(400, 51.6) },
  { id: "sso", label: "SSO 500 KM", mission: SSO_500 },
  { id: "nav", label: "1,200 KM, 55°", mission: highCircular(1_200, 55) },
  { id: "gto", label: "GTO", mission: gto() },
  { id: "tli", label: "TRANS-LUNAR", mission: lunar() },
  { id: "c3", label: "ESCAPE C3 10", mission: escape(10) },
];

export function VehicleDesign({ company, drawn, job }: { company: Company; drawn: (key: string) => void; job?: string }) {
  const go = useGo();
  const keys = Object.keys(company.designs);
  const id = (key: string) => `VEH-${String(keys.indexOf(key) + 1).padStart(2, "0")}`;
  const firstKey = keys.find((k) => company.designs[k]!.stages.length > 1) ?? keys[0] ?? NEW;
  const [sel, setSel] = useState<string>(job ? NEW : firstKey);
  const base = sel === NEW ? null : (company.designs[sel] ?? null);
  const [spec, setSpec] = useState<VehicleSpec>(() => withGeometry(specOf(base ?? company.designs[firstKey]!)));
  const [part, setPart] = useState("stage-0");
  const [paramKey, setParamKey] = useState<string | null>(null);
  const [diff, setDiff] = useState(false);
  const [newName, setNewName] = useState("NEW DESIGN");
  const [log, setLog] = useState(() => (base ? `> open ${id(sel).toLowerCase()} rev ${revisionOf(base.name).toLowerCase()}${base.geometry ? "" : " · drawn before ks-struct, figures from its own record"}` : "> new design"));
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const engines = company.campaign.engines;

  const open = (key: string) => {
    setSel(key);
    const v = key === NEW ? null : company.designs[key]!;
    setSpec(withGeometry(specOf(v ?? company.designs[firstKey]!)));
    setDiff(false);
    setLog(v ? `> open ${id(key).toLowerCase()} rev ${revisionOf(v.name).toLowerCase()}${v.geometry ? "" : " · drawn before ks-struct, figures from its own record"}` : "> new design");
  };

  // A drawn-up revision opens once it exists.
  useEffect(() => {
    if (!awaiting) return;
    const key = keys.find((k) => company.designs[k]!.name === awaiting);
    if (key) {
      setAwaiting(null);
      open(key);
    }
  });

  const names = Object.values(company.designs).map((d) => d.name);
  const revision = base ? nextRevisionName(company, base.name) : null;
  const drawName = revision ? revision.name : newName.trim();
  const d = useMemo(() => vDraft(company, { ...spec, name: drawName }, base, names), [spec, base, drawName, company.designs]);
  const parts = vehicleParts(d.spec);
  const current = parts.find((p) => p.id === part) ?? parts[0]!;
  const params = vehicleParams(current.id, d.spec);
  const param = params.find((p) => p.key === paramKey) ?? params[0]!;
  const curve = useMemo(() => {
    const c = vCurve(company, d.spec, param);
    if (!c) return null;
    if (current.id === "fins") {
      const single = d.spec.stages.length === 1;
      const r1 = crossing(c, single ? UNGUIDED_MARGIN.liftoff : 0, "a");
      const r2 = single ? crossing(c, UNGUIDED_MARGIN.maxQ, "b") : null;
      c.redlines = [...(r1 !== null ? [{ x: r1, label: single ? "1 CAL LIFTOFF" : "NEUTRAL" }] : []), ...(r2 !== null ? [{ x: r2, label: "0.5 CAL MAX-Q", dotted: true }] : [])];
    }
    return c;
  }, [d.spec, param.key, current.id]);
  const quote = drawQuote(company, d, drawName);
  const pending = company.tasks.find((t) => t.spec.kind === "design" && base && t.spec.vehicle.name === base.name);
  const proofTask = company.tasks.find((t) => t.spec.kind === "proof" && t.spec.design === sel);
  const untested = base?.structure ? [...new Set(base.structure.stages.map((s) => s.key))].filter((k) => !company.campaign.structureKnowledge?.[k]) : [];
  const lim: Record<string, boolean> = {
    fairing: d.problems.some((p) => /fairing|Jettison/i.test(p)),
    fins: d.problems.some((p) => /Static margin|Fins/i.test(p)),
    payload: false,
    ...Object.fromEntries(d.spec.stages.map((_, i) => [`stage-${i}`, d.problems.some((p) => p.toLowerCase().startsWith(stageRole(d.spec.stages.length, i)))])),
  };
  const rev = base ? revisionOf(base.name) : "A";
  const nextRev = revision ? revision.letter : "A";
  const stampState = d.problems.length > 0
    ? { text: "✕ NO-GO", tone: "alarm" as const, sub: "RESOLVE LIMITS" }
    : d.changed
      ? { text: "DRAFT", tone: "muted" as const, sub: `REV ${nextRev} UNCOMMITTED` }
      : pending
        ? { text: "IN WORK", tone: "muted" as const, sub: `REV ${rev} · DRAWING` }
        : { text: "RELEASED", tone: "line" as const, sub: `REV ${rev} · READY TO BUILD` };

  const set = (key: string, v: number) => {
    setSpec((s) => writeParam(s, key, v));
    setLog(`> set ${current.tag.toLowerCase()}.${key} ${v}`);
  };
  const setGeometry = (change: (g: NonNullable<VehicleSpec["geometry"]>) => NonNullable<VehicleSpec["geometry"]>, what: string) => {
    setSpec((s) => {
      const w = withGeometry(s);
      return { ...w, geometry: change(w.geometry) };
    });
    setLog(`> set ${current.tag.toLowerCase()}.${what}`);
  };
  const setStage = (i: number, change: Partial<VehicleSpec["stages"][number]>, what: string) => {
    setSpec((s) => ({ ...s, stages: s.stages.map((x, j) => (j === i ? { ...x, ...change } : x)) }));
    setLog(`> set s${i + 1}.${what}`);
  };

  const drawUp = () => {
    if (quote.blocked) return;
    game.schedule(designJob({ ...d.spec, name: drawName }, quote, drawn));
    setAwaiting(drawName);
    setLog(`> draw up ${drawName.toLowerCase()}   · ${(d.vehicle ? d.vehicle.limits.maxQAlpha! / 1000 : 0).toFixed(1)} kPa·° q·α cap`);
  };
  const canAct = !!base && !d.changed && !pending;
  const stageIndex = current.id.startsWith("stage-") ? Number(current.id.slice(6)) : -1;
  const stage = stageIndex >= 0 ? d.spec.stages[stageIndex] : undefined;
  const engineOf = (n: string) => engines[n];
  const pressureFed = stage ? ["pressure-fed", "storable"].includes(engineOf(stage.engine)?.parts?.cycle ?? "") : false;
  const geo = d.spec.geometry;
  const engineList = Object.values(engines);

  return (
    <>
      <section className="ed" aria-label="Vehicle design">
        <div className="ed-tree">
          <div className="head">
            <PanelHeader title="PART TREE" id={base ? id(sel) : "VEH-NEW"} />
            <label className="lbl" htmlFor="vd-design">
              DESIGN
            </label>
            <select id="vd-design" value={sel} onChange={(e) => open(e.target.value)}>
              {keys.map((k) => (
                <option key={k} value={k}>
                  {id(k)} {company.designs[k]!.name.toUpperCase()} REV {revisionOf(company.designs[k]!.name)}
                </option>
              ))}
              <option value={NEW}>NEW DESIGN</option>
            </select>
            {!base && (
              <>
                <label className="lbl" htmlFor="vd-name">
                  DESIGN NAME
                </label>
                <input id="vd-name" type="text" value={newName} maxLength={24} onChange={(e) => setNewName(e.target.value)} />
              </>
            )}
            <div className="mono" style={{ fontSize: 14 }}>
              {(base?.name ?? newName).toUpperCase()} · {d.spec.stages.length} STAGE{d.spec.stages.length === 1 ? "" : "S"}
            </div>
          </div>
          <div role="group" aria-label="Parts" style={{ display: "flex", flexDirection: "column" }}>
            {parts.map((p) => (
              <button key={p.id} type="button" className="part-row" aria-pressed={p.id === current.id} onClick={() => (setPart(p.id), setParamKey(null))}>
                <span className="tag">{p.tag}</span>
                <span className="name">{p.name}</span>
                <span className={`st ${lim[p.id] ? "alarm" : ""}`}>{lim[p.id] ? "▲ LIMIT" : "● OK"}</span>
              </button>
            ))}
          </div>
          <div style={{ padding: "16px 16px 4px", borderTop: "1px solid var(--ed-grid)", marginTop: 8 }}>
            <PanelHeader title="SYSTEMS" id={base ? id(sel) : "VEH-NEW"} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", padding: "0 16px", fontFamily: "var(--ed-mono)", fontSize: 13, color: "var(--ed-muted)" }}>
            {SYSTEMS.map(([tag, name, state]) => (
              <div key={tag} style={{ display: "flex", gap: 10, minHeight: 26, alignItems: "center" }}>
                <span style={{ width: 52 }}>{tag}</span>
                <span style={{ flex: 1 }}>{name}</span>
                <span style={{ fontSize: 12 }}>{state}</span>
              </div>
            ))}
          </div>
          <div className="checks">
            <PanelHeader title="READINESS" id={`REV ${d.changed ? nextRev : rev}`} />
            {d.problems.map((p) => (
              <div key={p} className="check">
                <div className="ed-crow">
                  <span>LIMIT</span>
                  <span className="mono alarm">▲ LIMIT</span>
                </div>
                <div className="val" style={{ fontSize: 12 }}>
                  {p}
                </div>
              </div>
            ))}
            {d.warnings.map((w) => (
              <div key={w} className="check">
                <div className="ed-crow">
                  <span>CAUTION</span>
                  <span className="mono alarm">▲ CHECK</span>
                </div>
                <div className="val" style={{ fontSize: 12 }}>
                  {w}
                </div>
              </div>
            ))}
            {d.problems.length === 0 && d.vehicle && (
              <div className="check">
                <div className="ed-crow">
                  <span>LOADS, MARGIN, JETTISON</span>
                  <span className="mono cyan">● GO</span>
                </div>
                <div className="val">
                  q·α {((d.vehicle.limits.maxQAlpha ?? 0) / 1000).toFixed(1)} kPa·° · SM {d.vehicle.stability!.min.toFixed(2)} · {Math.round(geo.jettisonAltitude / 1000)} km
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="ed-sheet">
          <div className="ed-bar lbl">
            <span>{base ? id(sel) : "VEH-NEW"} / STACK</span>
            <span>SELECT A PART TO EDIT</span>
          </div>
          <div className="gridded">
            {d.vehicle ? (
              <VehicleSchematic
                draft={{ spec: d.spec, vehicle: d.vehicle }}
                base={diff && base ? (() => {
                  const bs = withGeometry(specOf(base));
                  return { spec: bs, vehicle: base.geometry ? base : d.vehicle };
                })() : null}
                sel={current.id}
                lim={lim}
                pick={(p) => (setPart(p), setParamKey(null))}
                name={(base?.name ?? newName).toUpperCase()}
              />
            ) : (
              <span className="mono alarm">▲ CAN'T BE DRAWN: {d.problems[0]}</span>
            )}
          </div>
          <div className="tb-row">
            <TitleBlock
              rows={[
                ["DWG", `${base ? id(sel) : "VEH-NEW"}-${(base?.name ?? newName).toUpperCase().replace(/ [B-Z]$/, "").slice(0, 10)}`],
                ["REVISION", d.changed && base ? `${rev} → ${nextRev}` : rev],
                ["DRAWN", "CHIEF ENG"],
                ["SCALE", d.vehicle ? `1:${vehicleScale({ spec: d.spec, vehicle: d.vehicle })}` : "—"],
                ["DATE", `D-${company.day}`],
                ["MODEL", "KS-STRUCT 1.0"],
              ]}
            />
            <Stamp {...stampState} />
            <div className="ed-actions">
              <Verb label={`DIFF VS REV ${rev}`} note={diff ? "ON" : "OFF"} pressed={diff} disabled={!base} onClick={() => setDiff(!diff)} />
              <Verb label={`DRAW UP REV ${nextRev}`} note={quote.blocked ?? `${money(quote.cost)} · ${quote.days} D`} go disabled={!!quote.blocked} onClick={drawUp} />
              <Verb
                label={proofTask ? "PROOF TEST BOOKED" : "PROOF TEST"}
                note={!base?.structure ? "NEW MODEL ONLY" : untested.length === 0 ? "DONE" : d.changed ? "DRAW UP FIRST" : `${untested.length} SHELL${untested.length === 1 ? "" : "S"}`}
                disabled={!canAct || !base?.structure || untested.length === 0 || !!proofTask}
                onClick={() => game.schedule(proofJob(company, sel))}
              />
              <Verb label="TO TUNNEL" note={canAct ? "TESTING" : "DRAW UP FIRST"} disabled={!canAct} onClick={() => go({ place: "testing", tab: "tunnel", design: sel })} />
              <Verb label="SIMULATE" note={canAct ? "ROCKETS" : "DRAW UP FIRST"} disabled={!canAct} onClick={() => go({ place: "rockets", tab: "sim", design: sel })} />
            </div>
          </div>
        </div>

        <div className="ed-strip">
          <PanelHeader title="PARAMETER STRIP" id={current.tag} />
          {params.length > 1 && (
            <fieldset className="ed-choice">
              <legend className="lbl">PARAMETER</legend>
              {params.map((p) => (
                <label key={p.key}>
                  <input type="radio" name="vd-param" checked={p.key === param.key} onChange={() => setParamKey(p.key)} />
                  <span>{p.name}</span>
                  <span className="note">
                    {readParam(d.spec, p.key).toFixed(p.dec)} {p.unit}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div>
            <div className="lbl">
              {current.name} · {param.name}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
              <span className="big">{readParam(d.spec, param.key).toFixed(param.dec)}</span>
              <span className="mono muted">{param.unit}</span>
              <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>
                {base && d.changed ? (() => {
                  const delta = readParam(d.spec, param.key) - readParam(withGeometry(specOf(base)), param.key);
                  return Number(delta.toFixed(param.dec)) === 0 ? `REV ${rev}` : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(param.dec)} vs REV ${rev}`;
                })() : `REV ${rev}`}
              </span>
            </div>
          </div>
          {curve && (
            <CurveSlider
              curve={curve}
              sym={param.sym}
              name={param.name}
              unit={param.unit}
              min={param.min}
              max={param.max}
              step={param.step}
              dec={param.dec}
              value={readParam(d.spec, param.key)}
              onChange={(v) => set(param.key, v)}
            />
          )}
          {pressureFed && param.key.startsWith("p") && <span className="mono muted" style={{ fontSize: 12 }}>PRESSURE-FED: TANKS HOLD THE ENGINE'S FEED PRESSURE</span>}

          {current.id === "fairing" && (
            <fieldset className="ed-choice">
              <legend className="lbl">NOSE SHAPE</legend>
              {(Object.keys(NOSE_LABELS) as NoseShape[]).map((shape) => (
                <label key={shape}>
                  <input type="radio" name="vd-nose" checked={geo.nose.shape === shape} onChange={() => setGeometry((g) => ({ ...g, nose: { ...g.nose, shape } }), `nose ${shape}`)} />
                  <span>{NOSE_LABELS[shape].toUpperCase()}</span>
                </label>
              ))}
            </fieldset>
          )}
          {stage && (
            <>
              <label className="lbl" htmlFor="vd-engine">
                ENGINE
              </label>
              <select id="vd-engine" value={stage.engine} onChange={(e) => setStage(stageIndex, { engine: e.target.value, engineCount: Math.min(stage.engineCount, maxEngines(engines[e.target.value]!, stage.diameter)) }, `engine ${e.target.value}`)}>
                {engineList.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.name.toUpperCase()} · {(e.thrustVac / 1000).toFixed(0)} KN · {e.ispVac.toFixed(0)} S
                  </option>
                ))}
              </select>
              <div className="lbl">ENGINE COUNT</div>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Verb label="−" onClick={() => setStage(stageIndex, { engineCount: Math.max(1, stage.engineCount - 1) }, "count")} disabled={stage.engineCount <= 1} />
                <output className="mono" aria-live="polite" style={{ minWidth: 70, textAlign: "center" }}>
                  {stage.engineCount} / {maxEngines(engines[stage.engine]!, stage.diameter)}
                </output>
                <Verb label="+" onClick={() => setStage(stageIndex, { engineCount: stage.engineCount + 1 }, "count")} disabled={stage.engineCount >= maxEngines(engines[stage.engine]!, stage.diameter)} />
              </span>
              <fieldset className="ed-choice">
                <legend className="lbl">TANK MATERIAL</legend>
                {(Object.keys(MATERIALS) as Material[]).map((m) => (
                  <label key={m}>
                    <input
                      type="radio"
                      name="vd-material"
                      checked={geo.stages[stageIndex]!.material === m}
                      onChange={() => setGeometry((g) => ({ ...g, stages: g.stages.map((s, j) => (j === stageIndex ? { ...s, material: m } : s)) }), `material ${m}`)}
                    />
                    <span>{MATERIALS[m].label.toUpperCase()}</span>
                    <span className="note">{MATERIALS[m].qualify > 0 ? `QUALIFY ${money(MATERIALS[m].qualify)}` : "QUALIFIED"}</span>
                  </label>
                ))}
              </fieldset>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {stageIndex === d.spec.stages.length - 1 && d.spec.stages.length < 3 && (
                  <Verb
                    label={d.spec.stages.length === 1 ? "ADD UPPER STAGE" : "ADD KICK STAGE"}
                    onClick={() => {
                      const vac = engineList.find((e) => e.exitPressure < 20_000) ?? engineList[0]!;
                      const kick = engineList.find((e) => e.parts?.cycle === "storable") ?? vac;
                      const below = d.spec.stages.at(-1)!;
                      const added = d.spec.stages.length === 1 ? { diameter: below.diameter, tankLength: 2, engine: vac.name, engineCount: 1 } : { diameter: below.diameter, tankLength: 1, engine: kick.name, engineCount: 1 };
                      setSpec((s) => {
                        const w = withGeometry(s);
                        return { ...w, stages: [...w.stages, added], geometry: { ...w.geometry, stages: [...w.geometry.stages, { ...w.geometry.stages.at(-1)! }] } };
                      });
                      setLog(`> add stage ${d.spec.stages.length + 1}`);
                    }}
                  />
                )}
                {stageIndex === d.spec.stages.length - 1 && d.spec.stages.length > 1 && (
                  <Verb
                    label={`REMOVE ${stageRole(d.spec.stages.length, stageIndex).toUpperCase()}`}
                    onClick={() => {
                      setSpec((s) => {
                        const w = withGeometry(s);
                        return { ...w, stages: w.stages.slice(0, -1), geometry: { ...w.geometry, stages: w.geometry.stages.slice(0, -1) } };
                      });
                      setPart("stage-0");
                      setLog(`> remove stage ${d.spec.stages.length}`);
                    }}
                  />
                )}
              </div>
            </>
          )}
          {current.id === "fins" && (
            <>
              <fieldset className="ed-choice">
                <legend className="lbl">FIN COUNT</legend>
                {([3, 4] as const).map((n) => (
                  <label key={n}>
                    <input type="radio" name="vd-fincount" checked={(geo.fins?.count ?? 4) === n} onChange={() => setGeometry((g) => ({ ...g, fins: { ...(g.fins ?? defaultFins(d.spec.stages[0]!.diameter)), count: n } }), `count ${n}`)} />
                    <span>{n} FINS</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="ed-choice">
                <legend className="lbl">SECTION</legend>
                {(["square", "rounded", "airfoil"] as FinSection[]).map((sec) => (
                  <label key={sec}>
                    <input type="radio" name="vd-section" checked={(geo.fins?.section ?? "rounded") === sec} onChange={() => setGeometry((g) => ({ ...g, fins: { ...(g.fins ?? defaultFins(d.spec.stages[0]!.diameter)), section: sec } }), `section ${sec}`)} />
                    <span>{sec.toUpperCase()}</span>
                  </label>
                ))}
              </fieldset>
              <Verb label={geo.fins && geo.fins.span > 0 ? "REMOVE FINS" : "ADD FINS"} onClick={() => setGeometry((g) => ({ ...g, fins: g.fins && g.fins.span > 0 ? undefined : defaultFins(d.spec.stages[0]!.diameter) }), "fins")} />
            </>
          )}

          <div className="ed-info">
            <span className="lbl" style={{ paddingTop: 1 }}>
              INFO
            </span>
            <span className="t">{param.info}</span>
          </div>
          <div className="specs">
            {vSpecRows(current.id, d).map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ed-readouts" role="group" aria-label="Predicted figures">
          {vReadouts(d, engines).map((r) => (
            <Readout key={r.key} r={r} rev={rev} />
          ))}
        </div>

        <div className="ed-log" aria-live="polite">
          <span className="cyan">{log}</span>
          <span className="cursor" aria-hidden="true" />
          <span className="muted" style={{ marginLeft: "auto" }}>
            KS-STRUCT 1.0 · DRAG AND SHELLS ON THE MODEL UNTIL TESTED
          </span>
        </div>
      </section>
      <SizingGuide company={company} job={job} use={(s) => (setSpec(withGeometry(s.spec)), setLog(`> load guide ${s.label.toLowerCase()}`))} />
    </>
  );
}

/** The sizing guide, as a design-office panel: a job in, three stacks out. */
function SizingGuide({ company, use, job }: { company: Company; use: (s: Suggestion) => void; job?: string }) {
  const work = posted(company).filter((c) => !company.closed[c.id] && company.day <= c.deadline && c.kind !== "crew");
  const asked = job && work.some((c) => c.id === job) ? job : undefined;
  const [source, setSource] = useState<string>(asked ?? work[0]?.id ?? "custom");
  const [orbit, setOrbit] = useState("300/28.5");
  const [suborbital, setSuborbital] = useState(false);
  const [apogee, setApogee] = useState(120);
  const [payload, setPayload] = useState(150);
  const [results, setResults] = useState<Suggestion[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const box = useRef<HTMLElement>(null);

  const goal = (): Goal => {
    const c = work.find((x) => x.id === source);
    if (c) return { mission: c.mission, payloadMass: c.payloadMass, minApogee: c.minApogee };
    if (suborbital) return { mission: SUBORBITAL_TEST, payloadMass: payload, minApogee: apogee * 1000 };
    return { mission: ORBITS.find((o) => o.id === orbit)!.mission, payloadMass: payload };
  };
  const run = () => {
    setThinking(true);
    setResults(null);
    setTimeout(() => {
      setResults(suggestBuilds(goal(), company.campaign.engines, Object.values(company.designs)));
      setThinking(false);
    }, 30);
  };
  // Sent here for a contract: open on it, in view, already sized.
  useEffect(() => {
    if (!asked) return;
    box.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    run();
  }, [asked]);

  return (
    <section className="ed ed-guide guide" aria-label="Sizing guide" ref={box}>
      <div className="ed-guide-head">
        <PanelHeader title="SIZING GUIDE" id="GDE-1" />
        <div className="ed-guide-form">
          <label className="lbl" htmlFor="sg-job">
            JOB
          </label>
          <select id="sg-job" value={source} onChange={(e) => setSource(e.target.value)}>
            {work.map((c) => (
              <option key={c.id} value={c.id}>
                {company.accepted.includes(c.id) ? "SIGNED · " : ""}
                {c.title.toUpperCase()}
              </option>
            ))}
            <option value="custom">SOMETHING ELSE</option>
          </select>
          {source === "custom" && (
            <>
              <label className="lbl" htmlFor="sg-where">
                WHERE
              </label>
              <select id="sg-where" value={suborbital ? "sub" : orbit} onChange={(e) => (e.target.value === "sub" ? setSuborbital(true) : (setSuborbital(false), setOrbit(e.target.value)))}>
                <option value="sub">SUBORBITAL, STRAIGHT UP</option>
                {ORBITS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {suborbital && (
                <>
                  <label className="lbl" htmlFor="sg-apogee">
                    APOGEE KM
                  </label>
                  <input id="sg-apogee" type="number" min={80} max={300} step={5} value={apogee} onChange={(e) => setApogee(Math.max(80, Number(e.target.value) || 80))} />
                </>
              )}
              <label className="lbl" htmlFor="sg-payload">
                PAYLOAD KG
              </label>
              <input id="sg-payload" type="number" min={10} step={10} value={payload} onChange={(e) => setPayload(Math.max(10, Number(e.target.value) || 10))} />
            </>
          )}
          <Verb label={thinking ? "SIZING…" : "SUGGEST"} note="3 STACKS" go disabled={thinking} onClick={run} />
        </div>
      </div>
      {results && results.length === 0 && <div className="mono alarm" style={{ padding: "0 16px 16px" }}>▲ NO STACK FROM THESE ENGINES DOES THIS JOB. A BIGGER ENGINE FROM TESTING › DESIGN MIGHT.</div>}
      {results && results.length > 0 && (
        <div className="ed-guide-results suggestions">
          {results.map((s) => (
            <div key={s.label} className="ed-guide-card card">
              <PanelHeader title={s.label.toUpperCase()} id={`+${Math.round(s.margin * 100)} % MARGIN`} />
              <div className="specs">
                {s.spec.stages.map((st, i) => (
                  <div key={i}>
                    <span>S{i + 1}</span>
                    <span>
                      {st.diameter.toFixed(2)} × {st.tankLength} M · {st.engineCount} × {st.engine.toUpperCase()}
                    </span>
                  </div>
                ))}
                <div>
                  <span>Δv · T/W</span>
                  <span>
                    {(s.figures.totalDeltaV / 1000).toFixed(2)} KM/S · {s.figures.liftoffTW.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span>BUILD · DRAW UP</span>
                  <span>
                    {money(s.build.cost)} · {money(s.design.cost)}
                  </span>
                </div>
              </div>
              <span className="t" style={{ fontSize: 13, color: "var(--ed-muted)" }}>
                {s.note}
              </span>
              <Verb label="USE" note="LOAD INTO DRAFT" go onClick={() => use(s)} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
