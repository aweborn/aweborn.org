# Proposed ROADMAP.md rewrite: the Mana Mechanic (October model)

> **Status: proposal, not applied.** ROADMAP.md is only edited on Alex's explicit say-so. Say "apply the ROADMAP rewrite" and these replacements go in; then delete this file.
> Source of truth until then: [05-mana-economy.md](./05-mana-economy.md) (decisions + [formula](./05-mana-economy.md#the-mana-pool-formula)).

## Replacements

| ROADMAP location | Today (August model) | Proposed |
|---|---|---|
| L653 Example (events) | "Every first tap adds 500 mana of awe to the universal pool, and shared-awe doubles it" | "Every first tap is a moment of awe: it levels attendees up and pushes the Living Frontier outward, and shared awe doubles it when people tap together." |
| L657–660 Cards & the Mana Economy | Card sales → `$1 → 1,000 mana`; print-your-world as patronage; free cards add awe to the pool | Card-sale surplus is an ordinary gift (`K · α · net` mana into the pool, golden wave). **Patronage removed.** Free cards still create awe (XP + reach). No pay-to-win unchanged |
| L700–706 intro | Frontier radius = f(global pool); donations expand reality | Mana is the universe's creative energy **and literally compute**. One pool, filled by gifts, drained by manifesting. Frontier radius = f(**high-water line**). Donations both fill the pool and push the Frontier; awe pushes the Frontier and levels you up |
| L708–730 Universal Mana Pool (CRDT sketch) | `regenRate`, `donationMultiplier`, `solarCycle`, `totalEverGenerated` | October `ManaState` (`pool`, `reserved`, `highWater`, `frontierRadius`, `totalIn`, `totalDrawn`, `params {K, alpha, tauDays, floorPerDay}`) |
| L732–742 Mana Sources | Awe = PRIMARY source; donations = burst; natural regen; donation afterglow; solar tide | **One source: gifts** (`K · α · net`). Awe → XP + high-water reach, never pool mana. No regen, no afterglow. "No recycling / never contracts" kept (now about the high-water line) |
| L744–763 Awe Generation | Awe events mint mana (500, 50, 200, …) into the pool | Same events, but they grant **XP** and **reach**. Add: **reactions** (others' awe at your world) are the main XP source for makers. Shared-awe 2× and diminishing novelty kept |
| L765–785 Solar Tidal Cycle | ±50% personal flow modifier | Marked **open**: visual-only mood or gentle modifier on personal caps |
| L787–852 Mana Costs | Fixed costs (solidify 5,000, gravity 500, trail 50, …), targeted patronage, Oasis | Cost = **real compute × K**, by complexity (place/move nominal; meshes/terrain/sound a lot; a whole world a lot more). Table lives in Phase 07 `MANA_COSTS.md`. **Patronage + Oasis removed** |
| L854–891 Draw Mechanics, Donor Empowerment, Diminishing Returns | Per-player `flowRate = base × activity × solar × diminishing`; donors get cosmetics | **Flow & admission:** global cap `max(floor, pool / τ)`, personal caps (tunable in play), ordered requests with priority (formula TBD), reserve → settle → refund; denial whisper *"The world must be replenished…"*. **Donors get no personal advantage** (optional recognition in the wave only). Levels unlock abilities; money never does |
| L893–915 Visible, Audible, Tangible | Pool-level ambience; donation wave with optional recognition | Keep as is |
| L917–941 Pipeline | `$10 × 1,000`, lifetimeDonations for cosmetics, afterglow, "donor unlocks flare" | `inflow = K · α · net` → pool + highWater + ledger → frontier → wave. Remove afterglow and donor unlocks. Impact table recomputed with `α` once chosen |
| L943–955 Server Authority | VPS checks "flow rate incl. donor bonus and solar" | VPS checks pool − reserved, global cap, personal cap, legitimacy, solidified world; ledgered. Drop donor bonus + "donor status and cosmetic unlocks" paragraph |
| L959–963 Offline / Dream State | "…or for a Patron to bring them to life" | "…waiting for the Living Frontier to reach them." |
| L965–977 Emergent Behaviors | "Deep Dark Explorers… a Patron will fund them", "The Patron", "Exploration as the Engine: awe is the primary mana source", "Shared Wonder: 2× mana" | Remove Patron bullets. Exploration as the Engine → "awe levels you up and pushes the Frontier". Shared Wonder → "2× awe". Add "**Making things people love**": reactions are how makers grow |
| L981–985 System Rules | Radius ∝ ∛(pool); "targeted patronage creates bulges"; "awe = mana cost of object" | Radius ∝ ∛(high-water line); sector bulges from awe in that sector (no patronage); awe of seeing an object ∝ its cost, now as XP/reach |
| L995 Open: Mana Tuning | dollar-to-mana ratio, solar params | `α`, `τ`, `floor`, window, personal caps, priority formula, solar |
| L997 World Index Warp rules | free, no cooldown | free and no cooldown **once unlocked by level**; link/card arrival never gated |
| L1001 Print-your-world → patronage | open | ✅ **Decided 2026-10-13: no patronage** |
| Resolved table (phases/README) "Donor advantages: cosmetics only" | — | Already updated in phases/README to "no personal advantage" |
