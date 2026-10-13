# Phase 05: Mana Economy & Donations

**Status:** `[ ]` Not Started
**Depends on:** [Phase 02: Multiplayer Core](./02-multiplayer-core.md), [Phase 04: Navigation & Controls](./04-navigation-controls.md)
**ROADMAP reference:** [The Mana Mechanic: The Frontier of Dreams](../ROADMAP.md#the-mana-mechanic-the-frontier-of-dreams)
**Estimated sessions:** 4-5

## Goal

Implement the mana economy — the creative energy system that powers the Living Frontier. Donations add mana to a universal pool; mana expands the Frontier; Ghost worlds solidify when the Frontier reaches them. The **solidification wave** (a golden shockwave sweeping outward when someone donates) is the defining visual moment of Aweborn.

**Key deviation from original ROADMAP:** Mana costs are **pegged to real compute/API costs + ~7% margin**, not arbitrary game-design numbers. This makes the economy self-sustaining — donations literally fund the compute that brings creations to life. The mana cost formula is abstracted from specific AI providers so we can swap backends without changing the player-facing economy. Gen AI creation costs are researched and implemented in [Phase 07: Gen AI Creation](./07-genai-creation.md).

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Mana authority | **Server-authoritative** for manifesting (solid worlds, AI generation). **Dreaming stays free, manifesting costs** (Alex, 2026-10-13): ghost/offline creation needs no mana and no validation | Prevents cheating while allowing unlimited offline creativity |
| Mana cost model | **Priced by complexity, driven by the real economy (decided 2026-10-13, Alex).** Every manifesting act costs mana: placing/moving objects a tiny amount, generating meshes/terrain/sound a lot, a whole new world a lot more ("a decent amount of money"). AI generation is priced to cover API + infra + ops + support + R&D with a target gross margin, **not** compute + 7% (7% doesn't cover card fees: Stripe takes ~6.5% of a $5 purchase) | The economy is the business model shown to investors and donors; the company must make money |
| Cost abstraction | **Not tied to specific AI model/provider** — based on output metrics (complexity, duration, resolution) | Allows provider swaps without economy changes |
| Two numbers | **High-water line** = the farthest mana has ever spread (sets the Frontier, never falls) + **Pool** = mana spendable now (decided 2026-10-13, Alex). Replaces ROADMAP's `r ∝ ∛(pool)` | Spending never shrinks reality |
| Awe | **Awe generates mana** (decided 2026-10-13, Alex): curiosity is harvested and "felt" by the collective (a little), spreads, and following your curiosity increases your ability to create. Must stay compatible with the company making money (mechanism: open question, see session log) | Mana = the energy people manifest with |
| Curiosity Budget | **Awe mints spendable mana only from a monthly budget tied to revenue** (Alex, 2026-10-13). Curiosity decides who the mana flows through; the budget decides how much exists. Later: automated from the financial statements (Stripe + AWS costs) | Free mana can never outrun income |
| Personal reserve | **Each player has a personal reserve** (bought + earned mana) alongside the shared pool and the high-water line (Alex, 2026-10-13). A larger reserve must also **empower the people around you**: personally empowering *and* universe-empowering, because emotions are contagious and manifesting together is the point (mechanism: proposal "Resonance" in the session log) | Paying to manifest without walling people off |
| Organization | **Aweborn is a non-profit, already incorporated with 501(c)(3) status** (Alex, 2026-10-13). It earns money to fund research into making corporate work humane (team matching from personality). No equity investors; backers are donors, grant makers, impact funders. Open for attorney + CPA: unrelated business income on mana sales (possible for-profit subsidiary), purchase vs donation labelling | Mission first; earned revenue pays for research |
| Glow (Resonance) | **Aura brightness scales with mana channeled recently** (spent, pooled, given), not with the reserve (Alex, 2026-10-13, Q9 b). No rank or status | Rewards manifesting, not hoarding |
| Creator economy | **Creators earn mana from visitors, but it stays in-game: no cash-out** (Alex, 2026-10-13, Q8 a) | Avoids money-transmitter, payout-fraud and private-benefit risk for a 501(c)(3) |
| Donation pipeline | Existing Stripe → Lambda → mana pool (extend current Lambda) | Reuses proven payment flow |
| Frontier shape | Sector-based (not perfect sphere) | Allows organic expansion bulges |
| Mana → radius | Cube root formula: `r ∝ ∛(high-water line)` (confirmed 2026-10-13, Alex, Q10 a: driven by the high-water line, not the pool; each mana adds equal volume) | Early donations have dramatic effect, exponential cost at scale |
| Shared-pool draws | **Personal reserve spends instantly; shared-pool draws are throttled per player per day** (Alex, 2026-10-13, Q11 a), *with care to stay squarely non-profit*. Open: should the "reserve" be reframed as an increased **flow rate** rather than a stockpile? (session log) | Nobody drains the commons |
| Solar cycle | Browser timezone + sunrise/sunset API | Client calculates modifier locally |
| Draw validation | sync-service validates all mana draws (solidified-world actions + AI generation) | In-memory state makes validation fast |
| Creation model | **Online = AI prompt (costs mana), Offline = edit/arrange (free)** | AI calls need network; editing is local-only |

## Tasks

### Universal Mana Pool (Universe CRDT)
- `[ ]` Add mana fields to Universe CRDT (*note: a `ManaState` type without `solarCycle` already exists in `shared/crdt-schema.ts`; extend it rather than redefining*):
  ```typescript
  interface ManaState {
    pool: number;
    frontierRadius: number;
    totalEverGenerated: number;
    totalEverSpent: number;
    regenRate: number;
    donationMultiplier: number;
    lastDonationAt: number;
    solarCycle: { enabled: boolean; peakMultiplier: number; troughMultiplier: number };
  }
  ```
- `[ ]` Server writes mana state to Universe CRDT (authoritative)
- `[ ]` Clients read mana state reactively

### Mana Flow Rate System
- `[ ]` Base rate: 100 mana/minute (same for all players)
- `[ ]` Activity multiplier: 1.0–2.0 (exploration/awe bonuses)
- `[ ]` Solar modifier: 0.6–1.5 (based on local sun position)
- `[ ]` Diminishing returns curve (24hr rolling window)
- `[ ]` Formula: `flowRate = baseRate * activityMultiplier * solarModifier * diminishingReturns`

### Solar Tidal Cycle
- `[ ]` Create `src/systems/SolarCycle.ts`
- `[ ]` Calculate local solar position from browser timezone
- `[ ]` Flow modifier: 1.5x at solar noon, 0.6x at midnight, sinusoidal
- `[ ]` Visual: universe warm-toned during day, cool/deep at night
- `[ ]` Send modifier to server with draw requests

### Awe Generation
- `[ ]` Create `src/systems/AweTracker.ts`
- `[ ]` Track per-player awe events:
  - First world visit: 500 mana
  - First creation seen: 50 mana
  - Distance milestone: 200 mana
  - Slingshot chain (3+): 100 mana
  - Cluster discovery: 300 mana
  - Long absence return (7d+): 1000 mana
- `[ ]` Shared-awe multiplier: 2x when near other players
- `[ ]` Diminishing novelty: exponential decay on revisits
- `[ ]` Client reports awe events → server validates → adds to pool
- `[ ]` Expose a discovery hook (`onFirstDiscovery(worldId, method)`) so [Phase 08](./08-nfc-trading-cards.md)'s World Index + NFC card taps can fire `first-world-visit` awe

### Living Frontier & Solidification
- `[ ]` Server calculates `frontierRadius` from mana pool (cube root formula)
- `[ ]` Sector-level solidification tracking
- `[ ]` Ghost → Solid transition when Frontier reaches a world:
  - Server sets `solidified: true`, `solidifiedAt: timestamp`
  - Physics activate, collision enables
- `[ ]` Targeted patronage: donor can solidify a specific Ghost world (5,000 mana)
- `[ ]` Oasis creation: bubble of light in the Deep Dark

### Solidification Wave (The Golden Moment)
- `[ ]` Create `src/effects/SolidificationWave.tsx`
- `[ ]` Golden, translucent shockwave shader (refraction effect)
- `[ ]` Ripples outward from Aweborn Portal at origin
- `[ ]` As wave hits Ghost worlds: wireframes shatter → reform as solid objects
- `[ ]` Audio: deep bass sweep → warm orchestral hum
- `[ ]` Donor recognition (optional): "A wave of light from ★ [name]" or anonymous

### Donation → Mana Pipeline (Extend Lambda)
- `[ ]` Modify Lambda to add mana on `payment_intent.succeeded`:
  - Calculate: `amount * 1000 = mana`
  - Write to mana pool (via VPS API or direct CRDT update)
  - Update donor's `lifetimeDonations`
  - Set `donationMultiplier` boost (24hr afterglow)
  - Write to `manaLedger` (audit trail)
- `[ ]` VPS receives mana update → recalculates `frontierRadius`
- `[ ]` VPS broadcasts frontier expansion to all connected clients
- `[ ]` Trigger solidification wave visual for all online players
- `[ ]` Keep the pipeline product-agnostic so [Phase 08](./08-nfc-trading-cards.md) NFC card order surplus can flow in as donations (and optionally as targeted patronage for the card's world)

### Server: Mana Draw Validation
- `[ ]` Validate draw requests for solidified-world actions:
  - Pool sufficient?
  - Flow rate within limits?
  - Action legitimate?
  - World solidified?
- `[ ]` Atomic deduction + transaction ledger
- `[ ]` Denial response: "The universe needs more energy" (gentle, not punitive)
- `[ ]` Ghost creation requires **no validation** (free, unlimited)

### Mana Costs Implementation

> ✅ **Resolved 2026-10-13 (Alex):** everything that manifests costs mana, scaled by complexity. Non-compute actions (place/move) cost very little; AI generation is priced from real costs at a target margin. The numbers below are the old ROADMAP values, to be replaced by the price table in the business plan draft.

- `[ ]` Object placement in solidified worlds (10-500 mana by complexity)
- `[ ]` Physics changes (gravity: 500, friction/bounce: 200, water: 300)
- `[ ]` Avatar customization (trail: 50, aura: 50, shape: 100, color: 25)

### Mana Visualization
- `[ ]` Pool level affects universe ambience:
  - High (>80%): bright stars, rich nebulae, ambient particles
  - Medium (30-80%): baseline
  - Low (<30%): dim, sparse, desaturated
  - Critical (<5%): near-dark, aurora near Portal
- `[ ]` Audio ambience scales with pool level
- `[ ]` Drawing mana → satisfying sound (universe breathing through you)

## Acceptance Criteria

- [ ] Mana pool is visible in the Universe CRDT and reflected visually
- [ ] Donations via Stripe add mana and trigger the solidification wave
- [ ] Ghost worlds solidify when the Frontier reaches them
- [ ] Awe events generate mana from exploration
- [ ] Solar tidal cycle modifies flow rate based on player's timezone
- [ ] Mana draws are server-validated for solidified-world actions
- [ ] Ghost creation is free and requires no server validation
- [ ] Universe ambience changes based on pool level

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/systems/SolarCycle.ts` | NEW | Timezone-based flow modifier |
| `src/systems/AweTracker.ts` | NEW | Awe event tracking + mana generation |
| `src/effects/SolidificationWave.tsx` | NEW | Golden shockwave effect |
| `src/components/FrontierVisual.tsx` | NEW | Living Frontier boundary rendering |
| `shared/crdt-schema.ts` | MODIFY | Add ManaState types |
| `server/src/mana.ts` | NEW | Mana validation, frontier calculation |
| `server/src/index.ts` | MODIFY | Add mana draw API endpoints |
| `infra/cloudformation.yml` | MODIFY | Extend Lambda for mana pipeline |

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
