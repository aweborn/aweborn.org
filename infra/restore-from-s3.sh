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
#   4. Checks CI's pinned host key (repo variable VPS_KNOWN_HOST, read by
#      deploy.yml + backup.yml) against the box and offers to set it (gh).
#   5. Copies the backup to ~/restore/ on the box and runs
#      infra/backup/restore-sync-db.sh --check (verify only).
#   6. You type "restore"; the on-box script then asks its own y/N, moves the
#      current DB aside (never deletes it), installs the backup, checks /health.
#
# Test target (used by infra/test-dr-restore.sh): RESTORE_INSTANCE=<lightsail
# name> RESTORE_TSNAME=<tailnet name> point it at another box; the CI pin and
# the public health check (both about prod) are then skipped.
set -euo pipefail
# Discard keys typed while we waited (a stray Enter used to answer the next
# prompt with "" and silently decline; DR drill 2026-10-11).
drain_tty() { [[ -t 0 ]] || return 0; while read -r -s -t 1 -n 256 _; do :; done; }
cd "$(dirname "$0")/.."

STACK=aweborn-vps
REMOTE_RESTORE='~/aweborn/infra/backup/restore-sync-db.sh'
REPO=aweborn/aweborn.org   # CI host key pin lives in its repo variable VPS_KNOWN_HOST
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
TEST_TARGET=0
if [[ -n "${RESTORE_INSTANCE:-}" || -n "${RESTORE_TSNAME:-}" ]]; then
  [[ -n "${RESTORE_INSTANCE:-}" && -n "${RESTORE_TSNAME:-}" ]] || die "set both RESTORE_INSTANCE and RESTORE_TSNAME"
  [[ "$RESTORE_INSTANCE" != "$INSTANCE" && "$RESTORE_TSNAME" != "$TSNAME" ]] || die "test target must not be the prod box"
  INSTANCE="$RESTORE_INSTANCE"; TSNAME="$RESTORE_TSNAME"; TEST_TARGET=1
  echo "  TEST TARGET: $INSTANCE (Tailnet: $TSNAME); skipping CI pin + public checks"
fi

get_access() {   # writes cert, key, known_hosts into $WORK; fails until the box is up
  # Lightsail certs are valid ~13 min, so rsh refreshes them (see below).
  aws lightsail get-instance-access-details --instance-name "$INSTANCE" --protocol ssh \
    --output json > "$WORK/access.json" 2>/dev/null || return 1
  jq -e '.accessDetails.hostKeys | length > 0' "$WORK/access.json" >/dev/null || return 1
  ( umask 077
    jq -r '.accessDetails.privateKey' "$WORK/access.json" > "$WORK/k"
    jq -r '.accessDetails.certKey'    "$WORK/access.json" > "$WORK/k-cert.pub" )
  jq -r --arg h "$TSNAME" '.accessDetails.hostKeys[] | "\($h) \(.algorithm) \(.publicKey)"' \
    "$WORK/access.json" > "$WORK/known_hosts"
  rm -f "$WORK/access.json"   # holds the private key; keep only the split files
  ACCESS_AT=$(date +%s); set_ssh_opts
}
ACCESS_AT=0
SSH_OPTS=()
set_ssh_opts() {
  SSH_OPTS=(-i "$WORK/k" -o CertificateFile="$WORK/k-cert.pub" -o IdentitiesOnly=yes
    -o UserKnownHostsFile="$WORK/known_hosts" -o StrictHostKeyChecking=yes
    -o HostKeyAlias="$TSNAME" -o ConnectTimeout=10 -o LogLevel=ERROR
    -o ServerAliveInterval=10 -o ServerAliveCountMax=3)
}
# Fresh cert if the current one is >5 min old (a slow answer at a prompt
# used to expire it: "Permission denied (publickey)", drill 2026-10-11).
fresh_access() { (( $(date +%s) - ACCESS_AT < 300 )) || get_access || die "could not get Lightsail SSH access for $INSTANCE"; }
rsh() { fresh_access; ssh "${SSH_OPTS[@]}" "ubuntu@$TSNAME" "$@" </dev/null; }   # never eat our stdin (prompts)

# ── 3. Wait for the box (and its bootstrap) ───────────────────
say "Waiting for $INSTANCE (Tailnet: $TSNAME) to be up and bootstrapped (up to $BOOT_WAIT_MIN min)"
deadline=$(( $(date +%s) + BOOT_WAIT_MIN * 60 ))
state=""
while :; do
  if get_access; then
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
say "CI host key pin (repo variable VPS_KNOWN_HOST)"
if (( TEST_TARGET )); then
  echo "  skipped (test target)"
else
  current="$(gh variable get VPS_KNOWN_HOST -R "$REPO" 2>/dev/null || true)"
  if [[ "$current" == "$pin" ]]; then
    echo "  ok: CI already pins this box"
  else
    echo "  STALE (CI deploys/backups fail closed until updated)"
    echo "    current: ${current:-<unset>}"
    echo "    new    : $pin   (from the Lightsail API)"
    drain_tty; read -r -p "  Set the repo variable to the new pin now? [y/N] " a
    if [[ "$a" == [yY] ]]; then
      gh variable set VPS_KNOWN_HOST -R "$REPO" --body "$pin" >/dev/null \
        || die "gh variable set failed (gh auth status? needs repo admin)"
      [[ "$(gh variable get VPS_KNOWN_HOST -R "$REPO")" == "$pin" ]] || die "variable did not update"
      echo "  ok: VPS_KNOWN_HOST updated (no commit needed)"
    else
      echo "  Skipped. Set it before the next deploy/backup: gh variable set VPS_KNOWN_HOST -R $REPO --body '$pin'"
    fi
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
drain_tty; read -r -p 'Type "restore" to continue: ' ok
[[ "$ok" == restore ]] || { echo "Not confirmed. The backup stays in ~/restore/ on the box; nothing else changed."; exit 3; }
fresh_access
ssh -t "${SSH_OPTS[@]}" "ubuntu@$TSNAME" "$REMOTE_RESTORE ~/restore/$FILE"

(( TEST_TARGET )) && { echo; echo "Restore finished on test target $INSTANCE."; exit 0; }

say "Public check"
curl -sf --max-time 10 https://sync.aweborn.org/health && echo || echo "  sync.aweborn.org/health did not answer yet (DNS/Caddy); retry in a minute"
cat <<EOF

Done. Next:
  - gh workflow run backup.yml   (puts the restored DB back into S3; proves CI can reach the box)
EOF
