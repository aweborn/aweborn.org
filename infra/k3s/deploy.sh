#!/usr/bin/env bash
set -euo pipefail

# ── Aweborn k3s deploy script ────────────────────────────────────────
# Usage: ./deploy.sh [--build] [--push] [--apply] [--vps]
#   --build   Build Docker images locally
#   --push    Push images to ghcr.io
#   --apply   Apply Kubernetes manifests
#   --vps     Build on VPS: docker build + import into k3s containerd
#   (no flags = all three: build + push + apply)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REGISTRY="ghcr.io/aweborn"
TAG="${TAG:-latest}"

DO_BUILD=false
DO_PUSH=false
DO_APPLY=false
DO_VPS=false

# Parse flags — if none given, do all (except vps)
if [[ $# -eq 0 ]]; then
  DO_BUILD=true
  DO_PUSH=true
  DO_APPLY=true
else
  for arg in "$@"; do
    case "$arg" in
      --build) DO_BUILD=true ;;
      --push)  DO_PUSH=true ;;
      --apply) DO_APPLY=true ;;
      --vps)   DO_VPS=true ;;
      *) echo "Unknown flag: $arg"; exit 1 ;;
    esac
  done
fi

# ── Build ─────────────────────────────────────────────────────────────
if $DO_BUILD; then
  echo "🔨 Building Docker images…"

  docker build \
    -t "$REGISTRY/sync-service:$TAG" \
    "$REPO_ROOT/server/sync-service"

  docker build \
    -t "$REGISTRY/genai-service:$TAG" \
    "$REPO_ROOT/server/genai-service"

  echo "✅ Images built"
fi

# ── VPS Build (build + import into k3s containerd) ────────────────────
if $DO_VPS; then
  echo "🔨 Building Docker images on VPS…"

  docker build \
    -t "$REGISTRY/sync-service:$TAG" \
    "$REPO_ROOT/server/sync-service"

  docker build \
    -t "$REGISTRY/genai-service:$TAG" \
    "$REPO_ROOT/server/genai-service"

  echo "📦 Importing images into k3s containerd…"
  docker save "$REGISTRY/sync-service:$TAG" | sudo k3s ctr images import -
  docker save "$REGISTRY/genai-service:$TAG" | sudo k3s ctr images import -

  echo "✅ Images built and imported into k3s"
fi

# ── Push ──────────────────────────────────────────────────────────────
if $DO_PUSH; then
  echo "📤 Pushing to $REGISTRY…"

  docker push "$REGISTRY/sync-service:$TAG"
  docker push "$REGISTRY/genai-service:$TAG"

  echo "✅ Images pushed"
fi

# ── Apply ─────────────────────────────────────────────────────────────
if $DO_APPLY; then
  echo "🚀 Applying Kubernetes manifests…"

  KUBECTL="kubectl"
  # Use k3s kubectl if regular kubectl isn't available
  if ! command -v kubectl &>/dev/null; then
    KUBECTL="sudo k3s kubectl"
  fi

  $KUBECTL apply -f "$SCRIPT_DIR/namespace.yaml"
  $KUBECTL apply -f "$SCRIPT_DIR/secrets.yaml"
  $KUBECTL apply -f "$SCRIPT_DIR/sync-service-deployment.yaml"
  $KUBECTL apply -f "$SCRIPT_DIR/genai-service-deployment.yaml"
  $KUBECTL apply -f "$SCRIPT_DIR/caddy-pvc.yaml"
  $KUBECTL apply -f "$SCRIPT_DIR/caddy-ingress.yaml"

  echo "⏳ Waiting for rollout…"
  $KUBECTL -n aweborn rollout status deployment/sync-service --timeout=120s
  $KUBECTL -n aweborn rollout status deployment/genai-service --timeout=120s
  $KUBECTL -n aweborn rollout status daemonset/caddy --timeout=120s

  echo "✅ All deployments rolled out"
  $KUBECTL -n aweborn get pods
fi
