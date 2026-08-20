# Phase 01: Foundation & Infra (Lightsail + k3s)

**Status:** `[ ]` Not Started
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
| Sync service | **Node.js + y-websocket + ws** | Lightweight, Yjs integration built in |
| Gen AI service | **Node.js** (placeholder in Phase 01, fleshed out in Phase 07) | Consistent runtime, simple HTTP proxy |

> **Future: Talos OS migration**
> Once the services are stable and multi-node scaling is needed, migrate from Ubuntu + k3s to Talos OS. The Kubernetes manifests created here will transfer directly — only the node OS and bootstrap process changes.

## Tasks

### Lightsail Instance + k3s
- `[ ]` Provision Lightsail instance (2 GB RAM, Ubuntu 22.04 LTS, us-east-1)
- `[ ]` Assign a static IP to the Lightsail instance
- `[ ]` SSH into instance and install k3s:
  ```bash
  curl -sfL https://get.k3s.io | sh -
  ```
- `[ ]` Verify k3s is running (`k3s kubectl get nodes`)
- `[ ]` Copy `/etc/rancher/k3s/k3s.yaml` locally as `kubeconfig` (update server IP)
- `[ ]` Configure Lightsail firewall: allow 443 (HTTPS/WSS), 80 (HTTP redirect), 6443 (k3s API — restricted to your IP)

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
- `[ ]` Create `infra/k3s/` directory
- `[ ]` Kubernetes manifests:
  - `namespace.yaml` — `aweborn` namespace
  - `sync-service-deployment.yaml`
  - `genai-service-deployment.yaml`
  - `caddy-ingress.yaml`
  - `secrets.yaml` (template — actual secrets managed via k3s or sealed-secrets)
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

- [ ] k3s is running on Lightsail (Ubuntu 22.04 LTS)
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
| `infra/k3s/` | NEW | k3s cluster K8s manifests |
| `src/hooks/useCRDT.ts` | NEW | Client CRDT connection hook |
| `package.json` | MODIFY | Add yjs, y-websocket client deps |
| `HANDOFF.md` | MODIFY | Add VPS/k3s deployment docs |

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------
| — | — | — |
