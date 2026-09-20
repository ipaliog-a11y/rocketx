# Early design decisions

Captured from the first concept pass. Suggested systems can change. The constraints below are the point.

---

## 1. Genre position

**Decision:** Research-first launch-company game. Management is a wrapper, not the product.

**Why:** Existing games split the space badly.

- Kerbal Career teaches flight mechanics; the “company” is thin and the tech tree is still mostly linear.
- EarthX and Space Company Simulator put the firm in front and keep rocket design as unlock-and-assemble.
- Perihelion / Meco go deep on engines but are not a launch-company teaching game.
- Agency games (Buzz Aldrin, Mars Horizon) pull toward a known historical path.

The hole: **pedagogical engineering + irreversible technical identity + light company constraints.**

**Originality test:** Two competent players finish with different firms (reliable solids shop vs methalox reuse vs late expensive hydrolox GTO specialist). If both end on the same big reusable stack, the game was linear with extra steps.

---

## 2. Player fantasy

**Decision:** Chief engineer, not pilot and not CEO-with-five-departments.

You design vehicles, schedule tests, accept or refuse contracts, and watch flights. You do not fly. You do not manage PR/HR trees.

**Why:** Flying is a different game (and Kerbal already owns learning-by-piloting). A spectator launch with a sharp debrief teaches ascent, max-q, mixture, and insertion without stealing the camera for twenty minutes.

---

## 3. What you do with rockets

**Decision:**

- Design them from engineering choices.
- Spend money on ground tests and test flights.
- Assign a vehicle to a contract.
- Watch takeoff, ascent, staging, orbit insertion (and later landing / coast / relight).
- Read an autopsy. Update the model. Bid again.

No manual control. Sandbox watching and replay sliders are allowed.

**Watchable feedback (required, not flavor):**

- max-q vs load budget
- fighting aero vs just thrusting
- mixture ratio drift
- control authority left
- insertion error (wrong inclination is a GNC story, not a generic fail)

Replay views: aero loads / control effort / engine health.

Static fires and stage tests are watchable. Most learning happens before flight.

---

## 4. How choices matter

**Decision:** A choice matters when it (1) fixes one constraint, (2) creates a new one, (3) closes a cheaper path later, and (4) shows up on the watched launch.

If two designs both succeed and only money changes, research was a buff shop.

**Pattern:** Each contract is a problem statement. Domains are incompatible answers.

Example: *200 kg to 500 km SSO, 18 months, limited pad, customer hates vibration.*

| Domain | How it can solve it | What it costs |
|---|---|---|
| Aerodynamics | Slimmer stack, cleaner fairing, lower max-q, less steering loss | Less volume, harder structures, worse packing |
| Flight control | Grid fins / TVC / RCS so a fat cheap rocket still flies | Software risk, actuator mass, gust / slosh coupling |
| Engines | Higher T/W, punch through the atmosphere | Heat, turbopump complexity, longer test campaign |
| Fuel chemistry | Denser propellant → smaller tanks → less drag | Toxicity, boil-off, GSE, Isp or logistics hit |

A later high-energy contract must punish the dense-but-dirty LEO favorite or reward the hydrolox path you suffered for. If every mid-game rocket can do both jobs, domains were cosmetics.

---

## 5. Research is experiments, not a tech tree

**Decision:** No “click node, wait bar, unlock Merlin.” Research is scheduled tests with fidelity vs time vs cash.

Suggested starting domains (not a closed list):

- Aerodynamics — tunnel / CFD fidelity. Cheap runs lie about transonic buffet.
- Flight control — HITL. TVC + skinny stack → POGO / slosh. Baffles, shorter stack, or a sharper filter.
- Engines — hot-fire. Mixture, chamber pressure, nozzle expansion. Sea-level vs vacuum bell is visible on the pad.
- Fuel chemistry — lab + tank. Hypergolics start and poison the site. Methane needs insulation. Solids are simple and vibrate.

Add a domain only if it can **cause a watched failure** and **be tested**.

Candidates later:

- Structures / tanks — buckling, slosh, common bulkhead
- Thermal — coast soak, base heating
- Avionics / software — cheap control until a new regime
- Manufacturing — scatter and welds, not a single reliability number
- Ground systems — perfect engine, pad cannot load it

Each test answers a question the player wrote down (“does this nozzle separate at max-q?”), not “+8% reliability.”

Failure text must name the physics: under-expanded, filter lag, fat fairing at max-q, RP-1 coked the channels. If it says “reliability 73%,” teaching is dead.

---

## 6. Company layer (background only)

**Decision:** Company systems exist only as constraints.

Keep:

- cash
- calendar (stands and pads are booked)
- reputation tagged by *failure mode* (customer accepts delay, not a toxic spill)
- facilities that lock chemistry (hypergolic plumbing makes methane a rebuild)
- test capacity (people are just throughput, not an HR sim)

Cut:

- PR / HR / Finance department trees
- employee happiness
- building 40 launch pads as progression
- cadence grind as the win condition

One pad, one stand, a small test budget. That is enough firm.

---

## 7. Economy of uncertainty

**Decision:** 100% failure-free is impossible. Certainty is purchased.

Rough curve:

- 0 flights — hidden modes fully armed
- 1–2 flights — dumb problems die (wiring, startup, fin flutter)
- more flights — diminishing returns; leftover risk is rare, expensive, regime-specific (vacuum start, long-coast guidance, thermal soak)

Skip tests and the watched launch is a coin flip you chose. Over-test and the calendar kills the contract.

Test flights cost money on purpose. That cost is the tax that makes early bankruptcy possible.

---

## 8. Contracts and ambition

**Decision:** Safe contracts reuse regimes you have already flown. Ambitious contracts introduce a new regime.

Every bid shows:

- payout
- penalty / reputation
- **unknowns this vehicle has never seen** (energy, fairing volume, coast time, relight, thermal)

GTO after LEO is not “harder LEO.” It is engine-off coast, vacuum start, longer soak. If you never tested coast-relight, the bid screen says you are gambling.

Signing up is optional. Surviving to first orbit is not.

---

## 9. Fail state and first gate

**Decision:** LEO is the first run gate, not a tutorial checkbox.

Opening:

1. Tiny sounding / suborbital work (almost free learning)
2. Optional small LEO that can recapitalize the company
3. Fork: stack another LEO for reputation, or bid something you cannot insert

**Run ends when:** cash ≤ 0 and no vehicle can put *anything* in orbit.

Cause should be readable: overbuilt, tested the wrong question, or ate a contract penalty. Not a missed minigame.

After LEO the same logic scales to new regimes.

---

## 10. Small roguelike

**Decision:** One company = one run. The firm can die. The player’s knowledge persists.

Randomize the **situation**, never the rocket equation.

Good seeds:

- starting cash, pad weather, first customer mix
- which test stand is cheap this decade
- a hidden materials / supplier quirk discoverable by tests
- contract board: safe LEO crumbs vs one GEO that will bankrupt a greedy bid
- one era event (embargo, hypergolic ban, competitor dumps rideshare price)

Bad seeds:

- “engine explodes 30% because seed”
- invisible dice no test could have revealed

If a failure can happen, there was a test you skipped or a model you trusted too far.

**Run length:** about 3–8 hours to a decisive outcome (sustainable LEO, niche contractor, or dead). Not a 20-minute smash run. Teaching needs time.

**Meta between runs (thin):**

- better briefings / plots of the last failure
- maybe one starting facility
- no permanent “unlock Raptor”

Unlock understanding: you start the next run already knowing why a sea-level bell looks wrong in vacuum because *you* burned a company learning it.

Fair autopsy test: the player can point at the death.

> We bid SSO before a guidance test. Last cash went into a pretty engine instead of a second suborbital. Max-q was fine. Insertion was 2° off. Company dead.

If they say “RNG exploded the booster,” the roguelike ate the research game.

---

## 11. Technical identity over campaign milestones

**Decision:** No prescribed endgame vehicle.

Early: almost any philosophy reaches suborbital / small LEO. You pick a bias.

Mid: the bias bites.

- Aero-first — elegant, late on thrust, heavy GEO hurts
- Engine-first — overpowered, fat, expensive, fails max-q until aero catches up
- Chemistry-first — odd logistics, great density or Isp, regulators or customers push back
- Control-first — ugly rockets that fly, until a new regime exceeds the software

Late: double down or specialize. Both completable. Both should feel like a different factory.

Linear “unlock Falcon → Starship” is explicitly rejected.

---

## 12. Session shape

**Decision:** Design → test → one flight → debrief in roughly 10–15 minutes.

Watching without flying feels like a cutscene factory if research is sliders. Short loops plus failures that point at one domain first keep it a game.

Shipping a wrong-but-working vehicle with a lasting penalty is allowed and encouraged.

---

## 13. Non-goals (this pass)

- Kerbal-style construction and piloting
- Multiplayer
- Full historical recreation of SpaceX
- Deep colony / Mars city builder (destination can exist as a contract regime later; it is not the product)
- Combat
- Idle / clicker cadence

---

## 14. Open questions

- Working title.
- How much real chemistry and cycle detail before it stops being a game.
- How visible the math is (Tsiolkovsky, load plots) vs diegetic engineer talk.
- Whether reuse is a mid-run fork or a late specialist path.
- How many domains ship in a first prototype (likely two: engines + one of aero / control).
- Save model inside a run (reload last test vs ironman only).
- Tone: dry engineering drama vs slightly comic startup.

---

## 15. Prototype suggestion

Smallest thing that can prove the idea:

1. One pad, one stand, one cash pile.
2. Two domains only (engines + aero, or engines + chemistry).
3. Suborbital → small LEO contracts only.
4. Tests that reveal named failure modes.
5. Watchable ascent + debrief.
6. Run can die.

If that loop is tense and readable, add control, then facilities-as-locks, then ambition contracts.
