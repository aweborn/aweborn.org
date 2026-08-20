# Phase 4 — Offline & Mesh Networking

> **Parent:** [MASTER_PLAN.md](./MASTER_PLAN.md)
> **Status:** 🔴 Not Started
> **Goal:** Two phones in the same room can play together with zero internet. Offline creations sync as ghosts.
> **Prerequisites:** Phase 1 (WebRTC/CRDT infra), Phase 3 (Ghost states for offline creations)

---

## Phase Summary

This is Aweborn's most ambitious technical phase. It implements the offline-first, mesh-networked architecture that lets players create and collaborate without any server or internet connection — then seamlessly sync everything when connectivity returns.

The key insight from ROADMAP.md: **offline creation is just "dreaming."** Everything built offline becomes a Ghost. No mana paradox, no sync conflicts, no validation-on-reconnect headaches.

---

## Milestones

### M4.1 — Service Worker & Offline Shell (PWA)
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** None

#### What
- Register a Service Worker that caches the app shell, JS bundles, and critical assets
- Use IndexedDB (via `y-indexeddb`) to persist Yjs CRDT state locally
- Offline detection UI: visual indicator when disconnected
- The app loads and runs fully offline from cache

#### Acceptance Criteria
- [ ] App loads from cache when device is offline (airplane mode)
- [ ] CRDT state persists in IndexedDB across page reloads
- [ ] Offline indicator visible in HUD
- [ ] `navigator.serviceWorker.ready` resolves before any network-dependent code

#### Tasks
```
- [ ] Configure Vite PWA plugin (or manual service worker registration)
- [ ] Define cache strategy: app shell = cache-first, API calls = network-first
- [ ] Integrate y-indexeddb for local CRDT persistence
- [ ] Offline detection hook: useOnlineStatus()
- [ ] HUD: connection status indicator (online / offline / reconnecting)
- [ ] Verify: enable airplane mode → app loads → CRDT state preserved
```

---

### M4.2 — WebRTC DataChannel (P2P CRDT Sync)
**Status:** 🔴 Not Started
**Effort:** 2 sessions
**Dependencies:** Phase 1 (M1.4 — awareness protocol)

#### What
- Integrate `y-webrtc` for peer-to-peer CRDT sync alongside `y-websocket`
- Dual transport: online mode uses WebSocket to server + optional WebRTC to nearby peers; offline mode uses WebRTC only
- WebRTC DataChannels for high-frequency ephemeral data (avatar positions at ~20-30Hz)
- STUN server configuration for peers on different networks

#### Acceptance Criteria
- [ ] Two browsers connect via WebRTC DataChannel (peer-to-peer)
- [ ] CRDT updates sync over the P2P channel without server involvement
- [ ] High-frequency avatar position updates work over DataChannel (~20-30Hz)
- [ ] Both transports (WebSocket + WebRTC) can operate simultaneously
- [ ] Graceful fallback: if WebRTC fails, WebSocket-only mode works

#### Tasks
```
- [ ] Install and configure y-webrtc in the client
- [ ] Create src/providers/P2PProvider.tsx — WebRTC connection management
- [ ] Dual transport: CRDTProvider supports both y-websocket and y-webrtc
- [ ] Configure STUN servers (Google's free STUN for cross-network)
- [ ] High-frequency DataChannel for avatar positions (bypass CRDT for ephemeral data)
- [ ] Connection state management: track peers, handle disconnects
- [ ] Verify: disconnect server → P2P sync still works between two browsers
```

---

### M4.3 — QR Code Signaling (QWBP)
**Status:** 🔴 Not Started
**Effort:** 2 sessions
**Dependencies:** M4.2

#### What
Implement the two-scan QR handshake for serverless WebRTC setup:

```
Player A: Create Offer → binary-pack with QWBP → display QR
Player B: Scan QR → set remote description → Create Answer → display QR
Player A: Scan QR → set remote description → DataChannel opens!
```

Uses QWBP binary protocol to compress SDP from ~2500 bytes to 55-100 bytes.

#### Acceptance Criteria
- [ ] Player A taps "Host World" → QR code appears with compressed SDP offer
- [ ] Player B scans QR → their QR code appears with compressed SDP answer
- [ ] Player A scans Player B's QR → DataChannel opens within 2 seconds
- [ ] The entire handshake works with zero internet (both on same hotspot)
- [ ] QR codes are small enough to scan reliably in poor lighting

#### Tasks
```
- [ ] Install QWBP library (or implement binary SDP packing)
- [ ] Create src/components/mesh/QRHostScreen.tsx — generate offer QR
- [ ] Create src/components/mesh/QRJoinScreen.tsx — scan offer, show answer QR
- [ ] QR scanning: use browser camera API + QR decoder library
- [ ] Wait for iceGatheringState === "complete" before generating QR
- [ ] Wire up: QR handshake → WebRTC DataChannel → y-webrtc provider
- [ ] UI flow: Host World button → QR screens → connection confirmation
- [ ] Verify: two phones on hotspot (no internet) complete handshake
```

---

### M4.4 — NFC URL Join
**Status:** 🔴 Not Started
**Effort:** 1 session
**Dependencies:** M4.3

#### What
Two NFC-based join methods:

**Online Mode:** NFC tag contains `aweborn.org/join/<worldId>` → phone taps → OS opens browser → joins the WebRTC mesh.

**Offline Mode:** NFC tag contains `aweborn.org/j#<base64-QWBP-offer>` → app reads SDP from URL hash → generates answer QR → one-scan handshake.

#### Acceptance Criteria
- [ ] Online mode: writing a join URL to an NFC tag works; tapping it opens the world
- [ ] Offline mode: SDP-in-URL-hash fits in NTAG215 (504 bytes)
- [ ] The /join/:id route exists and connects to the correct world
- [ ] The /j route reads SDP from hash and initiates WebRTC handshake

#### Tasks
```
- [ ] Create route: /join/:worldId → connect to world via WebSocket signaling
- [ ] Create route: /j → read SDP from window.location.hash → QR answer flow
- [ ] NFC tag writing instructions / helper utility (Web NFC API on Android)
- [ ] Test with NTAG215 tags
- [ ] Verify: tap NFC tag → browser opens → connected to world
```

---

### M4.5 — Offline Ghost Creation
**Status:** 🔴 Not Started
**Effort:** 1-2 sessions
**Dependencies:** Phase 3 (M3.2 — Ghost states), M4.1

#### What
- All offline builds sync as Ghosts on reconnect
- CRDT merge with server happens automatically (Yjs handles this)
- Server's spatial resolver nudges colliding offline creations to nearest open space
- No locally cached mana, no budget, no validation-on-reconnect

#### Acceptance Criteria
- [ ] Go offline → create a world → go online → world appears as Ghost in the Deep Dark
- [ ] Offline edits to existing worlds merge cleanly on reconnect
- [ ] If offline creation collides with an online creation, server nudges it aside
- [ ] The Ghost world is visible to all players after sync
- [ ] No mana is spent for offline creation

#### Tasks
```
- [ ] Offline world creation: write to local Y.Doc (persisted via IndexedDB)
- [ ] Reconnect flow: y-websocket auto-syncs local changes to server
- [ ] Server: detect new worlds from reconnecting clients, run spatial resolver
- [ ] Server: nudge colliding worlds outward to nearest open space
- [ ] Client: animate the "settling" of nudged worlds (gravitational settling visual)
- [ ] Verify: offline create → reconnect → world appears → no data loss
```

---

### M4.6 — Sneakernet CRDT Sync
**Status:** 🔴 Not Started
**Effort:** 1 session
**Dependencies:** M4.3

#### What
Encode CRDT diffs as QR codes for fully async, no-connection sync:

- Build a world offline → encode the CRDT update as a QR code
- A friend scans it later → their world merges the changes automatically
- Like "passing notes" — no network needed, just two cameras

#### Acceptance Criteria
- [ ] A CRDT diff can be encoded as a scannable QR code
- [ ] Scanning the QR code on another device merges the changes
- [ ] Works for typical changes (<1KB CRDT diffs)
- [ ] Larger changes split across multiple QR codes (if needed)

#### Tasks
```
- [ ] Create src/components/mesh/SneakernetExport.tsx — encode diff as QR
- [ ] Create src/components/mesh/SneakernetImport.tsx — scan QR, apply diff
- [ ] Handle multi-QR for larger diffs (chunking protocol)
- [ ] UI: "Share as QR" button in world menu
- [ ] Verify: create object in world A → export QR → scan on device B → object appears
```

---

## Phase Completion Criteria

1. ✅ App works fully offline (PWA, cached shell, IndexedDB persistence)
2. ✅ P2P CRDT sync works over WebRTC DataChannel
3. ✅ QR handshake connects two devices with zero internet
4. ✅ NFC tags join players to worlds (online and offline modes)
5. ✅ Offline creations sync as Ghosts on reconnect
6. ✅ Sneakernet QR sync passes CRDT diffs between devices

**Then:** Update MASTER_PLAN.md status to 🟢.

---

*Last updated: 2026-08-20*
