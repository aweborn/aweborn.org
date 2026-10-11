#!/usr/bin/env bash
# Disaster-recovery drill on a THROWAWAY box, without touching aweborn-vps.
#
# 1. Boots a fresh Lightsail instance with prod's blueprint, bundle and AZ,
#    running the FULL prod UserData from infra/cloudformation-vps.yml (the
#    committed code, rendered here). The only differences from prod: the
#    Tailnet node is ephemeral and named dr-test-<stamp>, and Lightsail's
#    default firewall (public :22, used only to dump logs if the join fails).
# 2. Waits for the bootstrap (Tailnet join, k3s, build + deploy all services).
# 3. Runs infra/restore-from-s3.sh against it (you answer its prompts, exactly
#    as in a real recovery).
# 4. Checks the live DB on the box now matches the backup (same documents and
#    Yjs state vectors) and is different from what the fresh box started with,
#    and that sync-service is healthy and serves a restored world.
# 5. Cleanup: logs the node out of the Tailnet and deletes the instance
#    (KEEP=1 to keep it for poking).
#
# Usage: infra/test-dr-restore.sh [s3-key]   (prompts for the Tailscale OAuth secret, hidden)
# Needs: aws login, jq, python3, tailscale up on this machine.
# Cost: one small instance for ~30 min (cents).
# Expected noise: Caddy on the test box can't get TLS certs (the DNS points
# at prod), so its own HTTPS health check fails; we check in-cluster instead.
# Does NOT test rebuild-vps.sh's in-place swap (CloudFormation replacement +
# static IP move); that's the prod rehearsal (HANDOFF -> Rebuilding the VPS).
set -euo pipefail
cd "$(dirname "$0")/.."

STACK=aweborn-vps
TPL=infra/cloudformation-vps.yml
NAME="dr-test-$(date +%m%d%H%M)"
KEY_ARG="${1:-}"
say() { printf '\n\033[1;35m## %s\033[0m\n' "$*"; }
die() { echo "FAIL: $*" >&2; exit 1; }

params="$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Parameters' --output json)" \
  || die "aws not logged in (run: aws login)"
pget() { jq -r --arg k "$1" --arg d "$2" 'map(select(.ParameterKey==$k))[0].ParameterValue // $d' <<<"$params"; }
BUNDLE="$(pget InstanceBundle small_3_0)"
AZ="$(pget AvailabilityZone us-east-1a)"
BLUEPRINT="$(awk '/^ *BlueprintId:/{print $2; exit}' "$TPL")"
[[ -n "$BLUEPRINT" ]] || die "BlueprintId not found in $TPL"

read -r -s -p "Tailscale OAuth client secret (tskey-client-..., hidden): " TS_SECRET; echo
case "$TS_SECRET" in tskey-client-*) ;; *) die "not a tskey-client-... secret" ;; esac

WORK="$(mktemp -d)"; chmod 700 "$WORK"
CREATED=0; JOINED=0

# ── Render the full prod UserData ──────────────────────────────
TS_SECRET="$TS_SECRET" NAME="$NAME" python3 - "$TPL" > "$WORK/user-data.sh" <<'PY'
import os, re, sys
lines = open(sys.argv[1]).read().splitlines(True)
start = next((i for i, l in enumerate(lines) if re.match(r'^ +UserData: !Sub \|\s*$', l)), None)
if start is None:
    sys.exit("UserData: !Sub | not found")
key_indent = len(lines[start]) - len(lines[start].lstrip())
body = []
for l in lines[start + 1:]:
    if l.strip() and len(l) - len(l.lstrip()) <= key_indent:
        break
    body.append(l)
while body and not body[-1].strip():
    body.pop()
ind = min(len(l) - len(l.lstrip()) for l in body if l.strip())
text = "".join(l[ind:] if l.strip() else "\n" for l in body)
used = set(re.findall(r'\$\{(?!!)([^}]+)\}', text))
if used != {"TailnetHostname", "TailscaleOAuthSecret"}:
    sys.exit(f"unexpected !Sub variables: {used}")
text = text.replace("${TailnetHostname}", os.environ["NAME"]) \
           .replace("${TailscaleOAuthSecret}", os.environ["TS_SECRET"])
text = re.sub(r'\$\{!', '${', text)      # CloudFormation's escape for a literal ${
if text.count("ephemeral=false") != 1:
    sys.exit("expected exactly one 'ephemeral=false'")
text = text.replace("ephemeral=false", "ephemeral=true")   # the one deliberate difference
if "bootstrap complete" not in text:
    sys.exit("completion marker missing")
if len(text.encode()) > 16 * 1024:
    sys.exit(f"user-data too large ({len(text.encode())} bytes)")
sys.stdout.write(text)
PY
unset TS_SECRET
echo "  rendered full UserData: $(wc -c <"$WORK/user-data.sh" | tr -d ' ') bytes, hostname $NAME, ephemeral"

# ── SSH helpers (Lightsail cert + API host keys, Tailnet) ──────
get_access() {
  aws lightsail get-instance-access-details --instance-name "$NAME" --protocol ssh \
    --output json > "$WORK/access.json" 2>/dev/null || return 1
  jq -e '.accessDetails.hostKeys | length > 0' "$WORK/access.json" >/dev/null || return 1
  ( umask 077
    jq -r '.accessDetails.privateKey' "$WORK/access.json" > "$WORK/k"
    jq -r '.accessDetails.certKey'    "$WORK/access.json" > "$WORK/k-cert.pub" )
  jq -r --arg h "$NAME" '.accessDetails.hostKeys[] | "\($h) \(.algorithm) \(.publicKey)"' \
    "$WORK/access.json" > "$WORK/known_hosts"
  jq -r '.accessDetails.ipAddress' "$WORK/access.json" > "$WORK/ip"
  rm -f "$WORK/access.json"
}
rsh() {
  ssh -i "$WORK/k" -o CertificateFile="$WORK/k-cert.pub" -o IdentitiesOnly=yes \
    -o UserKnownHostsFile="$WORK/known_hosts" -o StrictHostKeyChecking=yes -o HostKeyAlias="$NAME" \
    -o ConnectTimeout=10 -o LogLevel=ERROR "ubuntu@${HOST:-$NAME}" "$@"
}
dump_logs() {
  say "Logs from $NAME (tskey-* redacted)"
  get_access || return 0
  HOST="$(cat "$WORK/ip")" rsh 'sudo sh -c "tail -n 60 /var/log/aweborn-bootstrap.log; echo --- cloud-init; tail -n 20 /var/log/cloud-init-output.log"' \
    </dev/null 2>&1 | sed -E 's/tskey-[A-Za-z0-9_?=&-]+/tskey-REDACTED/g' || echo "(could not SSH to the test box)"
}
cleanup() {
  local rc=$?
  (( rc != 0 && CREATED )) && dump_logs
  if [[ "${KEEP:-0}" != 1 ]] && (( CREATED )); then
    if (( JOINED )); then
      say "Logging $NAME out of the Tailnet"
      { get_access && rsh 'sudo tailscale logout' </dev/null; } >/dev/null 2>&1 \
        && echo "  logged out (ephemeral node; Tailscale removes it)" \
        || echo "  WARN: logout failed; delete $NAME in the Tailscale admin console (Machines)"
    fi
    say "Deleting $NAME"
    aws lightsail delete-instance --instance-name "$NAME" >/dev/null || echo "  WARN: delete failed; delete $NAME in the Lightsail console"
  elif (( CREATED )); then
    echo; echo "KEEP=1: $NAME left running. Delete with: aws lightsail delete-instance --instance-name $NAME (and log it out of the Tailnet)."
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# ── 1. Create + harden ─────────────────────────────────────────
say "Creating $NAME ($BLUEPRINT, $BUNDLE, $AZ)"
aws lightsail create-instances --instance-names "$NAME" --availability-zone "$AZ" \
  --blueprint-id "$BLUEPRINT" --bundle-id "$BUNDLE" --user-data "file://$WORK/user-data.sh" >/dev/null
CREATED=1
rm -f "$WORK/user-data.sh"
until [[ "$(aws lightsail get-instance --instance-name "$NAME" --query instance.state.name --output text)" == running ]]; do sleep 5; done
# Same as prod's ImdsHardening custom resource: IMDSv2 only, hop limit 1.
aws lightsail update-instance-metadata-options --instance-name "$NAME" \
  --http-tokens required --http-put-response-hop-limit 1 >/dev/null
echo "  running; IMDS hardened"

# ── 2. Join + bootstrap ────────────────────────────────────────
say "Waiting for $NAME to join the Tailnet (up to 10 min)"
for i in $(seq 1 60); do
  tailscale status --json | jq -e --arg n "$NAME" \
    '[.Peer[]? | select(.HostName == $n or ((.DNSName // "") | startswith($n + ".")))] | length > 0' >/dev/null && break
  (( i == 60 )) && die "never joined the Tailnet"
  sleep 10
done
JOINED=1
echo "  joined"

say "Waiting for the full bootstrap (k3s + build + deploy; up to 30 min)"
get_access || die "no Lightsail access details"
for i in $(seq 1 90); do
  st="$(rsh 'if sudo grep -q "bootstrap complete" /var/log/aweborn-bootstrap.log; then echo done;
             elif cloud-init status 2>/dev/null | grep -qE "status: (done|error)"; then echo stopped;
             else echo running; fi' </dev/null 2>/dev/null || echo unreachable)"
  [[ "$st" == done ]] && break
  [[ "$st" == stopped ]] && { rsh 'sudo tail -n 5 /var/log/aweborn-bootstrap.log' </dev/null || true; die "bootstrap stopped without completing"; }
  (( i == 90 )) && die "bootstrap did not complete in 30 min (last: $st)"
  printf '  %s (%d min)\r' "$st" $(( i * 20 / 60 )); sleep 20
done
echo "  bootstrap complete                 "

# Fingerprint = documents (id, doc_type, Yjs state vector), hashed. Run in the
# sync-service image (has better-sqlite3). live = in the running pod.
FP_JS='import Database from "better-sqlite3"; import { createHash } from "node:crypto";
const db = new Database(process.argv[1], { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT id, doc_type, hex(state_vector) sv FROM documents ORDER BY id").all();
const types = {}; for (const r of rows) types[r.doc_type] = (types[r.doc_type] || 0) + 1;
const world = rows.find(r => r.doc_type === "world");
console.log(createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16), JSON.stringify(types), world ? world.id : "-");'
fp_live() {
  rsh "sudo k3s kubectl -n aweborn exec deploy/sync-service -c sync-service -- node --input-type=module -e $(printf %q "$FP_JS") /data/universe.db" </dev/null
}
fp_file() {   # $1 = ~/restore/<file>.db.gz on the box
  rsh "set -e; t=\$(mktemp -d); trap 'rm -rf \$t' EXIT; gunzip -c $1 > \$t/u.db; chmod 755 \$t; chmod 644 \$t/u.db
       img=\$(sudo k3s kubectl -n aweborn get deploy/sync-service -o jsonpath='{.spec.template.spec.containers[0].image}')
       sudo docker run --rm -v \$t:/r --entrypoint node \$img --input-type=module -e $(printf %q "$FP_JS") /r/u.db" </dev/null
}

say "Fresh box DB (before restore)"
before="$(fp_live)" || die "could not read the live DB"
echo "  $before"

# ── 3. Restore (you answer the prompts) ────────────────────────
say "Running infra/restore-from-s3.sh against $NAME"
RESTORE_INSTANCE="$NAME" RESTORE_TSNAME="$NAME" infra/restore-from-s3.sh $KEY_ARG

# ── 4. Verify ──────────────────────────────────────────────────
say "Verifying"
file="$(rsh 'ls -t ~/restore/*.db.gz | head -1' </dev/null)"
want="$(fp_file "$file")"
after="$(fp_live)"
echo "  backup : $want"
echo "  before : $before"
echo "  after  : $after"
[[ "${after%% *}" == "${want%% *}" ]] || die "live DB after restore does not match the backup"
[[ "${before%% *}" != "${want%% *}" ]] || die "fresh box already matched the backup: test proves nothing"
echo "  ok: live DB == backup (and != fresh DB)"

ip="$(rsh "sudo k3s kubectl -n aweborn get svc sync-service -o jsonpath='{.spec.clusterIP}'" </dev/null)"
rsh "curl -sf --max-time 5 http://$ip:1234/health" </dev/null >/dev/null || die "sync-service /health failed"
echo "  ok: sync-service /health (in-cluster)"
wid="${after##* }"
if [[ "$wid" != "-" ]]; then
  code="$(rsh "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://$ip:1234/worlds/$wid" </dev/null)"
  echo "  GET /worlds/$wid -> $code (restored world doc; 404 is possible only if that world faded)"
fi
rsh 'ls -d /var/lib/aweborn/sync-data/pre-restore-* >/dev/null' </dev/null && echo "  ok: fresh DB kept in sync-data/pre-restore-*"

say "PASS: fresh prod bootstrap + restore-from-s3.sh restored the backup on $NAME"
