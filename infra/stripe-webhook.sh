#!/usr/bin/env bash
# Stripe webhook endpoint for donations → mana ledger (Phase 05).
#
#   infra/stripe-webhook.sh create   # registers https://<payment api>/stripe-webhook for
#                                    # payment_intent.succeeded and saves its signing secret to
#                                    # ~/keys/AWEBORN_STRIPE_WEBHOOK_SECRET.txt (Stripe shows it only once)
#   infra/stripe-webhook.sh status   # lists the account's webhook endpoints (no secrets)
#   infra/stripe-webhook.sh events   # sets the existing endpoint's events to $EVENTS below
#                                    # (M4, 2026-10-27: refunds + lost disputes become labeled draws)
#
# Uses the Stripe key in ~/keys/AWEBORN_STRIPE_SECRET_KEY.txt (sent via a 0600
# curl config file, never on the command line). The endpoint URL comes from the
# aweborn-website stack output ApiEndpoint.
#
# Full setup, in order (HANDOFF → Donations → mana):
#   1. infra/set-secret.sh generate MANA_INFLOW_TOKEN     # VPS + ~/keys
#   2. aws cloudformation deploy (aweborn-website)         # creates the webhook Lambda + route
#   3. infra/stripe-webhook.sh create                      # Stripe endpoint + signing secret
#   4. infra/set-stack-key.sh stripe-webhook               # secret → Lambda
#   5. infra/set-stack-key.sh mana-inflow                  # token → Lambda
set -euo pipefail
cd "$(dirname "$0")/.."
KDIR="${AWEBORN_KEYS_DIR:-$HOME/keys}"
KEY_FILE="$KDIR/AWEBORN_STRIPE_SECRET_KEY.txt"
OUT="$KDIR/AWEBORN_STRIPE_WEBHOOK_SECRET.txt"
[[ -s "$KEY_FILE" ]] || { echo "missing $KEY_FILE" >&2; exit 1; }

WORK="$(mktemp -d)"; chmod 700 "$WORK"; trap 'rm -rf "$WORK"' EXIT
printf 'user = "%s:"\n' "$(tr -d '[:space:]' < "$KEY_FILE")" > "$WORK/curl.cfg"; chmod 600 "$WORK/curl.cfg"
stripe() { curl -sS -K "$WORK/curl.cfg" "$@"; }

# Everything the aweborn-stripe-webhook Lambda handles.
EVENTS=(payment_intent.succeeded charge.updated charge.refunded charge.dispute.funds_withdrawn)
args=(); for e in "${EVENTS[@]}"; do args+=(-d "enabled_events[]=$e"); done   # bash 3.2-safe (macOS)
endpoint_url() {
  local api
  api="$(aws cloudformation describe-stacks --stack-name aweborn-website --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text)"
  [[ "$api" == https://* ]] || { echo "no ApiEndpoint output on aweborn-website" >&2; exit 1; }
  echo "$api/stripe-webhook"
}

case "${1:-}" in
  status)
    stripe https://api.stripe.com/v1/webhook_endpoints | jq -r '.data[] | "\(.id)  \(.status)  \(.url)  \(.enabled_events | join(","))"'
    ;;
  create)
    [[ ! -e "$OUT" ]] || { echo "$OUT already exists. Roll the secret in the Stripe dashboard instead, or move the file away first." >&2; exit 1; }
    api="$(aws cloudformation describe-stacks --stack-name aweborn-website --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text)"
    [[ "$api" == https://* ]] || { echo "no ApiEndpoint output on aweborn-website" >&2; exit 1; }
    url="$api/stripe-webhook"
    if stripe https://api.stripe.com/v1/webhook_endpoints | jq -e --arg u "$url" '.data[] | select(.url == $u)' >/dev/null; then
      echo "Stripe already has an endpoint for $url (see: $0 status). Not creating another." >&2; exit 1
    fi
    resp="$(stripe https://api.stripe.com/v1/webhook_endpoints \
      -d url="$url" \
      "${args[@]}" \
      -d description="Aweborn donations → mana ledger (aweborn-stripe-webhook Lambda)")"
    secret="$(jq -r '.secret // empty' <<<"$resp")"
    [[ "$secret" == whsec_* ]] || { echo "Stripe error: $(jq -c '.error // .' <<<"$resp")" >&2; exit 1; }
    umask 077; printf '%s\n' "$secret" > "$OUT"; unset secret
    echo "Created $(jq -r .id <<<"$resp") → $url (livemode=$(jq -r .livemode <<<"$resp"))"
    echo "Signing secret saved to $OUT. Next: infra/set-stack-key.sh stripe-webhook"
    ;;
  events)
    url="$(endpoint_url)"
    id="$(stripe https://api.stripe.com/v1/webhook_endpoints | jq -r --arg u "$url" '.data[] | select(.url == $u) | .id')"
    [[ "$id" == we_* ]] || { echo "no Stripe endpoint for $url (run: $0 create)" >&2; exit 1; }
    resp="$(stripe "https://api.stripe.com/v1/webhook_endpoints/$id" "${args[@]}")"
    echo "$id → $(jq -r '(.enabled_events // []) | join(",")' <<<"$resp")"
    ;;
  *) echo "usage: $0 create|status|events" >&2; exit 1 ;;
esac
