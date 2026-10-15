import type { KeyboardEvent, ReactNode } from "react";
import type { EngineDesign, Performance } from "../../sim/enginePhysics.ts";
import { INJECTORS, type EngineParts } from "../../sim/parts.ts";
import type { PartId } from "../engineDesign.ts";

/**
 * The engine as a schematic: the feed system as a P&ID up top (pumps and
 * turbine, electric pumps, or a pressurant bottle), the injector, and the
 * chamber and bell drawn to scale from the model's throat and expansion
 * ratio. Every part is a button.
 */

type Geometry = { rt: number; rc: number; lcyl: number; lconv: number; re: number; ln: number };

const TAN30 = Math.tan(Math.PI / 6);
const TAN15 = Math.tan(Math.PI / 12);

function geometry(perf: Performance, eps: number): Geometry {
  const rt = Math.sqrt(perf.throatArea / Math.PI);
  const rc = 1.75 * rt;
  const re = rt * Math.sqrt(eps);
  return { rt, rc, lcyl: 2.4 * rc, lconv: (rc - rt) / TAN30, re, ln: (0.8 * (re - rt)) / TAN15 };
}

const CX = 300;
const TOP = 252;
const ROOM = 248;

function bellPaths(g: Geometry, s: number) {
  const yThroat = TOP + (g.lcyl + g.lconv) * s;
  const yExit = yThroat + g.ln * s;
  const f = (v: number) => v.toFixed(1);
  const side = (dir: 1 | -1) => {
    const x0 = CX + dir * g.rt * s;
    const x3 = CX + dir * g.re * s;
    const L = g.ln * s;
    // A parabolic bell: leaves the throat at 30°, exits at about 10°.
    const x1 = x0 + dir * (L / 3) * Math.tan(Math.PI / 6);
    const x2 = x3 - dir * (L / 3) * Math.tan(Math.PI / 18);
    return `M${f(x0)} ${f(yThroat)} C${f(x1)} ${f(yThroat + L / 3)} ${f(x2)} ${f(yExit - L / 3)} ${f(x3)} ${f(yExit)}`;
  };
  return { yThroat, yExit, walls: `${side(-1)} ${side(1)}`, exit: `M${f(CX - g.re * s)} ${f(yExit)} H${f(CX + g.re * s)}` };
}

function Part({ id, label, on, lim, pick, children }: { id: PartId; label: string; on: boolean; lim: boolean; pick: (p: PartId) => void; children: ReactNode }) {
  return (
    <g
      className={`sch-part ${on ? "on" : ""} ${lim ? "lim" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={on}
      aria-label={`${label}${lim ? ", at a limit" : ""}`}
      onClick={() => pick(id)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick(id);
        }
      }}
    >
      {children}
    </g>
  );
}

export function EngineSchematic({
  parts,
  design,
  perf,
  base,
  sel,
  lim,
  pick,
  separates,
  name,
}: {
  parts: EngineParts;
  design: EngineDesign;
  perf: Performance;
  /** The base revision's bell, drawn dashed for a diff. */
  base: { perf: Performance; eps: number } | null;
  sel: PartId;
  lim: Record<PartId, boolean>;
  pick: (p: PartId) => void;
  separates: boolean;
  name: string;
}) {
  const g = geometry(perf, design.eps);
  const gb = base ? geometry(base.perf, base.eps) : null;
  const height = (x: Geometry) => x.lcyl + x.lconv + x.ln;
  const width = (x: Geometry) => 2 * Math.max(x.rc, x.re);
  const s = Math.min(ROOM / Math.max(height(g), gb ? height(gb) : 0), 520 / Math.max(width(g), gb ? width(gb) : 0));
  const bell = bellPaths(g, s);
  const bellBase = gb ? bellPaths(gb, s) : null;
  const rcpx = g.rc * s;
  const rtpx = g.rt * s;
  const yThroat = bell.yThroat;
  const chamber = `M${CX - rcpx} ${TOP} H${CX + rcpx} V${TOP + g.lcyl * s} L${CX + rtpx} ${yThroat} H${CX - rtpx} L${CX - rcpx} ${TOP + g.lcyl * s} Z`;
  const dimY = bell.yExit + 16;
  const f = (v: number) => v.toFixed(1);
  const exitDia = 2 * g.re;
  const storable = parts.cycle === "storable";
  const [ox, fu] = storable ? ["NTO", "MMH"] : ["LOX", "RP-1"];
  const pressureFed = parts.cycle === "pressure-fed" || storable;
  const inlet = Math.min(rcpx * 0.8, 40);
  const nozzleLabelY = yThroat + Math.min(60, (bell.yExit - yThroat) * 0.42);
  const nozzleLabelX = Math.min(560, CX + Math.max(rtpx, g.re * s * 0.62) + 20);

  return (
    <svg className="schematic" viewBox="0 0 600 560" role="group" aria-label={`Engine schematic of ${name}: feed system, injector, combustion chamber and nozzle. Select a part to edit.`}>
      <path className="corner" d="M4 20 V4 H20 M580 4 H596 V20 M596 540 V556 H580 M20 556 H4 V540" />
      <path className="feedline" d="M200 10 V40 M400 10 V40" />
      <text x={210} y={26}>
        {ox} ▼
      </text>
      <text x={410} y={26}>
        {fu} ▼
      </text>

      {/* Feed: turbopumps, electric pumps, or a pressurant bottle and tanks. */}
      <Part id="feed" label={pressureFed ? "Pressurant and tanks" : parts.cycle === "electric-pump" ? "Electric pumps" : "Turbopumps"} on={sel === "feed"} lim={lim.feed} pick={pick}>
        <rect className="hit" x={90} y={34} width={420} height={210} />
        {pressureFed ? (
          <>
            <circle className="f" cx={300} cy={74} r={24} />
            <text className="v" x={290} y={79}>
              He
            </text>
            <path className="s" d="M300 98 V114 M288 114 L312 130 V114 L288 130 Z M300 130 V140 M200 140 H400 M200 140 V52 M400 140 V52" />
            <rect className="f" x={170} y={52} width={60} height={92} />
            <rect className="f" x={370} y={52} width={60} height={92} />
            <path className="s" d={`M200 144 V230 H${CX - inlet} M400 144 V230 H${CX + inlet} M${CX - inlet} 230 V246 M${CX + inlet} 230 V246`} />
            <text className="v" x={96} y={100}>
              PT
            </text>
            <text x={96} y={118}>
              {design.pd.toFixed(1)} bar
            </text>
            {lim.feed && (
              <text className="alarm" x={96} y={136}>
                ▲ LIMIT
              </text>
            )}
          </>
        ) : (
          <>
            <path className="s" d={`M200 184 V230 H${CX - inlet} M400 184 V230 H${CX + inlet} M${CX - inlet} 230 V246 M${CX + inlet} 230 V246 M200 40 V116 M400 40 V116`} />
            <circle className="f" cx={200} cy={150} r={34} />
            <circle className="f" cx={400} cy={150} r={34} />
            <path className="s" d="M182 132 L218 168 M218 132 L182 168 M382 132 L418 168 M418 132 L382 168" />
            <text className="v" x={96} y={146}>
              OP-1
            </text>
            <text x={96} y={164}>
              {Math.round(design.pd)} bar
            </text>
            <text className="v" x={446} y={146}>
              FP-1
            </text>
            <text x={446} y={164}>
              {Math.round(perf.pumpPower)} kW
            </text>
            {lim.feed && (
              <text className="alarm" x={96} y={200}>
                ▲ LIMIT
              </text>
            )}
            {parts.cycle === "electric-pump" && (
              <>
                <path className="s" d="M234 150 H268 M332 150 H366 M500 69 H520 V150 H332" />
                <rect className="f" x={268} y={130} width={64} height={40} />
                <text className="v" x={292} y={155}>
                  M
                </text>
                <rect className="f" x={440} y={52} width={60} height={34} />
                <text className="v" x={452} y={74}>
                  BAT
                </text>
              </>
            )}
          </>
        )}
      </Part>

      {parts.cycle === "gas-generator" && (
        <Part id="turbine" label="Gas generator and turbine" on={sel === "turbine"} lim={lim.turbine} pick={pick}>
          <rect className="hit" x={254} y={40} width={92} height={150} />
          <path className="s" d="M200 70 H284 M400 70 H316" style={{ strokeDasharray: "3 3" }} />
          <rect className="f" x={284} y={52} width={32} height={34} />
          <path className="s" d="M300 86 V130 M234 150 H268 M332 150 H366" />
          <rect className="f" x={268} y={130} width={64} height={40} />
          <path className="s" d="M278 134 L286 166 M292 134 L300 166 M306 134 L314 166 M320 134 L328 166 M332 140 H352 V96 H520 V176 M514 168 L520 180 L526 168" />
          <text x={326} y={48}>
            GG-1
          </text>
          <text x={528} y={176}>
            EXH
          </text>
          <text className="v" x={262} y={196}>
            TT-1 {Math.round(design.t0 ?? 900)} K
          </text>
          {lim.turbine && (
            <text className="alarm" x={262} y={214}>
              ▲ LIMIT
            </text>
          )}
        </Part>
      )}

      <Part id="injector" label={`Injector, ${INJECTORS[parts.injector].label}`} on={sel === "injector"} lim={lim.injector} pick={pick}>
        <rect className="hit" x={CX - Math.max(rcpx, 30) - 4} y={238} width={2 * Math.max(rcpx, 30) + 8} height={16} />
        <path className="s" d={`M${CX - rcpx - 4} 249 H${CX + rcpx + 4}`} style={{ strokeWidth: sel === "injector" ? 3 : 2 }} />
        <text x={CX + rcpx + 12} y={244}>
          INJ-1 {INJECTORS[parts.injector].label.split(" ")[0]!.toUpperCase()}
        </text>
      </Part>

      <Part id="chamber" label="Combustion chamber" on={sel === "chamber"} lim={lim.chamber} pick={pick}>
        <rect className="hit" x={CX - Math.max(rcpx, 24)} y={TOP} width={2 * Math.max(rcpx, 24)} height={Math.max(24, yThroat - TOP)} />
        <path className="f" d={chamber} />
        <text className="v" x={CX + Math.max(rcpx, 24) + 12} y={TOP + 22}>
          CC-1
        </text>
        <text x={CX + Math.max(rcpx, 24) + 12} y={TOP + 40}>
          {Math.round(design.pc)} bar
        </text>
        {lim.chamber && (
          <text className="alarm" x={CX + Math.max(rcpx, 24) + 12} y={TOP + 58}>
            ▲ LIMIT
          </text>
        )}
      </Part>

      {bellBase && <path className="base" d={`${bellBase.walls} ${bellBase.exit}`} />}
      <Part id="nozzle" label={`Nozzle, expansion ratio ${design.eps.toFixed(1)}`} on={sel === "nozzle"} lim={lim.nozzle} pick={pick}>
        <path className="hit" d={`M${CX - rtpx - 8} ${yThroat} L${CX - g.re * s - 8} ${bell.yExit + 4} H${CX + g.re * s + 8} L${CX + rtpx + 8} ${yThroat} Z`} />
        <path className="s" d={bell.walls} />
        <path className="s" d={bell.exit} style={{ strokeDasharray: "2 4" }} />
        <path className="dim" d={`M${f(CX - g.re * s)} ${f(dimY - 6)} V${f(dimY + 6)} M${f(CX + g.re * s)} ${f(dimY - 6)} V${f(dimY + 6)} M${f(CX - g.re * s)} ${f(dimY)} H${f(CX + g.re * s)}`} />
        <text x={Math.min(470, CX + g.re * s + 10)} y={dimY + 5}>
          Ø {exitDia.toFixed(2)} m
        </text>
        <text className="v" x={nozzleLabelX} y={nozzleLabelY}>
          NZ-1
        </text>
        <text x={nozzleLabelX} y={nozzleLabelY + 18}>
          ε {design.eps.toFixed(1)}
        </text>
        {separates && (
          <text className="alarm" x={nozzleLabelX} y={nozzleLabelY + 36}>
            ▲ SEPARATION
          </text>
        )}
      </Part>
    </svg>
  );
}

/** Drawing scale, 1:n, for the title block: the schematic's metres per px at a 96 dpi sheet. */
export function drawingScale(perf: Performance, eps: number): number {
  const g = geometry(perf, eps);
  const s = Math.min(ROOM / (g.lcyl + g.lconv + g.ln), 520 / (2 * Math.max(g.rc, g.re)));
  return Math.max(1, Math.round(1 / (s * 0.000264583)));
}
