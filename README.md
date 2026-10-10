# Untitled — Research-First Launch Company

A game concept: you are the chief engineer of a private launch startup. You do **not** fly the rockets. You design them, pay for tests, bid contracts, and watch the vehicle try to do the job. Research is the main loop. The company is the pressure: cash, calendar, reputation, and the chance the firm dies before first orbit.

This repo holds early design decisions only. Nothing here is a build spec.

## Documents

| File | What it is |
|---|---|
| [README.md](README.md) | Pitch, pillars, non-goals, loop |
| [DESIGN.md](DESIGN.md) | Decisions from the first design pass, with rationale |
| [src/sim/](src/sim/) | Simulation core: atmosphere, aero, engines, ascent, debrief |

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
- Engine test stand. Each engine has hidden truths rolled from the run's seed: real Isp, hard start, combustion instability onset and chamber life. Hot-fires on a sea-level stand or an altitude cell reveal only what they reach, cost cash and calendar days, and destroy the test engine when something fails. Fixes remove a mode the stand has seen, cost some performance, and make earlier proof void
- Wind tunnels. Each outer shape has hidden aero truths: real drag against the hand-estimated curve, the real transonic drag rise, and buffet on the fairing shoulder (likelier on a hammerhead fairing). CFD is cheap and gets drag about half right, but can't see buffet. The subsonic tunnel measures drag. The transonic tunnel measures the drag rise and shows buffet. Vortex generators fix buffet for about 3% drag. Buffet that drives the load past the structural budget breaks the vehicle up near Mach 1
- Before flight: a list of what the vehicle is flying on trust, and a forecast that flies the vehicle as measured, including any failure seen and not fixed. In flight, engines perform and fail as built, and the debrief points at the firing that would have caught the failure

The trajectory stays in one plane. Plane changes, the out-of-plane part of the pad's motion and coast-and-relight insertions aren't modelled.

- Pitch programme re-tuning. The trajectory office searches the gravity turn's kick angle and upper-stage ramp against the company's model of the vehicle: measured Isp and drag where tests measured them, the drawings where not, and known buffet. Inside half the tolerance it prefers propellant margin. Engine failures are left out, since no pitch steers around them. A re-tune is adopted only if its prediction reaches orbit

A re-tune is only as good as the testing behind it. Tuned on the drawings and flown on real engines, Meridian misses. With accurate test data and engine failures set aside, re-tuning takes it from 0 to 13 of 25 seeds in spec. Of the rest, 3 buffet whatever the pitch, and 9 lack the Δv for a 200 kg payload once real Isp is known.

- Company and contracts. Cash, a calendar, and a reputation record tagged by what happened. One stand, one tunnel, one pad and one build shop, used one job at a time. A seeded board offers suborbital crumbs, LEO work, an SSO contract that punishes a greedy bid, and an equatorial customer the pad can't serve. Contracts have payouts, penalties, deadlines, a reputation bar, and customers who refuse certain records
- The bid screen shows what a contract pays and risks, the build cost, regimes the design has never flown, everything on trust, and a forecast with the contract's payload
- Vehicles cost cash and days to build. A launch uses one up. In-spec delivery pays in full, an out-of-spec orbit pays half, and a loss or a missed deadline costs the penalty. Flights are tests too: telemetry teaches what the flight reached
- The run ends when the cash goes negative. The summary breaks down where the money went and what the record says
- Launch licences. A new company holds only the suborbital licence. The orbital one needs two flights above 100 km without losing the vehicle, a reputation of 0 or better, $250k and a 20-day review. Orbital contracts and orbital test flights are refused without it. A crewed-flight tier is on the map, but nothing can earn it yet
- A generated board on top of the hand-tested contracts: about 80 contracts per seed over three years, across sounding science, microgravity, technology demos, rideshares, smallsats, weather, constellations, space agencies and crew. Payloads and orbits stay inside what the preset launchers reach with typical engines, with a margin. Recurring series (a university's aurora campaign, three constellations, the rideshare broker) post an instance every month or two. Deliver one and the rest pay 5% more; fail or miss one and the customer withdraws the rest
- Achievements worked out from the record: first firing, first flight above 100 km, first orbit, the orbital licence, a fleet of five, $10M earned, a completed series and so on

## Balance

`npm run playtest` plays whole company runs with bots across seeds. The bots decide only from what a player sees: test reports, forecasts and the board. They fly sounding work (or test flights) until they can apply for the orbital licence, then take orbital work. There are four strategies: careful (full-duration firings with fixes, a transonic tunnel run, re-tuning, and bids only on a good forecast), cheap (5 s startup firings and CFD only), reckless (no tests) and greedy (careful, plus the SSO bid regardless of forecast). Current results over 30 seeds and a two-year horizon:

| Strategy | Survive | Reach orbit | Median cash at end |
|---|---|---|---|
| careful | 30 | 30 | $30.4M |
| greedy | 12 | 30 | −$0.7M |
| cheap | 6 | 3 | $4.0M |
| reckless | 18* | 1 | $4.8M |

\* Reckless bots that never earn the orbital licence stop trying and sit on their cash, so they count as alive. Only one of 30 reached orbit.

Testing pays, testing the wrong question costs nearly as much as not testing, and the greedy SSO bid kills more than half the companies. Before the generated board, careful survived 24 of 30 with $15.1M: with more work posted, careful play is now comfortable and the money has nothing to buy. That waits on things worth spending on (a second pad and production line, bigger vehicles) rather than lower payouts. Payroll is $5k a day. An altitude-cell firing costs $200k plus $1.5k a second, so a full-duration upper-stage firing is about a sixth of a Meridian.

Not modelled yet: running jobs in parallel (building while testing), loans or investors, and the rest of DESIGN.md's later domains (structures, thermal, avionics, manufacturing, ground systems).

## Playing in the browser

```sh
npm install
npm run dev          # http://localhost:5173
```

A React + Vite front end (`src/web/`) on the same sim code the tests and the command line use.

- **Company:** the company's name (editable), its numbers, the licence ladder with an Apply button, where the money went, the fleet, achievements and the ledger.
- **Contracts:** a filterable table and a month calendar of postings and deadlines, with a bid panel that only signs.
- **Launch:** build, re-tune and fly signed contracts.
- **Hangar, Test stand, Tunnel:** design drawings, engine firings and wind-tunnel runs.

Anything that uses up days asks first when it would cost a signed contract its deadline, then plays a short progress bar while the days pass. Launches replay the flight the sim just flew, then show the debrief. The run saves to the browser's local storage. `npm run build` writes a static site to `dist/`.

## Running

Needs Node 22.18 or newer, which runs TypeScript directly. The sim itself has no runtime dependencies; React is only for the browser front end.

```sh
npm install          # TypeScript, only needed for typecheck
npm run sim          # fly Pathfinder and print the debrief
npm run sim -- meridian                 # small orbital launcher, LEO 300 km
npm run sim -- meridian sso-500         # missions: suborbital, leo-300,
                                        # sso-500, leo-equatorial
npm run sim -- fat-fairing              # also: vac-bell, overfuelled, two-stage,
                                        # meridian-lofted, meridian-hard-kick
npm run sim -- pathfinder --json

# Test campaign, then fly. Steps run in order: engine@seconds[/altitude] fires,
# tunnel:cfd|subsonic|transonic tests the vehicle's shape, fix:engine:mode or
# fix:aero:transonic-buffet fixes something a test found, retune re-tunes the pitch
# programme from what has been measured so far. --reveal shows the hidden truth.
npm run campaign -- meridian --seed 1
npm run campaign -- meridian --seed 1 harrier-sl@140 harrier-vac@5/altitude \
  fix:harrier-vac:hard-start harrier-vac@280/altitude --reveal
npm run campaign -- meridian --seed 7 harrier-sl@140 harrier-vac@280/altitude \
  tunnel:transonic retune                                     # re-tune from what was measured
npm run campaign -- fat-fairing --seed 1 tunnel:cfd          # CFD misses the buffet

# A company run: the same steps plus contracts, builds and flights, against cash
# and calendar. See src/company.ts for every step.
npm run company -- --seed 3 board brief:sounding:pathfinder accept:sounding \
  build:pathfinder fly:pathfinder:sounding build:pathfinder fly:pathfinder \
  licence accept:leo-150 harrier-sl@140 \
  harrier-vac@280/altitude tunnel:meridian:transonic \
  fix:aero:meridian:transonic-buffet tunnel:meridian:transonic \
  retune:meridian:leo-150 build:meridian fly:meridian:leo-150
npm run campaign -- fat-fairing --seed 1 tunnel:transonic \
  fix:aero:transonic-buffet tunnel:transonic
npm test
npm run typecheck
```
