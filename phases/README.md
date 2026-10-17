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

**Standing rule (Alex, 2026-10-16): the public pages move with the decisions.** Whenever a decision touches money, data, players' rights or what we promise, update [`public/terms.html`](../public/terms.html), [`public/privacy.html`](../public/privacy.html) and [`public/giving.html`](../public/giving.html) (and the "Last updated" date) in the same change. Never describe data collection before it ships; never ship it before Privacy describes it.

---

## Phase Overview

| Phase | Name | Status | Plan | Description |
|-------|------|--------|------|-------------|
| **01** | Foundation & Infrastructure | ✅ Complete | [01-foundation.md](./01-foundation.md) | VPS (Lightsail + k3s), sync-service, genai-service, client CRDT hook |
| **02** | Multiplayer Core | ✅ Complete† | [02-multiplayer-core.md](./02-multiplayer-core.md) | Universe CRDT, World CRDTs, sector rooms, player presence |
| **03** | Universe Rendering & LOD | ✅ Complete† | [03-universe-rendering.md](./03-universe-rendering.md) | Data-driven worlds, LOD tiers, Ghost/Solid visuals |
| **04** | Navigation & Controls | ✅ Complete† | [04-navigation-controls.md](./04-navigation-controls.md) | Keyboard flight, gravity wells, warp, world entry/exit, radar, cross-browser presence |
| **05** | Mana Economy & Donations | 🟡 Design | [05-mana-economy.md](./05-mana-economy.md) | Universal pool (mana = compute, filled by gifts, drained by manifesting), high-water line → Living Frontier, awe → XP/levels, donation→mana pipeline |
| **06** | Offline & Mesh Networking | 🔴 Not Started | [06-offline-mesh.md](./06-offline-mesh.md) | PWA, WebRTC P2P, QR signaling, sneakernet sync |
| **07** | World Creation & Gen AI | 🔴 Not Started (planner designed 2026-10-16) | [07-genai-creation.md](./07-genai-creation.md) | Interior movement & physics, building tools, gen AI integration, polish |
| **08** | NFC Trading Cards & the World Index | 🟡 In Progress | [08-nfc-trading-cards.md](./08-nfc-trading-cards.md) | `/w/<uuid>` teleport links, World Index (personal index of discovered worlds + warp), physical NFC cards, print-your-world |
| **09** | Authoritative Flight, Anti-Cheat & Telemetry | 🔴 Not Started | [09-authoritative-flight.md](./09-authoritative-flight.md) | One deterministic flight sim in `shared/` (client predicts, server is the authority), offline = server replay of recorded inputs, flight traces for telemetry; feeds 05/06/07/08 |

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

> **Update (2026-10-17, evening): solidification meter DROPPED (Alex).** Too many rules, and it couldn't work offline. **The Frontier is the only path from Ghost to solid.** The meter code was reverted before any commit; Phase 05 decisions/tasks updated. Ignore the "build the solidification meter" priority below. **Next (pick one):** Dreamt card edition ([Phase 08](./08-nfc-trading-cards.md)) or Phase 07 Interior Movement; small: dev panel places new worlds in front of the player. DTB reply sent; waiting on Mandy (early next week). ROADMAP stripped of the meter too.
>
> **Update (2026-10-17, 13:35): two things closed, one thing waiting.** (1) **Donation webhook fixed + deployed:** Alex's real $1 gift hit a Stripe timing gap (Link attaches the net ~80 s after `payment_intent.succeeded`; the Lambda 503'd). Replayed by hand (ledger #2, pool 100,067); the Lambda now also handles `charge.updated`, and the Stripe endpoint is subscribed to it ([Phase 05 log](./05-mana-economy.md#session-log), last row). **Open:** `infra/cloudformation.yml` change is deployed but **not committed**; the wave for the replayed gift wasn't confirmed by eye. (2) **NFC cards: DTB paper-card quote in, 50-card Origin pilot reply drafted** (Alex sends it; QR restyled + enlarged to 12 mm, `9509f7d`). See [Phase 08](./08-nfc-trading-cards.md#session-log) last row. **Waiting on:** Mandy's reply, then the physical pilot (scan with real phones). The block below is still the code priority: commit + deploy what's uncommitted, then the solidification meter.
>
> **➡️ NEXT UP (2026-10-17, afternoon): Alex reviews → commit + deploy, then the real $1 gift**, watched in `/mana/ledger` *and* in the sky. **Built today, not yet committed:** server Frontier solidification ([`frontier.ts`](../server/sync-service/src/frontier.ts)), the golden wave ([`SolidificationWave.tsx`](../src/effects/SolidificationWave.tsx), flicker fixed; preview with `awebornWave()` in the console), **display quality** (gear under the FPS counter: Auto · Low · Medium · High · Ultra; [`qualityStore.ts`](../src/stores/qualityStore.ts)), a resolver fix (0 coordinates). **Ghost model settled in a grill (2026-10-17):** Option C (Ghost/solid is only the universe-map look; Ghost worlds are fully playable), a **solidification meter** (entries + ¼ sightings vs `10 × (1 + d/100 u)`), a small ripple when a meter fills, **Dreamt** card edition, free invite-only worlds; all in the [Phase 05 decisions](./05-mana-economy.md#architecture-decisions). **After deploy, PRIORITY: build the solidification meter** (server first; tasks under Living Frontier in Phase 05), then the ring + meter moment, then the Dreamt edition ([Phase 08](./08-nfc-trading-cards.md)). Also small: dev panel should place new worlds in front of the player (it uses a random spot within ±250 u). Later: opt-in donor names, shooting stars, refunds policy; private worlds need Privacy wording before they ship. Phase 07 build starts with Interior Movement. See the last rows of the [Phase 05](./05-mana-economy.md#session-log) session log.
>
> **Earlier (2026-10-16 night):** the [Donation → Mana Pipeline](./05-mana-economy.md#donation--mana-pipeline-extend-lambda) code (Lambda `aweborn-stripe-webhook` → `POST /api/mana/inflow` with the gifts-only `MANA_INFLOW_TOKEN`); the ledger live in prod with the founding gift; **Flow & Admission** (`requestDraw`, approved caps 0 / 150 / 250 / +25 to 1,000, `p_solo = 400`).
>
> **Earlier context: Phase 05 mana, from the [session log](./05-mana-economy.md#session-log).** Decided 2026-10-14: **`K = 100`** (1 mana = 1 cent), **`α = 0.5`** (research-backed, [why](./05-mana-economy.md#why-α--05-and-τ--30-days)), **`τ = 30` days**, flow split max-min fairly among players active in the last 30 min (a lone player gets their full cap), solar = visual + ±10% on personal caps, donor perk = opt-in name in the wave, **a level = mana channeled into creations + breadth of skills**. **ROADMAP mana section rewritten** to the October model. **Also settled 2026-10-14 (morning):** `N` splits vs `τ` scales (approved); **Alex's founding gift = $1,000** (seed); **ladder: warp last** (move → steer → drive/neutral → enter world → place → maker tutorials → local mastery + exploration → warp; [chapters](./05-mana-economy.md#experience--levels)); public **`giving.html`** + Terms split line + donation-modal link (**pushed/deployed 2026-10-14**); business plan v0.4 (donation-led, + cards as the second engine) in Drive. **Cards = shortcut and souvenir, and mission (not merchandise).** **Formula v3: the pool is the treasury**: all money in, every draw categorized (creations, infra, cards, people, research…), players draw only from the creative share ([formula](./05-mana-economy.md#the-mana-pool-formula)); giving page/Terms/modal reworded (deployed). **ROADMAP updated to v3 and everything deployed (2026-10-14 08:40).** Founding gift resolved by v3: $1,000 → 100,000 mana in the pool, 50,000 creative. **Evening of 2026-10-14:** (a) spending-by-category → **drafted as [Shooting Stars](./05-mana-economy.md#shooting-stars-every-draw-is-visible-alex-2026-10-14-evening)** (every draw leaves as a colored star; in-game card purchases swell the universe); **approved; categories follow Form 990 Part IX (color = function), pay is one combined Compensation line; in ROADMAP**; (b) ~~retune the Frontier constant `c`~~ **done 2026-10-14 21:07: `c = ∛10` (tight: $1k → 100 u, $1M → one sector), wave same size for every gift**; (c) chapter-6 thresholds **done 21:29** (3 uses = mastered, inside the Frontier, N = 10, M = 30, 5,000 u total, safety valve, beginner cradle); 1,000 u flight resolved 21:36 (leash widens in chapter 6, removed at warp); (e) budget alarm **done 21:57: the creative share shrinks, disclosed** (giving page + Terms wording written, not pushed); (d) `base(level)` / `p_solo` + priority formula (blocked on Phase 07 costs); (d) cost table **written: [MANA_COSTS.md](../MANA_COSTS.md)**, caps proposed. **Implementation started 2026-10-16: Universal Mana Pool & Ledger shipped** (`server/sync-service/src/mana.ts`, public `GET /mana` + `/mana/ledger`, admin API behind `MANA_ADMIN_TOKEN`). **➡️ NEXT: Alex generates the token + records the founding gift; then Flow & Admission** (`requestDraw`, max-min fair split, queue).
>
> **Admin to-do (Alex, off-keyboard): trademark.** Find a trademark attorney (law-school IP clinics often help non-profits for free) for a clearance search in classes 9, 41, 16/28, 25 (sweatshirts; check the Korean apparel brand AWE BORN US) and 36, then file the **AWEBORN** word mark with the USPTO (logo mark later). Policy already live: [TRADEMARKS.md](../TRADEMARKS.md). Details: [Phase 05 session log](./05-mana-economy.md#session-log), 2026-10-16 rows.
>
> **Previous priority: Phase 08, [Milestone 8B: The World Index](./08-nfc-trading-cards.md#milestone-8b--the-world-index)** (shipped; follow-ups below): persistent player identity first, then the data model, discovery tracking, card reveal, World Index UI and warp.
>
> **8B identity (decided 2026-10-11):** one player across tabs *and* devices. Anonymous first, then QR device linking, passkeys, email magic link, social sign-in (Google, Facebook, Apple, …) and email + password, all on one `playerId` with per-device sessions. One screen steers, the others follow. Tasks I0–I7 in [Persistent Player Identity](./08-nfc-trading-cards.md#persistent-player-identity-prerequisite). **Auth stack: Better Auth.** **I1 (anonymous players) is LIVE on aweborn.org** (2026-10-11). **Live 2026-10-11:** "Save your player" onramp (chip + once-a-day nudge), passkeys, Google; Privacy + Terms pages; `aweborn-mail` SES stack (privacy@ forwarding). **Google sign-in verified on prod (2026-10-11).** **2026-10-12: SES production access granted; email sign-in (6-digit code, not a magic link) + optional email & password built and verified locally; `aweborn-mail` now forwards hello@ too and has a sender IAM user whose key is already in `aweborn-secrets`.** Email sign-in is **live** and Alex verified a real code (2026-10-12). **Config:** everything is cataloged in `CONFIG.md` (keys in `~/keys`, parameters in the repo); **one-touch recovery = `infra/recover.sh`** (`--check` passes clean). **Passkeys + all live methods verified on real devices by Alex (2026-10-12).** Other social providers (Apple, Facebook) **deferred**: passkey + Google + email are enough for now. **I5 DEPLOYED 2026-10-12 (`e8f3079`):** accounts own *characters*; an anonymous player who signs in keeps playing its blob and can switch; **saved players never merge** (a saved device must sign out before using a different player); changing ways in needs a 5-minute "confirm it's you", sends a notice email and never removes the last way in; World Index table (per account) + first-entry discovery. **Sign-in made as visible as saving (2026-10-12):** equal "Sign in" | "Save this player" tabs, device memory (returning device → "Welcome back", last-used way first, email prefilled), passkey autofill, WebAuthn Signal API for stale passkeys; the accidental second account on prod was cleaned up. Identity is in good shape: tabs **Returning | New player**, fixed sign-in order, saved players can add/change a password, one Google account per player, Google links only verified emails. Open I5 follow-up: character names. **Deferred (Alex, 2026-10-12): I2 QR device linking and I1b one screen steers.** **➡️ NEXT UP: the World Index** ([data model → discovery → UI → warp](./08-nfc-trading-cards.md#data-model--storage)). Decided: sighted/visited, generated cards for worlds without art, free warp, key **M**. **Server data model DEPLOYED 2026-10-12 (`628ee40`):** sighted/visited columns + migration, `world-index/sighted` and `/arrived` endpoints. Cards are links (no card/link distinction); sightings work offline. **Open: anti-cheat for client-reported sightings** → **decided 2026-10-12:** ship the World Index on cheap checks now; the real answer is the new [Phase 09](./09-authoritative-flight.md) (server-authoritative flight, offline replay, telemetry), planned and queued after 8B. Next: the client (`worldIndexStore` with an offline sighting queue, sighting detection, `WorldIndex.tsx` on M). **World Index client DEPLOYED 2026-10-12 (`b1ba425`):** store + offline queue, 100 u sightings, card reveal, `M` panel + HUD chip, Warp here, Copy link. **Tested in prod by Alex 2026-10-13; K-release fix deployed (`829ef82`).** **2026-10-13 (deployed):** live mini-render card art, dev overlay hidden in prod, awe hook stub. **Then: the Phase 05 mana design session** (see the morning pickup above). Evening of 2026-10-13 rewrote the model: **players hold no mana**; donations swell one universal pool and raise the **flow rate for everyone**; manifesting earns **XP → levels** that unlock abilities (warp gated); awe gives XP + raises the high-water line. The *why* is now in [RESEARCH.md](../RESEARCH.md) (MatchRank → Aweborn). Privacy + Terms updated and deployed. Next topics: levels design (what unlocks when), flow-rate formula from donation velocity, business plan v0.4 (donation-led; now public in [`docs/BUSINESS_PLAN.md`](../docs/BUSINESS_PLAN.md)). **Cards and links now always land inside the world** (Origin: the portal; 2026-10-13). See the last rows of the [Phase 05 session log](./05-mana-economy.md#session-log). In parallel: remaining 8B follow-ups (audio cue, sets/progress, character names). "Worlidex" was renamed **World Index** everywhere, including ROADMAP.
>
> **Done 2026-10-11:** [VPS Tailnet auto-join](./ops-tailscale-autojoin.md). New servers join as `tag:server` hands-free (OAuth secret in a NoEcho stack param, scrubbed after use, IMDS v2-only via an in-stack custom resource) and install the restricted CI keys from `infra/vps/ci-authorized-keys`. Tag-based ACL with tests. Tested on a throwaway instance, then applied to prod (HANDOFF → Rebuilding the VPS). DR follow-up: S3 backups are now hourly; `infra/rebuild-vps.sh` + `infra/restore-from-s3.sh` (+ `infra/test-dr-restore.sh` drill) **rehearsed on prod** (now instance `aweborn-vps-2`). Hourly `backup.yml` cron confirmed firing on schedule (2026-10-11).
>
> **Done 2026-10-10:** Milestone 8A. Teleport links `/w/<uuid>` are live, Origin = `5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7`, and the Origin card was re-rendered with the real ID. Also shipped that day: prod world-DB backups (hourly on-box + daily S3) and the read-only infra check, with all stacks in sync and guarded (HANDOFF → Backups / Infrastructure stacks). Remaining 8A bonus: "copy world link" button.
>
> **Active (design):** Phase 05 (Mana Economy & Donations). No code yet; 8B's first-discovery awe hook is stubbed (`server/sync-service/src/awe.ts`) and will feed XP + reach.
>
> **Deferred verification debt:** Phase 02 (10+ concurrent connections), Phase 03 (1000+ worlds @ 60fps), Phase 04 (on-device touch + physical gamepad).
>
> **Side item (not the priority, opened 2026-10-16): mobile play feels clunky.** Alex's on-device test failed: taps rarely work, one finger at a time, no Drive/Neutral toggle, small jittery stick. **M1–M6 built the same evening** (Pointer Events, true multi-touch, analog stick, on-screen buttons, phone basics; tested with Playwright multi-touch emulation). Alex on his phone: "holy cow! That was so cool!" **Deployed later that night:** fullscreen button + Add to Home Screen, donate modal fits in landscape, **pull back to brake** on the thrust thumb (orange → dark-red ring), portrait layout fixed, gold "Support Our Mission" banner and page titles removed. **Open: M7, Alex signs off on a real phone** (portrait, pull-to-brake feel → tune `BRAKE_PULL_PX`). Details: [Phase 04 → Mobile Play Optimization](./04-navigation-controls.md#mobile-play-optimization-side-item-opened-2026-10-16-not-the-priority).

---

## Dependency Graph

```
Phase 01 (Foundation) ✅
  └─► Phase 02 (Multiplayer Core) ✅
        ├─► Phase 03 (Universe & LOD) ✅
        │     └─► Phase 04 (Navigation) ✅
        │           ├─► Phase 05 (Mana & Economy)  ─► Phase 07 (World Creation & GenAI)
        │           │                                 (also needs Phase 01 genai-service, Phase 04 controls)
        │           └─► Phase 08 (NFC Cards & World Index)
        │                 8A Teleport links ─► 8B World Index ─► (Phase 05 awe hook)
        │                 8A ─► 8C Physical curated set ─► 8D Print-your-world (needs Phase 05 donations)
        │                 Offline card taps use Phase 06 PWA
        │           └─► Phase 09 (Authoritative Flight)  after 8B; feeds 05 rewards, 06 offline/mesh,
        │                                                 07 interior movement, 08 server-derived sightings
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
| Offline mana | No offline mana budget; offline creations are free and placed like any world (Ghost/solid is only the universe-map look; Option C, 2026-10-17) | Aug 18-19, 2026, revised 2026-10-17 |
| Donor advantages | ~~Cosmetics only~~ **No personal advantage at all** (Oct 13): players hold no mana; gifts grow the shared pool; optional recognition in the wave | Aug 19, 2026 → Oct 13 |
| Frontier contraction | Never contracts — high-water mark of generosity | Aug 19, 2026 |
| Offline collisions | Server nudges to nearest open space rather than deleting | Aug 19, 2026 |
| Anti-cheat | Client-side prediction with server reconciliation. **Oct 12:** made concrete in [Phase 09](./09-authoritative-flight.md): server-authoritative shared sim, inputs not positions, offline = server replay (worst case = a perfect honest flier) | Aug 19, 2026 |
| Frontier shape | Sector-based nebula expansion, not a perfect sphere | Aug 19, 2026 |
| Awe generation | ~~Awe ∝ object cost, mints mana~~ **Awe → XP + high-water reach, never pool mana; reactions to your creations are the main XP source** (Oct 13) | Aug 19, 2026 → Oct 13 |
| Object removal | 3-tier governance: Creator / Placer / Co-Creator | Aug 19, 2026 |
| Frontier radius formula | r ∝ ∛(**high-water line**), not the spendable pool (Oct 13) | Aug 19, 2026 → Oct 13 |
| Mana model | **Mana = compute** (`K = 100`, 1 mana = $0.01); one universal pool **= the treasury** (all money in at `K`, every draw categorized), players manifest from the creative share (`α = 0.5` of unrestricted income) at real cost; global flow `max(creative / τ, p_solo)`, `τ = 30` days, split max-min fairly among players active in the last 30 min; personal caps by level × solar (±10%); ordered requests with priority; patronage scrapped; donor perk = opt-in name in the wave (Oct 14). See [formula](./05-mana-economy.md#the-mana-pool-formula) | Oct 13, 2026 |
| NFC trading cards | Physical cards teleport to a world via `aweborn.org/w/<uuidv4>`; static Aweborn back; per-card arrival mode (default orbit) | Oct 3, 2026 |
| World ID format | Migrate 5-char random IDs → UUIDv4 before any card is printed | Oct 3, 2026 |
| Card security | No per-card serials, no anti-clone (low stakes); tags locked read-only to prevent rewrites | Oct 3, 2026 |
| World Index | Personal persistent index of discovered worlds; warp to any entry from anywhere; first discovery = awe (XP + Frontier reach; Oct 13) (renamed from "Worlidex" Oct 11) | Oct 3, 2026 |
| Player identity | One player across tabs + devices. Anonymous first; QR linking + passkeys + magic link + social (Google/Facebook/Apple…) + email/password on one `playerId`; per-device revocable sessions; one screen steers; legacy `creator` IDs → `"system"` | Oct 11, 2026 |
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
| Mana tuning | Phase 05 | Decided 2026-10-14: `K = 100`, `α = 0.5`, `τ = 30` days. Open: personal caps per level, seed grant, window size, priority formula |
| World Index details (discovery threshold, warp rules, key binding) | Phase 08 | Proposals in [08-nfc-trading-cards.md](./08-nfc-trading-cards.md#open-questions-mirrored-in-roadmap) |
| Card format, art pipeline, vendor, product name | Phase 08 | See Phase 08 open questions |
| Multiple servers sharing world sync | New phase? (overlaps Phase 06) | Raised 2026-10-11. Today: one sync-service, single-writer SQLite. Options include server-to-server Yjs replication over the Tailnet, player routing, and data ownership. Needs a design session (`/grill-me`) before any code. Prerequisite: [auto-join](./ops-tailscale-autojoin.md) |

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

*Last updated: 2026-10-17*
