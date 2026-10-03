# Phase 01: Foundation & Infra (Lightsail + k3s)

**Status:** `[x]` Complete
**Depends on:** —
**ROADMAP reference:** [Architecture Concepts: The Hybrid P2P / Client-Server Model](../ROADMAP.md#architecture-concepts-the-hybrid-p2p--client-server-model)
**Estimated sessions:** 2-3

## Goal

Stand up a k3s Kubernetes cluster on an Ubuntu-based AWS Lightsail instance with Docker services for CRDT sync and Gen AI proxying. By the end of this phase, the VPS is running k3s, services are deployed as containers, and two browser tabs can connect to the sync-service and share a CRDT document in real-time.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| VPS OS | **Ubuntu 22.04 LTS** | Standard, well-supported, fast provisioning on Lightsail. Talos OS is a future migration target once infra is stable. |
| VPS provider | **AWS Lightsail** | $10-20/mo budget target, integrates with existing Route53/CloudFront |
| Instance size | **2 GB RAM** | k3s (~512 MB) + 2 containers + Yjs docs in memory |
| Container orchestration | **k3s** | Lightweight Kubernetes distribution. Single binary install, <30 seconds to bootstrap, production-grade, CNCF certified. |
| Service mesh | **None initially** | Overkill for 2-3 services on single node |
| Reverse proxy | **Caddy** (as Kubernetes Ingress or sidecar) | Auto TLS via Let's Encrypt, zero-config HTTPS |
| Local dev | **Docker Compose** | Mirrors production containers without k3s overhead |
| Sync service | **Node.js + y-websocket + ws** | Lightweight, Yjs integration built in. *Superseded in Phase 02 by a room-aware custom binary protocol over `ws` + Yjs.* |
| Gen AI service | **Node.js** (placeholder in Phase 01, fleshed out in Phase 07) | Consistent runtime, simple HTTP proxy |

> **Future: Talos OS migration**
> Once the services are stable and multi-node scaling is needed, migrate from Ubuntu + k3s to Talos OS. The Kubernetes manifests created here will transfer directly — only the node OS and bootstrap process changes.

## Tasks

> **Note (reconciled 2026-10-03):** All tasks below shipped on 2026-08-20. Provisioning was automated through `infra/cloudformation-vps.yml` UserData (k3s + Docker install, image build, manifest apply) instead of the manual SSH steps originally written.

### Lightsail Instance + k3s
- `[x]` Provision Lightsail instance (2 GB RAM, Ubuntu 22.04 LTS, us-east-1) — *via CloudFormation*
- `[x]` Assign a static IP to the Lightsail instance — *via CloudFormation*
- `[x]` Install k3s — *via UserData bootstrap*
  ```bash
  curl -sfL https://get.k3s.io | sh -
  ```
- `[x]` Verify k3s is running (`k3s kubectl get nodes`)
- `[x]` Copy `/etc/rancher/k3s/k3s.yaml` locally as `kubeconfig` — *not needed; management happens over SSH (`sudo k3s kubectl`) and Tailscale*
- `[x]` Configure Lightsail firewall — *as shipped: 22 (SSH, ~~open to 0.0.0.0/0~~ restricted 2026-10-03 to the `lightsail-connect` browser-console alias; normal access is over the Tailnet as `aweborn-vps`), 80, 443. 6443 is intentionally **not** exposed; use an SSH tunnel*

### DNS & TLS
- `[x]` Add `sync.aweborn.org` A record in Route53 → Lightsail static IP
- `[x]` Add `api.aweborn.org` A record (or CNAME to same IP)
- `[x]` Deploy Caddy as Kubernetes Ingress with auto-TLS — *as a DaemonSet with hostPort*
- `[x]` Verify `https://sync.aweborn.org` and `https://api.aweborn.org` serve TLS

### Docker Services — sync-service
- `[x]` Create `server/sync-service/` directory
- `[x]` Initialize Node.js project with TypeScript
- `[x]` Install dependencies: `yjs`, `y-websocket`, `ws`
- `[x]` Implement basic y-websocket server (< 50 lines) — *replaced by room-aware server in Phase 02*
- `[x]` Add health check endpoint (`GET /health`)
- `[x]` Create `Dockerfile` (multi-stage build) — *Node 22 Alpine + python3/make/g++ for better-sqlite3*
- `[x]` Create Kubernetes Deployment + Service manifest

### Docker Services — genai-service (Placeholder)
- `[x]` Create `server/genai-service/` directory
- `[x]` Initialize Node.js project with TypeScript
- `[x]` Add health check endpoint (`GET /health`)
- `[x]` Add placeholder route structure (will be filled in Phase 07):
  ```
  POST /generate/model     → 501 Not Implemented
  POST /generate/image     → 501 Not Implemented
  POST /generate/music     → 501 Not Implemented
  POST /generate/voice     → 501 Not Implemented
  POST /generate/text      → 501 Not Implemented
  POST /generate/terrain   → 501 Not Implemented
  ```
- `[x]` Create `Dockerfile`
- `[x]` Create Kubernetes Deployment + Service manifest

### Docker Compose (Local Dev)
- `[x]` Create `server/docker-compose.yml`
- `[x]` Both services run locally with hot-reload (volume mounts)
- `[x]` Document local dev workflow — *in HANDOFF.md ("Local dev")*

### Kubernetes Manifests
- `[x]` Create `infra/k3s/` directory
- `[x]` Kubernetes manifests:
  - `namespace.yaml` — `aweborn` namespace
  - `sync-service-deployment.yaml`
  - `genai-service-deployment.yaml`
  - `caddy-ingress.yaml`
  - `secrets.yaml` (template — actual secrets managed via k3s or sealed-secrets)
- `[x]` Deploy script or Makefile for applying manifests — *`infra/k3s/deploy.sh`*

### Client Integration (Proof of Concept)
- `[x]` Install `yjs` and `y-websocket` in the Vite frontend — *`y-websocket` later unused (custom protocol)*
- `[x]` Create `src/hooks/useCRDT.ts` — connects to `wss://sync.aweborn.org`
- `[x]` Add a temporary dev overlay that shows CRDT state — *`CRDTDevOverlay.tsx`*
- `[x]` Test: open two browser tabs → both connect → edit shared state → see sync — *verified in Phase 02 E2E test (2026-08-20)*

### Deployment Pipeline
- `[x]` Add deploy script: build Docker images → kubectl apply — *`deploy.sh --vps --apply`*
- `[x]` Container registry — *not used: images are built on the VPS from `main` (k3s local images)*
- `[x]` Document deployment in HANDOFF.md

## Acceptance Criteria

- [x] k3s is running on Lightsail (Ubuntu 22.04 LTS)
- [x] sync-service and genai-service deploy as Kubernetes pods
- [x] `wss://sync.aweborn.org` is reachable with valid TLS (Let's Encrypt, valid until Nov 18 2026)
- [x] Two browser tabs can connect and sync a shared Y.Map in real-time *(verified 2026-08-20 in Phase 02 E2E test: world creation, presence, and object sync across two tabs)*
- [x] Pods auto-restart on crash (Kubernetes default behavior)
- [x] Health check endpoints return 200 for both services
- [x] Local dev works via `docker-compose up`
- [x] genai-service placeholder routes return 501

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `server/sync-service/` | NEW | WebSocket + CRDT server |
| `server/sync-service/src/index.ts` | NEW | y-websocket server entry |
| `server/sync-service/Dockerfile` | NEW | Container image |
| `server/sync-service/package.json` | NEW | Dependencies |
| `server/genai-service/` | NEW | Gen AI proxy (placeholder) |
| `server/genai-service/src/index.ts` | NEW | Placeholder routes |
| `server/genai-service/Dockerfile` | NEW | Container image |
| `server/genai-service/package.json` | NEW | Dependencies |
| `server/docker-compose.yml` | NEW | Local dev orchestration |
| `infra/k3s/` | NEW | k3s cluster K8s manifests (namespace, deployments, Caddy DaemonSet, PVC, secrets) |
| `infra/k3s/deploy.sh` | NEW | Build/push/apply script with `--vps` flag |
| `infra/cloudformation-vps.yml` | NEW | CloudFormation: Lightsail instance, static IP, Route53 DNS, UserData bootstrap |
| `src/hooks/useCRDT.ts` | NEW | Client CRDT connection hook |
| `package.json` | MODIFY | Add yjs, y-websocket client deps |
| `.env` / `.env.production` | MODIFY | Add VITE_SYNC_URL |
| `HANDOFF.md` | MODIFY | Add VPS/k3s deployment docs, VPS management section |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-08-20 | Chunk 1: Built all server services (sync-service, genai-service), Docker images, K8s manifests, Docker Compose, client useCRDT hook. Verified TypeScript compiles, frontend builds, YAML valid. | Chunk 2 |
| 2026-08-20 | Chunk 2: Created CloudFormation VPS template, deployed Lightsail 2GB instance with UserData bootstrap (k3s, Docker, image builds, manifest deploy). Caddy DaemonSet with hostPort for auto-TLS. All services live at sync.aweborn.org and api.aweborn.org. Updated HANDOFF.md. | Phase 02 |
