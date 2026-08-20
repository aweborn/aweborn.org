# Phase 06: Offline & Mesh Networking

**Status:** `[ ]` Not Started
**Depends on:** [Phase 02: Multiplayer Core](./02-multiplayer-core.md)
**ROADMAP reference:** [Offline & Off-Grid Networking](../ROADMAP.md#offline--off-grid-networking)
**Estimated sessions:** 3-4

## Goal

Make Aweborn work **without internet**. Two phones in the same room (or in the woods) can join each other's world with zero connectivity. All offline creations sync as Ghosts when reconnecting. The app is a PWA with Service Worker caching — it loads and runs even without a network.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Offline storage | Service Worker + IndexedDB | PWA standard, works everywhere |
| P2P transport | WebRTC DataChannels via y-webrtc | Browser-native, Yjs integration built in |
| QR signaling | QWBP (55-100 bytes) | Reliable scanning, fits small QR codes |
| NFC | NDEF URL records (OS-handled, not Web NFC API) | Works on both iOS and Android natively |
| Reconnect strategy | Yjs auto-merge + server spatial resolution | CRDT guarantees no conflicts |
| Dual-mode | Online (y-websocket to VPS) + Offline (y-webrtc P2P) simultaneously | Seamless transition |

## Tasks

### Service Worker & PWA
- `[ ]` Create `public/sw.js` — Service Worker for offline caching
- `[ ]` Cache strategy: cache-first for static assets, network-first for API calls
- `[ ]` Add `manifest.json` for PWA (installable on mobile)
- `[ ]` Offline detection: `navigator.onLine` + `online`/`offline` events
- `[ ]` IndexedDB: persist Yjs Y.Doc state locally for offline access
- `[ ]` Test: load aweborn.org → go offline → app still works

### WebRTC P2P (y-webrtc)
- `[ ]` Install `y-webrtc` and configure alongside `y-websocket`
- `[ ]` Dual provider setup: Yjs doc syncs over both WebSocket AND WebRTC
- `[ ]` P2P connection management (discover peers on same LAN via signaling)
- `[ ]` Ephemeral data over DataChannels (avatar positions, voice)
- `[ ]` Graceful fallback: WebRTC fails → WebSocket only, and vice versa

### QR Code Signaling (QWBP)
- `[ ]` Install/integrate QWBP library
- `[ ]` Create `src/components/QRHostPanel.tsx` — Host World flow:
  1. Create RTCPeerConnection
  2. Wait for ICE gathering complete
  3. Binary-pack offer via QWBP
  4. Display as QR code on screen
  5. After scanning answer QR → connection established
- `[ ]` Create `src/components/QRJoinPanel.tsx` — Join World flow:
  1. Scan host's QR code (camera API)
  2. Create RTCPeerConnection
  3. Set remote description from scanned offer
  4. Create answer, wait for ICE complete
  5. Display answer as QR code
  6. Host scans → DataChannel opens
- `[ ]` Two-scan handshake: host displays QR → joiner scans → joiner displays QR → host scans → connected
- `[ ]` Pipe Yjs CRDT updates through the DataChannel

### NFC URL Support (Tap-to-Join)
- `[ ]` Online mode: `aweborn.org/join/<worldId>` — deep link route
- `[ ]` Create `src/pages/Join.tsx` — handles join URL, connects to world
- `[ ]` Offline mode: `aweborn.org/j#<base64-QWBP-offer>` — SDP in URL hash
- `[ ]` Join page reads `window.location.hash`, extracts SDP, generates answer
- `[ ]` Documentation: how to write join URLs to NFC stickers

### Sneakernet CRDT Sync
- `[ ]` Create `src/components/SneakernetSync.tsx`
- `[ ]` Export CRDT diff as QR code (tiny — often < 1KB)
- `[ ]` Import: scan someone's QR → merge changes into local state
- `[ ]` No live connection needed — "passing notes" between devices

### Offline Reconnect
- `[ ]` On reconnect: y-websocket auto-syncs local state to VPS
- `[ ]` Server validates structural changes, resolves collisions
- `[ ]` Offline creations sync as Ghost worlds
- `[ ]` If offline creation collides with online creation → server nudges it to nearest open space
- `[ ]` Client sees object smoothly slide into resolved position

### Tiered Connectivity UI
- `[ ]` Status indicator in HUD showing connectivity tier:
  - 🟢 Online (WebSocket to VPS)
  - 🟡 Local mesh (WebRTC P2P only)
  - 🔴 Solo offline (local only)
- `[ ]` Seamless transitions — no user action needed when connectivity changes

## Acceptance Criteria

- [ ] App loads and runs fully offline (Service Worker cached)
- [ ] Two phones on the same hotspot can connect via QR code with zero internet
- [ ] CRDT changes sync over WebRTC DataChannel
- [ ] Offline creations persist in IndexedDB and sync as Ghosts on reconnect
- [ ] NFC URL deep-links work (online: join room, offline: SDP in hash)
- [ ] Sneakernet QR sync works (export diff → scan → merge)
- [ ] Connectivity status displayed in HUD
- [ ] No data loss on reconnect — CRDT merge handles all cases

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `public/sw.js` | NEW | Service Worker |
| `public/manifest.json` | NEW | PWA manifest |
| `src/components/QRHostPanel.tsx` | NEW | QR code hosting flow |
| `src/components/QRJoinPanel.tsx` | NEW | QR code joining flow |
| `src/components/SneakernetSync.tsx` | NEW | Async QR CRDT sync |
| `src/pages/Join.tsx` | NEW | NFC/URL join handler |
| `src/hooks/useCRDT.ts` | MODIFY | Dual provider (WebSocket + WebRTC) |
| `src/hooks/useOfflineStorage.ts` | NEW | IndexedDB persistence for Y.Docs |
| `src/components/HUD.tsx` | MODIFY | Connectivity status indicator |
| `package.json` | MODIFY | Add y-webrtc, qwbp, qrcode deps |
| `index.html` | MODIFY | Link manifest, register SW |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| — | — | — |
