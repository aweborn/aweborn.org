# Aweborn.org — Handoff

## Project overview

An immersive 3D donation experience for Aweborn, a non-profit. Users explore a cosmic scene (React Three Fiber) and donate via Stripe. Deployed live at `https://aweborn.org`.

## Architecture

```
User → CloudFront (CDN) → S3 (static Vite/React app)
                        ↘ API Gateway → Lambda → Stripe API
```

- **Frontend**: Vite + React 19 + TypeScript + React Three Fiber (Three.js r185) + Stripe Elements
- **Backend**: Single Lambda function (Node.js 20, inline in CloudFormation) that proxies to Stripe
- **Infra**: All in `infra/cloudformation.yml` — S3, CloudFront, ACM cert, Route53 DNS, API Gateway, Lambda
- **CI/CD**: `.github/workflows/deploy.yml` — auto-deploys on push to `main` via OIDC auth
- **Domain**: `aweborn.org` + `www.aweborn.org`, Hosted Zone ID `Z077908710IGH7R1XO587`

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Root — WebGL detection, routes to 3D or 2D fallback |
| `src/components/Scene.tsx` | R3F Canvas wrapper, post-processing, loading progress |
| `src/components/Environment.tsx` | Cosmic scene — starfield, clouds, floating islands, nebula rings, lights |
| `src/components/DonationPortal.tsx` | 3D glowing orb that triggers the donation modal on click |
| `src/components/DonationModal.tsx` | Three-step modal: amount selection → embedded Stripe Payment Element → success animation |
| `src/components/HUD.tsx` | Heads-up display — brand mark, donate prompt |
| `src/components/LoadingScreen.tsx` | Animated loading screen with progress bar |
| `src/components/FallbackScene.tsx` | 2D fallback for no-WebGL — includes browser-specific fix instructions |
| `src/components/CanvasErrorBoundary.tsx` | React error boundary for R3F Canvas crashes |
| `src/hooks/usePaymentIntent.ts` | Hook — calls `POST /create-payment-intent`, returns `clientSecret` for embedded Elements |
| `src/hooks/useStripeCheckout.ts` | (Legacy) Hook for redirect-based Checkout Sessions — kept as fallback, no longer used by modal |
| `src/index.css` | Full design system — tokens, glass effects, animations, payment form styles, success animation |
| `.env.production` | `VITE_API_ENDPOINT` and `VITE_STRIPE_PUBLISHABLE_KEY` |
| `infra/cloudformation.yml` | Complete AWS stack (S3, CloudFront, ACM, Route53, API GW, Lambda) with both `/create-checkout-session` and `/create-payment-intent` routes |

## Current donation flow

1. User clicks the glowing 3D portal → `DonationModal` opens as 2D overlay
2. **Step 1 — Amount**: User picks a preset ($10–$500) or enters a custom amount → clicks "Continue"
3. `usePaymentIntent` hook calls `POST /create-payment-intent` on API Gateway (proxied via Vite during development)
4. Lambda creates a Stripe PaymentIntent and returns `{ clientSecret }`
5. **Step 2 — Payment**: Stripe `<PaymentElement>` renders inline inside the glassmorphism modal (cosmic dark theme, golden accents)
6. User fills in card details → clicks "Complete Donation" → `stripe.confirmPayment()` runs
7. **Step 3 — Success**: Golden radial burst + checkmark animation + "Thank You" message
8. User clicks "Continue Exploring" → modal closes, 3D scene continues

The 3D scene renders behind the modal throughout — no page redirects.

## What was changed (latest session)

### New files
| File | What it does |
|------|-------------|
| `src/hooks/usePaymentIntent.ts` | Calls `POST /create-payment-intent`, returns `clientSecret` for the embedded Payment Element |

### Modified files
| File | What changed |
|------|-------------|
| `src/components/DonationModal.tsx` | Full rewrite → three-step flow (amount → payment → success) with embedded `<PaymentElement>`, Stripe `appearance` config matching cosmic theme, inline error handling, golden burst success animation |
| `src/index.css` | Added ~190 lines: payment form layout, back button, amount banner, Stripe element wrapper, error styling, spinner, success screen with radial burst + checkmark pop animations |
| `infra/cloudformation.yml` | Lambda: added path-based routing + `/create-payment-intent` handler. API Gateway: added `PaymentIntentApiRoute` |
| `.env.production` | Added `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_REPLACE_ME` |
| `.env` | Set `VITE_API_ENDPOINT=/api` to use Vite proxy locally |
| `vite.config.ts` | Configured proxy for `/api` to point to live API Gateway to solve CORS without modifying backend |
| `package.json` | Added `@stripe/stripe-js` and `@stripe/react-stripe-js` |

### Unchanged
| File | Why |
|------|-----|
| `src/App.tsx` | `DonationModal` keeps the same `isOpen`/`onClose` interface — no changes needed |
| `src/hooks/useStripeCheckout.ts` | Kept as fallback, no longer imported by modal |

## Next task: Deploy and go live

**The code is complete and builds cleanly. Before it goes live, you need to:**

1. **Set your Stripe publishable key** — edit `.env.production` and replace `pk_live_REPLACE_ME` with your actual key (starts with `pk_live_` or `pk_test_`)
2. **Deploy the CloudFormation stack** to add the new `/create-payment-intent` API Gateway route:
   ```bash
   aws cloudformation deploy \
     --template-file infra/cloudformation.yml \
     --stack-name aweborn-website \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides \
         HostedZoneId=Z077908710IGH7R1XO587 \
         StripeSecretKey="<YOUR_KEY>"
   ```
3. **Build and deploy frontend** — push to `main` triggers CI/CD, or manually:
   ```bash
   npm run build
   aws s3 sync dist/ s3://aweborn-website-content --delete
   aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/*"
   ```
4. **Test end-to-end** — use Stripe test card `4242 4242 4242 4242` to verify the embedded flow works, then switch to live key

## Completed items

- ✅ 3D cosmic scene (starfield, clouds, islands, portal)
- ✅ Design system & glassmorphism UI
- ✅ Embedded Stripe Payment Element (no redirects)
- ✅ Three-step donation modal (amount → payment → success animation)
- ✅ Cosmic-themed Stripe appearance (dark background, golden accents, Outfit/Inter fonts)
- ✅ `usePaymentIntent` hook + Lambda `/create-payment-intent` route
- ✅ AWS infrastructure (S3, CloudFront, ACM, Route53, API GW, Lambda)
- ✅ CI/CD pipeline (GitHub Actions + OIDC)
- ✅ Live Stripe secret key loaded into Lambda
- ✅ Proactive WebGL detection + 2D fallback with browser-specific instructions
- ✅ Set `VITE_STRIPE_PUBLISHABLE_KEY` in `.env.production`
- ✅ Deploy updated CloudFormation stack
- ✅ Deploy updated frontend build
- ⬜ End-to-end test with Stripe test card

## Useful commands

```bash
# Dev server
npm run dev

# Build
npm run build

# Deploy infra (update stack)
aws cloudformation deploy \
  --template-file infra/cloudformation.yml \
  --stack-name aweborn-website \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      HostedZoneId=Z077908710IGH7R1XO587 \
      StripeSecretKey="<YOUR_KEY>"
```

## Future Roadmap: Multiplayer & Mesh Networking (Brainstorm)

In our latest session, we brainstormed transitioning Aweborn from a solitary cosmic experience into a massively multiplayer, mesh-networked universe built right into the browser. 

### Architecture Concepts: The Hybrid P2P / Client-Server Model

- **Server-Authoritative CRDTs (Lambda + DynamoDB):** The universe is persistent and authoritative. "Sector Servers" act as the source of truth for the CRDT state, handling collision resolution and anti-cheat. These servers will run as **AWS Lambdas** (triggered via API Gateway WebSockets, HTTP requests, or EventBridge timers for background settlement), with the Yjs CRDT state saved to **DynamoDB** for fast, scalable persistence.
- **Dual-Mode Transport (Seamless Offline/Online):** Yjs is transport-agnostic, allowing the client to use two channels simultaneously:
  1. **Online (Client-Server):** `y-websocket` connects to the Lambda backend to sync with the authoritative DynamoDB state.
  2. **Offline/Local (P2P Mesh):** `y-webrtc` syncs with local peers on the same LAN/hotspot, or via QR-code signaled data channels.
  This allows players to build offline together in a mesh. Upon reconnecting, the client syncs all local edits to the Lambda. The server validates structural changes, resolves collisions against the live universe, and writes the canonical positions back down to the clients.
- **Spatial Sectoring:** To prevent browser overload, the universe is chunked into sectors. Players only subscribe to Sector Servers for the area they are currently traversing.
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

### Gamifying the Mission

See **Mana — Universal Energy** section below. The mana mechanic replaces the original donation-for-cosmetics idea with something deeper: donations power a shared universal energy pool that fuels *all* creation. Cosmetics, world creation, physics changes, sound design — everything draws from the same communal well.

### The Two-Layer CRDT Architecture & Persistence

The system uses two nested CRDT layers, backed by durable storage (DynamoDB):

**Layer 1 — Universe CRDT (Sector Servers):** A shared Yjs Y.Map that holds the "star map" metadata, spatially chunked into sectors. Each entry represents one world. The Sector Server runs in AWS Lambda and persists authoritative snapshots to DynamoDB.

```js
// Universe CRDT entry (~80 bytes)
{
  id: "k7x9m",
  name: "Coral Reef",
  creator: "player-abc",
  intendedPosition: { x: 1420, y: -380, z: 9100 },  // Written by client (immutable)
  resolvedPosition: { x: 1435, y: -380, z: 9115 },   // Written ONLY by Sector Server
  resolvedAt: 1723848500,                            // Server resolution timestamp
  color: "#ff7b54",
  playerCount: 3,         // Ephemeral presence count
  lastActive: 1723848000
}
```

**Layer 2 — World CRDTs (World Servers):** Each world is its own Yjs Y.Doc containing the full 3D scene data. These are only loaded into memory (on a World Server) when players are inside, and flushed back to cold storage (DynamoDB) when dormant. Players only subscribe to the Universe CRDT while in the star map view.

**Yjs Conflict Resolution (No Clock Sync Needed):** Yjs does NOT use wall-clock time. Each client has a `clientID` (random number, assigned per session) and a `clock` (monotonic counter, starts at 0). When two clients write to the same key concurrently, the client with the higher `clientID` wins — deterministic, requires zero clock synchronization. The `clock` counter is only used for causal ordering within a single client.

#### World CRDT Internal Structure

Each world's Y.Doc contains nested maps for metadata, physics parameters, placed objects, terrain modifications, and chat:

```
Y.Doc (one per world)
├── Y.Map("meta")
│   ├── name: "Coral Reef"              (last-writer-wins)
│   ├── creator: "player-abc"           (immutable)
│   ├── createdAt: 1723848000           (immutable)
│   └── color: "#ff7b54"               (last-writer-wins)
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

### Universe Visual Design

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
- **Server validation (rubberbanding):** The Lambda backend validates player positions at a lower frequency (every 0.5-2 seconds). If a position is physically impossible (teleport, speed hack), the server sends a correction — the client's avatar snaps back to the last valid position.
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

Worlds are positioned roughly where the player stands ("plant where you stand"), written to the CRDT as `intendedPosition`. However, the **Authoritative Server (Lambda)** is responsible for ensuring worlds do not overlap:

1. **Client writes `intendedPosition`** to the CRDT (locally or synced to peers).
2. **Client renders temporarily** at this position with a "settling" visual cue (e.g., pulsing or shimmer).
3. **Lambda Resolver triggers** (via world-creation request or periodic timer).
4. **Lambda runs a deterministic spatial resolver**: Sorting worlds by timestamp, placing them, and nudging overlapping worlds outward along a deterministic vector until minimum distances are met.
5. **Lambda writes `resolvedPosition`** back to the canonical CRDT in DynamoDB.
6. **Client receives update** (via WebSocket) and the world smoothly animates ("gravitational settling") to its final canonical orbit.

#### Event-Sourced Physics (Interactive Objects)

For interactive physics objects (balls, crates, anything a player can push/kick), simulation runs locally on each client but is **event-sourced through the CRDT**:

1. **At rest:** Object stored in CRDT with position and `state: "resting"`. No simulation needed.
2. **Player kicks it:** Client writes the **velocity vector** at the moment of the kick to the CRDT (`state: "active"`, `velX/Y/Z`, `activatedBy`). Every client reads the same initial conditions and simulates the same trajectory independently.
3. **Object settles or collides:** The activating client writes the final resting position back to the CRDT (`state: "resting"`, updated `x/y/z`). All clients snap to this canonical position.
4. **Chain reactions:** If the object hits another physics object, new initial conditions are written for that object too.

This is bandwidth-efficient (2 CRDT writes per physics event, not 60/sec), visually consistent (same initial conditions → nearly identical trajectories), and offline-safe (events replay on reconnect). The Lambda can validate kick velocities for anti-cheat.

#### Offline Visual Treatment

When a player loses connection, the universe map freezes at the last synced state:

| World type | Visual | Interaction |
|-----------|--------|-------------|
| **Worlds you've visited before** | Normal rendering but with a subtle frost/ice shader, reduced glow | Can enter and explore the cached snapshot solo |
| **Worlds you've never visited** | Dim, desaturated silhouettes | Tapping shows "Come back online to explore" |
| **Your own worlds** | Fully bright and interactive | Can keep building offline. Changes stored as CRDT diffs, auto-merge on reconnect |

The reconnect moment: Yjs automatically syncs all offline edits. If someone else edited the same world while you were away, the CRDT resolves it — no conflicts, no overwrites. Both sets of changes just appear.

### Navigation / Movement — The Split Cockpit

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

#### Navigation Sub-Questions (Still Open)

- **Mod slot categories:** Are trail/aura/shape/emote the right 4? What about sound, speed class, gravity resistance?
- **Mod unlocking:** Unlocked through donations? Found by exploring? Always available?
- **Sound design:** Should each key press have subtle tonal feedback? Flying becomes musical?
- **Onboarding:** Interactive tutorial? Ghost hands? Or drop-in and let curiosity drive discovery?
- **Slingshot chaining:** Should skilled players get visible speed bonuses for chaining gravity assists?

### Mana — Universal Energy

Mana is the creative energy of the universe. Every act of creation — a new world, a placed object, a sound, a costume, a physics rule — draws mana from a single, shared, universal pool. No player owns mana. No player accumulates mana. Everyone draws from the same well.

**Donations refill the well** — but they're not the primary source. **Awe is.** The universe generates mana when players experience wonder: visiting a world for the first time, discovering a new creation, reaching uncharted space. The more novel the experience, the more mana flows. Donations provide powerful bursts that benefit everyone, and donors gain a personal flow rate bonus as a reward — but the universe fundamentally runs on curiosity and wonder.

#### The Universal Mana Pool

A single shared number in the Universe CRDT. All players always draw directly from this pool — there are no per-world sub-pools.

```js
// Universe CRDT — top level
Y.Map("universe") {
  mana: {
    pool: 1_000_000,              // Current available mana (shared by ALL)
    totalEverGenerated: 5_000_000, // Lifetime (donations + awe + regen)
    totalEverSpent: 4_000_000,     // Lifetime consumed by creation
    regenRate: 100,                // Mana regenerated per hour (baseline — intentionally low without donations)
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
| **Donations** | **BURST** | $1 USD = 1,000 mana added to the pool. Instant, powerful, benefits everyone. | Instant burst |
| **Natural Regeneration** | **BASELINE** | Universe slowly regenerates mana — intentionally low without donations. The universe *depends* on generosity to thrive. | ~100/hr baseline (intentionally dependent) |
| **Donation Afterglow** | **BOOST** | For 24hr after any donation, regen rate is boosted — the universe is "energized" | 2x-5x multiplier, decaying |
| **Solar Tidal Cycle** | **RHYTHM** | Mana flow follows the player's local sunrise/sunset. High flow during daylight, low flow at night. Quietly nudges healthy real-world sleep/activity cycles — the game doesn't want you lost in it at 3am. | ±50% flow modifier |

**No recycling.** Mana spent on creation is gone forever. There is no way to destroy a world or harvest its mana back. Every creation is permanent — a museum of what was made. This makes every act of creation feel weighty and meaningful.

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

#### Mana Costs — Everything Is Creation

**World Creation:**

| Action | Mana Cost | Permanence |
|--------|----------|-----------|
| Create a new world | 5,000 | **Forever** — worlds are permanent monuments |
| Name a world | Free | Expression is never gated |
| Set world color | 100 | Permanent |
| Expand world boundaries | 1,000 per tier | Permanent |

**Objects & Building (Inside a World):**

| Action | Mana Cost | Notes |
|--------|----------|-------|
| Place a basic object (cube, sphere, ramp) | 10-50 | Can be removed under reasonable circumstances (see below) |
| Place a complex object (tree, structure, vehicle) | 100-500 | Same |
| Custom sculpt (freeform 3D) | 50-200 per edit | Same |
| Import/paste from another world | 50% of original cost | Same |
| Remove an object | Free | **No mana returned** — energy is spent, not recycled |
| Move/rearrange an object | Free | Repositioning doesn't cost mana |

**Object removal policy:** Objects can be removed under reasonable circumstances (by the world creator, or by the player who placed them, or through a future permissions/governance system — see Physics Permissions open question). Removal is free but **does not return mana** to the pool. The energy was used to create; removing the creation doesn't un-spend the energy. This prevents mana farming through build/destroy cycles.

**Physics & Rules:**

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

**Sound & Music:**

| Action | Mana Cost |
|--------|----------|
| Place an ambient sound source | 100 |
| Compose a music loop (in-world sequencer) | 200-500 |
| Record a voice message (embedded in world) | 50 |
| Change world ambient soundtrack | 300 |

**Gameplay & System Mods:**

| Action | Mana Cost |
|--------|----------|
| Custom keyboard remapping (for your world) | 500 |
| Create a gameplay rule (win condition, scoring) | 1,000 |
| Set an entry cost (visitors spend mana to enter) | Requires 2,000+ mana in world |

#### Draw Mechanics — Fairness + Donor Empowerment

Each player has a **flow rate** — the maximum speed at which they can draw mana from the universal pool. The base pipe is the same diameter for everyone. But **donors get a wider pipe** — with exponentially diminishing returns that converge at a cap.

```
flowRate = (baseRate + donorBonus) * activityMultiplier * solarModifier * diminishingReturns

where:
  baseRate           = 100 mana/minute (same for every player, always)
  donorBonus         = bonusCap * (1 - e^(-k * lifetimeDonations))  // asymptotic curve
  activityMultiplier = 1.0-2.0 (exploring/awe earns faster draw)
  solarModifier      = 0.6-1.5 (based on local sun position)
  diminishingReturns = decreases as you draw more in a 24hr window
```

##### The Donor Flow Bonus

Donating doesn't just refill the universal pool — it also **permanently increases your personal flow rate**, with exponentially diminishing returns converging at a cap. The first $5 feels like a meaningful upgrade. Subsequent donations still help, but each one adds less personal benefit. Eventually you hit a ceiling — "ultimate" flow — beyond which more donations only help the universe (which is the point).

```
Donor Bonus = bonusCap × (1 - e^(-k × lifetimeDonations))

bonusCap = 150 mana/minute (2.5x the base rate of 100 — the "ultimate" ceiling)
k        = 0.00005 (controls how fast you approach the cap)
```

| Lifetime Donations | Donor Bonus | Total Flow Rate | Feels Like |
|-------------------|-------------|----------------|------------|
| $0 | +0 | 100/min | The default — fully functional, never punished |
| $5 | +37 | 137/min | "Oh, that's noticeably faster" — first donation is powerful |
| $10 | +69 | 169/min | Approaching 1.7x — creation feels fluid |
| $25 | +113 | 213/min | Over 2x — you're a confident creator |
| $50 | +137 | 237/min | Nearing the cap — you feel "ultimate" |
| $100 | +148 | 248/min | Almost at max — diminishing returns are real |
| $500 | +150 | 250/min | The cap — "ultimate creator" flow rate |
| $1,000+ | +150 | 250/min | Same cap — every dollar beyond this is pure generosity |

The design intent: **donating should feel empowering** — like the universe is thanking you by making creation feel more fluid and responsive. But no amount of money can make you *infinitely* more powerful than a free player. A $0 player at 100/min can build everything a $500 player can — just at 40% the speed. The gap is noticeable but never gatekeeping.

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

**The Donation Moment:** When someone donates while players are online, a **wave of golden energy ripples outward from the Aweborn Portal** at the center of the universe. Stars brighten in a radial wave. Colors saturate, particles burst. Every player sees and feels it simultaneously. "The universe grows stronger." Donor recognition is **optional and configurable** — the donor can choose to be named ("A wave of energy from ★ Alex") or stay anonymous ("A wave of energy from ★ a generous soul").

#### The Donation → Mana Pipeline

```
Player donates $10 via Stripe
  → Lambda receives webhook (payment_intent.succeeded)
  → Lambda calculates: $10 × 1,000 = 10,000 mana
  → Lambda atomically adds to universe.mana.pool
  → Lambda updates donor's lifetimeDonations (for flow rate bonus)
  → Lambda writes donation event to manaLedger
  → Lambda sets donationMultiplier boost (24hr afterglow)
  → Universe CRDT update propagates to all connected clients
  → ALL PLAYERS SEE: Golden energy wave from Aweborn Portal
  → DONOR SEES: Personal flow rate increase confirmation
```

| Donation | Mana Added | Rough Impact |
|----------|-----------|-------------|
| $5 | 5,000 | ~1 new world for anyone + donor's first flow boost |
| $10 | 10,000 | ~2 worlds or heavy building + donor feels noticeably faster |
| $25 | 25,000 | Building spree across many worlds + donor at ~2x flow |
| $50 | 50,000 | Universe noticeably brighter for hours + donor near "ultimate" |
| $100 | 100,000 | Major burst — communities benefit for days |
| $500 | 500,000 | "Golden age" — everything glows. Donor hits flow cap |

#### Server Authority for Mana

Mana is one of the few things that **must be server-authoritative** (Lambda validates all draws):

1. Client requests a draw: "I want to create a world (5,000 mana)"
2. Lambda checks: pool sufficient? Flow rate within limits (including donor bonus and solar modifier)? Action legitimate?
3. Lambda deducts atomically, writes transaction to ledger CRDT
4. Lambda confirms → client proceeds with creation
5. If denied → client sees "The universe needs more energy" (gentle, not punitive)

Prevents mana hacking, double-spending, and flow rate bypass. Donor flow rate bonus is stored server-side (tied to verified Stripe payment history), so it can't be spoofed.

#### Offline Mana

Players can create offline using **locally cached mana** (a small buffer drawn while last online). On reconnect, Lambda validates offline creations against the cached budget. Small offline edits always work. Large offline projects may need to sync-and-resolve if the pool was drained by others.

#### Emergent Behaviors

- **"The Universe Is Dimming"** — When mana gets low, players experience it visually. Communities rally to donate or wait for regen. The urgency is communal.
- **The Golden Wave** — The defining moment of Aweborn. Someone donates, everyone feels it.
- **Exploration as the Engine** — Awe is the primary mana source. Free-to-play players who explore actively generate more mana for the universe than passive players. Curiosity literally powers creation.
- **Shared Wonder** — Experiencing awe near other players generates 2x mana. The universe rewards togetherness. Social exploration is the most efficient way to generate energy.
- **World Creation as Stewardship** — Creating a world costs 5,000 mana from the shared pool, and that mana is gone forever. You're spending everyone's energy on something permanent. Make it count.
- **The Museum of Everything** — Worlds persist forever. No decay, no recycling, no harvesting. The universe is an ever-growing museum of everything anyone ever made. Walk far enough and you'll find worlds from the very first day.
- **No Grinding** — Nothing to farm, hoard, or trade. Mana comes from wonder and generosity, not repetitive action.
- **Healthy Rhythms** — Solar tidal cycles nudge players toward real-world daylight activity. The game doesn't want you at 3am — the universe dims to match.

#### Mana Sub-Questions (Still Open)

- **Mana-to-dollar ratio:** $1 = 1,000 mana is the current proposal. Should it be higher to make small donations feel more impactful?
- **Awe event values:** Are the proposed awe generation numbers (500 for first world visit, 50 for seeing a creation, etc.) in the right ballpark?
- **Donor bonus curve tuning:** The asymptotic curve (`bonusCap = 150, k = 0.00005`) needs playtesting. Should the first donation feel even more powerful?
- **Object removal governance:** Who can remove objects from a world? Just the creator? The placer? A vote? (Overlaps with Physics Permissions question)

### Open Design Questions

- **⬜ World Interiors:** What can players actually do inside a world? (place objects, sculpt, draw, just hang out?)
- **⬜ Universe Entry Point:** What does a brand-new player see when they first open aweborn.org? How do they orient?
- **⬜ Physics Permissions:** Who can change a world's physics parameters? Who can remove objects? Only the creator? Anyone inside? A vote/consensus system?
- **⬜ Mana Tuning:** Finalize dollar-to-mana ratio, awe event values, donor bonus curve, solar cycle parameters

