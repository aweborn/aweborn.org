# Phase 05: Mana Economy & Donations

**Status:** `[ ]` Not Started (design ~settled 2026-10-13; see [The Mana Pool Formula](#the-mana-pool-formula))
**Depends on:** [Phase 02: Multiplayer Core](./02-multiplayer-core.md), [Phase 04: Navigation & Controls](./04-navigation-controls.md)
**ROADMAP reference:** [The Mana Mechanic: The Frontier of Dreams](../ROADMAP.md#the-mana-mechanic-the-frontier-of-dreams) (⚠️ still describes the August model; this file supersedes it until ROADMAP is refreshed: see the 2026-10-13 night session log row)
**Estimated sessions:** 4-5

## Goal

Implement the mana economy. **Mana is the universe's creative energy, and it is literally compute:** one universal pool, filled by donations, drained when players manifest things with Gen AI. Nobody holds mana. Giving swells the pool for everyone; the more there is, the faster the whole universe can create. Separately, the **high-water line** (everything that has ever flowed in, plus the reach of awe) sets the **Living Frontier**, and Ghost worlds solidify when the Frontier reaches them. The **solidification wave** (a golden shockwave sweeping outward when someone donates) is the defining visual moment of Aweborn.

**Awe is about growth, not energy:** exploring and the reactions others have to what you made earn **experience → levels** (which unlock abilities) and push the high-water line outward. Awe never mints spendable mana.

**Key deviation from the original ROADMAP (2026-10-13):** the August model (awe as the primary mana source, natural regeneration, donation afterglow, per-player flow rate with diminishing returns, fixed game-design costs, targeted patronage) is retired. The October model is below. Gen AI cost research lives in [Phase 07](./07-genai-creation.md).

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Mana authority | **Server-authoritative** for manifesting (solid worlds, AI generation). **Dreaming stays free, manifesting draws on the universal pool** (Alex, 2026-10-13): ghost/offline creation needs no mana and no validation | Prevents cheating while allowing unlimited offline creativity |
| Who holds mana | **Nobody. Players hold no mana at all** (Alex, 2026-10-13 evening). There is one **universal pool**; giving to the mission swells it. *Supersedes the morning's personal reserve, mana purchases, creator earnings and the Curiosity Budget.* | Every gift is a pure gift: no personal benefit, so no purchase-vs-donation or unrelated-business-income problem |
| What mana is | **Mana = compute.** 1 mana = $0.001 of real compute (`K = 1,000` mana per compute-dollar). A manifestation costs exactly what it costs us, converted at `K`. No markup (draft, 2026-10-13 night) | The pool is honestly "how much imagination the donors have paid for" |
| Pool | **Linear in money:** each net donation adds `K · α · amount`; each manifestation subtracts its cost. Up with gifts, down with creation (Alex, 2026-10-13 night). See [formula](#the-mana-pool-formula) | Simple, explainable, auditable |
| Creative share `α` | **Draft:** only a published share of each gift becomes mana (example 60%); the rest funds research, ops and people. **Alex to decide** the value (or `α = 1` with ops funded by grants) | Not every donated dollar can be compute |
| Flow rate | **The universe's flow rate rises for everyone as the pool grows** (Alex, 2026-10-13 evening). Draft: global cap per window = `max(floor, pool / τ)`, so a full pool flows fast and a low pool flows gently; donation velocity raises it automatically | Compute spend can never outrun what donors give; the pool can't be drained in an afternoon |
| Personal caps | **Per-player cap per window, tunable during play** (e.g. by level). Fairness under scarcity, not a paywall: when the pool is healthy the caps are generous (Alex, 2026-10-13 night) | "Unlimited imagination" for everyone, shared fairly when energy is low |
| Admission & order | **Requests are ordered; each asks "how much compute does this take?"** If it exceeds what the pool (and caps) allow → no-dice and the universe whispers *the world must be replenished*. **Priority order, formula deferred** (Alex, 2026-10-13 night). Reserve the estimate, settle the actual, refund on failure | No literal simultaneity; a queue with a gentle denial |
| Mana cost model | **Priced by complexity, driven by real costs** (Alex, 2026-10-13). Place/move: tiny; meshes/terrain/sound: a lot; a whole new world: a lot more. Abstracted by output, not provider | Mana stays honest about what reality costs |
| Cost abstraction | **Not tied to specific AI model/provider**: based on output metrics (complexity, duration, resolution) | Allows provider swaps without economy changes |
| Experience & levels | **Levels unlock abilities** (e.g. warp, creating a sound): a scaffolded, studio-like path through every Gen AI tool (Alex, 2026-10-13 evening). **XP comes from reactions** (other players' awe at what you made) **and your own awe**, *not* from mana channeled (Alex, 2026-10-13 night): manifesting is a core feature for everyone, never something to grind. **Warp gated behind a level** (Q14 b). Card taps / `/w/<uuid>` links always deliver a player inside the world. What a level measures (Q16) is **open** | Rewards making things people love; no incentive to burn the shared pool for XP |
| Two numbers | **High-water line** = everything that has ever flowed in + awe reach (sets the Frontier, never falls) + **Pool** = mana available to flow now (decided 2026-10-13, Alex) | Spending never shrinks reality |
| Awe | **Awe gives experience *and* raises the high-water line** (Alex, 2026-10-13 evening, Q13 a). Only donations fill the pool / raise the flow | Curiosity is rewarded without minting spendable mana |
| Patronage | **Scrapped** (Alex, 2026-10-13 night): no targeted solidification, no Oasis, no print-your-world patronage | Donations buy no personal advantage; the Frontier belongs to everyone |
| Donor perks | **None beyond optional recognition in the wave** (implied by "no personal advantage"; replaces Aug 19 "cosmetics only"). *Confirm with Alex* | Pure gifts |
| Organization | **Aweborn is a non-profit, already incorporated with 501(c)(3) status** (Alex, 2026-10-13). Mission: MatchRank research, systematically building teams with psychological safety (see [RESEARCH.md](../RESEARCH.md)). No equity investors; backers are donors, grant makers, impact funders, research partners | Mission first |
| Glow | **Aura brightness scales with mana channeled recently**, no rank or status (Alex, 2026-10-13, Q9 b) | Rewards manifesting, not hoarding |
| Donation pipeline | Existing Stripe → Lambda → mana pool (extend current Lambda) | Reuses proven payment flow |
| Frontier shape | Sector-based (not perfect sphere) | Allows organic expansion bulges |
| Mana → radius | `r ∝ ∛(high-water line)` (confirmed 2026-10-13, Alex, Q10 a) | Early gifts have dramatic effect; each mana adds equal volume |
| Solar cycle | **Open** (was a per-player flow modifier, which no longer exists). Options: visual-only day/night mood, or a gentle modifier on personal caps | Healthy rhythms without a personal flow rate |
| Draw validation | sync-service validates all mana draws (solidified-world actions + AI generation) | In-memory state makes validation fast |
| Creation model | **Online = AI prompt (draws mana), Offline = edit/arrange (free)** | AI calls need network; editing is local-only |

## The Mana Pool Formula

> Draft v1 (2026-10-13 night), written from Alex's description: *money in → mana pools up → players manifest → pool drains a little*, with personal caps and global caps on flow. Pushback is called out inline.

```text
Constants (tunable, public)
  K      = 1,000 mana per compute-dollar     1 mana = $0.001 of real compute
  α      = creative share of each gift        draft 0.6  (Alex decides)
  τ      = drain horizon                      draft 14 days
  floor  = minimum global flow                draft 2,000 mana/day (or 0)

When a gift lands (Stripe webhook, net of processor fees)
  inflow     = K · α · net_amount
  pool      += inflow
  highWater += inflow                         never falls

When awe happens
  highWater += reach(awe)                     never touches the pool
  xp[player] += xp(awe)

Global flow cap, per window (e.g. per minute)
  globalCap  = max(floor, pool / τ)           pro-rated to the window

When a player asks to manifest r (requests are processed in priority order)
  est = estimate(r)                           real compute cost × K
  admit if   est ≤ pool − reserved
         and est fits globalCap this window
         and est fits personalCap[player] this window
  admit  → reserved += est → generate → pool −= actual, reserved −= est
           (failure → nothing drawn)
  reject → whisper: "The world must be replenished…"   (gentle, not punitive)

Frontier
  frontierRadius = c · ∛(highWater)
```

![Illustrative 120-day simulation of the universal mana pool](./assets/mana-pool-model.png)

*Illustrative only, made-up numbers. Regenerate with `python3 phases/assets/mana_pool_chart.py`. Top: the pool (gold) jumps with gifts and drains slowly while people manifest; the high-water line (violet) only rises. Bottom: daily inflow vs mana drawn, players' demand, and the global cap.*

**What the chart shows (and the pushback):**

1. **Linear and direct, as asked.** Every dollar adds the same mana; every manifestation subtracts its real cost. Nothing else (no regen, no afterglow) touches the pool.
2. **Pushback: `α`.** If 100% of every gift becomes compute, nothing pays for research, ops or people. A published creative share keeps the formula linear and honest ("60% of your gift becomes mana"). Alex picks the number.
3. **Pushback: tie the global cap to the pool (`pool / τ`).** This is what makes "flow rises with donations" automatic, and it means a single afternoon can never drain months of gifts (the dry spell, days 60–90, drains gracefully instead of crashing to zero).
4. **Consequence: early days are throttled.** With a tiny pool, the cap is tiny (red dots, days 0–20). Fix with a seed grant into the pool, a non-zero `floor`, or both.
5. **Mana = compute, so no markup.** The old "+7%" / "4× direct cost" ideas are gone: the non-profit's costs are covered by `1 − α`, not by overcharging mana.
6. **Reserve, then settle.** Gen AI cost is only known afterwards, so admission reserves the estimate; failures cost nothing.

**Open (for the next session):** values of `α`, `τ`, `floor`, the window size; how personal caps scale (by level?); the priority formula; whether the pool/caps are shown to players as numbers or only as ambience.

## Tasks

### Universal Mana Pool & Ledger
- `[ ]` Extend the existing `ManaState` in `shared/crdt-schema.ts` (don't redefine) to the October model:
  ```typescript
  interface ManaState {
    pool: number;          // spendable now (mana)
    reserved: number;      // estimates held for in-flight manifestations
    highWater: number;     // Σ inflow + Σ awe reach; never falls; sets the Frontier
    frontierRadius: number;
    totalIn: number;       // lifetime mana from gifts
    totalDrawn: number;    // lifetime mana drawn by manifesting
    params: { K: number; alpha: number; tauDays: number; floorPerDay: number };
    lastDonationAt: number;
  }
  ```
- `[ ]` Append-only ledger on the VPS (SQLite): gifts, reservations, settlements, refunds, awe reach. The CRDT shows totals; the ledger is the audit trail
- `[ ]` Server writes mana state to the Universe CRDT (authoritative); clients read it reactively

### Flow & Admission (server)
- `[ ]` `server/sync-service/src/mana.ts`: `requestDraw(player, estimate)` → admit / reject per [the formula](#the-mana-pool-formula)
- `[ ]` Global cap per window = `max(floor, pool / τ)`; personal cap per window (tunable; by level TBD)
- `[ ]` Ordered request queue with a priority hook (`priority(request)` returns 0 for now; formula deferred)
- `[ ]` Reserve → settle actual → release on failure, atomically with the ledger
- `[ ]` Gentle denial: *"The world must be replenished…"*
- `[ ]` Ghost creation requires **no validation** (free, unlimited)

### Donation → Mana Pipeline (Extend Lambda)
- `[ ]` On `payment_intent.succeeded`: `inflow = K · α · net_amount` → pool + highWater + ledger (via VPS API)
- `[ ]` VPS recalculates `frontierRadius`, broadcasts the expansion, triggers the solidification wave for everyone online
- `[ ]` Optional donor recognition in the wave (named or anonymous). No other donor perks
- `[ ]` Product-agnostic so [Phase 08](./08-nfc-trading-cards.md) card-order surplus flows in as ordinary gifts
- `[-]` ~~`donationMultiplier` 24 h afterglow~~ retired: the flow follows the pool automatically

### Living Frontier & Solidification
- `[ ]` Server calculates `frontierRadius = c · ∛(highWater)`
- `[ ]` Sector-level solidification tracking
- `[ ]` Ghost → Solid transition when the Frontier reaches a world (`solidified: true`, `solidifiedAt`; physics + collision on)
- `[-]` ~~Targeted patronage (5,000 mana) and Oasis~~ scrapped 2026-10-13 (Alex)

### Solidification Wave (The Golden Moment)
- `[ ]` Create `src/effects/SolidificationWave.tsx`
- `[ ]` Golden, translucent shockwave shader (refraction effect)
- `[ ]` Ripples outward from Aweborn Portal at origin
- `[ ]` As wave hits Ghost worlds: wireframes shatter → reform as solid objects
- `[ ]` Audio: deep bass sweep → warm orchestral hum

### Awe → Experience + Reach
- `[ ]` Create `src/systems/AweTracker.ts` (client) and wire the stubbed server hook `server/sync-service/src/awe.ts` (`onFirstDiscovery`, `onAwe`)
- `[ ]` Awe events (first world visit, first creation seen, distance milestone, slingshot chain, cluster discovery, long-absence return) grant **XP** and **high-water reach**, never pool mana. Amounts TBD with the levels design
- `[ ]` **Reactions:** other players' awe at a world credits XP to its creator(s): the main XP source for makers
- `[ ]` Shared-awe 2× when near other players; diminishing novelty on revisits
- `[ ]` Server validates (cheap checks now, [Phase 09](./09-authoritative-flight.md) server-derived later)

### Experience & Levels (design pending, Q16)
- `[ ]` Decide what a level measures (Q16, deferred by Alex 2026-10-13)
- `[ ]` Unlock ladder: which tools/abilities open at which level (warp gated; link/card arrival never gated)
- `[ ]` Gate the live World Index "Warp here" button once levels exist

### Solar Cycle (open)
- `[ ]` Decide: visual-only day/night mood, or a gentle modifier on personal caps (there is no personal flow rate anymore)

### Mana Costs
- `[ ]` Cost of each manifestation = real compute cost × `K`, from the Phase 07 cost research (`MANA_COSTS.md`)
- `[ ]` Non-compute actions (place/move/arrange): nominal or free; decide with the cost table
- `[-]` ~~Old ROADMAP fixed costs (gravity 500, avatar trail 50, …)~~ retired

### Mana Visualization
- `[ ]` Pool level affects universe ambience:
  - High (>80%): bright stars, rich nebulae, ambient particles
  - Medium (30-80%): baseline
  - Low (<30%): dim, sparse, desaturated
  - Critical (<5%): near-dark, aurora near Portal
  - *(open: "%" of what? e.g. pool relative to 30 days of typical draw)*
- `[ ]` Audio ambience scales with pool level
- `[ ]` Drawing mana → satisfying sound (universe breathing through you)

## Acceptance Criteria

- [ ] Mana pool is visible in the Universe CRDT and reflected visually
- [ ] A donation adds exactly `K · α · net` mana and triggers the solidification wave
- [ ] Manifesting draws the real cost; a request the pool or caps can't cover is gently denied; failures cost nothing
- [ ] The pool can't drain faster than the global cap allows
- [ ] Ghost worlds solidify when the Frontier (from the high-water line) reaches them
- [ ] Awe events grant XP and high-water reach, never pool mana
- [ ] Mana draws are server-validated and ledgered
- [ ] Ghost creation is free and requires no server validation
- [ ] Universe ambience changes based on pool level

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/systems/AweTracker.ts` | NEW | Awe events → XP + reach |
| `src/effects/SolidificationWave.tsx` | NEW | Golden shockwave effect |
| `src/components/FrontierVisual.tsx` | NEW | Living Frontier boundary rendering |
| `shared/crdt-schema.ts` | MODIFY | Extend `ManaState` |
| `server/sync-service/src/mana.ts` | NEW | Pool, admission, reserve/settle, ledger, frontier |
| `server/sync-service/src/awe.ts` | MODIFY | Wire the stubbed hook to XP + reach |
| `infra/cloudformation.yml` | MODIFY | Extend Lambda for the mana pipeline |
| `phases/assets/mana_pool_chart.py` | NEW | Illustrative pool simulation + chart |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| — | — | — |
| 2026-10-03 | Plan reconciliation: noted existing `ManaState` type; flagged the compute-pegged vs fixed-cost conflict. No implementation yet. | Resolve cost-model question, then start Universal Mana Pool |
| 2026-10-13 | **Design session opened (Alex: "willing to be grilled").** Three contradictions to settle first. **Q1: does spending shrink the Frontier?** ROADMAP has `r ∝ ∛(pool)` + draws spend the pool + "never contracts". Proposal (a): two numbers, **Reach** (lifetime, only rises, sets radius) and **Pool** (spendable). **Q2: what does a player spend mana on?** Most costed actions cost the nonprofit nothing. Proposal (a): only things with a real cost (AI generation, compute + ~7%); building/editing free, solid or ghost. **Q3: is awe real mana?** Awe creates mana from nothing; if mana pays compute, farming awe spends real money. Proposal (a): awe feeds Reach only; Pool is dollar-backed (+ maybe a budgeted daily allowance). Combined model: *exploring and giving expand reality; dollars pay for imagination.* Server side: the 8B awe hook (`server/sync-service/src/awe.ts`) is stubbed and waits on these answers. | Alex answers Q1–Q3; then: flow rate vs pool, frontier growth curve, solar cycle scope, what solidification unlocks |
| 2026-10-13 | **Alex's answers.** A1: two numbers, **high-water line** (farthest mana has spread) + **pool** (spendable now). A2: everything that manifests costs mana by complexity (place/move: very little; meshes/terrain: a lot; a whole new world with new sounds/meshes: "a decent amount of money"); prices driven by the real economy and cover cloud, ops, support; **the economy is the business model for investors/donors and the company must make money**; draft a business plan alongside. A3: **awe generates mana**, felt by the collective, spreads, and curiosity increases your ability to create; the company must also fund research (personality → team matching). **Done:** decisions recorded above; compute + 7% retired; **business plan draft v0.1** written *outside the public repo* (MASTER_PLAN: business/admin records live in Drive): $1 = 1,000 mana, generation at 4× direct cost (~$35 to manifest a new world), **Curiosity Budget** (awe mints from a revenue-tied cap, so free mana can't outrun income), break-even ~110k MAU at baseline. **Flags:** non-profit vs investors (entity), mana purchases aren't tax-deductible donations, Aug 19 "donor advantages cosmetic only" collides with paying to manifest, privacy page vs personality research. | Alex: Q4 (who can spend bought mana: personal reserve?), Q5 (Curiosity Budget OK?), Q6 (ghost/offline placement still free?), Q7 (entity + where the plan lives) |
| 2026-10-13 | **Alex's answers A4–A7** (after a detour on how Roblox makes money: free Studio, players buy Robux, creators cash out ~25–30%; raised Q8 creator economy). A4: **personal reserve**, and a bigger reserve should help the people around you (personal + universe empowerment; emotions are contagious; manifest together). A5: Curiosity Budget confirmed, monthly, **later automated from the statements**. A6: **dreaming free, manifesting costs**. A7: **non-profit** earning money to fund research into making corporate work humane. **Proposal "Resonance"** (plan draft v0.2): glow (aura = reserve, no rank), contagious curiosity (+awe near glowing players, Curiosity Budget), ripple (5% of each manifestation spills to nearby players, paid from margin, capped), manifesting together (pooled reserves + bonus, shared credit). Flags added: possible unrelated business income tax → for-profit subsidiary; Terms page currently calls every payment a donation. | Alex: Resonance OK? Does glow scale with reserve (rewards hoarding) or with mana recently channeled (rewards manifesting)? Q8 creator economy. Plan location |
| 2026-10-13 | **Alex's answers.** Aweborn is **already incorporated with 501(c)(3) status**. **Q9 (b):** glow scales with mana channeled recently. **Q8 (a):** creator earnings stay in-game, no cash-out. **Plan location:** Drive `users/alexander-medeiros/places/aweborn/aweborn-business-plan.md` (**v0.3**, next to the IRS confirmation). Decision rows added above. | Next grilling topics: flow rate vs pool, Frontier growth curve from the high-water line, solar cycle scope, what solidifying unlocks, ghost → solid pricing, creator-world entry pricing |
| 2026-10-13 | **Q10 (a):** Frontier radius = cube root of the high-water line. **Q11 (a):** reserve spends instantly, shared-pool draws throttled per player per day, *but Alex wants to stay squarely non-profit*: maybe the "reserve" should be an increased flow rate instead of a stockpile. Alex asked how charity auctions (vacations for $10k+) are fine when selling mana feels risky. Short answer given: auctions are occasional, volunteer-run and sell donated items, so they fall under the IRS exceptions to unrelated business income; mana sales are ongoing, staff-run and not donated, so they may be taxable unless the game is substantially related to the mission. Taxable is not forbidden (21% on net, a risk only if it becomes the main activity). **Reserve vs flow rate doesn't change the tax answer:** any payment that buys an in-game benefit is a purchase. Committed the morning's 8B work. | Tonight: Q12 reserve as flow rate vs stockpile (a game-design choice); how to make the game itself serve the mission (consented research, education) so revenue is related; then flow rate vs pool, solar cycle, solidifying, ghost → solid pricing, creator-world entry |
| 2026-10-13 (evening) | **Alex's new model (supersedes personal reserve, Resonance-as-reserve, mana purchases and creator earnings; table not yet rewritten, pending confirmation of open questions).** **Players hold no mana at all.** Giving to the mission swells the **universal mana pool**; **flow rate rises for everyone with donation velocity**. Manifesting = channeling mana through a Gen AI prompt for some time. Manifesting earns **experience → levels**, and levels unlock abilities (e.g. warp, creating a sound): a scaffolded, studio-like path through all the Gen AI tools that teaches why mana matters and why everyone explores and gives together. Consequences: donations become pure gifts (no personal benefit) so the purchase-vs-donation and unrelated-business-income worries mostly disappear; compute spend is bounded by flow rate, so the game can't outspend its donors. **Origin of Aweborn:** Alex's 2023 grad-school statement of purpose (Drive, `profile/academia-grad/stanford-2023`) proposed **MatchRank**: systematically matching people in an organization (mentor, mentee, aligned peer) to build belonging and engagement. Aweborn *is* MatchRank: the game exists to gather (consented) telemetry on personality and teamwork in creation and play, to merge psychological-safety, personality and team-dynamics research into systematically building great teams. **Not yet documented anywhere in the repo.** | Alex: where the vision doc lives, awe's role, warp gating (warp is already free and live), research consent model |
| 2026-10-13 (evening) | **Q12 (a):** new public [RESEARCH.md](../RESEARCH.md) (draft v0.1: MatchRank origin, hypothesis *match → observe → re-match*, data principles). **Q13 (a):** awe gives experience and raises the high-water line; only donations raise flow. **Q14 (b):** warp gated behind a level (scaffold movement first); open: card taps and `/w/<uuid>` links must still deliver new players, and the live World Index "Warp here" button needs gating. **Q15 (b, refined):** no consent form for disclosed, pseudonymous, aggregated gameplay telemetry; the Privacy page must be updated before telemetry ships; explicit opt-in only for anything that profiles an identified person (personality read-outs, workplace matching); 13+ for research data; university IRB only when publishing with a partner. Decision table rewritten for the evening model. | Alex: confirm the refined Q15 and the link exception; then levels design (what unlocks when), flow-rate formula from donation velocity, business plan v0.4 (donation-led) |
| 2026-10-13 (evening) | **Confirmed:** refined Q15 (disclosed telemetry, no consent form; opt-in only for profiling an identified person or workplace matching). **Link exception:** card taps and `/w/<uuid>` links always deliver a player, and **the default is to land *inside* the world** ("like a game pack: tap and you're in"). **Privacy + Terms updated** (Alex: "disclose anything necessary"): Privacy now discloses the **World Index records that were already live but undisclosed** (seen/visited, how found, visit count, first/last visit), adds a Research section (gameplay only, pseudonymous + aggregated, separate from sign-in details, policy updated *before* any new recording, opt-in for individual profiling, de-identified publishing, university ethics review), and replaces "no tracking" with "no ads and no third-party trackers". Terms: donations grow the shared mana for everyone and buy no personal advantage, 501(c)(3) note, Research pointer, email sign-in, card taps open worlds. Aweborn is already 18+, so research data is clear of COPPA. | Next: levels design (what unlocks when; warp gating), flow-rate formula from donation velocity, business plan v0.4 (donation-led); deploy the updated legal pages |
| 2026-10-13 (night) | **Review + formula.** Assistant review: the evening model is the first coherent one (pure gifts, spend bounded by donors, tied to the mission); gaps flagged: stale task list, patronage vs "no personal advantage", undefined pool/flow, splitting flow among players, XP farming, warp gating. **Alex's answers:** (1) refresh all August/September mana docs: awe ↔ leveling, mana ↔ creative energy = compute; (2) **patronage scrapped**; (3) pool is **linear in money**: gifts fill it, manifesting drains it, personal caps (tunable in play) + global caps on flow; (4) requests are **ordered with priority** (formula later); each asks "how much compute?", too much → no-dice, the universe whispers *the world must be replenished*; (5) manifesting is for everyone ("unlimited imagination"), **XP comes from reactions**, not mana channeled; (6) no live players yet, so gating warp costs nothing. **Done:** this file rewritten for the October model (decisions, [formula](#the-mana-pool-formula) with pushback: creative share `α`, global cap `pool / τ`, early-days throttling → seed/floor, mana = compute with no markup, reserve-then-settle), chart `phases/assets/mana-pool-model.png` (+ script), tasks/acceptance refreshed; Phase 07/08, PLAN.md, MASTER_PLAN.md and `phases/README.md` refreshed. **ROADMAP.md not edited** (rule: only on Alex's explicit say-so); proposed rewrite of its mana section is ready in [05-roadmap-mana-rewrite.md](./05-roadmap-mana-rewrite.md). | **Tomorrow:** (a) Alex: apply the ROADMAP rewrite? (b) pick `α`, `τ`, `floor`; seed grant? (c) donor perks = wave recognition only? (d) solar cycle: visual-only or cap modifier? (e) Q16 levels design; then business plan v0.4 |
