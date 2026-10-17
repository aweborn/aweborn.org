# Aweborn.org — Future Roadmap

> **📋 Implementation Plan:** This document is the design bible. For the actionable, phased implementation plan, see [phases/README.md](./phases/README.md).

## Table of Contents

<!-- toc -->

- [Multiplayer & Mesh Networking](#multiplayer--mesh-networking)
  * [Architecture Concepts: The Hybrid P2P / Client-Server Model](#architecture-concepts-the-hybrid-p2p--client-server-model)
  * [Offline & Off-Grid Networking](#offline--off-grid-networking)
    + [Can We Use Bluetooth from the Browser?](#can-we-use-bluetooth-from-the-browser)
    + [Tiered Connectivity Strategy](#tiered-connectivity-strategy)
    + [NFC URL Deep-Dive (Tap-to-Join)](#nfc-url-deep-dive-tap-to-join)
      - [Online Mode: Join Link](#online-mode-join-link)
      - [Offline Mode: SDP-in-URL-Hash](#offline-mode-sdp-in-url-hash)
    + [QR Code Signaling Deep-Dive (Primary Offline Strategy)](#qr-code-signaling-deep-dive-primary-offline-strategy)
      - [The QWBP Approach (QR-WebRTC Bootstrap Protocol)](#the-qwbp-approach-qr-webrtc-bootstrap-protocol)
      - [The Two-Scan Handshake Flow](#the-two-scan-handshake-flow)
      - [Key Implementation Notes](#key-implementation-notes)
      - [Sneakernet CRDT Sync (Async / No Live Connection)](#sneakernet-crdt-sync-async--no-live-connection)
  * [The Two-Layer CRDT Architecture & Persistence](#the-two-layer-crdt-architecture--persistence)
    + [World CRDT Internal Structure](#world-crdt-internal-structure)
- [Universe Visual Design & World Building](#universe-visual-design--world-building)
    + [Visual Elements](#visual-elements)
    + [Level of Detail (LOD) Rendering](#level-of-detail-lod-rendering)
    + [Emergent Social Behavior (No Explicit Social Features Needed)](#emergent-social-behavior-no-explicit-social-features-needed)
    + [Player Presence Data](#player-presence-data)
    + [Ephemeral State Channel (High-Frequency Updates)](#ephemeral-state-channel-high-frequency-updates)
  * [World Creation & Positioning](#world-creation--positioning)
    + [Deterministic Spatial Resolution (Server Authority)](#deterministic-spatial-resolution-server-authority)
    + [Event-Sourced Physics (Interactive Objects)](#event-sourced-physics-interactive-objects)
    + [Offline Visual Treatment & Ghost States](#offline-visual-treatment--ghost-states)
- [Navigation & Interaction](#navigation--interaction)
    + [Hand Position](#hand-position)
    + [Left Hand — "The Helm" (Navigation)](#left-hand--the-helm-navigation)
    + [Right Hand — "The Console" (Actions, Mods, Systems)](#right-hand--the-console-actions-mods-systems)
    + [Gravity Wells & Passive Drift](#gravity-wells--passive-drift)
    + [Warp Mechanic (K Key)](#warp-mechanic-k-key)
    + [Context Switching: Universe → World Interior](#context-switching-universe-%E2%86%92-world-interior)
    + [Input Translation Layers](#input-translation-layers)
- [Physical Portals: NFC Trading Cards & the World Index](#physical-portals-nfc-trading-cards--the-world-index)
    + [The Card](#the-card)
    + [The Tap → Teleport Flow](#the-tap--teleport-flow)
    + [The World Index](#the-world-index)
    + [First Discovery Rewards](#first-discovery-rewards)
    + [Card Programs: Curated Sets & Print-Your-World](#card-programs-curated-sets--print-your-world)
    + [Cards & the Mana Economy](#cards--the-mana-economy)
    + [Chip, URL & Security Model](#chip-url--security-model)
    + [Card Invariants](#card-invariants)
- [The Mana Mechanic: The Frontier of Dreams](#the-mana-mechanic-the-frontier-of-dreams)
    + [Three Numbers: the Pool, the Creative Share and the High-Water Line](#three-numbers-the-pool-the-creative-share-and-the-high-water-line)
    + [The Mana Pool Formula](#the-mana-pool-formula)
    + [Where Money Goes (`α`)](#where-money-goes-α)
    + [Flow: How the Creative Share Is Shared](#flow-how-the-creative-share-is-shared)
    + [Mana Costs](#mana-costs)
    + [Experience and Levels](#experience-and-levels)
      - [Awe — How Wonder Grows You and the Universe](#awe--how-wonder-grows-you-and-the-universe)
      - [Solar Tidal Cycle — The Universe Breathes With the Sun](#solar-tidal-cycle--the-universe-breathes-with-the-sun)
    + [Mana Is Visible, Audible, and Tangible](#mana-is-visible-audible-and-tangible)
    + [Shooting Stars: Every Draw Is Visible](#shooting-stars-every-draw-is-visible)
    + [The Donation → Mana → Frontier Pipeline](#the-donation-%E2%86%92-mana-%E2%86%92-frontier-pipeline)
    + [Server Authority for Mana](#server-authority-for-mana)
    + [Offline Creation — The Dream State](#offline-creation--the-dream-state)
    + [Emergent Behaviors](#emergent-behaviors)
    + [System Rules & Validation](#system-rules--validation)
  * [Open Design Questions](#open-design-questions)

<!-- tocstop -->

## Multiplayer & Mesh Networking

Aweborn is transitioning from a solitary cosmic experience into a massively multiplayer, mesh-networked universe built right into the browser. 

### Architecture Concepts: The Hybrid P2P / Client-Server Model

- **Stateful Server with In-Memory CRDTs (Lightsail VPS):** The universe is persistent and authoritative. A stateful Node.js server (running on a $10/mo AWS Lightsail instance or equivalent VPS) holds the active Yjs `Y.Doc`s in RAM. When players send CRDT diffs, they merge in-memory with near-zero compute cost and broadcast to all connected clients over native WebSockets. The server flushes state to durable storage (SQLite on the VPS; Postgres/DynamoDB only if scale demands) lazily — every ~60 seconds or when the last player leaves a world — reducing database writes by ~99.9% compared to a serverless approach.
- **Scaling Path:** Start with a single Lightsail instance. When load demands it, add nodes and hash `worldId` to route players joining the same world to the same server. Redis pub/sub for cross-node coordination if needed. This is the only architecture a non-profit can afford for real-time multiplayer.
- **Lambda for Non-Realtime Work:** Stripe webhook processing, donation ledger writes, and frontier expansion calculations are bursty and infrequent — perfect for serverless. Lambda handles these while the VPS handles everything real-time.
- **Dual-Mode Transport (Seamless Offline/Online):** Yjs is transport-agnostic, allowing the client to use two channels simultaneously:
  1. **Online (Client-Server):** `y-websocket` connects to the stateful VPS to sync with the authoritative in-memory state.
  2. **Offline/Local (P2P Mesh):** `y-webrtc` syncs with local peers on the same LAN/hotspot, or via QR-code signaled data channels.
  This allows players to build offline together in a mesh. Upon reconnecting, the client syncs all local edits to the VPS. The server validates structural changes, resolves collisions against the live universe, and writes the canonical positions back down to the clients. A world is solid or a Ghost on the universe map depending on where it sits and how many travellers have found it, not on how it was made (see **The Frontier of Dreams** section below).
- **Spatial Sectoring:** To prevent browser overload, the universe is chunked into sectors. Players only subscribe to the sector's WebSocket room for the area they are currently traversing.
- **Ephemeral P2P Data:** Even when online, WebRTC DataChannels are used for high-frequency, ephemeral intra-world data (like voice chat or 60fps avatar positions) to save server compute/bandwidth.

### Offline & Off-Grid Networking

The goal: two phones in the same room (or in the woods) can join each other's world with **zero internet**. Here's what's actually possible today and what isn't.

#### Can We Use Bluetooth from the Browser?

**Partially — but with a critical gap.**

The **Web Bluetooth API** exists in Chromium-based browsers (~76% of global users: Chrome, Edge, Samsung Internet) and allows a webpage to act as a BLE **Central** (GATT Client) — i.e., it can scan for and connect to nearby Bluetooth peripherals.

The idea would be: use BLE as the signaling channel to exchange WebRTC SDP Offers/Answers, then once the WebRTC DataChannel is established, drop the Bluetooth connection and communicate over Wi-Fi/IP.

**The blocker: no Peripheral Mode.** The Web Bluetooth spec does **not** allow a browser to act as a GATT **Server** (Peripheral). This means:
- Phone A's browser **cannot advertise** itself as a discoverable Bluetooth device.
- Phone B's browser **can scan**, but there's nothing from Phone A to discover.
- Both browsers are "clients looking for a server" — neither can be the server.

This is a hard limitation in the W3C spec, driven by security/privacy/fingerprinting concerns. Chrome has no public plans to add peripheral mode.

**The workaround — a BLE relay device:** If one player has a BLE-capable device acting as a GATT server (e.g., a Raspberry Pi, a smartwatch, or even a companion native app on one phone), it could relay the SDP handshake between the two browsers. This is niche but technically works.

#### Tiered Connectivity Strategy

Given the above, here's a practical tiered approach for offline play:

| Tier | Scenario | Mechanism | Browser Support |
|------|----------|-----------|-----------------|
| **1** | Both on same LAN/hotspot (no internet needed) | One player creates a mobile hotspot. Both connect. Use **QR code** to exchange SDP. WebRTC connects over the local network via mDNS. No STUN/TURN needed. | All browsers ✅ |
| **2** | Physically together, no shared network | **QR Code Signaling**: Player A generates WebRTC Offer → displayed as QR. Player B scans → generates Answer → displays QR. Player A scans. Handshake done. Then one phone creates an ad-hoc hotspot for the actual data channel. | All browsers ✅ |
| **3** | In-person / branded physical artifact | **NFC URL Record**: An Aweborn-branded NFC sticker contains a join URL (e.g., `aweborn.org/join/k7x9m`). Player taps phone → OS opens browser → instantly in the world. Uses **NDEF URL records** handled by the OS (not the Web NFC API), so it works on **both iOS and Android** natively. | All phones with NFC ✅ |
| **4** | True background mesh (native wrapper) | Wrap the webapp in **Capacitor** or **Tauri** to access **Apple Multipeer Connectivity** / **Android Nearby Connections**. Enables automatic BLE + Wi-Fi Direct discovery and mesh networking without any user interaction. Conceptually similar to `ajmedeio-cluster-infra` node discovery. | Native shell required 📱 |

#### NFC URL Deep-Dive (Tap-to-Join)

A crucial distinction: writing a **URL onto an NFC tag** is completely different from using the Web NFC API. NDEF URL records are handled by the **phone's operating system**, not the browser. This means:

- **iOS (iPhone XS+):** Background Tag Reading detects the tag automatically when the screen is on. A notification appears → user taps → Safari opens the URL. No app needed.
- **Android:** Tapping a tag with a URL auto-opens the default browser. No app needed.

This gives us **universal NFC support** on any modern phone with NFC hardware.

##### Online Mode: Join Link

```
1. Player A creates a world → signaling server generates: aweborn.org/join/k7x9m
2. Player A writes that URL to an NFC sticker (via NFC Tools app or Web NFC on Android)
3. Player B taps phone to sticker → OS opens browser → joins the WebRTC mesh
```

Perfect for non-profit events: hand out branded Aweborn NFC stickers at fundraisers, conferences, or meetups. Each sticker is a portal into a shared cosmic world.

> **See also:** [Physical Portals: NFC Trading Cards & the World Index](#physical-portals-nfc-trading-cards--the-world-index) — the collectible evolution of this idea. Join links (`/join/…`) connect you to a *session*; trading cards (`/w/<uuid>`) teleport you to a *world* and add it to your World Index.

##### Offline Mode: SDP-in-URL-Hash

For offline/no-internet scenarios, we can embed the QWBP-compressed SDP offer directly in the URL hash fragment:

```
aweborn.org/j#<base64-encoded-QWBP-offer>
```

- `https://aweborn.org/j#` with NDEF URI prefix optimization = ~23 bytes
- QWBP offer in base64 = ~75–134 bytes
- **Total: ~98–157 bytes**

| NFC Tag Type | Memory | Fits SDP-in-URL? |
|-------------|--------|------------------|
| NTAG213 | 142 bytes | ⚠️ Tight — works with aggressive compression |
| NTAG215 | 504 bytes | ✅ Comfortable |
| NTAG216 | 888 bytes | ✅ Room to spare |

The webapp (cached via Service Worker for offline use) reads the SDP offer from `window.location.hash`, generates an answer, and displays it as a QR code for Player A to scan. That's a **one-tap + one-scan** handshake — even better than two QR scans.

#### QR Code Signaling Deep-Dive (Primary Offline Strategy)

QR code signaling is the most universal offline approach — it works on every browser, every OS, and requires zero infrastructure. The key challenge is that a raw WebRTC SDP offer is ~2,500+ bytes, which produces a dense, hard-to-scan QR code. The solution: **don't send raw SDP.**

##### The QWBP Approach (QR-WebRTC Bootstrap Protocol)

[QWBP](https://github.com/magarcia/qwbp) is an open-source library purpose-built for this exact problem. Instead of encoding the full SDP string, it:

1. **Derives ICE credentials deterministically** from the DTLS fingerprint using HKDF — so `ice-ufrag` and `ice-pwd` never need to be transmitted.
2. **Binary-packs** the remaining data (IP addresses as 4 raw bytes, ports as 2-byte unsigned ints, candidate types as bit flags) into a C-struct-style layout.
3. **Result: 55–100 bytes** — fits in a tiny Version 4–5 QR code that scans reliably in under 500ms, even in poor lighting.

| Encoding Method | Payload Size | QR Scannability |
|-----------------|-------------|-----------------|
| Raw SDP (JSON) | ~2,500+ bytes | ❌ Very dense, unreliable |
| Stripped/Munged SDP | ~1,200 bytes | ⚠️ Marginal |
| **QWBP binary protocol** | **55–100 bytes** | **✅ Fast, reliable** |

##### The Two-Scan Handshake Flow

```
Player A                          Player B
─────────────────────────────────────────────────
1. Tap "Host World"
2. RTCPeerConnection created
3. Wait for iceGatheringState
   → "complete"
4. Binary-pack Offer → QR code
   displayed on screen
                          ──►  5. Scan Player A's QR
                               6. RTCPeerConnection created
                               7. setRemoteDescription(offer)
                               8. createAnswer()
                               9. Wait for ICE complete
                              10. Binary-pack Answer → QR code
                                  displayed on screen
11. Scan Player B's QR  ◄──
12. setRemoteDescription(answer)
13. DataChannel opens! 🎉
─────────────────────────────────────────────────
Total: 2 scans. Connection established.
```

##### Key Implementation Notes

- **Wait for ICE completion**: Standard WebRTC uses "Trickle ICE" (sending candidates incrementally). For QR signaling, we must wait for `iceGatheringState === 'complete'` so everything fits in a single QR code.
- **Same LAN only (without STUN)**: If both phones are on the same hotspot/LAN, WebRTC resolves local IPs via mDNS — no STUN/TURN server needed. If on different networks, public STUN servers (e.g., Google's free ones) are still required to discover public IPs.
- **Existing libraries**: [`QWBP`](https://github.com/magarcia/qwbp) (binary protocol, recommended), [`webrtc-via-qr`](https://github.com/Qivex/webrtc-via-qr) (simpler API with `HostConnection`/`UserConnection` classes), [`libp2p-webrtc-qr`](https://github.com/NiKrause/libp2p-webrtc-qr) (if integrating with libp2p ecosystem).
- **For Aweborn**: Once the DataChannel is open, we pipe Yjs CRDT updates through it. Player positions, world edits, chat — all synced over the peer-to-peer channel with zero servers.

### The Two-Layer CRDT Architecture & Persistence

The system uses two nested CRDT layers. The stateful VPS holds active documents in RAM and lazily flushes to durable storage:

**Layer 1 — Universe CRDT (Sector Rooms):** A shared Yjs Y.Map that holds the "star map" metadata, spatially chunked into sectors. Each entry represents one world. The VPS manages sector rooms — WebSocket channels that clients subscribe to based on their current position.

```js
// Universe CRDT entry (~100 bytes)
{
  id: "k7x9m",
  name: "Coral Reef",
  creator: "player-abc",
  intendedPosition: { x: 1420, y: -380, z: 9100 },  // Written by client (immutable)
  resolvedPosition: { x: 1435, y: -380, z: 9115 },   // Written ONLY by server
  resolvedAt: 1723848500,                            // Server resolution timestamp
  color: "#ff7b54",
  solidified: true,         // false = Ghost on the universe map (outside the Frontier, meter not yet full); interiors are identical
  solidifiedAt: 1723848200, // When the Frontier reached this world
  playerCount: 3,           // Ephemeral presence count
  lastActive: 1723848000
}
```

**Layer 2 — World CRDTs (World Rooms):** Each world is its own Yjs Y.Doc containing the full 3D scene data. These are only loaded into server memory when players are inside, and flushed to durable storage when dormant. Players only subscribe to the Universe CRDT while in the star map view.

**Yjs Conflict Resolution (No Clock Sync Needed):** Yjs does NOT use wall-clock time. Each client has a `clientID` (random number, assigned per session) and a `clock` (monotonic counter, starts at 0). When two clients write to the same key concurrently, the client with the higher `clientID` wins — deterministic, requires zero clock synchronization. The `clock` counter is only used for causal ordering within a single client.

#### World CRDT Internal Structure

Each world's Y.Doc contains nested maps for metadata, physics parameters, placed objects, terrain modifications, and chat:

```
Y.Doc (one per world)
├── Y.Map("meta")
│   ├── name: "Coral Reef"              (last-writer-wins)
│   ├── creator: "player-abc"           (immutable)
│   ├── createdAt: 1723848000           (immutable)
│   ├── color: "#ff7b54"               (last-writer-wins)
│   └── solidified: true                (server-written — false until the Frontier reaches it)
│
├── Y.Map("physics")                    ← PER-WORLD PHYSICS RULES
│   ├── gravityX: 0
│   ├── gravityY: -9.8                  (Earth default — creators can change)
│   ├── gravityZ: 0
│   ├── friction: 0.3
│   ├── airResistance: 0.01
│   ├── bounceCoefficient: 0.5
│   └── waterLevel: -10
│
├── Y.Map("objects")                    ← PLACED OBJECTS (scene graph)
│   ├── "obj-a1b2": Y.Map { type, x, y, z, rot, scale, material, placedBy }
│   ├── "obj-c3d4": Y.Map { ... }
│   └── ... (hundreds/thousands of objects)
│
├── Y.Map("terrain")                    ← TERRAIN MODIFICATIONS
│   ├── seed: 42                        (immutable — procedural base)
│   └── modifications: Y.Map            (per-chunk edits overlay the seed)
│
└── Y.Array("chat")                     ← IN-WORLD CHAT LOG
    └── { sender, text, t } entries
```

**Each world can have different physics.** "Coral Reef" might have Earth gravity (-9.8), "Moon Base" has lunar gravity (-1.6), "Zero-G Lab" has none. When a player enters a world, their client reads the physics map and configures the local physics engine. The CRDT stores the *rules*; the client *simulates* them. Changing a physics parameter (e.g., setting gravity to 0) propagates to all players in that world via the CRDT.

## Universe Visual Design & World Building

The current cosmic scene (`Environment.tsx` — starfield, clouds, floating islands, nebula rings) becomes the **universe view**. But now the "stars" aren't decorative — each sun is a real world someone created.

#### Visual Elements

| Visual | Represents | Behavior |
|--------|-----------|----------|
| 🌟 Large bright sun | A world (CRDT document) | Glows, pulses. Brightness/size reflects activity level |
| ✨ Small warm glowing orb | A player navigating the universe | Drifts through space with a faint comet trail |
| 💫 Faint trail behind player-orb | Player movement path | Fades over ~2 seconds |
| ✨→🌟 Flash absorption | Player entering a world | Their star merges into the sun |
| 🌟→✨ Spark ejection | Player leaving a world | A tiny star shoots out of the sun |
| ✨✨✨ Cluster orbiting a sun | Active/popular world | Visible from far away — no UI numbers needed |
| ★ Brightest sun at origin | The Aweborn Portal | Center of the universe, donation flow lives here |

#### Level of Detail (LOD) Rendering

To render an ever-growing universe, worlds are rendered differently based on camera distance:

| Distance | Rendering | Data |
|----------|-----------|------|
| Close (< 100 units) | Full 3D sun with glow, particles, player count badge | Full metadata from Universe CRDT |
| Medium (100–1000) | Simple billboard sprite with color tint | Position + color only |
| Far (1000+) | Single point in `InstancedMesh` / `THREE.Points` | Batched — thousands in one draw call |
| Very far | Part of static starfield texture | Not individually tracked |

Three.js can render hundreds of thousands of points in a single draw call. The universe feels infinite.

#### Emergent Social Behavior (No Explicit Social Features Needed)

Without building friend lists, chat lobbies, or matchmaking, social behavior emerges naturally:

- **"What's everyone looking at?"** — You see a stream of player-stars heading in a direction and follow them. Curiosity-driven exploration.
- **"This world is alive"** — Visual density of player-stars around a sun tells you everything. No numbers needed.
- **"I found something quiet"** — Fly far from the center, find a lone sun with no stars around it, enter it — just you in someone's forgotten creation.
- **"Follow the crowd"** — Sparks shooting out of a sun = active world. A stream of tiny stars all moving the same direction = something's happening over there.

#### Player Presence Data

Player presence is ephemeral — broadcast to nearby peers, disappears on disconnect. No storage cost. *Original design: Yjs awareness protocol (`y-webrtc`). As built (Aug 2026): custom presence messages over BroadcastChannel + the sync-service WebSocket relay (msg `0x09`); WebRTC DataChannels will augment this in Phase 06.*

```js
// ~40 bytes per player — ephemeral, not persisted
{
  id: "player-abc",
  position: { x: 1420.5, y: -380.2, z: 9100.1 },
  velocity: { x: 0.5, y: 0, z: -1.2 },  // for interpolation
  inWorld: null | "world-k7x9m",          // null = flying, string = inside a world
  color: "#ffd700"
}
```

#### Ephemeral State Channel (High-Frequency Updates)

Avatar position, rotation, and other high-frequency data is too fast for CRDTs (~20-30 updates/sec). These use **WebRTC DataChannels** directly between nearby peers for instant, low-latency visibility:

- **Client-side prediction:** Your avatar moves instantly when you press a key — no server round-trip.
- **Peer broadcast:** Position packets are sent peer-to-peer at ~20-30Hz via WebRTC DataChannels. Receiving clients interpolate between packets to render smooth 60fps movement.
- **Server validation (rubberbanding):** The stateful VPS validates player positions at a lower frequency (every 0.5-2 seconds). Since it already holds the world state in memory, validation is a simple bounds/physics check with negligible overhead. If a position is physically impossible (teleport, speed hack), the server sends a correction — the client's avatar snaps back to the last valid position.
- **Graceful degradation:** If the server is slow or offline, players still see each other via WebRTC. The server catches up when connectivity returns.

### World Creation & Positioning

Worlds are positioned **where the player is standing in the universe when they create it** ("plant where you stand"). This creates a universe whose geography is a living fossil record of the community:

- **Center (origin):** The Aweborn donation portal — the brightest star, the first thing you see
- **Inner ring:** The first worlds ever created — OG community, dense, well-visited
- **Outer rings:** Newer worlds radiating outward over time
- **Friends who explore together** naturally create worlds near each other → organic "constellations" or neighborhoods emerge
- **Prolific creators** develop recognizable clusters — their personal galaxy

Nobody designs this layout. It's 100% emergent from player behavior.

#### Deterministic Spatial Resolution (Server Authority)

Worlds are positioned roughly where the player stands ("plant where you stand"), written to the CRDT as `intendedPosition`. However, the **stateful VPS** is responsible for ensuring worlds do not overlap:

1. **Client writes `intendedPosition`** to the CRDT (locally or synced to peers).
2. **Client renders temporarily** at this position with a "settling" visual cue (e.g., pulsing or shimmer). New worlds outside the Living Frontier appear on the universe map as **Ghosts** (translucent wireframes) until they solidify; inside the Frontier they are born solid.
3. **Server resolver triggers** (on receiving the world-creation CRDT update).
4. **Server runs a deterministic spatial resolver**: Sorting worlds by timestamp, placing them, and nudging overlapping worlds outward along a deterministic vector until minimum distances are met.
5. **Server writes `resolvedPosition`** back to the canonical CRDT.
6. **Client receives update** (via WebSocket) and the world smoothly animates ("gravitational settling") to its final canonical orbit.

#### Event-Sourced Physics (Interactive Objects)

For interactive physics objects (balls, crates, anything a player can push/kick), simulation runs locally on each client but is **event-sourced through the CRDT**:

1. **At rest:** Object stored in CRDT with position and `state: "resting"`. No simulation needed.
2. **Player kicks it:** Client writes the **velocity vector** at the moment of the kick to the CRDT (`state: "active"`, `velX/Y/Z`, `activatedBy`). Every client reads the same initial conditions and simulates the same trajectory independently.
3. **Object settles or collides:** The activating client writes the final resting position back to the CRDT (`state: "resting"`, updated `x/y/z`). All clients snap to this canonical position.
4. **Chain reactions:** If the object hits another physics object, new initial conditions are written for that object too.

This is bandwidth-efficient (2 CRDT writes per physics event, not 60/sec), visually consistent (same initial conditions → nearly identical trajectories), and offline-safe (events replay on reconnect). The VPS can validate kick velocities for anti-cheat (in every world: solid or Ghost, interiors behave the same).

#### Offline Visual Treatment & Ghost States

The universe has two spatial zones — the **Living Frontier** (funded, lit, solid) and the **Deep Dark** (unfunded, dim, ghostly). *(Decided 2026-10-17: **Ghost vs solid is how a world looks on the universe map, nothing more.** Ghost worlds are fully enterable and playable; inside, the physics, collision and building are identical to a solid world, with at most a faint shimmer in the sky. Anything manifested is real.)* Offline play uses its own visual language:

| State | Visual | Interaction |
|-------|--------|-------------|
| **Solid world (inside the Frontier, or its meter filled)** | Universe map: full color, vibrant glow, particles | Fully interactive — build, explore, play |
| **Ghost world (outside the Frontier, meter not yet full)** | Universe map: translucent wireframe with soft ethereal glow and a thin meter ring. Inside: identical to a solid world (perhaps a faint sky shimmer) | Fully playable by everyone. A dream waiting to solidify |
| **Visited worlds (offline)** | Normal rendering with a subtle frost/ice shader, reduced glow | Can enter and explore the cached snapshot solo |
| **Unvisited worlds (offline)** | Dim, desaturated silhouettes | Tapping shows "Come back online to explore" |
| **Your own worlds (offline)** | Fully bright and interactive | Can keep building offline. On reconnect they show a "settling" shimmer, then take their place by the same rule as any world |

**The reconnect moment:** Yjs automatically syncs all offline edits. If someone else edited the same world while you were away, the CRDT resolves it — no conflicts, no overwrites. Both sets of changes just appear. Your offline creations are placed by the server and are solid if they land inside the Frontier, or Ghosts waiting in the Deep Dark if not.

## Navigation & Interaction

The game is **keyboard-first, no mouse**. All other input methods (controller, touch, eye tracking) translate to the keyboard layout. The philosophy: **left hand navigates, right hand acts.**

#### Hand Position

```
              LEFT HAND                              RIGHT HAND
         ┌─────────────────┐                    ┌─────────────────┐
         │  Q   W   E   R  │   ← dead zone →   │  U   I   O   P  │
         │ pinky ring mid idx│    (T Y G H B)   │ idx mid ring pinky│
         │                  │                    │                  │
         │        V         │                    │        N         │
         │      thumb       │                    │      thumb       │
         └─────────────────┘                    └─────────────────┘
```

Hands are wide and relaxed — a split keyboard cockpit. The gap between hands (T-Y-G-H-B) is intentional dead space, like the gap between joysticks in an aircraft. Each hand has **17 comfortably reachable keys**.

#### Left Hand — "The Helm" (Navigation)

**Core Flight:**

| Key | Finger | Action |
|-----|--------|--------|
| **V** | **thumb** | **THRUST** — hold to accelerate in facing direction. The most important key, always under thumb |
| **Space** | thumb stretch | **BRAKE / DRIFT TOGGLE** — tap = toggle drift (coast with zero input), hold = active brake |
| **W** | middle | **Pitch up** |
| **E** | ring | **Pitch down** |
| **Q** | pinky | **Yaw left** |
| **R** | index | **Yaw right** |

**Extended Flight:**

| Key | Finger | Action |
|-----|--------|--------|
| **A** | pinky (drop) | **Roll left** |
| **F** | index (drop) | **Roll right** |
| **S** | ring (drop) | **Reverse thrust** — for fine positioning near worlds |
| **D** | middle (drop) | **Lateral strafe** |

**Advanced:**

| Key | Finger | Action |
|-----|--------|--------|
| **Z** | pinky (stretch) | **Lock camera behind** — snap to velocity vector |
| **X** | ring (stretch) | **Free-look toggle** — decouple camera from movement |
| **C** | middle (stretch) | **Look behind** (hold) |
| **T** | index (stretch) | **Auto-orient** — snap roll/pitch to galactic "up" |
| **1-4** | stretch up | **Camera distance** — 1=close, 2=medium, 3=far, 4=cinematic |

#### Right Hand — "The Console" (Actions, Mods, Systems)

**Core Interaction:**

| Key | Finger | Action |
|-----|--------|--------|
| **N** | **thumb** | **PRIMARY INTERACT** — enter world, pick up object, talk, activate portal |

**Star Mod Slots (Top Row)** — customize your star in real-time, no menus:

| Key | Finger | Mod Slot | Examples |
|-----|--------|----------|----------|
| **U** | index | **Trail** | Comet, sparkle, ribbon, helix, none |
| **I** | middle | **Aura** | Glow, pulse, rings, flame, none |
| **O** | ring | **Shape** | Sphere, crystal, spiral, spike, jellyfish |
| **P** | pinky | **Emote/Signal** | Wave, SOS, beacon, celebration burst |

Tap = cycle to next option. Hold = quick-select radial (rendered in-game, no UI menu).

**Systems (Drop-Down Row):**

| Key | Finger | Action |
|-----|--------|--------|
| **J** | index (drop) | **Lock on / Target** — lock nearest world/player, cycle with repeated taps |
| **K** | middle (drop) | **WARP CHARGE** — hold to charge, release to warp-leap toward locked target |
| **L** | ring (drop) | **Scan / Info** — hold while looking at a world to see name, creator, player count |
| **;** | pinky (drop) | **Map / Compass** — toggle heading indicator toward Aweborn Portal and nearest worlds |

**Communication (Stretch-Down Row):**

| Key | Finger | Action |
|-----|--------|--------|
| **M** | index (stretch) | **Quick chat wheel** — hold = radial of preset messages, release on choice |
| **,** | middle (stretch) | **Ping location** — drop a visible beacon at your position |
| **.** | ring (stretch) | **Voice toggle** — push-to-talk (WebRTC voice channel) |

**Advanced:**

| Key | Finger | Action |
|-----|--------|--------|
| **Y** | index (stretch left) | **Create world** — "plant where you stand", hold to begin |
| **H** | index (stretch left, drop) | **World settings** — only inside your own world |
| **7-0** | stretch up | **Color palette** — quick-swap star color, 10 preset slots |

#### Gravity Wells & Passive Drift

**Doing nothing should be beautiful.** The default state is drift — the universe carries you.

| State | What Happens | Feel |
|-------|-------------|------|
| **Deep space** | Star drifts at current velocity with very slow deceleration | Floating in an ocean at night |
| **Approaching a well** | Trajectory bends toward nearby world, faint curved field lines appear, warm audio hum grows | A river current catching your canoe |
| **Captured orbit** | Star settles into gentle orbit, other orbiting players visible | Sitting on a park bench near a campfire |
| **Gravitational slingshot** | High-velocity pass — path curves dramatically, speed boost from gravity assist | Skateboarder hitting a halfpipe |

Gravity strength scales with world activity: `attraction = G * worldMass / distance²` where `worldMass = f(playerCount, objectCount, age)`. Popular worlds pull harder — **social gravity is physical gravity.** The Aweborn Portal at origin has the strongest pull.

Skilled players chain slingshots between worlds for fast traversal — an emergent skill ceiling that doesn't punish new players.

#### Warp Mechanic (K Key)

For crossing large distances:

1. **Lock on (J)** → target indicator on a distant world
2. **Hold K** → charge meter fills (1-3 sec). Visual: star compresses, light bends inward, stars streak. Audio: rising pitch
3. **Release K** → SNAP. Visual: light-speed blur, stars become lines. Audio: satisfying crack
4. **Arrive** near the target in a bright flash, entering the gravity well's orbit with residual velocity

Warp isn't instant teleport — you arrive with momentum and still navigate the last stretch manually.

#### Context Switching: Universe → World Interior

When pressing **N** while orbiting a world, the same keys remap to the world's physics:

| Universe View | World Interior |
|--------------|----------------|
| V = thrust | V = jump / jetpack |
| W/E = pitch | W/E = look up/down |
| Q/R = yaw | Q/R = move left/right |
| A/F = roll | A/F = strafe |
| S = reverse thrust | S = move backward |
| Space = brake | Space = crouch / sink |
| N = enter world | N = interact / use |
| K = warp | K = sprint / boost |

Hands never move. Muscle memory carries across the entire game.

#### Input Translation Layers

The keyboard layout is the source of truth. All other input methods map to it:

**Controller (Gamepad API — auto-detected):**

| Keyboard | Controller |
|----------|------------|
| Q/R (yaw) | Left Stick X |
| W/E (pitch) | Left Stick Y |
| V (thrust) | RT — analog pressure = speed |
| Space (brake) | LT — analog brake |
| A/F (roll) | LB/RB bumpers |
| N (interact) | A / Cross |
| J (lock-on) | Y / Triangle |
| K (warp) | X / Square (hold) |
| U/I/O/P (mods) | D-pad directions |

**Touch (Mobile):**

| Keyboard | Touch |
|----------|-------|
| Q/R/W/E (steer) | Left thumb virtual joystick |
| V (thrust) | Right thumb — hold right zone |
| Space (brake) | Two-finger tap |
| N (interact) | Tap on world/object |
| K (warp) | Long-press on locked target |
| U/I/O/P (mods) | Swipe gestures on right side |
| Tilt device | Optional accelerometer steering |

**Eye Tracking (via WebGazer.js):**

| Keyboard | Eye Tracking Enhancement |
|----------|--------------------------|
| Q/R/W/E (steer) | Replaced: gaze direction = steer direction |
| J (lock-on) | Replaced: gaze at world for 1s = auto-lock |
| L (scan) | Enhanced: info overlay follows gaze |
| V, N, K | Unchanged — still keyboard |

## Physical Portals: NFC Trading Cards & the World Index

> **Origin:** Grew out of Alex's hands-on NFC work (cloning LF/HF fobs with the Chameleon Ultra + magic cards — see portfolio post *"Cloning an NFC Fob"*), the NFC sticker idea above, and the Aug 24, 2026 note: *"Eventually we'll make a cool world index that enables players to warp to worlds they've seen before."* Cataloged Oct 3, 2026. Implementation plan: [phases/08-nfc-trading-cards.md](./phases/08-nfc-trading-cards.md).

Aweborn worlds become **physical trading cards**. Each card has a world's portrait on the front, the same Aweborn back on every card, and an NFC chip inside holding a single URL: `https://aweborn.org/w/<world-uuid>`. Tap a phone to the card and the browser (or installed PWA) opens, and your star **teleports to that world's coordinates** in the universe. The world is added to your **World Index**, your personal index of discovered worlds, so you can warp back to it from anywhere.

It's a sci-fi token that links the real world to the virtual one. Cards are cheap to make, but people value them for reasons that have nothing to do with money: the art, the collecting, the gifting, the memory of an event. That makes them a natural fundraiser for the non-profit. They're **low stakes on purpose**. A card is a key to a place, not an asset.

#### The Card

| Element | Spec |
|---------|------|
| **Front** | Unique per world: world portrait art, world name, creator, universe coordinates `(x, y, z)` + sector, set name + set number (e.g., *Origin Set · 3/12*) |
| **Back** | **Static. Identical on every card ever printed.** An Aweborn logo design, so the backs of a stack look uniform, like a real TCG deck back |
| **Chip** | NFC NTAG (see [Chip, URL & Security Model](#chip-url--security-model)), one NDEF URI record, locked read-only after encoding |
| **Identity** | The card *is* the world ID. There are **no per-card serial numbers** (explicitly decided: not needed) |
| **Digital twin** | The same front art appears as the world's entry in the World Index, so physical and digital cards look identical |

#### The Tap → Teleport Flow

```
1. Phone touches card
2. OS reads NDEF URI record (iOS background tag reading / Android tag dispatch; no app, no Web NFC API)
3. Browser or installed PWA opens https://aweborn.org/w/<uuid>
4. App boots → reads world ID from the path → looks up the WorldEntry by ID
   (the client only subscribes to nearby sectors, so this needs a direct lookup by ID)
5. Teleport: warp-arrival effect plays, player star placed at the world's resolvedPosition
6. The player enters the world (Origin has no interior: the player arrives at the portal)
7. World Index: entry added (method = "link"; a card tap is a link) and marked visited on entry → first visit fires the reward
```

**Arrival: every card lands you inside its world** (Alex, 2026-10-13). A card works like opening a game pack: tap and you're in. There are no per-card arrival modes and no URL parameter; older links that carry `?a=in` still work because the query string is ignored. The one exception is **Origin**, which has no interior, so its card arrives at the portal.

**Teleport vs. Warp:** the normal warp (K) requires lock-on and arrives with momentum. A card teleport can be **any distance, from anywhere, with no lock-on**. It's a jump between physical and virtual space. It reuses the warp arrival visuals (flash, residual particles) so it feels native to the game.

**Edge cases:**
- **Fresh visitor / first-ever load:** the card *is* their onboarding. Their first view of Aweborn is arriving at a specific world instead of the origin (relates to the open "Universe Entry Point" question).
- **Offline tap:** the PWA (Phase 06) opens from cache. If the world snapshot is cached, teleport to it. If not, add a *pending* World Index entry and show "This world awaits. Come back online to arrive." Resolve on reconnect.
- **Ghost world:** teleport works the same, and the world plays like any other. *(Decided 2026-10-17)* **Two editions:** a card collected while its world is a Ghost is a **Dreamt** edition forever (wireframe art, a small "Dreamt" mark); after the world solidifies, new collectors get the solid card. Dreamt cards are proof you found a world before it was real, and well-travelled worlds make them a natural limited edition. Cards never move a world's solidification meter.
- **Desktop / no NFC:** the URL works in any browser. It's just a link.

#### The World Index

The World Index is the player's **personal, persistent index of every world they've discovered**. It's how a player remembers the universe, and it replaces the temporary `CRDTDevOverlay` world list.

```js
// One World Index entry per discovered world (per account)
{
  worldId: "3f9c2a1e-…-uuidv4",
  state: "sighted" | "visited",   // sighted = came within 100 u or landed beside it; visited = went inside
  method: "flight" | "link",      // how you first found it (a card tap is a link)
  characterId: "…",               // which character found it first
  discoveredAt: 1727971200000,
  visitedAt: 1727980000000,       // null while sighted
  visitCount: 4,                  // repeats within 30 s count once
  lastVisitedAt: 1727999999000,
  pending: false                  // client only: found offline, not yet confirmed
}
```

- **Any discovery counts.** Flying in manually, tapping a card, or opening a shared link all add entries. Cards are just the most magical way to fill it.
- **Two states.** *Sighted* worlds show face-down and can be warped to; *visited* worlds flip to full art. Sightings work offline: they are queued with their time and replayed when back online.
- **World Index Warp.** From anywhere in the universe, choose a World Index entry and warp straight there. This is the in-game version of tapping the card again. It uses the warp charge/leap visuals. Free, standard K charge, no cooldown (movement never costs mana), once warp is unlocked by level.
- **Opened with `M`** (think Map) or the HUD chip.
- **Collector view.** Entries are shown as cards using the same art as the physical card; worlds without art get a generated card from the same front template. Collections are grouped by set (Origin Set, event sets, print-your-world). Per-set progress ("7 / 12 discovered") gives people a reason to collect without any scarcity mechanics.
- **No card-found badge.** Card taps aren't told apart from shared links (decided 2026-10-12).
- **Persistence via identity.** The World Index is stored per account on the server (Phase 08 → Persistent Player Identity) and cached on the device.
- **Anti-cheat.** Sightings are client-reported with cheap server checks for now; [Phase 09](./phases/09-authoritative-flight.md) (server-authoritative flight) lets the server derive them itself.

#### First Discovery Rewards

The first time a player discovers a world, by any method:

1. **Awe → experience + Frontier.** This fires the existing `first-world-visit` awe event: the player gains experience, and the high-water line (and the Frontier) moves outward for everyone. Awe never mints spendable mana.
2. **Discovery moment (personal).** A card-reveal animation: the world's card flips from the static Aweborn back to its front art and slides into the World Index. This is the personal reward and the dopamine hit.
3. **World Index entry.** The world can now be warped to from anywhere, forever.
4. **Shared-awe still applies.** Tapping cards together at an event (several players discovering at once) gets the 2× shared-awe multiplier.

Repeat taps of an already-discovered world just teleport, with no new reward (awe exhaustion applies as usual). Any further personal reward (discovery-count badges, set flair) stays cosmetic and can never be bought. See open questions.

#### Card Programs: Curated Sets & Print-Your-World

Both programs exist side by side:

| Program | Who | What |
|---------|-----|------|
| **Curated Sets** | Aweborn (the non-profit) | Official numbered sets, e.g., the **Origin Set** (the Aweborn Portal + the first worlds ever created), seasonal sets, landmark worlds. Sold as fundraisers and given away at events |
| **Print-Your-World (on demand)** | Any player | Order a print run of cards for *your* world, to hand out, trade, gift, or sell at your own table |
| **Organizations & Events** | Companies, conferences, cities, schools | Build a world that represents a venue (conference hall, campus, city), then print event cards. Attendees tap and explore the space virtually. The card doubles as a souvenir and a way back in |

**Distribution:** sold (fundraiser) **and** given free (outreach at events and meetups). Low stakes, high delight.

**Example (events):** a conference prints 2,000 cards for its venue world. Attendees tap at the badge desk and land inside a virtual version of the conference hall. Every first tap is a moment of awe: attendees gain experience and the Living Frontier moves outward, doubled by shared awe when people tap together. The conference just expanded the universe for everyone.

#### Cards & the Mana Economy

- **Cards are mission, not merchandise** (2026-10-14): they bring people into the game, and their play feeds the research. ~$8–10 per card. **All card money enters the pool** (the treasury); production and shipping are drawn out as the `cards` category, `α` of the surplus becomes creative share, the Frontier expands, and the golden solidification wave plays.
- ~~**Print-your-world as patronage (idea).** Ordering cards of your own **Ghost** world could put the order's surplus toward solidifying that world specifically (a targeted Patron donation that creates an Oasis). Printing your world makes it real. *(Open question: automatic, opt-in, or not at all.)*~~ **Removed 2026-10-13: no patronage.**
- **Free giveaway cards still generate value.** Every first tap is awe: experience for the player and reach for the Frontier. A free card at a meetup is a small, permanent contribution to the universe.
- **In-game card checkout for any world** (decided 2026-10-14): "Get this card" from the World Index or a world's settings: favorite worlds, far-away worlds, your own. Every purchase swells the universe (see [Shooting Stars](#shooting-stars-every-draw-is-visible)).
- **Shortcut and souvenir, never the only door** (decided 2026-10-14). The cosmos is vast, so a card is the fastest way to any world, even the far reaches, and a keepsake to hold and give. Every world stays reachable by flying or, once earned, by warp. Owning a card grants nothing a free player can't get by playing.

#### Chip, URL & Security Model

**URL format:** `https://aweborn.org/w/<uuidv4>`, namespaced under `/w/` so it's easy to route and never collides with future top-level pages.

**World IDs migrate to UUIDv4.** Today the sync-service generates 5-character random IDs (`generateWorldId()` in `server/sync-service/src/rooms.ts`, about 60M combinations, collision-prone at scale, and guessable). Cards make IDs permanent and printed, so they must be globally unique and unguessable: `crypto.randomUUID()`. The `/world/{worldId}` WebSocket route regex already accepts hyphens.

**Payload size (fits every common chip):**

| Part | Bytes |
|------|-------|
| NDEF URI prefix code `0x04` (= `https://`) | 1 |
| `aweborn.org/w/` | 14 |
| UUIDv4 | 36 |
| NDEF/TLV overhead | ~7 |
| **Total** | **~58 bytes** |

| Chip | User memory | Verdict |
|------|------------|---------|
| **NTAG213** | 144 bytes | ✅ **Recommended.** Cheapest, universal, plenty of room |
| NTAG215 | 504 bytes | ✅ Works (amiibo chip), costs more for no benefit here |
| NTAG216 | 888 bytes | ✅ Overkill |
| NTAG 424 DNA | — | Future option only (see below) |

**Security model: intentionally open.**
- A card holds a public URL. Anyone can read it, copy it to another tag in seconds (as the fob-cloning work showed, plain NTAG/Ultralight has no crypto), or just text the link. **That's fine.** A cloned card or shared link gives exactly what the original gives: a teleport and a discovery. Nothing is scarce, so there's nothing to steal.
- **Lock tags read-only after encoding** (NTAG lock bits). This doesn't stop cloning. It stops *vandalism*, where someone rewrites a card at an event to point somewhere malicious.
- **No per-card serials, no proof-of-ownership.** Decided: not needed for a low-stakes non-profit collectible.
- **Upgrade path, if ever needed:** NTAG 424 DNA with SUN (Secure Unique NFC), where every tap produces a signed, single-use URL suffix the server can verify. It's only worth it if a future product (e.g., limited physical editions with in-game meaning) actually needs unclonability. Not planned.

#### Card Invariants

These must hold forever, because printed cards can't be patched:

1. **A world ID never changes and never gets reused.** (Pre-launch 5-char IDs are migrated *before* the first card is printed.)
2. **`/w/<uuid>` resolves forever.** Worlds are never hard-deleted (consistent with *The Museum of Everything*). If a world is ever removed for moderation reasons, the URL still resolves to a graceful "this world has faded" landing at its last coordinates.
3. **The card stores the ID, not coordinates.** Coordinates printed on the front are decorative. The teleport always uses the live `resolvedPosition`. Only worlds with a server-resolved position (`resolvedAt > 0`) can be printed.
4. **The `/w/` route and `?a=` param semantics are a permanent public API.** New params may be added, but existing ones can never change meaning.

## The Mana Mechanic: The Frontier of Dreams

> **Rewritten 2026-10-14 for the October model; updated the same day to v3, "the pool is the treasury"** (design sessions of 2026-10-13/14; details, tasks and session log in [phases/05-mana-economy.md](./phases/05-mana-economy.md)). The August model (awe as the primary mana source, natural regeneration, donation afterglow, a per-player flow rate with diminishing returns, fixed game-design prices, targeted patronage, donor cosmetics) is retired.

Mana is the creative energy of the universe, **and it is literally money: 1 mana = 1 cent.** There is one universal pool, and **it is the treasury**: **all money entering Aweborn** (gifts, card sales, grants) flows in, and **every dollar out** is a labeled draw (creations, servers, cards, people, research, fundraising). So the pool is a **live picture of how much money Aweborn has**, radical transparency for a non-profit. Players create with the **creative share**, half of what comes in: manifesting things with Gen AI draws on it at exactly what that compute costs. **Nobody holds mana**, so every gift is a pure gift that empowers everyone.

The universe also has a physical boundary, the **Living Frontier**: a sphere of light whose radius follows the **high-water line**, all the money that has ever flowed into the pool plus the reach of awe. Inside the Frontier, worlds are **solid** on the universe map: colorful and alive. Outside lies the **Deep Dark**, where worlds appear as translucent **Ghosts** (wireframes of light). *(Decided 2026-10-17: this is only how a world looks from the universe view. Ghost worlds are fully playable and enterable by everyone, and inside them players barely notice any difference.)*

**Anyone can dream anything, anywhere, at any time, for free, even offline.** Dreaming (placing, arranging, building) never needs mana. **Manifesting** (channeling mana through a Gen AI prompt to make a new mesh, terrain, sound, or a whole world) draws on the creative share, and what it makes is real wherever it is. When the high-water line rises, the Frontier expands, and Ghost worlds caught in the wave of light **solidify**.

**Travellers make dreams real too.** Every world outside the Frontier has a **solidification meter**: `meter = 1 × (distinct saved players who entered) + 0.25 × (distinct saved players who sighted it)`, the creator excluded. It fills toward `target = 10 × (1 + d / 100 u)`, where `d` is the distance past the Frontier's edge (10 at the edge, 20 at 100 u, 60 at 500 u, 110 at 1,000 u), so it is harder the deeper you go. When it fills, the world solidifies for good, with a small golden ripple from that world and a quiet banner for players nearby ("12 travellers made Hollow Reef real"). As the Frontier grows, `d` shrinks, so gifts and travellers fill the meter from both ends. Cards sold and money never move the meter (that would be patronage). Numbers are a starting point to tune in playtests.

**Invite-only worlds** *(decided 2026-10-17)*: a creator can set a world to invite-only, free for everyone and never sold or a donor perk. It stays on the map as a sealed orb (it keeps its place and sits in the Frontier's path); only invited players can enter, and only their entries move its meter.

**Donations don't buy anything. Donations expand what everyone can make.** A donor watches a wave of golden light sweep outward from the Aweborn Portal. That is the defining visual moment of Aweborn.

**Awe is about growth, not energy.** Exploring, and the reactions other players have to what you made, earn experience and push the Frontier outward. Awe never mints spendable mana.

#### Three Numbers: the Pool, the Creative Share and the High-Water Line

| Number | What it is | Goes up when | Goes down when |
|---|---|---|---|
| **Pool** | The treasury: all the money Aweborn has, in mana | Any money comes in | Any money goes out (every draw is categorized) |
| **Creative share** | What players can create with right now (always ≤ the pool) | `α` of unrestricted money in | Someone manifests something |
| **High-water line** | All money that has ever come in, plus awe reach | Money comes in, or awe happens | **Never** |

Players draw only from the creative share; salaries and servers draw only from the rest. If non-creative spending would push the pool below the creative share, that's a budget alarm, never a quiet raid on players' mana. The pool is displayed smoothed (e.g. a 30-day average) so payday reads as a calm breath, not a crash.

The Frontier is set by the high-water line, so **spending never shrinks reality** and solidified worlds never revert. If gifts slow down, the Frontier simply waits.

```js
// Universe CRDT — top level (server-written)
Y.Map("universe") {
  mana: {
    pool: 250_000,          // the treasury now (all money in − all draws out)
    creative: 120_000,      // creative share players can draw now (≤ pool)
    reserved: 1_200,        // estimates held for in-flight manifestations
    highWater: 900_000,     // Σ inflow + Σ awe reach; never falls
    frontierRadius: 5000,   // c · ∛(highWater)
    totalIn: 800_000,       // lifetime mana in, all sources
    drawnBy: { creations: 280_000, infra: 90_000, cards: 60_000, people: 80_000, research: 30_000, fundraising: 10_000 },
    params: { K: 100, alpha: 0.5, tauDays: 30 },
    lastDonationAt: 1723848000,
  }
}
```

#### The Mana Pool Formula

```text
K = 100 mana per dollar                    1 mana = $0.01
α = 0.5  creative fraction of unrestricted money in   (see "Where money goes")
τ = 30 days                                 drain horizon of the creative share (see "Flow")

Money in (any source, net of fees)   m = K · net        pool += m;  highWater += m;  creative += α · m'
                                     (m' = m for gifts; card sales after production + shipping; restricted grants: 0)
Money out (categorized)              pool −= K · amount             (creations · infra · cards · people · research · fundraising)
Manifestation settles                creative −= cost × K;  pool −= cost × K
Awe happens                          highWater += reach(awe);    xp[player] += xp(awe)
Frontier                             frontierRadius = c · ∛(highWater)
```

Linear in money: every dollar in adds the same mana, every dollar out subtracts it, and nothing else touches the pool. No regeneration, no afterglow, no markup.

#### Where Money Goes (`α`)

All of every gift becomes mana in the pool. Half of it is the creative share; the other half funds the MatchRank research the game exists for (see [RESEARCH.md](./RESEARCH.md)), the people who run Aweborn, and fundraising. Draft split: **50% creative share (compute), 20% research, 30% operations and fundraising.** Rationale and references are in [phases/05-mana-economy.md → Why α = 0.5](./phases/05-mana-economy.md#why-α--05-and-τ--30-days). In short: it keeps program spending (mana + research) at 70%, above the BBB Wise Giving Alliance's 65% standard, without starving the organization, and it is a single honest number donors can understand. The board revisits `α` yearly; if a founding grant covers operations, `α` for individual gifts can rise toward 1.

#### Flow: How the Creative Share Is Shared

```text
Global flow per minute     G = max(creative / τ, p_solo)      never more than the creative share itself
Active players             N = distinct players active in the last 30 minutes
Personal cap               p_i = base(level_i) × solar_i       solar_i ∈ [0.9, 1.1]
Each player's flow         max-min fair split of G among the N active players, each capped at p_i
```

- **One player alone** gets their full personal cap, straight from the creative share (`G` is never below one player's cap while there is creative mana).
- **A thousand players** share `G`: each gets `G / N`, and whatever a player doesn't use is redistributed to those who want more (max-min fairness, "water-filling"). Nobody is ever capped *below* their fair share, and nobody gets more than their personal cap.
- **`τ = 30 days`:** the creative share can never shrink by more than ~3.3% of itself per day, so a single busy afternoon can never drain it and a dry spell drains it gently over weeks instead of crashing. (90 days was simulated too: gifts piled up unused while players were throttled almost every day.)
- **Requests are ordered** (priority order; formula later). Each one asks *"how much compute does this take?"* If the estimate exceeds what the creative share, `G` or the player's cap allows right now, it's no-dice and the universe whispers: *"The world must be replenished…"* (gentle, never punitive). Admission reserves the estimate; the real cost is drawn when it finishes; failures draw nothing.

#### Mana Costs

Mana does not gate dreaming. A manifestation costs **its real compute cost × `K`**, priced by complexity and abstracted from any specific AI provider:

| Kind of action | Cost |
|---|---|
| Place, move, arrange, delete, build, anything offline | Free or nominal |
| Meshes, terrain, textures, sound and music, voices | Real compute × K (a lot) |
| A whole new world with its own meshes and sounds | Real compute × K (a lot more) |

The per-modality table lives in Phase 07 (`MANA_COSTS.md`), measured from real API bills. Removing an object returns no mana: energy spent is spent.

#### Experience and Levels

Levels unlock abilities: a scaffolded, studio-like journey through every creation tool. **Warp comes last** (2026-10-14): move → steer → drive/neutral → enter a world → place objects → the maker tutorials → master your immediately accessible space *and* explore enough of the universe → warp. Money never unlocks anything. A level measures **a mix of**:

- **Mana successfully channeled into creations** (settled and still standing; concave scaling so it can't be ground out by burning the shared pool), and
- **Breadth of skills** along the creator's journey (first successful use of each tool; reaching level *n* requires *k* distinct skills).

Awe (exploring, discovering worlds) and **reactions** (other players' awe at what you made) also give experience. Card taps and `/w/<uuid>` links always deliver a player inside a world, at any level.

##### Awe — How Wonder Grows You and the Universe

Awe is tracked per player. Each event gives that player **experience** and pushes the **high-water line** (and the Frontier) outward for everyone. It never adds spendable mana.

```js
// Awe events — each gives XP + high-water reach (amounts set with the levels design)
"first-world-visit"     // first time entering a world you've never seen
"first-creation-seen"   // seeing an object placed by another player for the first time
"distance-milestone"    // reaching a new distance-from-origin record
"slingshot-chain"       // chaining gravity slingshots (3+ in a row)
"cluster-discovery"     // finding a cluster of worlds you haven't visited
"long-absence-return"   // returning after 7+ days away — the universe missed you
"reaction"              // someone else's awe at a world you made credits you
"shared-awe"            // 2× when experiencing awe near other players
```

**Shared awe** makes social exploration intrinsically valuable. **Diminishing novelty:** revisits give less each time, with a small warm baseline for coming home.

##### Solar Tidal Cycle — The Universe Breathes With the Sun

Two gentle effects from the player's local solar position (browser timezone + sunrise/sunset):

1. **Visual:** warmer and more vivid by day, cooler and deeper at night.
2. **A small modifier on personal caps:** 1.1× at solar noon down to 0.9× at midnight, sinusoidal. You *can* create at night, just a little slower. The universe whispers "maybe rest soon."

#### Mana Is Visible, Audible, and Tangible

The mana pool is not a hidden number. The entire universe reflects its state through every sensory channel:

**Visual** — richly layered, as much as hardware allows:

| Pool Level | Stars | Nebulae | Particles | Trails | Other |
|-----------|-------|---------|-----------|--------|-------|
| **High (>80%)** | Bright, saturated, large | Glow richly, deep colors | Everywhere — ambient fireflies, energy rivers, drifting motes | Long and vivid | Energy filaments connect nearby worlds |
| **Medium (30-80%)** | Normal — the baseline | Standard clouds | Moderate particle density | Standard length | Baseline rendering |
| **Low (<30%)** | Dim, desaturated | Thin, wispy | Sparse, slow-moving | Short, faint | Space feels emptier |
| **Critical (<5%)** | Nearly dark | Gone | Gone | Barely visible | Subtle aurora near Aweborn Portal — a hint that donations can restore energy |

*(Percent of what is open: e.g. the creative share relative to 30 days of typical draw. The treasury pool itself is shown smoothed.)*

**Audio** — the universe breathes:

| Pool Level | Ambient | Creation Sound |
|-----------|---------|---------------|
| **High** | Warm, full harmonic hum — the universe is alive | Drawing mana to create: a satisfying deep exhale, as if the universe is breathing *through* you |
| **Medium** | Gentle baseline hum | Standard creation sound |
| **Low** | Near-silence — occasional distant tone | Creation sound is thinner, more effortful |
| **Critical** | Silence — the universe is dormant | A strained whisper — creation is possible but the universe is tired |

**The Donation Moment — The Solidification Wave:** When someone donates while players are online, the pool swells, the high-water line rises and the Living Frontier physically expands. A **wave of golden light ripples outward from the Aweborn Portal**. Ghost worlds caught in its path **solidify in real time** on the universe map: wireframes fill with color and particles burst. Every player sees and feels it. **The only donor perk is recognition, and it's opt-in:** "A wave of light from ★ Alex" or "A wave of light from ★ a generous soul".

#### Shooting Stars: Every Draw Is Visible

*(Decided 2026-10-14 evening.)* The pool is the treasury, so the universe shows money moving both ways. **Money in swells the universe:** a gift sends the golden wave; **buying a card in-game** sends a golden breath and a beam that lights up that card's world. **Money out leaves as shooting stars**, one for every draw, and the categories are real non-profit accounting (IRS Form 990 Part IX, *Statement of Functional Expenses*), so watching the sky teaches how a non-profit spends:

| Color = function | What leaves | How it looks |
|---|---|---|
| **Gold: program services** | Creations, research, cards (outreach), gameplay servers | A creation's star rises from its world out past the Frontier "to the forge" and the creation materializes as it returns; a card's star falls toward the real world as it's printed; servers are a faint steady drizzle |
| **Blue: management & general** | Admin tools, accounting, legal, insurance | Short, quiet streaks from the Portal |
| **Silver: fundraising** | Campaigns, grant writing, payment processing | Silver streaks from the Portal |

Tap a star to see its Form 990 expense line ("Information technology · program · 42 mana · today"). **Pay** is one combined *Compensation* line (wages, benefits, payroll taxes), allocated across the three functions by time spent and released smoothly over the month; individual pay is never shown. Bills like servers and payroll are spread evenly over their period, so payday is a gentle stream, not a storm. Star size grows with the amount, and in busy times small draws merge into bigger stars (a meteor shower, not a blizzard). Details: [phases/05-mana-economy.md → Shooting Stars](./phases/05-mana-economy.md#shooting-stars-every-draw-is-visible-alex-2026-10-14-evening).

#### The Donation → Mana → Frontier Pipeline

```
Player donates $10 via Stripe
  → Lambda receives webhook (payment_intent.succeeded)
  → net of fees ≈ $9.41 → m = K · net = 100 × 9.41 ≈ 941 mana
  → pool += 941, highWater += 941, creative += α · 941 ≈ 470, ledger entry written (via the VPS)
  → VPS recalculates frontierRadius, broadcasts the expansion
  → ALL PLAYERS SEE: golden solidification wave (with the donor's name, if they opted in)
  → Ghost worlds caught in the wave: wireframes fill with color on the universe map
```

(Impact per amount depends on how big the universe already is: early gifts move the Frontier dramatically, because radius grows as the cube root of the high-water line.)

#### Server Authority for Mana

Mana is one of the few things that **must be server-authoritative** (the VPS validates every draw; Lambda handles donation ingestion):

1. Client asks to manifest: "generate this terrain" (estimate: 40 mana)
2. VPS checks: creative share − reserved enough? Fits the global flow `G` and this player's fair share and personal cap? Action legitimate?
3. VPS reserves the estimate, writes the ledger, confirms
4. Generation runs; the real cost is drawn on completion (failures draw nothing)
5. If denied → *"The world must be replenished…"*

**Dreaming is free and needs no server validation.** Ghost worlds, placing and arranging, and everything offline never touch the creative share. There is nothing to double-spend.

#### Offline Creation — The Dream State

Players can create **freely and without limits** while offline. Every offline creation — worlds, objects, terrain, structures — syncs on reconnect and is placed by the server (solid if it lands inside the Frontier, a Ghost if not). No locally cached mana, no budget, no validation-on-reconnect. 

**Offline Reconnect Collisions:** Because the server has ultimate authority on spatial positioning (to prevent overlap), when the offline player reconnects, their client syncs the CRDT. If their offline creation collides with an online creation, the server detects the collision. Rather than deleting the offline player's creation, the server's spatial resolver deterministically "nudges" the offline object along an outward vector to the nearest unoccupied space and updates the canonical CRDT. The client sees their object gently slide into an open slot.

The offline experience is still rich and beautiful: Ghost worlds have their own ethereal look on the universe map (translucent wireframes, soft glow, a thin meter ring). Building offline feels like sculpting in the realm of pure imagination. When you reconnect, a dream placed in the Deep Dark waits there for the Living Frontier, or for enough travellers, to make it real.

#### Emergent Behaviors

- **"The Frontier Is Expanding!"** — A donation lands and a wave of golden light sweeps outward. Ghost worlds solidify in its wake. Every player online witnesses it. The defining moment of Aweborn.
- **"Deep Dark Explorers"** — Adventurous players fly beyond the Living Frontier into the Deep Dark to build Ghost worlds on the edge, waiting for the Frontier to reach them, and their exploring pushes it outward.
- **"Ghost Galleries"** — Beautiful Ghost worlds in the Deep Dark become tourist attractions even before solidification. Every traveller who enters fills the meter, and a card collected while it is still a Ghost is a **Dreamt** edition forever.
- **"Travellers Make It Real"** — A well-visited world far from the Frontier solidifies on its own, with a small golden ripple and a banner for those nearby.
- **The Golden Wave** — The most impactful visual in the game. Someone donates, and the universe physically grows. Not a notification — a visceral, visible expansion of reality.
- **Exploration as the Engine** — Awe levels you up and pushes the Frontier outward for everyone. Curiosity literally expands reality.
- **Making Things People Love** — Other players' awe at your world is how makers grow. The universe rewards creations that move people, not volume.
- **Shared Wonder** — Awe experienced near other players counts double. Social exploration is the most efficient way to expand reality.
- **The Museum of Everything** — Worlds persist forever. No decay, no recycling, no harvesting. The universe is an ever-growing museum of everything anyone ever made. Walk far enough and you'll find worlds from the very first day.
- **No Grinding** — Nothing to farm, hoard, or trade. Nobody holds mana. Dreaming is always free.
- **Healthy Rhythms** — Solar tidal cycles nudge players toward real-world daylight activity. The game doesn't want you at 3am — the universe dims to match.
- **The Ever-Expanding Universe** — The universe never shrinks and creations never fade back to Ghosts. The Frontier is a high-water mark of generosity and wonder. If gifts slow, it simply waits for the next surge.

#### System Rules & Validation

- **Frontier radius formula:** If Mana represents the *volume* of reality, then $Volume \propto Mana$. Since $Volume = \frac{4}{3}\pi r^3$, the radius of the frontier grows as the cube root of the **high-water line** ($r \propto \sqrt[3]{H}$), not of the spendable pool, so spending never shrinks reality (decided 2026-10-13). Early gifts expand the universe rapidly, but as the universe gets massive, it takes far more to push the frontier outward.
- **Targeted Sector Expansion:** The frontier isn't a perfect sphere. The universe is mapped as a 3D grid of **Sectors**. Each sector has its own `solidificationLevel`. When awe is generated in a specific sector, that sector expands outward organically like a nebula, creating outward "bulges" where players explore most. (Targeted patronage was removed 2026-10-13.)
- **Client/Server Validation Architecture:** We use **Client-Side Prediction with Server Reconciliation**. When a player places an object, the client instantly validates it locally (checking for collisions, etc.) and renders it immediately. It sends the action to the server. The VPS runs a lightweight authoritative check. If a player hacks their client to place objects inside walls, the server rejects the CRDT update and forces a reversion, snapping the object back.
- **Solidification wave visual/audio design:** A golden, translucent shockwave that distorts the stars behind it (refraction shader). As it hits a Ghost world on the universe map, the wireframe shatters into glowing particles and instantly reforms as a solid glowing orb. A deep, resonant bass note sweeps across the audio spectrum, leaving a warm orchestral hum in its wake.
- **Awe generation:** The awe generated by seeing an object is proportional to the mana it took to manifest (as XP and high-water reach, never spendable mana). A massive sculpture generates massive awe. To prevent farming, each player has an "Awe Exhaustion" curve per object/world. First view = 100% awe, second view = 10%, thereafter = 0%. The universe demands fresh exploration.
- **Object removal governance (World Ownership):**
  1. **The Creator:** Has ultimate power to delete/move anything in their world. Future additions may include configurable roles (e.g., Observer, Builder).
  2. **The Placer:** You can always delete/move an object *you* placed.
  3. **Co-Creators:** The World Creator can grant "Co-creator" status to specific players, allowing them to delete/move anything.

### Open Design Questions

- **⬜ World Interiors:** What can players actually do inside a world? (place objects, sculpt, draw, just hang out?)
- **⬜ Universe Entry Point:** What does a brand-new player see when they first open aweborn.org? How do they orient?
- **🟡 Mana Tuning (drafted 2026-10-14):** `K = 100` (1 mana = 1 cent), the pool is the treasury, `α = 0.5` creative share, `τ = 30` days, solar ±10% on personal caps, founding gift $1,000. Still open: personal cap per level, priority formula, level curve, warp thresholds ("mastered", "explored enough"), public per-category display, retuning the Frontier constant `c`. See [Phase 05](./phases/05-mana-economy.md)
- **✅ Discovery threshold (World Index) (decided 2026-10-12):** Two states. *Sighted* = within close range (100 u) or landed beside it by link/card/warp: face-down card, can warp to it. *Visited* = went inside: full card art. Sightings work offline (queued, replayed later). Anti-cheat: cheap server checks now, server-derived sightings in Phase 09.
- **✅ World Index Warp rules (decided 2026-10-12, amended 2026-10-13):** free, standard K charge animation, no cooldown (movement never costs mana), **once unlocked by level**. Card/link arrival is never gated.
- **✅ World Index key binding (decided 2026-10-12):** `M` (think Map) + a HUD chip for touch. Gamepad later.
- **✅ Player identity persistence (decided 2026-10-11, built 2026-10-12):** One player across tabs and devices. Anonymous first (no signup wall). Ways in: passkeys, Google, email code (instead of a magic link) and email + password; Apple/Facebook deferred. An account owns *characters*; saved players never merge. The public `playerId` is never a credential; each device holds its own revocable session (Better Auth). Deferred: QR device linking, one screen steers. Tasks: Phase 08 → Persistent Player Identity.
- **🟡 Personal discovery rewards:** Discovery awe now gives XP (levels) and Frontier reach. Beyond that, any badge or set-completion flair stays cosmetic and can never be bought.
- **✅ Print-your-world → patronage (decided 2026-10-13):** no. Patronage is removed. All card money enters the pool; `α` of the surplus becomes creative share (2026-10-14).
- **✅ Card format (decided 2026-10-04):** TCG standard, 63×88 mm.
- **✅ QR fallback (decided 2026-10-04):** yes, a small QR (same URL) on the front.
- **⬜ Card art pipeline:** How is a world's portrait produced — player-taken in-game snapshot, automatic server-side render, or AI-generated (Phase 07)? In the World Index, worlds without art get a generated card (decided 2026-10-12).
- **⬜ Print + encode vendor:** Which vendor prints full-color NFC cards and encodes + locks a unique URL per card at small minimums? Or encode in-house with a USB NFC writer?
- **⬜ Product name:** "Aweborn Cards", "Worldcards", "Star Cards", "Portal Cards"…? (World Index is settled.)
