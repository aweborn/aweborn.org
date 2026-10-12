# Secrets

Every credential Aweborn uses: what it is, where it lives, and how to set or rotate it. **No values here, ever.** If you add a secret, add a row.

**Source of truth: `~/keys`.** It's a private, backed-up folder outside the repo; override the location with `AWEBORN_KEYS_DIR`. It holds one file per secret, named `AWEBORN_<KEY>.txt`, with permissions 600. Everything else is a copy that can be rebuilt from it.

**Rules**
- Values never go on a command line, in shell history, in the repo, or in a CloudFormation output. Read them hidden or straight from AWS/a file, and pipe them over SSH stdin.
- Secrets reach the VPS **only** through [`infra/set-secret.sh`](infra/set-secret.sh). It's the single entry point, and it refuses unknown keys. It writes the folder first, then the VPS.
- `infra/set-secret.sh status` compares the folder with the VPS by hash (no values printed). After a rebuild, `push all` restores the VPS from the folder.
- Anything you can't get back from its provider (marked **irreplaceable**) must be in the folder.

## Injection points

There are four, and each exists for a reason:

| # | Where | Who reads it | How to set it |
|---|-------|--------------|---------------|
| 1 | **k8s secret `aweborn-secrets`** on the VPS | sync-service, agent-runner pods (env vars) | `infra/set-secret.sh` |
| 2 | **CloudFormation `NoEcho` parameters** | Lambda (Stripe), VPS first boot (Tailscale) | stack update / `infra/set-tailscale-secret.sh` |
| 3 | **GitHub Actions secrets** | CI deploy + backup workflows | `gh secret set NAME` |
| 4 | **Your Mac** | you (SSH, AWS CLI) | files in `~/.ssh`, `aws login` |

## Inventory

| Secret | Store | Used by | Comes from | Rotate | Lose it? |
|--------|-------|---------|------------|--------|----------|
| `BETTER_AUTH_SECRET` | 1 | sync-service (signs sessions) | `openssl rand` (`set-secret.sh generate`) | **Don't**: rotating signs everyone out and anonymous players lose their identity | **Irreplaceable.** It's in the keys folder (verified in sync 2026-10-12). DR step 8 needs it |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 1 | sync-service (Sign in with Google) | Google Cloud Console → project `aweborn` → Credentials | New secret in the console → `set-secret.sh google <json>` → delete the JSON | Re-download from the console |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | 1 | sync-service (sends sign-in codes via SES) | IAM user `aweborn-mail-sender` (stack `aweborn-mail`), send-as `hello@aweborn.org` only | `set-secret.sh ses` (new key in, old keys deleted) | Make a new one |
| `LLM_API_KEY` | 1 | agent-runner | LLM provider dashboard | `set-secret.sh set LLM_API_KEY` | Placeholder today (agents unused) |
| `StripeSecretKey` | 2 (`aweborn-website`) | Stripe Checkout Lambda (deliberately kept apart from the VPS) | Stripe dashboard → Developers → API keys | Roll in Stripe → stack update with the new value | Roll a new one in Stripe |
| `TailscaleOAuthSecret` | 2 (`aweborn-vps`) | VPS first boot only (joins the Tailnet) | Tailscale admin → OAuth clients (scope `auth_keys`, tag `tag:server`) | `infra/set-tailscale-secret.sh` | Create a new OAuth client |
| `VPS_SSH_KEY` | 3 | `deploy.yml` (forced-command deploy key) | `ssh-keygen`; public half in `infra/vps/ci-authorized-keys` | New keypair → update both halves | Regenerate |
| `VPS_BACKUP_SSH_KEY` | 3 | `backup.yml` (read-only, forced-command) | same as above | same as above | Regenerate |
| `lightsail-default.pem` | 4 (`~/.ssh`) | you → `ssh ubuntu@aweborn-vps` | Lightsail console → Account → SSH keys | Download again / new default key | Re-download (Tailscale SSH also works) |
| AWS CLI session | 4 (`aws login`) | you → every `aws` / `infra/*.sh` command | AWS console sign-in | Expires on its own | Sign in again |

**Not secrets** (fine in the repo or as plain CI values): `VITE_STRIPE_PUBLISHABLE_KEY` (`.env*`), role ARNs (`AWS_ROLE_ARN`, `AWS_BACKUP_ROLE_ARN`, `AWS_INFRA_PREVIEW_ROLE_ARN`), `CLOUDFRONT_DISTRIBUTION_ID`, `AWS_REGION`, `TS_OAUTH_CLIENT_ID` + `TS_AUDIENCE` (Tailscale workload identity: CI proves who it is with a GitHub OIDC token, no stored secret), `VPS_KNOWN_HOST`. CI reaches AWS through OIDC roles, so there are **no AWS keys in GitHub**.

**Private but not secret:** `ForwardTo` (stack `aweborn-mail`) is your personal inbox. It's a deploy parameter so it stays out of this public repo.

## Local dev

No real secrets are needed. sync-service falls back to Better Auth's built-in dev secret, prints emails to the console, and `DEV_FIXED_OTP=424242` pins sign-in codes. Google sign-in is hidden unless you export a dev OAuth client.
