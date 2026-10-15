import { developedParts, type Company } from "../sim/company.ts";
import { P_SEA_LEVEL } from "../sim/constants.ts";
import { flowSeparates, ispAt, thrustAt, type Engine } from "../sim/engine.ts";
import { engineMass } from "../sim/builder.ts";
import {
  BLADE_REDLINE,
  buildable,
  defaultDesign,
  DESIGN_RANGES,
  designEngine,
  designLimits,
  designOf,
  MAX_TANK_PRESSURE,
  maxDrivenPressure,
  MIN_PUMP_MARGIN,
  motorLimit,
  nozzleFor,
  performance,
  REFERENCE_PC,
  referenceEps,
  sameDesign,
  seaLevelEps,
  type EngineDesign,
  type Limit,
  type LimitId,
  type Performance,
} from "../sim/enginePhysics.ts";
import { COOLINGS, CYCLES, developmentCost, engineRanges, INJECTORS, NOZZLES, partKey, partLabel, type CycleOption, type EngineParts, type NozzleOption } from "../sim/parts.ts";
import { twinOf, type Task } from "../sim/schedule.ts";

/**
 * The engine Design screen's working: which engines are programmes with
 * revisions, what a draft design point does to every readout and limit,
 * and the curves the sliders run along. All figures come from the sim's
 * engine model; nothing here is physics.
 */

export const G = 9.80665;

/** "A", "B", … */
export const revLetter = (rev: number) => String.fromCharCode(65 + rev);

export type Revision = { engine: Engine; rev: number; pending?: false } | { engine: Engine; rev: number; pending: true; task: Task };

/** An engine programme: its revisions, oldest first. */
export type Family = { id: string; name: string; revisions: Revision[] };

/** The engine's name for a revision: Rev A carries the bare family name. */
export const revisionName = (family: string, rev: number) => (rev === 0 ? family : `${family} ${revLetter(rev)}`);

/** Every engine the company has or is developing, grouped into programmes, with drawing IDs ENG-01… in order of first appearance. */
export function families(company: Company): Family[] {
  const byName = new Map<string, Family>();
  const add = (engine: Engine, pending?: Task) => {
    if (!engine.parts) return;
    const name = engine.family ?? engine.name;
    let f = byName.get(name);
    if (!f) {
      f = { id: `ENG-${String(byName.size + 1).padStart(2, "0")}`, name, revisions: [] };
      byName.set(name, f);
    }
    const rev = engine.rev ?? 0;
    f.revisions.push(pending ? { engine, rev, pending: true, task: pending } : { engine, rev });
  };
  for (const engine of Object.values(company.campaign.engines)) add(engine);
  for (const task of company.tasks) {
    if (task.spec.kind !== "develop") continue;
    const s = task.spec;
    add(s.design ? designEngine(s.parts, s.design, s.name, { family: s.family, rev: s.rev }) : { name: s.name, thrustVac: 0, ispVac: 0, exitArea: 0, exitPressure: 0, parts: s.parts, family: s.family, rev: s.rev }, task);
  }
  for (const f of byName.values()) f.revisions.sort((a, b) => a.rev - b.rev);
  return [...byName.values()];
}

export type PartId = "nozzle" | "chamber" | "injector" | "feed" | "turbine";

const PRESSURE_FED = (c: CycleOption) => c === "pressure-fed" || c === "storable";

/** The schematic's parts for a cycle, with drawing IDs. */
export function partsFor(cycle: CycleOption): Array<{ id: PartId; tag: string; name: string }> {
  const feed = cycle === "gas-generator" ? { tag: "TP-1", name: "TURBOPUMPS" } : cycle === "electric-pump" ? { tag: "EP-1", name: "ELECTRIC PUMPS" } : { tag: "PF-1", name: "PRESSURANT" };
  return [
    { id: "nozzle", tag: "NZ-1", name: "NOZZLE" },
    { id: "chamber", tag: "CC-1", name: "CHAMBER" },
    { id: "injector", tag: "INJ-1", name: "INJECTOR" },
    { id: "feed", ...feed },
    ...(cycle === "gas-generator" ? [{ id: "turbine" as const, tag: "TT-1", name: "TURBINE" }] : []),
  ];
}

/** Which limits each part owns, for its ▲ flags. */
export const PART_LIMITS: Record<PartId, LimitId[]> = {
  nozzle: ["separation-sl"],
  chamber: ["size-for-cycle"],
  injector: [],
  feed: ["pump-margin", "motor-power", "tank-pressure"],
  turbine: ["blade-temp", "turbine-power"],
};

/** A continuous parameter on a part. */
export type ParamSpec = { key: keyof EngineDesign; sym: string; name: string; unit: string; min: number; max: number; step: number; dec: number; info: string };

export function paramFor(part: PartId, cycle: CycleOption): ParamSpec | null {
  const r = DESIGN_RANGES[cycle];
  switch (part) {
    case "nozzle":
      return { key: "eps", sym: "ε", name: "EXPANSION RATIO", unit: ":1", min: r.eps[0], max: r.eps[1], step: 0.5, dec: 1, info: "Bigger bell: more vacuum Isp, separates at sea level." };
    case "chamber":
      return { key: "pc", sym: "Pc", name: "CHAMBER PRESSURE", unit: "bar", min: r.pc[0], max: r.pc[1], step: 1, dec: 0, info: "More pressure: more thrust, shorter life, harder pumps." };
    case "feed":
      return PRESSURE_FED(cycle)
        ? { key: "pd", sym: "PT", name: "TANK PRESSURE", unit: "bar", min: r.pd[0], max: r.pd[1], step: 0.5, dec: 1, info: "Tank pressure feeds the chamber. Heavier tanks above it." }
        : { key: "pd", sym: "Pd", name: "DISCHARGE PRESSURE", unit: "bar", min: r.pd[0], max: r.pd[1], step: 1, dec: 0, info: "Must beat chamber pressure by 20 % to keep injection stiff." };
    case "turbine":
      return r.t0 ? { key: "t0", sym: "T0", name: "INLET TEMPERATURE", unit: "K", min: r.t0[0], max: r.t0[1], step: 5, dec: 0, info: `Hotter gas, less turbine flow. Blades redline at ${BLADE_REDLINE} K.` } : null;
    case "injector":
      return null;
  }
}

/** What a draft design point comes to, against the revision it starts from. */
export type Draft = {
  parts: EngineParts;
  design: EngineDesign;
  perf: Performance;
  engine: Engine;
  limits: Limit[];
  ok: boolean;
  /** The base revision's engine as it stands: its own numbers. */
  base: Engine | null;
  changed: boolean;
};

export function draft(parts: EngineParts, design: EngineDesign, base: Engine | null): Draft {
  const perf = performance(parts, design);
  const baseDesign = base ? designOf(base) : null;
  const changed = !base || !baseDesign || !sameDesign(design, baseDesign) || (["size", "cycle", "injector", "cooling"] as const).some((k) => base.parts![k] !== parts[k]) || base.parts!.nozzle !== perf.parts.nozzle;
  // An engine drawn before the model flies its own numbers until a new revision is drawn.
  const engine = !changed && base ? base : designEngine(parts, design, "draft");
  const limits = designLimits(parts, design, perf);
  return { parts: perf.parts, design, perf, engine, limits, ok: buildable(limits), base, changed };
}

/** A readout: label, value, unit, a bar between its scale ends, Δ against the base revision, and a limit tag. */
export type ReadoutValue = { key: string; label: string; value: number; dec: number; unit: string; lo: number; hi: number; delta: number | null; tag?: string };

export function readouts(d: Draft): ReadoutValue[] {
  const e = d.engine;
  // Against an engine drawn before the model, compare with the model at its design point: Δ is what the change does, not the redraw.
  const b = d.base && !d.base.design && d.base.parts ? designEngine(d.base.parts, designOf(d.base)!, d.base.name) : d.base;
  const sep = flowSeparates(e, P_SEA_LEVEL);
  const islSl = (x: Engine) => (flowSeparates(x, P_SEA_LEVEL) ? 0 : ispAt(x, P_SEA_LEVEL));
  const thrSl = (x: Engine) => (flowSeparates(x, P_SEA_LEVEL) ? 0 : thrustAt(x, P_SEA_LEVEL) / 1000);
  const mass = (x: Engine) => engineMass(x);
  const tw = (x: Engine) => x.thrustVac / (mass(x) * G);
  const rel = (x: Engine) => {
    const r = engineRanges(x)!;
    return (1 - r.hardStart) * (1 - r.instability) * 100;
  };
  const size = d.parts.size * 1000;
  const refMass = size / (G * (PRESSURE_FED(d.parts.cycle) ? 40 : 70));
  const delta = (f: (x: Engine) => number) => (b && d.changed ? f(e) - f(b) : null);
  return [
    { key: "isp-sl", label: "ISP SL", value: islSl(e), dec: 1, unit: "s", lo: 150, hi: 320, delta: sep ? null : delta(islSl), tag: sep ? "▲ SEPARATES" : undefined },
    { key: "isp-vac", label: "ISP VAC", value: e.ispVac, dec: 1, unit: "s", lo: 250, hi: 370, delta: delta((x) => x.ispVac) },
    { key: "thrust-sl", label: "THRUST SL", value: thrSl(e), dec: 1, unit: "kN", lo: 0, hi: (size * 2) / 1000, delta: sep ? null : delta(thrSl), tag: sep ? "▲ SEPARATES" : undefined },
    { key: "mass", label: "DRY MASS", value: mass(e), dec: 0, unit: "kg", lo: refMass * 0.5, hi: refMass * 2.5, delta: delta(mass) },
    { key: "tw", label: "T/W", value: tw(e), dec: 0, unit: "", lo: 20, hi: 120, delta: delta(tw) },
    { key: "rel", label: "RELIABILITY", value: rel(e), dec: 1, unit: "%", lo: 50, hi: 100, delta: delta(rel) },
    { key: "cost", label: "UNIT COST", value: (e.unitCost ?? 0) / 1000, dec: 2, unit: "$M", lo: 0, hi: Math.max(0.2, ((b?.unitCost ?? e.unitCost ?? 0) * 2) / 1000), delta: delta((x) => (x.unitCost ?? 0) / 1000) },
  ];
}

/** The rubber stamp on the drawing. */
export type StampState = { text: string; tone: "alarm" | "muted" | "line"; sub: string };

export function stamp(d: Draft, rev: number, pending: Task | undefined, today: number): StampState {
  if (!d.ok) return { text: "✕ NO-GO", tone: "alarm", sub: "RESOLVE LIMITS" };
  if (d.changed) return { text: "DRAFT", tone: "muted", sub: `REV ${revLetter(d.base ? rev + 1 : 0)} UNCOMMITTED` };
  if (pending) return { text: "IN WORK", tone: "muted", sub: `REV ${revLetter(rev)} · ${pending.startDay !== undefined ? `D-${(pending.endDay ?? today) - today}` : "QUEUED"}` };
  return { text: "RELEASED", tone: "line", sub: `REV ${revLetter(rev)} · READY TO TEST` };
}

/** What committing the draft would cost, and what stops it. */
export function commitQuote(company: Company, d: Draft, name: string) {
  const quote = developmentCost(d.parts, developedParts(company));
  const twin = twinOf(company, d.parts, d.design);
  const taken = !!company.campaign.engines[name] || company.tasks.some((t) => t.spec.kind === "develop" && t.spec.name === name);
  const blocked = !d.ok ? "BLOCKED · LIMITS" : !d.changed ? "NO CHANGES" : twin ? `SAME AS ${twin.toUpperCase()}` : taken ? "NAME TAKEN" : name.trim() === "" ? "NAME IT" : null;
  return { ...quote, blocked };
}

/** A curve for the selected parameter: one or two traces swept through the model, and the redlines where a limit trips. */
export type Curve = {
  xs: number[];
  a: { label: string; ys: number[] };
  b?: { label: string; ys: number[] };
  redlines: Array<{ x: number; label: string; dotted?: boolean }>;
  /** Thin marks where the nozzle part changes, with the part's short name. */
  bands?: Array<{ x: number; label: string }>;
};

const NOZZLE_SHORT: Record<NozzleOption, string> = { "sea-level": "SL", altitude: "ALT", vacuum: "VAC", "large-vacuum": "XL" };

export function curveFor(part: PartId, parts: EngineParts, design: EngineDesign): Curve | null {
  const p = paramFor(part, parts.cycle);
  if (!p) return null;
  const n = 64;
  const xs = Array.from({ length: n + 1 }, (_, i) => p.min + ((p.max - p.min) * i) / n);
  const at = (x: number) => ({ ...design, [p.key]: x });
  const perf = xs.map((x) => performance(parts, at(x)));
  const eng = xs.map((x) => designEngine(parts, at(x), "c"));
  switch (part) {
    case "nozzle": {
      const sl = eng.map((e) => (flowSeparates(e, P_SEA_LEVEL) ? NaN : ispAt(e, P_SEA_LEVEL)));
      const order: NozzleOption[] = ["sea-level", "altitude", "vacuum", "large-vacuum"];
      const bands = order.slice(1).map((nz, i) => ({ x: Math.sqrt(referenceEps(parts.cycle, order[i]!) * referenceEps(parts.cycle, nz)), label: NOZZLE_SHORT[nz] }));
      return {
        xs,
        a: { label: "ISP VAC s", ys: perf.map((q) => q.ispVac) },
        b: { label: "ISP SL s", ys: sl },
        redlines: [{ x: seaLevelEps(parts.cycle, design.pc), label: "SEP @ SL" }],
        bands: bands.filter((b) => b.x > p.min && b.x < p.max),
      };
    }
    case "chamber":
      return {
        xs,
        a: { label: "THRUST VAC kN", ys: perf.map((q) => q.thrustVac / 1000) },
        b: { label: "LIFE ×100 s", ys: perf.map((q) => q.ratedLife / 100) },
        redlines: [{ x: design.pd / MIN_PUMP_MARGIN, label: "PUMP LIMIT" }],
      };
    case "feed": {
      const red: Curve["redlines"] = [{ x: design.pc * MIN_PUMP_MARGIN, label: "MIN MARGIN" }];
      if (parts.cycle === "gas-generator") red.push({ x: maxDrivenPressure(design.t0 ?? 900), label: "TURBINE MAX", dotted: true });
      if (parts.cycle === "electric-pump") {
        const cap = motorLimit(parts);
        const i = perf.findIndex((q) => q.pumpPower > cap);
        if (i > 0) red.push({ x: xs[i]!, label: "MOTOR MAX", dotted: true });
      }
      if (PRESSURE_FED(parts.cycle)) red.push({ x: MAX_TANK_PRESSURE, label: "TANK MAX", dotted: true });
      return { xs, a: { label: "INSTABILITY %", ys: perf.map((q) => q.instability * 100) }, b: { label: "ISP VAC s ÷10", ys: perf.map((q) => q.ispVac / 10) }, redlines: red };
    }
    case "turbine":
      return {
        xs,
        a: { label: "ISP VAC s", ys: perf.map((q) => q.ispVac) },
        redlines: [
          { x: BLADE_REDLINE, label: "BLADE REDLINE" },
          ...(() => {
            const i = xs.findIndex((x) => maxDrivenPressure(x) >= design.pd);
            return i > 0 ? [{ x: xs[i]!, label: "TURBINE POWER", dotted: true }] : [];
          })(),
        ],
      };
    default:
      return null;
  }
}

/** Spec rows for a part: terse, monospace. */
export function specRows(part: PartId, d: Draft, developed: Set<string>): Array<[string, string]> {
  const { perf, design, parts } = d;
  const f = (v: number, dec = 1) => v.toFixed(dec);
  const dia = (area: number) => Math.sqrt((4 * area) / Math.PI);
  const isNew = (slot: "cycle" | "injector" | "cooling" | "nozzle") => (developed.has(partKey(parts, slot)) ? "IN PRODUCTION" : "NEW PART");
  switch (part) {
    case "nozzle":
      return [
        ["EXIT Ø", `${f(dia(perf.exitArea), 2)} m`],
        ["EXIT PRESSURE", `${f(perf.exitPressure / 1000)} kPa`],
        ["SEP LIMIT ε", f(seaLevelEps(parts.cycle, design.pc))],
        ["PART", `${NOZZLES[parts.nozzle].label.toUpperCase()} · ${isNew("nozzle")}`],
      ];
    case "chamber":
      return [
        ["THROAT Ø", `${f(dia(perf.throatArea), 3)} m`],
        ["RATED LIFE", `${perf.ratedLife} s`],
        ["COOLING", `${COOLINGS[parts.cooling].label.toUpperCase()} · ${isNew("cooling")}`],
        ["REF Pc", `${REFERENCE_PC[parts.cycle]} bar`],
      ];
    case "injector":
      return [
        ["TYPE", `${INJECTORS[parts.injector].label.toUpperCase()} · ${isNew("injector")}`],
        ["INSTABILITY", `${f(perf.instability * 100)} %`],
        ["ISP SPREAD", `${f((1 - INJECTORS[parts.injector].isp[0]) * 100)} %`],
      ];
    case "feed":
      return PRESSURE_FED(parts.cycle)
        ? [
            ["CYCLE", `${CYCLES[parts.cycle].label.toUpperCase()} · ${isNew("cycle")}`],
            ["MARGIN PT/Pc", f(perf.pumpMargin, 2)],
            ["TANK MAX", `${MAX_TANK_PRESSURE} bar`],
          ]
        : [
            ["CYCLE", `${CYCLES[parts.cycle].label.toUpperCase()} · ${isNew("cycle")}`],
            ["MARGIN Pd/Pc", f(perf.pumpMargin, 2)],
            ["SHAFT POWER", `${Math.round(perf.pumpPower)} kW`],
          ];
    case "turbine":
      return [
        ["TURBINE FLOW", `${f(perf.turbineFlow * 100)} %`],
        ["BLADE MARGIN", `${Math.round(BLADE_REDLINE - (design.t0 ?? 900))} K`],
        ["MAX Pd DRIVEN", `${Math.round(maxDrivenPressure(design.t0 ?? 900))} bar`],
      ];
  }
}

/** Switching cycle: keep the bell's part and the size where the new cycle allows, from that cycle's own reference point. */
export function switchCycle(parts: EngineParts, design: EngineDesign, cycle: CycleOption): { parts: EngineParts; design: EngineDesign } {
  const sizes = CYCLES[cycle].sizes;
  const size = sizes.includes(parts.size) ? parts.size : sizes.reduce((a, s) => (Math.abs(s - parts.size) < Math.abs(a - parts.size) ? s : a), sizes[0]!);
  const nozzle = nozzleFor(parts.cycle, design.eps);
  const next = { ...parts, cycle, size, nozzle };
  return { parts: next, design: defaultDesign(next) };
}

/** A starting point for a new engine. */
export function blankEngine(): { parts: EngineParts; design: EngineDesign } {
  const parts: EngineParts = { size: 25, cycle: "gas-generator", injector: "coaxial", cooling: "film", nozzle: "sea-level" };
  return { parts, design: defaultDesign(parts) };
}

/** A name for a new programme the company hasn't used. */
export function suggestFamily(parts: EngineParts, taken: (name: string) => boolean): string {
  const stem = { "pressure-fed": "WREN", "electric-pump": "SWIFT", "gas-generator": "OSPREY", storable: "PETREL" }[parts.cycle];
  let i = 1;
  while (taken(`${stem}-${i}`)) i++;
  return `${stem}-${i}`;
}

export { partLabel };
