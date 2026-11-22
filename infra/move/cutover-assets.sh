#!/usr/bin/env bash
# AWS move (docs/aws-move.md, step 3): the asset library (assets.aweborn.org).
#
#   infra/move/cutover-assets.sh          # 1 stack, 2 copy, 3 move the name (asks first)
#   infra/move/cutover-assets.sh sync     # copy again only (after gen-AI writes to the new bucket)
#
# 1. Creates aweborn-assets in the Aweborn account without the name or DNS records.
# 2. Copies every object S3-to-S3, keeping Content-Type, Cache-Control and
#    metadata (a download/upload would drop them). For the copy, the new
#    bucket's policy briefly lets the old account write into it; the stack's own
#    policy is put back afterwards, even on failure.
# 3. Detaches assets.aweborn.org from the old CloudFront site, attaches it to
#    the new one and repoints A + AAAA. A few minutes of asset errors.
#
# Profiles: "aweborn" = new account (SSO), "default" = old account.
set -euo pipefail
cd "$(dirname "$0")/../.."
NEW=aweborn; OLD=default; OLD_ACCT=111551045759
ZONE=Z08362011L7H2GNY83C20; CF_ZONE=Z2FDTNDATAQYW2; NAME=assets.aweborn.org
[[ $(aws sts get-caller-identity --profile $NEW --query Account --output text) == 285037497167 ]] || { echo "profile $NEW is not the Aweborn account"; exit 1; }
[[ $(aws sts get-caller-identity --profile $OLD --query Account --output text) == $OLD_ACCT ]] || { echo "profile $OLD is not the old account (run: aws login)"; exit 1; }
out() { aws cloudformation describe-stacks --profile "$1" --stack-name aweborn-assets --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text; }
OLD_BUCKET=$(out $OLD BucketName); OLD_DIST=$(out $OLD DistributionId)
mkdir -p .migration

# ---- 1. Stack ---------------------------------------------------------------
if ! aws cloudformation describe-stacks --profile $NEW --stack-name aweborn-assets >/dev/null 2>&1; then
  [[ ${1:-} == sync ]] && { echo "No aweborn-assets stack in the new account yet."; exit 1; }
  CERT=$(aws acm list-certificates --profile $NEW --region us-east-1 \
    --query "CertificateSummaryList[?DomainName=='aweborn.org'].CertificateArn | [0]" --output text)
  [[ $CERT == arn:* ]] || { echo "No aweborn.org certificate in the new account."; exit 1; }
  echo "== 1. Creating aweborn-assets (CloudFront takes 5-15 min)"
  aws cloudformation create-stack --profile $NEW --stack-name aweborn-assets --template-body file://infra/cloudformation-assets.yml \
    --capabilities CAPABILITY_NAMED_IAM --query StackId --output text --parameters \
    ParameterKey=HostedZoneId,ParameterValue=$ZONE ParameterKey=CertificateArn,ParameterValue="$CERT" \
    ParameterKey=AttachAliases,ParameterValue=false ParameterKey=ManageDnsRecords,ParameterValue=false
  aws cloudformation wait stack-create-complete --profile $NEW --stack-name aweborn-assets \
    || { aws cloudformation describe-stack-events --profile $NEW --stack-name aweborn-assets \
         --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" --output text | head -5; exit 1; }
fi
NEW_BUCKET=$(out $NEW BucketName); NEW_DIST=$(out $NEW DistributionId)
DOMAIN=$(aws cloudfront get-distribution --profile $NEW --id "$NEW_DIST" --query Distribution.DomainName --output text)
echo "Old: $OLD_BUCKET / $OLD_DIST    New: $NEW_BUCKET / $NEW_DIST ($DOMAIN)"

# ---- 2. Copy ----------------------------------------------------------------
echo "== 2. Copying objects S3-to-S3"
aws s3api get-bucket-policy --profile $NEW --bucket "$NEW_BUCKET" --query Policy --output text > .migration/assets-new-policy.json
restore() { aws s3api put-bucket-policy --profile $NEW --bucket "$NEW_BUCKET" --policy file://.migration/assets-new-policy.json && echo "New bucket policy restored."; }
trap restore EXIT
NEW_BUCKET="$NEW_BUCKET" OLD_ACCT="$OLD_ACCT" python3 - <<'EOF'
import json, os
b, a = os.environ["NEW_BUCKET"], os.environ["OLD_ACCT"]
p = json.load(open(".migration/assets-new-policy.json"))
p["Statement"].append({"Sid": "AwsMoveCopyFromOldAccount", "Effect": "Allow",
  "Principal": {"AWS": f"arn:aws:iam::{a}:root"},
  "Action": ["s3:ListBucket", "s3:PutObject"],
  "Resource": [f"arn:aws:s3:::{b}", f"arn:aws:s3:::{b}/*"]})
json.dump(p, open(".migration/assets-copy-policy.json", "w"))
EOF
aws s3api put-bucket-policy --profile $NEW --bucket "$NEW_BUCKET" --policy file://.migration/assets-copy-policy.json
sleep 10   # policy changes take a moment
aws s3 sync "s3://$OLD_BUCKET" "s3://$NEW_BUCKET" --profile $OLD --copy-props metadata-directive --only-show-errors
restore; trap - EXIT
count() { aws s3 ls "s3://$2" --profile "$1" --recursive --summarize | tail -2 | tr '\n' ' '; }
echo "  old: $(count $OLD "$OLD_BUCKET")"; echo "  new: $(count $NEW "$NEW_BUCKET")"
[[ ${1:-} == sync ]] && exit 0

# ---- 3. Move the name ---------------------------------------------------------
read -r -p "== 3. Move $NAME to the new site now (a few minutes of asset errors)? Type 'cutover': " ok
[[ $ok == cutover ]] || { echo "Stopped after the copy; the name hasn't moved."; exit 0; }
aws cloudfront get-distribution-config --profile $OLD --id "$OLD_DIST" > .migration/old-assets-get.json
python3 - <<'EOF'
import json
g = json.load(open(".migration/old-assets-get.json")); c = g["DistributionConfig"]
json.dump(c, open(".migration/old-assets-config-before.json", "w"), indent=1)
c["Aliases"] = {"Quantity": 0}
c["ViewerCertificate"] = {"CloudFrontDefaultCertificate": True, "MinimumProtocolVersion": "TLSv1"}
json.dump(c, open(".migration/old-assets-config-after.json", "w"), indent=1)
open(".migration/old-assets-etag", "w").write(g["ETag"])
EOF
aws cloudfront update-distribution --profile $OLD --id "$OLD_DIST" --if-match "$(cat .migration/old-assets-etag)" \
  --distribution-config file://.migration/old-assets-config-after.json --query Distribution.Status --output text
START=$(date +%s); sleep 30
params=$(aws cloudformation describe-stacks --profile $NEW --stack-name aweborn-assets --query 'Stacks[0].Parameters[].ParameterKey' --output text \
  | tr '\t' '\n' | grep -v '^AttachAliases$' | sed 's/.*/ParameterKey=&,UsePreviousValue=true/' | tr '\n' ' ')
aws cloudformation update-stack --profile $NEW --stack-name aweborn-assets --use-previous-template \
  --capabilities CAPABILITY_NAMED_IAM --parameters ParameterKey=AttachAliases,ParameterValue=true $params --query StackId --output text
for t in A AAAA; do
  aws route53 change-resource-record-sets --profile $NEW --hosted-zone-id $ZONE --query ChangeInfo.Status --output text --change-batch \
    "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$NAME.\",\"Type\":\"$t\",\"AliasTarget\":{\"HostedZoneId\":\"$CF_ZONE\",\"DNSName\":\"$DOMAIN.\",\"EvaluateTargetHealth\":false}}}]}"
done
aws cloudformation wait stack-update-complete --profile $NEW --stack-name aweborn-assets
KEY=$(aws s3api list-objects-v2 --profile $NEW --bucket "$NEW_BUCKET" --prefix models/ --max-items 1 --query 'Contents[0].Key' --output text | head -1)
for i in $(seq 1 30); do
  c=$(curl -s -o /dev/null -w '%{http_code}' "https://$NAME/$KEY")
  echo "  $(( $(date +%s) - START ))s: https://$NAME/$KEY -> $c"
  [[ $c == 200 ]] && { echo "Done: $NAME is served from the new account."; break; }
  sleep 20
done
echo
echo "Next: switch gen-AI's writer to the new bucket (docs/aws-move.md step 3), then: $0 sync"
