# Phase 09: Authoritative Flight, Anti-Cheat & Telemetry

**Status:** `[ ]` Not Started (planned 2026-10-12)
**Depends on:** [Phase 04: Navigation & Controls](./04-navigation-controls.md) (the flight model being moved), [Phase 02: Multiplayer Core](./02-multiplayer-core.md) (wire protocol, presence)
**Feeds:** [Phase 06](./06-offline-mesh.md) (offline + mesh use the same simulation), [Phase 07](./07-genai-creation.md) (interior movement joins the same simulation), [Phase 05](./05-mana-economy.md) (rewards trust server-checked movement), [Phase 08](./08-nfc-trading-cards.md) (the server works out World Index sightings itself)
**ROADMAP reference:** [Ephemeral State Channel](../ROADMAP.md#ephemeral-state-channel-high-frequency-updates), resolved decision "Anti-cheat: client-side prediction with server reconciliation" (Aug 19, 2026)
**Estimated sessions:** 6–9

## Goal

One flight simulation, in `shared/`, runs **everywhere**: in the player's browser (instant, predicted), on the server (the authority), on mesh peers (to show each other), and on the server again when an offline session comes back (replay). The server owns where every player really is, so:

- **Anti-cheat online:** the server simulates your inputs; impossible movement can't happen.
- **Anti-cheat offline, same code:** the client records its inputs; on reconnect the server replays them through the same simulation. **Guarantee (Alex, 2026-10-12): the worst a cheater can do offline is exactly what a perfect honest flier could have done in the same time.**
- **Telemetry:** the inputs plus the server's states *are* every player's flight trace.
- **Feel:** online and offline look and feel the same. No "unverified" tier (Alex, 2026-10-12). No rubberbanding in normal play: the client predicts with the same code the server runs, so they agree.

## How the big titles do it (and what we copy)

Quake, Source (CS, Valorant), Overwatch, Rocket League, Fortnite: **server-authoritative movement + client-side prediction + reconciliation**.

1. Client samples input every fixed tick, applies it locally right away, and sends it (with a sequence number) to the server.
2. Server applies the same inputs with the same code; it is the authority.
3. Server replies "your state after input #N".
4. Client compares with what it predicted for #N. Same (the normal case, if the simulation is deterministic) → nothing happens. Different → reset to the server's state and silently replay inputs #N+1… on top. Corrections are only visible under real packet loss or cheating, and then they're smoothed.
5. Other players are drawn ~100 ms in the past, interpolated between server snapshots: smooth, no jitter.

**What makes Aweborn easier than a shooter:** players don't collide with or shoot each other in flight. Each player's simulation depends only on their own inputs and the (slow-changing) world gravity. So:

- No lag compensation / rewind of other players.
- The server can simulate each player **lazily, per input batch**, not in a global lockstep tick.
- **Online is just replay with tiny batches; offline is replay with one big batch.** One code path.

## Architecture Decisions (proposed)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Authority | Server-authoritative movement; client predicts and reconciles | Matches the Aug 19 decision; the server already holds the universe |
| Shared code | `shared/sim/`: pure `step(state, input, world) → state` for flight + gravity (+ warp/teleport as input actions) | Same file runs in browser, Node, mesh peers, offline replay |
| Timestep | Fixed **60 Hz** simulation; rendering interpolates between steps | Variable `useFrame` delta can't be reproduced on the server. Also fixes feel on 120 Hz screens |
| Input | Per tick: a bitfield of the flight actions (they're already booleans in `ActionState`) + any analog axes **quantized** (int8) *before* the client simulates them | Client and server must step on identical numbers |
| Upload | Input bundles at ~20–30 Hz, each repeating the last few unacknowledged ticks | Survives packet loss without resends (Overwatch-style) |
| Determinism | No wall clock in the sim (`Date.now()` in `GravitySystem` ageBonus → sim time); deterministic `sin/cos/pow` (`shared/sim/dmath.ts`) for `setFromAxisAngle`, `slerp`, drag; doubles only, no `Float32Array` | Chrome and Node share V8, but Safari/Firefox can differ in the last bits of `Math.sin`/`pow` |
| Remote players | Server sends authoritative snapshots (~20 Hz, nearby sectors only), clients interpolate | Replaces client-reported positions (presence `0x09`) |
| Offline | Client logs inputs (run-length encoded) in IndexedDB; on reconnect uploads; server replays in a worker | Inputs rarely change tick to tick, so an hour of flight is small |
| Offline bound | Replayed ticks ≤ real time elapsed since the server's last confirmed state (+ small slack); start state = the server's last confirmed state | This *is* the "perfect honest flier" guarantee |
| Discovery | Sightings computed by the server from the authoritative trajectory (same shared `sightingsAlong()` the client uses for instant feedback) | Client stops *reporting* sightings; it only predicts them |
| Mesh (offline, P2P) | Peers exchange **inputs** over DataChannels and run each other's simulations; no peer is trusted; each player's own log goes to the server on reconnect | Same model as online, minus the authority until reconnect |
| Telemetry | Keep input logs + downsampled server states (~1–2 Hz) per character, with a retention window | Cheap; enough for heatmaps, replays, abuse review |

**Deviation from ROADMAP (logged, ROADMAP not edited):** ROADMAP's Ephemeral State Channel has clients broadcasting *positions* P2P with the server validating every 0.5–2 s. This plan sends *inputs* to a simulating server instead. WebRTC peer broadcast stays, as the mesh/offline path and an optional low-latency path later.

## Milestones & Tasks

### 9A: Shared deterministic simulation (no networking change)
- `[x]` Extract flight + gravity into `shared/sim/` as pure functions: `FlightState` (position, velocity, quaternion, angular velocity, mode, slingshot dampen, …), `InputFrame`, `step()`. No `inputManager` singleton, no React, no rendering
- `[x]` Gravity sources come from a `SimWorld` view of the universe (every world, solid or Ghost: the difference is only the map look as of 2026-10-17), passed in, not read from stores
- `[x]` Replace `Date.now()` (gravity age bonus) with sim time / world `createdAt` in sim time *(client reads the clock at minute resolution into `SimWorld`; 9B: server builds it from its clock)*
- `[x]` `dmath.ts`: deterministic `sin`, `cos`, `pow`/`exp` used by the sim; three.js math only via wrappers that use them
- `[x]` Client: fixed-step accumulator (60 Hz) + render interpolation; `FlightController` becomes a thin adapter *(render interpolation of the orb between ticks not added; the camera already smooths)* (input → `InputFrame` → `step`)
- `[ ]` Warp + teleport as sim actions (`warpTo(worldId)`, `linkTo(worldId, enter?)`), so they replay and can be validated (warp target must be in the World Index at that tick)
- `[x]` **Determinism harness:** record an input log, replay in Node + Chromium + WebKit + Firefox (Playwright), compare final states bit for bit; runs in CI
- `[ ]` Feel check with Alex: A/B against today's flight (should be indistinguishable, or better on high-refresh screens)

### 9B: Online authority
- `[x]` Wire protocol: `0x0A input` (client → server: seq + RLE input frames), `0x0B state` (server → client: ack seq + authoritative state), `0x0C snapshot` (server → client: nearby players' states) *(2026-10-28: `0x0a` chat, `0x0b` presence-batch, `0x0c` ping are taken; 9B uses `0x0d`+)* *(shipped: `0x0d sim-input` (u32 seq, u16 epoch, ≤60 frames of u16 bits + i8 yaw + i8 pitch, the client's predicted state, leash radius), `0x0e sim-correct` (only when the server disagrees), `0x0f sim-reset` (out-of-sim moves); `shared/sim/wire.ts`. No RLE: 3 frames per bundle is ~120 B at 20 Hz. Snapshot not done)*
- `[x]` Server: per-connection simulation (lazy, per bundle); reject malformed / out-of-order / too-fast bundles (more ticks than real time allows)
- `[x]` Client reconciliation: keep predicted states by seq; on mismatch, reset + replay; smooth any visible correction *(keeps inputs, not states: 256-tick ring, rewind to the server state + replay; correction snaps, no smoothing yet)*
- `[ ]` Remote players from server snapshots (interest = subscribed sectors / same world); interpolation buffer ~100 ms. Retire client-reported presence (`0x09`) once at parity
- `[ ]` Hidden cost check: CPU per player on the VPS, bandwidth per player (target well under today's presence relay)
- `[x]` Disconnect = keep flying locally (prediction just never gets acked) → hand off to 9C on reconnect. No mode switch the player can see

### 9C: Offline replay (same code, big batch)
- `[x]` Input log persisted in IndexedDB while unacked (survives reload/close) *(the offline part only: online ticks aren't kept once sent)*
- `[x]` On reconnect: upload the log in chunks; server replays in a worker thread from its last confirmed state *(60-tick chunks; main thread, not a worker)*
- `[~]` Enforce the bound: ticks ≤ elapsed real time + slack; warps only to worlds in the index *at that tick* (or sighted earlier in the same log); link teleports allowed (anyone can open any link)
- `[ ]` Universe drift: replay against the server's current worlds (worlds rarely move once placed); small divergence → server state wins with one smoothed correction
- `[ ]` Server derives sightings + visits along the replayed path → World Index (with the right times)
- `[~]` Caps: max log length per upload, chunked processing, back-pressure *(30 min cap both sides, 60-tick chunks; no back-pressure)*

### 9D: Telemetry
- `[ ]` Store per character: input log segments + ~1–2 Hz authoritative samples (position, world, mode)
- `[ ]` Retention window + rollups (heatmap tiles) so storage stays bounded
- `[ ]` Admin-only query/export; later: heatmaps, replays, abuse review
- `[ ]` Privacy page: say what's recorded (in-game movement), how long, why

### 9E: Mesh (lands with Phase 06)
- `[ ]` Peers send inputs (not positions) over WebRTC DataChannels; each peer simulates the others with `shared/sim`
- `[ ]` No peer authority; each player uploads only their own log on reconnect → server replays as in 9C
- `[ ]` Optional later: peers record hashes of each other's states as witnesses (cross-check on reconnect)

### Interior movement (lands with Phase 07)
- `[x]` `shared/sim/interior.ts` pure deterministic step function (`stepInterior`, `kickedPosition`, AABB colliders) already shared between client (`InteriorController.ts`) and tests; wire into server authority + replay in 9B/9C

### 9F: Enumerated Action Catalog & Unified Intent Authority (added 2026-10-27)
> **Finding (2026-10-23/27 audit):** `Universe` (`0x02 universe-update` refused) and `chat` (`0x0a chat` intent) are already server-written only, but `World` CRDTs (`0x04 world-update`) still accept raw binary Yjs deltas from clients (`meta`, `physics`, `terrain`, and `objects` are open; only `chat` is blocked via Yjs internal struct inspection in `chat-guard.ts`, and `PlannerPanel` "Shape terrain" writes raw JSON directly to `doc.getMap("terrain")` over Yjs). Extending `chat-guard.ts` to dissect Yjs internals (`_start`, `_map`, `origin` chains) was explicitly rejected: binary CRDT deltas are for state replication, not intent/ACL enforcement, and lose actor identity (`placedBy` can be forged; world policies can't be checked).

- `[ ]` **Server is the sole writer to canonical Y.Docs (`Universe` and `World`):** keep Yjs as the server → client sync & local prediction/cache layer (`universe-sync`, `world-sync`, `world-update`), retire client → server raw `0x04 world-update` binary deltas, and delete `chat-guard.ts`
- `[ ]` **Declarative Action & Authority Catalog (`shared/actions.ts` + server policy enforcer):** enumerate every state-mutating intent in one typed table enforced centrally across HTTP and WebSocket handlers:
  - **Actor tiers:** `any_session` (anonymous or saved) → `saved` (signed-in explorer) → `asset_maker` (`asset.maker ∈ account.characters`) → `world_creator` (`world.creator ∈ account.characters`, + future co-creators) → `admin_inflow` / `admin`
  - **Offline-capable world intents (replaces client `0x04 world-update`):** `object.place`, `object.transform`, `object.recolor`, `object.duplicate`, `object.kick`, `object.settle`, `object.replace_asset`, `object.remove`, `terrain.shape`. Client applies optimistically to local `Y.Doc` (0 ms feedback) and appends typed intents to an IndexedDB **Offline Intent Queue** when offline; on live send or reconnect replay, server validates schema/bounds, stamps `placedBy: session.playerId`, checks world policy, and writes to canonical `worldDoc`. *(Policy baseline decided 2026-10-23: all object actions stay open to everyone in the world for now; Architect / `terrain.shape` defaults to any signed-in explorer, with room for a creator policy toggle later like `allowPortals`.)*
  - **Online authenticated intents:** `world.plant` (enforces parent `allowPortals`), `world.set_portal_policy` (`world_creator`), `chat.send` (`saved`), `library.create_model` (`saved` + mana), `library.remove_asset` (`asset_maker`), `library.upload_thumb` (`any_session`), `architect.turn` / `architect.manifest` / `architect.redo` (`saved` + mana), `account.switch_character`, `account.set_password`
  - **Admin intents:** `mana.inflow` (`admin_inflow`), `mana.draw` (`admin`), `trash.list` / `trash.restore` / `trash.purge` (`admin`)
  - **Continuous simulation intents (9A–9C):** `sim.flight_input`, `sim.interior_input`, `sim.warp` *(Note: wire opcodes `0x0a` `chat` and `0x0b` `presence-batch` are now taken in `rooms.ts`; start 9B opcodes at `0x0c`+; since M7c `0x0c` is ping, so `0x0d`+)*

## Ties to other phases

| Phase | What changes |
|-------|--------------|
| 02 Multiplayer | Presence `0x09` (client positions) is replaced by server snapshots; client → server `0x04 world-update` is replaced by typed world intents (server becomes sole writer to canonical `World` Y.Docs, matching `Universe`) |
| 04 Navigation | `FlightController`/`GravitySystem`/`WarpSystem` become adapters over `shared/sim` |
| 05 Economy | Awe/mana rewards for discovery trust server-derived visits; Event-Sourced Physics kick validation can reuse the sim |
| 06 Offline & Mesh | PWA + IndexedDB host the input log; mesh carries inputs; reconnect = 9C replay. Tiered connectivity UI shows the same game in all tiers |
| 07 Interior | Interior movement built on the same simulation |
| 08 World Index | Until 9C ships: cheap checks on client-reported sightings (live worlds, ≤ 30 days, 60/min). After: server derives sightings; `/world-index/sighted` retired |
| Multi-server (open question) | Per-player simulation is independent, so it shards cleanly by player |

## Acceptance Criteria

- [ ] The same input log gives bit-identical states in Node, Chromium, WebKit and Firefox (CI)
- [ ] Online: a modified client that sends impossible movement can't move faster than the sim allows; normal play shows no corrections on a healthy connection
- [ ] Offline 30 min → reconnect: server replay matches the client (or one smooth correction); sightings appear in the World Index with their real times
- [ ] An offline log claiming more flight than elapsed time, or a warp to an unindexed world, is cut at that point
- [ ] Flight feels the same as before (Alex sign-off)
- [ ] Telemetry: a character's path for a session can be queried; storage stays within the retention budget

## Open Questions

| Question | Proposal |
|----------|----------|
| Sim rate | 60 Hz; inputs sent at 20–30 Hz |
| Telemetry retention + sample rate | Raw inputs 30 days, 1–2 Hz samples 1 year, heatmap rollups forever |
| Remote players: server only, or also P2P fast path online? | Server only first; P2P online later if latency matters |
| Determinism fallback if a browser won't match | Tolerance-based reconciliation with smoothed corrections for that browser |
| Order vs. Phase 05/06/07 | After 8B (World Index) ships on cheap checks; before Phase 06 mesh and Phase 07 interior work |

## Files Changed (expected)

| File | Action | Notes |
|------|--------|-------|
| `shared/sim/*.ts` | NEW / EXPAND | `step`, state/input types, gravity, dmath, sightings (`interior.ts` already started) |
| `shared/actions.ts` | NEW | Enumerated Action & Authority Catalog (actor tiers, offline capability, mana & world policy flags) |
| `src/systems/FlightController.ts`, `GravitySystem.ts`, `WarpSystem.ts`, `TeleportSystem.ts` | MODIFY | Adapters over `shared/sim` |
| `src/systems/InputManager.ts` | MODIFY | Emits quantized `InputFrame`s |
| `src/hooks/usePresence.ts` | MODIFY | Server snapshots + interpolation |
| `src/lib/offlineCache.ts`, `src/stores/worldStore.ts` | MODIFY | Typed world intent dispatch + IndexedDB Offline Intent Queue (replaces raw binary `world-update` queue) |
| `server/sync-service/src/authority.ts` | NEW | Central HTTP + WS intent policy enforcer + world CRDT mutator |
| `server/sync-service/src/chat-guard.ts` | DELETE | Retired once client → server `0x04 world-update` is replaced by typed world intents |
| `server/sync-service/src/sim-host.ts` | NEW | Per-player authority + replay worker |
| `server/sync-service/src/rooms.ts` | MODIFY | `0x0C`+ sim/intent messages, interest management, refuse client `0x04 world-update` |
| `server/sync-service/src/telemetry.ts` | NEW | Trace storage + retention |
| `scripts/sim-determinism/*` | NEW | Cross-engine harness (Playwright) |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-10-12 | **Planned.** Came out of the World Index anti-cheat question. Alex: the server should have flight traces of every player (telemetry + online anti-cheat); offline must be checked by the same code; no "unverified" tier, online and offline should feel the same; the "perfect honest flier" bound is the guarantee. Chose server-authoritative movement with client prediction (how the big titles do it), with offline = replay of recorded inputs. Audit: flight is our own code (~670 lines, three.js math, boolean actions); determinism risks are `Date.now()` in gravity, `Math.pow`, and `sin/cos` inside `setFromAxisAngle`/`slerp`. | After 8B ships: Alex to confirm open questions, then 9A |
| 2026-10-27 | **Expanded scope (Milestone 9F): Enumerated Action Catalog & Unified Intent Authority.** Audited every state-mutating surface in the codebase after shipping `world.set_portal_policy`. Found that while `Universe` (`0x02` refused) and `chat` (`0x0a`) are server-written only, `World` CRDTs (`0x04 world-update`) still accept raw binary Yjs deltas (`meta`, `physics`, `terrain`, `objects` unguarded except `chat-guard.ts`, and `PlannerPanel` "Shape terrain" writes directly to `terrain` over Yjs). Rejected extending `chat-guard.ts` into a Yjs binary-struct inspector (`crdt-guard.ts`): binary CRDT deltas are for replication, not intent/permission checks, and lose actor identity. **Decided:** Phase 09 will unify discrete actions and world building under the same architecture as flight (`ROADMAP.md` line 917): **the server becomes the sole writer to canonical `Universe` and `World` Y.Docs**, and every client → server mutation becomes an enumerated, typed **Intent Action** (`shared/actions.ts`), predicted locally on the client's `Y.Doc` and queued as typed intents while offline for ordered replay on reconnect (retiring client `0x04 world-update` and `chat-guard.ts`). Policy baselines set by Alex: keep object actions open to everyone in a world for now; Architect / `terrain.shape` defaults to any signed-in explorer (with room for a creator toggle later like `allowPortals`). | Design & flesh out 9F alongside 9A–9C when Phase 09 kicks off |
| 2026-10-27 | **Rough Draft M1 (ahead of 9F, as a stopgap):** the sync server now judges every client `world-update` against `shared/world-policy.ts` and **reverts** violations in one `"authority"` transaction (refusing would break the sender's Yjs causal chain). Rules shipped (from the approved ROUGH_DRAFT plan): objects editable/deletable by their placer, the creator and builders (co-creators); anyone may place and kick (kick speed/settle bounded); meta/physics/terrain by creator + builders; guests never touch others' things. Verified on prod with `scripts/verify/world-authority.mjs`. Builders are set by the creator (`POST /api/player/world/policy {coCreators}`, Builders card in the 🌱 Portal sheet). **Note:** this is stricter than the baseline in the row above (objects open to everyone, terrain open to any signed-in explorer); flagged to Alex. 9F still replaces this with typed intents. | Alex: confirm rules; 9F later |
| 2026-10-27 | **Rough Draft M1 finished: mute/report + creation safety check.** *Mute/report:* tap a name in the open chat log → `<dialog id="player-actions">` (Mute/Unmute, Report with reason + note). Mutes live on the device and, with a session, in `player_mute` (follows you; max 500). Reports (`report` table, 10/h/account) carry the **server's own** copy of the target's lines in that place over the last hour, so they can't be forged. Review at `/admin-reports.html` (`MANA_ADMIN_TOKEN`). *Safety check* (`server/sync-service/src/safety.ts`): local blocklist, then a cached classifier call (`SAFETY_MODEL`, default Haiku via OpenRouter, ≈1 s, ≈$0.00007; cost booked as its own reserve→settle). Runs before Make reaches Meshy (422 + an original suggestion, "Use this idea" button), before a planner blueprint is shown (checks name/art direction/lore/asset prompts, not the player's words; the planner already declines gracefully, so a refusal comes back in its voice with the suggestion as a chip and the request is dropped from context), and before manifest/reworded redo. **Fails open** if the classifier is down (local list still applies; logged). Blocks are kept in `safety_flag` → "Blocked prompts" tab on the admin page. Live grading: 8/8 (lantern, sword, skeleton allowed; Pikachu, Taylor Swift, Coca-Cola, nudity, gore blocked). Real-tap checks with puppeteer: mute/report at 390×844, 360×740, 844×390, 1440×900; Make refusal at 390×844 + 1440×900 (planner: one live turn with curl, "Mario and Luigi" → the planner declined on its own and offered original stone brothers, which passed the check; the blocked-blueprint branch is not exercised live yet). Privacy updated (mute/report also in Terms). | M2 audio (Phase 05). Open: Alex to confirm stricter authority rules vs. the earlier baseline |
| 2026-10-28 | **9A rough draft (Rough Draft M8).** New `shared/sim/`: `dmath.ts` (fdlibm sin/cos/atan/acos kernels using only IEEE-exact ops; the drag / auto-orient / leash factors at 60 Hz frozen as literals), `gravity.ts` (pure, allocation-free port of `GravitySystem`, sim time instead of `Date.now()`), `flight.ts` (`stepFlight(state, InputFrame{bits, yaw:int8, pitch:int8}, SimWorld)`: rotation, DRIVE/NEUTRAL, auto-orient, plus what `Scene.tsx` did around it: approach drag, dead zone, slingshot turn dampening, the slingshot impulse (now once per pass inside the step, not per frame) and the beginner leash (now per tick, not per frame)). `FlightController` / `GravitySystem` are thin adapters; mode is a level bit (`neutral`) in the input, not a toggle. **Feel proof:** `flight.test.ts` runs a verbatim copy of the old three.js flight beside the new step on long random input logs: gravity is bit-identical, flight drifts ≤ ~1e-12 u over a minute (trig differs in the last bit). `scripts/sim/gravity-escape.ts` now drives the real step (it was broken on the path alias). **Determinism:** `scripts/sim-determinism/run.mjs` bundles `replay-fixture.ts` and replays it in Node, **JavaScriptCore (Safari's engine, macOS `jsc`)** and Chromium: all bit-identical (`8cbbb229`); Firefox/SpiderMonkey not tried (no shell here, `$SPIDERMONKEY` hook). New CI job `sim-determinism` (Node + Chrome; never blocks a deploy). **Not done:** warp leaps / link teleports as sim inputs (still move the player outside the sim; the adapter copies them back in) → 9B/9C. Analog sticks are quantized to int8 before simulating (1/127 steps). **Alex:** feel check (should be identical; leash and slingshot impulse are per tick now). | 9B online authority (`0x0d`+) |
| 2026-10-29 | **9B rough draft (Rough Draft M8).** Server: `server/sync-service/src/sim-host.ts` `SimHost`, one per `RoomManager`, steps the shared sim per flying socket against the bodies within 300 u (refreshed each second, universe order kept so sums match the client bit for bit). It adopts the client's state when it agrees (tolerance 0.002 u/frame, so normally nothing is sent back), corrects otherwise, and corrects when a socket sends more ticks than real time allows (30-tick slack, 180-tick idle bank). Epochs stop one correction from cascading. `sim-reset` (spawn, warp leap end, teleport, world exit, brake, new socket) is accepted within 40 u of any world/Portal, within 80 u/s × elapsed + 50 u of the last confirmed state, or when there is no reference (fresh spawn). Counters on `/stats` → `sim`. Client: `src/lib/simLink.ts` numbers ticks, bundles 3 per message, resets on socket open; `FlightController.step` notices out-of-sim moves (view ≠ last stepped state) and on `sim-correct` rewinds + replays the unacked inputs. Tests: `sim-host.test.ts` (7), `shared/sim/wire.test.ts` (3). Local check: 5.6 s of DRIVE/turn/NEUTRAL flight = 112 bundles, 1 reset, **0 corrections**, server stepped 732 ticks. **Not done:** visible corrections snap (no smoothing); remote players still from client-reported presence (`0x09`), no server snapshots; last confirmed state is in memory only (a deploy forgets it, so the next reset is taken as a spawn); leash radius is client-reported; warp/teleport are trusted by distance only (no warp-unlock / World Index check); slingshot pass id isn't sent in corrections; CPU/bandwidth not measured on the VPS; interior movement not under authority. | 9C offline replay |
| 2026-10-29 | **9C rough draft (Rough Draft M8).** Offline, `simLink` writes the same input bundles (60 ticks each) and any resets to an offline flight log in IndexedDB (`offlineCache.ts` `flight:` keys; memory only where IndexedDB is missing). Back online it sends `0x10 sim-resume` (start state + logged tick count) and the whole log, then clears it. `SimHost.resume` grants the logged ticks as credit, capped by the time since the last confirmed state + slack (≤ 30 min; 2 min with no known state), so a log can't hold more flight than real time; past that the frames are dropped and corrected ("cut at that point"). Last confirmed state per character now lives in SQLite (`sim-store.ts`, table `sim_last_known`, batched every 60 s + shutdown, 30-day retention), so a deploy no longer turns a resume into a free spawn. Privacy page updated in the same push. New sockets start at epoch 0 (fixes a 9B gap: after a correction, a reconnect stopped comparing). Tests: 3 new in `sim-host.test.ts`. Local check (Chrome offline mode, ~4 s offline flight): 1 resume, offline chunks matched bit for bit (distance 0), **0 corrections**; found + fixed a recycle-while-offline dropping the partial chunk. **Not done:** warp-unlock / World Index checks at a tick (warps/teleports are still distance-checked resets); sightings and visits are not derived from the replayed path (`/world-index/sighted` stays); replay is on the main thread (≤ 108k steps per resume); ticks sent into a zombie socket before the heartbeat notices are lost, not logged; no visual smoothing of a correction. | 9D telemetry |
