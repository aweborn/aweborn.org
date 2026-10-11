#!/usr/bin/env bash
# Set (or rotate) the Tailscale OAuth secret on the aweborn-vps stack.
#
# The secret is read hidden (no echo, no shell history) and handed to AWS via
# a 0600 temp file, never on a command line. It builds a change set from the
# repo template, shows it, and only executes after you type "apply".
#
# This only changes the stored parameter / rendered UserData. The running box
# does NOT re-run UserData; the secret is used the next time a server is built.
#
# Usage: infra/set-tailscale-secret.sh
# Rotate: revoke the old OAuth client in the Tailscale admin console, create a
#         new one (scope auth_keys, tag tag:server), run this again.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK=aweborn-vps
TPL=infra/cloudformation-vps.yml

read -r -s -p "Tailscale OAuth client secret (tskey-client-..., hidden): " TS_SECRET; echo
case "$TS_SECRET" in tskey-client-*) ;; *) echo "Not a tskey-client-... secret." >&2; exit 1 ;; esac

WORK="$(mktemp -d)"; chmod 700 "$WORK"
CS="ts-secret-$(date +%s)"
cleanup() {
  rm -rf "$WORK"
  aws cloudformation delete-change-set --stack-name "$STACK" --change-set-name "$CS" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Every other parameter keeps its deployed value; new ones use template defaults.
deployed="$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Parameters[].ParameterKey' --output text)"
tpl_params="$(aws cloudformation get-template-summary --template-body "file://$TPL" --query 'Parameters[].ParameterKey' --output text)"
TS_SECRET="$TS_SECRET" DEPLOYED="$deployed" TPL_PARAMS="$tpl_params" python3 - > "$WORK/params.json" <<'PY'
import json, os
deployed = set(os.environ["DEPLOYED"].split())
out = [{"ParameterKey": "TailscaleOAuthSecret", "ParameterValue": os.environ["TS_SECRET"]}]
out += [{"ParameterKey": p, "UsePreviousValue": True}
        for p in os.environ["TPL_PARAMS"].split() if p in deployed and p != "TailscaleOAuthSecret"]
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
read -r -p 'Type "apply" to execute: ' ok
[[ "$ok" == apply ]] || { echo "Not applied."; exit 0; }

aws cloudformation execute-change-set --stack-name "$STACK" --change-set-name "$CS"
echo "Waiting for the update to finish..."
aws cloudformation wait stack-update-complete --stack-name "$STACK"
trap - EXIT; rm -rf "$WORK"
echo "Done. Secret stored (NoEcho). Run infra/cfn-preview.sh $STACK to confirm in sync."
