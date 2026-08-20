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
                        ↘ Lightsail VPS (Node.js) → WebSocket (real-time CRDT sync)
                        ↘ API Gateway → Lambda → Stripe API (webhooks only)
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
| `src/index.css` | Full design system — tokens, glass effects, animations, payment form styles, success animation |
| `.env.production` | `VITE_API_ENDPOINT` and `VITE_STRIPE_PUBLISHABLE_KEY` |
| `infra/cloudformation.yml` | Complete AWS stack (S3, CloudFront, ACM, Route53, API GW, Lambda) with both `/create-checkout-session` and `/create-payment-intent` routes |

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

## Future Roadmap

The roadmap for multiplayer/mesh networking has been moved to [ROADMAP.md](ROADMAP.md).

For the actionable, phased implementation plan (with session protocol for picking up where you left off), see [MASTER_PLAN.md](./docs/plans/MASTER_PLAN.md).
