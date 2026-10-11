# Phase 08: NFC Trading Cards & the Worlidex

**Status:** `[~]` In Progress: card art done (2026-10-04); **Milestone 8A is the current priority**
**Depends on:** [Phase 04: Navigation & Controls](./04-navigation-controls.md) (warp visuals, orbit capture, world entry). Milestone-level dependencies on [Phase 05](./05-mana-economy.md) (awe + donation→mana) and [Phase 06](./06-offline-mesh.md) (PWA/offline tap) are listed below.
**ROADMAP reference:** [Physical Portals: NFC Trading Cards & the Worlidex](../ROADMAP.md#physical-portals-nfc-trading-cards--the-worlidex)
**Estimated sessions:** 7-10 (software) + vendor lead time for physical cards

## Goal

Turn Aweborn worlds into **physical NFC trading cards**. Tap a phone to a card and `https://aweborn.org/w/<uuidv4>` opens. The player's star **teleports to that world**, the world is added to their **Worlidex** (personal index of discovered worlds), and a first-time discovery fires the reward. From then on the player can warp to any Worlidex world from anywhere in the universe. Cards are sold as fundraisers (proceeds become mana), given away at events, and printed on demand by players and organizations for their own worlds.

## Design Summary (from ROADMAP)

| Concept | Decision |
|---------|----------|
| URL | `https://aweborn.org/w/<uuidv4>`, optional `?a=in` arrival param |
| World IDs | **Migrate from 5-char random → UUIDv4** (`crypto.randomUUID()`) before any card is printed |
| Arrival | Configurable per card via URL param; **default = orbit** (`?a=in` = drop inside the world) |
| Card front | World art, name, creator, coordinates + sector, set name + set number |
| Card back | **Static Aweborn logo design, identical on every card** |
| Chip | NTAG213 (≈60-byte payload fits in its 144 bytes), NDEF URI record, **locked read-only** |
| Per-card serials | **No.** The card is just the world ID |
| Anti-clone | **Not needed.** Low stakes by design. NTAG 424 DNA (SUN) is a documented future option only |
| Worlidex | Persistent personal index; any discovery method counts; warp to any entry from anywhere |
| First discovery | `first-world-visit` awe (500 mana → **universal pool**) + card-reveal animation + Worlidex entry |
| Programs | Curated sets (Aweborn) **and** print-your-world on demand (players, companies, events) |
| Money | Sold as fundraiser (proceeds → Stripe → mana pool) **and** given free at events |

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tag reading | NDEF URI record handled by the OS (not Web NFC API) | Works on iOS (XS+) and Android with no app |
| Route | `/w/:uuid` client-side route in the SPA | CloudFront already serves `index.html` for 403/404 (`infra/cloudformation.yml`, `CustomErrorResponses`), so no infra change is needed |
| World lookup | New lookup-by-ID path in sync-service (HTTP `GET /worlds/:id` or WS message) | The client only subscribes to nearby sectors, so a card target can be anywhere in the universe |
| Teleport | Set player position directly + reuse WarpSystem arrival effects | Feels native; no lock-on or charge required |
| Worlidex storage | Server-side per-player record + local IndexedDB cache | Must survive tab closes and work offline; currently `playerId` is `sessionStorage` only |
| Card permanence | IDs immutable, worlds never hard-deleted, `/w/` + `?a=` is a permanent public API | Printed cards can't be patched |

---

## Milestone 8A — Teleport Links (`/w/<uuid>`)

> No physical cards needed. Can start right after Phase 04. Unblocks everything else.

### ▶ Resume here (Milestone 8A)

> **Update 2026-10-10:** 8A core is DONE and live (steps 1–6; see session log). Origin = `5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7`, card re-rendered. Remaining: share-link bonus. Prod DB backups are in place (HANDOFF → Backups). The notes below are the original 2026-10-04 plan.

> **Set 2026-10-04 by Alex:** 8A is the top priority. DTB RFID (card vendor) has our pilot request (50–100 cards, TCG 63×88, NTAG213, quotes at 100/1k/5k) and will reply soon. Cards can't be encoded until IDs are final.
>
> **State at sign-off**
> - Card art is **final and pushed** (`e7b4224`): front template `scripts/cards/lib/front.mjs`, back `scripts/cards/lib/back.mjs` → `cards/templates/back.svg`, previews via `node scripts/cards/render-preview.mjs`.
> - The Origin card uses a **placeholder** UUID `7c1e4b2a-9d3f-4e8a-b5c6-0f2d8a91e347` in `scripts/cards/render-preview.mjs`. Replace it with the portal's real world ID once registered (below), then re-render.
> - **Uncommitted, unrelated work in `src/`** (slingshot / flight / gravity: `FlightController.ts`, `GravitySystem.ts`, `PlayerOrb.tsx`, `Scene.tsx`, `HUD.tsx`, `TouchInputAdapter.ts`, `index.css`, new `SlingshotArc.tsx`). Ask Alex whether to commit, stash, or finish it before touching those files.
>
> **Suggested order**
> 1. `generateWorldId()` → `crypto.randomUUID()` (`server/sync-service/src/rooms.ts`, ~line 558, used at ~197). Add a `parseRoomPath()` UUID test (`shared/crdt-schema.ts`).
> 2. Migration script for existing 5-char IDs in `server/data/universe.db` (Universe CRDT `worlds` keys + `WorldEntry.id` + world doc keys). Back up the DB first; check prod VPS data too.
> 3. Register **Origin** (the portal) as a real `WorldEntry` at `(0, 0, 0)` with a permanent UUID. Today it's hard-coded `PORTAL_POSITION` in `src/systems/GravitySystem.ts` and `src/systems/WarpSystem.ts` (`world: null`). Keep the portal visuals/behavior; just give it an ID that resolves.
> 4. `GET /worlds/:id` in sync-service (+ CORS, "faded" response for removed worlds).
> 5. Client `/w/<uuid>` boot parse + `?a=` + `TeleportSystem.ts` (orbit default). CloudFront already serves `index.html` for unknown paths.
> 6. Put Origin's real UUID into the card, re-render, and verify the QR decodes to the live URL that teleports.
>
> **Open decision to raise first:** migrate the legacy 5-char IDs (recommended: pre-launch) vs keep them resolvable.

### World ID Migration → UUIDv4
- `[x]` Replace `generateWorldId()` in `server/sync-service/src/rooms.ts` with `crypto.randomUUID()` (2026-10-10)
- `[x]` Decide: migrate existing 5-char worlds in `server/data/universe.db` (rewrite IDs in Universe CRDT + world docs), or keep legacy IDs resolvable. **Decided 2026-10-10: migrate now, pre-launch**
- `[x]` Write a one-off migration script (Universe CRDT `worlds` map keys + `WorldEntry.id` + persisted world doc keys) → `server/sync-service/scripts/migrate-world-ids.ts` (`--dry-run`, auto-backup, mapping JSON, verify, idempotent). Ran on local `server/data/universe.db` 2026-10-10: 8/8 worlds migrated; world content verified unchanged (terrain seed + objects)
- `[x]` **Deploy the current sync-service to prod with a persistent volume** (done 2026-10-10). Prod had been running the Phase 01 y-websocket passthrough since Aug 21. Dockerfile now builds from the repo root and runs `tsc`; `shared/package.json` marks shared as ESM; k3s mounts hostPath `/var/lib/aweborn/sync-data` at `/data` (`DB_PATH=/data/universe.db`), Recreate strategy. Verified: public `wss://sync.aweborn.org` serves the new protocol, DB survives pod deletion. Prod started with an empty universe (nothing to migrate)
- `[x]` Verify `parseRoomPath()` in `shared/crdt-schema.ts` accepts UUIDs and add a test → `shared/crdt-schema.test.ts` (`node --test shared/crdt-schema.test.ts`); added shared `isWorldId()` / `WORLD_ID_PATTERN` (lowercase UUIDv4)
- `[x]` Update ROADMAP/HANDOFF examples that show `k7x9m`-style IDs (note the deviation in this file's log). HANDOFF updated 2026-10-10; ROADMAP left as-is (design bible, not edited); deviation logged below
- `[x]` Register the **Aweborn Portal as a real world entry** ("Origin") at `(0, 0, 0)` with a permanent UUIDv4 → **`5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7`** (`ORIGIN_WORLD_ID` in `shared/crdt-schema.ts`). The server seeds it idempotently (`ensureOriginWorld`); the client hides it from `worlds` because the portal keeps its dedicated render/gravity/warp code (2026-10-10)

### World Lookup by ID
- `[x]` sync-service: `GET /worlds/:id` → `WorldEntry` (or 404), CORS for aweborn.org (+ localhost, `CORS_ORIGINS` env)
- `[x]` Return `resolvedPosition`, `name`, `color`, `solidified`, `sector` (as `position`, plus `isOrigin`)
- `[~]` Graceful response for a removed world ("this world has faded"). v1: server returns 404 `not_found`, client shows "This world has faded". No tombstones yet (worlds are never hard-deleted by design)

### Client Route & Teleport
- `[x]` Parse `window.location.pathname` for `/w/<uuid>` on boot (`parseTeleportLink()` in shared, no router)
- `[x]` Parse `?a=` arrival param: `in` → inside, anything else / missing → orbit (`in` on Origin falls back to orbit)
- `[x]` Create `src/systems/TeleportSystem.ts`: fetch world → set player position near `resolvedPosition` (universe doc is not sector-filtered, so no extra subscription needed)
- `[x]` Orbit arrival: player placed 2.5u from the world (inside the orbit-capture band), facing it; Origin at 6u
- `[x]` Inside arrival: calls `enterWorld` after the arrival flash (700 ms)
- `[x]` Reuse `WarpEffect` arrival flash + particles for the teleport moment
- `[~]` Handle tap while already playing (PWA already open): the OS opens the URL as a fresh navigation, which the boot path handles. `teleportToId()` is ready for in-app use (Worlidex warp, share links)
- `[x]` Unknown/invalid UUID → friendly toast (`TeleportToast.tsx`), normal spawn
- `[x]` After arrival, `history.replaceState` back to `/` (decided: clear it, so reloads don't re-teleport)

### Share Links (bonus)
- `[ ]` "Copy world link" in scan/info (L) panel → `https://aweborn.org/w/<uuid>`
- `[ ]` (Optional) Per-world Open Graph preview via CloudFront Function / Lambda@Edge so shared links render a card image

---

## Milestone 8B — The Worlidex

> Depends on 8A. Awe reward hook depends on Phase 05 `AweTracker` (stub it if Phase 05 isn't done).

### Persistent Player Identity (prerequisite)
- `[ ]` Move `playerId` from `sessionStorage` → `localStorage` (device-persistent) in `src/hooks/usePresence.ts`
- `[ ]` Decide v1 identity scope (see Open Questions). Recommended: device-persistent ID now, cross-device linking later

### Data Model & Storage
- `[ ]` Add `WorlidexEntry` type to `shared/crdt-schema.ts`:
  ```typescript
  interface WorlidexEntry {
    worldId: string;
    state: "sighted" | "visited";
    discoveredAt: number;
    method: "flight" | "card" | "link" | "warp";
    visitCount: number;
    lastVisitedAt: number;
    pending: boolean;   // tapped offline, not yet resolved
  }
  ```
- `[ ]` Server: per-player Worlidex store (SQLite table alongside `universe.db`) + `GET/POST /players/:id/worlidex`
- `[ ]` Client: `src/stores/worlidexStore.ts` with IndexedDB cache, synced to the server when online
- `[ ]` Distinguish `card` vs `link` method (e.g., card URLs carry a marker param, decided at print time; see Open Questions)

### Discovery Tracking
- `[ ]` Add entry on: card/link teleport arrival, entering a world (N), and (if decided) sighting within close LOD range or scanning with L
- `[ ]` First discovery → fire `first-world-visit` awe event (500 mana → universal pool, server-validated)
- `[ ]` Shared-awe 2× when other players are nearby at discovery time
- `[ ]` Repeat visits increment `visitCount`, no reward

### Discovery Moment (Card Reveal)
- `[ ]` Create `src/components/CardReveal.tsx`: static Aweborn back flips to the world's front art, then slides into the Worlidex
- `[ ]` Audio cue for discovery

### Worlidex UI
- `[ ]` Create `src/components/Worlidex.tsx`: collector grid of world cards (same art as physical cards)
- `[ ]` Group by set, show per-set progress ("7 / 12 discovered")
- `[ ]` Card-found badge for `method: "card"` entries (decorative only)
- `[ ]` Key binding (proposal: hold `;`). Touch: dedicated HUD button. Gamepad: TBD
- `[ ]` Replace the temporary `CRDTDevOverlay` world list in production with the Worlidex

### Worlidex Warp
- `[ ]` Select entry → warp charge (K visuals) → teleport via `TeleportSystem`
- `[ ]` Rules per Open Questions (proposal: free, no cooldown)

---

## Milestone 8C — Physical Cards: Curated Set

> Depends on 8A (URLs must be final and IDs migrated). Software-light, mostly design + vendor + testing.

### Card Design
- `[x]` Decide card format (TCG 63×88 mm vs CR80 85.6×54 mm) → **TCG 63×88 mm** (CR80 quoted as an alternative)
- `[x]` Design the **static back** (Aweborn logo, from `aweborn-logo.svg` / logo-concepts), one design used forever → **final:** frame + orbit ring, f1 favicon palette on charcoal, lowercase "aweborn" in Jost (outlined). Generated by `scripts/cards/build-back.mjs` → `cards/templates/back.svg`
- `[x]` Design the **front template**: art window, world name, creator, `(x, y, z)` + sector, set name + number, optional QR fallback → template is code: `scripts/cards/lib/front.mjs` (outlined Jost + JetBrains Mono, real QR of the card URL, embedded art). Output is verified self-contained (no `<text>`, fonts, or external files)
- `[x]` Store templates in repo (e.g., `cards/templates/front.svg`, `cards/templates/back.svg`). Back: `cards/templates/back.svg` (built by `scripts/cards/build-back.mjs`). Front: `scripts/cards/lib/front.mjs`. Previews: `node scripts/cards/render-preview.mjs` → `cards/previews/` (also decodes the QR to check it)

### Card Art
- `[ ]` Decide art pipeline (in-game snapshot tool / server render / Phase 07 AI)
- `[ ]` v1: add a "photo mode" snapshot of the world (universe view of its sun + surroundings) for curated cards

### Encoding Tooling
- `[ ]` Create `scripts/cards/` tooling: input = list of world IDs + arrival modes → output = print-ready fronts (SVG/PDF) + encoding manifest (CSV of URLs)
- `[ ]` Validate each world: exists, `resolvedAt > 0`, not removed (Card Invariant #3)
- `[ ]` In-house encoding path: USB NFC writer (e.g., ACR122U) or the Chameleon Ultra / phone app (NFC Tools) for small runs → write NDEF URI → **lock tag**
- `[~]` Vendor research: full-color printed NFC cards with per-card unique URL encoding + locking, small minimums, price per card at 100 / 1,000 / 10,000 → Shenzhen DTB RFID (Mandy Chen) replied Sep 8; quote requested Oct 4 for 100 / 1k / 5k, cardstock + matte PVC, vendor-encoded vs blank

### Origin Set
- `[x]` Choose the Origin Set worlds (Aweborn Portal + first worlds) and set size → **one card, `001 / 001`: "Origin", the Aweborn Portal itself at `(0, 0, 0)`, sector `0:0:0`** (name deliberately open-ended)
- `[ ]` Pick the Origin art (painted candidates in `cards/samples/origin-*.jpg`, compare sheet `cards/explore/origin-compare.png`) and put the portal's real UUID into the card build
- `[ ]` Small pilot run (~10-50 cards)
- `[ ]` Test matrix: iPhone (locked screen, unlocked, Safari default, PWA installed), Android (Chrome, Samsung Internet), phone cases, tap position on card
- `[ ]` Test arrival modes (`orbit`, `?a=in`) + first discovery + repeat tap

---

## Milestone 8D — Print-Your-World (On Demand)

> Depends on 8C (templates + tooling) and Phase 05 (donation → mana pipeline).

### Ordering Flow
- `[ ]` "Order cards of this world" entry point (world settings `H`, own worlds only; curated/org orders via admin)
- `[ ]` Order options: quantity tiers, arrival mode, art choice
- `[ ]` Stripe Checkout for card orders (extend existing Stripe integration, separate product from donations)
- `[ ]` Order record (world ID, quantity, arrival mode, art, shipping, status)

### Fulfillment
- `[ ]` Generate print-ready files + encoding manifest from the order (reuse `scripts/cards/`)
- `[ ]` Send to vendor (API or manual batch at first), track status
- `[ ]` Order status page / email

### Economy Hooks
- `[ ]` Order surplus (price − production − shipping) → donation pipeline → mana pool (golden wave)
- `[ ]` (If decided) Ghost world order → targeted patronage toward solidifying that world
- `[ ]` Moderation: review world name/art before printing (printed content is permanent)

### Organizations & Events
- `[ ]` Bulk order path for events (large quantities, `?a=in` default)
- `[ ]` One-page "How to use Aweborn cards at your event" guide

---

## Acceptance Criteria

- [ ] `https://aweborn.org/w/<uuidv4>` teleports a player to that world from a cold start and from an already-open session
- [ ] Default arrival = captured orbit; `?a=in` = drops inside the world
- [ ] All world IDs are UUIDv4; no legacy short IDs remain (or legacy is explicitly supported)
- [ ] Worlidex persists across tab closes and page reloads
- [ ] First discovery generates awe into the universal pool and shows the card-reveal moment; repeat visits don't
- [ ] Player can warp to any Worlidex world from anywhere in the universe
- [ ] A physical NTAG213 card, locked, opens the correct world on both iOS and Android with no app installed
- [ ] Every card in a set has an identical back
- [ ] A player can order cards of their own world and the surplus becomes mana

## Open Questions (mirrored in ROADMAP)

| Question | Proposal |
|----------|----------|
| Discovery threshold: sighted vs visited? | Two states. Sighted = can warp to, visited = full art revealed |
| Worlidex Warp cost/cooldown? | Free, standard K charge, no cooldown |
| Worlidex key binding? | `;` tap = Map/Compass, hold = Worlidex |
| Identity: device vs cross-device? | v1 device-persistent, v2 passkey/email linking |
| Personal discovery rewards beyond awe + entry? | Cosmetic-only milestone badges / set-completion flair |
| Distinguish card taps from shared links? | Optional marker param baked into card URLs (e.g., `?c=1`); only affects the badge, never rewards |
| Print-your-world → patronage? | Opt-in at checkout |
| Card size? | TCG 63×88 mm |
| QR fallback on front? | Yes, small corner QR |
| Art pipeline? | v1 in-game photo mode; later Phase 07 AI art |
| Vendor vs in-house encoding? | In-house for pilot, vendor for scale |
| Product name? | TBD |
| Should `/w/` URL be cleared after arrival? | TBD |

## Files Changed (anticipated)

| File | Action | Notes |
|------|--------|-------|
| `server/sync-service/src/rooms.ts` | MODIFY | UUIDv4 world IDs |
| `server/sync-service/src/` (routes) | MODIFY | `GET /worlds/:id`, Worlidex endpoints |
| `server/sync-service/scripts/migrate-world-ids.ts` | NEW | One-off ID migration |
| `shared/crdt-schema.ts` | MODIFY | `WorlidexEntry`, UUID test for `parseRoomPath` |
| `src/App.tsx` | MODIFY | `/w/:uuid` boot handling, mount Worlidex |
| `src/systems/TeleportSystem.ts` | NEW | Lookup → position → arrival mode |
| `src/stores/worlidexStore.ts` | NEW | IndexedDB + server sync |
| `src/components/Worlidex.tsx` | NEW | Collector UI + warp |
| `src/components/CardReveal.tsx` | NEW | Discovery moment |
| `src/hooks/usePresence.ts` | MODIFY | Persistent `playerId` |
| `src/components/CRDTDevOverlay.tsx` | MODIFY | Retire world list in prod |
| `scripts/cards/` | NEW | Print files + encoding manifest |
| `cards/templates/` | NEW | Static back + front template |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-10-03 | Planning session: cataloged the NFC trading card + Worlidex vision in ROADMAP.md, created this phase file, linked from L0/L1 plans and Phase 05/06. Decisions: `/w/<uuidv4>` URLs (migrate IDs), per-card arrival mode (default orbit), curated + print-your-world programs, sold + free, no serials, no anti-clone, first-discovery awe + Worlidex. | Resolve open questions, then start Milestone 8A |
| 2026-10-04 | Card art session: TCG 63×88 mm confirmed. Created `cards/templates/back.svg` (minimal charcoal, monochrome Fibonacci mark, wordmark), `cards/templates/front.svg` (tokenized), and `scripts/cards/render-preview.mjs` (sharp → 300 dpi PNG previews). Drafted DTB reply: 50–100 pilot within 6–8 wks, quotes at 100/1k/5k, cardstock + matte PVC, vendor-encoded vs blank NTAG213. | Send DTB reply; add a QR encoder; outline fonts for print; final sign-off on the back |
| 2026-10-04 | Back exploration: `scripts/cards/back-variations.mjs` → `cards/explore/` (lines / colors / wordmark / type specimen sheets). Added OFL fonts in `cards/fonts/` + `fontkit` devDependency (wordmarks outlined to paths). **Back decided:** frame + ring, f1 favicon palette on charcoal, "aweborn" lowercase in Jost (Futura lineage). Front footer mark recolored to match. | Send DTB reply (ask cut tolerance, since the frame shows miscuts); QR encoder; outline front text (Jost/Outfit) |
| 2026-10-04 | DTB reply **sent**. Real QR (`qrcode`, ECC M, v4 33×33 = 0.30 mm/module at 10 mm) + all front text outlined (Jost + JetBrains Mono). New `scripts/cards/lib/` (`outline.mjs`, `qr.mjs`, `front.mjs`); old token `cards/templates/front.svg` removed. Builds fail on any `<text>`/font/external href; previews decode the QR with `jsqr` at 300 + 150 dpi. | Await DTB quote. On the pilot, test-scan QR on the actual stock (0.30 mm modules is small; fallback: 11–12 mm symbol, or uppercase alphanumeric URLs for a v3 code). Then Milestone 8A (UUID migration) before any print |
| 2026-10-04 | **Origin Set = a single card (001 / 001)**: world beside the portal at `(21, 34, 55)`, sector `0:0:0`. Preview updated. | Name + create the Origin world after 8A |
| 2026-10-04 | World named **Origin** (deliberately open-ended). Front art is now vector: `scripts/cards/lib/art/origin.mjs` (portal: solid gold core, aura, full-height two-way beam; in-game colors; gradients/masks only). `renderFront` accepts `artSvg` as well as raster `artHref`. Card coordinates = the world's real rounded `resolvedPosition` (no offsets). | Decide whether Origin *is* the portal at `(0, 0, 0)` or a world beside it |
| 2026-10-04 | **Origin = the portal at `(0, 0, 0)`** (8A task added to register it as a world). Vector art judged too plain; generated 3 painted, stylized, angular candidates (shards / geometric halo / beacon-over-clouds) and rendered each on the card. `render-preview.mjs` now takes `[art] [outDir]` (`vector` = lib/art/origin.mjs). | Pick the art |
| 2026-10-04 | **Origin art chosen:** `cards/samples/origin-tunnel.jpg` (A2 veil + A3 nebula blend, pushed toward a deep spiral tunnel; calm, alluring). **Type:** all Jost. Data lines use a new `outline({ mono: true })` (Jost tabular figures + fixed cells, since there is no Jost Mono). **No set number on single-card sets** (Origin prints none). Multi-card sets pad to the set's width (`01 / 12`). Avoid `1 / 1`, which collectors read as one-of-one. **Footer:** "Tap or scan · aweborn.org" (covers NFC + the QR backup, names no device). `scripts/cards/explore-numbers.mjs` → `cards/explore/numbers.png`. | Optional: more orb glow in the art. Prune unused `cards/samples/` candidates. Await DTB quote |
| 2026-10-04 | **Text colour: WCAG AAA (≥ 7:1) everywhere.** The old "faint" grey `#71717a` (coordinates, tap hint) was only 3.7:1. The palette is now two levels: primary (name 16.1, creator 14.0, set label 12.0) and one secondary `muted` `#acacb4` (7.9:1) for "by", the data line and the hint. The small text went from Jost 400 to 450 for print. `renderFront` now **fails the build** if any text colour is below 7:1 (`assertTextContrast`). Card type is about 6 pt, so the large-text allowance never applies. Back wordmark `#c9b7d6`: 8.4–9.8:1 across its gradient. Sheet: `scripts/cards/explore-colors.mjs` → `cards/explore/colors.png` (includes a rough print simulation). | Confirm on pilot cards (matte stock prints darker) |
| 2026-10-04 | **Back colour final:** the wordmark changed from lavender `#c9b7d6` to steel blue `#a9c1da` (8.4:1 worst case on the vignette, AAA). The navy frame and ring stay. Reason: the lavender almost matched the mark's lilac circle without quite matching, so it read as a mistake. The blue sits with the big circle and the navy lines. Back template moved into `scripts/cards/lib/back.mjs` (`renderBack`, `BACK_DEFAULTS`). Sheet: `scripts/cards/explore-back-colors.mjs` → `cards/explore/back-colors.png`. | — |
| 2026-10-10 | **8A steps 1–2.** New world IDs are UUIDv4 (`crypto.randomUUID()`); shared `isWorldId()` + `shared/crdt-schema.test.ts`. Decided: migrate legacy IDs pre-launch. Wrote `server/sync-service/scripts/migrate-world-ids.ts` (Yjs ops on the existing universe doc so stale clients merge the delete; renames world doc rows; backup + mapping + verify). Local DB: 8 worlds migrated, server boots, client sees only UUID keys and joins a migrated world with original content. **Prod finding:** the VPS sync-service is still the Phase 01 passthrough (no persistence), so nothing to migrate there, but prod needs a real sync-service deploy with a volume before `/w/` can work. Added that task. Also: `scripts/tsconfig.json` for Node-run scripts. | Step 3: register Origin at `(0,0,0)`; schedule the prod sync-service deploy |
| 2026-10-10 | **Prod sync-service deployed for real.** Fixed the Dockerfile (repo-root context, `tsc`, prune), added `shared/package.json` (`type: module`; without it the in-image build emitted CJS and crashed, caught by a pre-rollout smoke test), hostPath volume + init chown + Recreate in `infra/k3s/sync-service-deployment.yaml`, updated `deploy.sh`, docker-compose, HANDOFF. Verified over public WSS + restart persistence. Multiplayer world creation/presence should now work on aweborn.org for the first time. | Alex: smoke-test aweborn.org (create a world, reload, second browser). Then step 3: Origin |
| 2026-10-10 | **CI deploys every VPS service.** `infra/k3s/deploy-services.sh` is now the single deploy path, used by CI, by hand, and by bootstrap. CI runs per-service path filters, connects over ephemeral Tailscale, and the forced-command key passes a validated service list. Each service is built, smoke-tested, rolled out, soaked, and rolled back on failure. Caddy is validated first and restarts only if its config changed. agent-runner switched to Recreate. `secrets.yaml` became `secrets.example.yaml`, and no automation applies it anymore (it would have clobbered the Stripe key). CloudFormation bootstrap now calls the same script. Verified with a full CI run (38101674034): all 4 services were on `90bd381` and healthy, and the secret was intact. | Step 3: Origin. Still open: nightly backup of prod `universe.db` |
| 2026-10-10 | **8A steps 3–5: teleport links work.** Origin registered with permanent ID `5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7` (new; replaces the card placeholder). `GET/HEAD /worlds/:id` on sync-service (400 invalid / 404 not found / 200, 30 s cache, CORS allowlist). Client: `parseTeleportLink()`, `TeleportSystem`, `TeleportToast`, camera snap + WarpEffect arrival burst, auto-lock skips the portal after a teleport. **Deviations:** Origin hidden from client `worlds` (portal has its own code paths); 404 doubles as "faded"; portal gravity body id is now `ORIGIN_WORLD_ID`; ROADMAP's `k7x9m` example left as-is (not edited). **Bug fixed:** entering a world from the dev overlay (N) never joined the server room, so world content never loaded and Escape never left; `CRDTDevOverlay` now syncs join/leave with `activeWorldId`. Verified locally: Origin, orbit, `?a=in` (objects loaded), invalid link toast. | Step 6: Origin UUID into the card + re-render + QR check. Then backup service for prod `universe.db` |
| 2026-10-10 | **8A step 6 + shipped.** Card re-rendered with `5949dfc5-…` (QR decodes ✓ at 300/150 dpi). Pushed `0fc0f7d`; prod `GET /worlds/<origin>` returns Origin, and `https://aweborn.org/w/5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7` teleports to the portal with the toast (live browser check). **Prod world DB backups** (`8b1b64e`): hourly `sync-backup` CronJob (VACUUM INTO + integrity check + gzip, 48 hourly / 30 daily in `/var/lib/aweborn/backups/sync`), daily `backup.yml` pulls via a read-only forced-command key over Tailscale and uploads with a put-only OIDC role to versioned `aweborn-backups-111551045759` (90 days, stack `aweborn-backups`). Verified: manual job, restricted key refuses everything but `latest`, `restore-sync-db.sh --check` passes, first S3 upload round-trips to a valid DB. See HANDOFF → Backups. | Share-link bonus (copy link in L panel), or start 8B (Worlidex). Await DTB quote |
