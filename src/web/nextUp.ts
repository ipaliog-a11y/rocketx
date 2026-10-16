import { bid, readyDay, reputation, type Bid, type Company } from "../sim/company.ts";
import type { Contract } from "../sim/contracts.ts";
import { FAILURE_LABELS } from "../sim/hardware.ts";
import { LICENCE_LABELS, nextLicence } from "../sim/licence.ts";
import type { Unknown } from "../sim/teststand.ts";
import { designFor, signedContracts } from "./jobs.ts";
import type { Route } from "./nav.ts";

/**
 * What needs the player, worked out from what a player can see: the signed
 * flights and their bids, what tests haven't shown yet, known faults, and
 * the next licence. Each item says where to go to deal with it.
 */

export type NextTone = "bad" | "caution" | "good" | "data";

type NextAction = { label: string; route: Route };

/** A thing to do, and where to do it. `alt` is a second way to deal with it. */
export type NextItem = { key: string; tone: NextTone; title: string; text: string; action: NextAction; alt?: NextAction };

/** One signed flight and where it stands. */
export type FlightStatus = {
  contract: Contract;
  design: string;
  bid: Bid;
  /** Engine items from the bid's "on trust" list, by engine. */
  engines: Map<string, Unknown[]>;
  /** Shape items: drag and buffet on paper. */
  aero: Unknown[];
  /** Day a vehicle is ready, null when none is built or on the line. */
  ready: number | null;
};

export function flightStatuses(company: Company): FlightStatus[] {
  return signedContracts(company).map((contract) => {
    const design = designFor(company, contract);
    const b = bid(company, contract.id, design);
    const vehicle = company.designs[design]!;
    const engineNames = new Set(vehicle.stages.map((s) => s.engine.name));
    const engines = new Map<string, Unknown[]>();
    const aero: Unknown[] = [];
    for (const u of b.unknowns) {
      if (engineNames.has(u.subject)) engines.set(u.subject, [...(engines.get(u.subject) ?? []), u]);
      else aero.push(u);
    }
    return { contract, design, bid: b, engines, aero, ready: readyDay(company, design) };
  });
}

const ORDER: Record<NextTone, number> = { bad: 0, caution: 1, good: 2, data: 3 };

/** The things to do next, most pressing first, at most `limit`. */
export function nextUp(company: Company, statuses = flightStatuses(company), limit = 6): NextItem[] {
  const items = new Map<string, NextItem>();
  const add = (item: NextItem) => {
    if (!items.has(item.key)) items.set(item.key, item);
  };

  for (const s of statuses) {
    const c = s.contract;
    const v = company.designs[s.design]!;
    // The sizing guide can suggest a rocket that does the job, except for crew flights, which fly the capsule.
    const suggest: NextAction | undefined = c.kind === "crew" ? undefined : { label: "Suggest a rocket", route: { place: "rockets", tab: "board", contract: c.id } };
    if (s.ready === null) {
      add(
        s.bid.fitsSchedule
          ? { key: `build:${c.id}`, tone: "caution", title: `No ${v.name} built for “${c.title}”`, text: `One takes ${s.bid.build.days} days; ${s.bid.daysLeft} days left.`, action: { label: "Order", route: { place: "launch", contract: c.id } } }
          : { key: `build:${c.id}`, tone: "bad", title: `“${c.title}” can't be built in time`, text: `A ${v.name} takes ${s.bid.build.days} days and the pad ${s.bid.daysLeft < s.bid.build.days ? "more" : "a week"}; ${s.bid.daysLeft} days left.`, action: { label: "Launch", route: { place: "launch", contract: c.id } }, alt: suggest },
      );
    }
    if (!s.bid.forecast.delivers) {
      add({ key: `forecast:${c.id}`, tone: "bad", title: `“${c.title}”: forecast misses`, text: `The ${v.name} as known: ${s.bid.forecast.text}`, action: { label: "Simulate", route: { place: "rockets", tab: "sim", design: s.design, contract: c.id } }, alt: suggest });
    }
    for (const [engine, unknowns] of s.engines) {
      const fault = unknowns.find((u) => u.text.startsWith("Known "));
      add(
        fault
          ? { key: `engine:${engine}`, tone: "bad", title: `${engine}: ${fault.text.split(" at ")[0]!.replace(/^Known /, "")}`, text: fault.text, action: { label: "Fix", route: { place: "testing", engine } } }
          : { key: `engine:${engine}`, tone: "caution", title: `${engine} isn't proven for “${c.title}”`, text: unknowns[0]!.text, action: { label: "Fire", route: { place: "testing", engine } } },
      );
    }
    if (s.aero.length > 0) {
      add({ key: `shape:${s.design}`, tone: "caution", title: `${v.name}'s shape is untested`, text: s.aero[0]!.text, action: { label: "Tunnel", route: { place: "testing", tab: "tunnel", design: s.design } } });
    }
  }

  // Faults the stand has found on engines any design flies, whether or not a signed flight needs them yet.
  const flown = new Set(Object.values(company.designs).flatMap((d) => d.stages.map((s) => s.engine.name)));
  for (const engine of flown) {
    const open = company.campaign.knowledge[engine]?.open ?? [];
    if (open.length > 0) {
      add({ key: `engine:${engine}`, tone: "bad", title: `${engine}: ${FAILURE_LABELS[open[0]!]}`, text: "Found on the stand and not fixed yet.", action: { label: "Fix", route: { place: "testing", engine } } });
    }
  }

  const app = nextLicence(company, reputation(company));
  if (app?.ready) {
    add({ key: "licence", tone: "good", title: `Apply for the ${LICENCE_LABELS[app.tier].toLowerCase()} license`, text: "Every requirement is met.", action: { label: "Apply", route: { place: "home", tab: "company" } } });
  } else if (app) {
    const met = app.requirements.filter((r) => r.met).length;
    const missing = app.requirements.find((r) => !r.met)!;
    add({ key: "licence", tone: "data", title: `${LICENCE_LABELS[app.tier]} license: ${met} of ${app.requirements.length}`, text: `Next: ${missing.text.charAt(0).toLowerCase()}${missing.text.slice(1)}${missing.progress ? ` (${missing.progress[0]}/${missing.progress[1]})` : ""}.`, action: { label: "License", route: { place: "home", tab: "company" } } });
  }

  if (statuses.length === 0) {
    add({ key: "work", tone: "data", title: "Nothing signed", text: "The board has work posted. Sign a contract to have something to fly.", action: { label: "Find work", route: { place: "contracts" } } });
  }

  return [...items.values()].sort((a, b) => ORDER[a.tone] - ORDER[b.tone]).slice(0, limit);
}
