# Aweborn — Implementation Plan

> **Read this first.** This is the root of the phased implementation plan. Every new work session starts here to find the current active phase, then drills into the phase doc for details.
>
> For the design bible (vision, mechanics, architecture), see [ROADMAP.md](../ROADMAP.md).
> For current state and deployment, see [HANDOFF.md](../HANDOFF.md).

---

## Session Protocol

Every new agent session should follow this sequence:

```
1. Read this file → find the active phase
2. Read the active phase doc → find the current task section
3. Execute → check off tasks
4. Update the phase doc → mark sections complete, add session log entry
5. Update this file → reflect progress
```

---

## Phase Overview

| Phase | Name | Status | Plan | Description |
|-------|------|--------|------|-------------|
| **01** | Foundation & Infrastructure | ✅ Complete | [01-foundation.md](./01-foundation.md) | VPS (Lightsail + k3s), sync-service, genai-service, client CRDT hook |
| **02** | Multiplayer Core | 🟡 In Progress | [02-multiplayer-core.md](./02-multiplayer-core.md) | Universe CRDT, World CRDTs, sector rooms, player presence |
| **03** | Universe Rendering & LOD | 🔴 Not Started | [03-universe-rendering.md](./03-universe-rendering.md) | Data-driven worlds, LOD tiers, Ghost/Solid visuals |
| **04** | Navigation & Controls | 🔴 Not Started | [04-navigation-controls.md](./04-navigation-controls.md) | Keyboard flight, gravity wells, warp, world entry/exit |
| **05** | Mana Economy & Donations | 🔴 Not Started | [05-mana-economy.md](./05-mana-economy.md) | Mana pool, Living Frontier, Ghost/Solid states, donation→mana pipeline |
| **06** | Offline & Mesh Networking | 🔴 Not Started | [06-offline-mesh.md](./06-offline-mesh.md) | PWA, WebRTC P2P, QR signaling, sneakernet sync |
| **07** | World Creation & Gen AI | 🔴 Not Started | [07-genai-creation.md](./07-genai-creation.md) | Building tools, physics, gen AI integration, polish |

### Status Legend

| Badge | Meaning |
|-------|---------|
| 🔴 Not Started | No work done yet |
| 🟡 In Progress | Active development |
| ✅ Complete | All acceptance criteria pass |
| ⏸️ Blocked | Waiting on external dependency or decision |

---

## Active Phase

> **➡️ Phase 02 — Multiplayer Core**
>
> Foundation is live. sync-service and genai-service running on Lightsail with k3s + Caddy auto-TLS. Next: implement the two-layer CRDT architecture and player presence.

---

## Dependency Graph

```
Phase 01 (Foundation) ✅
  └─► Phase 02 (Multiplayer Core)
        ├─► Phase 03 (Universe & LOD)       ─┐
        ├─► Phase 04 (Navigation)            ─┤
        ├─► Phase 05 (Mana & Economy)        ─┼─► Phase 07 (World Creation & GenAI)
        └─► Phase 06 (Offline & Mesh) ◄──────┘
```

Phases 03, 04, 05, and 06 can be **partially parallelized** after Phase 02. Phase 07 requires all others.

---

## Resolved Design Decisions

These were resolved in planning sessions and are codified in [ROADMAP.md](../ROADMAP.md):

| Decision | Resolution | Date |
|----------|-----------|------|
| Server architecture | Stateful VPS (Lightsail) for real-time CRDT sync; Lambda for webhooks only | Aug 19, 2026 |
| Container orchestration | k3s on Ubuntu 22.04 with Caddy DaemonSet for auto-TLS | Aug 20, 2026 |
| Infrastructure as Code | All AWS resources in CloudFormation templates | Aug 20, 2026 |
| Offline mana | Ghost/Solid model — no offline mana budget; all offline creations are Ghosts | Aug 18-19, 2026 |
| Donor advantages | Cosmetics only — identical flow rates for free and donor players | Aug 19, 2026 |
| Frontier contraction | Never contracts — high-water mark of generosity | Aug 19, 2026 |
| Offline collisions | Server nudges to nearest open space rather than deleting | Aug 19, 2026 |
| Anti-cheat | Client-side prediction with server reconciliation | Aug 19, 2026 |
| Frontier shape | Sector-based nebula expansion, not a perfect sphere | Aug 19, 2026 |
| Awe generation | Awe ∝ object cost, per-player exhaustion curve | Aug 19, 2026 |
| Object removal | 3-tier governance: Creator / Placer / Co-Creator | Aug 19, 2026 |
| Frontier radius formula | r ∝ ∛(Mana) — cubic root of mana pool | Aug 19, 2026 |

---

## Open Design Questions

| Question | Relevant Phase | Notes |
|----------|---------------|-------|
| What can players do inside a world? | Phase 07 | Place objects, sculpt terrain, hang out — specifics TBD |
| New player onboarding flow | Phase 07 | Drop in at origin? Tutorial? |
| Mana tuning (dollar-to-mana ratio) | Phase 05 | Current design: $1 = 1,000 mana. Needs playtesting |
| TokBot integration scope | TBD | Separate mobile app — include in plan or keep independent? |

---

## Technical Notes

### Yjs Library Choices

| Package | Purpose | When Used |
|---------|---------|-----------|
| `yjs` | Core CRDT library | Always — the data layer |
| `y-websocket` | WebSocket transport provider | Online mode — connects to stateful server |
| `y-webrtc` | WebRTC transport provider | P2P mode — Phase 06 (offline/mesh) |

---

*Last updated: 2026-08-20*
