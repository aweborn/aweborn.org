#!/usr/bin/env bash
# ── Deploy Aweborn services on the VPS ───────────────────────────────
#
# Run ON the VPS as ubuntu. One path for CI and humans:
#
#   ~/aweborn/infra/k3s/deploy-services.sh sync-service genai-service
#   ~/aweborn/infra/k3s/deploy-services.sh all
#
# Services: sync-service  genai-service  agent-runner  caddy
#
# CI (.github/workflows/deploy.yml) connects over an ephemeral Tailscale node
# with a deploy-only SSH key whose forced command is this script; the services
# to deploy arrive in $SSH_ORIGINAL_COMMAND and are checked against the list
# above (anything else is rejected).
#
# Per app service: sync repo to origin/main → build image :<sha> + :latest →
# smoke-test /health against throwaway storage → import into k3s → roll out
# :<sha> → soak → automatic rollback on failure. Caddy: validate Caddyfile →
# apply → restart only if config changed → HTTPS check → rollback on failure.
#
# Secrets are NEVER applied here (secrets.example.yaml is only a template).
# Stops at the first failing service; services after it are not deployed.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/aweborn}"
NS="aweborn"
REGISTRY="ghcr.io/aweborn"
KUBECTL="sudo k3s kubectl"
ALL_SERVICES=(sync-service genai-service agent-runner caddy) # deploy order
KEEP_IMAGES=5

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# ── Parse + validate requested services ──────────────────────────────
SYNCED=0
if [[ "${1:-}" == "--synced" ]]; then SYNCED=1; shift; fi
REQ=("$@")
if [[ ${#REQ[@]} -eq 0 && -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  read -r -a REQ <<<"$SSH_ORIGINAL_COMMAND"
fi
[[ ${#REQ[@]} -gt 0 ]] || die "usage: deploy-services.sh <service...|all>  (services: ${ALL_SERVICES[*]})"
for r in "${REQ[@]}"; do
  [[ "$r" == "all" ]] && continue
  printf '%s\n' "${ALL_SERVICES[@]}" | grep -qxF -- "$r" || die "unknown service: '$r'"
done
SERVICES=()
for s in "${ALL_SERVICES[@]}"; do
  for r in "${REQ[@]}"; do
    if [[ "$r" == "all" || "$r" == "$s" ]]; then SERVICES+=("$s"); break; fi
  done
done

# ── Stage 1: lock + sync repo, then re-exec the freshly pulled script ─
if [[ $SYNCED -eq 0 ]]; then
  # One deploy at a time. fd 9 (and the lock) is inherited by the re-exec.
  exec 9>/tmp/aweborn-deploy.lock
  flock -n 9 || die "another deploy is running"

  # Always deploy exactly origin/main (a leaked deploy key can't deploy
  # anything else). Refuse if the VPS checkout has local changes.
  log "Syncing $REPO_DIR to origin/main"
  cd "$REPO_DIR"
  git fetch -q origin main
  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "VPS checkout has uncommitted changes; refusing to deploy"
  fi
  git checkout -q main
  git merge -q --ff-only origin/main
  exec bash "$REPO_DIR/infra/k3s/deploy-services.sh" --synced "${SERVICES[@]}"
fi

cd "$REPO_DIR"
SHA="$(git rev-parse --short=12 HEAD)"
echo "Deploying $SHA ($(git log -1 --format=%s)): ${SERVICES[*]}"
$KUBECTL apply -f infra/k3s/namespace.yaml >/dev/null

# ── App services (Deployment + image) ────────────────────────────────
service_config() {
  MANIFEST="infra/k3s/$1-deployment.yaml"
  SMOKE_ENV=()
  case "$1" in
    sync-service)
      DOCKERFILE=server/sync-service/Dockerfile; CONTEXT=.   # needs shared/
      PORT=1234; ENTRY=dist/server/sync-service/src/index.js
      SMOKE_ENV=(-e DB_PATH=/tmp/smoke.db) ;;
    genai-service)
      DOCKERFILE=server/genai-service/Dockerfile; CONTEXT=server/genai-service
      PORT=3001; ENTRY=dist/index.js ;;
    agent-runner)
      DOCKERFILE=server/agent-runner/Dockerfile; CONTEXT=server/agent-runner
      PORT=3002; ENTRY=dist/index.js
      SMOKE_ENV=(-e DATA_DIR=/tmp) ;;
  esac
}

deploy_app() {
  local svc="$1" image="$REGISTRY/$1"
  service_config "$svc"

  log "[$svc] Building $image:$SHA"
  sudo docker build -q -f "$DOCKERFILE" -t "$image:$SHA" -t "$image:latest" "$CONTEXT" >/dev/null

  log "[$svc] Smoke test (/health, throwaway storage)"
  local out
  out="$(sudo docker run --rm "${SMOKE_ENV[@]}" -e PORT="$PORT" \
      -e SMOKE_ENTRY="$ENTRY" -e SMOKE_PORT="$PORT" \
      --entrypoint sh "$image:$SHA" -c '
    node "$SMOKE_ENTRY" & pid=$!
    for i in 1 2 3 4 5 6 7 8 9 10; do
      sleep 1
      if r=$(wget -qO- "http://127.0.0.1:$SMOKE_PORT/health" 2>/dev/null); then
        echo "$r"; kill $pid; wait $pid 2>/dev/null; exit 0
      fi
      kill -0 $pid 2>/dev/null || exit 1
    done
    exit 1' 2>&1)" || { echo "$out" >&2; die "[$svc] smoke test failed; production untouched"; }
  echo "$out" | grep -q '"status":"ok"' || die "[$svc] unexpected /health response: $out"
  ok "health ok"

  log "[$svc] Importing into k3s"
  sudo docker save "$image:$SHA" | sudo k3s ctr images import - >/dev/null

  local prev
  prev="$($KUBECTL -n "$NS" get "deployment/$svc" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
  log "[$svc] Rolling out ${prev:-<none>} → $image:$SHA"
  # apply can't flip a live RollingUpdate Deployment to Recreate (the defaulted
  # rollingUpdate block is rejected), so switch the strategy first.
  if grep -q 'type: Recreate' "$MANIFEST" && [[ -n "$prev" ]] &&
     [[ "$($KUBECTL -n "$NS" get "deployment/$svc" -o jsonpath='{.spec.strategy.type}')" != "Recreate" ]]; then
    $KUBECTL -n "$NS" patch "deployment/$svc" --type=json \
      -p '[{"op":"remove","path":"/spec/strategy/rollingUpdate"},{"op":"replace","path":"/spec/strategy/type","value":"Recreate"}]'
  fi
  sed "s#image: $image:latest#image: $image:$SHA#" "$MANIFEST" | $KUBECTL apply -f -
  if [[ "$prev" == "$image:$SHA" ]]; then
    $KUBECTL -n "$NS" rollout restart "deployment/$svc" # same commit: force restart
  fi

  rollback_app() {
    printf '\n\033[1;31m✖ [%s] %s — rolling back\033[0m\n' "$svc" "$1" >&2
    $KUBECTL -n "$NS" logs "deployment/$svc" -c "$svc" --tail=30 >&2 || true
    $KUBECTL -n "$NS" rollout undo "deployment/$svc" || true
    $KUBECTL -n "$NS" rollout status "deployment/$svc" --timeout=120s || true
    exit 1
  }
  $KUBECTL -n "$NS" rollout status "deployment/$svc" --timeout=180s || rollback_app "rollout did not become ready"

  log "[$svc] Soak (15s)"
  sleep 15
  # Every live (non-terminating) pod must be ready with zero restarts.
  local bad
  bad="$($KUBECTL -n "$NS" get pods -l "app=$svc" -o jsonpath='{range .items[*]}{.metadata.deletionTimestamp}{"|"}{.status.containerStatuses[0].ready}{"|"}{.status.containerStatuses[0].restartCount}{"\n"}{end}' \
    | awk -F'|' '$1=="" && !($2=="true" && $3=="0")')"
  [[ -z "$bad" ]] || rollback_app "pod unhealthy after rollout ($bad)"
  $KUBECTL -n "$NS" logs "deployment/$svc" -c "$svc" --tail=3 || true

  # Keep the most recent $KEEP_IMAGES builds (rollback targets).
  sudo docker images "$image" --format '{{.Tag}} {{.CreatedAt}}' \
    | grep -v '^latest ' | sort -k2 -r | awk -v keep="$KEEP_IMAGES" 'NR>keep {print $1}' \
    | while read -r tag; do
        sudo docker rmi -f "$image:$tag" >/dev/null 2>&1 || true
        sudo k3s ctr images rm "$image:$tag" >/dev/null 2>&1 || true
      done

  ok "[$svc] deployed $SHA"
}

# ── Caddy (config only; image is upstream caddy:2-alpine) ────────────
deploy_caddy() {
  local tmp; tmp="$(mktemp -d)"
  log "[caddy] Validating Caddyfile"
  python3 - "$tmp/Caddyfile" <<'PY'
import sys, yaml
docs = [d for d in yaml.safe_load_all(open("infra/k3s/caddy-ingress.yaml")) if d]
cm = next(d for d in docs if d.get("kind") == "ConfigMap")
open(sys.argv[1], "w").write(cm["data"]["Caddyfile"])
PY
  sudo docker run --rm -v "$tmp/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
    || die "[caddy] Caddyfile invalid; production untouched"

  local before after
  before="$($KUBECTL -n "$NS" get cm caddy-config -o jsonpath='{.data.Caddyfile}' 2>/dev/null | sha256sum)"
  $KUBECTL -n "$NS" get cm caddy-config -o yaml > "$tmp/prev-cm.yaml" 2>/dev/null || true

  log "[caddy] Applying manifests"
  $KUBECTL apply -f infra/k3s/caddy-pvc.yaml
  $KUBECTL apply -f infra/k3s/caddy-ingress.yaml
  after="$($KUBECTL -n "$NS" get cm caddy-config -o jsonpath='{.data.Caddyfile}' | sha256sum)"

  if [[ "$before" == "$after" ]]; then
    ok "[caddy] config unchanged; no restart"
  else
    # The Caddyfile is mounted via subPath, so changes need a pod restart.
    log "[caddy] Config changed; restarting"
    $KUBECTL -n "$NS" rollout restart daemonset/caddy
    local healthy=0
    if $KUBECTL -n "$NS" rollout status daemonset/caddy --timeout=120s; then
      for i in 1 2 3 4 5 6 7 8 9 10; do
        if curl -sf --max-time 5 --resolve sync.aweborn.org:443:127.0.0.1 https://sync.aweborn.org/health >/dev/null; then
          healthy=1; break
        fi
        sleep 3
      done
    fi
    if [[ $healthy -ne 1 ]]; then
      printf '\n\033[1;31m✖ [caddy] HTTPS check failed — restoring previous config\033[0m\n' >&2
      [[ -s "$tmp/prev-cm.yaml" ]] && $KUBECTL apply -f "$tmp/prev-cm.yaml" || true
      $KUBECTL -n "$NS" rollout restart daemonset/caddy || true
      $KUBECTL -n "$NS" rollout status daemonset/caddy --timeout=120s || true
      exit 1
    fi
  fi
  rm -rf "$tmp"
  ok "[caddy] deployed $SHA"
}

for svc in "${SERVICES[@]}"; do
  case "$svc" in
    caddy) deploy_caddy ;;
    *)     deploy_app "$svc" ;;
  esac
done

printf '\n\033[1;32m✔ Deployed %s: %s\033[0m\n' "$SHA" "${SERVICES[*]}"
