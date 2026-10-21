import { useState } from "react";
import type { Company } from "../../sim/company.ts";
import { NETWORK, orderSatellites, revenueFor, working, type Satellite } from "../../sim/network.ts";
import { Chip } from "../components/Bits.tsx";
import { Info } from "../components/Info.tsx";
import { money } from "../format.ts";
import { game } from "../game.ts";
import { useGo } from "../nav.ts";
import { COLORS } from "../palette.ts";

/**
 * The network's control center: where every satellite is, how it is doing,
 * what the service has earned, and what needs replacing next. Health is
 * what the ground can see from telemetry: age against the design life,
 * station-keeping fuel and the battery. The real end of each satellite's
 * life stays hidden until it comes.
 */

type Health = { key: "nominal" | "aging" | "eol" | "lost"; label: string; tone: "good" | "warn" | "bad" | "muted"; life: number; fuel: number; battery: number };

/** What telemetry says about a satellite today. */
export function healthOf(s: Satellite, day: number): Health {
  const age = Math.max(0, day - s.launched);
  const life = age / NETWORK.life;
  // Out of spec, half the fuel went on reaching the slot.
  const fuel = Math.max(0, (s.inSpec === false ? 0.5 : 1) - age / NETWORK.life);
  const battery = Math.max(0, 1 - 0.2 * Math.min(1.5, life));
  if (s.end <= day) return { key: "lost", label: `LOST D ${s.end}`, tone: "muted", life, fuel, battery };
  if (life >= 1 || fuel <= 0.05) return { key: "eol", label: "END OF LIFE", tone: "bad", life, fuel, battery };
  if (life >= 0.7 || fuel < 0.3) return { key: "aging", label: "AGING", tone: "warn", life, fuel, battery };
  return { key: "nominal", label: "NOMINAL", tone: "good", life, fuel, battery };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The constellation from above its plane: the planned slots round the orbit, each satellite in its slot, the gaps marked. */
function OrbitView({ sats, day }: { sats: Satellite[]; day: number }) {
  const size = 320;
  const c = size / 2;
  const earth = 92;
  const ring = 132;
  const live = sats.filter((s) => s.end > day);
  const bySlot = new Map<number, Satellite>();
  for (const s of live) if (s.slot !== undefined && !bySlot.has(s.slot)) bySlot.set(s.slot, s);
  const at = (slot: number, r = ring): [number, number] => {
    const a = (slot / NETWORK.planned) * 2 * Math.PI;
    return [c + r * Math.sin(a), c - r * Math.cos(a)];
  };
  const step = 360 / NETWORK.planned;
  // Gaps: runs of two or more empty slots, which leave the ground uncovered for part of each orbit.
  // Walk once round from a filled slot; a run may pass the last slot and wrap, which `at` handles.
  const n = NETWORK.planned;
  const start = Array.from({ length: n }, (_, i) => i).find((i) => bySlot.has(i));
  const runs: Array<[number, number]> = [];
  if (start !== undefined) {
    for (let i = start + 1; i < start + n; i++) {
      if (bySlot.has(i % n)) continue;
      const last = runs.at(-1);
      if (last && last[1] === i - 1) last[1] = i;
      else runs.push([i, i]);
    }
  }
  const wide = runs.filter(([a, b]) => b > a);
  const arc = ([a, b]: [number, number]) => {
    const [x0, y0] = at(a - 0.4, ring);
    const [x1, y1] = at(b + 0.4, ring);
    const large = (b - a + 0.8) * step > 180 ? 1 : 0;
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${ring} ${ring} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const tone = (s: Satellite) => {
    const h = healthOf(s, day).key;
    return h === "nominal" ? COLORS.good : h === "aging" ? COLORS.caution : COLORS.bad;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Network orbit: ${live.length} of ${NETWORK.planned} slots filled, ${wide.length} gap${wide.length === 1 ? "" : "s"}`} className="control-orbit" style={{ width: "100%", maxWidth: 360, height: "auto" }}>
      <circle cx={c} cy={c} r={earth} fill={COLORS.dataDeep} opacity={0.35} />
      <circle cx={c} cy={c} r={earth} fill="none" stroke={COLORS.data} strokeWidth={1} opacity={0.6} />
      {/* Port Avery and its ground station. */}
      <circle cx={c} cy={c - earth} r={3.5} fill={COLORS.action} />
      <text x={c} y={c - earth + 16} textAnchor="middle" style={{ fill: COLORS.action, fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.1em" }}>
        PORT AVERY
      </text>
      <circle cx={c} cy={c} r={ring} fill="none" stroke={COLORS.data} strokeWidth={1} strokeDasharray="2 4" opacity={0.7} />
      <g className="control-orbit-spin">
        {wide.map((g) => (
          <path key={g[0]} d={arc(g)} fill="none" stroke={COLORS.bad} strokeWidth={4} opacity={0.55} />
        ))}
        {Array.from({ length: NETWORK.planned }, (_, i) => {
          const s = bySlot.get(i);
          const [x, y] = at(i);
          return s ? (
            <g key={i}>
              <circle cx={x} cy={y} r={6} fill={tone(s)} />
              <title>{`S${String(s.id).padStart(2, "0")} · slot ${i + 1} · ${healthOf(s, day).label}`}</title>
            </g>
          ) : (
            <circle key={i} cx={x} cy={y} r={3.5} fill="none" stroke={COLORS.faint} strokeWidth={1.2} />
          );
        })}
      </g>
      <text x={c} y={c - 4} textAnchor="middle" style={{ fill: COLORS.text, fontFamily: "var(--mono)", fontSize: 22 }}>
        {live.length}/{NETWORK.planned}
      </text>
      <text x={c} y={c + 14} textAnchor="middle" style={{ fill: COLORS.muted, fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.12em" }}>
        {NETWORK.km} KM · {NETWORK.inclination}°
      </text>
    </svg>
  );
}

/** The last twelve months of service bills: income bars against ground operations. */
function ServiceHistory({ company }: { company: Company }) {
  const months = new Map<number, { income: number; ops: number }>();
  for (const e of company.ledger) {
    if (e.category === "network" || (e.category === "satellites" && e.note === "Network ground operations")) {
      const m = months.get(e.day) ?? { income: 0, ops: 0 };
      if (e.category === "network") m.income += e.amount;
      else m.ops -= e.amount;
      months.set(e.day, m);
    }
  }
  const rows = [...months.entries()].sort((a, b) => a[0] - b[0]).slice(-12);
  if (rows.length === 0) return <span className="muted">No bills yet: the first comes a month after the charter.</span>;
  const top = Math.max(NETWORK.fullRevenue, ...rows.map(([, m]) => m.income)) * 1.08;
  // Bars stretch to the card; the day labels sit under them as text, so they keep their size.
  const w = 12;
  const h = 100;
  return (
    <div className="service-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Service income, last ${rows.length} months`}>
        <line x1={0} x2={w} y1={h - (h * NETWORK.fullRevenue) / top} y2={h - (h * NETWORK.fullRevenue) / top} stroke={COLORS.good} strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.6} />
        {rows.map(([day, m], i) => {
          const bh = (h * m.income) / top;
          return (
            <g key={day}>
              <rect x={i + 0.15} y={h - bh} width={0.7} height={Math.max(bh, 0.5)} fill={m.income > 0 ? COLORS.good : COLORS.faint} />
              <rect x={i + 0.15} y={h - 2} width={0.7} height={2} fill={COLORS.bad} opacity={0.8} />
              <title>{`Day ${day}: ${money(m.income)} service, ${money(m.ops)} operations`}</title>
            </g>
          );
        })}
      </svg>
      <div className="service-days mono" aria-hidden="true">
        {rows.map(([day]) => (
          <span key={day}>D {day}</span>
        ))}
      </div>
    </div>
  );
}

export function Control({ company }: { company: Company }) {
  const go = useGo();
  const network = company.network;
  const [showLost, setShowLost] = useState(false);
  if (!network) {
    return (
      <div className="card" style={{ alignItems: "flex-start" }}>
        <p className="label">Control center</p>
        <span className="soft">No network to control yet. Charter one on the Network tab once the market reaches era 2.</span>
        <button type="button" className="btn primary" onClick={() => go({ place: "launch", tab: "network" })}>
          Go to Network <span className="note">charter</span>
        </button>
      </div>
    );
  }
  const day = company.day;
  const live = network.sats.filter((s) => s.end > day);
  const count = working(network, day);
  const health = network.sats.map((s) => ({ s, h: healthOf(s, day) }));
  const order = { eol: 0, aging: 1, nominal: 2, lost: 3 } as const;
  const shown = health.filter(({ h }) => showLost || h.key !== "lost").sort((a, b) => order[a.h.key] - order[b.h.key] || b.h.life - a.h.life);
  const meanAge = live.length > 0 ? Math.round(live.reduce((n, s) => n + (day - s.launched), 0) / live.length) : 0;
  const bills = company.ledger.filter((e) => e.category === "network");
  const billed = company.ledger.filter((e) => e.category === "satellites" && e.note === "Network ground operations").length;
  // By design life, not the hidden truth: what the ground can plan on.
  const dueSoon = live.filter((s) => s.launched + NETWORK.life * (s.inSpec === false ? 0.5 : 1) <= day + 180).length;
  const short = Math.max(0, NETWORK.planned - count - network.stored - network.orders.reduce((n, o) => n + o.count, 0));
  const replace = Math.max(short, dueSoon);
  const events = [
    ...[...new Map(network.sats.map((s) => [s.launched, network.sats.filter((x) => x.launched === s.launched).length])).entries()].map(([d, n]) => ({ day: d, text: `${n} satellite${n === 1 ? "" : "s"} launched into service`, tone: "good" })),
    ...network.sats.filter((s) => s.end <= day).map((s) => ({ day: s.end, text: `S${String(s.id).padStart(2, "0")} stopped working after ${s.end - s.launched} days`, tone: "bad" })),
    ...(network.serviceDay !== undefined ? [{ day: network.serviceDay, text: "Coverage reached: service began", tone: "good" }] : []),
    { day: network.charteredDay, text: "Network chartered", tone: "muted" },
  ].sort((a, b) => b.day - a.day);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <dl className="ro-row" aria-label="Network status">
        <div className="ro">
          <dt className="lbl">Coverage</dt>
          <dd className={`val ${count >= NETWORK.minimum ? "good" : "bad"}`}>{pct(Math.min(1, count / NETWORK.planned))}</dd>
          <span className="ro-sub">{count >= NETWORK.minimum ? "IN SERVICE" : `NEEDS ${NETWORK.minimum - count} MORE`}</span>
        </div>
        <div className="ro">
          <dt className="lbl">Working</dt>
          <dd className="val">
            {count}
            <small>/ {NETWORK.planned}</small>
          </dd>
          <span className="ro-sub">{network.sats.length - count} LOST</span>
        </div>
        <div className="ro">
          <dt className="lbl">Service</dt>
          <dd className="val">
            {(revenueFor(count) / 1000).toFixed(2)}
            <small>$M / mo</small>
          </dd>
          <span className="ro-sub">NEXT BILL D {network.nextBill}</span>
        </div>
        <div className="ro">
          <dt className="lbl">Earned</dt>
          <dd className="val">
            {(bills.reduce((n, e) => n + e.amount, 0) / 1000).toFixed(1)}
            <small>$M</small>
          </dd>
          <span className="ro-sub">
            {bills.length} OF {billed} MONTHS PAID
          </span>
        </div>
        <div className="ro">
          <dt className="lbl">Mean age</dt>
          <dd className="val">
            {meanAge}
            <small>d</small>
          </dd>
          <span className="ro-sub">DESIGN LIFE {NETWORK.life} D</span>
        </div>
        <div className="ro">
          <dt className="lbl">Due out</dt>
          <dd className={`val ${dueSoon > 0 ? "bad" : ""}`}>{dueSoon}</dd>
          <span className="ro-sub">IN 180 DAYS</span>
        </div>
        <div className="ro">
          <dt className="lbl">Waiting</dt>
          <dd className="val">{network.stored}</dd>
          <span className="ro-sub">ON THE GROUND</span>
        </div>
        <div className="ro">
          <dt className="lbl">On order</dt>
          <dd className="val">{network.orders.reduce((n, o) => n + o.count, 0)}</dd>
          <span className="ro-sub">{network.orders[0] ? `NEXT D ${network.orders[0].readyDay}` : "NONE"}</span>
        </div>
      </dl>

      <div className="row">
        <section className="grow stack" aria-label="Constellation">
          <div className="card">
            <p className="label hdr-row">
              <span className="with-icon">
                Constellation
                <Info label="About the orbit view">
                  The network seen from above its orbital plane, not to scale: {NETWORK.planned} slots round the orbit, each filled satellite coloured by its health (green nominal, yellow aging, red end of life). Red arcs are gaps of two or more empty slots, where the ground goes
                  uncovered for part of each orbit. New satellites fill the empty slots first.
                </Info>
              </span>
              <span className="mono">{live.length} IN ORBIT</span>
            </p>
            <div className="control-orbit-wrap">
              <OrbitView sats={network.sats} day={day} />
            </div>
          </div>
          <div className="card">
            <p className="label hdr-row">
              <span>Service history</span>
              <span className="mono">LAST 12 BILLS</span>
            </p>
            <ServiceHistory company={company} />
            <div className="sched-key mono">
              <span>
                <i style={{ background: "var(--good)" }} />
                Service income
              </span>
              <span>
                <i style={{ background: "var(--bad)" }} />
                Ground ops {money(NETWORK.operations)}
              </span>
              <span className="muted">dashed: full coverage</span>
            </div>
          </div>
        </section>

        <aside className="side stack">
          <div className="card">
            <p className="label hdr-row">
              <span>Replacement plan</span>
              <span className="mono">{replace > 0 ? `${replace} NEEDED` : "COVERED"}</span>
            </p>
            <ul className="checklist">
              <li>
                <span className={short > 0 ? "warn" : "good"}>{short > 0 ? "▲" : "✓"}</span>
                <span>{short > 0 ? `${short} short of the planned ${NETWORK.planned}, counting waiting and ordered` : `Planned ${NETWORK.planned} covered, counting waiting and ordered`}</span>
                <span className="mono muted">{short}</span>
              </li>
              <li>
                <span className={dueSoon > 0 ? "warn" : "good"}>{dueSoon > 0 ? "▲" : "✓"}</span>
                <span>Reach their design life within 180 days</span>
                <span className="mono muted">{dueSoon}</span>
              </li>
            </ul>
            {replace > 0 && (
              <div className="verb-group">
                <button type="button" className="btn primary" onClick={() => game.act((c) => ({ text: orderSatellites(c, replace), notices: [] }))}>
                  Order {replace} <span className="note">{money(replace * NETWORK.satCost)} · {NETWORK.satDays} d</span>
                </button>
                <button type="button" className="btn quiet" onClick={() => go({ place: "launch", tab: "network" })}>
                  Launch a batch <span className="note">network tab</span>
                </button>
              </div>
            )}
          </div>
          <div className="card">
            <p className="label hdr-row">
              <span>Operations log</span>
              <span className="mono">{events.length}</span>
            </p>
            <ul className="log">
              {events.slice(0, 12).map((e, i) => (
                <li key={i}>
                  <span className="muted">D {e.day}</span>
                  <span className={e.tone === "bad" ? "bad" : undefined}>{e.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <div className="card">
        <p className="label hdr-row">
          <span className="with-icon">
            Satellite health
            <Info label="About satellite health">
              What telemetry shows. LIFE is age against the {Math.round(NETWORK.life / 365)}-year design life. FUEL is the station-keeping budget left; a satellite that reached orbit out of spec spent half of it getting to its slot. Some satellites fail early and some outlast
              their design: the real end only shows when it comes.
            </Info>
          </span>
          <button type="button" className="btn quiet" style={{ minHeight: 28 }} onClick={() => setShowLost(!showLost)}>
            {showLost ? "Hide lost" : "Show lost"} <span className="note">{network.sats.length - live.length}</span>
          </button>
        </p>
        {shown.length === 0 ? (
          <span className="muted">No satellites in orbit yet.</span>
        ) : (
          <div className="table-wrap flush">
            <table className="spec compact">
              <thead>
                <tr>
                  <th scope="col">Sat</th>
                  <th scope="col" className="num">Slot</th>
                  <th scope="col" className="num">Age</th>
                  <th scope="col">Life</th>
                  <th scope="col">Fuel</th>
                  <th scope="col" className="num">Battery</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ s, h }) => (
                  <tr key={s.id}>
                    <td className="mono">S{String(s.id).padStart(2, "0")}</td>
                    <td className="num mono">{s.slot !== undefined ? s.slot + 1 : "—"}</td>
                    <td className="num mono">{Math.max(0, Math.min(day, s.end) - s.launched)} d</td>
                    <td>
                      <span className="health-bar" aria-label={`Design life used ${pct(h.life)}`}>
                        <i className={h.life >= 1 ? "bad" : h.life >= 0.7 ? "warn" : "good"} style={{ width: `${Math.min(100, h.life * 100)}%` }} />
                      </span>
                      <span className="mono muted health-num">{pct(h.life)}</span>
                    </td>
                    <td>
                      <span className="health-bar" aria-label={`Fuel ${pct(h.fuel)}`}>
                        <i className={h.fuel < 0.1 ? "bad" : h.fuel < 0.3 ? "warn" : "good"} style={{ width: `${Math.min(100, h.fuel * 100)}%` }} />
                      </span>
                      <span className="mono muted health-num">{pct(h.fuel)}</span>
                    </td>
                    <td className="num mono">{h.key === "lost" ? "—" : pct(h.battery)}</td>
                    <td>
                      <Chip tone={h.tone}>{h.label}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
