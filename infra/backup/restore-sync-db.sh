#!/usr/bin/env bash
# Restore prod universe.db from a snapshot. Run ON THE VPS (as ubuntu, uses sudo).
#
#   infra/backup/restore-sync-db.sh /var/lib/aweborn/backups/sync/hourly/universe-<stamp>.db.gz
#   infra/backup/restore-sync-db.sh ./universe-<stamp>.db.gz      # e.g. pulled from S3
#   infra/backup/restore-sync-db.sh --check <file>                 # verify only, change nothing
#
# Steps: verify snapshot (integrity + documents table, in the sync-service
# image) → scale sync-service to 0 → move the current DB (+ -wal/-shm) aside to
# sync-data/pre-restore-<ts>/ → install snapshot → scale to 1 → wait ready →
# check /health. Nothing is deleted; undo = run this again on the pre-restore copy.
set -euo pipefail

NS=aweborn
DATA=/var/lib/aweborn/sync-data
KUBECTL="sudo k3s kubectl"
CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && { CHECK_ONLY=1; shift; }
SRC="${1:?usage: restore-sync-db.sh [--check] <snapshot.db.gz|snapshot.db>}"
[[ -s "$SRC" ]] || { echo "not found or empty: $SRC" >&2; exit 1; }

log() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
case "$SRC" in
  *.gz) gunzip -c "$SRC" > "$tmp/universe.db" ;;
  *)    cp "$SRC" "$tmp/universe.db" ;;
esac
chmod 755 "$tmp"; chmod 644 "$tmp/universe.db"   # container runs as uid 1001

# Verify with the same image the service runs (has better-sqlite3).
image="$($KUBECTL -n "$NS" get deployment/sync-service -o jsonpath='{.spec.template.spec.containers[0].image}')"
log "Verifying snapshot with $image"
sudo docker run --rm -v "$tmp:/restore" --entrypoint node "$image" --input-type=module -e '
  import Database from "better-sqlite3";
  const db = new Database("/restore/universe.db", { readonly: true });
  const ok = db.pragma("integrity_check", { simple: true });
  if (ok !== "ok") { console.error("integrity_check:", ok); process.exit(1); }
  const rows = db.prepare("SELECT doc_type, COUNT(*) n FROM documents GROUP BY doc_type").all();
  console.log("ok", JSON.stringify(rows));
'
[[ $CHECK_ONLY -eq 1 ]] && { log "Check only: nothing changed"; exit 0; }

read -r -p "Replace the live universe.db with this snapshot? Players will be disconnected ~30s. [y/N] " ans
[[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "aborted"; exit 1; }

log "Scaling sync-service to 0 (flushes docs on SIGTERM)"
$KUBECTL -n "$NS" scale deployment/sync-service --replicas=0
$KUBECTL -n "$NS" wait --for=delete pod -l app=sync-service --timeout=90s || true

aside="$DATA/pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
log "Moving current DB aside → $aside"
sudo mkdir -p "$aside"
for f in universe.db universe.db-wal universe.db-shm; do
  [[ -e "$DATA/$f" ]] && sudo mv "$DATA/$f" "$aside/"
done

sudo install -o 1001 -g 1001 -m 644 "$tmp/universe.db" "$DATA/universe.db"

log "Scaling sync-service to 1"
$KUBECTL -n "$NS" scale deployment/sync-service --replicas=1
$KUBECTL -n "$NS" rollout status deployment/sync-service --timeout=120s
curl -sf --max-time 5 --resolve sync.aweborn.org:443:127.0.0.1 https://sync.aweborn.org/health && echo
log "Restored from $SRC (previous DB kept in $aside)"
