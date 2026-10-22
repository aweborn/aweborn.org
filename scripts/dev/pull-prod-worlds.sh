#!/usr/bin/env bash
# Copy prod's universe + world docs into the LOCAL dev database, so local tests
# see the real universe (Origin, Lost World, …). Accounts, sessions, passkeys,
# characters, World Index, chat, planner logs, mana ledger and creations stay
# LOCAL: only the `documents` table (Yjs universe + world docs) is replaced.
#
#   scripts/dev/pull-prod-worlds.sh            # newest off-box backup in S3
#   scripts/dev/pull-prod-worlds.sh <s3-key>   # a specific one (see infra/restore-from-s3.sh --list)
#
# Needs: aws login (read on the backups bucket), sqlite3, docker compose.
# Never touches prod. The current local DB is copied aside first, never deleted:
#   server/data/universe.db.pre-prod-<UTC>
set -euo pipefail
cd "$(dirname "$0")/../.."

LOCAL_DB=server/data/universe.db
COMPOSE="docker compose -f server/docker-compose.yml"
say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

command -v sqlite3 >/dev/null || die "sqlite3 not found"
[[ -f $LOCAL_DB ]] || die "$LOCAL_DB not found (start the local stack once: $COMPOSE up -d)"
account=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || die "AWS session expired: run 'aws login'"
bucket="aweborn-backups-$account"

key=${1:-}
if [[ -z $key ]]; then
  key=$(aws s3api list-objects-v2 --bucket "$bucket" --prefix sync/ \
    --query 'sort_by(Contents[?ends_with(Key, `.db.gz`)], &LastModified)[-1].Key' --output text)
  [[ $key != None && -n $key ]] || die "no backups found in s3://$bucket/sync/"
fi

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
say "Downloading s3://$bucket/$key"
aws s3 cp --only-show-errors "s3://$bucket/$key" "$tmp/prod.db.gz"
gunzip -t "$tmp/prod.db.gz" && gunzip "$tmp/prod.db.gz"
[[ $(sqlite3 "$tmp/prod.db" 'PRAGMA integrity_check') == ok ]] || die "backup failed integrity_check"
echo "prod documents: $(sqlite3 "$tmp/prod.db" "SELECT doc_type || '=' || COUNT(*) FROM documents GROUP BY doc_type" | paste -sd' ' -)"

say "Stopping local sync-service (so its WAL is flushed)"
$COMPOSE stop sync-service >/dev/null

ts=$(date -u +%Y%m%dT%H%M%SZ)
sqlite3 "$LOCAL_DB" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
cp "$LOCAL_DB" "$LOCAL_DB.pre-prod-$ts"
echo "local DB saved as $LOCAL_DB.pre-prod-$ts"

say "Replacing local documents with prod's (everything else stays local)"
cols="id, doc_type, sector_key, state_vector, created_at, updated_at"
sqlite3 "$LOCAL_DB" <<SQL
ATTACH '$tmp/prod.db' AS prod;
BEGIN;
DELETE FROM main.documents;
INSERT INTO main.documents ($cols) SELECT $cols FROM prod.documents;
COMMIT;
DETACH prod;
SQL
echo "local documents: $(sqlite3 "$LOCAL_DB" "SELECT doc_type || '=' || COUNT(*) FROM documents GROUP BY doc_type" | paste -sd' ' -)"

say "Starting local sync-service"
$COMPOSE start sync-service >/dev/null
for _ in $(seq 1 20); do
  curl -fsS http://localhost:1234/health >/dev/null 2>&1 && { echo "healthy"; break; }
  sleep 1
done
echo "Done. Reload the dev page. Undo: stop sync-service, copy $LOCAL_DB.pre-prod-$ts back over $LOCAL_DB, start it."
