#!/usr/bin/env bash
# AWS move (docs/aws-move.md, step 2b): fill the new website bucket, then move
# aweborn.org + www.aweborn.org from the old account's CloudFront site to the
# new one with no downtime.
#
# CloudFront picks the distribution by host name, so the moment associate-alias
# runs, requests still arriving at the OLD site's edge addresses are served by
# the NEW distribution. DNS is pointed at the new site afterwards.
#
# Undo (from the old account): put TXT _.aweborn.org / _www.aweborn.org =
# "dicg1f6sshyqf.cloudfront.net" in the zone, then
#   aws cloudfront associate-alias --profile default --target-distribution-id E3Q49I3A6Q6RH --alias aweborn.org   (and www)
# and UPSERT the A records back to dicg1f6sshyqf.cloudfront.net.
#
# Profiles: "aweborn" = new account (SSO), "default" = old account (read only here).
set -euo pipefail
cd "$(dirname "$0")/../.."
P=aweborn; ZONE=Z08362011L7H2GNY83C20; CF_ZONE=Z2FDTNDATAQYW2; OLD_DIST=E3Q49I3A6Q6RH
[[ $(aws sts get-caller-identity --profile $P --query Account --output text) == 285037497167 ]] || { echo "profile $P is not the Aweborn account"; exit 1; }
out() { aws cloudformation describe-stacks --profile $P --stack-name aweborn-website --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text; }
DIST=$(out DistributionId); DOMAIN=$(out DistributionDomainName)
echo "New site: $DIST ($DOMAIN)"

upsert() { # name type value-json
  local id; id=$(aws route53 change-resource-record-sets --profile $P --hosted-zone-id $ZONE --change-batch "$(cat <<EOF
{"Changes":[{"Action":"UPSERT","ResourceRecordSet":$1}]}
EOF
)" --query ChangeInfo.Id --output text)
  aws route53 wait resource-record-sets-changed --profile $P --id "$id"; }

# 1. Deploys go to the new bucket from now on (the live site is unaffected until step 3).
if [[ $(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/") == 200 ]]; then
  echo "== 1. New site already serving: skipping the deploy"
else
echo "== 1. GitHub deploys -> new account"
gh variable set AWS_DEPLOY_ROLE_ARN -R aweborn/aweborn.org --body arn:aws:iam::285037497167:role/aweborn-github-deploy
gh variable set SITE_BUCKET -R aweborn/aweborn.org --body aweborn-website-285037497167
gh variable set CLOUDFRONT_DISTRIBUTION_ID -R aweborn/aweborn.org --body "$DIST"
gh workflow run deploy.yml -R aweborn/aweborn.org -f services=none; sleep 8   # site only, no server redeploy
gh run watch -R aweborn/aweborn.org "$(gh run list -R aweborn/aweborn.org --workflow deploy.yml --event workflow_dispatch -L 1 --json databaseId -q '.[0].databaseId')" --exit-status
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/")
echo "New site answers $code at https://$DOMAIN/"; [[ $code == 200 ]] || { echo "Not serving yet: stop here."; exit 1; }
fi

# 2. Ownership proof for the cross-account move.
echo "== 2. TXT proof records"
# Apex: "_." + name; subdomain: "_" + name (CloudFront docs, "Set up the target distribution").
for n in _.aweborn.org _www.aweborn.org; do
  upsert "{\"Name\":\"$n\",\"Type\":\"TXT\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"\\\"$DOMAIN\\\"\"}]}"
done

# 3. The live move.
read -r -p "== 3. Move aweborn.org + www to $DIST now? Type 'move': " ok; [[ $ok == move ]] || { echo "Stopped before moving."; exit 1; }
# Apex first: if it's refused (AWS sends some cross-account apex moves to Support),
# set -e stops here with nothing moved.
for n in aweborn.org www.aweborn.org; do
  aws cloudfront associate-alias --profile $P --target-distribution-id "$DIST" --alias "$n"; echo "moved $n"
done

# 4. Point DNS at the new site.
echo "== 4. DNS -> new site"
for n in aweborn.org. www.aweborn.org.; do
  upsert "{\"Name\":\"$n\",\"Type\":\"A\",\"AliasTarget\":{\"HostedZoneId\":\"$CF_ZONE\",\"DNSName\":\"$DOMAIN.\",\"EvaluateTargetHealth\":false}}"
done

# 5. Make the stack own the names it now holds (other params unchanged).
echo "== 5. Stack: AttachAliases=true"
params=$(aws cloudformation describe-stacks --profile $P --stack-name aweborn-website --query 'Stacks[0].Parameters[].ParameterKey' --output text \
  | tr '\t' '\n' | grep -v '^AttachAliases$' | sed 's/.*/ParameterKey=&,UsePreviousValue=true/' | tr '\n' ' ')
aws cloudformation update-stack --profile $P --stack-name aweborn-website --use-previous-template \
  --capabilities CAPABILITY_NAMED_IAM --parameters ParameterKey=AttachAliases,ParameterValue=true $params --query StackId --output text
aws cloudformation wait stack-update-complete --profile $P --stack-name aweborn-website

echo "== Check"
aws cloudfront get-distribution --profile $P --id "$DIST" --query 'Distribution.DistributionConfig.Aliases.Items' --output text
for u in https://aweborn.org/ https://www.aweborn.org/; do echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' "$u")"; done
echo "Done. The old site ($OLD_DIST) no longer holds the names; leave it in place until the move ends."
