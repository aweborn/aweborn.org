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
| VPS (k3s on Ubuntu + containers) | — | ❌ Not started |
| CRDT sync service | — | ❌ Not started |
| Gen AI service | — | ❌ Not started |
| Multiplayer | — | ❌ Not started |

## Target Architecture

```
User's Browser
  ├── CloudFront → S3 (static Vite/React app)
  ├── wss://sync.aweborn.org → Lightsail VPS (Ubuntu + k3s)
  │     ├── [caddy] reverse proxy + TLS
  │     ├── [sync-service] WebSocket, Yjs CRDT, spatial resolver, mana validation
  │     └── [genai-service] AI API proxy (Meshy, image, music, voice, text)
  └── API Gateway → Lambda → Stripe (donations)
```

## Phases

| # | Phase | Status | Depends On | Sessions Est. | Phase File |
|---|-------|--------|-----------|---------------|------------|
| 01 | Foundation & Infra (Lightsail + k3s) | `[x]` Complete | — | 2-3 | [→ 01-foundation.md](./phases/01-foundation.md) |
| 02 | Multiplayer Core (CRDT + WebSocket) | `[x]` Complete | Phase 01 | 4-6 | [→ 02-multiplayer-core.md](./phases/02-multiplayer-core.md) |
| 03 | Universe Rendering & LOD | `[ ]` Not Started | Phase 02 | 3-4 | [→ 03-universe-rendering.md](./phases/03-universe-rendering.md) |
| 04 | Navigation & Controls | `[ ]` Not Started | Phase 03 | 3-4 | [→ 04-navigation-controls.md](./phases/04-navigation-controls.md) |
| 05 | Mana Economy & Donations | `[ ]` Not Started | Phase 02, 04 | 4-5 | [→ 05-mana-economy.md](./phases/05-mana-economy.md) |
| 06 | Offline & Mesh Networking | `[ ]` Not Started | Phase 02 | 3-4 | [→ 06-offline-mesh.md](./phases/06-offline-mesh.md) |
| 07 | World Creation & Gen AI | `[ ]` Not Started | Phase 01, 05 | 5-7 | [→ 07-genai-creation.md](./phases/07-genai-creation.md) |

**Total estimated sessions: 25–34** (1 session ≈ 2-4 hours of agent-assisted work)

## Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| VPS OS | **Ubuntu 22.04 LTS + k3s** | Fast provisioning on Lightsail, lightweight K8s. Talos OS is a future migration target once infra is stable. |
| Container runtime | **Docker** via Kubernetes | Each service is independently deployable |
| CRDT library | **Yjs** | Transport-agnostic, battle-tested, supports awareness protocol, works offline |
| Real-time transport | **Native WebSockets** (sync-service container) | In-memory CRDT merge, near-zero cost |
| Gen AI backend | **genai-service** container (Node.js, proxies to external APIs) | Isolated from sync service, independently scalable |
| Mana cost model | **Pegged to real compute cost + ~7% margin** | Makes the economy self-sustaining; research API costs before finalizing formula |
| Creation model | **Online = AI prompt (costs mana/compute), Offline = edit/arrange (free)** | AI calls need network; editing is local-only |
| Offline transport | **WebRTC DataChannels (y-webrtc)** | Browser-native, no server needed for P2P |
| QR signaling | **QWBP** | Compresses SDP to 55-100 bytes |
| Rendering | **Three.js LOD + InstancedMesh** | Handles 100k+ worlds |

## File Map (Current)

```
aweborn.org/
├── src/
│   ├── App.tsx                    # Root — WebGL detection, routes
│   ├── main.tsx                   # Entry point
│   ├── index.css                  # Design system
│   ├── components/
│   │   ├── Scene.tsx              # R3F Canvas wrapper
│   │   ├── Environment.tsx        # Cosmic scene (starfield, clouds, islands)
│   │   ├── DonationPortal.tsx     # 3D glowing orb → donation trigger
│   │   ├── DonationModal.tsx      # Stripe payment flow
│   │   ├── HUD.tsx                # Heads-up display
│   │   ├── LoadingScreen.tsx      # Loading animation
│   │   ├── FallbackScene.tsx      # 2D fallback (no WebGL)
│   │   └── CanvasErrorBoundary.tsx
│   └── hooks/
│       └── usePaymentIntent.ts    # Stripe PaymentIntent hook
├── server/                        # ← NEW: Docker services
│   ├── sync-service/              # WebSocket + CRDT + mana
│   ├── genai-service/             # AI API proxy
│   └── docker-compose.yml         # Local dev orchestration
├── infra/
│   ├── cloudformation.yml         # AWS static infra
│   └── k3s/                       # ← NEW: k3s cluster K8s manifests
├── ROADMAP.md                     # Design bible (850 lines)
├── HANDOFF.md                     # Architecture snapshot
├── PLAN.md                        # This file
└── phases/                        # Phase execution files
    ├── 01-foundation.md
    ├── 02-multiplayer-core.md
    ├── 03-universe-rendering.md
    ├── 04-navigation-controls.md
    ├── 05-mana-economy.md
    ├── 06-offline-mesh.md
    └── 07-genai-creation.md       # ← NEW
```

## Absorbed from TokBot

The following TokBot features are now part of aweborn.org's world interior experience:

| TokBot Feature | aweborn.org Equivalent | Phase |
|----------------|----------------------|-------|
| Avatar creation (Meshy AI) | In-world character creation via AI prompt | Phase 07 |
| Content studio | World building tools (objects, terrain, effects) | Phase 07 |
| Token economy | Mana system (pegged to real compute cost) | Phase 05 |
| Social publishing | Not in scope (aweborn.org IS the social platform) | — |
| Firebase Auth | Not needed (anonymous + Stripe donor identity) | — |

Useful code to migrate from `tokbot-backend/functions/src/avatars/` (Meshy AI integration).
