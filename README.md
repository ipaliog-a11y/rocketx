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

Prototype started. The domains are **engines + aerodynamics** (DESIGN.md §15). No name locked.

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
- Before flight: a list of what the vehicle is flying on trust, and a forecast from the measured engine performance. In flight, engines perform and fail as built, and the debrief points at the firing that would have caught the failure

The trajectory stays in one plane. Plane changes, the out-of-plane part of the pad's motion and coast-and-relight insertions aren't modelled.

Pitch programmes are open-loop and tuned on design Isp. Once the stand measures the real Isp, a tuned programme usually misses its insertion tolerance, so re-tuning against test data (or closed-loop guidance from the flight-control domain) is the obvious next lever.

Next: wind-tunnel runs for the aero domain, re-tuning the pitch programme from test data, then contracts that bid on these missions with cash and calendar.

## Running

Needs Node 22.18 or newer, which runs TypeScript directly. The sim has no runtime dependencies.

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
# fix:engine:mode fixes something the stand found. --reveal shows the hidden truth.
npm run campaign -- meridian --seed 1
npm run campaign -- meridian --seed 1 harrier-sl@140 harrier-vac@5/altitude \
  fix:harrier-vac:hard-start harrier-vac@280/altitude --reveal
npm test
npm run typecheck
```
