# Aweborn.org — Future Roadmap

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
- [The Mana Mechanic: The Frontier of Dreams](#the-mana-mechanic-the-frontier-of-dreams)
    + [The Universal Mana Pool](#the-universal-mana-pool)
    + [Mana Sources](#mana-sources)
      - [Awe Generation — How Wonder Creates Energy](#awe-generation--how-wonder-creates-energy)
      - [Solar Tidal Cycle — The Universe Breathes With the Sun](#solar-tidal-cycle--the-universe-breathes-with-the-sun)
    + [Mana Costs — Frontier Expansion & Solidification](#mana-costs--frontier-expansion--solidification)
    + [Draw Mechanics — Fairness + Donor Empowerment](#draw-mechanics--fairness--donor-empowerment)
      - [Donor Empowerment (Cosmetic Only)](#donor-empowerment-cosmetic-only)
      - [Diminishing Returns on Daily Draw](#diminishing-returns-on-daily-draw)
    + [Mana Is Visible, Audible, and Tangible](#mana-is-visible-audible-and-tangible)
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

- **Stateful Server with In-Memory CRDTs (Lightsail VPS):** The universe is persistent and authoritative. A stateful Node.js server (running on a $10/mo AWS Lightsail instance or equivalent VPS) holds the active Yjs `Y.Doc`s in RAM. When players send CRDT diffs, they merge in-memory with near-zero compute cost and broadcast to all connected clients over native WebSockets. The server flushes state to durable storage (Postgres/SQLite/DynamoDB) lazily — every ~60 seconds or when the last player leaves a world — reducing database writes by ~99.9% compared to a serverless approach.
- **Scaling Path:** Start with a single Lightsail instance. When load demands it, add nodes and hash `worldId` to route players joining the same world to the same server. Redis pub/sub for cross-node coordination if needed. This is the only architecture a non-profit can afford for real-time multiplayer.
- **Lambda for Non-Realtime Work:** Stripe webhook processing, donation ledger writes, and frontier expansion calculations are bursty and infrequent — perfect for serverless. Lambda handles these while the VPS handles everything real-time.
- **Dual-Mode Transport (Seamless Offline/Online):** Yjs is transport-agnostic, allowing the client to use two channels simultaneously:
  1. **Online (Client-Server):** `y-websocket` connects to the stateful VPS to sync with the authoritative in-memory state.
  2. **Offline/Local (P2P Mesh):** `y-webrtc` syncs with local peers on the same LAN/hotspot, or via QR-code signaled data channels.
  This allows players to build offline together in a mesh. Upon reconnecting, the client syncs all local edits to the VPS. The server validates structural changes, resolves collisions against the live universe, and writes the canonical positions back down to the clients. Offline creations sync as "Ghost" worlds (see **The Frontier of Dreams** section below).
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

##### Sneakernet CRDT Sync (Async / No Live Connection)

Even without a live connection, Yjs CRDT diffs are tiny (often < 1KB for a building action). Players can sync asynchronously:
- Build a world offline → app encodes the CRDT update as a QR code → friend scans it later → their world merges the changes automatically with zero conflicts.
- This is like "passing notes" — no network needed at all, just two cameras.


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
  solidified: true,         // false = Ghost world (outside Living Frontier or awaiting patronage)
  solidifiedAt: 1723848200, // When the Frontier reached this world (or Patron funded it)
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
│   └── solidified: true                (server-written — false until Frontier reaches or Patron funds)
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

Player presence uses the Yjs awareness protocol (`y-webrtc` has this built in). It's ephemeral — broadcast to nearby peers, disappears on disconnect. No storage cost.

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
2. **Client renders temporarily** at this position with a "settling" visual cue (e.g., pulsing or shimmer). New worlds outside the Living Frontier render as **Ghosts** (translucent wireframes).
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

This is bandwidth-efficient (2 CRDT writes per physics event, not 60/sec), visually consistent (same initial conditions → nearly identical trajectories), and offline-safe (events replay on reconnect). The VPS can validate kick velocities for anti-cheat (only in solidified worlds — Ghost worlds have no physics).

#### Offline Visual Treatment & Ghost States

The universe has two spatial zones — the **Living Frontier** (funded, lit, solid) and the **Deep Dark** (unfunded, dim, ghostly). Offline play and unfunded creations use the same visual language:

| State | Visual | Interaction |
|-------|--------|-------------|
| **Solid world (inside Living Frontier)** | Full color, vibrant glow, particles, physics, collision | Fully interactive — build, explore, play |
| **Ghost world (outside Frontier / offline-created)** | Translucent wireframe with soft ethereal glow, no collision, no physics | Can enter and explore/build, but everything is ghostly. A dream waiting to solidify |
| **Oasis (Patron-funded Ghost in the Deep Dark)** | Localized bubble of warm light in the darkness, fully solid inside | Fully interactive — an island of reality in the void |
| **Visited worlds (offline)** | Normal rendering with a subtle frost/ice shader, reduced glow | Can enter and explore the cached snapshot solo |
| **Unvisited worlds (offline)** | Dim, desaturated silhouettes | Tapping shows "Come back online to explore" |
| **Your own worlds (offline)** | Fully bright and interactive | Can keep building offline. All offline creations sync as Ghosts on reconnect |

**The reconnect moment:** Yjs automatically syncs all offline edits. If someone else edited the same world while you were away, the CRDT resolves it — no conflicts, no overwrites. Both sets of changes just appear. Your offline creations sync as Ghost worlds, awaiting the Living Frontier's expansion (or a Patron's generosity) to solidify.

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

## The Mana Mechanic: The Frontier of Dreams

Mana is the creative energy of the universe. It does not buy objects — it **expands reality itself.** The universe has a physical boundary called the **Living Frontier**: a sphere of light whose radius is a direct function of the global mana pool. Inside the Frontier, worlds are solid, colorful, and alive with physics. Outside it lies the **Deep Dark** — infinite, dim, unpowered space where creations exist only as translucent **Ghosts** (wireframes of light).

**Anyone can create anything, anywhere, at any time, for free — even offline.** But creations outside the Living Frontier are Ghosts: ethereal, collision-less, dreamlike. They represent *potential* — ideas waiting to become real. When the mana pool grows (via donations or awe), the Frontier physically expands, and any Ghost worlds caught in the wave of light are instantly **solidified** — wireframes fill with color, physics switch on, and the dream becomes a permanent monument.

**Donations don't buy cosmetics. Donations expand the universe.** A donor watches a wave of golden light sweep outward from the Aweborn Portal, turning ghost-dreams into solid reality. That is the defining visual moment of Aweborn.

#### The Universal Mana Pool

A single shared number in the Universe CRDT. Mana powers the **Living Frontier's radius** — the physical size of reality.

```js
// Universe CRDT — top level
Y.Map("universe") {
  mana: {
    pool: 1_000_000,              // Current available mana (shared by ALL)
    frontierRadius: 5000,          // Units from origin — the Living Frontier boundary
    totalEverGenerated: 5_000_000, // Lifetime (donations + awe + regen)
    totalEverSpent: 4_000_000,     // Lifetime consumed by frontier expansion + solidification
    regenRate: 100,                // Mana regenerated per hour (baseline)
    donationMultiplier: 1.0,       // Boost from recent donations (24hr decay)
    lastDonationAt: 1723848000,
    solarCycle: {                  // Tidal mana flow based on local solar position
      enabled: true,
      peakMultiplier: 1.5,        // Flow bonus at solar noon
      troughMultiplier: 0.6       // Flow reduction at midnight
    }
  }
}
```

#### Mana Sources

| Source | Priority | How It Works | Rate |
|--------|----------|-------------|------|
| **Awe (Exploration)** | **PRIMARY** | Visiting a new world, seeing a new creation, reaching unexplored space generates mana. Novelty = energy. Revisiting the same places generates less. The universe rewards curiosity. | Variable — scales with novelty |
| **Donations** | **BURST** | $1 USD = 1,000 mana added to the pool. Instant, powerful, physically expands the Living Frontier for everyone. | Instant burst |
| **Natural Regeneration** | **BASELINE** | Universe slowly regenerates mana — the Frontier slowly expands on its own, but donations dramatically accelerate it. | ~100/hr baseline |
| **Donation Afterglow** | **BOOST** | For 24hr after any donation, regen rate is boosted — the universe is "energized" | 2x-5x multiplier, decaying |
| **Solar Tidal Cycle** | **RHYTHM** | Mana flow follows the player's local sunrise/sunset. High flow during daylight, low flow at night. Quietly nudges healthy real-world sleep/activity cycles — the game doesn't want you lost in it at 3am. | ±50% flow modifier |

**No recycling.** Mana spent on frontier expansion and solidification is gone forever. The frontier can contract if mana drains below thresholds (worlds at the edge revert to Ghost state — they aren't destroyed, just dimmed). Every act of generosity permanently contributes to the universe's high-water mark.

##### Awe Generation — How Wonder Creates Energy

Awe is tracked per-player but the mana it generates flows into the **universal pool** (not to the individual). You explore, the universe gets richer — for everyone.

```js
// Awe events — each generates mana into the universal pool
{
  "first-world-visit":     500,   // First time entering a world you've never seen
  "first-creation-seen":   50,    // Seeing an object placed by another player for the first time
  "distance-milestone":    200,   // Reaching a new distance-from-origin record
  "slingshot-chain":       100,   // Successfully chaining gravity slingshots (3+ in a row)
  "cluster-discovery":     300,   // Finding a constellation/cluster of worlds you haven't visited
  "long-absence-return":   1000,  // Returning after 7+ days away — the universe missed you
  "shared-awe":            2x,    // Multiplier when experiencing awe near other players
}
```

The **shared-awe multiplier** is key: experiencing wonder *together* generates double the mana. Two players visiting a world at the same time produce more energy than two players visiting separately. This makes social exploration intrinsically valuable — the universe literally rewards togetherness.

**Diminishing novelty:** Revisiting the same world generates less awe each time (exponential decay). The universe gently pushes you toward the new, the unexplored, the edge. But there's always a small baseline — even coming home generates a trickle of warmth.

##### Solar Tidal Cycle — The Universe Breathes With the Sun

Mana flow follows the player's **local solar position** using the browser's timezone and a sunrise/sunset API:

```
                    ☀️ Solar Noon
                   ╱  ╲     Flow: 1.5x
                  ╱    ╲    Universe is bright, creation is fluid
                 ╱      ╲
────────────────╱────────╲──────────────────── 1.0x baseline
               ╱          ╲
              ╱            ╲
             ╱              ╲
            ╱                ╲   Flow: 0.6x
           ╱                  ╲  Universe dims gently
          🌙 Midnight          🌙
```

This isn't punitive — you *can* create at night, just slower. The universe is resting. So should you. Players in different timezones experience different tidal phases simultaneously — the mana pool receives a blended flow from the global community's collective daylight.

The visual effect: during your local daytime, the universe is subtly warmer-toned and more vivid. At night, it shifts cooler, deeper, more contemplative. You can still explore and create — the universe just whispers "maybe rest soon."

#### Mana Costs — Frontier Expansion & Solidification

Mana does not gate creation. **Anyone can build anything, anywhere, for free — even offline.** Mana powers the *reality* of those creations: expanding the Living Frontier, solidifying Ghost worlds, and modifying the physics of solidified worlds.

**Frontier Expansion (Automatic):**

As the mana pool grows, the Living Frontier's radius expands. This is the primary mana "cost" — maintaining and growing the sphere of reality. The server continuously recalculates `frontierRadius` as a function of the pool. Ghost worlds caught in the expansion automatically solidify.

**Targeted Solidification (Patronage):**

| Action | Mana Cost | Notes |
|--------|----------|-------|
| Solidify a Ghost world (targeted Patron donation) | 5,000 | Creates an **Oasis** — a localized bubble of light in the Deep Dark |
| Expand an Oasis radius | 1,000 per tier | Grow the bubble of reality around a patronized world |

**In-World Modifications (Solidified Worlds Only):**

These actions draw mana from the universal pool and require a solidified world. In Ghost worlds, these actions are "queued" and take effect upon solidification.

| Action | Mana Cost | Notes |
|--------|----------|-------|
| Place a basic object (cube, sphere, ramp) | 10-50 | Free as Ghost; costs mana only in solidified worlds |
| Place a complex object (tree, structure, vehicle) | 100-500 | Same |
| Custom sculpt (freeform 3D) | 50-200 per edit | Same |
| Import/paste from another world | 50% of original cost | Same |
| Remove an object | Free | **No mana returned** — energy is spent, not recycled |
| Move/rearrange an object | Free | Repositioning doesn't cost mana |

**Object removal policy:** Objects can be removed under reasonable circumstances (by the world creator, or by the player who placed them, or through a future permissions/governance system). Removal is free but **does not return mana** to the pool.

**Physics & Rules (Solidified Worlds Only):**

| Action | Mana Cost |
|--------|----------|
| Change gravity | 500 |
| Change friction / bounce / air resistance | 200 each |
| Set water level | 300 |
| Create a custom physics zone (localized gravity) | 1,000 |

**Avatar / Star Customization:**

| Action | Mana Cost |
|--------|----------|
| Change trail style | 50 |
| Change aura effect | 50 |
| Change star shape | 100 |
| Change star color | 25 |
| Unlock a new costume/skin | 200-1,000 |
| Emote / signal | 5 per use |

**Sound & Music (Solidified Worlds Only):**

| Action | Mana Cost |
|--------|----------|
| Place an ambient sound source | 100 |
| Compose a music loop (in-world sequencer) | 200-500 |
| Record a voice message (embedded in world) | 50 |
| Change world ambient soundtrack | 300 |

**Gameplay & System Mods (Solidified Worlds Only):**

| Action | Mana Cost |
|--------|----------|
| Custom keyboard remapping (for your world) | 500 |
| Create a gameplay rule (win condition, scoring) | 1,000 |
| Set an entry cost (visitors spend mana to enter) | Requires 2,000+ mana in world |

#### Draw Mechanics — Fairness + Donor Empowerment

Each player has a **flow rate** — the maximum speed at which they can draw mana from the universal pool. The base pipe is the same diameter for everyone. But **donors get a wider pipe** — with exponentially diminishing returns that converge at a cap.

```
flowRate = baseRate * activityMultiplier * solarModifier * diminishingReturns

where:
  baseRate           = 100 mana/minute (same for every player, always)
  activityMultiplier = 1.0-2.0 (exploring/awe earns faster draw)
  solarModifier      = 0.6-1.5 (based on local sun position)
  diminishingReturns = decreases as you draw more in a 24hr window
```

##### Donor Empowerment (Cosmetic Only)

The design intent: **donating should feel empowering**, but we strictly avoid "pay-to-win" or functional advantages. The flow rate of mana is identical for everyone (free and donor players alike). 

Instead, donors are rewarded with exclusive cosmetic flair:
- Unique star shapes and aura colors
- Special titles, badges, and companion "pets" (small orbiting bodies)
- The profound visual feedback of seeing the universe physically expand outward from their donation.

A $0 player can build everything a $500 player can, at the exact same speed. The gap is purely visual and never gatekeeping.

##### Diminishing Returns on Daily Draw

Regardless of flow rate (base or boosted), heavy creation in a single session slows down:

| Mana drawn in last 24hr | Flow rate multiplier |
|--------------------------|---------------------|
| 0 - 1,000 | 1.0x (full speed) |
| 1,000 - 5,000 | 0.7x (slowing) |
| 5,000 - 10,000 | 0.4x (slow) |
| 10,000 - 20,000 | 0.2x (trickle) |
| 20,000+ | 0.05x (drip — still works, just slowly) |

Not a hard cap — a soft pressure to share the universe's energy. Come back tomorrow and your rate resets. This applies equally to free and donor players.

#### Mana Is Visible, Audible, and Tangible

The mana pool is not a hidden number. The entire universe reflects its state through every sensory channel:

**Visual** — richly layered, as much as hardware allows:

| Pool Level | Stars | Nebulae | Particles | Trails | Other |
|-----------|-------|---------|-----------|--------|-------|
| **High (>80%)** | Bright, saturated, large | Glow richly, deep colors | Everywhere — ambient fireflies, energy rivers, drifting motes | Long and vivid | Energy filaments connect nearby worlds |
| **Medium (30-80%)** | Normal — the baseline | Standard clouds | Moderate particle density | Standard length | Baseline rendering |
| **Low (<30%)** | Dim, desaturated | Thin, wispy | Sparse, slow-moving | Short, faint | Space feels emptier |
| **Critical (<5%)** | Nearly dark | Gone | Gone | Barely visible | Subtle aurora near Aweborn Portal — a hint that donations can restore energy |

**Audio** — the universe breathes:

| Pool Level | Ambient | Creation Sound |
|-----------|---------|---------------|
| **High** | Warm, full harmonic hum — the universe is alive | Drawing mana to create: a satisfying deep exhale, as if the universe is breathing *through* you |
| **Medium** | Gentle baseline hum | Standard creation sound |
| **Low** | Near-silence — occasional distant tone | Creation sound is thinner, more effortful |
| **Critical** | Silence — the universe is dormant | A strained whisper — creation is possible but the universe is tired |

**The Donation Moment — The Solidification Wave:** When someone donates while players are online, the mana pool swells and the Living Frontier physically expands. A **wave of golden light ripples outward from the Aweborn Portal** at the center of the universe. As the wave passes through the Deep Dark, Ghost worlds caught in its path **solidify in real-time** — wireframes fill with color, physics switch on, particles burst. Every player sees and feels it simultaneously. Donor recognition is **optional and configurable** — the donor can choose to be named ("A wave of light from ★ Alex") or stay anonymous ("A wave of light from ★ a generous soul").

#### The Donation → Mana → Frontier Pipeline

```
Player donates $10 via Stripe
  → Lambda receives webhook (payment_intent.succeeded)
  → Lambda calculates: $10 × 1,000 = 10,000 mana
  → Lambda atomically adds to universe.mana.pool
  → Lambda updates donor's lifetimeDonations (for flow rate bonus)
  → Lambda writes donation event to manaLedger
  → Lambda sets donationMultiplier boost (24hr afterglow)
  → VPS receives CRDT update, recalculates frontierRadius
  → VPS broadcasts frontier expansion to all connected clients
  → ALL PLAYERS SEE: Golden solidification wave sweeps outward
  → Ghost worlds caught in wave: wireframes fill with color, physics activate
  → DONOR SEES: New cosmetic flares unlocked + the wave they caused
```

| Donation | Mana Added | Rough Impact |
|----------|-----------|-------------|
| $5 | 5,000 | Frontier expands ~1 sector. Nearby ghost worlds solidify. Donor unlocks basic flare. |
| $10 | 10,000 | Noticeable expansion. Multiple ghost worlds solidify. |
| $25 | 25,000 | Major expansion. Deep Dark explorers see their builds light up. |
| $50 | 50,000 | Sweeping wave — a whole frontier ring solidifies. |
| $100 | 100,000 | Massive burst — the Deep Dark retreats visibly. |
| $500 | 500,000 | "Golden age" — the Living Frontier leaps outward. Ghost galleries become real. |

#### Server Authority for Mana

Mana is one of the few things that **must be server-authoritative** (the VPS validates all draws for solidified-world actions; Lambda handles donation ingestion):

1. Client requests a draw: "I want to change gravity in my solidified world (500 mana)"
2. VPS checks: pool sufficient? Flow rate within limits (including donor bonus and solar modifier)? Action legitimate? World solidified?
3. VPS deducts atomically, writes transaction to ledger CRDT
4. VPS confirms → client proceeds with modification
5. If denied → client sees "The universe needs more energy" (gentle, not punitive)

Note: **Ghost creation is free and requires no server validation.** Players can build unlimited Ghost worlds offline or in the Deep Dark without any mana check. Only solidification and in-world modifications to solidified worlds draw from the pool. This eliminates the offline mana paradox entirely — there is nothing to double-spend.

Donor status and cosmetic unlocks are stored server-side (tied to verified Stripe payment history), so they can't be spoofed.

#### Offline Creation — The Dream State

Players can create **freely and without limits** while offline. Every offline creation — worlds, objects, terrain, structures — syncs as a **Ghost** upon reconnect. No locally cached mana, no budget, no validation-on-reconnect. 

**Offline Reconnect Collisions:** Because the server has ultimate authority on spatial positioning (to prevent overlap), when the offline player reconnects, their client syncs the CRDT. If their offline creation collides with an online creation, the server detects the collision. Rather than deleting the offline player's creation, the server's spatial resolver deterministically "nudges" the offline object along an outward vector to the nearest unoccupied space and updates the canonical CRDT. The client sees their object gently slide into an open slot.

The offline experience is still rich and beautiful: Ghost worlds have their own ethereal aesthetic (translucent wireframes, soft glow, dreamlike particle effects). Building offline feels like sculpting in the realm of pure imagination. When you reconnect, your dreams appear in the Deep Dark, waiting for the Living Frontier to reach them — or for a Patron to bring them to life.

#### Emergent Behaviors

- **"The Frontier Is Expanding!"** — A donation lands and a wave of golden light sweeps outward. Ghost worlds solidify in its wake. Every player online witnesses it. The defining moment of Aweborn.
- **"Deep Dark Explorers"** — Adventurous players fly beyond the Living Frontier into the Deep Dark to build Ghost worlds on the edge, hoping their creations are beautiful enough that a Patron will fund them into reality, or that the Frontier will reach them.
- **"The Patron"** — Donors can browse Ghost worlds in the Deep Dark and choose which dreams to fund. A targeted donation creates an Oasis — a bubble of light and reality far from the Frontier.
- **"Ghost Galleries"** — Beautiful Ghost structures in the Deep Dark become tourist attractions even before solidification. Players visit to admire the wireframe art, knowing it might solidify any day.
- **The Golden Wave** — The most impactful visual in the game. Someone donates, and the universe physically grows. Not a notification — a visceral, visible expansion of reality.
- **Exploration as the Engine** — Awe is the primary mana source. Free-to-play players who explore actively generate more mana for the universe than passive players. Curiosity literally expands the Frontier.
- **Shared Wonder** — Experiencing awe near other players generates 2x mana. The universe rewards togetherness. Social exploration is the most efficient way to expand reality.
- **The Museum of Everything** — Worlds persist forever. No decay, no recycling, no harvesting. The universe is an ever-growing museum of everything anyone ever made. Walk far enough and you'll find worlds from the very first day.
- **No Grinding** — Nothing to farm, hoard, or trade. Mana comes from wonder and generosity, not repetitive action. Creation is always free (as a Ghost).
- **Healthy Rhythms** — Solar tidal cycles nudge players toward real-world daylight activity. The game doesn't want you at 3am — the universe dims to match.
- **The Ever-Expanding Universe** — The universe never shrinks and creations never fade back to Ghosts. The universe's expansion is an accelerating high-water mark of human generosity and engagement. If mana generation slows, the frontier simply stops expanding and waits for the next surge of Awe or donations.

#### System Rules & Validation

- **Frontier radius formula:** If Mana represents the *volume* of reality, then $Volume \propto Mana$. Since $Volume = \frac{4}{3}\pi r^3$, the radius of the frontier grows as the cube root of the mana pool ($r \propto \sqrt[3]{Mana}$). Early donations expand the universe rapidly, but as the universe gets massive, it takes exponentially more mana to push the frontier outward.
- **Targeted Sector Expansion:** The frontier isn't a perfect sphere. The universe is mapped as a 3D grid of **Sectors**. Each sector has its own `solidificationLevel`. When awe is generated in a specific sector, that sector expands outward organically like a nebula. Targeted patronage creates massive outward "bulges" in specific directions.
- **Client/Server Validation Architecture:** We use **Client-Side Prediction with Server Reconciliation**. When a player places an object, the client instantly validates it locally (checking for collisions, etc.) and renders it immediately. It sends the action to the server. The VPS runs a lightweight authoritative check. If a player hacks their client to place objects inside walls, the server rejects the CRDT update and forces a reversion, snapping the object back.
- **Solidification wave visual/audio design:** A golden, translucent shockwave that distorts the stars behind it (refraction shader). As it hits a Ghost world, the wireframes shatter into glowing particles and instantly reform as solid, textured objects. A deep, resonant bass note sweeps across the audio spectrum, leaving a warm orchestral hum in its wake.
- **Awe generation:** The awe generated by seeing an object is equal to the mana cost of the object. A massive sculpture generates massive awe. To prevent farming, each player has an "Awe Exhaustion" curve per object/world. First view = 100% awe, second view = 10%, thereafter = 0%. The universe demands fresh exploration.
- **Object removal governance (World Ownership):**
  1. **The Creator:** Has ultimate power to delete/move anything in their world. Future additions may include configurable roles (e.g., Observer, Builder).
  2. **The Placer:** You can always delete/move an object *you* placed.
  3. **Co-Creators:** The World Creator can grant "Co-creator" status to specific players, allowing them to delete/move anything.

### Open Design Questions

- **⬜ World Interiors:** What can players actually do inside a world? (place objects, sculpt, draw, just hang out?)
- **⬜ Universe Entry Point:** What does a brand-new player see when they first open aweborn.org? How do they orient?
- **⬜ Mana Tuning:** Finalize dollar-to-mana ratio, solar cycle parameters
