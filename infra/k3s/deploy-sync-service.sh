#!/usr/bin/env bash
# Transitional shim: the CI deploy key's forced command on the VPS may still
# point here until authorized_keys is switched to deploy-services.sh.
# With no SSH command (old workflow) deploy sync-service; otherwise
# deploy-services.sh reads and validates $SSH_ORIGINAL_COMMAND itself.
# Delete once authorized_keys points at deploy-services.sh.
set -euo pipefail
script="$(dirname "${BASH_SOURCE[0]}")/deploy-services.sh"
if [[ -z "${SSH_ORIGINAL_COMMAND:-}" ]]; then exec bash "$script" sync-service; fi
exec bash "$script"
