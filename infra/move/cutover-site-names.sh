#!/usr/bin/env bash
# AWS move (docs/aws-move.md, step 2b, "brief outage" route): detach aweborn.org
# and www.aweborn.org from the old account's CloudFront site, attach them to the
# new one, and point DNS at it. associate-alias refuses cross-account moves while
# the source site is enabled (2026-11-22), so this is the plain way round.
# Expect a few minutes of errors on aweborn.org while CloudFront rolls the new
# names out to its edges. sync.aweborn.org is not touched.
#
# Undo: run the same steps the other way: set AttachAliases=false on the new
# stack, then put the saved old config back:
#   aws cloudfront update-distribution --profile default --id E3Q49I3A6Q6RH \
#     --if-match <current ETag> --distribution-config file://.migration/old-site-config-before.json
# and UPSERT the A records back to dicg1f6sshyqf.cloudfront.net.
#
# Profiles: "aweborn" = new account (SSO), "default" = old account.
set -euo pipefail
cd "$(dirname "$0")/../.."
NEW=aweborn; OLD=default; OLD_DIST=E3Q49I3A6Q6RH
ZONE=Z08362011L7H2GNY83C20; CF_ZONE=Z2FDTNDATAQYW2
[[ $(aws sts get-caller-identity --profile $NEW --query Account --output text) == 285037497167 ]] || { echo "profile $NEW is not the Aweborn account"; exit 1; }
[[ $(aws sts get-caller-identity --profile $OLD --query Account --output text) == 111551045759 ]] || { echo "profile $OLD is not the old account (run: aws login)"; exit 1; }
out() { aws cloudformation describe-stacks --profile $NEW --stack-name aweborn-website --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text; }
DIST=$(out DistributionId); DOMAIN=$(out DistributionDomainName)
[[ $(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/") == 200 ]] || { echo "New site $DOMAIN isn't serving 200: stop."; exit 1; }
echo "Old site: $OLD_DIST    New site: $DIST ($DOMAIN)"

mkdir -p .migration
aws cloudfront get-distribution-config --profile $OLD --id $OLD_DIST > .migration/old-site-get.json
python3 -c 'import json;json.dump(json.load(open(".migration/old-site-get.json"))["DistributionConfig"],open(".migration/old-site-config-before.json","w"),indent=1)'
echo "Saved the old site's config to .migration/old-site-config-before.json (for undo)."

read -r -p "Start the cutover (a few minutes of errors on aweborn.org)? Type 'cutover': " ok
[[ $ok == cutover ]] || { echo "Stopped; nothing changed."; exit 1; }

echo "== 1. Old site lets go of the names"
ETAG=$(python3 -c 'import json;print(json.load(open(".migration/old-site-get.json"))["ETag"])')
python3 - <<'EOF'
import json
c=json.load(open(".migration/old-site-config-before.json"))
c["Aliases"]={"Quantity":0}
# Without names it must use CloudFront's own certificate (it still serves at its d....cloudfront.net address).
c["ViewerCertificate"]={"CloudFrontDefaultCertificate":True,"MinimumProtocolVersion":"TLSv1"}
json.dump(c,open(".migration/old-site-config-after.json","w"),indent=1)
EOF
aws cloudfront update-distribution --profile $OLD --id $OLD_DIST --if-match "$ETAG" \
  --distribution-config file://.migration/old-site-config-after.json --query 'Distribution.Status' --output text
START=$(date +%s)
sleep 30   # let CloudFront release the names before the new site claims them

echo "== 2. New site takes the names (stack update AttachAliases=true)"
params=$(aws cloudformation describe-stacks --profile $NEW --stack-name aweborn-website --query 'Stacks[0].Parameters[].ParameterKey' --output text \
  | tr '\t' '\n' | grep -v '^AttachAliases$' | sed 's/.*/ParameterKey=&,UsePreviousValue=true/' | tr '\n' ' ')
aws cloudformation update-stack --profile $NEW --stack-name aweborn-website --use-previous-template \
  --capabilities CAPABILITY_NAMED_IAM --parameters ParameterKey=AttachAliases,ParameterValue=true $params --query StackId --output text

echo "== 3. DNS -> new site"
for n in aweborn.org. www.aweborn.org.; do
  aws route53 change-resource-record-sets --profile $NEW --hosted-zone-id $ZONE --query ChangeInfo.Status --output text --change-batch \
    "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$n\",\"Type\":\"A\",\"AliasTarget\":{\"HostedZoneId\":\"$CF_ZONE\",\"DNSName\":\"$DOMAIN.\",\"EvaluateTargetHealth\":false}}}]}"
done

echo "== 4. Waiting for the stack (CloudFront rollout, usually 3-10 min)"
aws cloudformation wait stack-update-complete --profile $NEW --stack-name aweborn-website \
  || { echo "Stack update failed:"; aws cloudformation describe-stack-events --profile $NEW --stack-name aweborn-website \
       --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" --output text | head -5; exit 1; }
aws cloudfront get-distribution --profile $NEW --id "$DIST" --query 'Distribution.DistributionConfig.Aliases.Items' --output text

echo "== 5. Checking the site"
for i in $(seq 1 30); do
  a=$(curl -s -o /dev/null -w '%{http_code}' https://aweborn.org/); w=$(curl -s -o /dev/null -w '%{http_code}' https://www.aweborn.org/)
  echo "  $(( $(date +%s) - START ))s: aweborn.org $a, www $w"
  [[ $a == 200 && $w == 200 ]] && { echo "Done: aweborn.org is served from the new account."; exit 0; }
  sleep 20
done
echo "Still not 200 after 10 more minutes: tell Claude before undoing."
