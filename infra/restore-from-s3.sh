#!/usr/bin/env bash
# Restore the prod world DB from an off-box S3 backup onto the VPS.
# Run on your Mac (needs: aws login, jq, Tailscale up). Usual case: right
# after infra/rebuild-vps.sh, but it works on any running box.
#
#   infra/restore-from-s3.sh                 # newest backup in S3
#   infra/restore-from-s3.sh <s3-key>        # a specific one, e.g. sync/2026/10/universe-20261011T170703Z.db.gz
#   infra/restore-from-s3.sh --list          # show the 15 newest backups and exit
#
# What it does:
#   1. Downloads the backup and tests the gzip.
#   2. Gets the box's SSH host keys from the Lightsail API (AWS-authenticated,
#      so no trust-on-first-use) and a short-lived Lightsail SSH cert (no
#      local key file needed). SSH goes over the Tailnet only.
#   3. Waits for the bootstrap to finish (fresh box).
#   4. Checks CI's pinned host key (VPS_KNOWN_HOST in deploy.yml + backup.yml)
#      against the box and offers to update both files (you commit + push).
#   5. Copies the backup to ~/restore/ on the box and runs
#      infra/backup/restore-sync-db.sh --check (verify only).
#   6. You type "restore"; the on-box script then asks its own y/N, moves the
#      current DB aside (never deletes it), installs the backup, checks /health.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK=aweborn-vps
REMOTE_RESTORE='~/aweborn/infra/backup/restore-sync-db.sh'
WORKFLOWS=(.github/workflows/deploy.yml .github/workflows/backup.yml)
BOOT_WAIT_MIN=25

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

bucket="aweborn-backups-$(aws sts get-caller-identity --query Account --output text)" \
  || die "aws not logged in (run: aws login)"
list_backups() {
  aws s3 ls "s3://$bucket/sync/" --recursive | grep '\.db\.gz$' | sort | awk '{print $1" "$2"  "$3" B  "$4}'
}

if [[ "${1:-}" == "--list" ]]; then
  list_backups | tail -15; exit 0
fi

# ── 1. Pick + download the backup ─────────────────────────────
if [[ -n "${1:-}" ]]; then
  KEY="$1"
else
  KEY="$(list_backups | tail -1 | awk '{print $NF}')"
  [[ -n "$KEY" ]] || die "no backups found in s3://$bucket/sync/"
fi
[[ "$KEY" =~ ^sync/[0-9]{4}/[0-9]{2}/universe-[0-9]{8}T[0-9]{6}Z\.db\.gz$ ]] \
  || die "unexpected key '$KEY' (want sync/YYYY/MM/universe-<UTC>.db.gz; see --list)"
FILE="$(basename "$KEY")"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
say "Downloading s3://$bucket/$KEY"
aws s3 cp --only-show-errors "s3://$bucket/$KEY" "$WORK/$FILE"
gzip -t "$WORK/$FILE" || die "backup is not a valid gzip"
echo "  $(wc -c <"$WORK/$FILE" | tr -d ' ') bytes, sha256 $(shasum -a 256 "$WORK/$FILE" | cut -c1-16)…"

# ── 2. Which box, and how to SSH to it safely ─────────────────
params="$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Parameters' --output json)"
INSTANCE="$(jq -r 'map(select(.ParameterKey=="InstanceName"))[0].ParameterValue // "aweborn-vps"' <<<"$params")"
TSNAME="$(jq -r 'map(select(.ParameterKey=="TailnetHostname"))[0].ParameterValue // "aweborn-vps"' <<<"$params")"

get_access() {   # writes cert, key, known_hosts into $WORK; fails until the box is up
  aws lightsail get-instance-access-details --instance-name "$INSTANCE" --protocol ssh \
    --output json > "$WORK/access.json" 2>/dev/null || return 1
  jq -e '.accessDetails.hostKeys | length > 0' "$WORK/access.json" >/dev/null || return 1
  ( umask 077
    jq -r '.accessDetails.privateKey' "$WORK/access.json" > "$WORK/k"
    jq -r '.accessDetails.certKey'    "$WORK/access.json" > "$WORK/k-cert.pub" )
  jq -r --arg h "$TSNAME" '.accessDetails.hostKeys[] | "\($h) \(.algorithm) \(.publicKey)"' \
    "$WORK/access.json" > "$WORK/known_hosts"
  rm -f "$WORK/access.json"   # holds the private key; keep only the split files
}
SSH_OPTS=()
set_ssh_opts() {
  SSH_OPTS=(-i "$WORK/k" -o CertificateFile="$WORK/k-cert.pub" -o IdentitiesOnly=yes
    -o UserKnownHostsFile="$WORK/known_hosts" -o StrictHostKeyChecking=yes
    -o HostKeyAlias="$TSNAME" -o ConnectTimeout=10 -o LogLevel=ERROR)
}
rsh() { ssh "${SSH_OPTS[@]}" "ubuntu@$TSNAME" "$@" </dev/null; }   # never eat our stdin (prompts)

# ── 3. Wait for the box (and its bootstrap) ───────────────────
say "Waiting for $INSTANCE (Tailnet: $TSNAME) to be up and bootstrapped (up to $BOOT_WAIT_MIN min)"
deadline=$(( $(date +%s) + BOOT_WAIT_MIN * 60 ))
state=""
while :; do
  if get_access; then
    set_ssh_opts
    state="$(rsh 'if sudo grep -q "bootstrap complete" /var/log/aweborn-bootstrap.log 2>/dev/null; then echo done;
                  elif sudo grep -q "^!!!" /var/log/aweborn-bootstrap.log 2>/dev/null; then echo aborted;
                  else echo running; fi' 2>/dev/null || echo unreachable)"
  else
    state="no-access-yet"
  fi
  case "$state" in
    done) echo "  bootstrap complete"; break ;;
    aborted) rsh 'sudo grep "^!!!" /var/log/aweborn-bootstrap.log' || true
             die "the bootstrap aborted (see above / /var/log/aweborn-bootstrap.log)" ;;
  esac
  (( $(date +%s) < deadline )) || die "gave up waiting (last state: $state). If 'unreachable': is your Tailscale up, and is the box in Machines as $TSNAME (not $TSNAME-1)?"
  printf '  %s…\r' "$state"; sleep 20
done

# ── 4. CI's pinned host key ───────────────────────────────────
pk="$(awk '$2=="ssh-ed25519"{print $3}' "$WORK/known_hosts")"
[[ -n "$pk" ]] || die "box has no ed25519 host key?"
pin="$TSNAME ssh-ed25519 $pk"
say "CI host key pin (VPS_KNOWN_HOST)"
stale=()
for f in "${WORKFLOWS[@]}"; do
  grep -qF "VPS_KNOWN_HOST: $pin" "$f" || stale+=("$f")
done
if (( ${#stale[@]} == 0 )); then
  echo "  ok: deploy.yml + backup.yml already pin this box"
else
  echo "  STALE in: ${stale[*]} (CI deploys/backups fail closed until updated)"
  echo "  new pin (from the Lightsail API): $pin"
  read -r -p "  Update both workflow files now? [y/N] " a
  if [[ "$a" == [yY] ]]; then
    for f in "${WORKFLOWS[@]}"; do
      NEWPIN="$pin" perl -pi -e 's|^(\s*VPS_KNOWN_HOST:).*|$1 $ENV{NEWPIN}|' "$f"
    done
    git --no-pager diff --stat -- "${WORKFLOWS[@]}"
    echo "  Updated. Commit + push them (git commit -am 'ci: pin new VPS host key' && git push)."
  else
    echo "  Skipped. Do it before the next deploy/backup (HANDOFF -> Rebuilding the VPS, step 6)."
  fi
fi

# ── 5. Copy + verify on the box ───────────────────────────────
say "Copying $FILE to $TSNAME:~/restore/ and verifying it there (--check)"
rsh 'mkdir -p ~/restore'
scp "${SSH_OPTS[@]}" -q "$WORK/$FILE" "ubuntu@$TSNAME:restore/$FILE"
rsh "$REMOTE_RESTORE --check ~/restore/$FILE"

# ── 6. Restore ────────────────────────────────────────────────
booted="$(rsh 'uptime -s')"
cat <<EOF

About to replace the live world DB on $INSTANCE (up since $booted UTC)
with $KEY.
The current DB is moved aside to /var/lib/aweborn/sync-data/pre-restore-<ts>/
(not deleted). Players are disconnected for ~30s.
EOF
read -r -p 'Type "restore" to continue: ' ok
[[ "$ok" == restore ]] || { echo "Not confirmed. The backup stays in ~/restore/ on the box; nothing else changed."; exit 0; }
ssh -t "${SSH_OPTS[@]}" "ubuntu@$TSNAME" "$REMOTE_RESTORE ~/restore/$FILE"

say "Public check"
curl -sf --max-time 10 https://sync.aweborn.org/health && echo || echo "  sync.aweborn.org/health did not answer yet (DNS/Caddy); retry in a minute"
cat <<EOF

Done. Next:
  - Commit + push the host key pin if it was updated above.
  - gh workflow run backup.yml   (puts the restored DB back into S3; proves CI can reach the box)
EOF
