#!/usr/bin/env bash
# AWS move (docs/aws-move.md, step 5): move the VPS (sync + gen-AI + agent-runner)
# into the Aweborn account by backup and restore. Sync and gen-AI are down from
# "freeze" until "restore" finishes (~30-45 min). Run in a real Terminal: the
# restore step asks questions.
#
#   infra/move/move-vps.sh freeze    # old box: stop sync-service (no edits are lost),
#                                    # snapshot, backup.yml, copy that backup to the new
#                                    # account, then you delete the old Tailscale node
#   infra/move/move-vps.sh build     # new account: aweborn-vps stack (aweborn-vps-4),
#                                    # point sync/api at its static IP
#   infra/move/move-vps.sh restore   # wait for bootstrap, restore world DB + keys +
#                                    # gen-AI catalogue, CI variables, deploy, backup
#
# Each part checks before it acts and can be re-run. The old box isn't deleted:
# it's stopped in step 7 of docs/aws-move.md.
# Profiles: "aweborn" = new account (SSO), "default" = old account.
set -euo pipefail
cd "$(dirname "$0")/../.."
NEW=aweborn; OLD=default; REPO=aweborn/aweborn.org; NS=aweborn
ZONE=Z08362011L7H2GNY83C20; NEW_NAME=aweborn-vps-4
KEYS="${AWEBORN_KEYS_DIR:-$HOME/keys}"
OLD_SSH=(ssh -i "$KEYS/AWEBORN_VPS_ADMIN_SSH_KEY.pem" -o BatchMode=yes ubuntu@aweborn-vps)
say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }
confirm() { local a; read -r -p "$1 Type '$2': " a; [[ $a == "$2" ]] || die "stopped"; }
acct() { aws sts get-caller-identity --profile "$1" --query Account --output text 2>/dev/null; }
[[ $(acct $NEW) == 285037497167 ]] || die "profile $NEW isn't signed in (aws sso login --profile aweborn)"
watch_run() { # workflow [extra gh args]
  local wf=$1; shift
  gh workflow run "$wf" -R $REPO "$@"; sleep 8
  gh run watch -R $REPO "$(gh run list -R $REPO --workflow "$wf" --event workflow_dispatch -L 1 --json databaseId -q '.[0].databaseId')" --exit-status
}

case "${1:-}" in
freeze)
  [[ $(acct $OLD) == 111551045759 ]] || die "profile $OLD isn't signed in (aws login)"
  tailscale status >/dev/null 2>&1 || die "Tailscale is down on this Mac (tailscale up)"
  "${OLD_SSH[@]}" true || die "can't SSH to the old box (ubuntu@aweborn-vps)"
  confirm "Stop sync + gen-AI on the OLD box (outage starts now)?" freeze

  say "1. Old box: stop sync-service and gen-AI so nothing changes after the snapshot"
  "${OLD_SSH[@]}" "sudo k3s kubectl -n $NS scale deploy/sync-service deploy/genai-service --replicas=0 \
    && sudo k3s kubectl -n $NS rollout status deploy/sync-service --timeout=120s"

  say "2. Old box: final on-box snapshot"
  job="sync-backup-move-$(date +%s)"
  "${OLD_SSH[@]}" "sudo k3s kubectl -n $NS create job --from=cronjob/sync-backup $job \
    && sudo k3s kubectl -n $NS wait --for=condition=complete job/$job --timeout=600s \
    && sudo cat /var/lib/aweborn/backups/sync/latest.json"

  say "3. backup.yml: off-box copy into the OLD account's bucket (still the CI target)"
  watch_run backup.yml

  say "4. Copy that backup into the new account's bucket"
  OB="aweborn-backups-111551045759"; NB="aweborn-backups-285037497167"
  key=$(aws s3 ls "s3://$OB/sync/" --profile $OLD --recursive | grep '\.db\.gz$' | sort | tail -1 | awk '{print $4}')
  [[ -n $key ]] || die "no backup found in $OB"
  w=$(mktemp -d); trap 'rm -rf "$w"' EXIT
  aws s3 cp --only-show-errors "s3://$OB/$key" "$w/b.db.gz" --profile $OLD
  gzip -t "$w/b.db.gz"
  aws s3 cp --only-show-errors "$w/b.db.gz" "s3://$NB/$key" --profile $NEW
  echo "  copied $key ($(wc -c <"$w/b.db.gz" | tr -d ' ') bytes)"

  say "5. Tailscale"
  echo "  Open https://login.tailscale.com/admin/machines and DELETE the machine named 'aweborn-vps'"
  echo "  (the old box). Otherwise the new box joins as 'aweborn-vps-1' and CI can't find it."
  confirm "Deleted it?" deleted
  echo; echo "Next: infra/move/move-vps.sh build"
  ;;

build)
  [[ $(acct $OLD) == 111551045759 ]] || die "profile $OLD isn't signed in (aws login)"
  if ! aws cloudformation describe-stacks --profile $NEW --stack-name aweborn-vps >/dev/null 2>&1; then
    oldp() { aws cloudformation describe-stacks --profile $OLD --stack-name aweborn-vps --query "Stacks[0].Parameters[?ParameterKey=='$1'].ParameterValue | [0]" --output text; }
    BUNDLE=$(oldp InstanceBundle); AZ=$(oldp AvailabilityZone); TSHOST=$(oldp TailnetHostname)
    echo "Copying from the old stack: bundle=$BUNDLE az=$AZ tailnet=$TSHOST; new instance name $NEW_NAME"
    say "1. Creating aweborn-vps in the new account"
    w=$(mktemp -d); chmod 700 "$w"; trap 'rm -rf "$w"' EXIT
    ( umask 077; KEYF="$KEYS/AWEBORN_TAILSCALE_OAUTH_SECRET.txt" B="$BUNDLE" A="$AZ" T="$TSHOST" N="$NEW_NAME" Z="$ZONE" python3 -c '
import json,os; e=os.environ
p={"HostedZoneId":e["Z"],"ManageDnsRecords":"false","InstanceBundle":e["B"],"AvailabilityZone":e["A"],
   "InstanceName":e["N"],"TailnetHostname":e["T"],"TailscaleOAuthSecret":open(e["KEYF"]).read().strip()}
print(json.dumps([{"ParameterKey":k,"ParameterValue":v} for k,v in p.items()]))' > "$w/p.json" )
    aws cloudformation create-stack --profile $NEW --stack-name aweborn-vps --template-body file://infra/cloudformation-vps.yml \
      --capabilities CAPABILITY_NAMED_IAM --parameters "file://$w/p.json" \
      --stack-policy-body file://infra/cloudformation-vps.stack-policy.json --query StackId --output text
    aws cloudformation wait stack-create-complete --profile $NEW --stack-name aweborn-vps \
      || { aws cloudformation describe-stack-events --profile $NEW --stack-name aweborn-vps \
           --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" --output text | head -5; exit 1; }
  else echo "aweborn-vps already exists in the new account"; fi

  say "2. sync + api -> the new static IP"
  IP=$(aws lightsail get-static-ip --profile $NEW --static-ip-name aweborn-vps-ip --query staticIp.ipAddress --output text)
  for n in sync.aweborn.org. api.aweborn.org.; do
    aws route53 change-resource-record-sets --profile $NEW --hosted-zone-id $ZONE --query ChangeInfo.Status --output text --change-batch \
      "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$n\",\"Type\":\"A\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$IP\"}]}}]}"
  done
  echo "  sync/api -> $IP. The box is bootstrapping (~10-15 min)."
  echo; echo "Next: infra/move/move-vps.sh restore"
  ;;

restore)
  export AWS_PROFILE=$NEW
  say "1. World DB from the new account's backups (waits for the bootstrap; answer its questions)"
  infra/restore-from-s3.sh

  say "2. Trust the new box from this Mac (host key from the CI pin restore-from-s3 just set)"
  ssh-keygen -R aweborn-vps >/dev/null 2>&1 || true
  gh variable get VPS_KNOWN_HOST -R $REPO >> ~/.ssh/known_hosts

  say "3. Runtime keys -> new box (same BETTER_AUTH_SECRET, so nobody is signed out)"
  infra/set-secret.sh push all

  say "4. Gen-AI catalogue (right after the keys: gen-AI uploads its own backup ~2 min after start)"
  infra/restore-genai-db.sh

  say "5. CI -> new account (backups + infra check)"
  for pair in AWS_BACKUP_ROLE_ARN:aweborn-backups:RoleArn AWS_INFRA_PREVIEW_ROLE_ARN:aweborn-ci:RoleArn; do
    IFS=: read -r var st key <<<"$pair"
    v=$(aws cloudformation describe-stacks --stack-name "$st" --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue | [0]" --output text)
    [[ $v == arn:aws:iam::285037497167:* ]] || die "$st has no $key output"
    gh variable set "$var" -R $REPO --body "$v"
  done

  say "6. Deploy every service to the new box"
  watch_run deploy.yml -f services=all

  say "7. First snapshot on the new box, then backup.yml into the new bucket"
  ssh -i "$KEYS/AWEBORN_VPS_ADMIN_SSH_KEY.pem" -o BatchMode=yes ubuntu@aweborn-vps \
    "j=sync-backup-first-\$(date +%s); sudo k3s kubectl -n $NS create job --from=cronjob/sync-backup \$j \
     && sudo k3s kubectl -n $NS wait --for=condition=complete job/\$j --timeout=600s && sudo cat /var/lib/aweborn/backups/sync/latest.json"
  watch_run backup.yml

  say "8. Health"
  for u in https://sync.aweborn.org/health https://api.aweborn.org/health https://sync.aweborn.org/api/auth/methods; do
    echo "  $u -> $(curl -s -o /dev/null -m 10 -w '%{http_code}' "$u")"
  done
  echo; echo "Check latest.json above shows your real world count (not \"worlds\": 0), then play a bit."
  ;;

*) echo "usage: $0 freeze|build|restore" >&2; exit 1 ;;
esac
