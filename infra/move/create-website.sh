#!/usr/bin/env bash
# AWS move (docs/aws-move.md, step 2): create the aweborn-website stack in the
# Aweborn account (285037497167) WITHOUT the aweborn.org/www names and WITHOUT
# its DNS records: the old account's CloudFront site still holds the names and
# the zone already holds the records. Both move across in step 2b.
# The Stripe key goes in via a 0600 params file, never the command line.
# The webhook secret and gift token stay placeholders until cutover, so the new
# webhook Lambda can't double-count gifts while the old one is live.
# Profiles: "aweborn" = new account (SSO), "default" = old account (read only here).
set -euo pipefail
cd "$(dirname "$0")/../.."
NEW=aweborn; OLD=default
[[ $(aws sts get-caller-identity --profile $NEW --query Account --output text) == 285037497167 ]] || { echo "profile $NEW is not the Aweborn account"; exit 1; }
old_param() { aws cloudformation describe-stacks --profile $OLD --stack-name aweborn-website \
  --query "Stacks[0].Parameters[?ParameterKey=='$1'].ParameterValue | [0]" --output text; }
CARD=$(old_param CardPriceId); PROXY=$(old_param AuthProxy)
[[ $CARD == None ]] && CARD=''; [[ $PROXY == None ]] && PROXY=false
echo "Copying from the old stack: CardPriceId='$CARD' AuthProxy='$PROXY'"
W=$(mktemp -d); chmod 700 "$W"; trap 'rm -rf "$W"' EXIT
( umask 077; KEYF="$HOME/keys/AWEBORN_STRIPE_SECRET_KEY.txt" CARD="$CARD" PROXY="$PROXY" python3 -c '
import json,os
p={"HostedZoneId":"Z08362011L7H2GNY83C20","AttachAliases":"false","ManageDnsRecords":"false","SiteBucketName":"aweborn-website-285037497167",
   "StripeSecretKey":open(os.environ["KEYF"]).read().strip(),"CardPriceId":os.environ["CARD"],"AuthProxy":os.environ["PROXY"]}
print(json.dumps([{"ParameterKey":k,"ParameterValue":v} for k,v in p.items()]))' > "$W/p.json" )
aws cloudformation create-stack --profile $NEW --stack-name aweborn-website --template-body file://infra/cloudformation.yml \
  --capabilities CAPABILITY_NAMED_IAM --parameters file://$W/p.json --query StackId --output text
echo "Creating (CloudFront takes 5-15 min)..."
aws cloudformation wait stack-create-complete --profile $NEW --stack-name aweborn-website \
  && aws cloudformation describe-stacks --profile $NEW --stack-name aweborn-website --query 'Stacks[0].Outputs' --output table \
  || { echo "FAILED. Reasons:"; aws cloudformation describe-stack-events --profile $NEW --stack-name aweborn-website \
       --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" --output text
       echo "Delete the rolled-back stack before retrying: aws cloudformation delete-stack --profile $NEW --stack-name aweborn-website"; exit 1; }
