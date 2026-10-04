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
| **02** | Multiplayer Core | ✅ Complete† | [02-multiplayer-core.md](./02-multiplayer-core.md) | Universe CRDT, World CRDTs, sector rooms, player presence |
| **03** | Universe Rendering & LOD | ✅ Complete† | [03-universe-rendering.md](./03-universe-rendering.md) | Data-driven worlds, LOD tiers, Ghost/Solid visuals |
| **04** | Navigation & Controls | ✅ Complete† | [04-navigation-controls.md](./04-navigation-controls.md) | Keyboard flight, gravity wells, warp, world entry/exit, radar, cross-browser presence |
| **05** | Mana Economy & Donations | 🔴 Not Started | [05-mana-economy.md](./05-mana-economy.md) | Mana pool, Living Frontier, Ghost/Solid states, donation→mana pipeline |
| **06** | Offline & Mesh Networking | 🔴 Not Started | [06-offline-mesh.md](./06-offline-mesh.md) | PWA, WebRTC P2P, QR signaling, sneakernet sync |
| **07** | World Creation & Gen AI | 🔴 Not Started | [07-genai-creation.md](./07-genai-creation.md) | Interior movement & physics, building tools, gen AI integration, polish |
| **08** | NFC Trading Cards & the Worlidex | 🟡 In Progress | [08-nfc-trading-cards.md](./08-nfc-trading-cards.md) | `/w/<uuid>` teleport links, Worlidex (personal world index + warp), physical NFC cards, print-your-world |

### Status Legend

| Badge | Meaning |
|-------|---------|
| 🔴 Not Started | No work done yet |
| 🟡 In Progress | Active development |
| ✅ Complete | All acceptance criteria pass |
| ✅ Complete† | All tasks shipped; some acceptance criteria explicitly **deferred** (stress tests / on-device verification), tracked in the phase file |
| ⏸️ Blocked | Waiting on external dependency or decision |

---

## Active Phase

> **➡️ PRIORITY: Phase 08, Milestone 8A (Teleport Links + UUIDv4 migration)**
>
> **Why now (set 2026-10-04):** the card vendor (DTB RFID) has our pilot request and will quote soon. No card can be encoded or printed until world IDs are permanent UUIDv4s and `/w/<uuid>` resolves, and that includes the Origin card, which needs the portal registered as a real world. Card art (front + back) is **done**. Start at **[▶ Resume here](./08-nfc-trading-cards.md#-resume-here-milestone-8a)** in the Phase 08 file.
>
> **Paused:** Phase 05 (Mana Economy & Donations): universal mana pool, Living Frontier, awe tracking, donation → mana pipeline. Resume after 8A.
>
> **Deferred verification debt:** Phase 02 (10+ concurrent connections), Phase 03 (1000+ worlds @ 60fps), Phase 04 (on-device touch + physical gamepad).

---

## Dependency Graph

```
Phase 01 (Foundation) ✅
  └─► Phase 02 (Multiplayer Core) ✅
        ├─► Phase 03 (Universe & LOD) ✅
        │     └─► Phase 04 (Navigation) ✅
        │           ├─► Phase 05 (Mana & Economy)  ─► Phase 07 (World Creation & GenAI)
        │           │                                 (also needs Phase 01 genai-service, Phase 04 controls)
        │           └─► Phase 08 (NFC Cards & Worlidex)
        │                 8A Teleport links ─► 8B Worlidex ─► (Phase 05 awe hook)
        │                 8A ─► 8C Physical curated set ─► 8D Print-your-world (needs Phase 05 donations)
        │                 Offline card taps use Phase 06 PWA
        └─► Phase 06 (Offline & Mesh)   (independent of 03–05; can run any time)
```

Dependencies above match each phase file's **Depends on** line. Phase 06 can run in parallel with 05/07/08. Phase 07 needs Phase 05 (mana validation) and Phase 01 (genai-service), but its first section (Interior Movement & Physics) needs only Phase 04 and can start now. Phase 08 milestones 8A/8B can start now.

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
| NFC trading cards | Physical cards teleport to a world via `aweborn.org/w/<uuidv4>`; static Aweborn back; per-card arrival mode (default orbit) | Oct 3, 2026 |
| World ID format | Migrate 5-char random IDs → UUIDv4 before any card is printed | Oct 3, 2026 |
| Card security | No per-card serials, no anti-clone (low stakes); tags locked read-only to prevent rewrites | Oct 3, 2026 |
| Worlidex | Personal persistent index of discovered worlds; warp to any entry from anywhere; first discovery = awe to universal pool | Oct 3, 2026 |
| Card programs | Curated sets + print-your-world on demand; sold as fundraiser and given free | Oct 3, 2026 |
| TokBot integration scope | TokBot + backend archived; gen-AI features absorbed into aweborn.org (Phase 07), token economy → mana (Phase 05) | Aug 20, 2026 |
| Player presence transport (interim) | WebSocket relay through sync-service; WebRTC P2P remains the scale target (Phase 06) | Aug 24, 2026 |
| Landmark islands | Landmark islands ("The Spire", etc.) removed from the universe per Alex | Aug 23, 2026 |

---

## Open Design Questions

| Question | Relevant Phase | Notes |
|----------|---------------|-------|
| What can players do inside a world? | Phase 07 | Place objects, sculpt terrain, hang out — specifics TBD |
| New player onboarding flow | Phase 07 / 08 | Drop in at origin? Tutorial? Note: players arriving via an NFC card or `/w/` link start at a world, not the origin (Phase 08) |
| Mana tuning (dollar-to-mana ratio) | Phase 05 | Current design: $1 = 1,000 mana. Needs playtesting |
| Worlidex details (discovery threshold, warp rules, key binding) | Phase 08 | Proposals in [08-nfc-trading-cards.md](./08-nfc-trading-cards.md#open-questions-mirrored-in-roadmap) |
| Persistent player identity | Phase 08 | `playerId` is sessionStorage today; Worlidex needs persistence |
| Card format, art pipeline, vendor, product name | Phase 08 | See Phase 08 open questions |

---

## Technical Notes

### Yjs Library Choices

| Package | Purpose | When Used |
|---------|---------|-----------|
| `yjs` | Core CRDT library | Always — the data layer |
| Custom binary room protocol | WebSocket transport (`src/hooks/useCRDT.ts` ↔ `server/sync-service/src/rooms.ts`): `[type][worldId len][worldId][Yjs update]`, msgs `0x01`–`0x09` (universe/world sync+update, create-world, update-sectors, join/leave-world, presence) | Online mode — **what actually ships** (replaced the y-websocket passthrough in Phase 02) |
| `y-websocket` | Still in `package.json` (client + server) but not imported anywhere | Candidate for removal |
| `y-webrtc` | WebRTC transport provider | P2P mode — Phase 06 (offline/mesh) |

---

*Last updated: 2026-10-04*
