import { useMemo, useState } from "react";
import { accept, bid, commitSeries, reputation, seriesBonus, seriesBroken, uncommitted, type Company } from "../../sim/company.ts";
import { KIND_LABELS, type Contract, type ContractKind } from "../../sim/contracts.ts";
import { COSTS } from "../../sim/cost.ts";
import { holds, LICENCE_LABELS, requiredLicence, type Licence } from "../../sim/licence.ts";
import { DesignSelect, Findings, Forecast, Schedule } from "../components/BidParts.tsx";
import { Chip, Facts, Tabs } from "../components/Bits.tsx";
import { defaultDesign, game } from "../game.ts";
import { deadlineRisks, waitJob } from "../jobs.ts";
import { project } from "../../sim/schedule.ts";
import { dateOf, dayOf, km, money, monthName, shortDate } from "../format.ts";

type Props = { company: Company; version: number; goTo: (screen: "launch") => void };
type View = "table" | "calendar";
type Tone = "good" | "warn" | "bad" | "muted" | undefined;
type StatusFilter = "active" | "open" | "signed" | "announced" | "closed" | "all";

/** How far ahead customers announce work, days. Series announce every remaining launch. */
const ANNOUNCE_AHEAD = 45;

type Row = { c: Contract; status: { key: StatusFilter; text: string; tone: Tone } };

function statusOf(company: Company, c: Contract): Row["status"] {
  const closed = company.closed[c.id];
  if (closed === "delivered") return { key: "closed", text: "DELIVERED", tone: "good" };
  if (closed === "degraded") return { key: "closed", text: "OUT OF SPEC", tone: "warn" };
  if (closed === "failed") return { key: "closed", text: "FAILED", tone: "bad" };
  if (closed === "late") return { key: "closed", text: "LATE", tone: "bad" };
  if (closed === "withdrawn") return { key: "closed", text: "WITHDRAWN", tone: "muted" };
  if (company.accepted.includes(c.id)) return { key: "signed", text: "SIGNED", tone: "warn" };
  if (c.postedDay > company.day) return { key: "announced", text: `FROM DAY ${c.postedDay}`, tone: "muted" };
  if (company.day > c.deadline) return { key: "closed", text: "EXPIRED", tone: "muted" };
  const needs = requiredLicence(c);
  if (!holds(company, needs)) return { key: "open", text: `${LICENCE_LABELS[needs].toUpperCase()} LICENCE`, tone: "muted" };
  if (reputation(company) < c.minReputation) return { key: "open", text: `NEEDS REP ${c.minReputation}`, tone: "muted" };
  return { key: "open", text: "OPEN", tone: undefined };
}

/** Everything the player can see: posted work, plus what customers have announced. */
function visible(company: Company): Contract[] {
  const postedSeries = new Set(company.board.filter((c) => c.seriesId && c.postedDay <= company.day).map((c) => c.seriesId));
  return company.board.filter((c) => c.postedDay <= company.day + ANNOUNCE_AHEAD || (c.seriesId !== undefined && postedSeries.has(c.seriesId)));
}

const regimeOf = (c: Contract) => (c.mission.target ? c.mission.name.replace(/^LEO /, "") : c.minApogee ? `↑ ${km(c.minApogee, 0)}` : "suborbital");

export function Contracts({ company, version, goTo }: Props) {
  const [view, setView] = useState<View>("table");
  const rows: Row[] = visible(company).map((c) => ({ c, status: statusOf(company, c) }));
  const [selected, setSelected] = useState<string | undefined>(() => rows.find((r) => r.status.key === "open")?.c.id);
  const contract = rows.find((r) => r.c.id === selected)?.c;
  const [designChoice, setDesign] = useState<Record<string, string>>({});
  const upcoming = company.board.filter((c) => c.postedDay > company.day).map((c) => c.postedDay);
  const nextPosting = upcoming.length > 0 ? Math.min(...upcoming) : null;
  const nextRollout = company.orders.length > 0 ? Math.min(...company.orders.map((o) => o.readyDay)) : null;

  return (
    <div className="screen">
      <div className="screen-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>Contracts</h1>
          <span className="muted">
            Day {company.day} · {shortDate(company.day)} · {rows.filter((r) => r.status.key === "open").length} open, {company.accepted.length} signed
          </span>
        </div>
        <Tabs<View>
          label="Contract views"
          value={view}
          onChange={setView}
          tabs={[
            ["table", "Table"],
            ["calendar", "Calendar"],
          ]}
        />
      </div>
      <div className="row">
        <section className="grow stack" aria-label="Contracts">
          {reputation(company) < 0 && (
            <div className="card alert" role="note">
              <p className="label bad">Reputation {reputation(company)}: most customers won't sign</p>
              <span className="soft">
                Two ways back. Student payloads accept any record and earn +1 when delivered. And every clean test flight above 100 km, from the Hangar, wins back a point
                until you are at 0.{company.licence === "suborbital" ? " The orbital licence also needs a reputation of 0 or better." : ""}
              </span>
            </div>
          )}
          {view === "table" ? <Table rows={rows} selected={contract?.id} select={setSelected} /> : <Calendar company={company} rows={rows} selected={contract?.id} select={setSelected} />}
          <div className="actions">
            {nextPosting !== null && <span className="muted">Next new posting around day {nextPosting}.</span>}
            <button type="button" className="btn" onClick={() => game.schedule(waitJob(30, "Waiting for new work"))}>
              Wait 30 days · {money(30 * COSTS.overheadPerDay)}
            </button>
            {nextPosting !== null && (
              <button type="button" className="btn" onClick={() => game.schedule(waitJob(nextPosting - company.day, "Waiting for the next posting"))}>
                Wait for the next posting
              </button>
            )}
            {nextRollout !== null && nextRollout > company.day && (
              <button type="button" className="btn" onClick={() => game.schedule(waitJob(nextRollout - company.day, "Waiting for the next rollout", `Advance ${nextRollout - company.day} days to the next rollout?`, "Advance"))}>
                Advance to the next rollout · day {nextRollout}
              </button>
            )}
          </div>
        </section>
        {contract ? (
          <BidPanel
            key={contract.id}
            company={company}
            version={version}
            contract={contract}
            design={designChoice[contract.id] ?? defaultDesign(contract)}
            setDesign={(d) => setDesign({ ...designChoice, [contract.id]: d })}
            goTo={goTo}
          />
        ) : (
          <aside className="side card">
            <span className="muted">Choose a contract to see the bid.</span>
          </aside>
        )}
      </div>
    </div>
  );
}

function Table({ rows, selected, select }: { rows: Row[]; selected?: string; select: (id: string) => void }) {
  const [status, setStatus] = useState<StatusFilter>("active");
  const [kind, setKind] = useState<ContractKind | "all">("all");
  const [licence, setLicence] = useState<Licence | "all">("all");
  const [seriesOnly, setSeriesOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"deadline" | "payout" | "posted">("deadline");

  const shown = rows
    .filter((r) => status === "all" || (status === "active" ? r.status.key !== "closed" : r.status.key === status))
    .filter((r) => kind === "all" || r.c.kind === kind)
    .filter((r) => licence === "all" || requiredLicence(r.c) === licence)
    .filter((r) => !seriesOnly || r.c.seriesId)
    .filter((r) => `${r.c.title} ${r.c.customer}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (sort === "payout" ? b.c.payout - a.c.payout : sort === "posted" ? a.c.postedDay - b.c.postedDay : a.c.deadline - b.c.deadline));
  const kinds = [...new Set(rows.map((r) => r.c.kind))];

  return (
    <>
      <div className="filters" role="group" aria-label="Filters">
        <label>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="active">Open, signed and announced</option>
            <option value="open">Open</option>
            <option value="signed">Signed</option>
            <option value="announced">Announced</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ContractKind | "all")}>
            <option value="all">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Licence</span>
          <select value={licence} onChange={(e) => setLicence(e.target.value as Licence | "all")}>
            <option value="all">Any licence</option>
            <option value="suborbital">Suborbital</option>
            <option value="orbital">Orbital</option>
            <option value="crew">Crewed flight</option>
          </select>
        </label>
        <label>
          <span>Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="deadline">Fly-by day</option>
            <option value="payout">Pay</option>
            <option value="posted">Posting day</option>
          </select>
        </label>
        <label className="grow-field">
          <span>Search</span>
          <input type="search" value={search} placeholder="Customer or payload" onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={seriesOnly} onChange={(e) => setSeriesOnly(e.target.checked)} />
          <span>Recurring only</span>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">Orbit</th>
              <th scope="col" className="num">Pays</th>
              <th scope="col" className="num">Fly by</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ c, status: st }) => (
              <tr key={c.id} className={`clickable ${c.id === selected ? "selected" : ""}`} onClick={() => select(c.id)}>
                <td>
                  <button type="button" onClick={() => select(c.id)} style={{ all: "unset", cursor: "pointer", fontWeight: 600 }}>
                    {c.title}
                  </button>
                  <div className="muted" style={{ fontSize: 14 }}>
                    {c.customer} · {KIND_LABELS[c.kind]}
                    {c.seriesId && <span className="series-tag"> ↻ recurring</span>}
                  </div>
                </td>
                <td className="mono soft" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                  {regimeOf(c)}
                </td>
                <td className="num">{money(c.payout)}</td>
                <td className="num">{c.deadline}</td>
                <td>
                  <Chip tone={st.tone}>{st.text}</Chip>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

type CalEvent = { day: number; c: Contract; type: "posted" | "due"; signed: boolean };

function Calendar({ company, rows, selected, select }: { company: Company; rows: Row[]; selected?: string; select: (id: string) => void }) {
  const today = dateOf(company.day);
  const [cursor, setCursor] = useState({ year: today.getUTCFullYear(), month: today.getUTCMonth() });
  // A future day chosen to advance the calendar to; one that has since passed no longer counts.
  const [picked, setPick] = useState<number | null>(null);
  const pick = picked !== null && picked > company.day ? picked : null;
  const choose = (day: number) => {
    if (day > company.day) setPick(day === pick ? null : day);
  };
  const rollouts = new Map<number, string[]>();
  for (const o of company.orders) rollouts.set(o.readyDay, [...(rollouts.get(o.readyDay) ?? []), company.designs[o.design]?.name ?? o.design]);
  // Booked work, on the day it is expected to finish.
  const finishes = new Map<number, string[]>();
  for (const [id, p] of project(company).tasks) {
    const t = company.tasks.find((x) => x.id === id);
    if (t) finishes.set(p.end, [...(finishes.get(p.end) ?? []), t.title]);
  }
  const events: CalEvent[] = rows
    .filter((r) => r.status.key !== "closed")
    .flatMap(({ c }) => {
      const signed = company.accepted.includes(c.id);
      const out: CalEvent[] = [{ day: c.deadline, c, type: "due", signed }];
      out.push({ day: c.postedDay, c, type: "posted", signed });
      return out;
    });
  const byDay = new Map<number, CalEvent[]>();
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);

  // A Monday-first grid of whole weeks covering the month.
  const first = new Date(Date.UTC(cursor.year, cursor.month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const startDay = dayOf(first) - lead;
  const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => startDay + i);
  const inMonth = (day: number) => dateOf(day).getUTCMonth() === cursor.month;
  const shift = (n: number) => setCursor(({ year, month }) => ({ year: year + Math.floor((month + n) / 12), month: (((month + n) % 12) + 12) % 12 }));
  const agenda = cells.filter(inMonth).flatMap((d) => byDay.get(d) ?? []);

  return (
    <div className="card calendar">
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <h2>{monthName(cursor.year, cursor.month)}</h2>
        <span className="actions" style={{ gap: 6 }}>
          <button type="button" className="btn" aria-label="Previous month" onClick={() => shift(-1)}>
            ←
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setCursor({ year: today.getUTCFullYear(), month: today.getUTCMonth() });
              setPick(null);
            }}
          >
            Today
          </button>
          <button type="button" className="btn" aria-label="Next month" onClick={() => shift(1)}>
            →
          </button>
        </span>
      </div>
      <div className="legend muted">
        <span>
          <i className="ev posted" /> posted
        </span>
        <span>
          <i className="ev due" /> fly by
        </span>
        <span>
          <i className="ev due signed" /> signed, fly by
        </span>
        <span>
          <i className="ev rollout" /> rollout
        </span>
        <span>
          <i className="ev job" /> job done
        </span>
        <span>↻ recurring</span>
      </div>
      <div className="month" role="grid" aria-label={monthName(cursor.year, cursor.month)}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="dow" role="columnheader">
            {d}
          </div>
        ))}
        {cells.map((day) => {
          const evs = byDay.get(day) ?? [];
          const ready = rollouts.get(day) ?? [];
          const jobs = finishes.get(day) ?? [];
          const future = day > company.day;
          const cls = ["cell", inMonth(day) ? "" : "outside", day === company.day ? "today" : "", day < company.day ? "past" : "", future ? "future" : "", day === pick ? "picked" : "", pick !== null && future && day < pick ? "span" : ""];
          return (
            <div
              key={day}
              role="gridcell"
              aria-selected={future ? day === pick : undefined}
              aria-label={future ? `${shortDate(day)}, day ${day}, in ${day - company.day} days` : undefined}
              tabIndex={future ? 0 : undefined}
              className={cls.filter(Boolean).join(" ")}
              onClick={() => choose(day)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  choose(day);
                }
              }}
            >
              <span className="date">
                {dateOf(day).getUTCDate()}
                {day === company.day && <span className="sr-only"> (today)</span>}
              </span>
              {ready.map((name, i) => (
                <span key={`r${i}`} className="ev rollout" title={`${name} rolls out`}>
                  <span className="ev-text">🚀 {name}</span>
                </span>
              ))}
              {jobs.map((title, i) => (
                <span key={`j${i}`} className="ev job" title={`Done: ${title}`}>
                  <span className="ev-text">⚙ {title}</span>
                </span>
              ))}
              {evs.slice(0, 3).map((e) => (
                <button
                  key={e.type + e.c.id}
                  type="button"
                  className={`ev ${e.type} ${e.signed ? "signed" : ""} ${e.c.id === selected ? "on" : ""}`}
                  title={`${e.type === "posted" ? "Posted" : "Fly by"}: ${e.c.title}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    select(e.c.id);
                  }}
                >
                  <span className="ev-text">
                    {e.c.seriesId ? "↻ " : ""}
                    {e.c.customer}
                  </span>
                </button>
              ))}
              {evs.length > 3 && <span className="more muted">+{evs.length - 3}</span>}
            </div>
          );
        })}
      </div>
      {pick !== null ? <AdvanceBar company={company} day={pick} clear={() => setPick(null)} /> : <span className="muted">Click a future day to advance the calendar to it.</span>}
      <div className="stack" style={{ gap: 6 }}>
        <p className="label">This month</p>
        {agenda.length === 0 && <span className="muted">Nothing posted or due this month.</span>}
        <ul className="list">
          {agenda.map((e) => (
            <li key={e.type + e.c.id}>
              <span className="mono muted" style={{ flex: "0 0 92px" }}>
                day {e.day}
              </span>
              <button type="button" className="link" onClick={() => select(e.c.id)} style={{ textAlign: "left" }}>
                <span className={e.type === "due" ? (e.signed ? "bad" : "warn") : "soft"}>{e.type === "due" ? "Fly by" : "Posted"}</span> · {e.c.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** What passes between today and the chosen day, and the button that gets there. */
function AdvanceBar({ company, day, clear }: { company: Company; day: number; clear: () => void }) {
  const n = day - company.day;
  const posting = company.board.filter((c) => c.postedDay > company.day && c.postedDay <= day).length;
  const risks = deadlineRisks(company, n);
  const ready = company.orders.filter((o) => o.readyDay <= day).map((o) => company.designs[o.design]?.name ?? o.design);
  const work = [...project(company).tasks].filter(([, p]) => p.end <= day).map(([id]) => company.tasks.find((t) => t.id === id)?.title).filter(Boolean);
  const when = shortDate(day);
  return (
    <div className="advance" role="region" aria-label="Advance the calendar">
      <div className="stack" style={{ gap: 4 }}>
        <span>
          <strong>{when}</strong> · day {day} · in {n} day{n === 1 ? "" : "s"} · <span className="mono">{money(n * COSTS.overheadPerDay)}</span> payroll
        </span>
        {posting > 0 && (
          <span className="soft">
            {posting} new posting{posting === 1 ? "" : "s"} by then.
          </span>
        )}
        {ready.length > 0 && <span className="good">Rolled out by then: {ready.join(", ")}.</span>}
        {work.length > 0 && <span className="soft">Work done by then: {work.join(" · ")}.</span>}
        {risks.map((r) => (
          <span key={r.contract.id} className="bad">
            {r.text}
          </span>
        ))}
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            game.schedule(waitJob(n, `Advancing to ${when}`, `Advance ${n} day${n === 1 ? "" : "s"} to ${when}?`, "Advance"));
            clear();
          }}
        >
          Advance to {when}
        </button>
        <button type="button" className="btn" onClick={clear}>
          Clear
        </button>
      </div>
    </div>
  );
}

function BidPanel({ company, version, contract, design, setDesign, goTo }: { company: Company; version: number; contract: Contract; design: string; setDesign: (d: string) => void; goTo: Props["goTo"] }) {
  // The forecast flies the vehicle once; recompute only when something changed.
  const b = useMemo(() => bid(company, contract.id, design), [company, contract.id, design, version]);
  const signed = company.accepted.includes(contract.id);
  const announced = contract.postedDay > company.day;
  const open = !company.closed[contract.id] && !announced && company.day <= contract.deadline;
  const series = contract.seriesId ? company.board.filter((c) => c.seriesId === contract.seriesId) : [];

  return (
    <aside className="side card" aria-label="Bid">
      <div className="stack" style={{ gap: 4 }}>
        <p className="label">
          {KIND_LABELS[contract.kind]} · {contract.customer}
        </p>
        <h2>{contract.title}</h2>
      </div>
      {series.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="soft">
            Recurring: launch {contract.seriesIndex} of {series.length}. Deliver and the next pays 5% more; fail or miss one and the rest are withdrawn.{" "}
            {seriesBroken(company, contract.seriesId!) ? (
              <span className="muted">The series bonus is gone: launch {seriesBroken(company, contract.seriesId!)!.seriesIndex} wasn't delivered.</span>
            ) : (
              <>
                Deliver all {series.length} for a <strong className="good">{money(seriesBonus(company, contract.seriesId!))}</strong> bonus, however they were signed.
              </>
            )}
          </span>
          <div className="series" aria-label="Series progress">
            {series.map((c) => {
              const st = company.closed[c.id];
              return (
                <span
                  key={c.id}
                  title={`${c.title}${st ? `: ${st}` : ""}`}
                  className={`pip ${st === "delivered" ? "good" : st ? "bad" : company.accepted.includes(c.id) ? "signed" : ""} ${c.id === contract.id ? "on" : ""}`}
                />
              );
            })}
          </div>
          <SeriesCommit company={company} seriesId={contract.seriesId!} />
        </div>
      )}
      <Facts
        items={[
          ["Pays", <span className="good">{money(contract.payout)}</span>],
          ["Penalty", <span className="bad">{money(contract.penalty)}</span>],
          ["Licence", LICENCE_LABELS[requiredLicence(contract)]],
          ["Reputation", `${contract.minReputation} or better`],
          ["Posted", `day ${contract.postedDay}`],
          ["Fly by", `day ${contract.deadline}`],
        ]}
      />
      {announced ? (
        <span className="soft">Announced: the customer posts this on day {contract.postedDay}. You can sign it then.</span>
      ) : (
        <>
          <DesignSelect label="Bid it with" value={design} onChange={setDesign} designs={company.designs} inventory={company.inventory} />
          {open && <Schedule day={company.day} deadline={contract.deadline} b={b} />}
          {contract.minApogee !== undefined && <span className="soft">Needs an apogee of {km(contract.minApogee, 0)}.</span>}
          <Findings b={b} />
          <Forecast b={b} />
        </>
      )}
      {signed ? (
        <div className="actions">
          <span className="soft">Signed. Build, re-tune and fly it from the Launch page.</span>
          <button type="button" className="btn primary" onClick={() => goTo("launch")}>
            Go to Launch
          </button>
        </div>
      ) : (
        open && (
          <div className="actions">
            <button type="button" className="btn primary" disabled={b.blockers.length > 0} onClick={() => game.act((c) => accept(c, contract.id))}>
              Sign contract
            </button>
            <span className="muted" style={{ fontSize: 14 }}>
              Signing commits you to day {contract.deadline}. Missing it costs {money(contract.penalty)}.
            </span>
          </div>
        )
      )}
    </aside>
  );
}

/**
 * Sign every remaining launch of a series in one go. A big promise, so it
 * asks first and lists every deadline it signs up to.
 */
function SeriesCommit({ company, seriesId }: { company: Company; seriesId: string }) {
  const [asking, setAsking] = useState(false);
  const left = uncommitted(company, seriesId);
  if (left.length < 2) return null;
  const penalties = left.reduce((sum, c) => sum + c.penalty, 0);
  const pays = left.reduce((sum, c) => sum + c.payout, 0);
  if (!asking) {
    return (
      <span className="actions">
        <button type="button" className="btn" onClick={() => setAsking(true)}>
          Commit to the series · sign {left.length} launches
        </button>
      </span>
    );
  }
  return (
    <div className="card" role="group" aria-label="Commit to the series" style={{ borderColor: "var(--amber)", gap: 8 }}>
      <strong>
        Sign all {left.length} remaining launches with {left[0]!.customer}?
      </strong>
      <span className="soft" style={{ fontSize: 14 }}>
        Each becomes a signed contract on the calendar: {money(pays)} on delivery, {money(penalties)} in penalties if every one were missed.
      </span>
      <ul className="list" style={{ gap: 2, fontSize: 14 }}>
        {left.map((c) => (
          <li key={c.id}>
            <span className="mono muted" style={{ flex: "0 0 86px" }}>
              day {c.deadline}
            </span>
            <span>
              Launch {c.seriesIndex} · {money(c.payout)}
              {c.postedDay > company.day ? <span className="muted"> · posted day {c.postedDay}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <span className="actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            game.act((c) => {
              const r = commitSeries(c, seriesId);
              return { ...r, notices: [r.text, ...r.notices] };
            });
            setAsking(false);
          }}
        >
          Commit · {left.length} launches
        </button>
        <button type="button" className="btn" onClick={() => setAsking(false)}>
          Cancel
        </button>
      </span>
    </div>
  );
}
