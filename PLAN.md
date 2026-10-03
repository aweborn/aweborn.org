# Aweborn.org — Implementation Plan

> **Parent:** [Master Plan](../PLAN.md) · **Design Bible:** [ROADMAP.md](./ROADMAP.md) · **Architecture:** [HANDOFF.md](./HANDOFF.md)

## What Is This

Aweborn.org is an immersive 3D cosmic universe in the browser. Users explore space as glowing orbs, create worlds, build inside them using generative AI, and donate to expand reality. The mana economy ties real compute costs to in-game creation, making donations directly fund the universe's creative infrastructure.

## Current Stack

| Layer | Technology | Status |
|-------|-----------|--------|
| Frontend | Vite + React 19 + TypeScript + R3F (Three.js r185) | ✅ Live |
| Donation UI | Stripe Elements (Payment Element, embedded) | ✅ Live |
| Backend (payments) | AWS Lambda (Node.js 20, inline CloudFormation) | ✅ Live |
| Infra (static) | CloudFormation (S3, CloudFront, ACM, Route53, API GW) | ✅ Live |
| CI/CD | GitHub Actions → OIDC → S3 sync + CloudFront invalidation | ✅ Live |
| VPS (Ubuntu 22.04 + k3s on Lightsail 2 GB, Caddy auto-TLS) | `infra/cloudformation-vps.yml`, `infra/k3s/` | ✅ Live (Phase 01) |
| CRDT sync service | Node.js + Yjs, room-aware binary protocol, SQLite persistence | ✅ Live at `sync.aweborn.org` (Phase 02) |
| Multiplayer | Universe/World CRDTs, sector rooms, presence relay over WebSocket | ✅ Live (Phases 02–04) |
| Universe rendering + flight | LOD worlds, Ghost shader, 6DOF flight, gravity wells, warp, radar | ✅ Live (Phases 03–04) |
| Gen AI service | Node.js placeholder (all routes 501) | 🟡 Placeholder at `api.aweborn.org` (Phase 07) |
| Agent runner | Node.js cron LLM agents, HTTP API | ✅ Live, Tailnet-only (Sep 26, 2026) |
| Mana economy | — | ❌ Not started (Phase 05) |
| Offline / PWA / P2P | — | ❌ Not started (Phase 06) |

## Architecture

```
User's Browser
  ├── CloudFront → S3 (static Vite/React app; 403/404 → index.html for SPA routes)
  ├── wss://sync.aweborn.org → Lightsail VPS (Ubuntu + k3s)
  │     ├── [caddy] reverse proxy + TLS (DaemonSet, hostPort)
  │     ├── [sync-service] WebSocket, Yjs CRDT, sector rooms, spatial resolver, presence relay (+ mana validation in Phase 05)
  │     └── [genai-service] AI API proxy (Meshy, image, music, voice, text) — placeholder until Phase 07
  ├── https://api.aweborn.org → same VPS → genai-service
  └── API Gateway → Lambda → Stripe (donations; live mode)

Tailnet (ops only)
  └── aweborn-vps:3002 → [agent-runner] cron-scheduled LLM agents
```

## Phases

| # | Phase | Status | Depends On | Sessions Est. | Phase File |
|---|-------|--------|-----------|---------------|------------|
| 01 | Foundation & Infra (Lightsail + k3s) | `[x]` Complete | — | 2-3 | [→ 01-foundation.md](./phases/01-foundation.md) |
| 02 | Multiplayer Core (CRDT + WebSocket) | `[x]` Complete | Phase 01 | 4-6 | [→ 02-multiplayer-core.md](./phases/02-multiplayer-core.md) |
| 03 | Universe Rendering & LOD | `[x]` Complete | Phase 02 | 3-4 | [→ 03-universe-rendering.md](./phases/03-universe-rendering.md) |
| 04 | Navigation & Controls | `[x]` Complete | Phase 03 | 3-4 | [→ 04-navigation-controls.md](./phases/04-navigation-controls.md) |
| 05 | Mana Economy & Donations | `[ ]` Not Started | Phase 02, 04 | 4-5 | [→ 05-mana-economy.md](./phases/05-mana-economy.md) |
| 06 | Offline & Mesh Networking | `[ ]` Not Started | Phase 02 | 3-4 | [→ 06-offline-mesh.md](./phases/06-offline-mesh.md) |
| 07 | World Creation & Gen AI | `[ ]` Not Started | Phase 01, 04, 05 (interior movement needs only 04) | 5-7 | [→ 07-genai-creation.md](./phases/07-genai-creation.md) |
| 08 | NFC Trading Cards & the Worlidex | `[ ]` Not Started | Phase 04 (8A/8B); 05 + 06 for later milestones | 7-10 | [→ 08-nfc-trading-cards.md](./phases/08-nfc-trading-cards.md) |

**Total estimated sessions: 32–44** (1 session ≈ 2-4 hours of agent-assisted work)

> **➡️ Next up: Phase 05 (Mana Economy).** Phase 08 milestones 8A/8B (teleport links, Worlidex) are also unblocked and can run in parallel.
>
> **Deferred verification debt** (carried from completed phases): stress tests in Phases 02/03 (10+ connections, 1000+ worlds @ 60fps) and on-device touch/gamepad verification in Phase 04.

## Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| VPS OS | **Ubuntu 22.04 LTS + k3s** | Fast provisioning on Lightsail, lightweight K8s. Talos OS is a future migration target once infra is stable. |
| Container runtime | **Docker** via Kubernetes | Each service is independently deployable |
| CRDT library | **Yjs** | Transport-agnostic, battle-tested, works offline. *(Awareness protocol available but unused — presence runs on custom relay messages.)* |
| Real-time transport | **Native WebSockets** (sync-service container, custom binary room protocol over Yjs) | In-memory CRDT merge, near-zero cost |
| Player presence (current) | **WebSocket relay through sync-service** (msg `0x09`) | Shipped Aug 24, 2026 for cross-browser presence. ROADMAP's WebRTC P2P ephemeral channel remains the target for scale (Phase 06) |
| Gen AI backend | **genai-service** container (Node.js, proxies to external APIs) | Isolated from sync service, independently scalable |
| Mana cost model | **Pegged to real compute cost + ~7% margin** | Makes the economy self-sustaining; research API costs before finalizing formula |
| Creation model | **Online = AI prompt (costs mana/compute), Offline = edit/arrange (free)** | AI calls need network; editing is local-only |
| Offline transport | **WebRTC DataChannels (y-webrtc)** | Browser-native, no server needed for P2P |
| QR signaling | **QWBP** | Compresses SDP to 55-100 bytes |
| Rendering | **Three.js LOD + InstancedMesh** | Handles 100k+ worlds |
| World IDs | **UUIDv4** (migrating from 5-char random) | Printed on NFC cards forever — must be unique + unguessable |
| World deep links | **`aweborn.org/w/<uuid>[?a=in]`** | NFC trading cards + share links; permanent public API |
| NFC cards | **NTAG213, NDEF URI, locked, no serials, no anti-clone** | Low-stakes collectible; cloning a card only clones a link |

## File Map (Current)

```
aweborn.org/
├── src/
│   ├── App.tsx                    # Root — WebGL detection, scene/fallback, HUD, donation modal, CRDT overlay
│   ├── main.tsx                   # Entry point
│   ├── index.css                  # Design system
│   ├── components/
│   │   ├── Scene.tsx              # R3F Canvas, flight pipeline, universe ↔ interior switching
│   │   ├── Environment.tsx        # Cosmic backdrop (starfield, clouds, nebula)
│   │   ├── UniverseWorlds.tsx     # LOD world suns + Aweborn Portal
│   │   ├── WorldInterior.tsx      # CRDT-driven world interior
│   │   ├── PlayerOrb.tsx          # Local player star (mods, trail, aura)
│   │   ├── PlayerStars.tsx        # Remote players
│   │   ├── RadarMinimap.tsx       # 3D-aware radar (bottom-left)
│   │   ├── PortalBeacon.tsx       # "Where is home" indicator
│   │   ├── GravityFieldLines.tsx / SlingshotArc.tsx / WarpEffect.tsx / WorldTransition.tsx
│   │   ├── CRDTDevOverlay.tsx     # Dev panel / temporary world index (in prod until Worlidex, Phase 08)
│   │   ├── DonationPortal.tsx / DonationModal.tsx   # Stripe donation flow
│   │   ├── HUD.tsx                # Keymap (lights on press), speed, lock/warp, FPS
│   │   └── LoadingScreen.tsx / FallbackScene.tsx / CanvasErrorBoundary.tsx
│   ├── systems/                   # InputManager, FlightController, CameraController/State,
│   │                              # GravitySystem, WarpSystem, Touch/GamepadInputAdapter, StarModSlots
│   ├── stores/                    # universeStore, worldStore (CRDT-backed)
│   ├── shaders/                   # worldGlow, ghostShader
│   └── hooks/                     # useCRDT (wire protocol), usePresence, usePaymentIntent, useStripeCheckout
├── shared/crdt-schema.ts          # Types + spatial helpers shared by client and server
├── server/
│   ├── sync-service/              # WebSocket + CRDT rooms + spatial resolver + presence relay
│   ├── genai-service/             # AI API proxy (placeholder)
│   ├── agent-runner/              # Cron LLM agents (Tailnet-only)
│   ├── data/                      # Local SQLite (universe.db)
│   └── docker-compose.yml         # Local dev orchestration
├── infra/
│   ├── cloudformation.yml         # AWS static infra (S3, CloudFront, API GW, Lambda)
│   ├── cloudformation-vps.yml     # Lightsail VPS + k3s bootstrap
│   └── k3s/                       # K8s manifests + deploy.sh
├── logo-concepts/ · scripts/export-logo.mjs   # Fibonacci three-sphere logo + icon exports (Sep 2026)
├── ROADMAP.md                     # Design bible
├── HANDOFF.md                     # Architecture snapshot
├── PLAN.md                        # This file
└── phases/                        # Phase execution files (README.md = phase index)
    ├── 01-foundation.md … 07-genai-creation.md
    └── 08-nfc-trading-cards.md    # NFC cards + Worlidex
```

## Absorbed from TokBot

The following TokBot features are now part of aweborn.org's world interior experience:

| TokBot Feature | aweborn.org Equivalent | Phase |
|----------------|----------------------|-------|
| Avatar creation (Meshy AI) | In-world character creation via AI prompt | Phase 07 |
| Content studio | World building tools (objects, terrain, effects) | Phase 07 |
| Token economy | Mana system (pegged to real compute cost) | Phase 05 |
| Social publishing | Not in scope (aweborn.org IS the social platform) | — |
| Firebase Auth | Not needed (anonymous + Stripe donor identity). Persistent anonymous identity is still required for the Worlidex — see Phase 08 | — |

Useful code to migrate from `tokbot-backend/functions/src/avatars/` (Meshy AI integration).
