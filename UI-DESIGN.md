# RocketX — UI Design Bible (UI-DESIGN.md)

Paste this (or point to it) at the start of every UI prompt, for any AI.
If a request conflicts with this file, this file wins unless I say otherwise.

Game design lives in `DESIGN.md`; this file covers only how the UI looks and behaves.
Reference mockup: `docs/ui/mockups/engine-design.dc.html` (Design screen, engine ENG-01).

---

## 1. Identity

**The player is** the chief engineer of a small, underfunded private launch startup.
**The UI is** the company's in-house rocket development software, running on a
workstation in a test-stand control room. It is not a game menu.

Mood: dry, serious, precise. Futuristic in the sense of *very good professional
software*, not sci-fi. No jokes in the interface. Drama comes from data:
a pressure trace climbing toward a redline, a contract deadline closing in.

One-sentence test for every screen:
> "Would an engineer at a real launch company recognise this as a tool they could use?"

---

## 2. References (what to take from each)

| Reference | Take |
|---|---|
| Rocket engine P&ID schematics | Layout of components, flow lines, valve symbols, line styles |
| Test-stand telemetry displays | Live plots with redlines, timestamps, channel labels |
| Engineering blueprints / CAD | Dimension lines, callouts, title blocks, revision letters |
| Oscilloscopes & lab instruments | Phosphor-like traces, fine grids, knob-and-readout feel |
| Flight readiness review docs | Tables of go/no-go items, terse status codes |
| Opus Magnum / Shenzhen I/O | The pleasure of tuning a machine; dense but readable tools |
| Hardspace: Shipbreaker | Diegetic, work-tool UI that belongs to the world |

---

## 3. Visual system

### Colour (dark only, one accent)
| Token | Hex | Use |
|---|---|---|
| `bg` | `#0B1118` | Screen background |
| `panel` | `#111A24` | Panel fill (barely lighter than bg) |
| `grid` | `#1A2633` | Background grid lines |
| `line` | `#5FD4E6` | Primary lines, schematics, traces, nominal values |
| `line-dim` | `#2E5A66` | Inactive / secondary lines |
| `text` | `#C9D6E0` | Primary text and numbers |
| `text-muted` | `#7C8C99` | Labels, units, secondary info |
| `accent` | `#F2A93B` | Selection, focus, the thing being edited — only one at a time |
| `alarm` | `#FF4D4D` | Limits exceeded, failures, redlines. Nothing else. |

Rules:
- Cyan means "nominal / data". Amber means "you are touching this". Red means "limit".
- No other colours. No gradients. No glows except a faint 1px bloom on live traces.
- Status is **never** shown by colour alone (see Accessibility).

### Type
- **Numbers & readouts:** monospace — JetBrains Mono or IBM Plex Mono. Tabular figures always.
- **Labels:** IBM Plex Sans Condensed, uppercase, letter-spaced, small.
- Units always shown, in `text-muted`, after the value: `311.4 s`, `2.15 MN`, `68 bar`.
- Three sizes only: readout (large), body (medium), label (small).

### Line & shape
- 1px lines everywhere; 2px only for the selected element.
- Square corners. Corner brackets `⌐ ¬` or tick marks instead of boxed borders.
- Visible 8px background grid on work areas.
- Panels are separated by lines and spacing, not by shadows or rounded cards.

### Density
- High. This is a professional tool; empty space is for the schematic, not padding.
- Every panel has a short uppercase header with an ID: `ENG-01 / CHAMBER`.

---

## 4. Component vocabulary

Build screens from these. Avoid inventing generic buttons.

- **Schematic** — the central object of a screen (engine, stage, vehicle). Click a
  part to select it; its flow lines highlight in `accent`.
- **Curve slider** — a parameter is set by dragging a marker along its own
  performance curve, so the trade-off is visible while dragging
  (e.g. expansion ratio vs sea-level and vacuum thrust).
- **Readout** — label, big monospace value, unit, and a thin bar showing where the
  value sits between its limits. Turns `alarm` with a `▲ LIMIT` tag when out of bounds.
- **Telemetry plot** — time on x, one or more channels on y, dashed redline,
  scrubbable playhead.
- **Timeline / scrubber** — for test fires, flights and the company calendar.
- **Spec table** — terse rows, monospace values, revision column (`REV C`).
- **Log / autopsy** — timestamped event list (`T+42.18  TP-1  BEARING TEMP ▲`),
  linked to the plot: click an event, the playhead jumps there.
- **Stamp** — status marks like `GO`, `NO-GO`, `SCRUB`, `QUALIFIED`, `FAILED`,
  styled like rubber stamps on a document, used sparingly.
- **Command line** — optional, a nod to the CLI prototype; every action can also be typed.

Actions are verbs on the object (`FIRE TEST`, `COMMIT REV`, `SUBMIT BID`),
placed next to what they affect, not in a toolbar of identical buttons.

---

## 5. Screens

### Design
- Center: vehicle or engine schematic. Engine breaks down into
  **nozzle, combustion chamber, turbine, fuel pumps**; vehicle adds
  **GNC, telemetry, TCS, FTS** as blocks on a systems diagram.
- Right: parameter strip for the selected part (curve sliders).
- Bottom: live predicted performance readouts (Isp, thrust, mass, reliability, cost).
- Changes create a new revision letter; previous revisions can be diffed.

### Research
- A tech map drawn like a dependency diagram or document tree, not a skill tree
  with glowing icons. Nodes are reports with IDs (`RPT-014  REGEN COOLING`).
- Shows cost, time and what it unlocks as plain specs.

### Test Stand / Wind Tunnel
- Telemetry plot dominates. Channel list on the side.
- Pre-test checklist as a go/no-go table. Fire button needs a deliberate action
  (hold, or type `FIRE`).

### Contracts & Company
- Calendar as a horizontal timeline with launch windows and deadlines.
- Contracts look like procurement documents: customer, payload, orbit,
  penalty, deadline, with a `SUBMIT BID` action.
- Cash shown as a single ledger readout plus a burn-rate trace, not coins.

### Flight & Autopsy
- Ascent shown as a trajectory plot plus key telemetry channels, not a cinematic.
- Autopsy is the payoff screen: log + plot linked, root cause highlighted on the
  schematic of the part that failed.

---

## 6. Writing rules

- Max **12 words of prose** per panel. Explanations go in an optional `INFO` pull-out.
- Engineer voice: terse, technical, no exclamation marks, no "Awesome!".
- Labels uppercase; values and logs in mono.
- Name things like a company would: part numbers, revisions, report IDs.

---

## 7. Accessibility (part of the look, not an afterthought)

- Text contrast at least 4.5:1 against `bg`/`panel`; numbers aim for 7:1.
- Status always has a symbol + word as well as colour: `▲ LIMIT`, `✕ FAIL`, `● LIVE`.
- Plots use line style (solid/dashed/dotted) as well as colour to separate channels.
- Every control reachable and operable by keyboard; visible `accent` focus ring.
- Curve sliders also accept arrow keys and typed values.
- Respect reduced-motion: no animated traces or bloom when it's set.
- Minimum label size 12px; readouts scale with UI zoom.

---

## 8. Do NOT

- Rounded cards, card grids, drop shadows
- Grids of identical buttons or a generic top/side nav of big tabs
- Paragraphs of description text
- Gradients, neon sci-fi glow, holograms, hexagon patterns
- Icons in circles, emoji, cartoon rockets
- Coins, gems, stars, "Level up!" or any mobile-game reward language
- Colour as the only signal for anything

---

## 9. Prompt preamble (copy into any AI)

```
You are designing UI for RocketX. Follow UI-DESIGN.md strictly:
the UI is in-house rocket engineering software in a test-stand control
room — dense, precise, dark, cyan lines, one amber accent, red only for
limits, monospace numbers, 1px lines, square corners, visible grid.
Build from: schematic, curve slider, readout, telemetry plot, timeline,
log, stamp. Max 12 words of prose per panel. Meet the accessibility rules.
Avoid everything in the "Do NOT" list.

Before writing code, propose 3 distinct layout directions for this
screen in 3 lines each and wait for my pick.

SCREEN: [describe what the player does here, as verbs]
```

After any generated screen, follow up with:
```
List everything on this screen that looks generic or default, and replace
each with something specific to a rocket engineering tool per UI-DESIGN.md.
```
