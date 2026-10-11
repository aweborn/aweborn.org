#!/usr/bin/env bash
# ── Deploy sync-service on the VPS ───────────────────────────────────
#
# Run ON the VPS (as ubuntu). Used by CI (.github/workflows/deploy.yml, via an
# ephemeral Tailscale node + a deploy-only SSH key) and by humans:
#
#   ~/aweborn/infra/k3s/deploy-sync-service.sh
#
# Steps: sync repo to origin/main → build image (tagged :<sha> + :latest) →
# smoke-test it against a throwaway DB → import into k3s → roll out :<sha> →
# verify → automatic rollback to the previous image if anything fails.
#
# Brief downtime per deploy (~30s): the Deployment uses strategy Recreate
# because SQLite has a single writer.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/aweborn}"
IMAGE="ghcr.io/aweborn/sync-service"
NS="aweborn"
DEPLOY="deployment/sync-service"
KUBECTL="sudo k3s kubectl"

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

if [[ "${1:-}" != "--synced" ]]; then
  # Only one deploy at a time (CI concurrency also guards this).
  # fd 9 (and the lock) is inherited by the re-exec below.
  exec 9>/tmp/aweborn-deploy-sync-service.lock
  flock -n 9 || die "another sync-service deploy is running"

  # ── 1. Sync repo to origin/main ────────────────────────────────────
  # Always deploy exactly what's on main (a leaked deploy key can't deploy
  # anything else). Fails loudly if the VPS checkout has local changes.
  log "Syncing $REPO_DIR to origin/main"
  cd "$REPO_DIR"
  git fetch -q origin main
  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "VPS checkout has uncommitted changes; refusing to deploy"
  fi
  git checkout -q main
  git merge -q --ff-only origin/main

  # Re-exec the freshly pulled copy so this deploy uses the latest logic.
  exec bash "$REPO_DIR/infra/k3s/deploy-sync-service.sh" --synced
fi

cd "$REPO_DIR"
SHA="$(git rev-parse --short=12 HEAD)"
echo "Deploying $SHA: $(git log -1 --format=%s)"

# ── 2. Build ─────────────────────────────────────────────────────────
log "Building $IMAGE:$SHA"
sudo docker build -q \
  -f server/sync-service/Dockerfile \
  -t "$IMAGE:$SHA" -t "$IMAGE:latest" \
  . >/dev/null

# ── 3. Smoke test (before touching the running server) ───────────────
log "Smoke-testing image against a throwaway DB"
SMOKE="$(sudo docker run --rm -e DB_PATH=/tmp/smoke.db --entrypoint sh "$IMAGE:$SHA" -c '
  node dist/server/sync-service/src/index.js & pid=$!
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    if out=$(wget -qO- http://127.0.0.1:1234/health 2>/dev/null); then echo "$out"; kill $pid; wait $pid 2>/dev/null; exit 0; fi
    kill -0 $pid 2>/dev/null || exit 1
  done
  exit 1' 2>&1)" || { echo "$SMOKE" >&2; die "smoke test failed; production untouched"; }
echo "$SMOKE" | grep -q '"status":"ok"' || die "unexpected /health response: $SMOKE"
echo "health ok"

# ── 4. Import into k3s containerd ────────────────────────────────────
log "Importing image into k3s"
sudo docker save "$IMAGE:$SHA" | sudo k3s ctr images import - >/dev/null

# ── 5. Roll out ──────────────────────────────────────────────────────
PREV_IMAGE="$($KUBECTL -n "$NS" get $DEPLOY -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
echo "current: ${PREV_IMAGE:-<none>}  →  new: $IMAGE:$SHA"

log "Applying manifest with image $IMAGE:$SHA"
sed "s#image: $IMAGE:latest#image: $IMAGE:$SHA#" infra/k3s/sync-service-deployment.yaml \
  | $KUBECTL apply -f -
if [[ "$PREV_IMAGE" == "$IMAGE:$SHA" ]]; then
  # Same commit re-deployed: image field unchanged, so force a restart.
  $KUBECTL -n "$NS" rollout restart $DEPLOY
fi

rollback() {
  printf '\n\033[1;31m✖ %s — rolling back\033[0m\n' "$1" >&2
  $KUBECTL -n "$NS" logs $DEPLOY -c sync-service --tail=30 >&2 || true
  $KUBECTL -n "$NS" rollout undo $DEPLOY || true
  $KUBECTL -n "$NS" rollout status $DEPLOY --timeout=120s || true
  exit 1
}

log "Waiting for rollout"
$KUBECTL -n "$NS" rollout status $DEPLOY --timeout=180s || rollback "rollout did not become ready"

# ── 6. Verify it stays up ────────────────────────────────────────────
log "Verifying (15s soak)"
sleep 15
POD="$($KUBECTL -n "$NS" get pods -l app=sync-service -o jsonpath='{.items[0].metadata.name}')"
READY="$($KUBECTL -n "$NS" get pod "$POD" -o jsonpath='{.status.containerStatuses[0].ready}')"
RESTARTS="$($KUBECTL -n "$NS" get pod "$POD" -o jsonpath='{.status.containerStatuses[0].restartCount}')"
[[ "$READY" == "true" && "$RESTARTS" == "0" ]] || rollback "pod unhealthy after rollout (ready=$READY restarts=$RESTARTS)"
$KUBECTL -n "$NS" logs "$POD" -c sync-service --tail=5

# ── 7. Tidy old images (keep the 5 most recent builds) ───────────────
sudo docker images "$IMAGE" --format '{{.Tag}} {{.CreatedAt}}' \
  | grep -v '^latest ' | sort -k2 -r | awk 'NR>5 {print $1}' \
  | while read -r tag; do
      sudo docker rmi -f "$IMAGE:$tag" >/dev/null 2>&1 || true
      sudo k3s ctr images rm "$IMAGE:$tag" >/dev/null 2>&1 || true
    done

printf '\n\033[1;32m✔ sync-service %s deployed\033[0m\n' "$SHA"
