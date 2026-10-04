# Phase 08: NFC Trading Cards & the Worlidex

**Status:** `[ ]` Not Started
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

### World ID Migration → UUIDv4
- `[ ]` Replace `generateWorldId()` in `server/sync-service/src/rooms.ts` with `crypto.randomUUID()`
- `[ ]` Decide: migrate existing 5-char worlds in `server/data/universe.db` (rewrite IDs in Universe CRDT + world docs), or keep legacy IDs resolvable. **Recommended: migrate now, pre-launch**
- `[ ]` Write a one-off migration script (Universe CRDT `worlds` map keys + `WorldEntry.id` + persisted world doc keys)
- `[ ]` Verify `parseRoomPath()` in `shared/crdt-schema.ts` accepts UUIDs (regex `[a-zA-Z0-9_-]+`, which it already does) and add a test
- `[ ]` Update ROADMAP/HANDOFF examples that show `k7x9m`-style IDs (note the deviation in this file's log)
- `[ ]` Register the **Aweborn Portal as a real world entry** ("Origin") at `(0, 0, 0)` with a permanent UUIDv4, so the Origin card's `/w/<uuid>` resolves. Today the portal is a hard-coded scene object (`PORTAL_POSITION`, `world: null`), not a CRDT world

### World Lookup by ID
- `[ ]` sync-service: `GET /worlds/:id` → `WorldEntry` (or 404), CORS for aweborn.org
- `[ ]` Return `resolvedPosition`, `name`, `color`, `solidified`, `sector`
- `[ ]` Graceful response for a removed world ("this world has faded") instead of a 404 (Card Invariant #2)

### Client Route & Teleport
- `[ ]` Parse `window.location.pathname` for `/w/<uuid>` on boot (no router library needed yet)
- `[ ]` Parse `?a=` arrival param: `in` → inside, anything else / missing → orbit
- `[ ]` Create `src/systems/TeleportSystem.ts`: fetch world → set player position near `resolvedPosition` → subscribe to that world's sector rooms
- `[ ]` Orbit arrival: place player in the gravity well and hand off to `GravitySystem` captured-orbit logic
- `[ ]` Inside arrival: trigger the existing world-entry transition directly (`WorldTransition`)
- `[ ]` Reuse `WarpEffect` arrival flash + particles for the teleport moment
- `[ ]` Handle tap while already playing (PWA already open): teleport from current position
- `[ ]` Unknown/invalid UUID → friendly message, spawn at origin
- `[ ]` After arrival, `history.replaceState` back to `/` (optional; decide whether URL should persist)

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
