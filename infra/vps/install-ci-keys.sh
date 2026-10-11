#!/usr/bin/env bash
# Install the restricted GitHub Actions SSH keys (infra/vps/ci-authorized-keys)
# into ~ubuntu/.ssh/authorized_keys. Idempotent.
#
# - Refuses any key line that isn't locked down (Tailnet-only `from=`,
#   `restrict`, forced `command=` inside the repo checkout). Fails closed.
# - Replaces only the lines it manages (comment starting `github-actions-`);
#   every other line (e.g. the Lightsail default key) is kept as is.
# - Backs up the old file, writes atomically, mode 600, owned by ubuntu.
#
# Runs from the VPS bootstrap (UserData, as root) and by hand after a rotation:
#   sudo ~/aweborn/infra/vps/install-ci-keys.sh            # apply
#   sudo ~/aweborn/infra/vps/install-ci-keys.sh --check    # report only, exit 1 if out of date
set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/aweborn}"
SRC="${SRC:-$REPO_DIR/infra/vps/ci-authorized-keys}"
USER_NAME="${USER_NAME:-ubuntu}"                     # overridable for tests only
DEST="${DEST:-/home/$USER_NAME/.ssh/authorized_keys}" # overridable for tests only
# Forced commands must point into the live checkout, whatever SRC/REPO_DIR is.
CMD_ROOT=/home/ubuntu/aweborn/infra
CHECK=0; [[ "${1:-}" == --check ]] && CHECK=1

[[ -f "$SRC" ]] || { echo "missing $SRC" >&2; exit 1; }

# Every non-comment line must match this exactly (modulo key + command path).
re='^from="100\.64\.0\.0/10,fd7a:115c:a1e0::/48",restrict,command="'"$CMD_ROOT"'/[a-z0-9/_-]+\.sh" ssh-ed25519 [A-Za-z0-9+/=]+ github-actions-[A-Za-z0-9@._-]+$'
mapfile -t want < <(grep -v -E '^[[:space:]]*(#|$)' "$SRC")
(( ${#want[@]} > 0 )) || { echo "no keys in $SRC" >&2; exit 1; }
for l in "${want[@]}"; do
  if ! [[ "$l" =~ $re ]]; then
    echo "REFUSING: a line in $SRC is not locked down (Tailnet from=, restrict, forced command in $CMD_ROOT):" >&2
    echo "  ${l:0:120}..." >&2
    exit 1
  fi
done

touch_dest=0; [[ -f "$DEST" ]] || touch_dest=1
current=""; [[ -f "$DEST" ]] && current="$(cat "$DEST")"
kept="$(printf '%s\n' "$current" | grep -v -E ' github-actions-[A-Za-z0-9@._-]+$' | grep -v '^$' || true)"
new="$( { [[ -n "$kept" ]] && printf '%s\n' "$kept"; printf '%s\n' "${want[@]}"; } )"

if [[ "$new" == "$current" ]]; then
  echo "CI keys up to date (${#want[@]} managed lines)."
  exit 0
fi
if (( CHECK )); then
  echo "CI keys OUT OF DATE in $DEST (run without --check to install)."
  exit 1
fi

install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$(dirname "$DEST")"
(( touch_dest )) || cp -p "$DEST" "$DEST.bak-$(date +%s)"
tmp="$(mktemp "$(dirname "$DEST")/.authorized_keys.XXXXXX")"
printf '%s\n' "$new" > "$tmp"
chown "$USER_NAME:$USER_NAME" "$tmp"; chmod 600 "$tmp"
mv -f "$tmp" "$DEST"
echo "Installed ${#want[@]} CI key line(s) into $DEST (other lines kept: $(printf '%s' "$kept" | grep -c . || true))."
