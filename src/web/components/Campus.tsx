import type { ReactNode } from "react";
import type { Company } from "../../sim/company.ts";
import type { Track } from "../../sim/schedule.ts";
import { useGo, type Route } from "../nav.ts";
import { COLORS } from "../palette.ts";
import { timeline } from "../screens/Work.tsx";

/** What a facility is doing: a job and how far along it is, or nothing. */
type Doing = { busy: boolean; text: string; progress: number | null; firing?: boolean; count?: number };

const W = 150;
const GROUND = 214;

function trackDoing(company: Company, rows: ReturnType<typeof timeline>, track: Track): Doing {
  const mine = rows.filter((r) => r.task.track === track);
  const running = mine.filter((r) => r.task.startDay !== undefined).sort((a, b) => (a.end ?? 0) - (b.end ?? 0));
  const queued = mine.length - running.length;
  const count = company.units[track].filter((d) => d <= company.day).length;
  const cur = running[0];
  if (!cur || cur.end === undefined) return { busy: false, text: queued > 0 ? `idle · ${queued} queued` : "idle", progress: null, count };
  const span = Math.max(1, cur.end - cur.task.startDay!);
  const title = cur.task.title.length > 26 ? `${cur.task.title.slice(0, 25)}…` : cur.task.title;
  return {
    busy: true,
    text: `${title} → d${cur.end}${running.length > 1 ? ` · +${running.length - 1}` : ""}${queued > 0 ? ` · ${queued} queued` : ""}`,
    progress: Math.min(1, (company.day - cur.task.startDay!) / span),
    firing: cur.task.spec.kind === "fire" || cur.task.spec.kind === "pad-abort",
    count,
  };
}

function factoryDoing(company: Company): Doing {
  const building = company.orders.filter((o) => o.startDay <= company.day).sort((a, b) => a.readyDay - b.readyDay);
  const waiting = company.orders.length - building.length;
  const cur = building[0];
  const count = company.lines.length;
  if (!cur) return { busy: false, text: waiting > 0 ? `${waiting} ordered` : "no orders", progress: null, count };
  const name = company.designs[cur.design]?.name ?? cur.design;
  return { busy: true, text: `${name} → d${cur.readyDay}${building.length + waiting > 1 ? ` · +${building.length + waiting - 1}` : ""}`, progress: Math.min(1, (company.day - cur.startDay) / Math.max(1, cur.readyDay - cur.startDay)), count };
}

function padDoing(company: Company): Doing {
  const ready = Object.entries(company.inventory).filter(([, n]) => n > 0);
  if (ready.length > 0) {
    const [key, n] = ready[0]!;
    return { busy: true, text: `${n > 1 ? `${n} × ` : ""}${company.designs[key]?.name ?? key} ready`, progress: null };
  }
  const next = company.orders.length > 0 ? Math.min(...company.orders.map((o) => o.readyDay)) : null;
  return { busy: false, text: next !== null ? `next rollout d${next}` : "empty", progress: null };
}

/** One facility: its drawing, name, what it's doing, and a link to where it's run from. */
function Facility({ x, name, doing, route, children }: { x: number; name: string; doing: Doing; route: Route; children: ReactNode }) {
  const go = useGo();
  const open = () => go(route);
  return (
    <g
      className={`facility ${doing.busy ? "busy" : ""}`}
      transform={`translate(${x} 0)`}
      role="button"
      tabIndex={0}
      aria-label={`${name}: ${doing.text}`}
      onClick={open}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open())}
    >
      <rect x={-6} y={60} width={W + 12} height={GROUND - 48 + 70} fill="transparent" />
      {children}
      <text className="campus-name" x={0} y={GROUND + 24}>
        {name.toUpperCase()}
        {doing.count !== undefined && doing.count > 1 ? ` ×${doing.count}` : ""}
      </text>
      <text className="campus-sub" x={0} y={GROUND + 40}>
        {doing.text}
      </text>
      {doing.progress !== null && (
        <>
          <rect x={0} y={GROUND + 48} width={W - 20} height={4} rx={2} fill={COLORS.line} />
          <rect x={0} y={GROUND + 48} width={(W - 20) * doing.progress} height={4} rx={2} fill={COLORS.action} />
        </>
      )}
    </g>
  );
}

/**
 * Port Avery: the company's facilities as one drawing. Each shows what it's
 * doing and how far along, comes alive while busy, and opens where it's run.
 */
export function Campus({ company }: { company: Company }) {
  const rows = timeline(company);
  const stand = trackDoing(company, rows, "stand");
  const cell = trackDoing(company, rows, "cell");
  const tunnel = trackDoing(company, rows, "tunnel");
  const office = trackDoing(company, rows, "office");
  const range = trackDoing(company, rows, "range");
  const regulator = trackDoing(company, rows, "regulator");
  const factory = factoryDoing(company);
  const pad = padDoing(company);
  const plume = (cx: number, y: number, w: number) => (
    <path className="plume" d={`M${cx - w} ${y} Q${cx - w * 0.6} ${y + 26} ${cx} ${y + 34} Q${cx + w * 0.6} ${y + 26} ${cx + w} ${y}Z`} fill="url(#campus-flame)" />
  );
  const stroke = (busy: boolean) => (busy ? COLORS.action : COLORS.data);

  return (
    <div className="campus" aria-label="Port Avery">
      <svg viewBox="0 0 1290 290" role="group" aria-label="The company's facilities">
        <defs>
          <linearGradient id="campus-flame" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff6e0" />
            <stop offset="0.4" stopColor={COLORS.action} />
            <stop offset="1" stopColor={COLORS.action} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={0} x2={1290} y1={GROUND} y2={GROUND} stroke={COLORS.lineStrong} />

        <Facility x={20} name="Launch pad" doing={pad} route={{ place: "launch" }}>
          <g fill={COLORS.panel} stroke={stroke(pad.busy)} strokeWidth={1.4}>
            <rect x={22} y={70} width={9} height={GROUND - 70} />
            <path d={`M31 92h12M31 130h12M31 168h12`} fill="none" />
            {pad.busy && <path d={`M52 104c0-14 5-26 9-30 4 4 9 16 9 30v${GROUND - 112}H52z`} />}
            <rect x={6} y={GROUND - 8} width={100} height={8} />
          </g>
        </Facility>

        <Facility x={180} name="Sea-level stand" doing={stand} route={{ place: "testing" }}>
          <g fill={COLORS.panel} stroke={stroke(stand.busy)} strokeWidth={1.4}>
            <path d={`M10 ${GROUND}V96h70v${GROUND - 96}`} />
            <path d="M10 96l35-24 35 24" />
            <path d="M38 122h14l-2 16h4l6 26H30l6-26h4z" />
          </g>
          {stand.firing && plume(45, 164, 13)}
        </Facility>

        <Facility x={340} name="Altitude cell" doing={cell} route={{ place: "testing" }}>
          <g fill={COLORS.panel} stroke={stroke(cell.busy)} strokeWidth={1.4}>
            <path d={`M10 ${GROUND}v-66a48 48 0 0 1 96 0v66`} />
            <path d="M58 100v-22M50 78h16" fill="none" />
          </g>
          {cell.firing && plume(58, 168, 10)}
        </Facility>

        <Facility x={500} name="Wind tunnel" doing={tunnel} route={{ place: "testing", tab: "tunnel" }}>
          <g fill={COLORS.panel} stroke={stroke(tunnel.busy)} strokeWidth={1.4}>
            <path d={`M6 ${GROUND - 32}h36l18-14h64l18 14h12v32H6z`} />
            <path d={`M78 ${GROUND - 39}h30`} fill="none" strokeDasharray="3 3" className={tunnel.busy ? "flow" : undefined} />
          </g>
        </Facility>

        <Facility x={680} name="Engineering office" doing={office} route={{ place: "home", tab: "work" }}>
          <g fill={COLORS.panel} stroke={stroke(office.busy)} strokeWidth={1.4}>
            <rect x={10} y={120} width={92} height={GROUND - 120} />
            <path d="M26 140h14M62 140h14M26 166h14M62 166h14M26 192h14M62 192h14" fill="none" />
          </g>
        </Facility>

        <Facility x={830} name="Factory" doing={factory} route={{ place: "launch", tab: "factory" }}>
          <g fill={COLORS.panel} stroke={stroke(factory.busy)} strokeWidth={1.4}>
            <path d={`M8 ${GROUND}V132l30 18v-18l30 18v-18l30 18v${GROUND - 150}z`} />
          </g>
        </Facility>

        <Facility x={990} name="Test range" doing={range} route={{ place: "launch", tab: "crew" }}>
          <g fill={COLORS.panel} stroke={stroke(range.busy)} strokeWidth={1.4}>
            <path d={`M10 ${GROUND}v-26h50v26`} />
            <path d={`M70 ${GROUND}V150M70 150l14 10`} fill="none" />
          </g>
          {range.firing && plume(70, GROUND - 4, 8)}
        </Facility>

        <Facility x={1140} name="Regulator" doing={regulator} route={{ place: "home", tab: "company" }}>
          <g fill={COLORS.panel} stroke={stroke(regulator.busy)} strokeWidth={1.4}>
            <path d={`M10 ${GROUND}V150h80v${GROUND - 150}`} />
            <path d="M4 150l46-26 46 26z" />
            <path d={`M28 ${GROUND}v-48M50 ${GROUND}v-48M72 ${GROUND}v-48`} fill="none" />
          </g>
        </Facility>
      </svg>
    </div>
  );
}
