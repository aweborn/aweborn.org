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

### Network-less play (Alex, 2026-10-31: a defining feature)
> *"If two people are playing on the metro and the signals cut out for seconds or minutes at a time, we NEED that local pairing. We absolutely need something for very flaky networking."* A web page can't find a nearby phone without a shared network (no Bluetooth / peer-to-peer Wi-Fi in browsers; metro Wi-Fi usually blocks phone-to-phone), so true local pairing needs a native app. Alex wants the app (C) and is OK with the store fees ($99/yr Apple, $25 Google).
- `[x]` **A1 (2026-10-31):** flaky-network presence: a player we stop hearing from glides along their last velocity (eases out, ≤ 1.5 s worth), dims, and is kept while *our* link is down (no socket + no mesh: 2 min; nobody heard for 1.5 s: 30 s; else 3 s) (`usePresence.ts`, `PlayerStars.tsx`; interiors glide but don't dim yet)
- `[x]` **A3 (2026-10-31):** Play nearby tip: different networks or a train → Personal Hotspot on one phone
- `[x]` **A2 (2026-10-31):** auto-pair (no QR) when online: the server introduces players in the same world from the same public IP; WebRTC host candidates only (same network), so the link survives the internet dropping. Signaling over the room socket (new message type); cap peers (`MAX_MESH_PEERS`). → `server/sync-service/src/mesh-intro.ts` (groups by world + IP, newcomer offers to the group's hub, SDP relayed only inside the group, 30 signals / 10 s, 8 KB cap; `/stats` → `meshIntro`), `0x12 mesh-signal`, `mesh.ts` auto links (silent on failure; hub passes peers' presence on once as `T_PRESENCE_RELAYED`; `T_HELLO` page id drops a duplicate link after a socket reconnect)
- `[x]` **A4 (2026-10-31):** faster resume after a drop: reconnect backoff capped at 5 s (was 10 s), heartbeat every 5 s with a 12 s silence limit (was 15 s / 40 s), so a dead socket on flaky cellular is replaced in ~12 s instead of ~55 s. *Not done:* dimming players inside worlds (they glide but don't dim)
- `[ ]` **B:** real-device spike, iPhone ↔ Android, no network: Google Nearby Connections on both (iOS package), fallback Bluetooth LE peripheral/central. Go/no-go for D
- `[ ]` **C:** app shell: Capacitor build of aweborn.org (one codebase), universal links (card taps open the app if installed), TestFlight + Play internal testing, store listings. **Bundle the game in the app** (not a webview of the live site), so it opens with no network at all. **Blocked on tools (2026-10-31):** this Mac has no Xcode, CocoaPods, Android SDK or Java; B and C need them (see ROUGH_DRAFT → Waiting on Alex)
- `[ ]` **D:** native nearby link as a mesh transport (mesh.ts already exchanges bytes per link); automatic discovery while the app is open. **Decided (Alex, 2026-10-31):** players you've linked with before link automatically; strangers are asked first

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
| 2026-10-31 | **Network-less play: decision + A1/A3.** Alex: network-less play is a defining feature (metro drops of seconds to minutes); wants the native app (C) eventually, fees OK. Plan A–D added under Tasks. Built A1 (remote players glide on their last velocity with an ease-out, dim and are held while our link is down: 2 min with no socket and no mesh, 30 s if nobody is heard for 1.5 s, else 3 s; `setPresenceSocketUp` from `useCRDT`) and A3 (Personal Hotspot tip in Play nearby). Checks: tsc, oxlint (11 baseline), vite build. **Not tested on phones or with a real drop**; interior players glide but don't dim. | A2 auto-pair on the same network; A4; then B spike (needs an iPhone + an Android phone) |
| 2026-10-31 | **A2: mesh auto-pairing while online.** The server introduces screens in the same world from the same public IP; the newcomer offers to the group's hub over `0x12 mesh-signal`; SDP relayed only within the group (budget 30 / 10 s). Host candidates only, so a link forms only on one local network and survives the internet dropping. Star: the hub passes each peer's presence on once (`T_PRESENCE_RELAYED`); `T_HELLO` drops a second link between the same two pages (a reconnect gets a new token while the old link still works). Privacy: *Playing nearby* explains automatic connections and that local addresses pass through the server, not stored. Checks: tsc (app + server), oxlint 11 baseline, sync 134 (new `mesh-intro.test.ts`) + shared 120 tests; local: two separate players in one world → 1 intro, 2 relayed, a connected WebRTC link on both (survived a server restart mid-test). **Not tried on phones / real Wi-Fi** (Chrome and Safari use mDNS `.local` candidates; some Wi-Fi blocks peer traffic). D decision: players linked before link automatically, strangers asked. | A4 faster resume + interior dim; then B (needs an iPhone + Android) and C |
| 2026-10-31 | **A4: faster resume.** Reconnect backoff max 5 s; heartbeat 5 s with a 12 s silence limit (server echoes at most one ping per 2 s, so 5 s is within it). A1–A4 done except dimming inside worlds. **B and C blocked on native tools**: no Xcode / CocoaPods / Android SDK / Java on this Mac; queued for Alex (Apple Developer + Google Play accounts, Xcode, Android Studio, an Android phone). | Alex installs the tools → B spike → C app shell |

## Age grill impact (2026-11-07, not built)
- The host phone relays its whole world doc to mesh peers with no checks, and IndexedDB and service-worker caches are per device, never wiped on sign-out. For 18+ worlds: joining over the mesh needs a **door token**, and 18+ content goes in a **separate device store, wiped on sign-out or when *Show 18+* is turned off** ([containment](./07-genai-creation.md#containment-18-never-leaks-into-everyone-worlds-alex-2026-11-07), [inventory §9](../docs/research/2026-11-adult-models/reconciliation-inventory.md#9-offline--mesh--infra)).
- **Decided (Alex, 2026-11-10):** physical rooms work the same as everywhere. There is no event mode: each device, a TV included, follows the door of the player signed in on it, and a mesh host never relays 18+ content to a peer without its own door token.
