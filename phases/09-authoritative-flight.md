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
- `[ ]` Extract flight + gravity into `shared/sim/` as pure functions: `FlightState` (position, velocity, quaternion, angular velocity, mode, slingshot dampen, …), `InputFrame`, `step()`. No `inputManager` singleton, no React, no rendering
- `[ ]` Gravity sources come from a `SimWorld` view of the universe (every world, solid or Ghost: the difference is only the map look as of 2026-10-17), passed in, not read from stores
- `[ ]` Replace `Date.now()` (gravity age bonus) with sim time / world `createdAt` in sim time
- `[ ]` `dmath.ts`: deterministic `sin`, `cos`, `pow`/`exp` used by the sim; three.js math only via wrappers that use them
- `[ ]` Client: fixed-step accumulator (60 Hz) + render interpolation; `FlightController` becomes a thin adapter (input → `InputFrame` → `step`)
- `[ ]` Warp + teleport as sim actions (`warpTo(worldId)`, `linkTo(worldId, enter?)`), so they replay and can be validated (warp target must be in the World Index at that tick)
- `[ ]` **Determinism harness:** record an input log, replay in Node + Chromium + WebKit + Firefox (Playwright), compare final states bit for bit; runs in CI
- `[ ]` Feel check with Alex: A/B against today's flight (should be indistinguishable, or better on high-refresh screens)

### 9B: Online authority
- `[ ]` Wire protocol: `0x0A input` (client → server: seq + RLE input frames), `0x0B state` (server → client: ack seq + authoritative state), `0x0C snapshot` (server → client: nearby players' states)
- `[ ]` Server: per-connection simulation (lazy, per bundle); reject malformed / out-of-order / too-fast bundles (more ticks than real time allows)
- `[ ]` Client reconciliation: keep predicted states by seq; on mismatch, reset + replay; smooth any visible correction
- `[ ]` Remote players from server snapshots (interest = subscribed sectors / same world); interpolation buffer ~100 ms. Retire client-reported presence (`0x09`) once at parity
- `[ ]` Hidden cost check: CPU per player on the VPS, bandwidth per player (target well under today's presence relay)
- `[ ]` Disconnect = keep flying locally (prediction just never gets acked) → hand off to 9C on reconnect. No mode switch the player can see

### 9C: Offline replay (same code, big batch)
- `[ ]` Input log persisted in IndexedDB while unacked (survives reload/close)
- `[ ]` On reconnect: upload the log in chunks; server replays in a worker thread from its last confirmed state
- `[ ]` Enforce the bound: ticks ≤ elapsed real time + slack; warps only to worlds in the index *at that tick* (or sighted earlier in the same log); link teleports allowed (anyone can open any link)
- `[ ]` Universe drift: replay against the server's current worlds (worlds rarely move once placed); small divergence → server state wins with one smoothed correction
- `[ ]` Server derives sightings + visits along the replayed path → World Index (with the right times)
- `[ ]` Caps: max log length per upload, chunked processing, back-pressure

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
- `[ ]` `InteriorController` is written inside `shared/sim` from day one (same prediction/authority/replay)
- `[ ]` If Phase 07 picks Rapier: enable its cross-platform determinism build and run it on the server too; if a custom kinematic controller: same rules as flight

## Ties to other phases

| Phase | What changes |
|-------|--------------|
| 02 Multiplayer | Presence `0x09` (client positions) is replaced by server snapshots. CRDT layer unchanged |
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
| `shared/sim/*.ts` | NEW | `step`, state/input types, gravity, dmath, sightings |
| `src/systems/FlightController.ts`, `GravitySystem.ts`, `WarpSystem.ts`, `TeleportSystem.ts` | MODIFY | Adapters over `shared/sim` |
| `src/systems/InputManager.ts` | MODIFY | Emits quantized `InputFrame`s |
| `src/hooks/usePresence.ts` | MODIFY | Server snapshots + interpolation |
| `server/sync-service/src/sim-host.ts` | NEW | Per-player authority + replay worker |
| `server/sync-service/src/rooms.ts` | MODIFY | `0x0A`–`0x0C` messages, interest management |
| `server/sync-service/src/telemetry.ts` | NEW | Trace storage + retention |
| `scripts/sim-determinism/*` | NEW | Cross-engine harness (Playwright) |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-10-12 | **Planned.** Came out of the World Index anti-cheat question. Alex: the server should have flight traces of every player (telemetry + online anti-cheat); offline must be checked by the same code; no "unverified" tier, online and offline should feel the same; the "perfect honest flier" bound is the guarantee. Chose server-authoritative movement with client prediction (how the big titles do it), with offline = replay of recorded inputs. Audit: flight is our own code (~670 lines, three.js math, boolean actions); determinism risks are `Date.now()` in gravity, `Math.pow`, and `sin/cos` inside `setFromAxisAngle`/`slerp`. | After 8B ships: Alex to confirm open questions, then 9A |
