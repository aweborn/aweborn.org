#!/usr/bin/env bash
# Deploy a NoEcho CloudFormation key from ~/keys to its stack.
#
#   infra/set-stack-key.sh tailscale  -> aweborn-vps     TailscaleOAuthSecret <- AWEBORN_TAILSCALE_OAUTH_SECRET.txt
#   infra/set-stack-key.sh stripe     -> aweborn-website StripeSecretKey      <- AWEBORN_STRIPE_SECRET_KEY.txt
#
# The secret is read from ~/keys (or hidden (no echo, no shell history) and handed to AWS via
# a 0600 temp file, never on a command line. It builds a change set from the
# repo template, shows it, and only executes after you type "apply".
#
# tailscale: only changes the stored parameter / rendered UserData. The running
# box does NOT re-run UserData; the secret is used the next time a server is built.
# Rotate: revoke the old OAuth client in the Tailscale admin console, create a
#         new one (scope auth_keys, tag tag:server), save it to ~/keys, run this.
# stripe: updates the checkout Lambda's env. Rotate in the Stripe dashboard,
#         save to ~/keys, run this.
set -euo pipefail
# Discard keys typed while we waited (a stray Enter used to answer the next
# prompt with "" and silently decline; DR drill 2026-10-11).
drain_tty() { [[ -t 0 ]] || return 0; while read -r -s -t 1 -n 256 _; do :; done; }
cd "$(dirname "$0")/.."

case "${1:-}" in
  tailscale) STACK=aweborn-vps;     TPL=infra/cloudformation-vps.yml; PARAM=TailscaleOAuthSecret; FILE=AWEBORN_TAILSCALE_OAUTH_SECRET.txt; PREFIX='tskey-client-*' ;;
  stripe)    STACK=aweborn-website; TPL=infra/cloudformation.yml;     PARAM=StripeSecretKey;      FILE=AWEBORN_STRIPE_SECRET_KEY.txt;      PREFIX='[sr]k_*' ;;
  *) echo "usage: $0 tailscale|stripe" >&2; exit 1 ;;
esac

KEY_FILE="${AWEBORN_KEYS_DIR:-$HOME/keys}/$FILE"
if [[ -f "$KEY_FILE" ]]; then
  TS_SECRET="$(tr -d '[:space:]' < "$KEY_FILE")"; echo "Using $KEY_FILE"
else
  echo "No $KEY_FILE; save the secret there first (source of truth), or paste it now."
  read -r -s -p "$PARAM (hidden): " TS_SECRET; echo
fi
# shellcheck disable=SC2254
case "$TS_SECRET" in $PREFIX) ;; *) echo "Doesn't look like a $PARAM ($PREFIX)." >&2; exit 1 ;; esac

WORK="$(mktemp -d)"; chmod 700 "$WORK"
CS="key-$1-$(date +%s)"
cleanup() {
  rm -rf "$WORK"
  aws cloudformation delete-change-set --stack-name "$STACK" --change-set-name "$CS" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Every other parameter keeps its deployed value; new ones use template defaults.
deployed="$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Parameters[].ParameterKey' --output text)"
tpl_params="$(aws cloudformation get-template-summary --template-body "file://$TPL" --query 'Parameters[].ParameterKey' --output text)"
PARAM="$PARAM" TS_SECRET="$TS_SECRET" DEPLOYED="$deployed" TPL_PARAMS="$tpl_params" python3 - > "$WORK/params.json" <<'PY'
import json, os
deployed = set(os.environ["DEPLOYED"].split())
out = [{"ParameterKey": os.environ["PARAM"], "ParameterValue": os.environ["TS_SECRET"]}]
out += [{"ParameterKey": p, "UsePreviousValue": True}
        for p in os.environ["TPL_PARAMS"].split() if p in deployed and p != os.environ["PARAM"]]
print(json.dumps(out))
PY
unset TS_SECRET

aws cloudformation create-change-set --stack-name "$STACK" --change-set-name "$CS" \
  --change-set-type UPDATE --template-body "file://$TPL" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters "file://$WORK/params.json" >/dev/null
rm -f "$WORK/params.json"
aws cloudformation wait change-set-create-complete --stack-name "$STACK" --change-set-name "$CS" 2>/dev/null || true

desc="$(aws cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$CS" --output json)"
if [[ "$(jq -r .Status <<<"$desc")" == FAILED ]]; then
  echo "Change set failed: $(jq -r .StatusReason <<<"$desc")" >&2; exit 1
fi
echo
echo "Pending changes to $STACK:"
jq -r '.Changes[].ResourceChange | "  \(.Action) \(.LogicalResourceId) (\(.ResourceType)) replacement=\(.Replacement // "-")"' <<<"$desc"
if jq -e '[.Changes[].ResourceChange | select(.Replacement == "True" or .Replacement == "Conditional" or .Action == "Remove")] | length > 0' <<<"$desc" >/dev/null; then
  echo "REFUSING: this would replace or remove a resource. Investigate first." >&2; exit 2
fi
echo
drain_tty; read -r -p 'Type "apply" to execute: ' ok
[[ "$ok" == apply ]] || { echo "Not applied."; exit 0; }

aws cloudformation execute-change-set --stack-name "$STACK" --change-set-name "$CS"
echo "Waiting for the update to finish..."
aws cloudformation wait stack-update-complete --stack-name "$STACK"
trap - EXIT; rm -rf "$WORK"
echo "Done. Secret stored (NoEcho). Run infra/cfn-preview.sh $STACK to confirm in sync."
