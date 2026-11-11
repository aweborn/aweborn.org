#!/usr/bin/env bash
# Restore genai's jobs.db (the Library catalogue: prompts, makers, ratings, trash, job
# history) from its hourly S3 snapshot (2026-11-10). genai writes
# s3://<assets bucket>/archive/backups/jobs.db.gz every hour; the bucket keeps old
# versions for 30 days, so any hour in the last month can come back.
#
#   infra/restore-genai-db.sh --list               # the snapshots S3 still has
#   infra/restore-genai-db.sh                      # restore the latest
#   infra/restore-genai-db.sh <version-id>         # restore that one
#
# The files themselves (models, pictures, sounds, web copies) live in S3 and need no
# restore. Run from your Mac (aws login + the admin SSH key, as genai-carry.sh).
set -euo pipefail
VPS="${VPS:-ubuntu@aweborn-vps}"
SSH_KEY="${SSH_KEY:-${AWEBORN_KEYS_DIR:-$HOME/keys}/AWEBORN_VPS_ADMIN_SSH_KEY.pem}"
BUCKET="${BUCKET:-$(aws cloudformation describe-stack-resources --stack-name aweborn-assets --logical-resource-id AssetBucket --query 'StackResources[0].PhysicalResourceId' --output text)}"
KEY=archive/backups/jobs.db.gz
DIR=/var/lib/aweborn/genai-data
ssh_vps() { ssh -o ConnectTimeout=20 -o BatchMode=yes -i "$SSH_KEY" "$VPS" "$@"; }

if [[ "${1:-}" == "--list" ]]; then
  aws s3api list-object-versions --bucket "$BUCKET" --prefix "$KEY" \
    --query 'Versions[].[VersionId,LastModified,Size,IsLatest]' --output table
  exit 0
fi

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
aws s3api get-object --bucket "$BUCKET" --key "$KEY" ${1:+--version-id "$1"} "$work/jobs.db.gz" >/dev/null
gunzip "$work/jobs.db.gz"
python3 -c "import sqlite3,sys; n=sqlite3.connect(sys.argv[1]).execute('select count(*) from library').fetchone()[0]; print(f'snapshot has {n} Library rows')" "$work/jobs.db"
read -r -p "Replace jobs.db on $VPS with it (genai pauses ~30 s; the current file is kept beside it)? [y/N] " a
[[ "$a" == y ]] || exit 1

scp -q -o BatchMode=yes -i "$SSH_KEY" "$work/jobs.db" "$VPS:/tmp/jobs.restore.db"
ts=$(date -u +%Y%m%dT%H%M%SZ)
ssh_vps "set -e
  sudo k3s kubectl -n aweborn scale deploy/genai-service --replicas=0
  sudo k3s kubectl -n aweborn rollout status deploy/genai-service --timeout=120s >/dev/null 2>&1 || true
  sudo mkdir -p $DIR
  if sudo test -f $DIR/jobs.db; then sudo mv $DIR/jobs.db $DIR/jobs.db.pre-restore-$ts; fi
  sudo rm -f $DIR/jobs.db-wal $DIR/jobs.db-shm
  sudo install -o 1001 -g 1001 -m 644 /tmp/jobs.restore.db $DIR/jobs.db && rm /tmp/jobs.restore.db
  sudo k3s kubectl -n aweborn scale deploy/genai-service --replicas=1
  sudo k3s kubectl -n aweborn rollout status deploy/genai-service --timeout=180s"
echo "Restored. The old file is $DIR/jobs.db.pre-restore-$ts (if there was one)."
