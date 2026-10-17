# Configuration catalog

Every **secret**, **key** and **parameter** Aweborn depends on: what it is, where it lives, and how to set or rotate it. **No secret values here, ever.** When you add one, add a row (rule in [MASTER_PLAN → Infrastructure Strategy](MASTER_PLAN.md#infrastructure-strategy)).

## The two kinds

| | **Parameters** | **Keys** (secrets, credentials, anything private) |
|---|---|---|
| What | Anything fine to publish: region, hosted-zone ID, role ARNs, distribution IDs, bucket names, ports, domains, model names | Anything that grants access *or* is private: API keys, OAuth client secrets, signing secrets, private SSH keys, access keys, personal email addresses |
| Source of truth | **Plaintext in the repo that uses it** (template `Default:`, manifest `value:`, workflow file, `.env*`) | **`~/keys`**: a private, backed-up folder outside every repo (override with `AWEBORN_KEYS_DIR`). Files are `AWEBORN_<KEY>.txt` (or a descriptive name), permissions 600 |
| Deployed to | Wherever it's read; it ships with the code | Its runtime spot (k8s secret, CloudFormation `NoEcho` or deploy-time parameter, GitHub secret, Lambda), always **read from `~/keys`**, never typed fresh |
| Rule | Don't hide it. Hidden parameters (e.g. in GitHub *secrets*) just make rebuilds harder | Never on a command line, in shell history, in a repo, or in a CloudFormation output. Pipe it over stdin |

**Goal: one-touch recovery.** Mount `~/keys`, run the provisioning scripts, and everything comes back. If something needs a value found neither in the repo nor in `~/keys`, that's a gap: add it to one of them.

**The one touch:** `infra/recover.sh`. Run `infra/recover.sh --check` any time (read-only) to prove recovery would work today. It checks every key file below, then creates any missing stack from its template (keys from `~/keys`), rebuilds/restores the VPS if you say so, pushes runtime keys, and re-sets GitHub secrets/variables. It asks before each change and skips whatever is already fine.

## Keys

The runtime spots:

| # | Where | Who reads it | How to set it |
|---|-------|--------------|---------------|
| 1 | **k8s secret `aweborn-secrets`** on the VPS | sync-service, agent-runner pods (env vars) | [`infra/set-secret.sh`](infra/set-secret.sh) (`status` hashes `~/keys` vs VPS, `push all` restores after a rebuild) |
| 2 | **CloudFormation `NoEcho` parameters** | Lambda (Stripe), VPS first boot (Tailscale) | `infra/set-stack-key.sh stripe` / `tailscale` (reads `~/keys`) |
| 3 | **GitHub Actions secrets** | CI deploy + backup workflows | `gh secret set NAME < ~/keys/<file>` |
| 4 | **Your Mac** | you (SSH, AWS CLI) | `~/.ssh`, `aws login` |

| Secret | Spot | Used by | Comes from | Rotate | Lose it? |
|--------|------|---------|------------|--------|----------|
| `BETTER_AUTH_SECRET` | 1 | sync-service (signs sessions) | `openssl rand` (`set-secret.sh generate`) | **Don't**: rotating signs everyone out and anonymous players lose their identity | **Irreplaceable.** In `~/keys` (verified in sync 2026-10-12). DR step 8 needs it |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 1 | sync-service (Sign in with Google) | Google Cloud Console → project `aweborn` → Credentials | New secret in the console → `set-secret.sh google <json>` → delete the JSON | Re-download from the console |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | 1 | sync-service (sends sign-in codes via SES) | IAM user `aweborn-mail-sender` (stack `aweborn-mail`), send-as `hello@aweborn.org` only | `set-secret.sh ses` (new key in, old keys deleted) | Make a new one |
| `MANA_ADMIN_TOKEN` | 1 | sync-service (mana ledger admin API: `POST /api/mana/inflow` / `draw`; later the donation Lambda) | `openssl rand` (`set-secret.sh generate MANA_ADMIN_TOKEN`) | `set-secret.sh set MANA_ADMIN_TOKEN` (harmless: nothing else depends on the value) | Generate a new one |
| `MANA_INFLOW_TOKEN` | 1 **and** 2 (`aweborn-website` → `ManaInflowToken`) | sync-service checks it; the Stripe webhook Lambda sends it. Can only record gifts (`source: gift`, with a ref), never draws | `set-secret.sh generate MANA_INFLOW_TOKEN`, then `infra/set-stack-key.sh mana-inflow` | Same two commands with `set` (VPS) then `mana-inflow` (Lambda); gifts fail (Stripe retries for 3 days) while they differ | Generate a new one |
| `AWEBORN_STRIPE_WEBHOOK_SECRET.txt` → `StripeWebhookSecret` | 2 (`aweborn-website`) | Stripe webhook Lambda (verifies each event really came from Stripe) | `infra/stripe-webhook.sh create` (or Stripe dashboard → Developers → Webhooks → signing secret) | Roll in the dashboard → save to `~/keys` → `infra/set-stack-key.sh stripe-webhook` | Roll in the dashboard |
| `LLM_API_KEY` | 1 | agent-runner | LLM provider dashboard | `set-secret.sh set LLM_API_KEY` | Placeholder today (agents unused) |
| `AWEBORN_STRIPE_SECRET_KEY.txt` → `StripeSecretKey` | 2 (`aweborn-website`) | Stripe Checkout Lambda (deliberately kept apart from the VPS) | Stripe dashboard → Developers → API keys | Roll in Stripe → save to `~/keys` → `infra/set-stack-key.sh stripe` | Roll a new one in Stripe |
| `AWEBORN_TAILSCALE_OAUTH_SECRET.txt` → `TailscaleOAuthSecret` | 2 (`aweborn-vps`) | VPS first boot only (joins the Tailnet) | Tailscale admin → OAuth clients (scope `auth_keys`, tag `tag:server`) | New client → save to `~/keys` → `infra/set-stack-key.sh tailscale` | Create a new OAuth client |
| `AWEBORN_VPS_CI_DEPLOY_SSH_KEY` → GitHub `VPS_SSH_KEY` | 3 | `deploy.yml` (forced-command deploy key) | `ssh-keygen`; public half in `infra/vps/ci-authorized-keys` | New keypair in `~/keys` → update public line → install on VPS → `gh secret set` | Regenerate (`.pub` next to it) |
| `AWEBORN_VPS_CI_BACKUP_SSH_KEY` → GitHub `VPS_BACKUP_SSH_KEY` | 3 | `backup.yml` (read-only, forced-command) | same as above | same as above | Regenerate |
| `AWEBORN_VPS_ADMIN_SSH_KEY.pem` (Lightsail default key; copy also at `~/.ssh/lightsail-default.pem`) | 4 (`~/keys`, used by `set-secret.sh`) | you → `ssh ubuntu@aweborn-vps` | Lightsail console → Account → SSH keys | Download again / new default key | Re-download (Tailscale SSH also works) |
| AWS CLI session | 4 (`aws login`) | you → every `aws` / `infra/*.sh` command | AWS console sign-in | Expires on its own | Sign in again |
| `AWEBORN_MAIL_FORWARD_TO` | 2 (`aweborn-mail` param `ForwardTo`) | mail forwarder (where hello@/privacy@ land) | your inbox | Edit the file, redeploy the stack with `ForwardTo="$(cat ~/keys/AWEBORN_MAIL_FORWARD_TO.txt)"` | Private, not secret |

CI reaches AWS through OIDC roles, so there are **no AWS keys in GitHub**. Tailscale in CI uses workload identity, so there's no stored Tailscale secret either.

## Parameters

| Parameter | Value / where it lives | Used by |
|-----------|------------------------|---------|
| AWS account / region | `111551045759` / `us-east-1` (template defaults, manifests) | everything |
| Route53 hosted zone | `Z077908710IGH7R1XO587`: `Default:` in `cloudformation-*.yml` | website, mail, CI stacks |
| GitHub OIDC subject | `repo:aweborn@261697435/aweborn.org@1329275111:ref:refs/heads/main`: `Default:` in `cloudformation-backups.yml`, `-ci.yml` | AWS role trust |
| Mail domain / recipients | `aweborn.org`; `hello@`, `privacy@`; sender `Aweborn <hello@aweborn.org>` (`email.ts`, `MAIL_FROM` override) | `aweborn-mail`, sync-service |
| VPS | bundle `small_3_0`, AZ `us-east-1a`, Tailnet name `aweborn-vps`: `cloudformation-vps.yml` | VPS stack, CI, SSH |
| Service env | `PORT`, `HOST`, `DB_PATH`, `NODE_ENV`, `BETTER_AUTH_URL`, `AWS_REGION`, `LLM_MODEL`, `LLM_API_URL`, backup `KEEP_*`: `value:` in `infra/k3s/*-deployment.yaml` | pods |
| Frontend | `VITE_SYNC_URL`, `VITE_API_ENDPOINT`, `VITE_STRIPE_PUBLISHABLE_KEY` (publishable, safe): `.env`, `.env.production` | Vite build |
| CI role ARNs | `AWS_BACKUP_ROLE_ARN`, `AWS_INFRA_PREVIEW_ROLE_ARN`: GitHub repo **variables**; `VPS_KNOWN_HOST` pin: variable | workflows |
| Deploy role / region / CDN | `arn:aws:iam::111551045759:role/aweborn-github-deploy`, `us-east-1`, CloudFront `E3Q49I3A6Q6RH`: plaintext in `deploy.yml`, `backup.yml` | workflows |
| Tailscale CI identity | client ID `THpqTuVanZ11CNTRL-kGb9s6ts1211CNTRL`, audience `api.tailscale.com/<client ID>`, tag `tag:ci`: plaintext in `deploy.yml`, `backup.yml` | workflows |

## Outside the repo (accounts; can't be scripted)

These are the accounts everything runs in. Their sign-ins live in your password manager / `~/keys`, not here. `recover.sh` assumes they exist.

| Account / setting | Why it matters | If lost |
|---|---|---|
| AWS account `111551045759` + root MFA | everything in AWS | AWS account recovery |
| Route53 domain `aweborn.org` (registration + hosted zone `Z077908710IGH7R1XO587`) | DNS; zone ID is a parameter in the templates | new zone → update the `HostedZoneId` defaults |
| SES production access (us-east-1) | sign-in codes to any inbox | re-request in the SES console (took ~1 day) |
| Google Cloud OAuth consent screen + client | Google sign-in (`AWEBORN_GOOGLE_CLIENT_*`) | recreate client → save to `~/keys` → `set-secret.sh push all` |
| Tailscale tailnet: ACL (`tag:ci` → `tag:server:22`), CI workload-identity credential, server OAuth client | CI + SSH reach the VPS | recreate → update the client ID in workflows / `AWEBORN_TAILSCALE_OAUTH_SECRET.txt` |
| Stripe account | donations (`AWEBORN_STRIPE_SECRET_KEY.txt`, publishable key in `.env.production`) | roll keys in the dashboard |
| GitHub org `aweborn` + repo | code, CI; OIDC subject uses numeric IDs | a new repo gets new IDs → update `GitHubSubject` defaults |
| GitHub OIDC provider in AWS | CI → AWS (shared with other repos) | `recover.sh` recreates it |

## Local dev

No real secrets are needed. sync-service falls back to Better Auth's built-in dev secret, prints emails to the console, and `DEV_FIXED_OTP=424242` pins sign-in codes. Google sign-in is hidden unless you export a dev OAuth client.
