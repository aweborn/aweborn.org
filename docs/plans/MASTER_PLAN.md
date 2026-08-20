# Aweborn — Master Implementation Plan

> **Read this first.** This is the root of the hierarchical planning system. Every new work session starts here to find the current active phase, then drills into the phase plan for details.

## Quick Links

| Document | Purpose |
|----------|---------|
| [ROADMAP.md](../../ROADMAP.md) | The design bible — vision, mechanics, architecture |
| [HANDOFF.md](../../HANDOFF.md) | Current state snapshot, deployment instructions |
| **This file** | Phase-level overview, status tracking, session protocol |

---

## Session Protocol

Every new agent session should follow this sequence:

```
1. Read MASTER_PLAN.md (this file) → find the active phase
2. Read the active phase-N-*.md → find the current milestone
3. Create/resume task.md → break milestone into atomic tasks
4. Execute → check off tasks
5. Update phase-N-*.md → mark milestones complete
6. Update MASTER_PLAN.md → reflect progress
```

---

## Phase Overview

| Phase | Name | Status | Plan | Description |
|-------|------|--------|------|-------------|
| **0** | Foundation & Infrastructure | 🔴 Not Started | [phase-0-foundation.md](./phase-0-foundation.md) | VPS setup, Yjs integration, project restructure |
| **1** | Multiplayer Core | 🔴 Not Started | [phase-1-multiplayer.md](./phase-1-multiplayer.md) | WebSocket rooms, Universe CRDT, World CRDTs, player presence |
| **2** | Universe & Navigation | 🔴 Not Started | [phase-2-universe.md](./phase-2-universe.md) | LOD rendering, keyboard flight, gravity wells, world entry/exit |
| **3** | Mana & Economy | 🔴 Not Started | [phase-3-mana.md](./phase-3-mana.md) | Mana pool, Living Frontier, Ghost/Solid states, donation wave |
| **4** | Offline & Mesh | 🔴 Not Started | [phase-4-offline.md](./phase-4-offline.md) | PWA, WebRTC P2P, QR signaling, NFC join, sneakernet sync |
| **5** | Polish & Scale | 🔴 Not Started | [phase-5-polish.md](./phase-5-polish.md) | World building tools, physics, anti-cheat, voice/chat, launch |

### Status Legend

| Badge | Meaning |
|-------|---------|
| 🔴 Not Started | No work done yet |
| 🟡 In Progress | Active development |
| 🟢 Complete | All milestones pass acceptance criteria |
| ⏸️ Blocked | Waiting on external dependency or decision |

---

## Active Phase

> **➡️ Phase 0 — Foundation & Infrastructure**
>
> Starting point. No multiplayer code exists yet. Need to set up VPS, integrate Yjs, and restructure the project for the monorepo pattern.

---

## Dependency Graph

```
Phase 0 (Foundation)
  └─► Phase 1 (Multiplayer Core)
        ├─► Phase 2 (Universe & Nav)     ─┐
        ├─► Phase 3 (Mana & Economy)     ─┼─► Phase 5 (Polish & Scale)
        └─► Phase 4 (Offline & Mesh) ◄───┘
```

Phases 2, 3, and 4 can be **partially parallelized** after Phase 1. Phase 5 requires all others.

---

## Resolved Design Decisions

These were resolved in previous brainstorming/planning sessions and are now codified in [ROADMAP.md](../../ROADMAP.md):

| Decision | Resolution | Session |
|----------|-----------|---------|
| Server architecture | Stateful VPS (Lightsail) for real-time CRDT sync; Lambda for webhooks only | Aug 19, 2026 |
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

These remain unresolved and will be addressed as we reach the relevant phase:

| Question | Relevant Phase | Notes |
|----------|---------------|-------|
| What can players do inside a world? | Phase 5 (M5.1) | Place objects, sculpt terrain, hang out — specifics TBD |
| New player onboarding flow | Phase 5 (M5.9) | Drop in at origin? Tutorial? |
| Mana tuning (dollar-to-mana ratio) | Phase 3 (M3.1) | Current design: $1 = 1,000 mana. Needs playtesting |
| TokBot integration scope | TBD | Separate mobile app — include in plan or keep independent? |

---

## Repo Map

```
aweborn/
├── aweborn.org/              ← Primary: the 3D web experience (Vite + React + R3F)
│   ├── src/                  ← Frontend source
│   ├── infra/                ← CloudFormation (S3, CloudFront, Lambda, API GW)
│   ├── docs/plans/           ← THIS PLANNING HIERARCHY
│   │   ├── MASTER_PLAN.md    ← You are here
│   │   ├── phase-0-*.md
│   │   ├── phase-1-*.md
│   │   └── ...
│   ├── ROADMAP.md            ← Design bible (vision, mechanics, architecture)
│   └── HANDOFF.md            ← Current state, deployment, key files
├── tokbot/                   ← Mobile app (LynxJS) — separate product
└── tokbot-backend/           ← Firebase backend for TokBot — separate product
```

---

*Last updated: 2026-08-20*
