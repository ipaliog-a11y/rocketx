import { useEffect, useMemo, useState } from "react";
import { developedParts, type Company } from "../../sim/company.ts";
import { P_SEA_LEVEL } from "../../sim/constants.ts";
import { flowSeparates } from "../../sim/engine.ts";
import { designOf, performance, type EngineDesign, type LimitId } from "../../sim/enginePhysics.ts";
import { COOLINGS, CYCLES, engineRanges, INJECTORS, partDevelopCost, partKey, SIZES, type ChamberSize, type CoolingOption, type CycleOption, type EngineParts, type InjectorOption, type Slot } from "../../sim/parts.ts";
import { CurveSlider, PanelHeader, Readout, Stamp, TitleBlock, Verb } from "../design/kit.tsx";
import {
  blankEngine,
  commitQuote,
  curveFor,
  draft,
  families,
  PART_LIMITS,
  paramFor,
  partsFor,
  readouts,
  revisionName,
  revLetter,
  specRows,
  stamp,
  suggestFamily,
  switchCycle,
  type PartId,
} from "../engineDesign.ts";
import { money } from "../format.ts";
import { game } from "../game.ts";
import { developJob } from "../jobs.ts";
import { drawingScale, EngineSchematic } from "./EngineSchematic.tsx";

/**
 * Testing › Design: the engine on the drawing board. Pick a programme and
 * revision, select a part on the schematic, set its parameter along its own
 * curve, and watch every readout and limit move. Commit makes the next
 * revision (a development job); a released revision goes to the stand.
 */

const CHECK_LABELS: Record<LimitId, string> = {
  "separation-sl": "FLOW SEPARATION AT SL",
  "pump-margin": "FEED MARGIN ≥ 1.20",
  "blade-temp": "BLADE TEMP ≤ 950 K",
  "turbine-power": "TURBINE POWER",
  "motor-power": "MOTOR POWER",
  "tank-pressure": "TANK PRESSURE",
  "size-for-cycle": "SIZE FOR CYCLE",
};

const NEW = "new";

export function EngineDesign({ company, show }: { company: Company; show: (engine: string) => void }) {
  const fams = families(company);
  const latest = (f: (typeof fams)[number]) => f.revisions.at(-1)!;
  const [sel, setSel] = useState<string>(() => (fams[0] ? `${fams[0].name}#${latest(fams[0]).rev}` : NEW));
  const family = fams.find((f) => sel.startsWith(`${f.name}#`));
  const revision = family?.revisions.find((r) => `${family.name}#${r.rev}` === sel);
  const base = revision?.engine ?? null;

  const start = () => {
    if (base?.parts) return { parts: base.parts, design: designOf(base)! };
    return blankEngine();
  };
  const [parts, setParts] = useState<EngineParts>(() => start().parts);
  const [design, setDesign] = useState<EngineDesign>(() => start().design);
  const [part, setPart] = useState<PartId>("nozzle");
  const [diff, setDiff] = useState(false);
  const [newName, setNewName] = useState(() => suggestFamily(blankEngine().parts, (n) => fams.some((f) => f.name === n) || !!company.campaign.engines[n]));
  const [log, setLog] = useState(() => (base ? `> open ${(family?.id ?? "").toLowerCase()} rev ${revLetter(revision!.rev).toLowerCase()}` : "> new engine"));
  const [awaiting, setAwaiting] = useState<string | null>(null);

  // Opening another revision loads its drawing.
  const open = (key: string) => {
    setSel(key);
    const f = fams.find((x) => key.startsWith(`${x.name}#`));
    const r = f?.revisions.find((x) => `${f.name}#${x.rev}` === key);
    if (r?.engine.parts) {
      setParts(r.engine.parts);
      setDesign(designOf(r.engine)!);
      setLog(`> open ${f!.id.toLowerCase()} rev ${revLetter(r.rev).toLowerCase()}${r.engine.design ? "" : " · drawn before ks-sim, figures from its own record"}`);
    } else {
      const b = blankEngine();
      setParts(b.parts);
      setDesign(b.design);
      setLog("> new engine");
    }
    setDiff(false);
    if (!partsFor(r?.engine.parts?.cycle ?? "gas-generator").some((p) => p.id === part)) setPart("nozzle");
  };

  // A committed revision opens once it exists, as a job on the plan or a finished engine.
  useEffect(() => {
    if (!awaiting) return;
    for (const f of fams) for (const r of f.revisions) if (r.engine.name === awaiting) {
      setAwaiting(null);
      open(`${f.name}#${r.rev}`);
      return;
    }
  });

  const d = useMemo(() => draft(parts, design, base), [parts, design, base]);
  const developed = useMemo(() => new Set(developedParts(company)), [company, company.campaign.engines]);
  const list = partsFor(d.parts.cycle);
  const failing = new Set(d.limits.filter((l) => !l.ok).map((l) => l.id));
  const lim = Object.fromEntries(list.map((p) => [p.id, PART_LIMITS[p.id].some((id) => failing.has(id))])) as Record<PartId, boolean>;
  const current = list.find((p) => p.id === part) ?? list[0]!;
  const param = paramFor(current.id, d.parts.cycle);
  const curve = useMemo(() => curveFor(current.id, parts, design), [current.id, parts, design]);
  const rev = revision?.rev ?? 0;
  const nextRev = family ? latest(family).rev + 1 : 0;
  const commitName = family ? revisionName(family.name, nextRev) : newName.trim().toUpperCase();
  const quote = commitQuote(company, d, commitName);
  const pending = revision?.pending ? revision.task : undefined;
  const st = stamp(d, rev, pending, company.day);
  const separates = flowSeparates(d.engine, P_SEA_LEVEL);
  const spread = (() => {
    const r = engineRanges(d.engine);
    if (!r) return 0;
    return ((r.isp[1] - r.isp[0]) / (r.isp[1] + r.isp[0])) * 100;
  })();
  const baseRev = revLetter(rev);
  const basePerf = base?.parts && designOf(base) ? performance(base.parts, designOf(base)!) : null;

  const setParam = (key: keyof EngineDesign, v: number) => {
    setDesign((x) => ({ ...x, [key]: v }));
    setLog(`> set ${current.tag.toLowerCase()}.${String(key)} ${v}`);
  };
  const setSlot = (p: Partial<EngineParts>, what: string) => {
    setParts((x) => ({ ...x, ...p }));
    setLog(`> set ${current.tag.toLowerCase()}.${what}`);
  };
  const choose = (slot: Slot, option: string) => {
    if (developed.has(partKey({ ...d.parts, [slot]: option } as EngineParts, slot))) return "IN PROD";
    return `NEW +${money(partDevelopCost(slot, option, d.parts.size))}`;
  };

  const commit = () => {
    if (quote.blocked) return;
    game.schedule(developJob({ parts: d.parts, name: commitName, design, family: family?.name ?? commitName, rev: nextRev }, quote));
    setAwaiting(commitName);
    setLog(`> commit ${(family?.id ?? "eng-new").toLowerCase()} rev ${revLetter(nextRev).toLowerCase()}   · ${d.perf.ispVac.toFixed(1)} s vac · ${(d.perf.thrustVac / 1000).toFixed(1)} kN`);
  };
  const canSend = !!base && !d.changed && !pending && !!company.campaign.engines[base.name];

  return (
    <section className="ed" aria-label="Engine design">
      {/* Part tree */}
      <div className="ed-tree">
        <div className="head">
          <PanelHeader title="PART TREE" id={family?.id ?? "NEW"} />
          <label className="lbl" htmlFor="ed-engine">
            ENGINE
          </label>
          <select id="ed-engine" value={sel} onChange={(e) => open(e.target.value)}>
            {fams.map((f) =>
              f.revisions.map((r) => (
                <option key={`${f.name}#${r.rev}`} value={`${f.name}#${r.rev}`}>
                  {f.id} {f.name.toUpperCase()} REV {revLetter(r.rev)}
                  {r.pending ? " · IN WORK" : ""}
                </option>
              )),
            )}
            <option value={NEW}>NEW ENGINE</option>
          </select>
          {!family && (
            <>
              <label className="lbl" htmlFor="ed-name">
                PROGRAMME NAME
              </label>
              <input id="ed-name" type="text" value={newName} maxLength={24} onChange={(e) => setNewName(e.target.value)} />
            </>
          )}
          <div className="mono" style={{ fontSize: 14 }}>
            {(family?.name ?? newName).toUpperCase()} · {CYCLES[d.parts.cycle].label.toUpperCase()}
          </div>
        </div>
        <div role="group" aria-label="Parts" style={{ display: "flex", flexDirection: "column" }}>
          {list.map((p) => (
            <button key={p.id} type="button" className="part-row" aria-pressed={p.id === current.id} onClick={() => setPart(p.id)}>
              <span className="tag">{p.tag}</span>
              <span className="name">{p.name}</span>
              <span className={`st ${lim[p.id] ? "alarm" : ""}`}>{lim[p.id] ? (p.id === "nozzle" ? "▲ SEP SL" : "▲ LIMIT") : "● OK"}</span>
            </button>
          ))}
        </div>
        <div className="checks">
          <PanelHeader title="READINESS" id={`REV ${d.changed ? revLetter(nextRev) : baseRev}`} />
          {d.limits.map((l) => (
            <div key={l.id} className="check">
              <div className="ed-crow">
                <span>{CHECK_LABELS[l.id]}</span>
                <span className={`mono ${l.ok ? "cyan" : "alarm"}`}>{l.ok ? "● GO" : l.warning ? "▲ UPPER ONLY" : "▲ LIMIT"}</span>
              </div>
              <div className="val">{l.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Schematic, title block, stamp and verbs */}
      <div className="ed-sheet">
        <div className="ed-bar lbl">
          <span>{family?.id ?? "ENG-NEW"} / SCHEMATIC</span>
          <span>SELECT A PART TO EDIT</span>
        </div>
        <div className="gridded">
          <EngineSchematic
            parts={d.parts}
            design={design}
            perf={d.perf}
            base={diff && basePerf && base ? { perf: basePerf, eps: designOf(base)!.eps } : null}
            sel={current.id}
            lim={lim}
            pick={setPart}
            separates={separates}
            name={(family?.name ?? newName).toUpperCase()}
          />
        </div>
        <div className="tb-row">
          <TitleBlock
            rows={[
              ["DWG", `${family?.id ?? "ENG-NEW"}-${(family?.name ?? newName).toUpperCase().slice(0, 10)}`],
              ["REVISION", d.changed && base ? `${baseRev} → ${revLetter(nextRev)}` : family ? baseRev : "A"],
              ["DRAWN", "CHIEF ENG"],
              ["SCALE", `1:${drawingScale(d.perf, design.eps)}`],
              ["DATE", `D-${company.day}`],
              ["MODEL", "KS-SIM 1.0"],
            ]}
          />
          <Stamp {...st} />
          <div className="ed-actions">
            <Verb label={`DIFF VS REV ${baseRev}`} note={diff ? "ON" : "OFF"} pressed={diff} disabled={!base} onClick={() => setDiff(!diff)} />
            <Verb label={`COMMIT REV ${revLetter(nextRev)}`} note={quote.blocked ?? `${money(quote.cost)} · ${quote.days} D`} go disabled={!!quote.blocked} onClick={commit} />
            <Verb
              label={pending ? "IN WORK" : "SEND TO STAND"}
              note={pending ? st.sub : d.changed ? "COMMIT FIRST" : separates ? "ALTITUDE CELL" : "SEA-LEVEL STAND"}
              disabled={!canSend}
              onClick={() => base && show(base.name)}
            />
          </div>
        </div>
      </div>

      {/* Parameter strip */}
      <div className="ed-strip">
        <PanelHeader title="PARAMETER STRIP" id={current.tag} />
        {param ? (
          <div>
            <div className="lbl">
              {current.name} · {param.name}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
              <span className="big">{(design[param.key] ?? 0).toFixed(param.dec)}</span>
              <span className="mono muted">{param.unit}</span>
              <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>
                {base && d.changed && designOf(base)![param.key] !== undefined ? `${((design[param.key] ?? 0) - (designOf(base)![param.key] ?? 0)) >= 0 ? "+" : "−"}${Math.abs((design[param.key] ?? 0) - (designOf(base)![param.key] ?? 0)).toFixed(param.dec)} vs REV ${baseRev}` : `REV ${family ? baseRev : "A"}`}
              </span>
            </div>
          </div>
        ) : (
          <div className="lbl">{current.name} · TYPE</div>
        )}
        {param && curve && (
          <CurveSlider
            curve={curve}
            sym={param.sym}
            name={param.name}
            unit={param.unit}
            min={param.min}
            max={param.max}
            step={param.step}
            dec={param.dec}
            value={design[param.key] ?? param.min}
            onChange={(v) => setParam(param.key, v)}
          />
        )}

        {current.id === "chamber" && (
          <>
            <fieldset className="ed-choice">
              <legend className="lbl">SIZE CLASS</legend>
              {SIZES.map((size) => {
                const allowed = CYCLES[d.parts.cycle].sizes.includes(size);
                return (
                  <label key={size}>
                    <input type="radio" name="ed-size" checked={d.parts.size === size} disabled={!allowed} onChange={() => setSlot({ size: size as ChamberSize }, `size ${size}`)} />
                    <span>{size} kN</span>
                    <span className="note">{allowed ? "" : "NOT FOR CYCLE"}</span>
                  </label>
                );
              })}
            </fieldset>
            <fieldset className="ed-choice">
              <legend className="lbl">COOLING</legend>
              {(Object.keys(COOLINGS) as CoolingOption[]).map((c) => (
                <label key={c}>
                  <input type="radio" name="ed-cooling" checked={d.parts.cooling === c} onChange={() => setSlot({ cooling: c }, `cooling ${c}`)} />
                  <span>{COOLINGS[c].label.toUpperCase()}</span>
                  <span className="note">{choose("cooling", c)}</span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        {current.id === "injector" && (
          <fieldset className="ed-choice">
            <legend className="lbl">INJECTOR TYPE</legend>
            {(Object.keys(INJECTORS) as InjectorOption[]).map((i) => (
              <label key={i}>
                <input type="radio" name="ed-injector" checked={d.parts.injector === i} onChange={() => setSlot({ injector: i }, `type ${i}`)} />
                <span>{INJECTORS[i].label.toUpperCase()}</span>
                <span className="note">{choose("injector", i)}</span>
              </label>
            ))}
          </fieldset>
        )}
        {current.id === "feed" && (
          <fieldset className="ed-choice">
            <legend className="lbl">FEED CYCLE</legend>
            {(Object.keys(CYCLES) as CycleOption[]).map((c) => (
              <label key={c}>
                <input
                  type="radio"
                  name="ed-cycle"
                  checked={d.parts.cycle === c}
                  onChange={() => {
                    const next = switchCycle(d.parts, design, c);
                    setParts(next.parts);
                    setDesign(next.design);
                    setLog(`> set ${current.tag.toLowerCase()}.cycle ${c}`);
                  }}
                />
                <span>{CYCLES[c].label.toUpperCase()}</span>
                <span className="note">{choose("cycle", c)}</span>
              </label>
            ))}
          </fieldset>
        )}

        <div className="ed-info">
          <span className="lbl" style={{ paddingTop: 1 }}>
            INFO
          </span>
          <span className="t">{param?.info ?? "Type sets mixing loss and acoustic stability."}</span>
        </div>
        <div className="specs">
          {specRows(current.id, d, developed).map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Predicted performance */}
      <div className="ed-readouts" role="group" aria-label="Predicted performance">
        {readouts(d).map((r) => (
          <Readout key={r.key} r={r} rev={family ? baseRev : "A"} />
        ))}
      </div>

      <div className="ed-log" aria-live="polite">
        <span className="cyan">{log}</span>
        <span className="cursor" aria-hidden="true" />
        <span className="muted" style={{ marginLeft: "auto" }}>
          MODEL KS-SIM 1.0 · ISP ±{spread.toFixed(1)} % UNTIL TESTED
        </span>
      </div>
    </section>
  );
}
