#!/usr/bin/env bash
# The one way to manage VPS secrets (k8s secret `aweborn-secrets`).
#
# Source of truth: your keys folder (Google Drive), one file per secret named
# AWEBORN_<KEY>.txt. The VPS holds a copy. `push all` rebuilds the VPS copy
# from the folder (e.g. after a rebuild); `status` shows drift without
# printing any value. Values never go on a command line or in shell history;
# they go to the VPS over SSH stdin. Inventory: SECRETS.md.
#
# Usage:
#   infra/set-secret.sh status                 # each key: in folder? on VPS? same value?
#   infra/set-secret.sh push KEY... | all      # folder -> VPS (restarts readers)
#   infra/set-secret.sh pull KEY... | all      # VPS -> folder, only where the folder has no file
#   infra/set-secret.sh set KEY                # paste a new value (hidden) -> folder -> VPS
#   infra/set-secret.sh generate BETTER_AUTH_SECRET   # only if it exists nowhere
#   infra/set-secret.sh google ~/Downloads/client_secret_….json
#   infra/set-secret.sh ses                    # new SES sender key; old ones deleted
#
# Keys folder: $AWEBORN_KEYS_DIR, else Google Drive for desktop's
#   ~/Library/CloudStorage/GoogleDrive-*/My Drive/users/alexander-medeiros/keys
set -euo pipefail
umask 077

VPS="${VPS:-ubuntu@aweborn-vps}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/lightsail-default.pem}"
NS=aweborn
SECRET=aweborn-secrets
SES_USER=aweborn-mail-sender
KEYS=(BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY LLM_API_KEY)

# Which deployment reads each key. Unknown keys are refused, so a typo can't
# create a stray secret.
deployment_for() {
  case "$1" in
    BETTER_AUTH_SECRET|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY) echo sync-service ;;
    LLM_API_KEY) echo agent-runner ;;
    *) echo "unknown key: $1 (known: ${KEYS[*]})" >&2; return 1 ;;
  esac
}

keys_dir() {
  if [[ -n "${AWEBORN_KEYS_DIR:-}" ]]; then echo "$AWEBORN_KEYS_DIR"; return; fi
  local d
  for d in "$HOME"/Library/CloudStorage/GoogleDrive-*/"My Drive/users/alexander-medeiros/keys"; do
    [[ -d "$d" ]] && { echo "$d"; return; }
  done
  echo "keys folder not found; set AWEBORN_KEYS_DIR" >&2; return 1
}
KDIR="$(keys_dir)"
file_for() { echo "$KDIR/AWEBORN_$1.txt"; }

# Value from the folder (trailing newlines stripped), or fail.
read_local() { local f; f="$(file_for "$1")"; [[ -s "$f" ]] || return 1; printf '%s' "$(<"$f")"; }

# Write the folder copy. Refuses to overwrite unless $2 = force.
write_local() {
  local f; f="$(file_for "$1")"
  if [[ -e "$f" && "${3:-}" != force ]]; then echo "$f already exists; not overwriting" >&2; return 1; fi
  printf '%s\n' "$2" > "$f"; chmod 600 "$f"
}

vps() { ssh -i "$SSH_KEY" -o BatchMode=yes "$VPS" "$@"; }
remote_hash() { vps "sudo k3s kubectl -n $NS get secret $SECRET -o jsonpath='{.data.$1}' | base64 -d | sha256sum | cut -c1-64; sudo k3s kubectl -n $NS get secret $SECRET -o jsonpath='{.data.$1}' | wc -c"; }
EMPTY_HASH=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

# Push KEY=VALUE pairs held in env vars named "$@", then restart each reader once.
push_env() {
  local deps
  deps="$(for k in "$@"; do deployment_for "$k"; done | sort -u | tr '\n' ' ')"
  node -e 'const d={};for(const k of process.argv.slice(1))d[k]=process.env[k];process.stdout.write(JSON.stringify({stringData:d}))' "$@" \
    | vps "sudo k3s kubectl -n $NS patch secret $SECRET --type merge --patch-file /dev/stdin >/dev/null \
        && for d in $deps; do sudo k3s kubectl -n $NS rollout restart deploy/\$d >/dev/null \
        && sudo k3s kubectl -n $NS rollout status deploy/\$d --timeout=180s; done"
  echo "✓ pushed: $*"
}

expand_all() { if [[ "${1:-}" == all ]]; then echo "${KEYS[*]}"; else echo "$*"; fi; }

cmd="${1:-}"; shift || true
case "$cmd" in
  status)
    echo "keys folder: $KDIR"
    for k in "${KEYS[@]}"; do
      lh=""; if v="$(read_local "$k")"; then lh="$(printf '%s' "$v" | shasum -a 256 | cut -c1-64)"; fi; unset v
      { read -r rh; read -r rlen; } < <(remote_hash "$k")
      on_vps=$([[ "$rh" != "$EMPTY_HASH" ]] && echo yes || echo no)
      if [[ -z "$lh" && "$on_vps" == no ]]; then s="— not set (optional?)"
      elif [[ -z "$lh" ]]; then s="⚠ on VPS only: back it up with 'pull $k'"
      elif [[ "$on_vps" == no ]]; then s="⚠ folder only: 'push $k'"
      elif [[ "$lh" == "$rh" ]]; then s="✓ in sync"
      else s="✗ DIFFERENT (folder vs VPS)"; fi
      printf '  %-22s %s\n' "$k" "$s"
    done
    ;;

  push)
    read -ra ks <<< "$(expand_all "$@")"; [[ ${#ks[@]} -gt 0 ]] || { echo "usage: push KEY... | all" >&2; exit 1; }
    sel=()
    for k in "${ks[@]}"; do
      deployment_for "$k" >/dev/null
      if v="$(read_local "$k")"; then export "$k=$v"; sel+=("$k")
      elif [[ "${1:-}" != all ]]; then echo "no file for $k: $(file_for "$k")" >&2; exit 1; fi
    done
    unset v; [[ ${#sel[@]} -gt 0 ]] || { echo "nothing to push" >&2; exit 1; }
    push_env "${sel[@]}"
    ;;

  pull)
    read -ra ks <<< "$(expand_all "$@")"; [[ ${#ks[@]} -gt 0 ]] || { echo "usage: pull KEY... | all" >&2; exit 1; }
    for k in "${ks[@]}"; do
      deployment_for "$k" >/dev/null
      f="$(file_for "$k")"
      if [[ -e "$f" ]]; then echo "  $k: folder already has it, skipped"; continue; fi
      v="$(vps "sudo k3s kubectl -n $NS get secret $SECRET -o jsonpath='{.data.$k}' | base64 -d")"
      if [[ -z "$v" || "$v" == REPLACE_ME ]]; then echo "  $k: not set on VPS, skipped"; continue; fi
      write_local "$k" "$v"; unset v; echo "  $k: saved to folder"
    done
    ;;

  set)
    key="${1:?usage: set KEY}"; deployment_for "$key" >/dev/null
    if [[ "$key" == BETTER_AUTH_SECRET ]]; then
      echo "Replacing BETTER_AUTH_SECRET signs every player out; anonymous players lose their identity for good." >&2
      read -r -p "Type 'replace' to continue: " ok; [[ "$ok" == replace ]] || exit 1
    fi
    read -r -s -p "Paste $key, then Enter: " v; echo
    [[ -n "$v" ]] || { echo "empty value, nothing changed" >&2; exit 1; }
    write_local "$key" "$v" force; export "$key=$v"; unset v
    push_env "$key"
    ;;

  generate)
    [[ "${1:-}" == BETTER_AUTH_SECRET ]] || { echo "usage: generate BETTER_AUTH_SECRET" >&2; exit 1; }
    [[ ! -e "$(file_for BETTER_AUTH_SECRET)" ]] || { echo "folder already has BETTER_AUTH_SECRET; use 'push'" >&2; exit 1; }
    { read -r rh; read -r _; } < <(remote_hash BETTER_AUTH_SECRET)
    [[ "$rh" == "$EMPTY_HASH" ]] || { echo "VPS already has BETTER_AUTH_SECRET; use 'pull' to back it up" >&2; exit 1; }
    BETTER_AUTH_SECRET="$(openssl rand -base64 32)"; export BETTER_AUTH_SECRET
    write_local BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
    push_env BETTER_AUTH_SECRET
    ;;

  google)
    json="$(realpath "${1:?usage: google path/to/client_secret.json}")"
    GOOGLE_CLIENT_ID="$(node -e 'const j=require(process.argv[1]);process.stdout.write((j.web||j.installed).client_id)' "$json")"
    GOOGLE_CLIENT_SECRET="$(node -e 'const j=require(process.argv[1]);process.stdout.write((j.web||j.installed).client_secret)' "$json")"
    export GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
    write_local GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID" force
    write_local GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET" force
    push_env GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
    echo "Now delete $json"
    ;;

  ses)
    old="$(aws iam list-access-keys --user-name "$SES_USER" --query 'AccessKeyMetadata[].AccessKeyId' --output text)"
    creds="$(aws iam create-access-key --user-name "$SES_USER" --query '[AccessKey.AccessKeyId,AccessKey.SecretAccessKey]' --output text)"
    AWS_ACCESS_KEY_ID="${creds%%$'\t'*}"; AWS_SECRET_ACCESS_KEY="${creds#*$'\t'}"; unset creds
    export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    write_local AWS_ACCESS_KEY_ID "$AWS_ACCESS_KEY_ID" force
    write_local AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY" force
    push_env AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    for k in $old; do aws iam delete-access-key --user-name "$SES_USER" --access-key-id "$k"; echo "  deleted old key ${k:0:8}…"; done
    ;;

  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
