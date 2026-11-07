# 18+ worlds: reconciliation inventory (2026-11-07)

Audit of every touchpoint the 2026-11-07 age grill ([phases/07 "18+ worlds, the Reddit way"](../../../phases/07-genai-creation.md#18-worlds-the-reddit-way-age-grill-alex-2026-11-07-no-code)) has to reach, plus Alex's added hard requirement: **18+ creations must never leak into everyone worlds or reach a player who hasn't opened the 18+ door.** Read-only audit. Nothing else was edited. Not legal advice.

Legend for **Change**: **DOC** = wording only · **CODE** = behaviour change · **Q** = open question for Alex or a lawyer.
Priority: **P0** = legal or safety blocker before 18+ ships · **P1** = must land in the same push as 18+ · **P2** = cleanup or consistency.

---

## 0. Ranked top items

| # | P | Item | Where |
|---|---|---|---|
| 1 | P0 | **Generations don't know their world.** A Make job has no `worldId` or rating; the Library is one global, content-addressed table with no tag. Without a tag on the asset itself, containment can't work at all. | `server/sync-service/src/creations.ts:109,141`; `server/genai-service/src/index.ts:239-269`; `server/genai-service/src/library.ts:36-52` |
| 2 | P0 | **The universe doc goes to every client in full** (not sector-filtered), with every world's `name` and `music` file. Veiled planets can't hide a name the client already has, and the offline cache stores it. | `shared/crdt-schema.ts:74-125`; `phases/08-nfc-trading-cards.md:86`; `src/lib/offlineCache.ts:26` |
| 3 | P0 | **World writes are applied, then reverted.** An 18+ asset placed into an everyone world is broadcast to everyone in it before the server snaps it back. Mesh peers and offline caches may keep it. | `server/sync-service/src/world-authority.ts:17-22` |
| 4 | P0 | **Only prompts are checked today, never outputs.** The safety check fails open when the classifier is down. Pictures and models are never looked at after they're generated. The decisions require an output check, with apparent age and real person, on everything. | `server/sync-service/src/safety.ts:1-13,130-187` |
| 5 | P0 | **Any player can set any asset's public thumbnail.** First write wins, and the PNG is never checked, so it can be used to put explicit or illegal imagery onto an everyone model. | `server/sync-service/src/trash.ts:47-66`; `server/genai-service/src/index.ts:292-318` |
| 6 | P0 | **CSAM path:** there's no hash matching, no NCMEC runbook and no preservation or deletion policy. The S3 archive (`archive/calls/…`), the versioned asset bucket (30 days noncurrent), backups and CloudFront edge caches would all hold hard-line content. | `server/genai-service/src/library.ts:8-10,212-217`; `infra/cloudformation-assets.yml:57-64`; `infra/cloudformation-backups.yml:19-52` |
| 7 | P0 | **Assets are public, immutable and cached for a year** (`/assets/<sha>`, CDN `models/`, `media/`, the service worker's cache-first, CORS `*`). Anyone with a link fetches 18+ files with no door, and a re-tag or removal can't pull back copies already on devices or at the edge. | `server/sync-service/src/creations.ts:311-338`; `server/genai-service/src/index.ts:342-370`; `public/sw.js:59-62,97-105` |
| 8 | P0 | **Research consent.** RESEARCH.md says "disclosed, no consent form". Data about sexual content and sexual interests is special-category data (GDPR Art. 9) and IRB-sensitive. "Same research ID, flagged 18+" needs explicit opt-in, or 18+ content must be excluded from research. | `RESEARCH.md:40-46`; `public/privacy.html:63-72` |
| 9 | P0 | **Age assurance and new processors are missing from Privacy.** Birthdate, the age-estimate vendor (Yoti or Persona), NCMEC reporting and the adult-capable model providers aren't in "What we collect" or "Who else handles it". AGENTS.md says Privacy must change before any new collection. | `public/privacy.html:28-52,75-83,108-109`; `AGENTS.md:13-14` |
| 10 | P0 | **Provider terms.** Meshy, ElevenLabs, OpenRouter's zero-data-retention providers and Anthropic (persona, planner, safety) restrict sexual output. `safety.ts:11` relies on Meshy's own moderation. Adult-capable providers have to be researched (checklist item 1) before the "any model" menu exists. | `server/sync-service/src/safety.ts:11,21`; `server/sync-service/src/planner.ts:37-45`; `docs/research/2026-11-life-and-minds/audio.md:90`; `npc-brains.md:82` |
| 11 | P1 | **Cards versus worlds that turn 18+ later.** "/w/<uuid> resolves forever" and "every card lands you inside" are card invariants. A printed card or event card whose world later becomes 18+ breaks the door. Event orders and admin sets skip the checkout's world check. The photo-mode art is a raw JPEG from the client and isn't tied to the world. | `ROADMAP.md:592,692-698`; `docs/BUSINESS_PLAN.md:84`; `server/sync-service/src/cards.ts:22-27,173-201,223` |
| 12 | P1 | **Portable minds carry memories across worlds.** Adopting a saved mind copies its `mind_library_memory` into the new world. Romantic or sexual memories from an 18+ world would follow the mind into an everyone world. The shelf (`GET /minds`) is public and unfiltered. | `server/sync-service/src/minds.ts:93-100,557-636,681-719` |
| 13 | P1 | **Public endpoints with shared caches:** `/library` (`public, max-age=15`), `/making-of` (`public, max-age=5`), `/minds`, `/worlds/:id` (`public, max-age=30/60`). Once results depend on the viewer's door they must be `private` or `Vary`, or one viewer's results get served to the next. | `creations.ts:345-360`; `making-of.ts:125`; `index.ts:84-138,484,699` |
| 14 | P1 | **Every all-ages prompt and rule** (safety, planner, lore, persona, reply rules, Terms) has to become the rater plus hard lines in the same push. The world's tier has to reach each prompt. | §5 |
| 15 | P1 | **Mesh, offline cache and shared devices.** A host phone in an 18+ world syncs its whole world doc to joiners over WebRTC with no server check. IndexedDB keeps 18+ world docs and assets after sign-out or after *Show 18+* is turned off. | `src/lib/mesh.ts:1-20`; `server/sync-service/src/mesh-intro.ts:1-20`; `src/lib/offlineCache.ts` |

---

## 1. Containment: every path an 18+ creation could take to an everyone world or a non-opted-in player

### 1.1 Proposed containment model

1. **The tag lives on the asset, at creation, on the server.**
   - Add `rating` (`everyone` | `adult`) and `hardline_state` to the genai `jobs` and `library` rows, and to `mind_nodes` and `mind_library`.
   - Set `rating = adult` when any of these is true: the chosen model is on the adult-capable list, the maker tagged it, the AI rater says so, or the job was made **in an 18+ world**. That last trigger means jobs must carry `worldId`.
   - Never trust a client-written field for the rating. The CRDT `PlacedObject` can show a mirrored `adult` flag, but the server derives it from the `asset` sha.
2. **Inheritance is sticky (OR, never AND).**
   - Every derived asset inherits from its sources: rig or remesh (`rig.ts`), the web-optimized `opt/` copy, thumbnails `<sha>.png`, a duplicate, a blueprint version, an adopted mind, and any future image-to-3D or re-export.
   - Content addressing (`INSERT OR IGNORE` on sha, `library.ts:167,202`) means identical bytes made in two places are one row. The tag must be upgraded on conflict (`ON CONFLICT DO UPDATE SET rating = max(...)`), never ignored.
   - A re-tag to adult, after a report, rater or human review, propagates to every world that places the sha. Those worlds become 18+ or have the object removed (Q-C1).
3. **Containment rule at every write.**
   - The server refuses to place an `adult` asset, mind or blueprint item into an everyone world unless the actor owns the world and confirms "this makes the world 18+".
   - The refusal happens **before broadcast**: an intent check or pre-apply filter, not today's apply-then-revert.
   - Placing an 18+ item never flips someone else's world.
4. **Containment rule at every read.**
   - Library, minds shelf and search queries filter by both **the viewer's door** and **the destination world's tier**. An everyone world's Library shows only everyone items, even to an opted-in adult, so a mis-placement can't happen by accident.
   - Universe data for veiled worlds is redacted per client: no name, no music file, no thumbnail. The universe doc can't stay one shared CRDT with names in it.
5. **Asset delivery is gated.**
   - Everyone assets keep public immutable URLs.
   - Adult assets get a separate prefix (`adult/…`) served only with short-lived signed URLs (CloudFront signed cookies or URLs) after a door check. `Cache-Control: private`, and never cached by the service worker.
6. **Device hygiene.**
   - 18+ world docs and assets go to a separate IndexedDB store and Cache Storage bucket.
   - Both are wiped on sign-out, on *Show 18+* off, and on account switch.
   - Mesh joins into an 18+ world need the joiner's door token.

### 1.2 Path-by-path

| Path | How it's stored and keyed today | Can it carry an 18+ tag today? | Change needed |
|---|---|---|---|
| **Library: Made / Sounds shelves** (models, sounds, music, voice; pictures are placed from Make) | genai `library` table keyed by `sha` (content hash). Columns: `kind`, `prompt`, `provider`, `creator` (a 6-character hash), `thumb`, `s3`, `removed_at`. No world, no rating (`server/genai-service/src/library.ts:36-52`). Listing is global: `listLibrary` filters only on prompt `LIKE`, kind and removed (`library.ts:268-274`). Proxied publicly by `/library` with CORS `*` and `public, max-age=15` (`server/sync-service/src/creations.ts:345-360`). The client shelf is "every model anyone has made" (`src/components/LibraryPanel.tsx:24-37,53-54`). | **No.** | **CODE:** add `rating` + `origin_world_id`. Filter `listLibrary` by viewer door and destination tier, which means passing the `worldId` and session through the sync proxy. Make the response `private`. Upgrade the tag on sha conflict. **Q:** should an 18+ world's Library show everyone items too? Proposed: yes. |
| **"Place from Library" / held item** | `HeldItem {kind:'model', sha, file, prompt, mindId?}` is kept in client memory and survives a world change (`src/stores/heldItemStore.ts:25-34`). Placement is a client CRDT write (`shared/actions.ts:52` `object.place`, offline: true). The server only judges ownership and keys (`shared/world-policy.ts:38,47`). | No | **CODE:** the server looks up the sha's rating at placement and refuses an adult asset into an everyone world *before* broadcast (`world-authority.ts:17-22` must change from apply-then-revert to pre-filter for this key). Clear the held item on entering an everyone world when it is adult. **Offline placements** (`offline: true`) replay later, so the server must re-check on upload and drop them. |
| **Make in a world, then carry elsewhere** | A Make job is world-less: `ref = create:<uuid>` and the body sent to genai has no `worldId` (`creations.ts:109,141`). | No | **CODE:** send `worldId` and the chosen model's adult flag with every job, and store both. A creation made in an 18+ world is adult even if the rater says "everyone"? **Q-C2** (proposed: yes, provenance taints). |
| **⧉ duplicate / copy** | `duplicateObject` copies every key except kick, carry, planKey, nudge and mind, within the same doc (`src/stores/worldStore.ts:564-595`; `shared/actions.ts:55`). | Only if the tag is a key on the object, and the client controls that copy. | **CODE:** the server derives the rating from `asset`, so a stripped flag doesn't matter. Duplicates stay in the same world, so the risk is low. The *copied* `prompt` and `text` fields are client-writable on first insert, so check them (see signs below). |
| **Signs / lore text, `prompt` field** | `text` and `prompt` are fixed after insert (`FIXED_MEDIA_KEYS`, `shared/world-policy.ts:47`). On first insert they are whatever the client wrote. Lore is checked at `/api/player/lore` (`creations.ts:256-274`), but nothing stops a client from writing arbitrary sign text straight into the CRDT. | No | **CODE:** the server checks or rates `text` and `prompt` on insert (this is a hole today too). An explicit sign in an everyone world is refused or flips the world (owner only). |
| **Portable minds: Save to Library / give a saved mind** (`93fbc94`) | `mind_library` (`id` = head node, `world_id`, `object_id`, `body`, `public_mind`). `mind_library_memory` holds a **snapshot of memories** (`server/sync-service/src/minds.ts:93-100,557-594`). Adopt copies the memories into the target world/object (`minds.ts:596-636`, notably `:628`). The shelf query has no filter (`minds.ts:681-683`). Public `GET /minds` and `/minds/:id` (`minds.ts:699-719`). The Library's Minds shelf "wakes up" bodies when they're placed (`heldItemStore.ts:28`, `src/lib/minds.ts adoptWhenPlaced`). | `world_id` is stored, so the tier is *derivable*. No rating column. | **CODE:** `rating` on `mind_nodes` and `mind_library`, adult if the persona was compiled in an 18+ world or with an adult model, or romantic/sexual framing is present. Refuse to adopt an adult mind into an everyone world. **Memories:** never copy memories from an 18+ origin into an everyone world, even for a non-adult mind (**Q-C3**). The `/minds` public endpoints filter by door. The body GLB carries its own sha rating (both must pass). |
| **Mind versions / branches** | `mind_nodes` with `parent`, `world_id` (`minds.ts:88-92`). A branch in an everyone world can descend from an 18+ node. | No | **CODE:** a node's rating = its own rating OR its parent's ("taint flows down"), unless a human re-rates it. **Q:** should a clean re-compile of an adult mind be allowed to become everyone? |
| **Portals and worlds-within-worlds** | A child world has `parentWorldId` (server-only meta) and `allowPortals` (`shared/crdt-schema.ts:109-112`; `shared/world-policy.ts:31`). Child portals render inside the parent with the child's **name** label (`src/components/WorldInterior.tsx:417-515`, label `:488-490`). Entering means stepping close and pressing N (`src/components/Scene.tsx:709-743`). Return portal: `universeStore.ts:360`. | No | **CODE:** the portal of an 18+ child inside an everyone parent is veiled like a planet (no name, *18+* mark, entry asks for the door). **Q-C4:** may an everyone world contain an 18+ child at all? Does an 18+ parent force its children 18+? Proposed: children may be stricter, never looser. An 18+ parent's children are 18+ unless the world is re-rated. A player inside an 18+ world who loses the door (toggle off) is moved out. |
| **Blueprints, planner history and restore** | `plan_sessions.blueprint` and `plan_events.payload` (JSON with the model used) (`server/sync-service/src/planner.ts:95-110`). Restore creates a new version. Ghosts preview blueprint items for visitors (`src/components/GhostPreview.tsx`). | `plan_events.model` is stored, so a rating is derivable for model-gated items. | **CODE:** blueprint items carry a rating. A blueprint or item "placed in another world" (planned in `phases/07-genai-creation.md:456`) follows the same rule as Library items. Restoring a version that held adult items into a world that has since been reset to everyone is refused, or re-flips the world. Ghost previews of adult items render veiled in everyone worlds (they shouldn't exist there anyway). |
| **World music in space** | The server mirrors each world's `music` / `ambientSound` file name into the **universe doc** (`shared/crdt-schema.ts:119-124`; `server/sync-service/src/rooms.ts:326-327,796`). The client crossfades the nearest 1–2 worlds. The decision says players without the door hear the seeded music instead. | No | **CODE:** don't mirror an 18+ world's music file name into the shared universe doc. Serve it only to door-holders (signed URL). Otherwise the client "swap" is cosmetic and the file is one fetch away. Music is instrumental today (`phases/07:485`), so the risk is lower, but lyrics are planned (Studio). |
| **Thumbnails and the World Index** | Library thumbnails `<sha>.png` are client-uploaded, first-write-wins, with no content check (`server/sync-service/src/trash.ts:47-66`; `server/genai-service/src/index.ts:292-318`) and cached in `localStorage` per sha (`src/lib/libraryThumbs.ts:92-100`). World Index entries store per-account state (`server/sync-service/src/identity.ts:44`). Card art is the orb render or a photo. Visited worlds "flip to full art" (`ROADMAP.md:602-628`). | No | **CODE:** **P0** server-side check of every uploaded thumb (hard lines + rater), or render thumbnails server-side. A thumb inherits the asset's rating and lives on the adult prefix if the asset is adult. The World Index shows a veiled card (no name, no art) for 18+ worlds when the viewer lacks the door, even if they visited before. **Q:** what if someone visited with the door, then turned it off? Proposed: veiled. |
| **Card art and photo mode** | Photo-mode shots are kept on the device per world (`src/stores/photoStore.ts`, `byWorld`). Checkout sends a JPEG data URL plus a `worldId`; the server checks size and shape and the world name only ("no automatic image check yet") (`server/sync-service/src/cards.ts:22-27,85-96,173-201`; `src/components/CardCheckout.tsx:59-61`). | No | **CODE:** refuse checkout for 18+ worlds (Decision 9). Run the image hard-line check plus the rater on the photo; the photo can come from anywhere, since nothing binds it to the world. Re-check the world's tier at the admin `paid → approved` step and at print time. Event orders (`cards.ts:223`, `/api/admin/cards/event`) and card sets (`card-sets.ts`) must refuse 18+ worlds too. Photo mode inside an 18+ world: the photo stays on the device, and the "Use on a card" button is hidden (`src/components/WorldIndex.tsx:110,358-361`). |
| **Story stone** | `GET /making-of?worldId=` is public with `Cache-Control: public, max-age=5` (`server/sync-service/src/making-of.ts:125`), built from `plan_sessions` / `plan_events`. | No | **CODE:** door check when the world is 18+ (Decision 11). Make it `private` so a CDN or proxy can't serve it to someone else. Shown only inside the world, but the endpoint is public by id. |
| **Chat spanning worlds / space** | World chat lives in each world doc plus `chat_messages(world_id, …)` (`server/sync-service/src/rooms.ts:1178-1190`). **Space chat** is universe-wide, held in memory and sent to everyone flying (`rooms.ts:84,214`; `public/privacy.html:45`). NPC lines go through world chat. | World-scoped, so derivable. | **DOC/CODE:** space chat and Origin are everyone spaces, so the everyone rules apply there (state it in Terms). World chat in 18+ worlds can relax the profanity mask (`shared/chat.ts`). Hard lines still apply. **Q:** do mind voices (spatial audio) heard from outside a world exist? Today they don't. |
| **Research exports** | Archive calls are keyed by `researchId` (`server/sync-service/src/research.ts:1-15`; `server/genai-service/src/library.ts:212-217`, `archive/calls/Y/M/D`). `plan_sessions.research_id`. | No flag | **CODE:** stamp the `adult` flag on every archive record and plan session. Hard-line records go to a quarantined store with legal-hold rules, not the research archive. Exports exclude or segregate adult content per consent (§7). |
| **CDN / S3 asset URLs** | `s3://…/models/<sha>.glb` and `media/<sha>.*` are public through CloudFront (`library.ts:8-9`; `infra/cloudformation-assets.yml:46-111`). `/assets/<sha>` is proxied with `immutable` and a 1-year cache (`creations.ts:311-338`; genai `index.ts:342-370`). sha256 names aren't guessable, but they are shareable and appear in the public universe doc, world docs and `/library`. | No | **CODE:** an adult prefix behind signed URLs or cookies. No `immutable` on adult files, so a re-tag can take effect. CloudFront invalidation on re-tag or removal. **Q:** what about everyone assets that are later re-tagged adult and already cached at the edge or on devices for a year? Proposed: short max-age (5 min) on everything served through the redirect, and move the object to the adult prefix. |
| **Offline / PWA / mesh caches** | IndexedDB `aweborn-offline` keys: `universe`, `world:<id>`, `pending:`, an LRU (`src/lib/offlineCache.ts:26-31,244`). The service worker caches `<sha>.glb/png` cache-first (`public/sw.js:59-62,97-105`). Mesh syncs the active world doc to peers, with a host relay (`src/lib/mesh.ts:1-20`). The server auto-pairs screens in the same world and IP (`server/sync-service/src/mesh-intro.ts:1-20`). | No | **CODE:** keep 18+ docs and assets in a separate store; wipe it on sign-out, toggle-off and account switch. The service worker never caches adult-prefix URLs. Mesh: the host refuses to sync an 18+ world to a peer without a door token (the server mints a short-lived token via mesh-intro, and QR pairing can carry it). **Offline door:** remember the door per account on the device, and require an online check at least every N days. |
| **Search** | Library `?q=` matches prompt text (`library.ts:269`). `/players/names` lookup (`server/sync-service/src/index.ts:868`). No world search yet. | No | **CODE:** search obeys the same filters. Prompts of adult items are content too: never returned to non-door viewers. Future world search excludes veiled names. |
| **Universe map / world names** | `WorldEntry.name`, `color`, `music` are in the shared universe Y.Doc, which isn't sector-filtered (`phases/08-nfc-trading-cards.md:86`), and are cached offline. Labels: `src/components/UniverseWorlds.tsx:169`. | No | **CODE (architecture):** split veiled fields out of the CRDT (a per-viewer `world-public-info` channel), or keep the name server-side for 18+ worlds and put a placeholder in the shared doc. The universe CRDT can't be filtered per client in Yjs without separate docs. |
| **`/w/<uuid>` links + `GET /worlds/:id`** | Public resolve with `public, max-age=30/60` (`index.ts:84-138`). | No | **CODE:** return a veiled result (position + `adult: true`, no name) to non-door viewers. The client shows "sign in and turn on 18+". |
| **Shooting stars / mana status** | `lastCard: {worldId, name}` is public (`server/sync-service/src/mana.ts:228`). Creation draws are categorized. | No | **CODE (low):** never name an 18+ world in public mana data. Cards from 18+ worlds can't exist, but a world can turn 18+ after its card. |
| **Reports / admin** | Report reasons `harassment, hate, sexual, spam, personal_info, other` (`server/sync-service/src/moderation.ts:19`; `src/components/PlayerActions.tsx:9`). Admin pages render the reported text and images (`public/admin-reports.html:108`, `admin-trash.html`, `admin-cards.html:177`). | n/a | **CODE:** new reasons: "wrong tag (should be 18+)", "minor", "real person / deepfake" (48-hour TAKE IT DOWN clock), "doxxing", "violent extremism", "self-harm". Admin views blur adult or hard-line media by default (reviewer wellbeing). Hard-line items never render in admin. They are hashed and quarantined. |
| **Email / receipts** | Card order emails (`cards.ts:320`), donation receipts (Lambda). | n/a | **DOC/CODE:** never mention 18+ (Decision 9). Already true; keep a test. |
| **Steer / second screen, device link** | "One screen steers" + QR device link (`phases/ROUGH_DRAFT.md:38,78`). | n/a | **Q:** a steered TV in a shared room is a public display. Proposed: an 18+ world never renders on a steered screen unless that screen's own session has the door. |
| **agent-runner** | Cron LLM agents (`server/agent-runner/src/`). | n/a | **Q (low):** if any agent ever reads world content, it reads only everyone worlds. |

### 1.3 Places the tag can be lost (flagged)
- **Content addressing with `INSERT OR IGNORE`** (`library.ts:167,202,231`): a second, adult-made copy of identical bytes keeps the first row's (everyone) tag.
- **Rig / remesh** (`server/genai-service/src/rig.ts:6-15,139-161`): produces a new sha from `stillAsset`. It must inherit the source's tag (and `PlacedObject.stillAsset` must keep pointing at a tagged source).
- **Web-optimized copies** (`opt/`, `server/genai-service/src/library.ts:127`; `providers.ts:182` remesh-web): same sha, different file. Make sure the CDN path (`models/opt/`) is under the same gate.
- **Thumbnails** (`<sha>.png`): a separate file. It must follow the GLB's tag and prefix.
- **Future image-to-3D, texture, terrain-piece and re-export jobs:** the derived job must record `source_sha` and inherit.
- **Mind adopt / branch:** a new node with a parent. It inherits.
- **Duplicate:** if the tag were an object key, a client could drop it. Derive it on the server instead.
- **Backfill** (`library.ts:224-240`): re-imports files with no tag. It must default to `unknown`, then run the rater.
- **Offline placements replayed later:** checked at upload.
- **Blueprint item `prompt` re-generated by "redo"** (`replaceModelAsset`, `worldStore.ts:597`): the new asset gets its own tag. The world's tier doesn't relax automatically.

---

## 2. Company / legal docs

| P | File:line | Says now | Conflicts with | Change |
|---|---|---|---|---|
| P0 | `public/terms.html:52` | "Don't ask for anything sexual, hateful or gory, real people, or other people's characters…" | Decisions 2, 5, 6, 7 | **DOC:** replace with the hard-line list + "sexual content only in 18+ worlds, stylized only" + the rater. Keep IP and hate? (**Q-L1**: the decisions' hard lines don't mention hate speech or IP. Terms ban both. Proposed: keep both as rules everywhere, outside the hard-line list.) |
| P0 | `public/terms.html:54` | Minds: "nothing sexual or hateful" | Decision 10 | **DOC:** romantic or sexual minds allowed in 18+ worlds, with care rules (AI disclosure, never a real person, steps out of character in a crisis). |
| P0 | `public/terms.html:29,71` | "18 or older… some may contain mature content"; "Mature content… we may restrict where it appears." | Decisions 1–3 | **DOC:** describe everyone vs 18+ worlds, the door (sign-in + birthdate + toggle; an age check where the law requires it), and veiled planets. |
| P0 | `public/terms.html:65` | Bans sexualising minors "in any form" | Decision 7 (agrees) | **DOC:** add "in any art style, judged by apparent age"; deepfakes; doxxing; mass-harm uplift; promoting real violence; NCMEC reporting. |
| P0 | `public/terms.html` "Moderation" (≈ line 74) | "Where we can, we'll explain why. If you think we got it wrong, contact us." | Decision 12 | **DOC:** a human appeal always, a written reason, the public anonymous action log, the quarterly report. |
| P1 | `public/terms.html:33-34,56` | Anonymous play; anyone can enter worlds without signing in | Decision 3 | **DOC:** 18+ worlds need sign-in; anonymous players see them veiled. |
| P1 | `public/terms.html` licence (≈ line 40) | "show it when we promote Aweborn (for example in screenshots or on trading cards)" | Decision 9 | **DOC:** never adult content in promotion or on cards. |
| P0 | `public/privacy.html:28-52` | No birthdate, age-estimate selfie, *Show 18+* preference or 18+ flag on creations | Decision 3 | **DOC (before code):** what's collected, why, how long. Selfie: vendor-side only? Biometric laws (Illinois BIPA, Texas) apply. **Q-L2:** age-estimate data retention. |
| P0 | `public/privacy.html:75-83` | Processors list | Decisions 3, 5, 7 | **DOC:** the age vendor, the adult-capable model providers (and whether their zero-data-retention status differs), NCMEC (a disclosure required by law), the hash-matching vendor (PhotoDNA or similar). |
| P0 | `public/privacy.html:63-72` | Research uses everything disclosed | Decision 11 + GDPR Art. 9 | **DOC/Q:** see §7. |
| P1 | `public/privacy.html:38-39` | Planner conversations are public at the story stone | Decision 11 | **DOC:** "…for 18+ worlds, only to players who opened the 18+ door". |
| P1 | `public/privacy.html:108-109` | "meant for people 18 and older. We don't knowingly collect from children" | Decision 1 (agrees) | **DOC:** add what happens when a minor is found (account closed, data deleted, except hard-line material kept as the law requires). |
| P1 | `public/privacy.html:45` | Space chat goes to everyone in the universe | Containment | **DOC:** space and Origin follow everyone rules. |
| P0 | `RESEARCH.md:40-46` | "Disclosed, no consent form"; "Adults… clear of COPPA" | Decision 11 | **DOC/Q:** see §7. |
| P1 | `docs/BUSINESS_PLAN.md:13` | Mission: research into humane work and teams | Alex's quote: "find oneself through creation… explore our shadows" | **Q-L3:** does adult content serve the 501(c)(3) exempt purpose? Explicit content needs a mission rationale (exploring the self through creation), or the board and lawyer must accept it as incidental. Write it down; grant reviewers will ask. |
| P1 | `docs/BUSINESS_PLAN.md:84` | "Card taps and `/w/` links are never gated." | Decision 3 | **DOC:** "…except 18+ worlds, which need the 18+ door. No card is ever printed from an 18+ world." |
| P1 | `docs/BUSINESS_PLAN.md:93-94` | Organizations: "events, schools and companies sponsor worlds + card runs"; grants from arts, education and workplace research | Decision 1 (18+ only) + reputation | **DOC/Q-L4:** schools contradict "18+ only" already. Remove them, or note "universities only". Many education and arts funders, and corporate sponsors, exclude platforms hosting sexual content. Make a funder-risk note and a disclosure plan; sponsored worlds are everyone worlds. |
| P1 | `docs/BUSINESS_PLAN.md:154` | Research: opt-in for personality modelling, IRB | Decision 11 | **DOC:** add the 18+ data segregation. |
| P1 | `docs/BUSINESS_PLAN.md` §9 tax/risk (≈ lines 147-151) | Risks list | Decisions 9, 12 | **DOC:** add payment-processor risk (Stripe restricted businesses, the Steam/itch 2025 precedent), age-verification law exposure, NCMEC and TAKE IT DOWN obligations, the cost of trust-and-safety staffing (a human appeal *always* is a people cost), and insurance. |
| P1 | `TRADEMARKS.md:18-19,25` | "Run an unmodified copy"; can't name a fork anything "confusingly similar" | Federation note: *"forked into a Darkborn"* | **DOC/Q-L5:** "Darkborn" is arguably confusingly similar (same `-born` mark, same audience). Decide whether that name is fine or say "pick a distinct name". An unmodified copy run by others with adult content could be mistaken for Aweborn. Require a visible "not the official Aweborn" notice. |
| P2 | `PLAN.md:7`, `README.md` | Product description, no audience | Decision 1 | **DOC:** one line: "18+; some worlds are 18+ only". |
| P2 | `AGENTS.md:13-14` | Privacy before new collection | — | Already the rule. The checklist item "Terms, Privacy and RESEARCH.md change in the same push" matches. |
| P2 | `MASTER_PLAN.md` | No mention | — | **DOC:** add a "Trust & safety / 18+ worlds" workstream row (owner, status, lawyer pass). |
| P1 | `public/giving.html:78`, `src/components/DonationModal.tsx`, `DonationPortal.tsx` | "No mana of your own, no abilities…" | Decision 9 (agrees) | **DOC:** add "donations never unlock 18+ content" only if a lawyer agrees it helps; the decision says donation pages *never mention* 18+. **Q-L6:** these two pull against each other. Proposed: say nothing. |

---

## 3. Economy & cards

| P | File:line | Now | Decision | Change |
|---|---|---|---|---|
| P1 | `server/sync-service/src/cards.ts:173-201` | Checkout checks the world exists and its name passes safety | Decision 9 | **CODE:** refuse when the world is 18+ (and when it's veiled for this buyer). Re-check at approve and print. |
| P1 | `server/sync-service/src/cards.ts:223` + `card-sets.ts` + `public/admin-cards.html` | Admin event orders and sets take any `worldIds` | Decision 9 | **CODE:** the same refusal; show the tier in admin. |
| P1 | `server/sync-service/src/cards.ts:22-27,85-96` | "no automatic image check yet" on photo art | Decision 7 | **CODE:** image hard-line check + rater on every photo. |
| P1 | `ROADMAP.md:692-698` (card invariants) + `:592` + `:952` "Card/link arrival is never gated" + `:819` "always deliver a player inside a world" | Printed cards resolve forever and land inside | Decision 3 | **DOC + Q-E1:** a world that turns 18+ *after* cards were printed. Options: (a) the owner can't flip a world that has printed cards (it stays everyone, and adult items are refused); (b) the card lands the player at the veiled world outside; (c) a fork: the card world stays everyone and the 18+ content moves to a child world. Proposed: (a), simplest and printed cards stay honest. |
| P1 | `ROADMAP.md:136,641-659`; `phases/08-nfc-trading-cards.md:19,26-27` | Event cards, stickers at conferences and meetups | Decisions 8, 9 | **DOC:** event worlds are everyone worlds. **Q-E2:** at a physical event, people's screens are visible to others in the room. Should *Show 18+* turn itself off (or hide veiled planets' marks) while the player is in a mesh or event group? Proposed: the mesh group flag hides 18+ worlds unless every peer has the door. |
| P1 | `phases/05-mana-economy.md`, `MANA_COSTS.md:38-39`, `shared/make-costs.ts` | Mana costs per kind; minds ≈ 1.1 mana | Decision 9 (adult gens from the shared pool) | **DOC/Q-E3:** adult-capable models (often pricier image or video) need cost rows. Should adult generations have a separate daily cap, so 18+ can't drain the creative share and the share stays visible in the quarterly report? Shooting stars for adult draws: a separate category, or the same `creations`? Proposed: same category (no stigma), with the share counted in the quarterly report only. |
| P2 | `server/sync-service/src/mana.ts:228` | Public `lastCard` names the world | Containment | **CODE (low):** suppress the name if that world is now 18+. |
| P1 | Stripe (`infra/stripe-webhook.sh`, `CONFIG.md:77`, `PLAN.md:14,37`) | Stripe for donations and cards | Decision 9 | **Q-E4:** confirm with Stripe *before* launch (Stripe's restricted-business list covers adult content and services, and a platform hosting it may be reviewed even if it doesn't sell it). Line up a backup processor in advance, not after an objection; a freeze would stop both donations and cards. |
| P2 | `ROADMAP.md:793-826` Experience and levels | Awe events: `first-world-visit`, `first-creation-seen`, reactions | — | **Q-E5:** should 18+ worlds give awe/XP and push the Frontier? Proposed: yes (no stigma), but the level ladder never *requires* an 18+ world, and tutorials and onboarding are everyone worlds. |

---

## 4. Universe & map

| P | File:line | Now | Decision | Change |
|---|---|---|---|---|
| P0 | `shared/crdt-schema.ts:74-125` (`WorldEntry.name`, `music`, `ambientSound`, `color`); `phases/08-nfc-trading-cards.md:86` "universe doc is not sector-filtered" | Every client gets every world's name and music | Decision 8 | **CODE (architecture):** add `adult: boolean` (server-written). For 18+ worlds, keep `name` and `music` out of the shared doc (empty or placeholder) and serve them per viewer. Add both to `SERVER_ONLY_META_KEYS` handling (`shared/world-policy.ts:31`). |
| P1 | `src/components/UniverseWorlds.tsx:169` (label), `phases/03-universe-rendering.md:34` (close LOD: label, halo, ring) | The name label shows on approach | Decision 8 | **CODE:** veiled render: a shimmer, an *18+* mark, no label. Tap → "sign in and turn on 18+ to enter". |
| P1 | `src/audio/music/director.ts`, `src/components/MusicDriver.tsx`, `shared/music.ts` | Nearest worlds play their music; seeded from the world id otherwise | Decision 8; `phases/07:485` | **CODE:** non-door players get seeded music for 18+ worlds (the seed comes from the id, so nothing leaks). Planner music is fetched only behind the door. |
| P1 | `src/stores/worldIndexStore.ts:41,366`, `src/components/WorldIndex.tsx`, `WorldCard.tsx` | Sightings, visited art, warp to any entry | Decision 8 | **CODE:** veiled cards. World Index Warp to an 18+ world asks for the door. |
| P1 | Frontier / ghost (`server/sync-service/src/frontier.ts`; `ROADMAP.md:370`) | Ghost worlds are wireframes outside the Frontier | Decision 8 | **Q-U1:** an 18+ ghost world: veil *and* wireframe? Proposed: both looks (wireframe shimmer). Origin's "home theme" stays everyone. |
| P0 | Origin (`server/sync-service/src/rooms.ts:287`, `ORIGIN_WORLD_ID`) | Origin has no interior; it's where new players and card taps arrive | Containment | **DOC/CODE:** Origin and the area around spawn are always everyone. **Q-U2:** may an 18+ world be planted (or resolved) right next to Origin, where every newcomer sees the shimmer first? Proposed: a minimum distance from Origin for 18+ worlds (the resolver in `server/sync-service/src/resolver.ts`). |
| P1 | `src/components/PlantWorldPanel.tsx`, `server/sync-service/src/world-create.ts` | Plant a world (or a child world) | Decision 2 | **CODE:** an "18+ from the start" toggle at planting (owner only). A child inherits per Q-C4. |
| P2 | `index.html:32-38` OG tags, `/w/<uuid>` share previews | A static OG image | Containment | **CODE/Q:** if per-world OG previews are ever added, 18+ worlds get a generic veiled preview. |

---

## 5. Worlds & creation (code prompts included)

| P | File:line | Now | Decision | Change |
|---|---|---|---|---|
| P0 | `server/sync-service/src/safety.ts:32-45` `SAFETY_SYSTEM` | "an all-ages game"; blocks sexual, suggestive, nudity, gore, self-harm, real people, IP, personal info | Decisions 4, 5, 7 | **CODE:** split into (1) a **hard-line classifier**: apparent minor in any style, real person sexual, doxxing, mass-harm uplift, self-harm *methods*, promoting real violence; (2) a **rater** that returns everyone/adult; (3) world rules: IP, hate, which the decisions don't list (Q-L1). Pass the world's tier in. Publish the prompts (Decision 12). |
| P0 | `server/sync-service/src/safety.ts:25-26,46-56,105` categories + messages | `sexual`, `gore` as refusals | Decision 4 | **CODE:** in an 18+ world, `sexual` and `gore` re-tag rather than refuse. New hard-line categories `minor`, `deepfake`, `mass_harm`, `violent_extremism`. |
| P0 | `server/sync-service/src/safety.ts:1-13` | **Fails open** if the classifier is down | Decision 7 | **CODE:** fail **closed** for adult models and for every image or 3D output check. Everyone-model prompts may keep failing open with the local list (Q-W1). Log outages for the quarterly report (Decision 12). |
| P0 | `server/sync-service/src/safety.ts:98` "Verdicts are cached by text" | The cache keys on text only | Decision 4 | **CODE:** key the cache by (text, world tier, check version). |
| P0 | — (missing) | No output checks on pictures or GLBs | Decisions 5, 6, 7 | **CODE:** after every generation, render the thumbnail server-side → apparent-age, real-person and photoreal-explicit checks (Decision 6: stylized only) → hash-match (PhotoDNA/CSAI) → only then does the library row go live. Today the asset is live as soon as the job finishes (`server/genai-service/src/index.ts:132`). |
| P0 | `server/sync-service/src/planner.ts:71` | "Safety: nothing sexual, hateful, or gory" | Decisions 2, 5 | **CODE:** tier-aware planner rules. Blueprint items carry a rating. The planner tells the maker when an item would make the world 18+. |
| P0 | `server/sync-service/src/planner.ts:37-45` `PLANNER_MODELS` + `/api/player/plan/models` (`index.ts:494`) | A fixed list of 7 models, all mainstream | Decision 5 | **CODE:** this is the seed of the public model menu. Add `adult: boolean`, provider, data-retention status and price per entry, for text, image, 3D and voice, and publish it on aweborn.org. Picking an adult model tags the creation and requires the door and an 18+ world. |
| P0 | `server/sync-service/src/creations.ts:256` lore prompt | "Wholesome and all-ages" | Decision 2 | **CODE:** tier-aware. |
| P0 | `server/sync-service/src/creations.ts:109,141`; `server/genai-service/src/index.ts:239-269` | Jobs carry no world, model choice or rating | Containment | **CODE:** add `worldId`, `model`, `rating`, `source_sha`. |
| P1 | `server/genai-service/src/providers.ts`, `media.ts`, `rig.ts` | Meshy (text-to-3D, remesh, rig), MAI image, ElevenLabs | Decision 5 | **Q-W2:** which adult-capable 3D, image and voice providers exist (checklist item 1)? Meshy, ElevenLabs and most mainstream image APIs refuse explicit content. Animating an adult model through Meshy's rig may break their terms. |
| P1 | `public/terms.html:56`; Make UI (`src/components/CreatePanel.tsx`, `MakeTabs.tsx`, `PlannerPanel.tsx`) | AI tools for signed-in players | Decisions 3, 4, 5 | **CODE:** a model picker with the menu; a "this is 18+" maker tag; adult models hidden unless the door is open and the world is 18+ (or the maker confirms the world flips). An anonymous / named choice per creation is still to be grilled (`phases/07:506-513`). |
| P1 | `shared/world-policy.ts`, `world-authority.ts:17-22` | Owners and co-creators can change anything; others add | Decision 2 | **CODE:** only the world creator can flip a world to 18+ or back. **Q-W3:** can a world go back from 18+ to everyone once its adult items are gone? Proposed: owner-initiated plus an automatic re-scan; the story stone is re-gated retroactively? |
| P1 | Rules & goals design (`phases/07:569-597`) | "Text actions get the same safety check as lore" | Decision 4 | **DOC:** text actions are rated in the world's tier. |
| P2 | `phases/07-genai-creation.md:417` | "platform rules (AI disclosure, all-ages, crisis line)" | Decision 10 | **DOC:** "AI disclosure, the world's tier, crisis line". |
| P2 | `phases/07-genai-creation.md:485` | "players outside its tier hear seeded music" | Decision 8 | **DOC:** "players without the 18+ door". |
| P2 | `ROADMAP.md:866` | "Once worlds are age-tiered, players outside a world's tier…" | Decision 8 | **DOC:** same rewording. |
| P2 | `phases/README.md:215` | "Age-tiered worlds… a 13+ teen bracket; younger brackets" + the anchor `#age-tiered-worlds-not-all-ages` (the heading no longer exists, so the link is broken) | Supersedes | **DOC:** rewrite to the 11-07 decisions and fix the link. |
| P2 | `phases/README.md:62` | Summary of the grill | — | Fine; add "containment requirement (Alex)". |

---

## 6. Minds

| P | File:line | Now | Decision | Change |
|---|---|---|---|---|
| P0 | `server/sync-service/src/minds.ts:257,270` `PERSONA_SYSTEM` | "all-ages universe… nothing sexual… no romance or companion framing" | Decision 10 | **CODE:** two variants by world tier. The 18+ variant allows romance and sexuality within the hard lines. The persona must state an adult age and must not read as a minor, or be a real person. |
| P0 | `server/sync-service/src/minds.ts:742-743` reply rules | "fictional character in an all-ages game… Nothing sexual" | Decision 10 | **CODE:** tier-aware reply rules. Always: AI disclosure; never claim to be human or a real person; step out of character with crisis resources on real distress (CA SB 243: disclosure at start + every 3 hours for known minors (n/a), suicide-prevention protocol, annual reporting to the Office of Suicide Prevention from 2027). **Q-M1:** do SB 243's reporting and protocol duties apply to Aweborn as an "operator"? Lawyer. |
| P0 | Persona and reply model (Sonnet 5.5, Haiku 5.5; `phases/07:405-412`; `npc-brains.md:82` cites the Anthropic AUP) | Anthropic models | Decision 5 | **Q-M2:** sexual roleplay needs an adult-capable model and provider; the Anthropic AUP restricts sexually explicit generation. The menu must route 18+ minds to a permitted model. Safety and rating can stay on a classifier model. |
| P1 | `server/sync-service/src/minds.ts:75-78` `mind_memory` (6 facts per player) | Memories per (world, object, player) | Decision 10 + containment | **CODE:** memories from 18+ worlds never travel to everyone worlds (§1.2). **Q-M3:** intimate memories are sensitive personal data, so retention, deletion and the research export need rules. |
| P1 | `server/sync-service/src/minds.ts:557-636`, `public/terms.html:54` (Nov 6 Save to Library) | A saved mind is public with every version and who wrote it | Decision 11 + containment | **CODE/DOC:** an adult mind's history is visible only behind the door. Terms add this. |
| P1 | `phases/07-genai-creation.md:428` "Report a mind's line / persona" (open task) | Not built | Decision 12 | **CODE:** ship it with 18+. Reports feed the action log. |
| P2 | `docs/research/2026-11-life-and-minds/npc-brains.md:73,81-90,140`; `README.md:45` | `rating: everyone|teen`; "Default to teen… no romance" | Superseded | **DOC:** add a note at the top: superseded by the 2026-11-07 decisions (keep the research as history). |
| P2 | `docs/research/2026-11-life-and-minds/audio.md:90` | ElevenLabs: no child-like voices; moderate before TTS | Decision 7 | **DOC/CODE:** TTS of 18+ lines needs a provider that allows it. Never use child-like voices for any adult mind (and the voice picker in `shared/life.ts` should exclude them in 18+ worlds). |

---

## 7. Research & data

| P | File:line | Now | Decision | Change |
|---|---|---|---|---|
| P0 | `RESEARCH.md:40` principle 1 "Disclosed, no consent form" | Telemetry without consent | Decision 11 | **Q-R1 / DOC:** sexual content and interactions with sexual minds reveal "sex life or sexual orientation" (GDPR Art. 9, CPRA "sensitive personal information"). Options: (a) separate explicit opt-in for using 18+ activity in research; (b) exclude 18+ content from research by default and keep it only for operations and safety. Proposed: (b) by default, (a) as an opt-in. Update principle 3 ("Minimal") as well. |
| P0 | `RESEARCH.md:45` principle 6 IRB | De-identified gameplay is "usually exempt" | Decision 11 | **DOC:** 18+ data is unlikely to be exempt. Tell the university partner (UMD?) up front. |
| P1 | `server/sync-service/src/research.ts:1-15`; `server/genai-service/src/library.ts:212-217` | The archive keeps every call, keyed by research ID; delete only unlinks | Decisions 7, 11 | **CODE:** an `adult` flag on records. Hard-line requests and outputs never enter `archive/calls`; they go to a legal-hold store (18 U.S.C. § 2258A(h): preserve 1 year after a report since the REPORT Act 2024; confirm with counsel), access-logged, then destroyed. **Q-R2:** "anonymous creation shows the research ID" (`phases/07:508-513`) would link anonymous 18+ creations to a person's everyone creations. Use a per-creation pseudonym, never the research ID. |
| P1 | `public/privacy.html:90` retention | Research kept until deletion | Decision 7 | **DOC:** the legal-hold exception for hard-line content. |
| P1 | `server/sync-service/src/safety.ts:68-90` `safety_flag` table (player id + text) | Every block is kept with the player id | Decision 12 | **CODE:** the source for the public anonymous action log and the quarterly report. Needs a rule column, an outcome, appeal fields and a world tier. |
| P2 | `docs/research/2026-11-adult-models/research_notes/Adult capable models for Aweborn/` (empty), `reports/` (empty) | — | Checklist item 1 | Fill before the menu exists. |

---

## 8. Social / chat

| P | File:line | Now | Decision | Change |
|---|---|---|---|---|
| P1 | `shared/chat.ts`, `server/sync-service/src/rooms.ts:1178-1190`, `chat-guard.ts` | One language filter and mask for all worlds | Decision 2 | **CODE/Q-S1:** relax the profanity mask in 18+ worlds? Proposed: yes, with hard lines enforced on chat too (doxxing, threats, minors). |
| P1 | `rooms.ts:84,214` space chat | Universe-wide | Containment | **DOC/CODE:** everyone rules. |
| P1 | `server/sync-service/src/moderation.ts:19`; `src/components/PlayerActions.tsx:9`; `public/admin-reports.html` | Report reasons; admin review with no appeal flow | Decision 12 | **CODE:** new reasons, "wrong tag", the appeal path (a written reply), the action log feed, a TAKE IT DOWN 48-hour queue. |
| P1 | — | Voice chat (future, `phases/07:484`) | Decisions 7, 10 | **Q-S2:** voice chat in 18+ worlds is live, unrecorded content that can't be output-checked. Grill it before building. |
| P2 | Golden wave donor names, player names (`shared/names.ts`) | Names are public | Decision 7 | **CODE:** the name filter keeps the everyone rules everywhere (names are shown in space). |

---

## 9. Offline / mesh / infra

| P | File:line | Now | Decision | Change |
|---|---|---|---|---|
| P0 | `infra/cloudformation-assets.yml:57-64` (versioning, 30-day noncurrent), `:46-111` CloudFront OAC | Purge leaves noncurrent versions for 30 days; edge caches | Decision 7 | **CODE/runbook:** a hard-line purge deletes all versions and invalidates CloudFront, except the legal-hold copy. |
| P0 | `infra/cloudformation-backups.yml:19-52`; `infra/backup/*`; HANDOFF backups (`HANDOFF.md:270`) | Hourly DB backups, retention days, versioned | Decision 7 | **Runbook:** backups will hold 18+ and possibly hard-line rows. Document the legal hold, who can access backups, and the redaction-on-restore step (`infra/restore-from-s3.sh`, `test-dr-restore.sh`). |
| P1 | Hosting (AWS Lightsail + S3 + CloudFront, `PLAN.md`, `HANDOFF.md:38-48`) | AWS | Decision 5 | **Q-I1:** AWS's acceptable-use policy allows legal adult content; confirm. Hosting in the US means NCMEC duties apply; the UK Online Safety Act applies to UK users regardless. |
| P1 | `public/sw.js:7-8,59-62,97-105` | Cache-first for every `<sha>.glb/png` | Containment | **CODE:** exclude the adult prefix; separate cache; purge on sign-out or toggle-off. |
| P1 | `src/lib/offlineCache.ts:26-31,190-244` | `universe` + `world:<id>` + an LRU of docs in IndexedDB, per device not per account | Containment | **CODE:** a separate store for 18+ docs, keyed by account; wiped on sign-out. The cached universe must not hold veiled names (see §4). |
| P1 | `src/lib/mesh.ts:1-20`; `server/sync-service/src/mesh-intro.ts:1-20`; `phases/06-offline-mesh.md:31,36` | Hub relays the active world doc and presence to peers in the same world and IP | Containment | **CODE:** the server only introduces peers into an 18+ world when both hold the door. QR (manual) pairing needs a door token in the offer. A host that moves into an 18+ world stops syncing it to non-door peers. |
| P2 | `phases/ROUGH_DRAFT.md:38,78` device link / one screen steers | A second screen follows | Containment | See §1.2 (steered screens). |
| P2 | `infra/k3s/caddy-ingress.yaml:10-35` | api.aweborn.org is health-only; sync proxies everything | — | Fine: the gate belongs in sync-service. |

---

## 10. Sign-in, settings, door (new code surface)

| P | Where | Change |
|---|---|---|
| P0 | `server/sync-service/src/auth.ts` (Better Auth, anonymous plugin; `phases/08:112`) | Birthdate on the account (not per character), the *Show 18+* flag, a `door_opened_at`, and an age-check result (vendor reference only). Server-enforced everywhere, never a client flag. **Q-D1:** per account or per character? Proposed: per account (age is a person fact); the toggle can be per character. |
| P0 | Jurisdiction | Geolocation or self-declared country to decide where the selfie check is required (UK OSA; US states with "one-third" laws: Texas, Utah, Louisiana, Virginia, etc.; confirm the list). **Q-D2:** IP geolocation versus declared residence; VPNs. |
| P1 | `docs/mobile-ui/SPEC.md:76` ("••• More → Settings"), `src/components/DisplaySettings.tsx`, `PlayerAccount.tsx` | The *Show 18+* toggle and birthdate entry live here (portrait, 44 px, safe areas per AGENTS.md). |
| P1 | Lying about age | **Q-D3:** what happens when a report says "this player is a minor"? Suspend the door, require the selfie check, close the account if confirmed. Write it into Terms. |

---

## 11. Cross-cutting questions the decisions don't answer yet

**Containment and worlds**
- **Q-C1 Re-tag fallout:** an everyone asset re-tagged adult that's already placed in 40 everyone worlds. Do those worlds flip to 18+ (penalizing owners who did nothing), or are the objects removed or hidden there? Proposed: hidden in everyone worlds (a tombstone "removed: rated 18+"), and the owner is told.
- **Q-C2 Provenance taint:** is everything made *in* an 18+ world adult by default, even a teapot? Proposed: yes for placement elsewhere (strict containment), with a human or rater re-rate path to "everyone".
- **Q-C3 Mind memories:** never carry memories from an 18+ origin into an everyone world, even for a clean mind?
- **Q-C4 Portals and recursion:** can an everyone world contain an 18+ child portal (veiled)? Does an 18+ parent make its children 18+? Can an 18+ world contain an everyone child?
- **Q-C5 Griefing:** can a visitor (not the owner) ever flip a world by placing an adult item? Proposed: never. Visitors' adult items are refused in everyone worlds.
- **Q-C6 Co-creators:** may builders (`coCreators`) flip the tier, or only the creator?
- **Q-W3 Back to everyone:** may a world go back from 18+ to everyone? What happens to its gated story stone history and visitors' World Index cards?

**Cards, events, physical spaces**
- **Q-E1** Worlds with printed cards that later want to become 18+.
- **Q-E2** Physical rooms (card events, meetups, a steered TV, mesh groups): hide 18+ world marks and content while other people can see the screen?

**Economy and progression**
- **Q-E3** A separate daily cap for adult generations? A separate star category?
- **Q-E4** Stripe pre-clearance and a backup processor now, not later.
- **Q-E5** Awe/XP from 18+ worlds; levels never require them; onboarding stays in everyone worlds.

**Universe**
- **Q-U1** Ghost plus veil look.
- **Q-U2** A minimum distance between 18+ worlds and Origin / spawn.
- **Universe doc redesign:** the per-viewer side channel for veiled names and music (a decision on architecture, not just UI).

**Minds and social**
- **Q-M1** SB 243 operator duties (protocol publication, annual reporting from 2027).
- **Q-M2** Which model runs 18+ personas and replies.
- **Q-M3** Retention and deletion of intimate memories.
- **Q-S1** Chat mask relaxed in 18+ worlds.
- **Q-S2** Voice chat (future) in 18+ worlds.
- **Photo mode** inside 18+ worlds: the photo stays on the device; nothing in the game shares it. OK? (Players can screenshot anyway.)
- **Ghost previews / manifest:** a blueprint's ghost items (`GhostPreview.tsx`) render before Manifest. They have to be rated *before* they're shown (they're shown from the planner's text prompts plus placeholder shapes, so the risk is low). Manifest of an adult item flips the world: ask the owner at manifest time.

**Research, legal, mission**
- **Q-R1** Research consent for 18+ data (opt-in vs exclusion).
- **Q-R2** Anonymous creations must not show the research ID (it links everything).
- **Q-L1** Are hate speech and IP rules everywhere, or are they hard lines? The decisions list neither.
- **Q-L2** Age-estimate data: vendor retention, biometric laws.
- **Q-L3** Mission fit of adult content for the 501(c)(3), written down for the board, funders and the IRS.
- **Q-L4** Funders, grants and sponsors: education and arts funders, corporate sponsors (qualified sponsorship), and "schools" in the business plan.
- **Q-L5** Trademark: "Darkborn" versus "confusingly similar"; unmodified copies running adult content under the Aweborn name.
- **Q-L6** Donation pages: the money firewall says "never mention 18+", while transparency says publish everything. Which wins on the giving page?
- **Q-D1–D3** The door: per account or per character, jurisdiction detection, handling minors.
- **Federation (later):** mirrored content from other instances must arrive already tagged; a node that drops tags can't federate into everyone worlds.
- **Transparency vs. safety:** the public action log "never names worlds", but a re-tag of a well-known world is visible on the map anyway. Is that acceptable? Proposed: yes; the map shows the state, the log shows no names.

---

## 12. Doc wording cleanups (all P2, same push as 18+)
- `phases/07-genai-creation.md:417` "all-ages" → "the world's tier".
- `phases/07-genai-creation.md:485`, `ROADMAP.md:866`: "outside its tier" → "without the 18+ door".
- `phases/README.md:215`: rewrite, and fix the broken anchor.
- `docs/research/2026-11-life-and-minds/npc-brains.md`, `README.md:45`: a superseded note.
- `docs/BUSINESS_PLAN.md:84,93`: gating and schools.
- `public/terms.html:29,52,54,56,65,71` + Moderation; `public/privacy.html` (collect, processors, research, age, retention); `RESEARCH.md:40-46`.
- `MASTER_PLAN.md`: a trust & safety workstream row.
- `TRADEMARKS.md`: fork naming plus unmodified copies.
