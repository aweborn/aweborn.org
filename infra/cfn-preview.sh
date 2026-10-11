#!/usr/bin/env bash
# CloudFormation preview + drift check: READ-ONLY, never applies anything.
#
# For each stack: validate the repo template, create a change set against the
# deployed stack (repo vs deployed), print what would change, then DELETE the
# change set. Optionally detect drift (deployed vs reality, i.e. console or CLI
# edits made outside CloudFormation).
#
#   infra/cfn-preview.sh                       # all stacks, changes only
#   infra/cfn-preview.sh --drift               # + drift detection
#   infra/cfn-preview.sh aweborn-vps --drift   # one stack
#
# Writes a markdown report to $GITHUB_STEP_SUMMARY (if set) and to stdout.
# Exit codes: 0 = in sync; 1 = error / invalid template; 2 = pending changes
# that REPLACE a resource or drift found (needs attention); 3 = pending changes
# (safe, in-place) the repo has that the deployed stack doesn't.
#
# Applying stays manual and deliberate (see HANDOFF.md → Infrastructure stacks).
# Secret parameters (NoEcho) are passed as UsePreviousValue and never printed;
# drift output lists property PATHS only, never values.
set -euo pipefail
cd "$(dirname "$0")/.."

# stack name → template (the repo is the source of truth for each).
# (A function, not an associative array: macOS still ships bash 3.2.)
template_for() {
  case "$1" in
    aweborn-website) echo infra/cloudformation.yml ;;
    aweborn-vps)     echo infra/cloudformation-vps.yml ;;
    aweborn-backups) echo infra/cloudformation-backups.yml ;;
    aweborn-ci)      echo infra/cloudformation-ci.yml ;;
    *) return 1 ;;
  esac
}
ORDER=(aweborn-website aweborn-vps aweborn-backups aweborn-ci)

DRIFT=0; STACKS=()
for a in "$@"; do
  case "$a" in
    --drift) DRIFT=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) template_for "$a" >/dev/null || { echo "unknown stack: $a" >&2; exit 1; }; STACKS+=("$a") ;;
  esac
done
(( ${#STACKS[@]} )) || STACKS=("${ORDER[@]}")

REPORT="$(mktemp)"
out() { printf '%s\n' "$*" >> "$REPORT"; }
worst=0
bump() { # severity order: 1 (error) > 2 (attention) > 3 (pending) > 0
  local s=$1
  if (( s == 1 )) || (( worst == 0 )) || (( worst == 3 && s == 2 )); then
    (( worst == 1 )) || worst=$s
  fi
}

SHA="$(git rev-parse --short=7 HEAD 2>/dev/null || echo local)"
out "## CloudFormation: repo vs deployed (\`$SHA\`)"
out ""

for stack in "${STACKS[@]}"; do
  tpl="$(template_for "$stack")"
  out "### \`$stack\` ← \`$tpl\`"

  if ! aws cloudformation validate-template --template-body "file://$tpl" >/dev/null 2>"$REPORT.err"; then
    out "❌ **Invalid template:** $(tr '\n' ' ' < "$REPORT.err")"; out ""; bump 1; continue
  fi

  if ! deployed="$(aws cloudformation describe-stacks --stack-name "$stack" --output json 2>/dev/null)"; then
    out "⚠️ Stack not deployed yet. Create it by hand (see HANDOFF)."; out ""; bump 3; continue
  fi

  # Reuse every deployed parameter value (incl. NoEcho secrets, which we never
  # see); parameters new in the template fall back to their defaults.
  tpl_params="$(aws cloudformation get-template-summary --template-body "file://$tpl" \
    --query 'Parameters[].ParameterKey' --output text)"
  params=()
  for p in $tpl_params; do
    if jq -e --arg p "$p" '.Stacks[0].Parameters // [] | any(.ParameterKey == $p)' <<<"$deployed" >/dev/null; then
      params+=("ParameterKey=$p,UsePreviousValue=true")
    fi
  done

  cs="preview-$SHA-$(date +%s)"
  aws cloudformation create-change-set --stack-name "$stack" --change-set-name "$cs" \
    --change-set-type UPDATE --template-body "file://$tpl" \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
    ${params[@]+--parameters "${params[@]}"} >/dev/null
  # `wait` exits non-zero when the change set FAILED (incl. "no changes"); inspect below.
  aws cloudformation wait change-set-create-complete --stack-name "$stack" --change-set-name "$cs" 2>/dev/null || true
  desc="$(aws cloudformation describe-change-set --stack-name "$stack" --change-set-name "$cs" --output json)"
  aws cloudformation delete-change-set --stack-name "$stack" --change-set-name "$cs" >/dev/null || true

  status="$(jq -r .Status <<<"$desc")"
  reason="$(jq -r '.StatusReason // ""' <<<"$desc")"
  if [[ "$status" == "FAILED" ]]; then
    if [[ "$reason" == *"didn't contain changes"* || "$reason" == *"No updates are to be performed"* ]]; then
      out "✅ In sync: the deployed stack matches the repo template."
    else
      out "❌ **Change set failed:** $reason"; bump 1
    fi
  else
    n="$(jq '.Changes | length' <<<"$desc")"
    repl="$(jq '[.Changes[].ResourceChange | select(.Replacement == "True" or .Replacement == "Conditional" or .Action == "Remove")] | length' <<<"$desc")"
    if (( repl > 0 )); then
      out "🛑 **$n pending change(s), $repl of them REPLACE or REMOVE a resource.** Review carefully before applying; replacement destroys the old resource."
      bump 2
    else
      out "🟡 **$n pending change(s)** in the repo that are not deployed (in-place, no replacement)."
      bump 3
    fi
    out ""
    out "| Action | Resource | Type | Replacement | Changed |"
    out "|---|---|---|---|---|"
    jq -r '.Changes[].ResourceChange |
      "| \(.Action) | `\(.LogicalResourceId)` | \(.ResourceType) | \(.Replacement // "-") | \(
        [.Details[]?.Target | select(.Attribute != null) |
          (if .Name then "\(.Attribute).\(.Name)" else .Attribute end)] | unique | join(", ")) |"' <<<"$desc" >> "$REPORT"
    out ""
    out "Apply (deliberately, after reading the above): see HANDOFF → Infrastructure stacks."
  fi

  if (( DRIFT )); then
    id="$(aws cloudformation detect-stack-drift --stack-name "$stack" --query StackDriftDetectionId --output text)"
    for _ in $(seq 1 60); do
      d="$(aws cloudformation describe-stack-drift-detection-status --stack-drift-detection-id "$id" --output json)"
      [[ "$(jq -r .DetectionStatus <<<"$d")" == "DETECTION_IN_PROGRESS" ]] || break
      sleep 5
    done
    dstatus="$(jq -r .StackDriftStatus <<<"$d")"
    dnote="$(jq -r '.DetectionStatusReason // ""' <<<"$d")"
    drifts="$(aws cloudformation describe-stack-resource-drifts --stack-name "$stack" \
      --stack-resource-drift-status-filters MODIFIED DELETED --output json |
      jq -r '.StackResourceDrifts[] |
        "- `\(.LogicalResourceId)` (\(.ResourceType)): \(.StackResourceDriftStatus)\(
          if (.PropertyDifferences // []) | length > 0
          then " → " + ([.PropertyDifferences[] | "`\(.PropertyPath)` \(.DifferenceType)"] | join(", "))
          else "" end)"')"
    if [[ -n "$drifts" ]]; then
      out "🛑 **Drift:** live resources were changed outside CloudFormation. Put the change in the repo template (or revert it) so the repo stays the truth."
      out ""
      out "$drifts"
      bump 2
    elif [[ "$dstatus" == "IN_SYNC" ]]; then
      out "✅ No drift: live resources match the deployed stack."
    else
      out "✅ No drift found in the resources that could be checked."
    fi
    # Partial detection is expected for resources the read-only role may not
    # read (the Stripe Lambda: its config holds the secret key).
    if [[ "$(jq -r .DetectionStatus <<<"$d")" != "DETECTION_COMPLETE" && -n "$dnote" ]]; then
      out ""
      out "<sub>Partial check: ${dnote:0:300}</sub>"
    fi
  fi
  out ""
done

case $worst in
  0) out "**Result:** everything in sync." ;;
  3) out "**Result:** the repo has undeployed infra changes (safe, in-place)." ;;
  2) out "**Result:** needs attention: resource replacement pending and/or drift." ;;
  1) out "**Result:** error." ;;
esac

cat "$REPORT"
[[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && cat "$REPORT" >> "$GITHUB_STEP_SUMMARY"
rm -f "$REPORT" "$REPORT.err"
exit "$worst"
