#!/usr/bin/env bash
# Rebuild the VPS: replace the Lightsail instance with a fresh one built from
# infra/cloudformation-vps.yml, keeping the static IP (so DNS doesn't change)
# and the Tailnet name (so CI and SSH keep targeting `aweborn-vps`).
#
#   infra/rebuild-vps.sh <new-instance-name>        e.g. aweborn-vps-2
#
# CloudFormation can't replace a named resource under the same name, so the
# new instance needs a new InstanceName. The stack policy normally forbids
# replacing VPSInstance; this script lifts that for ONE update with
# infra/cloudformation-vps.rebuild-policy.json (the static IP stays protected).
#
# Everything on the OLD box's disk is DELETED when the update finishes,
# including the world DB and its on-box snapshots. Restore comes from S3
# (HANDOFF -> Backups). If the old box still runs, take a fresh off-box backup
# first: gh workflow run backup.yml
#
# Full runbook incl. what to do after: HANDOFF -> Rebuilding the VPS.
set -euo pipefail
# Discard keys typed while we waited (a stray Enter used to answer the next
# prompt with "" and silently decline; DR drill 2026-10-11).
drain_tty() { [[ -t 0 ]] || return 0; while read -r -s -t 1 -n 256 _; do :; done; }
cd "$(dirname "$0")/.."

STACK=aweborn-vps
TPL=infra/cloudformation-vps.yml
POLICY=infra/cloudformation-vps.rebuild-policy.json
NEW="${1:-}"
[[ "$NEW" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || { echo "usage: $0 <new-instance-name>  (e.g. aweborn-vps-2)" >&2; exit 1; }

params="$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Parameters' --output json)"
OLD="$(jq -r 'map(select(.ParameterKey=="InstanceName"))[0].ParameterValue // "aweborn-vps"' <<<"$params")"
TSNAME="$(jq -r 'map(select(.ParameterKey=="TailnetHostname"))[0].ParameterValue // "aweborn-vps"' <<<"$params")"
[[ "$NEW" != "$OLD" ]] || { echo "New name must differ from the current one ($OLD)." >&2; exit 1; }
if aws lightsail get-instance --instance-name "$NEW" >/dev/null 2>&1; then
  echo "An instance named $NEW already exists." >&2; exit 1
fi
# (TailscaleOAuthSecret is NoEcho, so it always reads back as ****; if it's
# missing, the new box's bootstrap stops with a loud error instead.)

# Keep every deployed parameter; change only InstanceName.
tpl_params="$(aws cloudformation get-template-summary --template-body "file://$TPL" --query 'Parameters[].ParameterKey' --output text)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
NEW="$NEW" PARAMS="$params" TPL_PARAMS="$tpl_params" python3 - > "$WORK/params.json" <<'PY'
import json, os
deployed = {p["ParameterKey"] for p in json.loads(os.environ["PARAMS"])}
out = [{"ParameterKey": "InstanceName", "ParameterValue": os.environ["NEW"]}]
out += [{"ParameterKey": k, "UsePreviousValue": True}
        for k in os.environ["TPL_PARAMS"].split() if k in deployed and k != "InstanceName"]
print(json.dumps(out))
PY

# Preview (change sets ignore stack policy, so this shows the real plan).
CS="rebuild-preview-$(date +%s)"
aws cloudformation create-change-set --stack-name "$STACK" --change-set-name "$CS" \
  --change-set-type UPDATE --template-body "file://$TPL" --capabilities CAPABILITY_NAMED_IAM \
  --parameters "file://$WORK/params.json" >/dev/null
aws cloudformation wait change-set-create-complete --stack-name "$STACK" --change-set-name "$CS" 2>/dev/null || true
desc="$(aws cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$CS" --output json)"
aws cloudformation delete-change-set --stack-name "$STACK" --change-set-name "$CS" >/dev/null || true
[[ "$(jq -r .Status <<<"$desc")" != FAILED ]] || { echo "Change set failed: $(jq -r .StatusReason <<<"$desc")" >&2; exit 1; }

echo "Plan for $STACK ($OLD -> $NEW, Tailnet name stays $TSNAME):"
jq -r '.Changes[].ResourceChange | "  \(.Action) \(.LogicalResourceId) replacement=\(.Replacement // "-")"' <<<"$desc"
# Only VPSInstance (and the IMDS custom resource that follows it) may be
# replaced; nothing may be removed.
bad="$(jq -r '[.Changes[].ResourceChange | select(.Action == "Remove" or ((.Replacement == "True" or .Replacement == "Conditional") and (.LogicalResourceId | IN("VPSInstance", "ImdsHardening") | not))) | .LogicalResourceId] | join(", ")' <<<"$desc")"
[[ -z "$bad" ]] || { echo "REFUSING: would also replace/remove: $bad" >&2; exit 2; }

cat <<EOF

Before you continue:
  1. Delete the old '$TSNAME' node in the Tailscale admin console (Machines),
     or the new box joins as '$TSNAME-1' and CI can't find it.
  2. Everything on $OLD's disk will be DELETED (world DB, on-box snapshots).
     Latest off-box backup:
EOF
bucket="aweborn-backups-$(aws sts get-caller-identity --query Account --output text)"
aws s3 ls "s3://$bucket/sync/" --recursive 2>/dev/null | grep '\.db\.gz$' | tail -1 | sed 's/^/       /' || echo "       (could not list $bucket)"
echo
drain_tty; read -r -p "Type the OLD instance name ($OLD) to rebuild: " ok
[[ "$ok" == "$OLD" ]] || { echo "Not confirmed; nothing changed."; exit 0; }

aws cloudformation update-stack --stack-name "$STACK" --template-body "file://$TPL" \
  --capabilities CAPABILITY_NAMED_IAM --parameters "file://$WORK/params.json" \
  --stack-policy-during-update-body "file://$POLICY" >/dev/null
echo "Updating (new instance, static IP moves, then $OLD is deleted)..."
aws cloudformation wait stack-update-complete --stack-name "$STACK"
echo
echo "Stack updated. $NEW is bootstrapping (~10-15 min); it joins the Tailnet as $TSNAME."
echo "Next: HANDOFF -> Rebuilding the VPS -> 'After the box is up' (host key pin, secrets, DB restore)."
