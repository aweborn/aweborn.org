# Aweborn — Master Plan

> **How to use this file:** This is the root of Aweborn's hierarchical plan tree. Every agent session should start here, then drill into the relevant repo's `PLAN.md`, then into the active phase file. Update status markers as work completes.
>
> *Lives in the `aweborn.org` repo so it is version-controlled (moved from the untracked parent `aweborn/PLAN.md` on 2026-10-03). Archived sibling repos link here by GitHub URL.*

## Products

| Product | Repo | Status | Current Phase | Plan |
|---------|------|--------|---------------|------|
| 🌌 Aweborn Universe | `aweborn.org` | 🟡 Active | Phases 01–04 ✅ · **Next: Phase 05 (Mana Economy)** | [→ PLAN.md](./PLAN.md) |
| 📱 TokBot App | `tokbot` (private) | ⬜ Archived | — | [→ PLAN.md](https://github.com/aweborn/tokbot/blob/main/PLAN.md) |
| 🧠 TokBot Backend | `tokbot-backend` (private) | ⬜ Archived | — | [→ PLAN.md](https://github.com/aweborn/tokbot-backend/blob/main/PLAN.md) |

## Strategic Direction

**All product development is focused on aweborn.org.** TokBot's generative AI creation features (avatars, objects, music, voices, landscapes) are being absorbed into the aweborn.org universe as in-world creation tools. Players create inside worlds using AI prompts — mana powers these creations with costs pegged to real compute/API costs.

Useful code from `tokbot` (e.g., Meshy AI integration) will be migrated into aweborn.org. The `tokbot` and `tokbot-backend` repos are archived for reference.

## Priority

**aweborn.org is the only active workstream.** All phases are sequenced inside its [PLAN.md](./PLAN.md).

## Physical Artifacts: NFC Trading Cards

Aweborn worlds become **physical NFC trading cards**. Tap a phone to a card → `https://aweborn.org/w/<uuidv4>` opens → the player teleports to that world and it joins their **Worlidex** (personal index of discovered worlds, warpable from anywhere). Cards are a fundraising product (sales → mana pool), an outreach tool (free at events), and a print-on-demand service for players, companies, and events. This is where Aweborn reaches into the physical world.

- Design: [ROADMAP.md → Physical Portals](./ROADMAP.md#physical-portals-nfc-trading-cards--the-worlidex)
- Execution: [Phase 08](./phases/08-nfc-trading-cards.md)

## Infrastructure Strategy

The VPS runs **Ubuntu 22.04 LTS + k3s** on an AWS Lightsail 2 GB instance (`infra/cloudformation-vps.yml`), with Caddy as a DaemonSet for auto-TLS. All services are Docker containers deployed via Kubernetes manifests (`infra/k3s/`). The VPS is joined to the Tailnet as `aweborn-vps`; SSH is Tailnet-only (public port 22 closed 2026-10-03, Lightsail browser console as break-glass). **Talos OS** (mirroring `ajmedeio-cluster-infra`) was the original plan; it was replaced by k3s on Aug 20, 2026 for faster provisioning and remains a possible future migration target.

**Services:**

| Service | Container | Status | Purpose |
|---------|-----------|--------|---------|
| `sync-service` | Node.js | ✅ Live (`sync.aweborn.org`) | WebSocket server, Yjs CRDT sync (room-aware binary protocol), SQLite persistence, spatial resolution, presence relay; mana validation in Phase 05 |
| `genai-service` | Node.js | 🟡 Placeholder (`api.aweborn.org`, routes return 501) | Proxy to external AI APIs (Meshy, image gen, music gen, voice gen, text gen) — Phase 07 |
| `agent-runner` | Node.js | ✅ Live (Tailnet-only, port 3002) | Cron-scheduled LLM agents with HTTP API (added Sep 26, 2026) |
| `caddy` | Caddy | ✅ Live | Reverse proxy, TLS termination, routing |

## Design Documents

| Document | Purpose | Location |
|----------|---------|----------|
| ROADMAP.md | Full vision — multiplayer, mesh networking, CRDT architecture, mana economy, navigation, visuals | [ROADMAP.md](./ROADMAP.md) |
| HANDOFF.md | Current architecture snapshot — frontend, backend, infra, deployment | [HANDOFF.md](./HANDOFF.md) |

> ⚠️ **ROADMAP.md is the design bible.** Do NOT modify it during execution. If a design decision changes, note the deviation in the relevant phase file and discuss with Alex.

## Session Protocol

1. **Start** → Read this file (L0)
2. **Navigate** → Follow the link to [PLAN.md](./PLAN.md) (L1)
3. **Drill** → Read the current phase file (L2) — find the next unchecked task
4. **Execute** → Do the work
5. **Log** → Update the session log in the phase file before ending
6. **Bubble up** → If a phase completes, update the L1 and L0 status markers

## Resolved Decisions

| Decision | Resolution | Date |
|----------|-----------|------|
| VPS OS | Ubuntu 22.04 LTS + k3s (Talos deferred) | Aug 20, 2026 |
| Lightsail instance size | 2 GB RAM | Aug 20, 2026 |
| WebSocket subdomain | `sync.aweborn.org` | Aug 20, 2026 |
| Gen AI subdomain | `api.aweborn.org` (separate from sync) | Aug 20, 2026 |
| Ops access | Tailscale; VPS joined as `aweborn-vps`, agent-runner Tailnet-only | Sep 26, 2026 |
| SSH exposure | Tailnet-only; public 22 restricted to `lightsail-connect` | Oct 3, 2026 |
| Plan storage | Master plan lives in the `aweborn.org` repo; non-profit admin records kept in Google Drive, never in this public repo | Oct 3, 2026 |

## Open Decisions (Pending Research / User Input)

| Decision | Options | Status |
|----------|---------|--------|
| Mana-to-cost formula | Research API costs → derive conversion rate | ⬜ Pending (Phase 05 + 07 task) |
| Gen AI providers | Meshy (3D), others TBD per modality | ⬜ Pending (Phase 07 task) |
| NFC card print + encode vendor | In-house (pilot) vs. vendor (scale) | ⬜ Pending (Phase 08 task) |
| Card product name | TBD ("Worlidex" is settled) | ⬜ Pending |
| Persistent player identity | Device-persistent v1 → cross-device v2 | ⬜ Pending (Phase 08 prerequisite) |

*Last updated: 2026-10-03*
