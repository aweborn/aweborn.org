# Phase 0 — Foundation & Infrastructure

> **Parent:** [MASTER_PLAN.md](./MASTER_PLAN.md)
> **Status:** 🔴 Not Started
> **Goal:** Prepare the codebase and server infrastructure for multiplayer.

---

## Phase Summary

Before any multiplayer features can land, we need three foundational pieces:
1. A **stateful server** that can hold Yjs documents in memory and relay WebSocket updates
2. **Yjs integrated** into the frontend so the client can connect and sync CRDTs
3. A **project restructure** to support shared types between client and server

This phase produces no user-visible features — it's pure infrastructure. But it's the foundation everything else builds on.

---

## Milestones

### M0.1 — Project Restructure & Planning Hierarchy
**Status:** 🔴 Not Started
**Effort:** 1 session
**Dependencies:** None

#### What
- Create `docs/plans/` directory with the full planning hierarchy (this phase plan + all others)
- Set up npm workspaces or a simple `shared/` directory for types shared between client and server
- Create a `server/` directory at project root for the stateful Node.js server
- Add a `shared/types.ts` with initial type definitions (WorldMeta, UniverseCRDT structure, PlayerPresence)

#### Acceptance Criteria
- [ ] `docs/plans/` exists with MASTER_PLAN.md and all phase plans
- [ ] `server/` directory exists with a `package.json` and TypeScript config
- [ ] `shared/types.ts` defines initial CRDT type interfaces matching ROADMAP.md
- [ ] `npm install` works in both `server/` and root (client) directories
- [ ] Links from ROADMAP.md and HANDOFF.md point to MASTER_PLAN.md

#### Tasks
```
- [ ] Create docs/plans/ with all phase plan files
- [ ] Create server/ directory with package.json, tsconfig.json
- [ ] Create shared/types.ts with WorldMeta, PlayerPresence, UniverseMana interfaces
- [ ] Configure npm workspaces (or simple path aliases) for shared types
- [ ] Add "Implementation Plan" link to ROADMAP.md and HANDOFF.md
- [ ] Verify: npm install succeeds, tsc compiles shared types
```

---

### M0.2 — Stateful Server (Local Dev)
**Status:** 🔴 Not Started
**Effort:** 1 session
**Dependencies:** M0.1

#### What
- Create a minimal Node.js + TypeScript server in `server/`
- WebSocket listener using `ws` or `y-websocket` server utility
- Yjs document management: create/load Y.Doc per room, hold in memory
- Health check endpoint (`GET /health`)
- Graceful shutdown (flush in-memory state)
- Dev script: `npm run dev:server` starts with hot-reload (tsx or nodemon)

> **Note:** This is a LOCAL dev server only. Cloud VPS provisioning (Lightsail) is deferred until we need it for staging/production. This keeps Phase 0 cost-free.

#### Acceptance Criteria
- [ ] `npm run dev:server` starts a WebSocket server on port 3001
- [ ] `curl http://localhost:3001/health` returns `200 OK`
- [ ] Server creates Y.Doc instances per room name
- [ ] Server logs connections/disconnections
- [ ] Server compiles with zero TypeScript errors

#### Tasks
```
- [ ] npm init in server/, install dependencies (ws, yjs, y-websocket, tsx)
- [ ] Create server/src/index.ts — HTTP server + WebSocket upgrade
- [ ] Create server/src/rooms.ts — room manager (create/get/destroy Y.Doc per roomId)
- [ ] Add health check route
- [ ] Add graceful shutdown handler (SIGTERM/SIGINT → log + cleanup)
- [ ] Add dev script to root package.json
- [ ] Verify: server starts, health check passes, no TS errors
```

---

### M0.3 — Yjs Client Integration
**Status:** 🔴 Not Started
**Effort:** 1 session
**Dependencies:** M0.2

#### What
- Add `yjs`, `y-websocket`, and `y-webrtc` to the frontend `package.json`
- Create a React context/provider (`CRDTProvider`) that manages the Yjs connection lifecycle
- Create a hook (`useUniverse`) that returns the Universe CRDT data as React state
- Wire up the provider in `App.tsx`
- Dev proxy: Vite proxies `/ws` to the local server on port 3001

#### Acceptance Criteria
- [ ] Two browser tabs connect to the local Yjs server
- [ ] Both tabs see a shared `Y.Map("test")` update in real time
- [ ] Editing a value in Tab A immediately appears in Tab B
- [ ] Connection status indicator in the React app (connected / disconnected / reconnecting)
- [ ] Clean unmount: closing a tab properly disconnects from the server

#### Tasks
```
- [ ] npm install yjs y-websocket y-webrtc in root (client)
- [ ] Create src/providers/CRDTProvider.tsx — React context for Yjs connection
- [ ] Create src/hooks/useUniverse.ts — reads Y.Map("universe") as React state
- [ ] Create src/hooks/useCRDTConnection.ts — connection status management
- [ ] Add Vite proxy config for /ws → localhost:3001
- [ ] Wire CRDTProvider into App.tsx
- [ ] Create a temporary debug panel showing CRDT state (remove later)
- [ ] Verify: two tabs sync a Y.Map in real time
```

---

## Phase Completion Criteria

All three milestones pass their acceptance criteria:
1. ✅ Project restructured with shared types, server directory, and planning hierarchy
2. ✅ Local dev server running with WebSocket support and Yjs room management
3. ✅ Frontend connects to server, two tabs sync a CRDT in real time

**Then:** Update MASTER_PLAN.md status to 🟢, move active phase to Phase 1.

---

## Technical Notes

### Why Local Dev Server First?

The ROADMAP calls for a Lightsail VPS (~$10/mo). But for Phase 0, a local dev server is sufficient to validate the architecture. Benefits:
- Zero cost during development
- Faster iteration (no deploy cycle)
- Same code deploys to VPS later with minimal changes (just different host/port)

### Yjs Library Choices

| Package | Purpose | When Used |
|---------|---------|-----------|
| `yjs` | Core CRDT library | Always — the data layer |
| `y-websocket` | WebSocket transport provider | Online mode — connects to stateful server |
| `y-webrtc` | WebRTC transport provider | P2P mode — Phase 4 (offline/mesh) |

All three are installed now so the dependency tree is stable, but `y-webrtc` won't be wired up until Phase 4.

---

*Last updated: 2026-08-20*
