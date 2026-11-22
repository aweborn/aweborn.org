# Moving AWS to Aweborn's own account

From account `111551045759` (Alex's personal account, personal card) to
`285037497167` ("Aweborn", billed to Aweborn's Mercury card). Started
2026-11-21. Decision record: `phases/README.md` → "AWS billing → Aweborn's
bank account".

## Decisions (Alex, 2026-11-21)

- **Everything lives in 285037497167.** It is also the management account of
  the new AWS Organization `o-3a5eq0f6ik`, against AWS's advice. Chosen for
  simplicity: one account to track.
- **Logins:** IAM Identity Center (multi-Region: us-east-1, replicated to
  us-west-2). User `alex`, permission set `AdministratorAccess` (4 h sessions).
  Portal: `https://d-9066673643.awsapps.com/start`. Root only for billing and
  recovery.
- **CLI profiles on Alex's Mac:** `aweborn` = new account (`aws configure sso`,
  then `aws sso login --profile aweborn`); `default` = old account (`aws login`,
  currently **root** credentials: replace or retire with the old account).
- **DNS moved first, as an exact copy** (zero behaviour change), so every later
  step edits one zone in the new account instead of juggling two accounts.

## Status

| Piece | State | Notes |
|---|---|---|
| Identity Center + admin login | ✅ 2026-11-21 | |
| Templates account-portable | ✅ `2cd70cb`, `1aefc72`, `d232387`, this commit | Params default to the live values; old stacks unchanged |
| GitHub OIDC provider | ✅ | |
| `aweborn-backups` | ✅ | `aweborn-backups-285037497167`, role `aweborn-github-backup`. Not used yet: `AWS_BACKUP_ROLE_ARN` still points at the old account |
| Route53 zone + nameservers | ✅ **live** 2026-11-21 ~11:35 ET | New zone `Z08362011L7H2GNY83C20` is authoritative (registrar switched, op `c5a56d8f…`). Old zone `Z077908710IGH7R1XO587` must stay identical and untouched until the move ends |
| `aweborn-ci` | ✅ | Roles exist; GitHub still uses the old ones |
| `aweborn-mail` | ✅ (`ManageSharedRecords=false`) | Domain verified (DKIM + MAIL FROM). Receipt rule set **inactive**: hello@/privacy@ still arrive via the old account |
| SES production access | ❌ **denied** 2026-11-22 | Appeal by replying to AWS's denial email. Not blocking: mail keeps going through the old account's SES (its DKIM records are in the new zone) and moves last |
| Account verification | ✅ by 2026-11-22 | Support case 179528017900730. CloudFront works now |
| `aweborn-website` | ✅ **live** 2026-11-22 ~16:25 ET; payments ✅ ~16:35 | `E29ZTT5F8DU5CT` (`d2790huj99b2gc.cloudfront.net`), bucket `aweborn-website-285037497167`, API `https://r3hw3vo49l.execute-api.us-east-1.amazonaws.com`. GitHub deploys go here (repo variables set). `associate-alias` refused ("source distribution is enabled"), so `infra/move/cutover-site-names.sh` detached the names from the old site (`E3Q49I3A6Q6RH`, config saved in `.migration/` on Alex's Mac) and attached them here: ~2 min outage. Payments: the one Stripe endpoint (`we_1URYrLPkgUqNqJwuXM3aIL2R`) delivers to the new API and checkout calls it; a test gift reached the mana ledger |
| `aweborn-assets` | ✅ **live** 2026-11-22 ~17:05 ET | `E1PJRFELCXQ12A` (`d2uvsovz1wnzu5.cloudfront.net`), bucket `aweborn-assets-285037497167`: 655 objects (1.97 GB) copied S3-to-S3 with `infra/move/cutover-assets.sh`, ~2 min outage. Gen-AI writes here (new `aweborn-genai-writer` key in `~/keys` + VPS; manifest `405a4a7`). Old bucket kept as a backup until step 7 |
| `aweborn-vps` | to do | Lightsail should work now that the account is verified |

## Rules while the move is open

- **DNS edits go to the new zone `Z08362011L7H2GNY83C20` only.** Don't update
  the old account's stacks: they write to the old zone, which nobody reads now.
- Stack records that already exist in the zone can't be created again by
  CloudFormation, so new-account stacks start with `ManageDnsRecords=false`
  (website, assets, VPS) or `ManageSharedRecords=false` (mail), and the records
  are switched by hand with `UPSERT`. Whether to hand them back to the stacks
  later (a ~1 min delete → recreate gap) is an open choice.
- Never two live Stripe webhook endpoints: the new stack's webhook secret and
  gift token stay placeholders until step 2c.
- GitHub variables can't be set from a cloud session (the proxy blocks the
  Actions API): Alex runs the `gh variable set` lines.

## Remaining steps

### 1. Wait for AWS ✅
Verification done by Nov 22. SES production access was denied: appeal later.

### 2. Website
a. `infra/move/create-website.sh` (needs `~/keys/AWEBORN_STRIPE_SECRET_KEY.txt`).
   Note the new `DistributionId` and its `d….cloudfront.net` domain.

b. ✅ Done 2026-11-22 with `infra/move/cutover-site-names.sh` (the
   associate-alias route below was refused because the old site was enabled;
   kept for reference). Fill the bucket and move the names:
   ```bash
   gh variable set AWS_DEPLOY_ROLE_ARN -R aweborn/aweborn.org --body arn:aws:iam::285037497167:role/aweborn-github-deploy
   gh variable set SITE_BUCKET -R aweborn/aweborn.org --body aweborn-website-285037497167
   gh variable set CLOUDFRONT_DISTRIBUTION_ID -R aweborn/aweborn.org --body <new id>
   gh workflow run deploy.yml && gh run watch          # then open https://<new d….cloudfront.net>
   ```
   In the new zone add TXT `_aweborn.org` and `_www.aweborn.org` = `"<new d….cloudfront.net>"`, then
   `aws cloudfront associate-alias --profile aweborn --target-distribution-id <new id> --alias aweborn.org`
   (and `www.aweborn.org`). CloudFront routes by name, so traffic moves at once
   even before DNS changes. Then `UPSERT` the apex and www `A` aliases to the new
   domain, and redeploy the stack with `AttachAliases=true` (keep the other params).

c. ✅ Payments (2026-11-22): set the new stack's `StripeWebhookSecret` (the existing endpoint's
   secret; we move the endpoint, we don't make a second one) and
   `ManaInflowToken` with `AWS_PROFILE=aweborn infra/set-stack-key.sh …`. Then
   `AWS_PROFILE=aweborn infra/stripe-webhook.sh move`, and change `VITE_API_ENDPOINT` in `.env.production` to the new
   `ApiEndpoint`; push. Test a small gift end to end.

### 3. Assets ✅ (2026-11-22, `infra/move/cutover-assets.sh`)
Stack with `AttachAliases=false ManageDnsRecords=false CertificateArn=<new website cert>`.
Copy `s3://aweborn-assets-111551045759` → `s3://aweborn-assets-285037497167`
(includes `archive/backups/jobs.db.gz`). Move `assets.aweborn.org` like 2b
(TXT `_assets.aweborn.org`, associate-alias, `UPSERT` A + AAAA). New key for
`aweborn-genai-writer` into `~/keys`. Final copy after step 5.

### 4. Mail (after SES production access)
`AWS_PROFILE=aweborn infra/set-secret.sh ses` (new sender key → `~/keys` + VPS).
Old account: `aws ses set-active-receipt-rule-set --profile default` (no name =
deactivate). New: `aws ses set-active-receipt-rule-set --profile aweborn
--rule-set-name aweborn-inbound`. Test hello@, privacy@ and a sign-in code.

### 5. VPS (window: sync + gen-AI down ~30-45 min)
`infra/move/move-vps.sh freeze`, then `build`, then `restore` (run in a real
Terminal; each part can be re-run). It follows HANDOFF → Rebuild with the
cross-account changes: sync-service and gen-AI are stopped on the old box
**before** the final snapshot (no lost edits), `backup.yml` runs **before** the
old Tailscale node is deleted, the backup is copied into
`aweborn-backups-285037497167`, the new stack is `aweborn-vps-4` with
`ManageDnsRecords=false` and sync/api are `UPSERT`ed to its static IP, then
`restore-from-s3.sh`, `set-secret.sh push all` (SES keys are still the old
account's sender: mail keeps working), `restore-genai-db.sh`, the CI role
variables (this is also step 6), a full deploy and `backup.yml` into the new bucket.

### 6. CI
`gh variable set AWS_INFRA_PREVIEW_ROLE_ARN` to the new `aweborn-ci` preview role.

### 7. Finish
Watch a full backup cycle. Delete Aweborn's resources in the old account (keep
the old zone ~1 week first). Move the aweborn.org and aweborn.com registrations
into the new account (`route53domains transfer-domain-to-another-aws-account`).
The old account stays open for Alex's personal domains. Redeem the TechSoup AWS
credit in the new account. Update CONFIG.md, HANDOFF.md and `recover.sh` defaults
to the new account.
