#!/usr/bin/env bash
# Forced command for the off-box backup key (GitHub Actions → Tailscale → here).
#
# authorized_keys on the VPS:
#   from="100.64.0.0/10,fd7a:115c:a1e0::/48",restrict,command="/home/ubuntu/aweborn/infra/backup/backup-fetch.sh" ssh-ed25519 AAAA… github-actions-backup
#
# Read-only by design: the only thing this key can do is stream the latest
# snapshot (written hourly by the sync-backup CronJob). It can't run commands,
# deploy, list other files, or delete anything.
#
#   ssh … ubuntu@aweborn-vps latest   → tar stream: latest.json + latest.db.gz
set -euo pipefail

DIR=/var/lib/aweborn/backups/sync

case "${SSH_ORIGINAL_COMMAND:-}" in
  latest)
    [[ -s "$DIR/latest.json" && -s "$DIR/latest.db.gz" ]] || {
      echo "no snapshot yet in $DIR" >&2
      exit 2
    }
    exec tar -C "$DIR" -cf - latest.json latest.db.gz
    ;;
  *)
    echo "usage: latest" >&2
    exit 64
    ;;
esac
