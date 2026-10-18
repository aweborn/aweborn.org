#!/usr/bin/env bash
# One-touch recovery: bring aweborn back from ~/keys + this repo.
#
#   infra/recover.sh --check     # read-only: preflight + what's present/missing
#   infra/recover.sh             # recover (asks before each change)
#
# Safe to run on a healthy system: every step checks first and is skipped when
# things are already fine. Nothing secret is printed or put on a command line.
#
# Steps (CONFIG.md lists every key/parameter used here):
#   0. Preflight: tools, AWS session, Tailscale, every key file in ~/keys.
#   1. Account: GitHub OIDC provider (CI's way into AWS).
#   2. Stacks, in dependency order: aweborn-backups, aweborn-ci, aweborn-mail,
#      aweborn-website, aweborn-vps. Missing ones are created from the repo
#      templates with keys from ~/keys. Existing ones are left alone.
#   3. VPS: rebuild only if you say so (box lost/broken), then restore the
#      world DB from S3 (infra/restore-from-s3.sh, also pins CI's host key).
#   4. Runtime keys -> VPS (infra/set-secret.sh push all).
#   5. GitHub: CI SSH keys (from ~/keys) + role ARN variables (from stacks).
#   6. Verify: key status, public health, stack preview, optional CI runs.
#
# Out of band (can't be scripted; see CONFIG.md -> "Outside the repo"):
#   AWS account + root MFA, Route53 domain registration, SES production access,
#   Google OAuth consent screen, Tailscale tailnet/ACL, Stripe account, GitHub.
set -euo pipefail
drain_tty() { [[ -t 0 ]] || return 0; while read -r -s -t 1 -n 256 _; do :; done; }
cd "$(dirname "$0")/.."

KEYS="${AWEBORN_KEYS_DIR:-$HOME/keys}"
REPO=aweborn/aweborn.org
ZONE=Z077908710IGH7R1XO587
HEALTH=https://sync.aweborn.org/api/auth/methods
CHECK=0; [[ "${1:-}" == --check ]] && CHECK=1

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; WARNINGS=$((WARNINGS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; PROBLEMS=$((PROBLEMS+1)); }
die()  { echo "ERROR: $*" >&2; exit 1; }
ask()  { (( CHECK )) && return 1; drain_tty; read -r -p "  $1 [y/N] " a; [[ "$a" == y || "$a" == Y ]]; }
WARNINGS=0; PROBLEMS=0
stack_exists() { aws cloudformation describe-stacks --stack-name "$1" >/dev/null 2>&1; }
output() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text; }

# ── 0. Preflight ──────────────────────────────────────────────
say "0. Preflight"
for c in aws jq gh ssh tailscale python3; do command -v "$c" >/dev/null && ok "$c" || bad "missing tool: $c"; done
(( PROBLEMS == 0 )) || die "install the missing tools first"
aws sts get-caller-identity >/dev/null 2>&1 && ok "AWS session ($(aws sts get-caller-identity --query Account --output text))" || die "no AWS session: run 'aws login'"
gh auth status >/dev/null 2>&1 && ok "GitHub CLI signed in" || die "run 'gh auth login'"
tailscale status >/dev/null 2>&1 && ok "Tailscale up" || warn "Tailscale is down: VPS steps need it ('tailscale up')"
[[ -d "$KEYS" ]] || die "keys folder not found: $KEYS (mount the Drive, ln -s it to ~/keys)"
ok "keys folder $KEYS"

# file  |  required content prefix (blank = any)  |  what it's for
need_keys=(
  "AWEBORN_BETTER_AUTH_SECRET.txt||sign-in sessions"
  "AWEBORN_GOOGLE_CLIENT_ID.txt||Google sign-in"
  "AWEBORN_GOOGLE_CLIENT_SECRET.txt||Google sign-in"
  "AWEBORN_AWS_ACCESS_KEY_ID.txt|AKIA|SES sending (regenerated if the mail stack is new)"
  "AWEBORN_AWS_SECRET_ACCESS_KEY.txt||SES sending"
  "AWEBORN_MAIL_FORWARD_TO.txt||where hello@/privacy@ land"
  "AWEBORN_STRIPE_SECRET_KEY.txt|sk_|Stripe checkout Lambda"
  "AWEBORN_TAILSCALE_OAUTH_SECRET.txt|tskey-client-|VPS joins the Tailnet"
  "AWEBORN_VPS_ADMIN_SSH_KEY.pem|-----BEGIN|your SSH to the VPS"
  "AWEBORN_VPS_CI_DEPLOY_SSH_KEY|-----BEGIN|deploy.yml -> VPS"
  "AWEBORN_VPS_CI_DEPLOY_SSH_KEY.pub|ssh-ed25519|public half"
  "AWEBORN_VPS_CI_BACKUP_SSH_KEY|-----BEGIN|backup.yml -> VPS"
  "AWEBORN_VPS_CI_BACKUP_SSH_KEY.pub|ssh-ed25519|public half"
)
for row in "${need_keys[@]}"; do
  IFS='|' read -r f prefix why <<<"$row"
  p="$KEYS/$f"
  if [[ ! -s "$p" ]]; then bad "$f missing ($why)"; continue; fi
  if [[ -n "$prefix" ]] && [[ "$(head -c ${#prefix} "$p")" != "$prefix" ]]; then bad "$f doesn't start with $prefix"; continue; fi
  [[ "$(stat -f %Lp "$p" 2>/dev/null || stat -c %a "$p")" == 600 ]] || { chmod 600 "$p"; warn "$f was not 600; fixed"; }
  ok "$f"
done
# The CI public halves in ~/keys must match what the repo installs on the VPS.
for k in DEPLOY BACKUP; do
  pub="$(cut -d' ' -f2 "$KEYS/AWEBORN_VPS_CI_${k}_SSH_KEY.pub" 2>/dev/null || true)"
  [[ -n "$pub" ]] && grep -q "$pub" infra/vps/ci-authorized-keys && ok "CI $k key matches infra/vps/ci-authorized-keys" \
    || bad "CI $k key in ~/keys doesn't match infra/vps/ci-authorized-keys (rotate: HANDOFF -> CI server deploys)"
done
(( PROBLEMS == 0 )) || die "$PROBLEMS key problem(s) above. Fix ~/keys first (CONFIG.md says where each comes from)."

# ── 1. Account-level ──────────────────────────────────────────
say "1. GitHub OIDC provider"
OIDC="arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):oidc-provider/token.actions.githubusercontent.com"
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC" >/dev/null 2>&1; then
  ok "present"
elif ask "Create the GitHub OIDC provider?"; then
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com >/dev/null && ok "created"
else bad "missing (CI can't reach AWS)"; fi

# ── 2. Stacks ─────────────────────────────────────────────────
# Create a stack whose parameters come from a 0600 file (never argv).
create_stack() {  # name template params-json [stack-policy]
  local name=$1 tpl=$2 params=$3 policy=${4:-}
  local w; w="$(mktemp -d)"; chmod 700 "$w"
  ( umask 077; printf '%s' "$params" > "$w/p.json" )
  aws cloudformation create-stack --stack-name "$name" --template-body "file://$tpl" \
    --capabilities CAPABILITY_NAMED_IAM --parameters "file://$w/p.json" \
    ${policy:+--stack-policy-body "file://$policy"} >/dev/null
  rm -rf "$w"
  echo "  creating $name (can take 5-30 min; CloudFront is slowest)..."
  aws cloudformation wait stack-create-complete --stack-name "$name" || die "$name failed: see its Events in the console"
  ok "$name created"
}
keyval() { tr -d '[:space:]' < "$KEYS/$1"; }
pjson() { python3 -c 'import json,sys; a=sys.argv[1:]; print(json.dumps([{"ParameterKey":a[i],"ParameterValue":a[i+1]} for i in range(0,len(a),2)]))' "$@"; }

say "2. CloudFormation stacks"
NEW_MAIL=0; NEW_SITE=0; NEW_VPS=0
for s in aweborn-backups aweborn-ci aweborn-mail aweborn-website aweborn-vps; do
  if stack_exists "$s"; then ok "$s present"; continue; fi
  ask "$s is missing. Create it from the repo template?" || { bad "$s missing"; continue; }
  case $s in
    aweborn-backups) create_stack $s infra/cloudformation-backups.yml '[]' ;;
    aweborn-ci)      create_stack $s infra/cloudformation-ci.yml '[]' ;;
    aweborn-mail)    create_stack $s infra/cloudformation-mail.yml "$(pjson ForwardTo "$(keyval AWEBORN_MAIL_FORWARD_TO.txt)")"; NEW_MAIL=1 ;;
    aweborn-website) # Stripe value goes via a 0600 params file inside python (not argv).
                     create_stack $s infra/cloudformation.yml "$(KEYF="$KEYS/AWEBORN_STRIPE_SECRET_KEY.txt" python3 -c '
import json,os; print(json.dumps([{"ParameterKey":"HostedZoneId","ParameterValue":"'$ZONE'"},
 {"ParameterKey":"StripeSecretKey","ParameterValue":open(os.environ["KEYF"]).read().strip()}]))')"; NEW_SITE=1 ;;
    aweborn-vps)     create_stack $s infra/cloudformation-vps.yml "$(KEYF="$KEYS/AWEBORN_TAILSCALE_OAUTH_SECRET.txt" python3 -c '
import json,os; print(json.dumps([{"ParameterKey":"HostedZoneId","ParameterValue":"'$ZONE'"},
 {"ParameterKey":"TailscaleOAuthSecret","ParameterValue":open(os.environ["KEYF"]).read().strip()}]))')" \
                       infra/cloudformation-vps.stack-policy.json; NEW_VPS=1 ;;
  esac
done
if (( NEW_MAIL )); then
  warn "new mail stack: SES may need production access again (console -> SES -> Account dashboard)"
  ask "Issue fresh SES sending keys into ~/keys and the VPS later? (set-secret.sh ses)" && infra/set-secret.sh ses || true
fi
if (( NEW_SITE )); then
  d="$(output aweborn-website DistributionId)"
  grep -q "$d" .github/workflows/deploy.yml && ok "deploy.yml already uses CloudFront $d" \
    || warn "new CloudFront distribution $d: update it in .github/workflows/deploy.yml + CONFIG.md, push"
fi

# ── 3. VPS ────────────────────────────────────────────────────
say "3. VPS"
RESTORE=$NEW_VPS
if stack_exists aweborn-vps; then
  inst="$(aws cloudformation describe-stacks --stack-name aweborn-vps --query "Stacks[0].Parameters[?ParameterKey=='InstanceName'].ParameterValue" --output text)"
  state="$(aws lightsail get-instance --instance-name "$inst" --query instance.state.name --output text 2>/dev/null || echo missing)"
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$HEALTH" || true)"
  echo "  instance $inst: $state; public health: $code"
  if (( ! NEW_VPS )) && [[ "$state" == running && "$code" == 200 ]]; then
    ok "VPS healthy; no rebuild needed"
  elif (( ! NEW_VPS )); then
    n="${inst##*-}"; [[ "$n" =~ ^[0-9]+$ ]] && next="${inst%-*}-$((n+1))" || next="$inst-2"
    if ask "VPS looks unhealthy. Rebuild it as $next (old disk is DELETED; DB comes back from S3)?"; then
      echo "  First (HANDOFF -> Rebuilding the VPS): if the old box still runs, 'gh workflow run backup.yml';"
      echo "  then DELETE the old 'aweborn-vps' node in Tailscale admin -> Machines, or the new box joins as aweborn-vps-1."
      ask "Done both?" || die "stopped before rebuilding; nothing changed"
      infra/rebuild-vps.sh "$next"; RESTORE=1
    else warn "VPS unhealthy and not rebuilt"; fi
  fi
  if (( RESTORE )) || ask "Restore the world DB from the newest S3 backup anyway?"; then
    (( CHECK )) || infra/restore-from-s3.sh
  fi
fi

# ── 4. Runtime keys -> VPS ───────────────────────────────────
say "4. Runtime keys on the VPS"
# A rebuilt box has new SSH host keys: re-pin ~/.ssh/known_hosts from the
# Lightsail API (AWS-authenticated, so no trust-on-first-use).
if stack_exists aweborn-vps && (( ! CHECK )); then
  inst="$(aws cloudformation describe-stacks --stack-name aweborn-vps --query "Stacks[0].Parameters[?ParameterKey=='InstanceName'].ParameterValue" --output text)"
  hk="$(aws lightsail get-instance-access-details --instance-name "$inst" --protocol ssh --query 'accessDetails.hostKeys[].[algorithm,publicKey]' --output text 2>/dev/null || true)"
  if [[ -n "$hk" ]]; then
    ssh-keygen -R aweborn-vps >/dev/null 2>&1 || true
    awk '{print "aweborn-vps "$1" "$2}' <<<"$hk" >> ~/.ssh/known_hosts
    ok "pinned aweborn-vps host keys from Lightsail"
  fi
fi
status="$(infra/set-secret.sh status 2>&1 || true)"; echo "$status" | sed 's/^/  /'
if grep -qE "differs|missing|placeholder \(REPLACE_ME\) on VPS" <<<"$status"; then
  ask "Push every key from ~/keys to the VPS?" && infra/set-secret.sh push all || warn "VPS keys not in sync"
fi

# ── 5. GitHub ─────────────────────────────────────────────────
say "5. GitHub (secrets + variables)"
have="$(gh secret list -R "$REPO" --json name -q '.[].name')"
for pair in VPS_SSH_KEY:AWEBORN_VPS_CI_DEPLOY_SSH_KEY VPS_BACKUP_SSH_KEY:AWEBORN_VPS_CI_BACKUP_SSH_KEY; do
  sec=${pair%%:*}; file=${pair#*:}
  # GitHub can't show a secret back, so after a rebuild we always offer to re-set it.
  if grep -qx "$sec" <<<"$have" && (( ! RESTORE )); then ok "$sec set"
  elif ask "Set GitHub secret $sec from ~/keys/$file?"; then gh secret set "$sec" -R "$REPO" < "$KEYS/$file" && ok "$sec set"
  else warn "$sec not (re)set"; fi
done
for pair in AWS_BACKUP_ROLE_ARN:aweborn-backups:RoleArn AWS_INFRA_PREVIEW_ROLE_ARN:aweborn-ci:RoleArn; do
  IFS=: read -r var st key <<<"$pair"
  stack_exists "$st" || continue
  want="$(output "$st" "$key")"; cur="$(gh variable get "$var" -R "$REPO" 2>/dev/null || true)"
  if [[ "$cur" == "$want" ]]; then ok "$var"
  elif ask "Set variable $var = $want?"; then gh variable set "$var" -R "$REPO" --body "$want" && ok "$var set"
  else warn "$var is '$cur', stack says '$want'"; fi
done
if stack_exists aweborn-ci; then
  dr="$(output aweborn-ci DeployRoleArn)"
  grep -q "$dr" .github/workflows/deploy.yml && ok "deploy.yml uses $dr" || warn "deploy.yml role != $dr (edit + push)"
fi

# ── 6. Verify ─────────────────────────────────────────────────
say "6. Verify"
code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$HEALTH" || true)"
[[ "$code" == 200 ]] && ok "$HEALTH -> 200" || bad "$HEALTH -> $code"
infra/cfn-preview.sh >/dev/null 2>&1 && ok "all stacks match the repo templates" \
  || warn "stacks differ from templates: run infra/cfn-preview.sh for details"
if ask "Run deploy.yml + backup.yml now to prove CI end to end?"; then
  gh workflow run deploy.yml -R "$REPO" && gh workflow run backup.yml -R "$REPO" && ok "started: gh run list -R $REPO"
fi

say "Done: $PROBLEMS problem(s), $WARNINGS warning(s)"
(( CHECK )) && echo "  (--check: nothing was changed)"
(( PROBLEMS == 0 ))
