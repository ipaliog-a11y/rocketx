import { useState } from "react";
import { achievements, type Achievement } from "../../sim/achievements.ts";
import { reputation, type Category, type Company as CompanyState } from "../../sim/company.ts";
import { LICENCE_LABELS, LICENCE_ORDER, licenceRank, nextLicence } from "../../sim/licence.ts";
import { Chip, Stack, Tabs } from "../components/Bits.tsx";
import { game } from "../game.ts";
import { licenceJob } from "../jobs.ts";
import { money, shortDate, signed } from "../format.ts";
import { LABELS, LedgerTab } from "./LedgerTab.tsx";
import { Work } from "./Work.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
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

  return (
    <>
      <dl className="tiles">
        <Tile icon="money" label="Cash" value={money(company.cash)} tone={company.cash < 2_000 ? "bad" : undefined} />
        <Tile icon="day" label="Day" value={String(company.day)} sub={shortDate(company.day)} />
        <Tile icon="reputation" label="Reputation" value={signed(rep)} tone={rep > 0 ? "good" : rep < 0 ? "bad" : undefined} />
        <Tile icon="licence" label="License" value={LICENCE_LABELS[company.licence]} word />
        <Tile icon="factory" label="Rockets built" value={String(built)} />
        <Tile icon="hangar" label="In the hangar" value={String(owned)} />
        <Tile icon="launch" label="Launches" value={String(company.flights.length)} />
        <Tile icon="orbit" label="Orbits" value={String(orbits)} sub={company.firstOrbitDay === null ? "none yet" : `first on day ${company.firstOrbitDay}`} />
      </dl>

      <div className="row">
        <div className="grow stack" style={{ gap: 20 }}>
          <LicenceCard company={company} rep={rep} />
          <MoneyCard company={company} />
        </div>
        <div className="side stack" style={{ gap: 20 }}>
          <FleetCard company={company} />
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <p className="label">Achievements</p>
              <button type="button" className="link" onClick={() => setAllAchievements(!allAchievements)}>
                {allAchievements ? "Show fewer" : `See all ${list.filter((a) => a.earned).length}/${list.length}`}
              </button>
            </div>
            {latest.length === 0 && <span className="muted">None yet. Fire an engine to get started.</span>}
            <ul className="list">
              {latest.map((a) => (
                <li key={a.id}>
                  <span className="good" aria-hidden="true">
                    ★
                  </span>
                  <span>
                    <strong>{a.title}</strong> <span className="muted">· {a.text}</span>
                  </span>
                </li>
              ))}
            </ul>
            {next && (
              <span className="soft" style={{ fontSize: 14 }}>
                Next: <strong>{next.title}</strong>: {next.text}
              </span>
            )}
          </div>
        </div>
      </div>
      {allAchievements && <Achievements list={list} />}
    </>
  );
}

function Tile({ icon, label, value, sub, tone, word }: { icon: IconName; label: string; value: string; sub?: string; tone?: "good" | "bad"; word?: boolean }) {
  return (
    <div className="tile">
      <dt className="with-icon">
        <Icon name={icon} size="sm" />
        {label}
      </dt>
      <dd className={[tone, word ? "word" : ""].filter(Boolean).join(" ") || undefined}>{value}</dd>
      {sub && <span className="muted">{sub}</span>}
    </div>
  );
}

function LicenceCard({ company, rep }: { company: CompanyState; rep: number }) {
  const application = nextLicence(company, rep);
  const held = licenceRank(company.licence);
  return (
    <section className="card" aria-label="Launch license">
      <p className="label">Launch license</p>
      <ol className="ladder">
        {LICENCE_ORDER.map((tier, i) => (
          <li key={tier} className={i <= held ? "held" : i === held + 1 ? "next" : undefined}>
            <span className="dot" aria-hidden="true">
              {i <= held ? "✓" : i + 1}
            </span>
            <span>{LICENCE_LABELS[tier]}</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {tier === "suborbital" ? "Sounding rockets" : tier === "orbital" ? "Satellites to orbit" : "People to orbit"}
            </span>
          </li>
        ))}
      </ol>
      {application ? (
        <>
          <span className="soft">
            For the <strong>{LICENCE_LABELS[application.tier].toLowerCase()}</strong> license the regulator wants:
          </span>
          <ul className="list">
            {application.requirements.map((r) => (
              <li key={r.text} style={{ alignItems: "center" }}>
                <span className={r.met ? "good" : "muted"} style={{ fontWeight: 700, flex: "0 0 18px" }} aria-label={r.met ? "met" : "not met"}>
                  {r.met ? "✓" : "○"}
                </span>
                <span style={{ flex: 1 }}>{r.text}</span>
                {r.progress && (
                  <span className="mono muted" style={{ fontSize: 13 }}>
                    {r.progress[0]}/{r.progress[1]}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="btn primary" disabled={!application.ready} onClick={() => game.schedule(licenceJob(application))}>
              Apply · {money(application.fee)} · {application.days} days
            </button>
            {!application.ready && <span className="muted">Meet every requirement first.</span>}
          </div>
        </>
      ) : (
        <span className="good">The company holds every license there is.</span>
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
  const rockets = -(totals.get("build") ?? 0);

  return (
    <section className="card" aria-label="Money">
      <p className="label">Money</p>
      <div className="row" style={{ gap: 12 }}>
        <Figure label="Earned from customers" value={money(income)} tone="good" />
        <Figure label="Spent" value={money(spent)} />
        <Figure label="Spent on rockets" value={money(rockets)} />
      </div>
      {parts.length > 0 ? <Stack parts={parts} label={`Spending: ${parts.map((p) => p.name).join(", ")}`} /> : <span className="muted">Nothing spent yet.</span>}
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="stack" style={{ gap: 2, flex: "1 1 150px" }}>
      <span className="muted" style={{ fontSize: 13 }}>
        {label}
      </span>
      <span className={`mono ${tone ?? ""}`} style={{ fontSize: 20, fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

function FleetCard({ company }: { company: CompanyState }) {
  return (
    <section className="card" aria-label="Fleet">
      <p className="label">Fleet</p>
      <div className="table-wrap" style={{ border: 0 }}>
        <table className="compact">
          <thead>
            <tr>
              <th scope="col">Design</th>
              <th scope="col" className="num">Built</th>
              <th scope="col" className="num">Ready</th>
              <th scope="col" className="num" title="On the production line">Line</th>
              <th scope="col" className="num">Flown</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(company.designs).map(([key, v]) => (
              <tr key={key}>
                <td>{v.name}</td>
                <td className="num">{company.built[key] ?? 0}</td>
                <td className="num">{company.inventory[key] ?? 0}</td>
                <td className="num">{company.orders.filter((o) => o.design === key).length}</td>
                <td className="num">{company.flights.filter((f) => f.design === v.name).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
                {a.earned ? "★" : "☆"}
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
