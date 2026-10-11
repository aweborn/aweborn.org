#!/usr/bin/env bash
# ── Legacy entry point — use deploy-services.sh ──────────────────────
# The old build/push/apply flags are gone: they built with stale contexts and
# applied the secrets template over the real secret. Everything now goes
# through deploy-services.sh (same path as CI). Run ON the VPS:
#
#   ./deploy.sh                      # = deploy-services.sh all
#   ./deploy.sh genai-service caddy  # = deploy-services.sh genai-service caddy
set -euo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/deploy-services.sh" "${@:-all}"
