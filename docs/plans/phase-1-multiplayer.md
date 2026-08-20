# Phase 1 — Multiplayer Core

> **Parent:** [MASTER_PLAN.md](./MASTER_PLAN.md)
> **Status:** 🔴 Not Started
> **Goal:** Multiple players connected to a shared universe, seeing each other as stars.
> **Prerequisites:** Phase 0 complete (server running, Yjs integrated)

---

## Phase Summary

This phase builds the core multiplayer data layer. By the end, multiple browsers connect to the same universe, see each other's positions as glowing orbs, can create worlds that appear for everyone, and can enter a world to see its full CRDT state.

No navigation controls or economy yet — just the raw multiplayer backbone.

---

## Milestones

### M1.1 — WebSocket Room System
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** Phase 0 (M0.2)

#### What
- Implement server-side **sector room** management
- Players join/leave rooms based on their spatial position in the universe
- Each room is a WebSocket channel backed by a Yjs Y.Doc (the sector's slice of the Universe CRDT)
- Broadcast is scoped per-room — players only receive updates from their sector
- Room lifecycle: auto-create when first player enters, keep alive while occupied, flush and unload after idle timeout

#### Acceptance Criteria
- [ ] Server manages named rooms (e.g., `sector-0-0-0`)
- [ ] A client joining a room receives the current room state
- [ ] Updates in one room are NOT broadcast to clients in a different room
- [ ] Room unloads after all players leave + idle timeout (configurable, default 60s)
- [ ] Server logs room create/destroy events

#### Tasks
```
- [ ] Create server/src/rooms.ts — RoomManager class (create, get, destroy, list)
- [ ] Room wraps a Y.Doc with connection tracking
- [ ] Implement room-scoped WebSocket broadcast
- [ ] Add idle timeout → flush to storage (initially just log; persistent storage in Phase 5)
- [ ] Client-side: sector calculation from player position → room subscription
- [ ] Verify: two clients in same room sync, client in different room does not
```

---

### M1.2 — Universe CRDT (Layer 1)
**Status:** 🔴 Not Started
**Effort:** 1 session
**Dependencies:** M1.1

#### What
- Implement the Layer 1 Universe CRDT — a `Y.Map` of world metadata entries
- Each entry contains: `id, name, creator, intendedPosition, resolvedPosition, color, solidified, playerCount, lastActive`
- Server writes `resolvedPosition` (spatial resolver ensures no overlap)
- Clients read entries and render worlds as suns
- World creation flow: client writes `intendedPosition` → server resolves → writes `resolvedPosition`

#### Acceptance Criteria
- [ ] Universe CRDT structure matches ROADMAP.md spec
- [ ] Client can create a world → appears in the Universe CRDT
- [ ] Server spatial resolver assigns `resolvedPosition` (initially: pass-through, no collision detection yet)
- [ ] All connected clients see the new world appear
- [ ] World metadata renders as a visible element in the 3D scene

#### Tasks
```
- [ ] Define UniverseEntry type in shared/types.ts
- [ ] Client: createWorld() writes to Y.Map("worlds") with intendedPosition
- [ ] Server: watch for new entries, write resolvedPosition
- [ ] Server: basic spatial resolver (pass-through for now, collision detection in Phase 5)
- [ ] Client: useWorlds() hook — reactive list of all worlds from the CRDT
- [ ] Render worlds as simple glowing spheres in the 3D scene (placeholder visual)
- [ ] Verify: create world in Tab A → appears in Tab B
```

---

### M1.3 — World CRDTs (Layer 2)
**Status:** 🔴 Not Started
**Effort:** 2 sessions
**Dependencies:** M1.2

#### What
- Each world gets its own `Y.Doc` with the nested structure from ROADMAP:
  - `Y.Map("meta")` — name, creator, color, solidified
  - `Y.Map("physics")` — gravity, friction, bounce, water level
  - `Y.Map("objects")` — placed objects (scene graph)
  - `Y.Map("terrain")` — seed + modifications
  - `Y.Array("chat")` — in-world chat log
- Server lazy-loads world Y.Docs: only in memory when players are inside
- Server flushes world state on last-player-leave

#### Acceptance Criteria
- [ ] Each world has its own Y.Doc with the correct nested structure
- [ ] Entering a world loads its Y.Doc from the server
- [ ] Leaving a world unsubscribes the client from that Y.Doc
- [ ] Server unloads world Y.Doc after all players leave + idle timeout
- [ ] Writing to a world's Y.Map("meta") propagates to all players in that world

#### Tasks
```
- [ ] Define WorldDoc type interfaces in shared/types.ts
- [ ] Server: WorldManager — load/create/unload world Y.Docs
- [ ] Server: world room lifecycle (separate from sector rooms)
- [ ] Client: useWorld(worldId) hook — connects to a specific world's Y.Doc
- [ ] Client: world entry flow — subscribe to world Y.Doc, unsubscribe from universe view
- [ ] Initialize new worlds with default physics, empty objects, empty chat
- [ ] Verify: enter world in Tab A, edit meta → Tab B sees the change
```

---

### M1.4 — Player Presence & Awareness
**Status:** 🔴 Not Started
**Effort:** 1 session
**Dependencies:** M1.2

#### What
- Implement the Yjs **awareness protocol** for ephemeral player state
- Each player broadcasts: `{ id, position, velocity, inWorld, color }`
- Awareness data is NOT persisted — disappears on disconnect
- Render other players as glowing orbs with faint comet trails
- Player count per world updated in the Universe CRDT

#### Acceptance Criteria
- [ ] Each connected client broadcasts its position via awareness
- [ ] Other clients render the player as a glowing orb
- [ ] Disconnecting a client removes their orb within ~2 seconds
- [ ] World `playerCount` in Universe CRDT reflects current occupants
- [ ] Player orbs have a faint trail effect

#### Tasks
```
- [ ] Define PlayerPresence type in shared/types.ts
- [ ] Client: broadcast awareness state on position change (throttled to ~20Hz)
- [ ] Client: usePlayersNearby() hook — reads awareness from current room
- [ ] Render player orbs as simple glowing sprites with trail shader
- [ ] Server: update world playerCount on player enter/leave
- [ ] Verify: 3 tabs open, each sees the other 2 as orbs
```

---

## Phase Completion Criteria

1. ✅ Room system working — scoped broadcasts, lifecycle management
2. ✅ Universe CRDT live — worlds created by one player appear for all
3. ✅ World CRDTs live — entering a world loads its Y.Doc, edits sync
4. ✅ Player presence — see other players as orbs, presence disappears on disconnect

**Then:** Update MASTER_PLAN.md status to 🟢, move active phase to Phase 2/3/4 (parallelizable).

---

*Last updated: 2026-08-20*
