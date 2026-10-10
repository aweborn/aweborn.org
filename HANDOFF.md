# Aweborn.org — Handoff

## Table of Contents

<!-- toc -->

- [Project overview](#project-overview)
- [Architecture](#architecture)
- [Key files](#key-files)
- [Donation flow](#donation-flow)
- [Deployment instructions](#deployment-instructions)
- [Useful commands](#useful-commands)
- [Future Roadmap](#future-roadmap)

<!-- tocstop -->

## Project overview

An immersive, multiplayer 3D cosmic universe for Aweborn, a non-profit. Players fly through space as glowing stars (React Three Fiber), see each other in real time, create and enter worlds synced via CRDTs, and donate via Stripe. Deployed live at `https://aweborn.org`. Phases 01–04 are complete; see [phases/README.md](./phases/README.md) for current status.

## Architecture

```text
User → CloudFront (CDN) → S3 (static Vite/React app)
     → sync.aweborn.org → Lightsail VPS (k3s) → Caddy → sync-service (WSS CRDT sync)
     → api.aweborn.org  → Lightsail VPS (k3s) → Caddy → genai-service (HTTPS REST)
                        ↘ API Gateway → Lambda → Stripe API (webhooks only)
     → Tailnet          → Lightsail VPS (k3s) → agent-runner (cron LLM agents, HTTP API)
```

- **Frontend**: Vite + React 19 + TypeScript + React Three Fiber (Three.js r185) + Stripe Elements
- **Backend**: Single Lambda function (Node.js 20, inline in CloudFormation) that proxies to Stripe
- **Infra (static)**: `infra/cloudformation.yml` — S3, CloudFront, ACM cert, Route53, API Gateway, Lambda
- **Infra (VPS)**: `infra/cloudformation-vps.yml` — Lightsail instance, static IP, Route53 DNS, k3s bootstrap
- **CI/CD**: `.github/workflows/deploy.yml` — auto-deploys frontend on push to `main` via OIDC auth
- **Domain**: `aweborn.org` + `www.aweborn.org`, Hosted Zone ID `Z077908710IGH7R1XO587`
- **VPS**: `sync.aweborn.org` + `api.aweborn.org` → Lightsail (Ubuntu 22.04 + k3s + Caddy auto-TLS)
- **Tailscale**: VPS joined as `aweborn-vps` on Tailnet (100.118.138.70) — agent-runner accessible via Tailnet only

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
| `src/hooks/useCRDT.ts` | Hook — connects to sync-service using the custom binary room protocol (msgs `0x01`–`0x09`); returns `{ connected, send, createWorld, updateSectors, joinWorld, leaveWorld }` |
| `src/hooks/usePresence.ts` | Player presence: BroadcastChannel (same browser) + WebSocket relay (cross-browser); `playerId` in sessionStorage |
| `src/stores/universeStore.ts` / `worldStore.ts` | Stores backed by the Universe CRDT / active World CRDT |
| `src/systems/` | InputManager, FlightController, CameraController, GravitySystem, WarpSystem, Touch/Gamepad adapters, StarModSlots |
| `src/components/UniverseWorlds.tsx` | LOD world rendering + Aweborn Portal |
| `src/components/RadarMinimap.tsx` / `PortalBeacon.tsx` | 3D radar, home indicator |
| `src/components/CRDTDevOverlay.tsx` | Dev panel / temporary world index (shown in production until the Worlidex, Phase 08) |
| `shared/crdt-schema.ts` | Shared CRDT types + spatial helpers (client + server) |
| `server/sync-service/src/rooms.ts` | Room manager: sector rooms, world rooms, world creation, spatial resolver, presence relay |
| `src/index.css` | Full design system — tokens, glass effects, animations, payment form styles, success animation |
| `server/sync-service/src/index.ts` | WebSocket + Yjs CRDT sync server |
| `server/genai-service/src/index.ts` | Gen AI API proxy (placeholder, all routes return 501) |
| `server/agent-runner/src/index.ts` | Cron-scheduled LLM agent runner with HTTP API (port 3002, Tailnet-only) |
| `server/docker-compose.yml` | Local dev: runs all three services with hot-reload |
| `infra/k3s/` | Kubernetes manifests for k3s deployment (namespace, deployments, Caddy ingress, secrets) |
| `infra/k3s/deploy.sh` | Build → push → apply deployment script |
| `.env.production` | `VITE_API_ENDPOINT`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_SYNC_URL` |
| `infra/cloudformation.yml` | Static site AWS stack (S3, CloudFront, ACM, Route53, API GW, Lambda) |
| `infra/cloudformation-vps.yml` | VPS AWS stack (Lightsail instance, static IP, Route53 DNS, k3s+Docker bootstrap) |

## Donation flow

1. User clicks the glowing 3D portal → `DonationModal` opens as 2D overlay
2. **Step 1 — Amount**: User picks a preset ($10–$500) or enters a custom amount → clicks "Continue"
3. `usePaymentIntent` hook calls `POST /create-payment-intent` on API Gateway (proxied via Vite during development)
4. Lambda creates a Stripe PaymentIntent and returns `{ clientSecret }`
5. **Step 2 — Payment**: Stripe `<PaymentElement>` renders inline inside the glassmorphism modal (cosmic dark theme, golden accents)
6. User fills in card details → clicks "Complete Donation" → `stripe.confirmPayment()` runs
7. **Step 3 — Success**: Golden radial burst + checkmark animation + "Thank You" message
8. User clicks "Continue Exploring" → modal closes, 3D scene continues

The 3D scene renders behind the modal throughout — no page redirects.

## Deployment instructions

1. **Set your Stripe publishable key** — edit `.env.production` and ensure the live key is present (starts with `pk_live_`).
2. **Deploy the CloudFormation stack**:
   ```bash
   aws cloudformation deploy \
     --template-file infra/cloudformation.yml \
     --stack-name aweborn-website \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides \
         HostedZoneId=Z077908710IGH7R1XO587 \
         StripeSecretKey="<YOUR_KEY>"
   ```
3. **Build and deploy frontend** (Pushing to `main` triggers CI/CD, or you can do it manually):
   ```bash
   npm run build
    aws s3 sync dist/ s3://aweborn-website-content --delete
    aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/*"
    ```
4. **Deploy the VPS stack** (one-time, or to recreate):
    ```bash
    aws cloudformation create-stack \
      --stack-name aweborn-vps \
      --template-body file://infra/cloudformation-vps.yml \
      --parameters \
        ParameterKey=HostedZoneId,ParameterValue=Z077908710IGH7R1XO587
    ```
    The UserData script automatically installs k3s + Docker, builds images from `main`, and deploys all K8s manifests.

## Local dev (server services)

```bash
# Start sync-service + genai-service with hot-reload
cd server && docker compose up

# Or without Docker (requires npm install in each service dir):
cd server/sync-service && npm run dev
cd server/genai-service && npm run dev
```

The Vite frontend connects to `ws://localhost:1234` (sync-service) in dev mode via the `VITE_SYNC_URL` env var.

## Useful commands

```bash
# Dev server (frontend)
npm run dev

# Build frontend
npm run build

# Deploy static site infra (update stack)
aws cloudformation deploy \
  --template-file infra/cloudformation.yml \
  --stack-name aweborn-website \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      HostedZoneId=Z077908710IGH7R1XO587 \
      StripeSecretKey="<YOUR_KEY>"
```

## VPS management

```bash
# SSH into VPS — Tailnet only (public port 22 closed 2026-10-03)
ssh -i ~/.ssh/lightsail-default.pem ubuntu@aweborn-vps
# Break-glass if Tailscale is down: Lightsail console → aweborn-vps → "Connect using SSH"
# (browser SSH is the only public source allowed on port 22, via the lightsail-connect alias)
# Tailscale key expiry is disabled for aweborn-vps (verified 2026-10-03) — keep it that way, or the VPS drops off the Tailnet
# Drift: the SSH rule was applied with `aws lightsail put-instance-public-ports`, and the deployed
# stack template predates the Sep 26 UserData additions (Tailscale, agent-runner). The repo template is
# the source of truth — never update the stack from an older copy (it would reopen port 22).

# Check pod status
sudo k3s kubectl -n aweborn get pods

# View service logs
sudo k3s kubectl -n aweborn logs deployment/sync-service
sudo k3s kubectl -n aweborn logs deployment/genai-service
sudo k3s kubectl -n aweborn logs deployment/agent-runner
sudo k3s kubectl -n aweborn logs daemonset/caddy

# Agent runner API (via Tailnet)
curl http://aweborn-vps:3002/health
curl http://aweborn-vps:3002/agents

# Update services after code changes (on VPS)
# NOTE: CI only deploys the FRONTEND. Server changes must be deployed by hand,
# or the live site runs new client code against an old server (this happened:
# sync-service was stuck on the Phase 01 build until 2026-10-10).
cd /home/ubuntu/aweborn && git pull
./infra/k3s/deploy.sh --vps --apply

# Deploy ONLY sync-service (builds from repo root; brief downtime, Recreate strategy)
cd /home/ubuntu/aweborn && git pull --ff-only
sudo docker build -f server/sync-service/Dockerfile -t ghcr.io/aweborn/sync-service:latest .
sudo docker save ghcr.io/aweborn/sync-service:latest | sudo k3s ctr images import -
sudo k3s kubectl apply -f infra/k3s/sync-service-deployment.yaml
sudo k3s kubectl -n aweborn rollout restart deployment/sync-service

# World data (SQLite) lives on the host, outside k8s: /var/lib/aweborn/sync-data/universe.db
# Back it up before migrations:  sudo sqlite3 ... or copy while the pod is scaled to 0

# Check bootstrap log (first boot only)
sudo cat /var/log/aweborn-bootstrap.log
```

## Future Roadmap

The roadmap for multiplayer/mesh networking has been moved to [ROADMAP.md](ROADMAP.md).

For the actionable, phased implementation plan (with session protocol for picking up where you left off), see [phases/README.md](./phases/README.md).
