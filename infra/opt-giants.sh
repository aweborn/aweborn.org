#!/usr/bin/env bash
# Web copies for models too big for the box to optimize (2026-11-10).
#
# genai skips models over OPT_MAX_BYTES (30 MB) because optimizing one can OOM the
# 2 GB box, so phones get the full 4K-textured original and it never loads (why
# most of Lost's models didn't show on prod). This builds their web copies on
# your Mac with the same code (src/optimize.ts), puts them on the box, uploads
# them to s3://…/models/opt/ with genai's own credentials, and restarts genai so
# its startup backfill flags them (opt = 1). Originals are never touched.
#
#   infra/opt-giants.sh            # list what it would do, then ask
#   infra/opt-giants.sh --yes      # no prompt
#
# Uses the admin SSH key over the Tailnet (same as infra/genai-carry.sh).
# Not needed once the box is 4 GB and OPT_MAX_BYTES is raised.
set -euo pipefail
cd "$(dirname "$0")/.."
VPS="${VPS:-ubuntu@aweborn-vps}"
SSH_KEY="${SSH_KEY:-${AWEBORN_KEYS_DIR:-$HOME/keys}/AWEBORN_VPS_ADMIN_SSH_KEY.pem}"
CDN="${CDN:-https://assets.aweborn.org}"
ssh_vps() { ssh -o ConnectTimeout=20 -o BatchMode=yes -i "$SSH_KEY" "$VPS" "$@"; }
# $1 = JS (no single quotes), $2 = optional arguments (process.argv.slice(1))
pod_node() { ssh_vps "sudo k3s kubectl -n aweborn exec deploy/genai-service -c genai-service -- node -e '$1' ${2:-}" 2>/dev/null; }

files=$(pod_node 'const {DatabaseSync}=require("node:sqlite");const D=new DatabaseSync("/data/jobs.db",{readOnly:true});for(const r of D.prepare("SELECT file FROM library WHERE kind=? AND opt=0 AND removed_at IS NULL").all("model"))console.log(r.file)')
[[ -n "$files" ]] || { echo "Nothing to do: every model has a web copy."; exit 0; }
echo "Models without a web copy:"; echo "$files" | sed 's/^/  /'
if [[ "${1:-}" != "--yes" ]]; then read -r -p "Build and upload their web copies, then restart genai (~30 s)? [y/N] " a; [[ "$a" == y ]] || exit 1; fi

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
mkdir -p "$work/src"
for f in $files; do curl -sf -o "$work/src/$f" "$CDN/models/$f"; done
cat > "$work/run.mts" <<EOF
import { ensureOptimized } from "$PWD/server/genai-service/src/optimize.ts";
import { readdirSync } from "node:fs";
for (const f of readdirSync("$work/src").filter((f) => f.endsWith(".glb"))) {
  if (!(await ensureOptimized("$work/src", f))) { console.error("failed:", f); process.exit(1); }
}
EOF
(cd server/genai-service && node --import tsx --max-old-space-size=8192 "$work/run.mts")

ssh_vps "mkdir -p /tmp/opt-giants"
scp -q -o BatchMode=yes -i "$SSH_KEY" "$work"/src/opt/*.glb "$VPS:/tmp/opt-giants/"
ssh_vps 'for f in /tmp/opt-giants/*.glb; do sudo install -o 1001 -g 1001 -m 644 "$f" /var/lib/aweborn/genai-data/assets/opt/; done; rm -rf /tmp/opt-giants'
# Upload with genai's own bucket credentials (same key, type and cache headers as library.ts)
pod_node 'const {S3Client,PutObjectCommand}=require("@aws-sdk/client-s3");const fs=require("node:fs");const s3=new S3Client({region:process.env.AWS_REGION||"us-east-1",credentials:{accessKeyId:process.env.ASSETS_AWS_ACCESS_KEY_ID,secretAccessKey:process.env.ASSETS_AWS_SECRET_ACCESS_KEY}});(async()=>{for(const f of process.argv.slice(1)){const p="/data/assets/opt/"+f;await s3.send(new PutObjectCommand({Bucket:process.env.ASSETS_BUCKET,Key:"models/opt/"+f,Body:fs.readFileSync(p),ContentType:"model/gltf-binary",CacheControl:"public, max-age=31536000, immutable"}));console.log("uploaded",f.slice(0,8))}})().catch(e=>{console.error(e.message);process.exit(1)})' "$(echo $files)"
ssh_vps "sudo k3s kubectl -n aweborn rollout restart deploy/genai-service && sudo k3s kubectl -n aweborn rollout status deploy/genai-service --timeout=180s"
sleep 20
left=$(pod_node 'const {DatabaseSync}=require("node:sqlite");const D=new DatabaseSync("/data/jobs.db",{readOnly:true});console.log(D.prepare("SELECT count(*) n FROM library WHERE kind=? AND opt=0 AND removed_at IS NULL").get("model").n)')
echo "Models still without a web copy: ${left:-?} (0 = done; the backfill may need another minute)."
