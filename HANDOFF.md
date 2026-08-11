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
- ⬜ Set `VITE_STRIPE_PUBLISHABLE_KEY` in `.env.production`
- ⬜ Deploy updated CloudFormation stack
- ⬜ Deploy updated frontend build
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
