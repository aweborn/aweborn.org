#!/usr/bin/env bash
# Throwaway load-test box: a plain Lightsail instance the same size as prod
# (small_3_0, us-east-1a), running the sync-service PRODUCTION image built from
# your working tree. Nothing here touches the aweborn-vps stack, its static IP,
# DNS, the Tailnet or prod data. Ports 22 + 1234 are open to YOUR IP only.
#
#   scripts/loadtest/throwaway-vps.sh up        # create + build + run (~6 min)
#   scripts/loadtest/throwaway-vps.sh deploy    # rebuild from the working tree
#   scripts/loadtest/throwaway-vps.sh ip        # print its IP
#   scripts/loadtest/throwaway-vps.sh ssh [cmd] # shell / command on the box
#   scripts/loadtest/throwaway-vps.sh stats     # sample CPU/RAM every 5 s (Ctrl-C)
#   scripts/loadtest/throwaway-vps.sh down      # DELETE the instance (always do this)
#
# Then: node scripts/loadtest/bots.mjs --url http://$(scripts/loadtest/throwaway-vps.sh ip):1234 ...
# Cost: ~$0.02/hour while it exists.
set -euo pipefail
cd "$(dirname "$0")/../.."

NAME=aweborn-loadtest
ZONE=us-east-1a
BUNDLE=small_3_0
KEY="${TMPDIR:-/tmp}/aweborn-loadtest-key.pem"

[[ "$NAME" != aweborn-vps* ]] || { echo "refusing: name collides with prod" >&2; exit 1; }

key() {
  if [[ ! -s "$KEY" ]]; then
    aws lightsail download-default-key-pair --query privateKeyBase64 --output text > "$KEY"
    chmod 600 "$KEY"
  fi
}
ip() { aws lightsail get-instance --instance-name "$NAME" --query instance.publicIpAddress --output text; }
on() { key; ssh -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "ubuntu@$(ip)" "$@"; }

deploy() {
  key
  local host; host="$(ip)"
  echo "[throwaway] shipping build context to $host"
  tar --exclude node_modules --exclude dist --exclude '*.db*' -czf - \
      server/sync-service/package.json server/sync-service/package-lock.json server/sync-service/tsconfig.json \
      server/sync-service/src server/sync-service/scripts server/sync-service/Dockerfile shared \
    | on "rm -rf ~/ctx && mkdir -p ~/ctx && tar -xzf - -C ~/ctx"
  echo "[throwaway] building the production image on the box"
  on "cd ~/ctx && sudo docker build -q -f server/sync-service/Dockerfile --target production -t sync-loadtest . >/dev/null"
  # Fresh random secret: identity works (anonymous sign-in, chat) like prod.
  on "sudo docker rm -f sync >/dev/null 2>&1 || true
      sudo mkdir -p /data && sudo chown 1001:1001 /data
      sudo docker run -d --name sync --restart unless-stopped -p 1234:1234 -v /data:/data \
        -e BETTER_AUTH_SECRET=\$(openssl rand -hex 32) \
        -e BETTER_AUTH_URL=http://$host:1234 \
        -e CORS_ORIGINS=http://localhost:5173 \
        sync-loadtest >/dev/null"
  for _ in $(seq 30); do curl -sf "http://$host:1234/health" >/dev/null && { echo "[throwaway] up: http://$host:1234"; return; }; sleep 2; done
  echo "[throwaway] health check failed; logs:" >&2; on "sudo docker logs --tail 40 sync" >&2; exit 1
}

case "${1:-}" in
  up)
    if ! aws lightsail get-instance --instance-name "$NAME" >/dev/null 2>&1; then
      echo "[throwaway] creating $NAME ($BUNDLE, $ZONE)"
      aws lightsail create-instances --instance-names "$NAME" --availability-zone "$ZONE" \
        --blueprint-id ubuntu_22_04 --bundle-id "$BUNDLE" \
        --tags key=purpose,value=loadtest \
        --user-data '#!/bin/bash
curl -fsSL https://get.docker.com | sh' >/dev/null
    fi
    until [[ "$(aws lightsail get-instance --instance-name "$NAME" --query instance.state.name --output text)" == running ]]; do sleep 5; done
    me="$(curl -s https://checkip.amazonaws.com)/32"
    aws lightsail put-instance-public-ports --instance-name "$NAME" --port-infos \
      "fromPort=22,toPort=22,protocol=TCP,cidrs=$me" "fromPort=1234,toPort=1234,protocol=TCP,cidrs=$me" >/dev/null
    echo "[throwaway] waiting for ssh + docker"
    for _ in $(seq 60); do on "command -v docker >/dev/null && sudo docker info >/dev/null 2>&1" 2>/dev/null && break; sleep 5; done
    deploy
    ;;
  deploy) deploy ;;
  ip) ip ;;
  ssh) shift; on "$@" ;;
  stats) on 'while true; do echo "$(date +%T) $(sudo docker stats --no-stream --format "{{.CPUPerc}} {{.MemUsage}}" sync) | load $(cut -d" " -f1 /proc/loadavg) | steal $(top -bn1 | grep -o "[0-9.]* st" )"; sleep 5; done' ;;
  down)
    aws lightsail delete-instance --instance-name "$NAME" >/dev/null && echo "[throwaway] deleted $NAME"
    rm -f "$KEY"
    ;;
  *) sed -n 2,16p "$0"; exit 1 ;;
esac
