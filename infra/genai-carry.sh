#!/usr/bin/env bash
# Carry genai-service's data across a VPS rebuild (resize, 2026-11-01).
#
# The off-box backup (backup.yml) only covers the world DB. genai keeps its own
# state in /var/lib/aweborn/genai-data on the box: jobs.db (the asset Library
# catalogue: prompts, makers, trash, thumbnails, job history), archive.jsonl, and
# the asset cache (pictures and sounds are served from here until MEDIA_CDN=1).
# A rebuild deletes the old disk, so save it first and restore it on the new box.
#
#   infra/genai-carry.sh save             # old box → ~/restore/genai-data-<ts>.tgz (genai paused ~30 s)
#   infra/genai-carry.sh restore <file>   # that file → the new box (replaces its empty genai-data)
#
# Uses the admin SSH key over the Tailnet (same as infra/set-secret.sh).
set -euo pipefail
VPS="${VPS:-ubuntu@aweborn-vps}"
SSH_KEY="${SSH_KEY:-${AWEBORN_KEYS_DIR:-$HOME/keys}/AWEBORN_VPS_ADMIN_SSH_KEY.pem}"
DIR=/var/lib/aweborn
ssh_vps() { ssh -o ConnectTimeout=20 -o BatchMode=yes -i "$SSH_KEY" "$VPS" "$@"; }
scale() { ssh_vps "sudo k3s kubectl -n aweborn scale deploy/genai-service --replicas=$1 >/dev/null && sudo k3s kubectl -n aweborn rollout status deploy/genai-service --timeout=120s >/dev/null 2>&1 || true"; }

case "${1:-}" in
  save)
    mkdir -p "$HOME/restore"
    out="$HOME/restore/genai-data-$(date -u +%Y%m%dT%H%M%SZ).tgz"
    echo "Pausing genai-service (a consistent jobs.db), saving $DIR/genai-data..."
    scale 0
    trap 'scale 1' EXIT
    ssh_vps "sudo tar -C $DIR -czf - genai-data" > "$out"
    scale 1
    trap - EXIT
    tar -tzf "$out" | grep -q '^genai-data/jobs.db$' || { echo "ERROR: $out has no jobs.db" >&2; exit 1; }
    echo "Saved $(du -h "$out" | cut -f1) → $out"
    ;;
  restore)
    file="${2:-}"
    [[ -f "$file" ]] || { echo "usage: $0 restore <genai-data-*.tgz>" >&2; exit 1; }
    tar -tzf "$file" | grep -q '^genai-data/jobs.db$' || { echo "ERROR: $file has no jobs.db" >&2; exit 1; }
    read -r -p "Replace genai-data on $VPS with $file? [y/N] " a
    [[ "$a" == y || "$a" == Y ]] || { echo "Nothing changed."; exit 0; }
    scale 0
    trap 'scale 1' EXIT
    ssh_vps "sudo mkdir -p $DIR && if [ -d $DIR/genai-data ]; then sudo mv $DIR/genai-data $DIR/genai-data.pre-carry-\$(date +%s); fi && sudo tar -C $DIR -xzf - && sudo chown -R 1001:1001 $DIR/genai-data" < "$file"
    scale 1
    trap - EXIT
    echo "Restored. Check: curl -s https://api.aweborn.org/health ; the Library's Made shelf should list the old models."
    ;;
  *)
    echo "usage: $0 save | restore <file>" >&2
    exit 1
    ;;
esac

