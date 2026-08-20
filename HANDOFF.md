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

An immersive 3D donation experience for Aweborn, a non-profit. Users explore a cosmic scene (React Three Fiber) and donate via Stripe. Deployed live at `https://aweborn.org`.

## Architecture

```text
User → CloudFront (CDN) → S3 (static Vite/React app)
     → sync.aweborn.org → Lightsail VPS (k3s) → Caddy → sync-service (WSS CRDT sync)
     → api.aweborn.org  → Lightsail VPS (k3s) → Caddy → genai-service (HTTPS REST)
                        ↘ API Gateway → Lambda → Stripe API (webhooks only)
```

- **Frontend**: Vite + React 19 + TypeScript + React Three Fiber (Three.js r185) + Stripe Elements
- **Backend**: Single Lambda function (Node.js 20, inline in CloudFormation) that proxies to Stripe
- **Infra (static)**: `infra/cloudformation.yml` — S3, CloudFront, ACM cert, Route53, API Gateway, Lambda
- **Infra (VPS)**: `infra/cloudformation-vps.yml` — Lightsail instance, static IP, Route53 DNS, k3s bootstrap
- **CI/CD**: `.github/workflows/deploy.yml` — auto-deploys frontend on push to `main` via OIDC auth
- **Domain**: `aweborn.org` + `www.aweborn.org`, Hosted Zone ID `Z077908710IGH7R1XO587`
- **VPS**: `sync.aweborn.org` + `api.aweborn.org` → Lightsail (Ubuntu 22.04 + k3s + Caddy auto-TLS)

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
| `src/hooks/useCRDT.ts` | Hook — connects to sync-service via y-websocket, returns `{ doc, connected, synced }` |
| `src/index.css` | Full design system — tokens, glass effects, animations, payment form styles, success animation |
| `server/sync-service/src/index.ts` | WebSocket + Yjs CRDT sync server |
| `server/genai-service/src/index.ts` | Gen AI API proxy (placeholder, all routes return 501) |
| `server/docker-compose.yml` | Local dev: runs both services with hot-reload |
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
# SSH into VPS
ssh -i ~/.ssh/lightsail-default.pem ubuntu@$(aws cloudformation describe-stacks --stack-name aweborn-vps --query 'Stacks[0].Outputs[?OutputKey==`StaticIpAddress`].OutputValue' --output text)

# Check pod status
sudo k3s kubectl -n aweborn get pods

# View service logs
sudo k3s kubectl -n aweborn logs deployment/sync-service
sudo k3s kubectl -n aweborn logs deployment/genai-service
sudo k3s kubectl -n aweborn logs daemonset/caddy

# Update services after code changes (on VPS)
cd /home/ubuntu/aweborn && git pull
./infra/k3s/deploy.sh --vps --apply

# Check bootstrap log (first boot only)
sudo cat /var/log/aweborn-bootstrap.log
```

## Future Roadmap

The roadmap for multiplayer/mesh networking has been moved to [ROADMAP.md](ROADMAP.md).

For the actionable, phased implementation plan (with session protocol for picking up where you left off), see [phases/README.md](./phases/README.md).
