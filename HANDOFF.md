# Aweborn.org — Handoff

## Project overview

An immersive 3D donation experience for Aweborn, a non-profit. Users explore a cosmic scene (React Three Fiber) and donate via Stripe. Deployed live at `https://aweborn.org`.

## Architecture

```
User → CloudFront (CDN) → S3 (static Vite/React app)
                        ↘ API Gateway → Lambda → Stripe API
```

- **Frontend**: Vite + React 19 + TypeScript + React Three Fiber (Three.js r185)
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
| `src/components/DonationModal.tsx` | 2D modal overlay — preset amounts ($10–$500), custom input, donate button |
| `src/components/HUD.tsx` | Heads-up display — brand mark, donate prompt |
| `src/components/LoadingScreen.tsx` | Animated loading screen with progress bar |
| `src/components/FallbackScene.tsx` | 2D fallback for no-WebGL — includes browser-specific fix instructions |
| `src/components/CanvasErrorBoundary.tsx` | React error boundary for R3F Canvas crashes |
| `src/hooks/useStripeCheckout.ts` | Hook — calls API Gateway to create a Stripe Checkout Session, then redirects |
| `src/index.css` | Full design system — tokens, glass effects, animations, responsive |
| `.env.production` | `VITE_API_ENDPOINT=https://1cyz3xulg5.execute-api.us-east-1.amazonaws.com` |
| `infra/cloudformation.yml` | Complete AWS stack (S3, CloudFront, ACM, Route53, API GW, Lambda) |

## Current donation flow (what to change)

1. User clicks the glowing 3D portal → `DonationModal` opens as 2D overlay
2. User picks an amount → clicks "Donate"
3. `useStripeCheckout` hook calls `POST /create-checkout-session` on API Gateway
4. Lambda creates a Stripe Checkout Session and returns a URL
5. **User is redirected away to Stripe's hosted checkout page** ← this is what we want to replace
6. After payment, Stripe redirects back to `aweborn.org?donation=success`

## Next task: Embed Stripe payment inside the experience

**Goal**: Replace the Stripe Checkout redirect with embedded Stripe Elements (Payment Element) so users complete payment without leaving the 3D scene.

### What needs to happen

**Frontend:**
- Install `@stripe/stripe-js` and `@stripe/react-stripe-js`
- Add your Stripe **publishable key** as `VITE_STRIPE_PUBLISHABLE_KEY` in `.env.production`
- Rewrite `DonationModal.tsx` to have two steps:
  - **Step 1** (existing): Pick amount (preset grid + custom input)
  - **Step 2** (new): Show Stripe's `<PaymentElement>` inside the modal, with a "Complete Donation" button that calls `stripe.confirmPayment()`
- Replace the `useStripeCheckout` hook with a new hook that creates a **PaymentIntent** (not a Checkout Session) and returns the `clientSecret` needed by Elements
- Show success/error states inline in the modal (no redirect)
- Keep the cosmic glassmorphism styling — Stripe Elements supports the `appearance` API for custom theming

**Backend (Lambda):**
- Add a new route `POST /create-payment-intent` that creates a Stripe PaymentIntent (instead of a Checkout Session) and returns `{ clientSecret }` to the frontend
- Keep the existing `/create-checkout-session` route as a fallback or remove it

**Infrastructure:**
- Add the new API Gateway route for `/create-payment-intent` in `cloudformation.yml`

### Design considerations
- The `<PaymentElement>` renders inside the existing glassmorphism modal, keeping the immersive feel
- Style it with Stripe's `appearance` API to match the dark cosmic theme (dark background, golden accents, `Outfit`/`Inter` fonts)
- The modal should show a success animation after payment completes (confetti, glow effect, or similar)
- The 3D scene continues rendering behind the modal throughout

## Completed items

- ✅ 3D cosmic scene (starfield, clouds, islands, portal)
- ✅ Design system & glassmorphism UI
- ✅ Stripe Checkout integration (redirect-based)
- ✅ AWS infrastructure (S3, CloudFront, ACM, Route53, API GW, Lambda)
- ✅ CI/CD pipeline (GitHub Actions + OIDC)
- ✅ Live Stripe secret key loaded into Lambda
- ✅ Proactive WebGL detection + 2D fallback with browser-specific instructions

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
