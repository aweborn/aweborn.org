#!/usr/bin/env bash
# Throwaway test of the VPS Tailnet auto-join, WITHOUT touching aweborn-vps.
#
# Extracts the `# >>> tailscale-join` ... `# <<< tailscale-join` block from
# infra/cloudformation-vps.yml (the committed code, not a copy), fills in a
# test hostname + the OAuth secret, boots a nano Lightsail instance with it,
# then checks over the Tailnet that:
#   - the node joined, tagged tag:server, with the expected hostname
#   - the on-disk secret copies are gone and the bootstrap log has no secret
#   - IMDSv1 (no token) does not serve the user-data
# Finally it logs the node out of the Tailnet and deletes the instance (also on
# failure, after dumping the redacted bootstrap/cloud-init logs).
#
# Usage: infra/test-tailscale-join.sh            (prompts for the secret, hidden)
#        KEEP=1 infra/test-tailscale-join.sh     (leave the instance for poking)
# Needs: aws CLI (logged in), tailscale on this machine, python3. SSH uses
#        Lightsail's short-lived cert (get-instance-access-details), no local key.
# Cost: a nano instance for ~10 minutes (cents).
# Evidence of the first pass: phases/ops-tailscale-autojoin.md (2026-10-11).
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="${AWS_REGION:-us-east-1}"
AZ="${REGION}a"
NAME="ts-join-test-$(date +%m%d%H%M)"
TPL=infra/cloudformation-vps.yml

say() { printf '\n== %s\n' "$*"; }

read -r -s -p "Tailscale OAuth client secret (tskey-client-..., hidden): " TS_SECRET; echo
case "$TS_SECRET" in tskey-client-*) ;; *) echo "Not a tskey-client-... secret." >&2; exit 1 ;; esac

WORK="$(mktemp -d)"; chmod 700 "$WORK"
JOINED=0

# Lightsail's short-lived SSH cert for the test box (independent of whatever
# keys this laptop has). Writes $WORK/k + $WORK/k-cert.pub, sets PUBLIC_IP.
get_access() {
  aws lightsail get-instance-access-details --region "$REGION" --instance-name "$NAME" --protocol ssh \
    --output json > "$WORK/access.json" || return 1
  python3 - "$WORK" <<'PY'
import json, os, sys
w = sys.argv[1]; d = json.load(open(f"{w}/access.json"))["accessDetails"]
open(f"{w}/k", "w").write(d["privateKey"]); os.chmod(f"{w}/k", 0o600)
open(f"{w}/k-cert.pub", "w").write(d["certKey"])
open(f"{w}/ip", "w").write(d["ipAddress"])
PY
  rm -f "$WORK/access.json"
  PUBLIC_IP="$(cat "$WORK/ip")"
}
# ssh_to <host> <cmd...>: as ubuntu, using the cert. Test box only, so a
# throwaway known_hosts is fine.
ssh_to() {
  local host="$1"; shift
  ssh -i "$WORK/k" -o CertificateFile="$WORK/k-cert.pub" -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15 -o LogLevel=ERROR "ubuntu@$host" "$@"
}

# On failure: pull the logs (secrets redacted) before the instance is deleted.
# Goes over the test box's public IP (new Lightsail instances allow :22 by
# default; prod does not), so it works even if the Tailnet join failed.
dump_logs() {
  say "Fetching logs from $NAME for diagnosis (tskey-* redacted)"
  get_access || return 0
  ssh_to "$PUBLIC_IP" \
    'sudo sh -c "echo --- aweborn-bootstrap.log; tail -n 60 /var/log/aweborn-bootstrap.log; echo --- cloud-init-output.log; tail -n 40 /var/log/cloud-init-output.log; echo --- tailscale; tailscale status 2>&1 | head -5; echo --- cloud-init; cloud-init status --long 2>&1 | head -8"' \
    2>&1 | sed -E 's/tskey-[A-Za-z0-9_?=&-]+/tskey-REDACTED/g' || echo "(could not SSH to the test box)"
}
cleanup() {
  if [[ "${KEEP:-0}" != 1 ]] && aws lightsail get-instance --region "$REGION" --instance-name "$NAME" >/dev/null 2>&1; then
    # Never leave a stale tag:server node behind, even if a check failed.
    if (( JOINED )); then
      say "Logging $NAME out of the Tailnet"
      { [[ -f "$WORK/k" ]] || get_access; } && ssh_to "$PUBLIC_IP" 'sudo tailscale logout' 2>/dev/null \
        && echo "  logged out (node key expired; it stays listed until deleted in the admin console)" || echo "  WARN: logout failed; delete $NAME in the Tailscale admin console (Machines)"
    fi
    say "Deleting test instance $NAME"
    aws lightsail delete-instance --region "$REGION" --instance-name "$NAME" >/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# Build the user-data: shebang + strict mode + log redirect, then the exact
# block from the template with the two !Sub variables filled in.
TS_SECRET="$TS_SECRET" NAME="$NAME" python3 - "$TPL" > "$WORK/user-data.sh" <<'PY'
import os, re, sys
src = open(sys.argv[1]).read()
m = re.search(r'^( *)# >>> tailscale-join.*?\n(.*?)^\1# <<< tailscale-join', src, re.S | re.M)
if not m:
    sys.exit("tailscale-join block not found in template")
indent = len(m.group(1))
body = "".join(l[indent:] if l.strip() else "\n" for l in m.group(2).splitlines(True))
leftover = set(re.findall(r'\$\{(?!!)([^}]+)\}', body)) - {"InstanceName", "TailscaleOAuthSecret"}
if leftover:
    sys.exit(f"unexpected !Sub variables in block: {leftover}")
body = body.replace("${InstanceName}", os.environ["NAME"]).replace("${TailscaleOAuthSecret}", os.environ["TS_SECRET"])
# The ONE deliberate difference from prod: test nodes are ephemeral, so
# Tailscale deletes them on its own once the instance is gone (prod servers
# stay persistent so an outage can't drop them off the Tailnet for good).
if body.count("ephemeral=false") != 1:
    sys.exit("expected exactly one 'ephemeral=false' in the join block")
body = body.replace("ephemeral=false", "ephemeral=true")
# Reuse the template's own header (shebang .. log redirect). It matters:
# Lightsail wraps user-data in its own /bin/sh launch script, so the shebang
# is ignored and the header's "re-exec under bash" prelude is what makes
# `set -o pipefail` work. A hand-written header here once hid exactly that.
h = re.search(r'UserData: !Sub \|\n(.*?^ *exec > /var/log/aweborn-bootstrap\.log 2>&1\n)', src, re.S | re.M)
if not h:
    sys.exit("UserData header not found in template")
hlines = h.group(1).splitlines(True)
hind = len(hlines[0]) - len(hlines[0].lstrip())
header = "".join(l[hind:] if l.strip() else "\n" for l in hlines)
if "${" in header.replace("${!", ""):
    sys.exit("unexpected !Sub variable in UserData header")
print(header + "echo \"=== tailscale-join test starting at $(date) ===\"\n" + body +
      "echo \"=== tailscale-join test complete at $(date) ===\"")
PY
unset TS_SECRET

say "Creating $NAME (nano, $AZ)"
aws lightsail create-instances --region "$REGION" --instance-names "$NAME" \
  --availability-zone "$AZ" --blueprint-id ubuntu_22_04 --bundle-id nano_3_0 \
  --user-data "file://$WORK/user-data.sh" >/dev/null
rm -f "$WORK/user-data.sh"

# Same IMDS hardening the prod stack applies (ImdsHardening custom resource;
# cfn-preview.sh guards it): IMDSv2 only, hop limit 1, so pods
# (one hop away) can't read the user-data.
say "Hardening IMDS on $NAME"
until [[ "$(aws lightsail get-instance --region "$REGION" --instance-name "$NAME" --query instance.state.name --output text)" == running ]]; do sleep 5; done
aws lightsail update-instance-metadata-options --region "$REGION" --instance-name "$NAME" \
  --http-tokens required --http-put-response-hop-limit 1 >/dev/null

say "Waiting for $NAME to appear in the Tailnet (up to 8 min)"
for i in $(seq 1 48); do
  if tailscale status --json | python3 -c '
import json, sys
peers = json.load(sys.stdin).get("Peer", {}).values()
sys.exit(0 if any(p.get("HostName") == sys.argv[1] or p.get("DNSName","").startswith(sys.argv[1] + ".") for p in peers) else 1)' "$NAME"; then
    break
  fi
  [[ $i == 48 ]] && { echo "FAIL: never joined." >&2; dump_logs; exit 1; }
  sleep 10
done
JOINED=1

tailscale status --json | python3 -c '
import json, sys
for p in json.load(sys.stdin).get("Peer", {}).values():
    if p.get("DNSName","").startswith(sys.argv[1] + "."):
        print("  node:", p["DNSName"], p.get("TailscaleIPs"), "tags:", p.get("Tags"))
        sys.exit(0 if p.get("Tags") == ["tag:server"] else "FAIL: expected tags [tag:server]")' "$NAME"

say "Checking the box over the Tailnet (ssh ubuntu@$NAME)"
get_access
for i in $(seq 1 12); do ssh_to "$NAME" true 2>/dev/null && break; sleep 10; done
ssh_to "$NAME" 'sudo bash -s' <<'REMOTE'
set -u
fail=0
for i in $(seq 1 60); do grep -q "test complete" /var/log/aweborn-bootstrap.log 2>/dev/null && break; sleep 5; done
echo "  bootstrap log tail:"; tail -n 3 /var/log/aweborn-bootstrap.log | sed -E 's/tskey-[A-Za-z0-9_?=&-]+/tskey-REDACTED/g; s/^/    /'
grep -q "test complete" /var/log/aweborn-bootstrap.log || { echo "  FAIL: bootstrap did not complete"; fail=1; }
if grep -rqs 'tskey-' /var/log/aweborn-bootstrap.log /var/log/cloud-init*.log; then echo "  FAIL: secret in logs"; fail=1; else echo "  ok: no secret in logs"; fi
if ls /root/.ts-authkey.* >/dev/null 2>&1; then echo "  FAIL: key file left behind"; fail=1; else echo "  ok: key file removed"; fi
if grep -rqs 'tskey-' /var/lib/cloud/; then echo "  FAIL: secret still under /var/lib/cloud"; fail=1; else echo "  ok: /var/lib/cloud scrubbed"; fi
ud=$(curl -s -m 3 http://169.254.169.254/latest/user-data || true)
if grep -q 'tskey-' <<<"$ud"; then echo "  FAIL: IMDSv1 (no token) serves the user-data"; fail=1; else echo "  ok: IMDSv1 closed (token required)"; fi
exit $fail
REMOTE

say "PASS. Cleanup expires the node and deletes the instance. Then delete $NAME in the Tailscale admin console (Machines); logout alone does not remove a tagged node."
