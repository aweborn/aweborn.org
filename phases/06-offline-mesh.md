# Phase 06: Offline & Mesh Networking

**Status:** `[~]` PWA + cold-start offline shipped (2026-10-22); connectivity chip + IndexedDB shipped (Rough Draft M7a, 2026-10-28); mesh next (M7b)
**Depends on:** [Phase 02: Multiplayer Core](./02-multiplayer-core.md)
**ROADMAP reference:** [Offline & Off-Grid Networking](../ROADMAP.md#offline--off-grid-networking)
**Estimated sessions:** 3-4

## Goal

Make Aweborn work **without internet**. Two phones in the same room (or in the woods) can join each other's world with zero connectivity. Offline creations sync when reconnecting and are placed by the server like any other world (solid inside the Frontier, a Ghost on the universe map outside it; see [Phase 05](./05-mana-economy.md#architecture-decisions)). The app is a PWA with Service Worker caching — it loads and runs even without a network.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Offline storage | Service Worker + IndexedDB | PWA standard, works everywhere |
| P2P transport | WebRTC DataChannels via y-webrtc | Browser-native, Yjs integration built in |
| QR signaling | QWBP (55-100 bytes) | Reliable scanning, fits small QR codes |
| NFC | NDEF URL records (OS-handled, not Web NFC API) | Works on both iOS and Android natively |
| Reconnect strategy | Yjs auto-merge + server spatial resolution | CRDT guarantees no conflicts |
| Dual-mode | Online (custom WebSocket room protocol to VPS) + Offline (y-webrtc P2P) simultaneously | Seamless transition. *Note: the online path is not y-websocket (see phases/README Technical Notes), so reconnect/state-vector sync must go through the `universe-sync` / `world-sync` messages.* |
| Player movement offline / in a mesh | **[Phase 09](./09-authoritative-flight.md)** shared sim: peers exchange *inputs* and simulate each other; each player's input log is replayed by the server on reconnect | Same code online, offline and in a mesh; offline cheating capped at what a perfect honest flier could do (2026-10-12) |

## Tasks

### Service Worker & PWA
- `[x]` Create `public/sw.js` — Service Worker for offline caching *(2026-10-22, registered + warmed in `src/main.tsx`)*
- `[x]` Cache strategy: cache-first for static assets, network-first for API calls *(network-first navigation → cached `/index.html`; cache-first hashed bundles + `<sha256>.glb`)*
- `[x]` Add `manifest.json` for PWA (installable on mobile) — *shipped as `public/site.webmanifest`*
- `[x]` Offline detection: `navigator.onLine` + `online`/`offline` events *(M7a: `src/hooks/useConnectivity.ts`; `useCRDT` now drops the socket on `offline` so edits queue instead of going into a dead socket)*
- `[x]` IndexedDB: persist Yjs Y.Doc state locally for offline access *(M7a: `src/lib/offlineCache.ts` on IndexedDB `aweborn-offline`, raw bytes, in-memory mirror so reads stay sync; one-time move from localStorage; localStorage fallback)*
- `[x]` Test: load aweborn.org → go offline → app still works *(2026-10-22)*

### WebRTC P2P (y-webrtc)
- `[~]` Install `y-webrtc` and configure alongside the existing WebSocket room protocol (`useCRDT.ts`) *(M7b deviation: no y-webrtc (it needs a signaling server, which defeats offline). `src/lib/mesh.ts` runs its own `RTCPeerConnection` + negotiated DataChannel next to the room socket)*
- `[x]` Dual provider setup: Yjs doc syncs over both WebSocket AND WebRTC *(M7b: the active world doc; peer updates carry a `mesh` origin and are never forwarded to the server: each phone uploads only its own queue)*
- `[~]` P2P connection management (discover peers on same LAN via signaling) *(M7b: QR signaling instead of discovery; star with the host relaying, up to 6 links)*
- `[ ]` Ephemeral data over DataChannels (avatar positions, voice) — *replaces/augments the current WebSocket presence relay (msg `0x09`) for scale*. **Phase 09:** movement goes over DataChannels as *inputs*, not positions (milestone 9E)
- `[x]` Graceful fallback: WebRTC fails → WebSocket only, and vice versa *(M7b: each runs on its own; a failed link shows a retry, the socket keeps going)*

### QR Code Signaling (QWBP)
- `[~]` Install/integrate QWBP library *(M7b deviation: own compact codec `shared/mesh-signal.ts` (ufrag, pwd, fingerprint, ≤4 candidates, worldId), a real Chrome offer packs to 119 bytes; tests in `mesh-signal.test.ts`)*
- `[x]` Create `src/components/QRHostPanel.tsx` — Host World flow *(M7b: one panel for both sides, `src/components/MeshPanel.tsx`, lazy)*:
  1. Create RTCPeerConnection
  2. Wait for ICE gathering complete
  3. Binary-pack offer via QWBP
  4. Display as QR code on screen
  5. After scanning answer QR → connection established
- `[x]` Create `src/components/QRJoinPanel.tsx` — Join World flow *(M7b: same `MeshPanel.tsx`; camera via BarcodeDetector, else jsQR; paste fallback)*:
  1. Scan host's QR code (camera API)
  2. Create RTCPeerConnection
  3. Set remote description from scanned offer
  4. Create answer, wait for ICE complete
  5. Display answer as QR code
  6. Host scans → DataChannel opens
- `[x]` Two-scan handshake: host displays QR → joiner scans → joiner displays QR → host scans → connected *(M7b, tested between two browser contexts with the paste path; not yet on two real phones)*
- `[x]` Pipe Yjs CRDT updates through the DataChannel *(M7b: state vectors on open / world change, then updates; >16 KB split into chunks; presence too)*

### NFC URL Support (Tap-to-Join)

> **Scope note:** This section covers *session* join links (`/join/…`, `/j#<sdp>`). World teleport links on NFC **trading cards** (`/w/<uuidv4>`) plus the World Index live in [Phase 08](./08-nfc-trading-cards.md). Phase 08 depends on this phase's Service Worker for offline card taps. Share the URL-parsing boot code between `Join.tsx` and Phase 08's `TeleportSystem`.

- `[ ]` Online mode: `aweborn.org/join/<worldId>` — deep link route
- `[ ]` Create `src/pages/Join.tsx` — handles join URL, connects to world
- `[x]` Offline mode: `aweborn.org/j#<base64-QWBP-offer>` — SDP in URL hash *(M7b: the host's QR is `/j#<b64url>`, so a phone camera opens the game and joins)*
- `[x]` Join page reads `window.location.hash`, extracts SDP, generates answer *(M7b: `takeJoinLink()` in `main.tsx`, no separate page)*
- `[ ]` Documentation: how to write join URLs to NFC stickers
- `[~]` *(M7c: a tap on a world this phone has never seen, while offline, is saved (`aweborn.waiting-tap`, 6 h) and opens by itself on `online` or the next boot; known worlds already open offline from the cache. The World Index entry is recorded on arrival, not queued blind (we don't know the world's name offline))* Offline card tap (Phase 08): if `/w/<uuid>` is opened offline, serve cached app and queue a *pending* World Index entry

### Offline Reconnect
- `[x]` *(M7c: after a full `world-sync`, the client sends what its own Yjs client wrote beyond the server's state vector (`ownUnsentEdits` in `universeStore.ts`): edits that went into a dying socket now arrive. Own client only, so mesh peers' edits are never uploaded for them)* On reconnect: re-run `universe-sync` / `world-sync` state-vector exchange over the room protocol to push local state to the VPS
- `[ ]` On reconnect: upload the offline input log for server replay ([Phase 09](./09-authoritative-flight.md) 9C); the IndexedDB store here hosts it
- `[x]` Server validates structural changes, resolves collisions *(M1 world authority validates; M7c adds the collision nudge below)*
- `[ ]` Offline creations sync and are placed by the same rule as any world (born solid inside the Frontier, else a Ghost on the map until its meter fills; Phase 05); show the "settling" shimmer meanwhile
- `[x]` If offline creation collides with online creation → server nudges it to nearest open space *(M7c: `shared/nudge.ts` + `WorldAuthority.apply`: a new object on the same spot (every axis < 0.3) as another player's moves to the first free spot on rings of 8 around it; own objects and neighbours never move; skipped in worlds with > 5,000 objects)*
- `[x]` Client sees object smoothly slide into resolved position *(M7c: the server writes `nudge {fx, fz, t}`; `PlacedObjectMesh` glides it over 0.9 s, only if fresh)*

### Tiered Connectivity UI
- `[~]` Status indicator in HUD showing connectivity tier *(M7a: `SyncBridge` chip shows solo + reconnecting; online shows nothing. M7b: yellow "No internet: playing with N nearby players")*:
  - 🟢 Online (WebSocket to VPS)
  - 🟡 Local mesh (WebRTC P2P only)
  - 🔴 Solo offline (local only)
- `[x]` Seamless transitions — no user action needed when connectivity changes *(M7a: offline → queue in IndexedDB → `online` reconnects and drains it)*

## Acceptance Criteria

- [ ] App loads and runs fully offline (Service Worker cached)
- [ ] Two phones on the same hotspot can connect via QR code with zero internet
- [ ] CRDT changes sync over WebRTC DataChannel
- [ ] Offline creations persist in IndexedDB and sync on reconnect, placed by the server (solid inside the Frontier, else Ghost)
- [ ] NFC URL deep-links work (online: join room, offline: SDP in hash)
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
| 2026-10-28 | **Rough Draft M7a.** (1) `offlineCache.ts` moved from localStorage (base64) to IndexedDB (`aweborn-offline` / `kv`, raw `Uint8Array`), keeping the same synchronous API via an in-memory mirror that `initOfflineCache()` loads before the first render (`main.tsx`, open capped at 1.5 s, then `universeStore.hydrateFromOfflineCache()`). Docs are marked dirty and encoded once per 400 ms (before: a full `encodeStateAsUpdate` + base64 into localStorage on every edit) and flushed on pagehide / tab hidden / before a world doc is destroyed; the offline edit queue is written at once. Old localStorage copies move over once and are removed only after IndexedDB commits; if IndexedDB can't open, the same data stays in localStorage. (2) Connectivity tier: `useConnectivity.ts` (online / reconnecting / solo) feeds the `SyncBridge` chip, now an always-mounted polite live region: *Offline: playing solo…* (at once, with “changes in N worlds will sync”) or *Reconnecting…* (after 4 s). **Deviation:** the online tier shows nothing rather than a green dot (the phone HUD is full; silence = fine). (3) **Found + fixed:** Chrome keeps a WebSocket “open” after the network drops, so edits were sent into it and lost instead of queued; `useCRDT` now closes the socket on `offline` and skips reconnect attempts until `online`. Verified locally (puppeteer): migration (legacy key → IndexedDB, localStorage cleared), offline edit → `pending:<id>` in IndexedDB → back online → drained and present on the server for a fresh client; reconnecting chip on a real server stop; chip at 390×844, 360×740, 844×390, 1440×900 with no overlap (moved to 80 px under the world pill). **Known gap:** a socket whose server vanishes without closing TCP (`docker pause`) stays “connected”: there's no heartbeat yet. Privacy updated (cached worlds + offline changes on the device). | M7b: WebRTC peers + QR two-scan host/join (mesh tier in the chip) |
| 2026-10-28 | **Rough Draft M7b: Play nearby.** ••• More → *Play nearby* (desktop: gear panel). Host shows a QR (`/j#…`), the other phone scans it (camera, or paste) and shows one back, the host scans that: WebRTC DataChannel, no STUN/TURN, so both phones must share a Wi-Fi or hotspot. Over the link: the active world's Y.Doc (state vectors, then updates; host relays between joiners; max 6) and presence. Peer edits are cached locally but never sent to the server or queued; each phone uploads only its own edits, so the server still checks every edit against its author. Deviations: own compact SDP codec (`shared/mesh-signal.ts`) instead of QWBP; no y-webrtc. Privacy: *Playing nearby* paragraph (codes contain local network addresses). Checked: two browser contexts paired via paste, both offline, edits both ways + presence over the link, chip at 390/360/844, panel at 390/360/844/1440 (landscape two-column, no scroll), Esc/backdrop close, Disconnect closes both sides. **Not tested on real phones / a hotspot.** Known gap: a joiner's edit that builds on the host's not-yet-uploaded edits stays pending on the server until the host reconnects. | M7c: reconnect state-vector push, collision nudge + settling shimmer, offline card-tap pending entry, socket heartbeat; two real phones on a hotspot |
| 2026-10-28 | **Rough Draft M7c.** (1) **Heartbeat:** new message `0x0c ping` (client every 15 s while visible; server echoes, max one per 2 s per socket, not counted as activity). Once a socket has answered, 40 s of silence recycles it, so a server that vanished without closing TCP shows *Reconnecting…* (checked with `docker pause`: noticed after 52 s). (2) **Reconnect push:** after a full world-sync the client sends its own client's edits the server lacks (checked: an object placed into the frozen socket reached the server after reconnect). (3) **Collision nudge** (`shared/nudge.ts`, 4 tests + 1 authority test) with a client glide. Checked between two players in Builders Test. (4) **Offline card tap** for unknown worlds: saved, opens when back online (checked: offline → *Saved for when you’re online*; online → lookup ran, the fake id got *This world has faded*, key cleared). Privacy: the saved tap is mentioned under *On your device*. Not done: the "settling" shimmer (worlds can't be created offline, so there's nothing to settle yet) and the offline input log (Phase 09 9C). | M7 rough draft done. Next: M8 (Phase 09 authority) |
