# Aweborn.org — Handoff

## Table of Contents

<!-- toc -->

- [Project overview](#project-overview)
- [Architecture](#architecture)
- [Key files](#key-files)
- [Teleport links](#teleport-links)
- [Donation flow](#donation-flow)
- [Deployment instructions](#deployment-instructions)
- [Local dev (server services)](#local-dev-server-services)
- [Useful commands](#useful-commands)
- [VPS management](#vps-management)
- [CI server deploys](#ci-server-deploys)
- [Backups](#backups)
- [Player identity](#player-identity)
- [Infrastructure stacks](#infrastructure-stacks)
- [Rebuilding the VPS / Tailnet auto-join](#rebuilding-the-vps--tailnet-auto-join)
  * [If the VPS is unhealthy](#if-the-vps-is-unhealthy)
  * [Rebuild (replace the instance)](#rebuild-replace-the-instance)
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
- **CI/CD**: `.github/workflows/deploy.yml`. On push to `main` it deploys any changed VPS services (sync-service, genai-service, agent-runner, caddy) over Tailscale, then the frontend via OIDC. See [CI server deploys](#ci-server-deploys). `.github/workflows/backup.yml` copies the world DB off-box hourly (see [Backups](#backups)).
- **Domain**: `aweborn.org` + `www.aweborn.org`, Hosted Zone ID `Z077908710IGH7R1XO587`
- **VPS**: `sync.aweborn.org` + `api.aweborn.org` → Lightsail (Ubuntu 22.04 + k3s + Caddy auto-TLS)
- **Tailscale**: VPS is `aweborn-vps` on the Tailnet (Lightsail instance `aweborn-vps-2` since the 2026-10-11 rebuild; Tailnet IP 100.86.61.100, changes on every rebuild, so never hard-code it), tagged `tag:server` (no key expiry). New servers join by themselves on first boot (see [Rebuilding the VPS](#rebuilding-the-vps--tailnet-auto-join)). agent-runner is reachable via the Tailnet only

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
| `src/components/CRDTDevOverlay.tsx` | Dev panel / temporary world list (shown in production until the World Index, Phase 08) |
| `shared/crdt-schema.ts` | Shared CRDT types + spatial helpers (client + server) |
| `server/sync-service/src/rooms.ts` | Room manager: sector rooms, world rooms, world creation, spatial resolver, presence relay |
| `src/index.css` | Full design system — tokens, glass effects, animations, payment form styles, success animation |
| `server/sync-service/src/index.ts` | WebSocket + Yjs CRDT sync server; also `GET /worlds/:id` (see [Teleport links](#teleport-links)) |
| `src/systems/TeleportSystem.ts` / `src/components/TeleportToast.tsx` | `/w/<uuid>` teleport links: lookup, placement, arrival effect, toast |
| `server/genai-service/src/index.ts` | Gen AI API proxy (placeholder, all routes return 501) |
| `server/agent-runner/src/index.ts` | Cron-scheduled LLM agent runner with HTTP API (port 3002, Tailnet-only) |
| `server/docker-compose.yml` | Local dev: runs all three services with hot-reload |
| `infra/k3s/` | Kubernetes manifests for k3s deployment (namespace, deployments, Caddy ingress). `secrets.example.yaml` is a template only and is never applied by automation |
| `infra/k3s/deploy-services.sh` | The one deploy path, run on the VPS by CI, by hand, and by bootstrap. Per service: build → smoke test → roll out → verify → auto-rollback. `deploy.sh` is a thin wrapper around it |
| `.env.production` | `VITE_API_ENDPOINT`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_SYNC_URL` |
| `infra/cloudformation.yml` | Static site AWS stack (S3, CloudFront, ACM, Route53, API GW, Lambda) |
| `infra/cloudformation-vps.yml` | VPS AWS stack (Lightsail instance, static IP, Route53 DNS, k3s+Docker bootstrap) |

## Teleport links

`https://aweborn.org/w/<uuidv4>` teleports the player to a world (Phase 08 NFC cards + share links). This URL format is a **permanent public API**: printed cards can't be patched.

- World IDs are lowercase UUIDv4 (`isWorldId()` in `shared/crdt-schema.ts`), e.g. `5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7`.
- **Origin** (the Aweborn Portal at `(0, 0, 0)`) is a real world with permanent ID `5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7` (`ORIGIN_WORLD_ID`). The server seeds it on boot; the client hides it from `worlds` since the portal has its own rendering.
- Arrival: every link lands **inside** its world (Origin: at the portal, no interior). Query strings are ignored, so older `?a=in` links still work.
- Lookup: `GET https://sync.aweborn.org/worlds/<id>` → `200 {id,name,color,solidified,sector,position,isOrigin}`, `400 invalid_id`, `404 not_found` (shown as "This world has faded"). CORS allows aweborn.org, localhost, and `CORS_ORIGINS`.
- After handling the link, the client resets the URL to `/`. CloudFront serves `index.html` for unknown paths, so no infra is involved.

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

**Then the gift becomes mana (Phase 05, 2026-10-16).** Stripe sends `payment_intent.succeeded` to `POST <payment api>/stripe-webhook` → Lambda `aweborn-stripe-webhook` checks the Stripe signature, skips anything not tagged `metadata.kind = donation` (and test-mode events), reads the net amount after fees from the charge's balance transaction, and posts `{ source: "gift", netDollars, ref: <payment intent id>, at }` to `https://sync.aweborn.org/api/mana/inflow` with `MANA_INFLOW_TOKEN`. The ledger is idempotent on the payment intent id, so Stripe's retries (any non-2xx, for up to 3 days) are safe. Only the amount and date leave Stripe. That token can only record gifts: no draws, grants or notes.

One-time setup (keys from `~/keys`, see CONFIG.md):
```bash
infra/set-secret.sh generate MANA_INFLOW_TOKEN       # 1. VPS + ~/keys
infra/cfn-preview.sh aweborn-website                 # 2. read the change, then deploy (Infrastructure stacks)
aws cloudformation deploy --stack-name aweborn-website --template-file infra/cloudformation.yml --capabilities CAPABILITY_NAMED_IAM
infra/stripe-webhook.sh create                       # 3. Stripe endpoint + signing secret → ~/keys
infra/set-stack-key.sh stripe-webhook                # 4. secret → Lambda
infra/set-stack-key.sh mana-inflow                   # 5. token → Lambda
```
Check: `aws logs tail /aws/lambda/aweborn-stripe-webhook --since 1h`, `https://sync.aweborn.org/mana/ledger`, and Stripe dashboard → Webhooks (delivery attempts; "Resend" is safe).

## Deployment instructions

1. **Set your Stripe publishable key** — edit `.env.production` and ensure the live key is present (starts with `pk_live_`).
2. **Deploy the CloudFormation stack** (first-time creation only; for updates see [Infrastructure stacks](#infrastructure-stacks), which keeps the existing Stripe key):
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
    The UserData script installs k3s and Docker, creates a *placeholder* `aweborn-secrets` (only if none exists), then runs `deploy-services.sh all`. Afterwards, set the real secret values from your Mac with `infra/set-secret.sh` (see [CONFIG.md](CONFIG.md)).

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
ssh -i ~/keys/AWEBORN_VPS_ADMIN_SSH_KEY.pem ubuntu@aweborn-vps
# Break-glass if Tailscale is down: Lightsail console → aweborn-vps → "Connect using SSH"
# (browser SSH is the only public source allowed on port 22, via the lightsail-connect alias)
# Tagged tag:server (2026-10-11), so its node key never expires. Don't untag it.
# IMDS is IMDSv2-only, hop limit 1 (set by the stack's ImdsHardening resource): the
# user-data holds the Tailscale OAuth secret, and pods must not be able to read it.

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

# Services deploy automatically from CI (see "CI server deploys" below).
# By hand, on the VPS (same script CI runs: sync origin/main → build → smoke
# test → roll out → verify → auto-rollback). sync-service and agent-runner use
# Recreate, so expect ~30s downtime each. Caddy restarts only if its config changed.
~/aweborn/infra/k3s/deploy-services.sh genai-service      # one or more services
~/aweborn/infra/k3s/deploy-services.sh all
# Secrets are never applied by any deploy script. Set them from your Mac with
# infra/set-secret.sh (inventory: CONFIG.md).

# World data (SQLite) lives on the host, outside k8s: /var/lib/aweborn/sync-data/universe.db
# Snapshotted hourly + copied to S3 daily; see "Backups" below.
# Fresh snapshot before a migration:  sudo k3s kubectl -n aweborn create job --from=cronjob/sync-backup pre-migration-$(date +%s)

# Check bootstrap log (first boot only)
sudo cat /var/log/aweborn-bootstrap.log
```

## CI server deploys

`.github/workflows/deploy.yml` on push to `main`:

1. **changes**: path filters per service decide which ones need deploying:
   - sync-service: `server/sync-service/**`, `shared/**`, its manifest, `.dockerignore`
   - genai-service / agent-runner: `server/<svc>/**`, plus its manifest
   - caddy: `caddy-ingress.yaml`, `caddy-pvc.yaml`
   - Changes to the deploy script alone don't trigger a deploy.
   - For a manual "Run workflow", set *services*: `all`, a space-separated list, or `none`.
2. **deploy-server** (only if any service is selected):
   - Typechecks each selected service.
   - Joins the Tailnet as an **ephemeral** node tagged `tag:ci`, using Tailscale workload identity federation (no long-lived Tailscale secret).
   - SSHes to `aweborn-vps` once with a deploy-only key. It sends the service list, which the VPS validates.
   - The VPS runs `infra/k3s/deploy-services.sh` and deploys in the order sync-service → genai-service → agent-runner → caddy. It stops at the first failure.
3. **deploy-frontend**: S3 + CloudFront. Runs after the server deploy succeeds or is skipped. **Never after a failed server deploy**, so a new client never ships against an old server.

**Deploy key** (secret `VPS_SSH_KEY`): on the VPS it's locked down in `~/.ssh/authorized_keys` with `from="100.64.0.0/10,fd7a:115c:a1e0::/48",restrict,command=".../deploy-services.sh"`. It can only connect from the Tailnet and can only run the deploy script. That script accepts only known service names and only deploys `origin/main`. No shell, no forwarding. The public key line lives in `infra/vps/ci-authorized-keys` and is installed by `infra/vps/install-ci-keys.sh`, which runs in the bootstrap and refuses any line that isn't locked down like this. To rotate: generate a new ed25519 key, replace its line in `infra/vps/ci-authorized-keys`, push, run `sudo ~/aweborn/infra/vps/install-ci-keys.sh` on the VPS (after `git pull`), then `gh secret set VPS_SSH_KEY < ~/keys/AWEBORN_VPS_CI_DEPLOY_SSH_KEY`. Generate the new key straight into `~/keys` (source of truth).

**Tailscale (one-time setup, admin console):**

1. Access controls (current policy, 2026-10-11): tags, CI → servers on SSH only, servers → nothing, enforced by `tests`:
   ```jsonc
   "tagOwners": { "tag:ci": ["autogroup:admin"], "tag:server": ["autogroup:admin"] },
   // in "grants" (next to the autogroup:member → * rule for humans):
   { "src": ["tag:ci"], "dst": ["tag:server"], "ip": ["tcp:22"] },
   // NO grant with "src": ["tag:server"]
   "tests": [
     { "src": "tag:ci", "accept": ["tag:server:22"], "deny": ["tag:server:443"] },
     { "src": "tag:server", "deny": ["tag:ci:22", "tag:server:22"] },   // tags only: node IPs change on rebuild
   ]
   ```
   Keep the allow-all rule scoped to `"src": ["autogroup:member"]`; tagged devices aren't members, so it gives them nothing.
2. Settings → Trust credentials → add **OpenID Connect** for GitHub: issuer `https://token.actions.githubusercontent.com`, subject `repo:aweborn@261697435/aweborn.org@1329275111:ref:refs/heads/main`, scope **auth_keys (write)**, tag `tag:ci`. The repo uses GitHub's **immutable subject** format (numeric owner/repo IDs). Check it with `gh api repos/aweborn/aweborn.org/actions/oidc/customization/sub` (`sub_claim_prefix`). The plain `repo:aweborn/aweborn.org:...` form gets a 403.
3. Its client ID and audience go in plaintext in `deploy.yml` / `backup.yml` (not secret).
4. Server auto-join: Settings → OAuth clients → scope **Auth Keys (write)**, tag **`tag:server`** only. Store its secret on the stack with `infra/set-stack-key.sh tailscale` (never anywhere else). See [Rebuilding the VPS](#rebuilding-the-vps--tailnet-auto-join).

Until those secrets exist, **deploy-server** skips with a warning and the frontend still deploys.

## Backups

Prod world data (`/var/lib/aweborn/sync-data/universe.db`) is backed up in two layers:

| Layer | What | Where | Retention |
|-------|------|-------|-----------|
| On-box, hourly at :07 UTC | CronJob `sync-backup` runs `server/sync-service/src/backup.ts` in the sync-service image: `VACUUM INTO` (consistent while the service writes), `integrity_check`, gzip | `/var/lib/aweborn/backups/sync/{hourly,daily}/universe-<UTC>.db.gz` + `latest.db.gz` / `latest.json` | 48 hourly + 30 daily |
| Off-box, hourly at :37 UTC | `.github/workflows/backup.yml`: ephemeral Tailscale node pulls `latest.*` with a read-only key, verifies checksum + age (≤ 3h) + integrity, uploads with a put-only OIDC role | `s3://aweborn-backups-<account>/sync/YYYY/MM/` (versioned, private, `infra/cloudformation-backups.yml`) | 90 days |

A failed or stale backup fails the workflow, and GitHub emails the admins. Check the on-box job with `sudo k3s kubectl -n aweborn get cronjob,jobs -l app=sync-backup` and `ls -la /var/lib/aweborn/backups/sync/hourly`.

**Restore** (on the VPS): `~/aweborn/infra/backup/restore-sync-db.sh <snapshot.db.gz>`. It verifies the snapshot first (`--check` = verify only), scales sync-service to 0, moves the current DB aside to `sync-data/pre-restore-<ts>/` (never deletes it), installs the snapshot, scales back up and checks `/health`. **From S3** (e.g. after a rebuild), run on your Mac: `infra/restore-from-s3.sh` (newest backup; `--list` to see them, or pass an S3 key). It downloads the backup, gets the box's host keys + a short-lived SSH cert from the Lightsail API (no trust-on-first-use, no local key), waits for the bootstrap, checks/updates CI's `VPS_KNOWN_HOST` pin, copies the backup to `~/restore/` on the box, runs `--check`, then asks you to type `restore` before running the on-box script above.

**One-time setup:**
1. `aws cloudformation deploy --stack-name aweborn-backups --template-file infra/cloudformation-backups.yml --capabilities CAPABILITY_NAMED_IAM`, then `gh variable set AWS_BACKUP_ROLE_ARN -R aweborn/aweborn.org --body <RoleArn output>`.
2. Backup key (secret `VPS_BACKUP_SSH_KEY`), restricted on the VPS to `from="100.64.0.0/10,fd7a:115c:a1e0::/48",restrict,command="/home/ubuntu/aweborn/infra/backup/backup-fetch.sh"`. It can only stream `latest.*`. Its line lives in `infra/vps/ci-authorized-keys` (installed by `infra/vps/install-ci-keys.sh`). To rotate: new ed25519 key, replace its line there, push, `git pull` + `sudo ~/aweborn/infra/vps/install-ci-keys.sh` on the VPS, `gh secret set VPS_BACKUP_SSH_KEY`.
3. Reuses `TS_OAUTH_CLIENT_ID` / `TS_AUDIENCE` and the `tag:ci` → `tag:server:22` grant.

GitHub disables scheduled workflows after 60 days without repo activity. If commits ever pause that long, re-enable it under Actions → Backup.

## Player identity

Anonymous-first player identity (Phase 08 I1), served by **Better Auth inside sync-service** at `https://sync.aweborn.org/api/auth/*`.

- **Boot:** the client (`src/lib/player.ts`) reuses its session or silently calls `signIn.anonymous()`, then opens the universe socket. On the upgrade the server reads the session cookie (trusted origins only) and tags the socket with the player's `playerId`. World `creator` is always set by the server (client value ignored).
- **IDs:** `playerId` (UUID, public: presence + `creator`) is our own column on Better Auth's `user` table. Better Auth's `user.id` changes when an anonymous player links a real sign-in; `playerId` is carried over (`onLinkAccount` in `server/sync-service/src/auth.ts`).
- **Data:** tables `user`, `session`, `account`, `verification`, `passkey` live in **`universe.db`**, so the hourly/S3 backups and DR restore cover them. Migrations run automatically at boot.
- **Sessions:** httpOnly cookie on `sync.aweborn.org` (same-site with `aweborn.org`), 1 year, refreshed daily; one per device.
- **Everyone is welcome:** if auth is unreachable (offline, cookies blocked, 5 s timeout) the client plays as a per-tab `guest-…`; guest worlds get `creator = "guest"`.
- **Secret:** `BETTER_AUTH_SECRET` in `aweborn-secrets`. **Keep a copy in the keys folder.** Losing or rotating it signs everyone out, and anonymous players then lose their identity for good. If it's missing, weak, or the `REPLACE_ME` placeholder in production, sync-service still runs but **auth is disabled** (everyone is a guest; `/api/auth/*` returns 503; loud `[auth] ✖` log line).

The source copy is `AWEBORN_BETTER_AUTH_SECRET.txt` in the keys folder (see [CONFIG.md](CONFIG.md)). After a rebuild, restore it with `infra/set-secret.sh push BETTER_AUTH_SECRET`, and check it with `infra/set-secret.sh status`. Set 2026-10-11.

One-off: `server/sync-service/scripts/migrate-legacy-creators.ts` reassigns pre-identity `p-xxxxxx` creators to `"system"` (stop sync-service first; `--dry-run` supported; backs up first).

### Saving a player (sign-in methods)

Every method attaches to the **same** `playerId`. UI: `src/components/PlayerAccount.tsx` ("Save your player" chip under the brand, account panel, and a gentle nudge after the first world created or ~10 min of play, at most once a day; rules in `src/lib/onramp.ts`). The client asks `GET /api/auth/methods` which buttons to show.

- **Passkeys** (`@better-auth/passkey`): on by default, nothing to configure. RP ID `aweborn.org` (override `PASSKEY_RP_ID`), so passkeys belong to the site players see even though auth runs on `sync.aweborn.org`. Adding one to an anonymous player flips `isAnonymous` to false (same user row). Signing in with one from an anonymous device switches to the saved player.
- **Google**: shown only when `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` exist in `aweborn-secrets` (both `optional` in the deployment). Anonymous players `signIn.social` (a new Google account becomes this player; an existing one switches to it); saved players `linkSocial`.
- **Email** (`emailOTP` plugin + email & password): a **6-digit code**, not a magic link. A link signs in whichever browser opens the mail, which breaks "save on this device" across devices; a link that binds the requesting device enables login hijacking. Codes last 10 min, 5 attempts, stored hashed. Password is an optional secondary path (min 10 chars, HIBP-checked, verification required; signing up with a taken email sends the owner a notice instead of revealing it). Shown only when SES creds (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, both `optional`) exist in `aweborn-secrets`. Mail goes out from `Aweborn <hello@aweborn.org>` (`server/sync-service/src/email.ts`), and replies reach a real person (hello@ is forwarded). Never use a no-reply address. Local dev prints mail to the console; `DEV_FIXED_OTP=424242` pins the code (ignored in prod). The new user inherits the anonymous player's `playerId` in `user.create.before`, because `/sign-up/email` with required verification returns no session.
- **Freshness:** Better Auth's built-in "session < 1 day" check is off (`freshAge: 0`) because anonymous players can never re-authenticate. Our `hooks.before` enforces it for saved players only on sensitive routes (add/delete passkey, link/unlink, change email, delete user).

**Google setup (once):** Google Cloud Console → APIs & Services → OAuth consent screen (External; app name Aweborn; support email; authorized domain `aweborn.org`; scopes: `openid`, `email`, `profile`; publish to Production) → Credentials → Create credentials → OAuth client ID → **Web application**:

- Authorized JavaScript origins: `https://aweborn.org`
- Authorized redirect URIs: `https://sync.aweborn.org/api/auth/callback/google` (and for local dev `http://localhost:1299/api/auth/callback/google`)

Then download the client JSON and run `infra/set-secret.sh google ~/Downloads/client_secret_….json` from your Mac. Delete the JSON afterwards.

**SES sender key (once, or to rotate):** `infra/set-secret.sh ses`. It creates a key for the `aweborn-mail-sender` IAM user (mail stack, send-as `hello@aweborn.org` only), stores it, restarts sync-service, then deletes the old keys.

## Infrastructure stacks

The repo is the source of truth for AWS. Every stack maps to one template:

| Stack | Template | Notes |
|-------|----------|-------|
| `aweborn-website` | `infra/cloudformation.yml` | S3, CloudFront, ACM, Route53, Stripe Lambda + API. `StripeSecretKey` is NoEcho |
| `aweborn-vps` | `infra/cloudformation-vps.yml` | Lightsail VPS. **Check for replacement before any apply**: a replaced instance loses the hostPath world DB. `TailscaleOAuthSecret` is NoEcho (set it only with `infra/set-stack-key.sh tailscale`). `ImdsHardening` custom resource (+ Lambda/role) keeps IMDS v2-only |
| `aweborn-backups` | `infra/cloudformation-backups.yml` | Backup bucket + put-only role |
| `aweborn-ci` | `infra/cloudformation-ci.yml` | Read-only role for the infra check below |
| `aweborn-mail` | `infra/cloudformation-mail.yml` | SES domain identity for aweborn.org (DKIM + SPF + DMARC `p=none` records in Route53, plus a custom MAIL FROM `mail.aweborn.org` so SPF aligns too). Inbound forwarding of `hello@` and `privacy@aweborn.org` → private inbox, plus-tagged per address (`you+aweborn-hello@…`, `you+aweborn-privacy@…`, so Gmail can filter): S3 raw copy kept 30 days → Lambda rewrites From to `forwarder@aweborn.org`, original sender as Reply-To. `ForwardTo` is a deploy parameter kept out of the repo (`ForwardTo="$(cat ~/keys/AWEBORN_MAIL_FORWARD_TO.txt)"`). Add addresses via `Recipients`. IAM user `aweborn-mail-sender` sends sign-in codes (key created out-of-band, see Saving a player). Deploy needs `CAPABILITY_NAMED_IAM`. **After first deploy:** `aws ses set-active-receipt-rule-set --rule-set-name aweborn-inbound`. SES production access granted 2026-10-12 (50k/day, 14/s) |

**Automatic, read-only check** (`.github/workflows/infra.yml`, runs `infra/cfn-preview.sh`):
- On every push to `main` that touches a template, it validates each template and previews a change set (repo vs deployed). The change sets are deleted, never executed.
- Mondays (and on demand), it also detects **drift**: edits made in the console or CLI behind CloudFormation's back.
- For `aweborn-vps` it also checks the live IMDS setting is `required` / hop limit 1 (🛑 otherwise; fix by bumping `ImdsHardening.Revision` and applying).
- ✅ in sync → pass. 🟡 undeployed in-place changes → pass with a warning. 🛑 a pending **replacement/removal**, or drift → **fail** (GitHub emails you). ❌ invalid → fail.
- Its role is explicitly denied `ExecuteChangeSet` / `UpdateStack` / `DeleteStack`, object reads, and Lambda config reads. So drift on the Lambdas (Stripe, IMDS hardener) is not checked. NoEcho values are never printed (CloudFormation shows them as `****`, verified in stack events and drift records 2026-10-11).

**Applying is manual and deliberate:**
```bash
infra/cfn-preview.sh aweborn-website            # 1. read exactly what will change (same report as CI)
aws cloudformation deploy --stack-name aweborn-website \
  --template-file infra/cloudformation.yml --capabilities CAPABILITY_NAMED_IAM
# 2. No --parameter-overrides: deploy keeps every current parameter value,
#    including the Stripe key. Only pass a parameter you mean to change.
```
Fix drift by putting the live value into the template (then apply), or by reverting the manual change. Don't leave drift in place.

## Rebuilding the VPS / Tailnet auto-join

> **Start with `infra/recover.sh`** (`--check` first). It runs the steps below in order from `~/keys` + the repo, and also recreates missing stacks after a bigger loss. The manual steps stay documented here for when you need to go step by step.

A server built from `infra/cloudformation-vps.yml` joins the Tailnet **by itself** on first boot, as a persistent `tag:server` node named `TailnetHostname` (default `aweborn-vps`, which is what CI and SSH target). That name is separate from the Lightsail `InstanceName`. It uses the Tailscale OAuth client secret stored in the stack (NoEcho `TailscaleOAuthSecret`). After joining, the bootstrap deletes every on-disk copy of the user-data. The stack's `ImdsHardening` resource makes IMDS v2-only with hop limit 1 seconds after the instance exists, so pods can't read the user-data either. An empty or invalid secret aborts the bootstrap loudly (`/var/log/aweborn-bootstrap.log`). The bootstrap also installs the restricted CI keys, k3s, and deploys every service (with placeholder secrets).

**Why persistent, not ephemeral:** an ephemeral node is deleted once it's been offline a while. After a long outage the server couldn't rejoin, because the secret is scrubbed from the box, and CI deploys + backups would be locked out. Persistent nodes also keep their name and Tailnet IP. Test nodes (`infra/test-tailscale-join.sh`) *are* ephemeral, so they clean themselves up.

**Nothing on the disk is relied on** (by design, no disk snapshots). The world DB is copied off-box **hourly** (`backup.yml`, :37), so losing the box costs at most ~1h of world edits. Every key comes from `~/keys` (see CONFIG.md); `LLM_API_KEY` is not issued yet.

### If the VPS is unhealthy
1. Lightsail console → `aweborn-vps` → **Reboot**; if that doesn't help, **Stop** then **Start** (moves it to new hardware; disk and static IP stay). Tailscale, k3s and the pods all come back by themselves.
2. Check `https://sync.aweborn.org/health`, `https://api.aweborn.org/health`, `tailscale ping aweborn-vps`. No Tailnet? Use the Lightsail browser SSH console.
3. Still broken (won't boot, disk/OS damaged)? Rebuild.

### Rebuild (replace the instance)
The website (S3/CloudFront) stays up throughout; sync and gen-AI are down until the new box is ready.
1. *(Optional, ~10 min)* Prove the join still works: `infra/test-tailscale-join.sh`.
2. If the old box still runs, take a fresh off-box backup: `gh workflow run backup.yml`.
3. **Delete the old `aweborn-vps` node** in the Tailscale admin console (Machines). Otherwise the new box joins as `aweborn-vps-1` and CI can't find it.
4. `infra/rebuild-vps.sh aweborn-vps-2` (any new name; CloudFormation can't replace a named resource under the same name). It previews the plan, refuses anything except replacing `VPSInstance` (+ its IMDS custom resource), shows the latest S3 backup, and asks you to type the old name. Then it applies with the one-update `infra/cloudformation-vps.rebuild-policy.json` (the static IP stays protected, so the IP and DNS don't change). CloudFormation creates the new instance, moves the static IP, then **deletes the old instance and its disk**.
5. Wait for the bootstrap (~10–15 min). Watch it from the Lightsail browser console: `sudo tail -f /var/log/aweborn-bootstrap.log`.

**After the box is up:**
6. **Update the pinned host key.** CI pins the box's ed25519 host key in the repo variable `VPS_KNOWN_HOST` (read by `deploy.yml` + `backup.yml`; admin-only, changes are in the audit log). After a rebuild it still holds the old key, so CI fails closed until it's updated (correct behaviour; never switch to trust-on-first-use). `infra/restore-from-s3.sh` (step 8) takes the new key from the Lightsail API (AWS-authenticated, not a network scan) and sets the variable after you answer `y`. No commit needed. By hand: `gh variable set VPS_KNOWN_HOST -R aweborn/aweborn.org --body 'aweborn-vps ssh-ed25519 AAAA...'`. To trust the new box on your Mac: `ssh-keygen -R aweborn-vps && gh variable get VPS_KNOWN_HOST -R aweborn/aweborn.org >> ~/.ssh/known_hosts`.
7. The restricted CI keys (deploy + backup) were installed by the bootstrap from `infra/vps/ci-authorized-keys`. Check with `sudo ~/aweborn/infra/vps/install-ci-keys.sh --check`.
8. Set the real k8s secrets from your Mac with `infra/set-secret.sh` ([CONFIG.md](CONFIG.md) lists them). **`BETTER_AUTH_SECRET` must be the same value as before** (from the keys folder: `infra/set-secret.sh push all`), or every player is signed out and anonymous players lose their identity (see [Player identity](#player-identity)). Restore the world DB: `infra/restore-from-s3.sh` on your Mac (see [Backups](#backups)). It also does step 6 (sets the host key pin variable).
9. Verify: both `/health` endpoints, `infra/cfn-preview.sh aweborn-vps` (in sync, IMDS hardened), `gh workflow run backup.yml` passes.

**Rehearsed on prod 2026-10-11** (`aweborn-vps` → `aweborn-vps-2`, ~10 min of sync/gen-AI downtime): pre-rebuild snapshot + `backup.yml`, old node deleted in Machines, `rebuild-vps.sh`, `restore-from-s3.sh` (pin updated from the Lightsail API, restored DB fingerprint == backup), Caddy got real certs on the first try, pin committed, `backup.yml` + Deploy green, `cfn-preview.sh` in sync. Before that, `infra/test-dr-restore.sh` **passed 2026-10-11** on a throwaway box (re-run it after bootstrap/deploy changes). Earlier note, kept for history: the rebuild path was first dry-run against the live stack (preview + refusal, answered "no"); `restore-from-s3.sh` was run against the live box up to the final prompt (download, API host keys, pin check, copy, `--check`; answered "no"); the join was tested on throwaway instances.

**Rotate the OAuth secret** (yearly, or at once if user-data or the stack parameters might have leaked): Tailscale admin → Settings → OAuth clients → create a new client (Auth Keys write, `tag:server`), run `infra/set-stack-key.sh tailscale` with it, then revoke the old client. Running servers are unaffected (they use their node keys, not the secret).

**If the secret leaks**, the holder can add `tag:server` nodes, and nothing else. Those nodes can't reach any device (no grants from `tag:server`), and CI won't talk to an impostor because the host key is pinned. Rotate as above and delete any unknown `tag:server` nodes.

## Future Roadmap

The roadmap for multiplayer/mesh networking has been moved to [ROADMAP.md](ROADMAP.md).

For the actionable, phased implementation plan (with session protocol for picking up where you left off), see [phases/README.md](./phases/README.md).
