# Phase 3 — Mana & The Frontier of Dreams

> **Parent:** [MASTER_PLAN.md](./MASTER_PLAN.md)
> **Status:** 🔴 Not Started
> **Goal:** Implement the core economy — mana pool, Living Frontier, Ghost/Solid states, donation-driven expansion.
> **Prerequisites:** Phase 1 complete (Universe CRDT, World CRDTs)

---

## Phase Summary

The mana system is the soul of Aweborn. It transforms donations from a transactional act into a **visceral, shared experience** — a golden wave of light that physically expands the universe. This phase builds the data layer (mana pool, frontier radius), the visual language (Ghost vs Solid), and the donation pipeline (Stripe → Lambda → VPS → golden wave).

---

## Milestones

### M3.1 — Universal Mana Pool
**Status:** 🔴 Not Started
**Effort:** 1 session
**Dependencies:** Phase 1 (M1.2 — Universe CRDT)

#### What
- Add mana structure to Universe CRDT: `pool, frontierRadius, totalEverGenerated, totalEverSpent, regenRate, donationMultiplier, solarCycle`
- Server-authoritative mana draws (VPS validates all pool changes)
- Frontier radius calculation: `r ∝ ∛(Mana)`
- Natural mana regeneration (baseline ~100/hr)
- Donation afterglow multiplier (2-5x boost, 24hr decay)

#### Acceptance Criteria
- [ ] Mana pool structure exists in Universe CRDT per ROADMAP spec
- [ ] `frontierRadius` recalculates when pool changes
- [ ] Natural regen ticks mana pool upward over time
- [ ] Server rejects unauthorized mana draws
- [ ] Client can read current pool/frontier state

#### Tasks
```
- [ ] Add ManaCRDT type to shared/types.ts
- [ ] Server: mana manager — pool updates, regen tick, frontier recalc
- [ ] Server: mana draw validation (check pool, flow rate, world solidified?)
- [ ] Frontier radius formula: r = k * Math.cbrt(pool)
- [ ] Client: useMana() hook — reactive mana pool state
- [ ] Natural regen: server ticks pool every ~60 seconds
- [ ] Afterglow multiplier: track last donation timestamp, apply 24hr decay
```

---

### M3.2 — Ghost & Solid Visual States
**Status:** 🔴 Not Started
**Effort:** 2 sessions
**Dependencies:** M3.1, Phase 2 (M2.1 — LOD rendering)

#### What
Implement the Ghost/Solid/Oasis visual states from ROADMAP.md:

| State | Visual | Interaction |
|-------|--------|-------------|
| Solid (inside Frontier) | Full color, vibrant glow, physics, collision | Fully interactive |
| Ghost (outside Frontier) | Translucent wireframe, soft ethereal glow | Enter/explore, no physics |
| Oasis (Patron-funded Ghost) | Bubble of warm light in the Deep Dark, solid inside | Fully interactive |

#### Acceptance Criteria
- [ ] Worlds inside frontier radius render as solid (full color, glow)
- [ ] Worlds outside frontier render as ghosts (wireframe shader, translucent)
- [ ] Oasis worlds show a localized bubble of light
- [ ] Ghost/solid state transitions animate smoothly
- [ ] The Living Frontier boundary is visually perceptible (faint edge of light)

#### Tasks
```
- [ ] Create wireframe/ghost shader (translucent, soft glow, no collision)
- [ ] Create solid renderer (current full-detail rendering)
- [ ] Create Oasis renderer (light bubble in the Deep Dark)
- [ ] Frontier boundary visual — faint edge of warm light at radius
- [ ] State determination: compare world.resolvedPosition distance to frontierRadius
- [ ] Transition animation: ghost → solid (wireframes fill with color)
- [ ] Deep Dark visual treatment: cooler tones, sparser particles beyond frontier
```

---

### M3.3 — Awe Generation
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** M3.1, Phase 1 (M1.4 — player presence)

#### What
Track per-player awe events that feed into the universal mana pool:

| Event | Mana Generated |
|-------|---------------|
| First world visit | 500 |
| First creation seen | 50 |
| Distance milestone | 200 |
| Slingshot chain (3+) | 100 |
| Cluster discovery | 300 |
| Long absence return (7+ days) | 1,000 |
| Shared awe (near other players) | 2x multiplier |

#### Acceptance Criteria
- [ ] Visiting a new world for the first time generates awe → mana added to pool
- [ ] Shared-awe multiplier applies when near other players
- [ ] Diminishing novelty: revisiting same world generates less awe (exponential decay)
- [ ] Awe events logged per-player (prevent farming)
- [ ] Visual/audio feedback when awe is generated (subtle sparkle + chime)

#### Tasks
```
- [ ] Create src/systems/AweTracker.ts — per-player awe event tracking
- [ ] Track visited worlds, creations seen, distance records per player
- [ ] Awe exhaustion curve: 100% → 10% → 0% for repeated views
- [ ] Shared-awe detection: check nearby players via awareness protocol
- [ ] Send awe-generated events to server → server adds to pool
- [ ] Visual feedback: subtle golden sparkle on awe generation
- [ ] Audio feedback: gentle chime sound
```

---

### M3.4 — Solar Tidal Cycle
**Status:** 🔴 Not Started
**Effort:** 1 session
**Dependencies:** M3.1

#### What
Mana flow modifier based on the player's local solar position:
- Peak (solar noon): 1.5x flow
- Trough (midnight): 0.6x flow
- Visual: warmer tones during day, cooler at night

#### Acceptance Criteria
- [ ] Mana flow rate varies based on browser timezone
- [ ] Visual warmth shifts subtly with local time
- [ ] The modifier blends across the global player base (server aggregates)

#### Tasks
```
- [ ] Calculate solar position from browser timezone + date
- [ ] Apply flow modifier to mana generation/draw rates
- [ ] Visual: shift scene color temperature (warm ↔ cool post-processing)
- [ ] Server: aggregate solar modifiers across all connected players
```

---

### M3.5 — Donation → Solidification Wave
**Status:** 🔴 Not Started
**Effort:** 2 sessions
**Dependencies:** M3.1, M3.2, existing Stripe integration

#### What
The signature moment of Aweborn:

```
Stripe webhook → Lambda → mana added to pool → VPS recalculates frontier
→ broadcasts golden wave → ghost worlds solidify in real-time
```

#### Acceptance Criteria
- [ ] A Stripe test donation triggers the full pipeline
- [ ] Golden wave visual ripples outward from the Aweborn Portal
- [ ] Ghost worlds caught in the wave solidify (wireframe → full color)
- [ ] All connected players see and hear the wave simultaneously
- [ ] Donor recognition: configurable (named or anonymous)

#### Tasks
```
- [ ] Lambda: process payment_intent.succeeded webhook
- [ ] Lambda: calculate mana (amount × 1000), add to pool CRDT
- [ ] Lambda: write to donation ledger, set afterglow multiplier
- [ ] VPS: detect mana pool increase → recalculate frontierRadius
- [ ] VPS: broadcast frontier expansion event to all connected clients
- [ ] Client: golden wave shader — translucent shockwave with refraction
- [ ] Client: solidification animation for ghost worlds caught in wave
- [ ] Audio: deep resonant bass sweep → warm orchestral hum
- [ ] Donor recognition system: named vs anonymous display
```

---

### M3.6 — Targeted Patronage (Oasis)
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** M3.2, M3.5

#### What
- Donors can browse Ghost worlds and fund specific ones into Oases
- A targeted donation creates an Oasis — a bubble of light in the Deep Dark
- Cost: 5,000 mana to solidify a Ghost; 1,000 per tier to expand the Oasis radius
- Donor cosmetic unlocks tied to lifetime donation amount

#### Acceptance Criteria
- [ ] Donors can target a specific Ghost world for solidification
- [ ] Oasis bubble renders correctly (warm light in darkness, solid inside)
- [ ] Donor cosmetics unlock based on lifetime donation amount
- [ ] Oasis expansion tiers work (pay more → larger bubble)

#### Tasks
```
- [ ] UI: "Become Patron" option when viewing a Ghost world
- [ ] Payment flow: targeted donation → Lambda processes → solidify specific world
- [ ] Oasis renderer: localized light bubble shader
- [ ] Donor cosmetics: track lifetime donations, unlock tiers
- [ ] Oasis radius expansion logic
```

---

### M3.7 — Mana Visibility (Audio/Visual Ambiance)
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** M3.1

#### What
The entire universe reflects the mana pool state:

| Pool Level | Stars | Nebulae | Particles | Audio |
|-----------|-------|---------|-----------|-------|
| High (>80%) | Bright, saturated | Rich colors | Everywhere — fireflies, energy rivers | Warm harmonic hum |
| Medium (30-80%) | Normal | Standard | Moderate | Gentle baseline |
| Low (<30%) | Dim, desaturated | Thin, wispy | Sparse | Near-silence |
| Critical (<5%) | Nearly dark | Gone | Gone | Silence |

#### Acceptance Criteria
- [ ] Universe ambiance visually responds to mana pool level
- [ ] Audio breathes with pool state (warm hum ↔ silence)
- [ ] Transitions between states are smooth (not jarring)

#### Tasks
```
- [ ] Create src/systems/AmbianceSystem.ts — pool level → visual/audio params
- [ ] Map pool level to post-processing intensity (bloom, saturation, particle density)
- [ ] Map pool level to audio parameters (volume, pitch, harmonic content)
- [ ] Smooth interpolation between ambiance states
- [ ] Energy filaments between nearby worlds at high pool levels
```

---

## Phase Completion Criteria

1. ✅ Mana pool live in Universe CRDT, server-authoritative draws
2. ✅ Ghost/Solid/Oasis visual states rendering correctly
3. ✅ Awe generation from exploration feeds the pool
4. ✅ Solar tidal cycle modifies flow rates
5. ✅ Test donation triggers golden solidification wave
6. ✅ Targeted patronage creates Oasis worlds
7. ✅ Universe ambiance reflects mana state

**Then:** Update MASTER_PLAN.md status to 🟢.

---

*Last updated: 2026-08-20*
