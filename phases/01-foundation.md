# Phase 01: Foundation & Infra (Talos + Docker)

**Status:** `[ ]` Not Started
**Depends on:** —
**ROADMAP reference:** [Architecture Concepts: The Hybrid P2P / Client-Server Model](../ROADMAP.md#architecture-concepts-the-hybrid-p2p--client-server-model)
**Estimated sessions:** 3-4

## Goal

Stand up a Talos OS Kubernetes cluster on AWS Lightsail with Docker services for CRDT sync and Gen AI proxying. By the end of this phase, the VPS is running Talos, services are deployed as containers, and two browser tabs can connect to the sync-service and share a CRDT document in real-time.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| VPS OS | **Talos OS** | Immutable, API-driven, Kubernetes-native. Matches `ajmedeio-cluster-infra` patterns. Enables future multi-node scaling across Lightsail instances. |
| VPS provider | **AWS Lightsail** | $10-20/mo budget target, integrates with existing Route53/CloudFront |
| Instance size | **2 GB RAM minimum** (Talos control plane + workloads) | Talos + 2 containers + Yjs docs in memory |
| Container orchestration | **Kubernetes (via Talos)** | Native to Talos, production-grade, declarative |
| Service mesh | **None initially** | Overkill for 2-3 services on single node |
| Reverse proxy | **Caddy** (as Kubernetes Ingress or sidecar) | Auto TLS via Let's Encrypt, zero-config HTTPS |
| Local dev | **Docker Compose** | Mirrors production containers without Talos overhead |
| Sync service | **Node.js + y-websocket + ws** | Lightweight, Yjs integration built in |
| Gen AI service | **Node.js** (placeholder in Phase 01, fleshed out in Phase 07) | Consistent runtime, simple HTTP proxy |

## Tasks

### Lightsail Instance + Talos OS
- `[ ]` Provision Lightsail instance (2 GB RAM, us-east-1)
- `[ ]` Generate Talos machine config (`talosctl gen config`)
- `[ ]` Install Talos OS on Lightsail instance
  - Option A: Custom AMI with Talos (if Lightsail supports)
  - Option B: PXE boot or disk image upload
  - Option C: Use Lightsail "bring your own image" if available
  - **Fallback:** If Talos on Lightsail is too complex, use plain k3s on Ubuntu as stepping stone
- `[ ]` Verify Talos control plane is running (`talosctl health`)
- `[ ]` Configure `kubeconfig` for remote kubectl access
- `[ ]` Configure firewall: allow 443 (HTTPS/WSS), 80 (HTTP redirect), 6443 (Talos API — restricted to your IP)

### DNS & TLS
- `[ ]` Add `sync.aweborn.org` A record in Route53 → Lightsail static IP
- `[ ]` Add `api.aweborn.org` A record (or CNAME to same IP)
- `[ ]` Deploy Caddy as Kubernetes Ingress with auto-TLS
- `[ ]` Verify `https://sync.aweborn.org` and `https://api.aweborn.org` serve TLS

### Docker Services — sync-service
- `[ ]` Create `server/sync-service/` directory
- `[ ]` Initialize Node.js project with TypeScript
- `[ ]` Install dependencies: `yjs`, `y-websocket`, `ws`
- `[ ]` Implement basic y-websocket server (< 50 lines)
- `[ ]` Add health check endpoint (`GET /health`)
- `[ ]` Create `Dockerfile` (multi-stage build, Node 20 Alpine)
- `[ ]` Create Kubernetes Deployment + Service manifest

### Docker Services — genai-service (Placeholder)
- `[ ]` Create `server/genai-service/` directory
- `[ ]` Initialize Node.js project with TypeScript
- `[ ]` Add health check endpoint (`GET /health`)
- `[ ]` Add placeholder route structure (will be filled in Phase 07):
  ```
  POST /generate/model     → 501 Not Implemented
  POST /generate/image     → 501 Not Implemented
  POST /generate/music     → 501 Not Implemented
  POST /generate/voice     → 501 Not Implemented
  POST /generate/text      → 501 Not Implemented
  POST /generate/terrain   → 501 Not Implemented
  ```
- `[ ]` Create `Dockerfile`
- `[ ]` Create Kubernetes Deployment + Service manifest

### Docker Compose (Local Dev)
- `[ ]` Create `server/docker-compose.yml`
- `[ ]` Both services run locally with hot-reload (volume mounts)
- `[ ]` Document local dev workflow in README

### Kubernetes Manifests
- `[ ]` Create `infra/talos/` directory
- `[ ]` Talos machine config (stored securely, not in git)
- `[ ]` Kubernetes manifests:
  - `namespace.yaml` — `aweborn` namespace
  - `sync-service-deployment.yaml`
  - `genai-service-deployment.yaml`
  - `caddy-ingress.yaml`
  - `secrets.yaml` (template — actual secrets managed via Talos or sealed-secrets)
- `[ ]` Deploy script or Makefile for applying manifests

### Client Integration (Proof of Concept)
- `[ ]` Install `yjs` and `y-websocket` in the Vite frontend
- `[ ]` Create `src/hooks/useCRDT.ts` — connects to `wss://sync.aweborn.org`
- `[ ]` Add a temporary dev overlay that shows CRDT state (JSON dump)
- `[ ]` Test: open two browser tabs → both connect → edit shared Y.Map → see sync

### Deployment Pipeline
- `[ ]` Add deploy script: build Docker images → push to registry → kubectl apply
- `[ ]` Container registry: GitHub Container Registry (ghcr.io) or Lightsail container registry
- `[ ]` Document deployment in HANDOFF.md

## Acceptance Criteria

- [ ] Talos OS is running on Lightsail (or k3s fallback if Talos on Lightsail is blocked)
- [ ] sync-service and genai-service deploy as Kubernetes pods
- [ ] `wss://sync.aweborn.org` is reachable with valid TLS
- [ ] Two browser tabs can connect and sync a shared Y.Map in real-time
- [ ] Pods auto-restart on crash (Kubernetes default behavior)
- [ ] Health check endpoints return 200 for both services
- [ ] Local dev works via `docker-compose up`
- [ ] genai-service placeholder routes return 501

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
| `infra/talos/` | NEW | Talos config + K8s manifests |
| `src/hooks/useCRDT.ts` | NEW | Client CRDT connection hook |
| `package.json` | MODIFY | Add yjs, y-websocket client deps |
| `HANDOFF.md` | MODIFY | Add VPS/Talos deployment docs |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| — | — | — |
