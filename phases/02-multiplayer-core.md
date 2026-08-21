# Phase 02: Multiplayer Core (CRDT + WebSocket)

**Status:** `[/]` In Progress
**Depends on:** [Phase 01: Foundation & VPS Setup](./01-foundation.md)
**ROADMAP reference:** [The Two-Layer CRDT Architecture & Persistence](../ROADMAP.md#the-two-layer-crdt-architecture--persistence)
**Estimated sessions:** 4-6

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
- `[ ]` Define TypeScript types for Universe CRDT entries (matches ROADMAP spec)
  ```typescript
  interface WorldEntry {
    id: string;
    name: string;
    creator: string;
    intendedPosition: { x: number; y: number; z: number };
    resolvedPosition: { x: number; y: number; z: number };
    resolvedAt: number;
    color: string;
    solidified: boolean;
    solidifiedAt: number;
    playerCount: number;
    lastActive: number;
  }
  ```
- `[ ]` Create `shared/crdt-schema.ts` — shared types between client and server
- `[ ]` Implement Universe Y.Doc initialization on server
- `[ ]` Implement sector assignment logic (hash worldId → sector)

### World CRDT Schema
- `[ ]` Define TypeScript types for World CRDT (meta, physics, objects, terrain, chat)
- `[ ]` Implement World Y.Doc factory function
- `[ ]` Per-world physics parameters (gravity, friction, bounce, water level)
- `[ ]` Object placement schema (Y.Map of objects with type, position, rotation, scale, material)

### Server: Room Management
- `[ ]` Implement sector-based WebSocket rooms
- `[ ]` Universe room: clients subscribe based on current position
- `[ ]` World rooms: clients join when entering a world, leave when exiting
- `[ ]` Lazy load World Y.Docs into RAM when first player enters
- `[ ]` Flush World Y.Docs to SQLite when last player leaves
- `[ ]` Periodic flush (every 60s) for active worlds

### Server: Persistence Layer
- `[ ]` Set up SQLite database (`server/data/universe.db`)
- `[ ]` Table: `worlds` — stores serialized Y.Doc state vectors
- `[ ]` Table: `universe_sectors` — stores sector CRDT state
- `[ ]` Implement save/load functions for Y.Doc ↔ SQLite
- `[ ]` Add graceful shutdown: flush all in-memory docs before exit

### Server: Spatial Resolver
- `[ ]` Implement deterministic spatial resolution (ROADMAP spec)
- `[ ]` Sort worlds by timestamp, nudge overlapping worlds outward
- `[ ]` Write `resolvedPosition` back to Universe CRDT
- `[ ]` Minimum distance enforcement between worlds

### Client: CRDT Integration
- `[ ]` Upgrade `useCRDT.ts` hook to support Universe + World docs
- `[ ]` Create `src/stores/universeStore.ts` — Zustand store backed by Universe CRDT
- `[ ]` Create `src/stores/worldStore.ts` — Zustand store backed by active World CRDT
- `[ ]` Implement sector subscription (subscribe/unsubscribe based on camera position)
- `[ ]` Implement world enter/exit flow (join world room, load world CRDT)

### Client: Player Presence
- `[ ]` Implement Yjs awareness protocol for player positions
- `[ ]` Broadcast: `{ id, position, velocity, inWorld, color }` at ~20Hz
- `[ ]` Receive and interpolate other players' positions
- `[ ]` Handle player join/leave events

### World Creation Flow
- `[ ]` "Plant where you stand" — create world at current camera position
- `[ ]` Client writes `intendedPosition` to Universe CRDT
- `[ ]` Server resolves position, writes `resolvedPosition`
- `[ ]` Client animates world to resolved position ("gravitational settling")

## Acceptance Criteria

- [ ] Universe CRDT stores world entries; new worlds appear for all connected clients
- [ ] World CRDTs load/unload dynamically as players enter/leave
- [ ] Player presence is visible (glowing dots moving in space)
- [ ] Object placement syncs across clients in real-time
- [ ] Server persists state to SQLite; survives restarts
- [ ] Spatial resolver prevents world overlap
- [ ] 10+ concurrent connections without degradation

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `shared/crdt-schema.ts` | NEW | Shared TypeScript types for CRDT schemas |
| `server/src/rooms.ts` | NEW | Sector/world room management |
| `server/src/persistence.ts` | NEW | SQLite save/load for Y.Docs |
| `server/src/resolver.ts` | NEW | Spatial resolution algorithm |
| `src/stores/universeStore.ts` | NEW | Zustand + Universe CRDT |
| `src/stores/worldStore.ts` | NEW | Zustand + World CRDT |
| `src/hooks/useCRDT.ts` | MODIFY | Multi-doc support, sector subscriptions |
| `src/hooks/usePresence.ts` | NEW | Yjs awareness for player positions |
| `package.json` | MODIFY | Add zustand |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-08-20 | Chunk 1–5: Created shared/crdt-schema.ts (types + spatial helpers), SQLite persistence layer, Universe CRDT manager, Room Manager with binary wire protocol, spatial resolver, world doc factory. Upgraded sync-service from y-websocket passthrough to room-aware server. Built client Zustand stores (universeStore, worldStore), useSyncConnection hook, usePresence hook. Replaced CRDTDevOverlay with multiplayer dev panel. Both server and client compile clean, Vite builds. | End-to-end two-tab sync test |
| 2026-08-20 | E2E sync test: Fixed Docker volume mount (shared/ not mounted), Dockerfile (missing python3/make/g++ for better-sqlite3 native build), DB path resolution (import.meta.dirname → process.cwd()), container permissions (user: root for dev). Added join-world/leave-world (0x07/0x08) to wire protocol (server + client). Fixed CRDTDevOverlay world entry/exit to use proper protocol messages. Verified: sync-service starts, health/stats endpoints work, world creation syncs across two browser tabs, presence visible across tabs, SQLite persistence working. | Check off Phase 02 task checkboxes; remaining work: world CRDT sync inside worlds (enter world → object placement sync across tabs), persistence-survives-restart test |
