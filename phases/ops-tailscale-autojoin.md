# Ops: VPS auto-joins the Tailnet on first boot

**Status:** `[ ]` Not started. **Next up** (before Phase 08 / 8B). Small task: about one session.
**Why:** `infra/cloudformation-vps.yml` UserData installs Tailscale but never runs `tailscale up` (the line is commented out). A server rebuilt from the template would not join the Tailnet. CI deploys (`deploy.yml`), the off-box backup pull (`backup.yml`) and our SSH all reach the VPS **only** over the Tailnet, and public port 22 is closed. So every new server needs a manual `tailscale up` through the Lightsail browser console. Goal: any server we launch joins the Tailnet by itself and is immediately deployable.

> Out of scope: several servers sharing world sync (server-to-server replication). That's a separate design discussion; see the README → Open Design Questions.

## Current state (2026-10-11)

- One VPS: Lightsail `aweborn-vps` (Ubuntu 22.04, k3s). Tailnet IP `100.118.138.70`, MagicDNS name `aweborn-vps`, key expiry disabled.
- Tailscale ACL (HANDOFF → CI server deploys): `hosts: { "aweborn-vps": "100.118.138.70" }`, `tag:ci` (GitHub runners, ephemeral, via OIDC workload identity) → `aweborn-vps` `tcp:22`. The VPS itself is **not tagged** (it was joined by Alex's user).
- Stack guards: the `aweborn-vps` stack has termination protection plus a stack policy that **forbids replacing/deleting `VPSInstance`** (`infra/cloudformation-vps.stack-policy.json`). The infra check (`.github/workflows/infra.yml`) verifies both. UserData edits update in place and **do not re-run** on the existing box.

## Gotchas to design around

1. **Lightsail instances have no IAM instance role.** A plain Lightsail box can't read SSM Parameter Store or Secrets Manager without credentials. Options:
   - (a) NoEcho CFN parameter injected into UserData. Simple, but anyone with `lightsail:GetInstance` or shell access can read it from user-data. Fine **only if** the credential is narrowly scoped (below).
   - (b) A dedicated IAM user whose access key only allows reading one SSM parameter. Still a credential in user-data, so no real gain over (a).
   - (c) Something else (e.g. a one-time key fetched after boot)?
   - Decide with Alex. Leaning (a) with a scoped credential.
2. **Use a Tailscale OAuth client, not an auth key.** Auth keys expire (90 days max). An OAuth client secret with only the `auth_keys` scope and tag `tag:server` doesn't expire, and can only mint keys for that tag. Join with:
   `tailscale up --authkey="${TS_CLIENT_SECRET}?ephemeral=false&preauthorized=true" --advertise-tags=tag:server --hostname=<instance name>`
3. **Tag-based ACL.** Add `tag:server` (owner `autogroup:admin`). Point the `tag:ci` grant at `tag:server:22` instead of the hard-coded `aweborn-vps` host. Re-tag the **existing** VPS once, by hand: `sudo tailscale up --advertise-tags=tag:server --reset` (or admin console → Edit ACL tags). Tagged nodes don't expire by default, so the "key expiry disabled" requirement goes away.
4. **CI pins the host key.** `deploy.yml` and `backup.yml` set `VPS_KNOWN_HOST` to the current ed25519 host key. A rebuilt server has a new key, and CI must fail closed (correct behaviour). Document the update step, or consider Tailscale SSH later. Don't weaken this to trust-on-first-use.
5. **Hostname collisions.** A second node named `aweborn-vps` becomes `aweborn-vps-1`. Derive `--hostname` from the instance name.
6. **Testing without touching prod.** The stack policy (rightly) blocks replacing the VPS, and the template hard-codes `InstanceName: aweborn-vps` plus the `sync.`/`api.` DNS records. So test the bootstrap snippet on a **throwaway Lightsail instance** (`aws lightsail create-instances … --user-data file://…`, nano bundle). Confirm it appears in the Tailnet tagged `tag:server`, a `tag:ci`-style connection can reach :22, then delete it and remove the node. Never test by replacing `aweborn-vps`.
7. Secrets rule: no automation applies secrets. Alex creates the OAuth client in the Tailscale admin console and stores the secret himself (NoEcho parameter value or SSM).

## Tasks

- `[ ]` Decide the credential delivery (gotcha 1) with Alex
- `[ ]` Tailscale admin (Alex): `tag:server` + OAuth client (`auth_keys` scope, tag `tag:server`); ACL grant `tag:ci` → `tag:server:22`
- `[ ]` Re-tag the existing `aweborn-vps` as `tag:server`; confirm CI deploy + backup still connect (run `backup.yml` by hand)
- `[ ]` UserData: `tailscale up` with the OAuth secret, tags, hostname. Fail the bootstrap loudly if the join fails (it's under `set -euo pipefail`)
- `[ ]` Template parameter (NoEcho) or chosen mechanism; `infra/cfn-preview.sh` already passes NoEcho params as `UsePreviousValue`
- `[ ]` Throwaway-instance test (gotcha 6); record evidence in the log below
- `[ ]` Apply to the `aweborn-vps` stack (in place; preview first, expect `UserData` only, no replacement)
- `[ ]` HANDOFF: update "Tailscale (one-time setup)" + rebuild runbook (host key update step)

## Session Log

| Date | What was done | Next step |
|------|--------------|-----------|
| 2026-10-11 | Task scoped (this file) at the end of the 8A/backups/infra-check session. | Start with gotcha 1 |
