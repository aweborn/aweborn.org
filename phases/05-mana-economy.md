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
| Mana authority | **Server-authoritative** for solidified-world actions and AI generation; free for Ghost creation and editing | Prevents cheating while allowing unlimited offline creativity |
| Mana cost model | **Pegged to real compute cost + ~7% margin** | Makes the economy self-sustaining for the non-profit |
| Cost abstraction | **Not tied to specific AI model/provider** — based on output metrics (complexity, duration, resolution) | Allows provider swaps without economy changes |
| Donation pipeline | Existing Stripe → Lambda → mana pool (extend current Lambda) | Reuses proven payment flow |
| Frontier shape | Sector-based (not perfect sphere) | Allows organic expansion bulges |
| Mana → radius | Cube root formula: `r ∝ ∛(mana)` | Early donations have dramatic effect, exponential cost at scale |
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
- `[ ]` Expose a discovery hook (`onFirstDiscovery(worldId, method)`) so [Phase 08](./08-nfc-trading-cards.md)'s Worlidex + NFC card taps can fire `first-world-visit` awe

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

> ⚠️ **Unresolved conflict (flagged 2026-10-03):** this phase's key deviation says costs are pegged to real compute cost + ~7%, but the numbers below are the ROADMAP's fixed game-design values, and most of these actions (placing an object, changing gravity) have ~zero compute cost. Decide before implementing: (a) compute-pegged pricing applies **only to AI generation** (Phase 07) while non-compute actions keep fixed ROADMAP prices, or (b) non-compute actions become free/near-free. Proposal: (a).

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
