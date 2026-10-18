import { useState } from "react";
import { achievements, type Achievement } from "../../sim/achievements.ts";
import { reputation, type Category, type Company as CompanyState } from "../../sim/company.ts";
import { ERAS, marketOf } from "../../sim/market.ts";
import { LICENCE_LABELS, LICENCE_ORDER, licenceRank, nextLicence } from "../../sim/licence.ts";
import { Chip, Stack, Tabs } from "../components/Bits.tsx";
import { game } from "../game.ts";
import { licenceJob } from "../jobs.ts";
import { money, shortDate, signed } from "../format.ts";
import { LABELS, LedgerTab } from "./LedgerTab.tsx";
import { Work } from "./Work.tsx";
import { revisionOf } from "../vehicleDesign.ts";
import { CATEGORY } from "../palette.ts";
import type { Route } from "../nav.ts";
import { Today } from "./Home.tsx";
import { Info } from "../components/Info.tsx";

type HomeTab = "today" | "company" | "work" | "ledger";

/** What each tab is for, behind the ⓘ beside the company's name. */
const HOME_INTROS: Record<HomeTab, string> = {
  today: "What needs you, most pressing first: each line links to where it's dealt with. Below it, each signed flight's road to the pad, and Port Avery: every facility shows what it's doing and opens where it's run.",
  company: "Where the company stands: its numbers, the license ladder and what the next license wants, where the money went, the fleet and achievements.",
  work: "Each track works one job at a time per unit, and the tracks work side by side. Book work with “Add to plan”, then advance the calendar once: results land on the day each job finishes. Jobs on the same hardware keep the order they were booked in.",
  ledger: "Every payment in and out, and every flight and its outcome.",
};

/** Spend categories, in the order and colours the money bar uses. */
const SPEND: Array<[Category, string]> = [
  ["build", CATEGORY[0]],
  ["rnd", CATEGORY[1]],
  ["test", CATEGORY[2]],
  ["fix", CATEGORY[3]],
  ["analysis", CATEGORY[4]],
  ["launch", CATEGORY[5]],
  ["licence", CATEGORY[6]],
  ["facility", CATEGORY[7]],
  ["overhead", CATEGORY[8]],
  ["penalty", CATEGORY[9]],
];

/**
 * Home: what needs the player, and what's running. Today's list and the
 * campus; the company's standing; the work on its tracks; the ledger.
 */
export function Home({ company, route }: { company: CompanyState; route: Route }) {
  const first = (["today", "company", "work", "ledger"] as const).find((t) => t === route.tab) ?? "today";
  const [tab, setTab] = useState<HomeTab>(first);
  const list = achievements(company);

  return (
    <div className="screen">
      <div className="screen-head">
        <NameEditor company={company} info={HOME_INTROS[tab]} />
        <Tabs<HomeTab>
          label="Home views"
          value={tab}
          onChange={setTab}
          tabs={[
            ["today", "Today"],
            ["company", "Company"],
            ["work", company.tasks.length > 0 ? `Work · ${company.tasks.length}` : "Work"],
            ["ledger", "Ledger"],
          ]}
        />
      </div>
      {tab === "today" && <Today company={company} />}
      {tab === "company" && <Overview company={company} list={list} />}
      {tab === "work" && <Work company={company} />}
      {tab === "ledger" && <LedgerTab company={company} />}
    </div>
  );
}

function NameEditor({ company, info }: { company: CompanyState; info: string }) {
  const [editing, setEditing] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [draft, setDraft] = useState(company.name);
  if (editing) {
    return (
      <form
        className="actions"
        onSubmit={(e) => {
          e.preventDefault();
          if (game.rename(draft)) setEditing(false);
        }}
      >
        <label className="sr-only" htmlFor="company-name">
          Company name
        </label>
        <input id="company-name" className="name-input" value={draft} maxLength={40} autoFocus onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn primary">
          Save
        </button>
        <button type="button" className="btn" onClick={() => (setDraft(company.name), setEditing(false))}>
          Cancel
        </button>
      </form>
    );
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="actions" style={{ gap: 12 }}>
        <h1>
          {company.name}
          <Info label="About this page">{info}</Info>
        </h1>
        <button type="button" className="btn quiet" style={{ minHeight: 36 }} onClick={() => (setDraft(company.name), setEditing(true))}>
          Rename
        </button>
        {quitting ? (
          <span className="actions" style={{ gap: 8 }}>
            <span className="soft">Abandon this run?</span>
            <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => game.quit()}>
              Abandon
            </button>
            <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => setQuitting(false)}>
              Keep playing
            </button>
          </span>
        ) : (
          <button type="button" className="btn quiet" style={{ minHeight: 36 }} onClick={() => setQuitting(true)}>
            New run
          </button>
        )}
      </div>
      <span className="muted">
        Founded {shortDate(0)} at Port Avery · seed {company.seed}
      </span>
    </div>
  );
}

function Overview({ company, list }: { company: CompanyState; list: Achievement[] }) {
  const [allAchievements, setAllAchievements] = useState(false);
  const rep = reputation(company);
  const built = Object.values(company.built).reduce((a, b) => a + b, 0);
  const owned = Object.values(company.inventory).reduce((a, b) => a + b, 0);
  const orbits = company.flights.filter((f) => f.outcome === "orbit").length;
  const latest = list.filter((a) => a.earned).slice(-3).reverse();
  const next = list.find((a) => !a.earned);
  const nextTier = LICENCE_ORDER[licenceRank(company.licence) + 1];
  const landed = company.flights.filter((f) => f.booster?.landed).length;
  // The most the company has held: the ledger, run backwards from today.
  let cash = company.cash - company.ledger.reduce((sum, e) => sum + e.amount, 0);
  let peak = cash;
  for (const e of company.ledger) peak = Math.max(peak, (cash += e.amount));

  return (
    <>
      <dl className="ro-row">
        <Ro label="Cash" value={(company.cash / 1000).toFixed(2)} unit="$M" tone={company.cash < 2_000 ? "bad" : undefined} bar={peak > 0 ? company.cash / peak : undefined} sub={`peak ${money(peak)}`} />
        <Ro label="Day" value={String(company.day)} sub={shortDate(company.day).toUpperCase()} />
        <Ro label="Reputation" value={signed(rep)} tone={rep > 0 ? "good" : rep < 0 ? "bad" : undefined} bar={(rep + 5) / 15} sub={marketSub(company)} />
        <Ro label="License" value={LICENCE_LABELS[company.licence]} word sub={nextTier ? `${LICENCE_LABELS[nextTier].toLowerCase()} next` : "every tier held"} />
        <Ro label="Built" value={String(built)} sub="rockets" />
        <Ro label="Hangar" value={String(owned)} sub="on the ground" />
        <Ro label="Launches" value={String(company.flights.length)} sub={landed > 0 ? `${landed} booster${landed === 1 ? "" : "s"} landed` : "flights"} />
        <Ro label="Orbits" value={String(orbits)} sub={company.firstOrbitDay === null ? "none yet" : `first D ${company.firstOrbitDay}`} />
      </dl>

      <div className="row">
        <div className="grow stack" style={{ gap: 20 }}>
          <LicenceCard company={company} rep={rep} />
          <MoneyCard company={company} />
        </div>
        <div className="side stack" style={{ gap: 20 }}>
          <FleetCard company={company} />
          <section className="card" aria-labelledby="ach-head">
            <p className="label hdr-row" id="ach-head">
              <span>Achievements</span>
              <span>
                {list.filter((a) => a.earned).length} / {list.length}
              </span>
            </p>
            {latest.length === 0 && <span className="muted">None yet. Fire an engine to get started.</span>}
            <ul className="log">
              {latest.map((a) => (
                <li key={a.id}>
                  <span className="muted">{a.day !== undefined ? `D ${a.day}` : "—"}</span>
                  <span>
                    <span className="good" aria-label="earned">
                      ✓
                    </span>{" "}
                    <strong>{a.title}</strong> <span className="muted">· {a.text}</span>
                  </span>
                </li>
              ))}
              {next && (
                <li>
                  <span className="muted">NEXT</span>
                  <span className="muted">
                    <strong>{next.title}</strong> · {next.text}
                  </span>
                </li>
              )}
            </ul>
            <div className="actions">
              <button type="button" className="btn quiet" onClick={() => setAllAchievements(!allAchievements)}>
                {allAchievements ? "Show fewer" : `See all ${list.length}`}
              </button>
            </div>
          </section>
        </div>
      </div>
      {allAchievements && <Achievements list={list} />}
    </>
  );
}

/** One readout in the row: label, value and unit, a hairline scale where there is one, and a note. */
/** The market era under the reputation figure: what reputation has opened, and what opens next. */
function marketSub(company: CompanyState): string {
  const era = marketOf(company).era;
  const next = ERAS[era];
  return `market era ${era}${next ? ` · next at ${next.reputation}` : ""}`;
}

function Ro({ label, value, unit, sub, tone, word, bar }: { label: string; value: string; unit?: string; sub?: string; tone?: "good" | "bad"; word?: boolean; bar?: number }) {
  return (
    <div className="ro">
      <dt className="lbl">{label}</dt>
      <dd className={["val", tone, word ? "word" : ""].filter(Boolean).join(" ")}>
        {value}
        {unit && <small>{unit}</small>}
      </dd>
      {bar !== undefined && (
        <span className="ro-bar" aria-hidden="true">
          <i className={tone} style={{ width: `${Math.max(2, Math.min(100, bar * 100))}%` }} />
        </span>
      )}
      {sub && <span className="ro-sub">{sub}</span>}
    </div>
  );
}

const TIER_NOTE = { suborbital: "Sounding rockets", orbital: "Satellites to orbit", crew: "People to orbit" } as const;

function LicenceCard({ company, rep }: { company: CompanyState; rep: number }) {
  const application = nextLicence(company, rep);
  const held = licenceRank(company.licence);
  return (
    <section className="card" aria-labelledby="lic-head">
      <p className="label hdr-row" id="lic-head">
        <span>Launch license</span>
        <span>LIC · REGULATOR</span>
      </p>
      <ol className="ladder">
        {LICENCE_ORDER.map((tier, i) => {
          const state = i <= held ? "held" : i === held + 1 ? "next" : "locked";
          return (
            <li key={tier} className={state}>
              <span className={`stamp-tag ${state}`}>{state === "held" ? "✓ HELD" : state === "next" ? "NEXT" : "LOCKED"}</span>
              <strong>{LICENCE_LABELS[tier]}</strong>
              <span className="muted">{TIER_NOTE[tier as keyof typeof TIER_NOTE] ?? ""}</span>
            </li>
          );
        })}
      </ol>
      {application ? (
        <>
          <span className="label">The regulator wants, for {LICENCE_LABELS[application.tier].toLowerCase()}</span>
          <ul className="checklist">
            {application.requirements.map((r) => (
              <li key={r.text}>
                <span className={r.met ? "good" : "warn"} aria-label={r.met ? "met" : "not met"}>
                  {r.met ? "✓" : "▲"}
                </span>
                <span>{r.text}</span>
                <span className="mono muted">{r.progress ? `${r.progress[0]}/${r.progress[1]}` : r.met ? "met" : ""}</span>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="btn primary" disabled={!application.ready} onClick={() => game.schedule(licenceJob(application))}>
              Apply for {LICENCE_LABELS[application.tier].toLowerCase()}
              <span className="note">{application.ready ? `${money(application.fee)} · ${application.days} d` : "meet every requirement first"}</span>
            </button>
          </div>
        </>
      ) : (
        <span className="good">✓ The company holds every license there is.</span>
      )}
    </section>
  );
}

function MoneyCard({ company }: { company: CompanyState }) {
  const totals = new Map<Category, number>();
  for (const e of company.ledger) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  const income = totals.get("payout") ?? 0;
  const parts = SPEND.map(([cat, color]) => ({ name: `${LABELS[cat]} ${money(-(totals.get(cat) ?? 0))}`, value: -(totals.get(cat) ?? 0), color })).filter((p) => p.value > 0);
  const spent = parts.reduce((a, p) => a + p.value, 0);
  const net = income - spent;

  return (
    <section className="card" aria-labelledby="money-head">
      <p className="label hdr-row" id="money-head">
        <span>Money</span>
        <span>LEDGER</span>
      </p>
      <dl className="figures">
        <Figure label="Earned" value={money(income)} tone="good" />
        <Figure label="Spent" value={money(spent)} />
        <Figure label="Net" value={`${net < 0 ? "−" : "+"}${money(Math.abs(net))}`} tone={net < 0 ? "bad" : "good"} />
      </dl>
      {parts.length > 0 ? (
        <div className="stack" style={{ gap: 6 }}>
          <Stack parts={parts} label={`Spending: ${parts.map((p) => p.name).join(", ")}`} />
          <div className="scale mono" aria-hidden="true">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <span key={f}>{money(spent * f)}</span>
            ))}
          </div>
        </div>
      ) : (
        <span className="muted">Nothing spent yet.</span>
      )}
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <dt className="lbl">{label}</dt>
      <dd className={`mono ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

function FleetCard({ company }: { company: CompanyState }) {
  const [all, setAll] = useState(false);
  const rows = Object.entries(company.designs).map(([key, v]) => ({
    key,
    v,
    built: company.built[key] ?? 0,
    ready: company.inventory[key] ?? 0,
    line: company.orders.filter((o) => o.design === key).length,
    flown: company.flights.filter((f) => f.design === v.name).length,
  }));
  const used = rows.filter((r) => r.built + r.ready + r.line + r.flown > 0);
  const shown = all || used.length === 0 ? rows : used;
  return (
    <section className="card" aria-labelledby="fleet-head">
      <p className="label hdr-row" id="fleet-head">
        <span>Fleet</span>
        <span>
          VEH · {used.length} OF {rows.length} USED
        </span>
      </p>
      <div className="table-wrap flush">
        <table className="spec compact">
          <thead>
            <tr>
              <th scope="col">Design</th>
              <th scope="col">Rev</th>
              <th scope="col" className="num">Built</th>
              <th scope="col" className="num">Ready</th>
              <th scope="col" className="num" title="On the production line">Line</th>
              <th scope="col" className="num">Flown</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key}>
                <td>{r.v.name.replace(/ [B-Z]$/, "")}</td>
                <td className="mono">{revisionOf(r.v.name)}</td>
                <td className="num">{r.built}</td>
                <td className="num">{r.ready}</td>
                <td className="num">{r.line}</td>
                <td className="num">{r.flown}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {used.length > 0 && used.length < rows.length && (
        <div className="actions">
          <button type="button" className="btn quiet" onClick={() => setAll(!all)}>
            {all ? "Only designs in use" : `Show all ${rows.length} designs`}
          </button>
        </div>
      )}
    </section>
  );
}

function Achievements({ list }: { list: Achievement[] }) {
  return (
    <section className="achievements" aria-label="Achievements">
      {list.map((a) => (
        <div key={a.id} className={`card achievement ${a.earned ? "earned" : ""}`}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <strong style={{ fontSize: 18 }}>
              <span aria-hidden="true" className={a.earned ? "warn" : "muted"} style={{ marginRight: 8 }}>
                {a.earned ? "✓" : "□"}
              </span>
              {a.title}
            </strong>
            {a.earned ? <Chip tone="good">{a.day !== undefined ? `DAY ${a.day}` : "EARNED"}</Chip> : <Chip tone="muted">LOCKED</Chip>}
          </div>
          <span className="soft">{a.text}</span>
          {!a.earned && a.progress && (
            <div className="stack" style={{ gap: 4 }}>
              <div className="bar" style={{ height: 8 }} role="img" aria-label={`${a.progress[0]} of ${a.progress[1]}`}>
                <div className="fill" style={{ width: `${(a.progress[0] / a.progress[1]) * 100}%`, background: "var(--amber)" }} />
              </div>
              <span className="mono muted" style={{ fontSize: 13 }}>
                {a.progress[0]} / {a.progress[1]}
              </span>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
