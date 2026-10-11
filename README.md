# Untitled — Research-First Launch Company

A game concept: you are the chief engineer of a private launch startup. You do **not** fly the rockets. You design them, pay for tests, bid contracts, and watch the vehicle try to do the job. Research is the main loop. The company is the pressure: cash, calendar, reputation, and the chance the firm dies before first orbit.

This repo holds early design decisions only. Nothing here is a build spec.

## Documents

| File | What it is |
|---|---|
| [README.md](README.md) | Pitch, pillars, non-goals, loop |
| [DESIGN.md](DESIGN.md) | Decisions from the first design pass, with rationale |
| [src/sim/](src/sim/) | Simulation core: atmosphere, aero, engines and their parts, ascent, debrief |

## Pitch

You don’t fly the rocket. You argue with physics until a contract can fly it, and you watch the argument happen.

- Design vehicles from engineering domains (aerodynamics, flight control, engines, propellant chemistry, and later structures, thermal, avionics, manufacturing, ground systems).
- Send them to work on contracts.
- Watch takeoff, ascent, staging, and insertion as a spectator with a readable debrief.
- Learn real rocket ideas because you needed them, not because a tooltip said so.
- Choices lock you into a technical identity. Two competent players should finish as different companies.
- A small roguelike wrap: one company is one run. The firm can die. Your understanding persists.

## Pillars

1. **Research in the foreground.** Experiments, test stands, and failure modes are the gameplay.
2. **Company in the background.** Cash, schedule, facilities, and customers exist to make engineering painful, not to be a tycoon spreadsheet.
3. **No piloting.** Design → test → dispatch → watch → autopsy.
4. **Options matter.** Domains are competing answers to the same problem, not four parallel XP bars.
5. **No perfect vehicle.** Certainty is bought with test flights. 100% failure-free does not exist.
6. **Early fail is allowed.** Spend everything and miss LEO, the run ends.
7. **Ambition is a bet.** Hard contracts introduce regimes you have never tested.
8. **Small roguelike.** Physics stay honest. The *situation* is seeded. Knowledge carries between runs; the company does not.

## Core loop

**Bid → decide what you refuse to know → pay for the tests you do run → watch one flight → update the model → LEO-and-alive or broke.**

After first orbit the same loop scales: new regime, new ignorance, new chance to overreach.

## What this is not

- Not Kerbal. No manual gravity turns, docking, or building in a parts hangar as the product.
- Not EarthX / Space Company Simulator. Launch cadence and department trees are not the toy.
- Not a linear “unlock Falcon → unlock Starship” campaign.
- Not a full roguelike smash-another-seed-in-20-minutes game. A run should last long enough to learn something.

## Status

Text prototype complete. All six steps of DESIGN.md §15 exist: one pad, one stand and one cash pile; two domains (**engines + aerodynamics**); suborbital and small LEO contracts; tests that reveal named failure modes; an ascent with a debrief; and a run that can die. It plays as a script of steps from the command line. No name locked.

Built so far: a two-dimensional ascent sim in the plane of the trajectory, flown against a mission. It goes from the pad to orbit insertion, or to apogee if the vehicle falls short.

- US Standard Atmosphere 1976 up to 86 km, vacuum above 150 km
- Drag from a Mach-dependent Cd curve with a transonic rise. Frontal area comes from the widest stage or the fairing
- Engine thrust falls with ambient pressure (F = F_vac − p·A_e). Nozzle flow separation is flagged by the Summerfield criterion
- Earth rotation: the share of the spin that lies in the trajectory plane moves the pad and the air. Due east from 28.5° N starts the vehicle at 408 m/s; a retrograde sun-synchronous track starts it 60 m/s backwards
- Missions: a launch site plus an optional insertion target (periapsis, apoapsis, inclination, tolerances). The launch azimuth comes from the target inclination. A pad can't reach an inclination below its own latitude
- Three pitch programmes: vertical; a gravity turn (pitch kick, then prograde) with an optional upper-stage pitch ramp; or a time-based pitch schedule
- Guidance cuts the last stage off once the orbit has the target's energy. The insertion is scored in or out of spec, and leftover propellant is the margin
- Staging, max-q, Mach 1, load-budget, side-load (q·α) and acceleration-limit events
- Δv bookkeeping relative to the ground: delivered Δv split into gravity, drag, back-pressure and steering losses
- A text debrief that names the physics, including why an insertion missed
- Engine test stand. Each engine has hidden truths rolled from the run's seed: real Isp, hard start, combustion instability onset and chamber life. Hot-fires on a sea-level stand or an altitude cell reveal only what they reach, cost cash and calendar days, and destroy the test engine when something fails. A vacuum bell can't run against sea-level air, so the sea-level stand gives it only a 2 s start check: a cheap way to catch a hard start before booking the altitude cell. Fixes remove a mode the stand has seen, cost some performance, and make earlier proof void
- Wind tunnels. Each outer shape has hidden aero truths: real drag against the hand-estimated curve, the real transonic drag rise, and buffet on the fairing shoulder (likelier on a hammerhead fairing). CFD is cheap and gets drag about half right, but can't see buffet. The subsonic tunnel measures drag. The transonic tunnel measures the drag rise and shows buffet. Vortex generators fix buffet for about 3% drag. Buffet that drives the load past the structural budget breaks the vehicle up near Mach 1
- Before flight: a list of what the vehicle is flying on trust, and a forecast that flies the vehicle as measured, including any failure seen and not fixed. In flight, engines perform and fail as built, and the debrief points at the firing that would have caught the failure

The trajectory stays in one plane. Plane changes, the out-of-plane part of the pad's motion and coast-and-relight insertions aren't modelled.

- Pitch programme re-tuning. The trajectory office searches the gravity turn's kick angle and upper-stage ramp against the company's model of the vehicle: measured Isp and drag where tests measured them, the drawings where not, and known buffet. Inside half the tolerance it prefers propellant margin. Engine failures are left out, since no pitch steers around them. A re-tune is adopted only if its prediction reaches orbit

A re-tune is only as good as the testing behind it. Tuned on the drawings and flown on real engines, Meridian misses. With accurate test data and engine failures set aside, re-tuning took it from 0 to 13 of 25 seeds in spec (measured before engines were built from parts). Of the rest, 3 buffet whatever the pitch, and 9 lack the Δv for a 200 kg payload once real Isp is known.

- Company and contracts. Cash, a calendar, and a reputation record tagged by what happened. A failed test flight goes on the record but costs no reputation, and customers don't hold it against the company: nobody's payload was lost. A seeded board offers suborbital crumbs, LEO work, an SSO contract that punishes a greedy bid, and an equatorial customer the pad can't serve. Contracts have payouts, penalties, deadlines, a reputation bar, and customers who refuse certain records
- The bid screen shows what a contract pays and risks, the build cost, regimes the design has never flown, everything on trust, and a forecast with the contract's payload
- Vehicles cost cash and days to build. A launch uses one up. In-spec delivery pays in full, an out-of-spec orbit pays half, and a loss or a missed deadline costs the penalty. Flights are tests too: telemetry teaches what the flight reached, and a stage that burns to empty tanks without a failure proves its engine for the whole burn, stand firing or not
- The run ends when the cash goes negative. The summary breaks down where the money went and what the record says
- Launch licences. A new company holds only the suborbital licence. The orbital one needs two flights above 100 km without losing the vehicle, a reputation of 0 or better, $250k and a 20-day review. Orbital contracts and orbital test flights are refused without it. A crewed-flight tier is on the map, but nothing can earn it yet
- A generated board on top of the hand-tested contracts: about 80 contracts per seed over three years, across sounding science, microgravity, technology demos, rideshares, smallsats, weather, constellations, space agencies and crew. Payloads and orbits stay inside what the preset launchers reach with typical engines, with a margin. Recurring series (a university's aurora campaign, three constellations, the rideshare broker) post an instance every month or two. Deliver one and the rest pay 5% more; fail or miss one and the customer withdraws the rest. A series can be committed to in one go, signing every remaining launch (even ones not yet posted) onto the calendar. Delivering every launch of a series, however each was signed, pays a 15% bonus on top and +1 reputation
- Engines built from parts. An engine is a chamber size (9, 25, 35 or 50 kN) plus four parts: a feed cycle (pressure-fed, electric pump, gas generator), an injector (showerhead, pintle, coaxial swirl), chamber cooling (ablative liner, film, regenerative) and a nozzle (sea-level, altitude, vacuum, large vacuum). Each option publishes ranges, and each hidden quirk belongs to the part that causes it: hard start to the cycle, instability to the injector, chamber life to the cooling, flow separation to the nozzle, and the Isp shortfall to injector and nozzle. A part is one option at one size, so sister engines share parts: the two Harriers share cycle, injector and cooling
- What tests learn lands on the parts. Firing Harrier-SL proves its injector for Harrier-Vac too; a burn-through at 60% of one engine's rated life predicts 60% of its sister's. A fix is a new revision of the part that owns the mode, paid once and applied to every engine built with it, and only that part's proof has to be redone
- Engine development: put parts together into a new engine. Parts already in production are free to reuse and come with what tests know; new parts cost development money and time and start unproven. Refining an injector or nozzle (R&D against measured Isp) closes part of the gap to the top of its range, up to three times, and the gain has to be measured again. A design's stage can be re-engined while none of it is built
- The drawing board: design a vehicle from one or two stages (diameter, tank length, engine and engine count) and a fairing. Propellant follows from tank volume and dry mass from a simple structures model (engine mass by thrust, tank structure by propellant, heavier for pressure-fed tanks, plus avionics, interstage and fairing). Redrawn presets come out within about 10% of the hand-drawn ones. The board refuses what can't work (a booster bell that separates on the pad, too many engines for the diameter, a stack too slender, liftoff thrust below weight) and warns about what is risky (low thrust to weight, a hammerhead fairing). Drawing up costs the office's time, plus tooling the first time a tank or fairing diameter is used
- A sizing guide: say what the rocket is for (a contract, an orbit or an apogee, and a payload) and it searches stage sizes and the company's engines with the rocket equation against what the job takes, then offers the cheapest, a balanced and a most-margin design. Orbital picks re-tune into spec on typical engines; sounding picks are flown to confirm the apogee
- Production lines. A build is an order: paid up front, built on a line while the company keeps testing and flying, and rolled out on its ready day. Orders queue on the line that frees first; a launch with the vehicle still on the line waits for rollout. A second and third line ($2.5M and $4M) build in parallel. The factory learns: each doubling of a design's build count cuts its build time to 85%, down to 55% of the first
- High-energy missions. Orbits above 500 km go to a 200 km parking orbit, coast, and relight the upper stage: once to raise the high point (geostationary transfer, trans-lunar injection) or to escape with a given C3, and once more at the high point to circularise. Each burn steers prograde and cuts off on the energy of the orbit it aims for. Coasts are integrated with a longer step and replayed from above the orbit
- Relights are a regime of their own. A stage that has already run must restart in vacuum, and a relight failure, owned by the feed cycle, strands the payload in its parking orbit. The altitude cell runs restart tests; a restart kit fixes the mode for every engine sharing the cycle
- Bigger hardware: 3, 100 and 250 kN chambers, a storable (hypergolic) cycle that lights reliably for kick stages and deep space, 2.4 and 3.0 m tanks, and three-stage designs. The guide sizes the burns after the parking orbit from vis-viva, adds a kick stage beyond about 11 km/s, and asks for 8% margin when a mission relights
- High-energy work on the board from about day 350: geostationary comsats, navigation satellites at 1,200 km, lunar probes, deep-space probes and the Skyweb mega-constellation (a 500–750 kg batch every month). Payloads are sized against a developed 100 kN gas-generator booster with a margin; the tests fly the heaviest of each
- Engines are priced from their parts, so a pressure-fed engine costs about half as much per kN as a gas-generator one
- Work on tracks that run side by side: the sea-level stand, the altitude cell, the engineering office (fixes, refinements, engine development, drawings, re-tunes), the wind tunnel and the regulator. Each job is paid when booked, starts when its track is free, and shows what it found only on the day it finishes. Jobs on the same hardware keep the order they were booked in, so a re-test waits for the fix to its parts. A lost test engine ties up its stand while a new one is built. A second sea-level stand ($1.5M), a second altitude cell ($5M) and more engineering teams ($1M, $2M) add capacity. The command line and the bots still run each job to its end before the next
- Heavy lift: a 600 kN gas-generator chamber (its development, fixes and test engines cost the most of any size) and 4.0 m tanks ($1.2M and 45 days of tooling). The sizing guide reaches past 16 m of core and 6 m of upper stage on the 3 m class and up, so it can size a 2.9 t station payload: eight or nine 600 kN engines on a 4 m core, about $61M a rocket
- Crew. A capsule ($8M, 150 days in the engineering office; needs the orbital licence) for two crew, 2.4 t, under a 500 kg abort tower dropped at T+150 s. Its abort system has hidden flaws like an engine's: a tower that misfires, parachutes that fail, a capsule that breaks up pulling away in thick air. A pad abort on the new test range ($1.5M, 20 days) shows the first two; an in-flight abort spends a built rocket and fires at max-q, and only counts if it really came above 15 kPa. Each flaw has a fix in the office, and a fix means flying both tests again. A rocket is crew-rated once its engines are proven for their full burns, its last three flights reached orbit cleanly and both abort tests have passed. The crewed-flight licence wants five orbital deliveries, reputation 5, both abort tests and a crew-rated rocket ($2M, 90 days). Station resupply (the capsule with cargo, $75–90M a flight, from about day 500) needs only the orbital licence and builds the record; crew rotations ($130M) come later. If a rocket fails under a crew, the abort fires and the hidden truth decides: crew safe and an ordinary failed contract, or crew lost, the crewed-flight licence revoked, $50M and −10 reputation. The company survives
- An engine identical to one the company already has (same parts, same size) can't be developed again
- Engine work scales with the chamber. Developing a part, fixing it, the propellant a firing burns and the test engine a failure destroys all cost less on a 9 kN chamber than on a 250 kN one (a 35 kN chamber is the reference). A destroyed test engine costs 60% of its build price (pumps and valves are salvaged) and 12–18 days on its stand. At 35 kN a fix is $90–220k and 12–25 days: about half what it was. Developing a new engine with one new part takes about two to three weeks
- Achievements worked out from the record: first firing, first flight above 100 km, first orbit, the orbital licence, a fleet of five, $10M earned, a completed series and so on

## Balance

`npm run playtest` plays whole company runs with bots across seeds. The bots decide only from what a player sees: test reports, forecasts and the board. They fly sounding work (or test flights) until they can apply for the orbital licence, then take orbital work. There are four strategies: careful (full-duration firings with fixes, a transonic tunnel run, re-tuning, and bids only on a good forecast), cheap (5 s startup firings and CFD only), reckless (no tests) and greedy (careful, plus the SSO bid regardless of forecast). Current results over 30 seeds and a two-year horizon:

| Strategy | Survive | Reach orbit | Median cash at end |
|---|---|---|---|
| careful | 29 | 29 | $44.5M |
| greedy | 5 | 28 | −$0.9M |
| cheap | 17 | 8 | $4.6M |
| reckless | 13* | 3 | $3.9M |

\* Some reckless bots never earn the orbital licence; they stop trying and sit on their cash, so they count as alive.

Since engines share parts, testing one Harrier teaches about the other, so careful play reaches orbit sooner (median day 322, down from 406 before parts) and richer. Failures are shared too: a flaw in the shared cycle, injector or liner sinks both stages, and the greedy SSO bid kills 25 of 30. Student payloads and recovery flights give a company with a bad record a way back, so fewer runs stall; reckless bots now fly more and fail more. The bots build and launch straight away, so they don't use parallel builds or the drawing board, and they leave high-energy work (anything that needs a parking orbit and relights) alone: they only fly the preset Meridian. The table is unchanged by the high-energy update. Since the factory learns and failed test flights stopped costing reputation, careful play ends about $10M richer and cheap and reckless bots survive a little more often (from 34.9M, 15 and 10). The crew update leaves the bots alone: they never develop a capsule. Testing pays, and testing the wrong question costs nearly as much as not testing. Before the generated board, careful survived 24 of 30 with $15.1M: with more work posted, careful play is now comfortable and the money has nothing to buy. That waits on things worth spending on (a second pad and production line, bigger vehicles) rather than lower payouts. Payroll is $5k a day. An altitude-cell firing costs $200k plus $1.5k a second, so a full-duration upper-stage firing is about a sixth of a Meridian.

Not modelled yet: loans or investors, and the rest of DESIGN.md's later domains (structures, thermal, avionics, manufacturing, ground systems).

## Roadmap

1. ~~Company, licences, contracts~~ (done)
2. ~~Engines built from parts~~ (done)
3. ~~Vehicle builder, sizing guide, production lines~~ (done)
4. ~~New regimes, part a: coast and relight, transfer orbits, deep-space engines, mega-constellations~~ (done)
5. ~~New regimes, part b: crew~~ (done)
6. ~~Mobile-first UI overhaul~~ (done)
7. After that: reusable boosters (land and refurbish), the company's own constellation, and market eras where customers move to heavier payloads as reputation grows

## Playing in the browser

```sh
npm install
npm run dev          # http://localhost:5173
```

A React + Vite front end (`src/web/`) on the same sim code the tests and the command line use.

- **On a phone** (700 px wide or less) the sections move to a tab bar at the bottom and the top bar shrinks to one line: name, day, cash and reputation. Picking a contract, a signed launch or an engine opens it full-screen with a Back button, and the phone's back gesture closes it. Contracts are cards, with the less-used filters behind "More filters". Dialogs rise from the bottom with their buttons in reach, tabs scroll sideways, and the plan strip folds into a "Plan · N" chip. Checked at 360, 390 and 430 px.
- **Company:** the company's name (editable), its numbers, the licence ladder with an Apply button, where the money went, the fleet, achievements and the ledger.
- **Contracts:** a filterable table and a month calendar of postings, deadlines and rollouts, with a bid panel that only signs, or commits to every remaining launch of a series at once. Click any future day in the calendar to see what happens by then (postings, rollouts, deadlines at risk) and advance the company to it.
- **Launch:** build, re-tune and fly signed contracts.
- **Every job on a track** asks: Start now (the calendar runs to its end) or Add to plan (booked and paid; the calendar stays put). A plan strip under the top bar shows what each track is doing, with Advance to the next finish or to when it's all done; Company → Work lists the tracks, queues (cancel for a refund), extra units and recent results; the calendar shows when booked work finishes.
- **Hangar:** design drawings with an engine picker per stage; a Drawing board with the sizing guide (each stage is a one-line summary that opens to edit; the guide starts closed on a phone); a Factory with the production lines; and the flight record.
- **Hangar → Crew:** the capsule, the abort system with its tests, flaws and fixes, an in-flight abort on any built rocket strong enough to lift the capsule, crew-rated status per design and what the crewed-flight licence still wants.
- **Test stand:** firings, an Engine shop to develop engines from parts (each slot is one line showing the choice, opening into its options; only the chosen option's description shows), and a Parts tab of short cards: each shows the part's maturity, the one figure its slot is judged on (start and relight, stable seconds, chamber life, vacuum measurement, Isp) and what it needs next, and opens on tap into its record, revisions and test plan. Filter chips show one slot, or only the parts that need work. Each part card names what it still has to prove, and "Test it" opens the Firing tab on the cheapest engine built with it, with that firing set up. Injector and nozzle cards show the Isp their engines deliver against the drawings, the range the part type allows, what the last refinement bought once re-measured, and what another is worth in Δv and payload on each design.
- **Tunnel:** wind-tunnel and CFD runs.

Anything that uses up days asks first when it would cost a signed contract its deadline, then plays a short progress bar while the days pass. Launches replay the flight the sim just flew, then show the debrief. The run saves to the browser's local storage. `npm run build` writes a static site to `dist/`.

## Running

Needs Node 22.18 or newer, which runs TypeScript directly. The sim itself has no runtime dependencies; React is only for the browser front end.

```sh
npm install          # TypeScript, only needed for typecheck
npm run sim          # fly Pathfinder and print the debrief
npm run sim -- meridian                 # small orbital launcher, LEO 300 km
npm run sim -- meridian sso-500         # missions: suborbital, leo-300, sso-500,
                                        # leo-equatorial, leo-800, gto, tli, escape
npm run sim -- meridian leo-800         # parking orbit, coast, two relights
npm run sim -- fat-fairing              # also: vac-bell, overfuelled, two-stage,
                                        # meridian-lofted, meridian-hard-kick
npm run sim -- pathfinder --json

# Test campaign, then fly. Steps run in order: engine@seconds[/altitude] fires,
# tunnel:cfd|subsonic|transonic tests the vehicle's shape, fix:engine:mode or
# fix:aero:transonic-buffet fixes something a test found, retune re-tunes the pitch
# programme from what has been measured so far. --reveal shows the hidden truth.
npm run campaign -- meridian --seed 1
npm run campaign -- meridian --seed 6 harrier-sl@5 fix:harrier-sl:hard-start \
  harrier-vac@280/altitude --reveal       # the Harriers share a cycle: one fix covers both
npm run campaign -- meridian --seed 4 harrier-sl@140 harrier-vac@280/altitude \
  tunnel:transonic retune                                     # re-tune from what was measured
npm run campaign -- fat-fairing --seed 1 tunnel:cfd          # CFD misses the buffet

# A company run: the same steps plus contracts, builds and flights, against cash
# and calendar. See src/company.ts for every step.
npm run company -- --seed 3 board brief:sounding:pathfinder accept:sounding \
  build:pathfinder fly:pathfinder:sounding build:pathfinder fly:pathfinder \
  licence accept:leo-150 harrier-sl@5 fix:harrier-sl:hard-start harrier-sl@140 \
  harrier-vac@280/altitude tunnel:meridian:transonic \
  fix:aero:meridian:transonic-buffet tunnel:meridian:transonic \
  retune:meridian:leo-150 build:meridian fly:meridian:leo-150
npm run campaign -- fat-fairing --seed 1 tunnel:transonic \
  fix:aero:transonic-buffet tunnel:transonic
npm test
npm run typecheck
```
