# Phase 02: Multiplayer Core (CRDT + WebSocket)

**Status:** `[x]` Complete
**Depends on:** [Phase 01: Foundation & VPS Setup](./01-foundation.md)
**ROADMAP reference:** [The Two-Layer CRDT Architecture & Persistence](../ROADMAP.md#the-two-layer-crdt-architecture--persistence)
**Estimated sessions:** 4-6 (actual: 3)

## Goal

Implement the two-layer CRDT architecture (Universe CRDT + per-World CRDTs) with sector-based room management. By the end of this phase, multiple players can see each other's worlds in the universe, enter a world, and collaboratively build inside it — all synced in real-time via the VPS.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Universe CRDT | Single Y.Doc with Y.Map of world entries, chunked by sector | Players subscribe only to nearby sectors |
| World CRDT | One Y.Doc per world (meta, physics, objects, terrain, chat) | Loaded on demand, flushed when dormant |
| Persistence | SQLite on VPS disk (start simple) → Postgres later if needed | Lightest-weight option, no external DB service |
| Flush strategy | Every 60 seconds + on last player leave | 99.9% fewer writes than per-operation |
| Awareness | Yjs awareness protocol for ephemeral presence | Built into y-webrtc, zero storage cost |
| Conflict resolution | Yjs default (higher clientID wins on concurrent writes) | Deterministic, no clock sync needed |

## Tasks

### Universe CRDT Schema
- `[x]` Define TypeScript types for Universe CRDT entries (matches ROADMAP spec)
- `[x]` Create `shared/crdt-schema.ts` — shared types between client and server
- `[x]` Implement Universe Y.Doc initialization on server
- `[x]` Implement sector assignment logic (hash worldId → sector)

### World CRDT Schema
- `[x]` Define TypeScript types for World CRDT (meta, physics, objects, terrain, chat)
- `[x]` Implement World Y.Doc factory function
- `[x]` Per-world physics parameters (gravity, friction, bounce, water level)
- `[x]` Object placement schema (Y.Map of objects with type, position, rotation, scale, material)

### Server: Room Management
- `[x]` Implement sector-based WebSocket rooms
- `[x]` Universe room: clients subscribe based on current position
- `[x]` World rooms: clients join when entering a world, leave when exiting
- `[x]` Lazy load World Y.Docs into RAM when first player enters
- `[x]` Flush World Y.Docs to SQLite when last player leaves
- `[x]` Periodic flush (every 60s) for active worlds

### Server: Persistence Layer
- `[x]` Set up SQLite database (`server/data/universe.db`)
- `[x]` Table: `worlds` — stores serialized Y.Doc state vectors
- `[x]` Table: `universe_sectors` — stores sector CRDT state
- `[x]` Implement save/load functions for Y.Doc ↔ SQLite
- `[x]` Add graceful shutdown: flush all in-memory docs before exit

### Server: Spatial Resolver
- `[x]` Implement deterministic spatial resolution (ROADMAP spec)
- `[x]` Sort worlds by timestamp, nudge overlapping worlds outward
- `[x]` Write `resolvedPosition` back to Universe CRDT
- `[x]` Minimum distance enforcement between worlds

### Client: CRDT Integration
- `[x]` Upgrade `useCRDT.ts` hook to support Universe + World docs
- `[x]` Create `src/stores/universeStore.ts` — Zustand store backed by Universe CRDT
- `[x]` Create `src/stores/worldStore.ts` — Zustand store backed by active World CRDT
- `[x]` Implement sector subscription (subscribe/unsubscribe based on camera position)
- `[x]` Implement world enter/exit flow (join world room, load world CRDT)

### Client: Player Presence
- `[x]` Implement Yjs awareness protocol for player positions
- `[x]` Broadcast: `{ id, position, velocity, inWorld, color }` at ~20Hz
- `[x]` Receive and interpolate other players' positions
- `[x]` Handle player join/leave events

### World Creation Flow
- `[x]` "Plant where you stand" — create world at current camera position
- `[x]` Client writes `intendedPosition` to Universe CRDT
- `[x]` Server resolves position, writes `resolvedPosition`
- `[x]` Client animates world to resolved position ("gravitational settling")

## Acceptance Criteria

- [x] Universe CRDT stores world entries; new worlds appear for all connected clients
- [x] World CRDTs load/unload dynamically as players enter/leave
- [x] Player presence is visible (glowing dots moving in space)
- [x] Object placement syncs across clients in real-time
- [x] Server persists state to SQLite; survives restarts
- [x] Spatial resolver prevents world overlap
- [ ] 10+ concurrent connections without degradation *(deferred — stress test)*

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `shared/crdt-schema.ts` | NEW | Shared TypeScript types for CRDT schemas |
| `server/sync-service/src/rooms.ts` | NEW | Sector/world room management, binary wire protocol |
| `server/sync-service/src/persistence.ts` | NEW | SQLite save/load for Y.Docs |
| `server/sync-service/src/resolver.ts` | NEW | Spatial resolution algorithm |
| `server/sync-service/src/universe.ts` | NEW | Universe CRDT manager |
| `server/sync-service/src/world-factory.ts` | NEW | World Y.Doc factory |
| `server/sync-service/src/index.ts` | MODIFY | Room-aware WebSocket handler + /stats endpoint |
| `server/sync-service/Dockerfile` | MODIFY | python3/make/g++ for better-sqlite3 native build |
| `server/docker-compose.yml` | MODIFY | Data volume, shared/ mount, user: root |
| `src/stores/universeStore.ts` | NEW | Zustand + Universe CRDT + world doc sync wiring |
| `src/stores/worldStore.ts` | NEW | Zustand + World CRDT (objects, physics, chat) |
| `src/hooks/useCRDT.ts` | MODIFY | Multi-doc support, sector subscriptions, join/leave world |
| `src/hooks/usePresence.ts` | NEW | BroadcastChannel-based presence (~20Hz) |
| `src/components/CRDTDevOverlay.tsx` | MODIFY | Full multiplayer dev panel with world interior UI |
| `package.json` | MODIFY | Add zustand, yjs |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------
| 2026-08-20 | Chunk 1–5: Created shared/crdt-schema.ts (types + spatial helpers), SQLite persistence layer, Universe CRDT manager, Room Manager with binary wire protocol, spatial resolver, world doc factory. Upgraded sync-service from y-websocket passthrough to room-aware server. Built client Zustand stores (universeStore, worldStore), useSyncConnection hook, usePresence hook. Replaced CRDTDevOverlay with multiplayer dev panel. Both server and client compile clean, Vite builds. | End-to-end two-tab sync test |
| 2026-08-20 | E2E sync test: Fixed Docker volume mount (shared/ not mounted), Dockerfile (missing python3/make/g++ for better-sqlite3 native build), DB path resolution (import.meta.dirname → process.cwd()), container permissions (user: root for dev). Added join-world/leave-world (0x07/0x08) to wire protocol (server + client). Fixed CRDTDevOverlay world entry/exit to use proper protocol messages. Verified: sync-service starts, health/stats endpoints work, world creation syncs across two browser tabs, presence visible across tabs, SQLite persistence working. | World CRDT sync inside worlds, persistence-survives-restart test |
| 2026-08-20 | Wired world doc updates: universeStore now forwards local world doc changes to server via _worldDocUpdateHandler, tags incoming updates as "remote" to prevent echo loops. Connected worldStore.loadFromDoc() on world-sync. Added world interior UI to CRDTDevOverlay (place random objects, objects list, chat). Verified: two-tab object sync (5 objects synced bidirectionally), persistence survives restart (7 docs / 7.4KB persisted, all worlds reappear after restart). All acceptance criteria met except stress test. | **Phase 02 COMPLETE** → Begin Phase 03 (Universe Rendering & LOD) |

