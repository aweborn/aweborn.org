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
- **CI/CD**: `.github/workflows/deploy.yml`. On push to `main` it deploys any changed VPS services (sync-service, genai-service, agent-runner, caddy) over Tailscale, then the frontend via OIDC. See [CI server deploys](#ci-server-deploys). `.github/workflows/backup.yml` copies the world DB off-box daily (see [Backups](#backups)).
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
- Arrival: default = orbit; `?a=in` = drop inside (ignored for Origin).
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
    The UserData script installs k3s and Docker, creates a *placeholder* `aweborn-secrets` (only if none exists), then runs `deploy-services.sh all`. Afterwards, set the real secret values with `kubectl create secret` (see `infra/k3s/secrets.example.yaml`).

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

# Services deploy automatically from CI (see "CI server deploys" below).
# By hand, on the VPS (same script CI runs: sync origin/main → build → smoke
# test → roll out → verify → auto-rollback). sync-service and agent-runner use
# Recreate, so expect ~30s downtime each. Caddy restarts only if its config changed.
~/aweborn/infra/k3s/deploy-services.sh genai-service      # one or more services
~/aweborn/infra/k3s/deploy-services.sh all
# Secrets are never applied by any script. Change them with:
#   sudo k3s kubectl -n aweborn create secret generic aweborn-secrets --from-literal=... --dry-run=client -o yaml | sudo k3s kubectl apply -f -

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

**Deploy key** (secret `VPS_SSH_KEY`): on the VPS it's locked down in `~/.ssh/authorized_keys` with `from="100.64.0.0/10,fd7a:115c:a1e0::/48",restrict,command=".../deploy-services.sh"`. It can only connect from the Tailnet and can only run the deploy script. That script accepts only known service names and only deploys `origin/main`. No shell, no forwarding. To rotate: generate a new ed25519 key, replace that line, `gh secret set VPS_SSH_KEY`.

**Tailscale (one-time setup, admin console):**

1. Access controls: define the tag and allow CI to reach only the VPS's SSH port:
   ```jsonc
   "hosts":     { "aweborn-vps": "100.118.138.70" },
   "tagOwners": { "tag:ci": ["autogroup:admin"] },
   // in "grants":
   { "src": ["tag:ci"], "dst": ["aweborn-vps"], "ip": ["tcp:22"] }
   ```
   If the policy still has the default allow-all rule, `tag:ci` can reach everything. Scope that rule to your users (e.g. `"src": ["autogroup:member"]`) so the grant above is CI's only access.
2. Settings → Trust credentials → add **OpenID Connect** for GitHub: issuer `https://token.actions.githubusercontent.com`, subject `repo:aweborn@261697435/aweborn.org@1329275111:ref:refs/heads/main`, scope **auth_keys (write)**, tag `tag:ci`. The repo uses GitHub's **immutable subject** format (numeric owner/repo IDs). Check it with `gh api repos/aweborn/aweborn.org/actions/oidc/customization/sub` (`sub_claim_prefix`). The plain `repo:aweborn/aweborn.org:...` form gets a 403.
3. GitHub secrets: `TS_OAUTH_CLIENT_ID` (the credential's client ID) and `TS_AUDIENCE` (its audience).

Until those secrets exist, **deploy-server** skips with a warning and the frontend still deploys.

## Backups

Prod world data (`/var/lib/aweborn/sync-data/universe.db`) is backed up in two layers:

| Layer | What | Where | Retention |
|-------|------|-------|-----------|
| On-box, hourly at :07 UTC | CronJob `sync-backup` runs `server/sync-service/src/backup.ts` in the sync-service image: `VACUUM INTO` (consistent while the service writes), `integrity_check`, gzip | `/var/lib/aweborn/backups/sync/{hourly,daily}/universe-<UTC>.db.gz` + `latest.db.gz` / `latest.json` | 48 hourly + 30 daily |
| Off-box, daily at 07:37 UTC | `.github/workflows/backup.yml`: ephemeral Tailscale node pulls `latest.*` with a read-only key, verifies checksum + age (≤ 3h) + integrity, uploads with a put-only OIDC role | `s3://aweborn-backups-<account>/sync/YYYY/MM/` (versioned, private, `infra/cloudformation-backups.yml`) | 90 days |

A failed or stale backup fails the workflow, and GitHub emails the admins. Check the on-box job with `sudo k3s kubectl -n aweborn get cronjob,jobs -l app=sync-backup` and `ls -la /var/lib/aweborn/backups/sync/hourly`.

**Restore** (on the VPS): `~/aweborn/infra/backup/restore-sync-db.sh <snapshot.db.gz>`. It verifies the snapshot first (`--check` = verify only), scales sync-service to 0, moves the current DB aside to `sync-data/pre-restore-<ts>/` (never deletes it), installs the snapshot, scales back up and checks `/health`. From S3: `aws s3 cp s3://aweborn-backups-<account>/sync/YYYY/MM/<file> .`, `scp` it to the VPS, then run the same script.

**One-time setup:**
1. `aws cloudformation deploy --stack-name aweborn-backups --template-file infra/cloudformation-backups.yml --capabilities CAPABILITY_NAMED_IAM`, then `gh variable set AWS_BACKUP_ROLE_ARN -R aweborn/aweborn.org --body <RoleArn output>`.
2. Backup key (secret `VPS_BACKUP_SSH_KEY`), restricted on the VPS to `from="100.64.0.0/10,fd7a:115c:a1e0::/48",restrict,command="/home/ubuntu/aweborn/infra/backup/backup-fetch.sh"`. It can only stream `latest.*`. To rotate: new ed25519 key, replace that line, `gh secret set VPS_BACKUP_SSH_KEY`.
3. Reuses `TS_OAUTH_CLIENT_ID` / `TS_AUDIENCE` and the existing `tag:ci` → `aweborn-vps:22` grant.

GitHub disables scheduled workflows after 60 days without repo activity. If commits ever pause that long, re-enable it under Actions → Backup.

## Future Roadmap

The roadmap for multiplayer/mesh networking has been moved to [ROADMAP.md](ROADMAP.md).

For the actionable, phased implementation plan (with session protocol for picking up where you left off), see [phases/README.md](./phases/README.md).
