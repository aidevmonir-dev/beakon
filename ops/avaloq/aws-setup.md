# Avaloq SFTP receiver on AWS Transfer Family — setup runbook

| Field | Value |
|-------|-------|
| Region | **`eu-central-2` (Zurich)** |
| Service | AWS Transfer Family — managed SFTP endpoint |
| Storage | S3 buckets for incoming, archive, quarantine |
| Auth | SSH public-key (no password) |
| Access | IP-allowlisted Security Group (three bank source IPs) |
| Audit | CloudTrail + Transfer Family logs |

This replaces the Swiss-VPS hardening kit (`sshd_config.snippet`,
`setup_avaloq_sftp_user.sh`, `firewall_rules.sh`, `fail2ban-jail.local`)
for the AWS deployment path. The Swiss-VPS scripts stay in `ops/avaloq/`
as a fallback option for a split deployment (app on AWS, SFTP receiver on
a Swiss bastion), but the AWS path is the default per Thomas's
2026-05-15 directive.

## 1. S3 buckets

Create three buckets in `eu-central-2`:

```bash
aws s3api create-bucket \
  --bucket beakon-avaloq-incoming \
  --region eu-central-2 \
  --create-bucket-configuration LocationConstraint=eu-central-2

aws s3api create-bucket \
  --bucket beakon-avaloq-archive \
  --region eu-central-2 \
  --create-bucket-configuration LocationConstraint=eu-central-2

aws s3api create-bucket \
  --bucket beakon-avaloq-quarantine \
  --region eu-central-2 \
  --create-bucket-configuration LocationConstraint=eu-central-2
```

Per-bucket settings (run for each):

```bash
# Block all public access
aws s3api put-public-access-block --bucket beakon-avaloq-incoming \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Default encryption (SSE-S3 is enough; bump to SSE-KMS if FINMA needs CMK)
aws s3api put-bucket-encryption --bucket beakon-avaloq-incoming \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Versioning on archive only (audit trail; not needed on incoming/quarantine)
aws s3api put-bucket-versioning --bucket beakon-avaloq-archive \
  --versioning-configuration Status=Enabled

# Lifecycle: incoming is a work queue — anything still here after 7 days
# means our ingest failed and didn't quarantine; alert + delete.
# Archive: keep 7 years (Swiss bookkeeping law minimum).
# Quarantine: keep 90 days for operator review, then delete.
```

## 2. IAM role for Transfer Family

The SFTP user needs an IAM role granting write access *only* to its
prefix in the incoming bucket.

```bash
# Trust policy — Transfer Family assumes this role on the user's behalf.
cat > /tmp/trust-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "transfer.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF

aws iam create-role \
  --role-name BeakonAvaloqGvaSftpRole \
  --assume-role-policy-document file:///tmp/trust-policy.json

# Permission policy — write-only to the user's home prefix, list to
# confirm the upload, no delete (we want immutable receipt audit).
cat > /tmp/sftp-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowListIncoming",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::beakon-avaloq-incoming",
      "Condition": {"StringLike": {"s3:prefix": ["gva/*"]}}
    },
    {
      "Sid": "AllowWriteOwnPrefix",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::beakon-avaloq-incoming/gva/*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name BeakonAvaloqGvaSftpRole \
  --policy-name AvaloqGvaWriteOwnPrefix \
  --policy-document file:///tmp/sftp-policy.json
```

The `gva` prefix is the bank-code; replicate this role pattern when a
second Avaloq bank is onboarded (`BeakonAvaloqZrhSftpRole`, etc.).

## 3. Transfer Family server

```bash
aws transfer create-server \
  --region eu-central-2 \
  --identity-provider-type SERVICE_MANAGED \
  --protocols SFTP \
  --domain S3 \
  --endpoint-type VPC \
  --endpoint-details "VpcId=<your-vpc-id>,SubnetIds=<private-subnets>,SecurityGroupIds=<sg-id>" \
  --tags Key=Project,Value=Beakon Key=Component,Value=AvaloqFeed
```

VPC endpoint is preferred over public endpoint — combined with the
Security Group allowlist below, the server is invisible to the
internet except from the three bank IPs.

Note the returned `ServerId` — used below.

## 4. Security Group — IP allowlist

```bash
aws ec2 create-security-group \
  --group-name beakon-avaloq-sftp-sg \
  --description "Allow Avaloq bank IPs to reach Transfer Family SFTP" \
  --vpc-id <your-vpc-id>

# Three bank source IPs (confirmed on the kick-off call):
for ip in 194.38.173.1/32 194.38.173.2/32 194.38.173.3/32; do
  aws ec2 authorize-security-group-ingress \
    --group-id <sg-id> --protocol tcp --port 22 --cidr "$ip"
done
```

## 5. SFTP user provisioning

Once the bank hands us their public key on the kick-off call:

```bash
aws transfer create-user \
  --server-id <server-id-from-step-3> \
  --user-name avaloq-gva \
  --role arn:aws:iam::<account>:role/BeakonAvaloqGvaSftpRole \
  --home-directory /beakon-avaloq-incoming/gva \
  --home-directory-type PATH \
  --ssh-public-key-body "$(cat /path/to/bank_pubkey.pub)"
```

Notes:
- `--home-directory-type PATH` (not `LOGICAL`) means the bank sees the
  raw bucket path. They can `pwd` and get `/beakon-avaloq-incoming/gva`.
  Switch to `LOGICAL` if you want them to see just `/incoming/`.
- The same `aws transfer import-ssh-public-key` works for key rotation
  later without re-creating the user.

## 6. Ingest wiring

The existing `ingest_avaloq` management command and
`AvaloqFeedService` are unchanged. They still read from a local
`AVALOQ_INCOMING_DIR`. The bridge is a small sync step run before
ingest:

```cron
*/15 6-8 * * * /opt/beakon/ops/avaloq/sync_from_s3.sh && \
                /opt/beakon/ops/avaloq/ingest_avaloq.sh
```

`sync_from_s3.sh` (separate file in this directory) does an `aws s3
sync --delete s3://beakon-avaloq-incoming/gva/ $AVALOQ_INCOMING_DIR/`,
then `ingest_avaloq.sh` proceeds as today. The archive move at the end
of ingest writes to the *local* archive dir; a second sync step
(`sync_to_s3.sh`, optional) mirrors that to `s3://beakon-avaloq-archive/`
for the immutable audit trail.

For the v1 setup, **skip `sync_to_s3.sh`** — the local archive on the
Beakon application host is sufficient. Add it later if you want
double-archive durability.

## 7. Monitoring

CloudWatch already collects Transfer Family connection events. Add
alarms for:

| Metric | Threshold | What it catches |
|--------|-----------|-----------------|
| `BytesIn` per user | == 0 for >24 h on a business day | Bank not delivering — same signal as `check_avaloq_arrivals` |
| `FilesIn` per user | > 10 in any 5-min window | Unusual; investigate |
| Connection attempts from non-allowlisted IP | > 0 | Security Group misconfigured |

Wire the `check_avaloq_arrivals` cron to also fire to CloudWatch
(see `sync_from_s3.sh` for the AWS CLI wrapper pattern).

## 8. Cost ballpark

For one bank, one daily zip ≤ 10 MB:

| Item | Monthly cost |
|------|--------------|
| Transfer Family endpoint (`$0.30/h`) | $216 |
| Data transfer IN (S3) | ~$0 (free) |
| S3 storage (3 buckets × <1 GB each) | ~$0.10 |
| Outbound to Beakon EC2 (same region) | $0 |
| **Total per bank** | **~$216/month** |

The Transfer Family endpoint cost is independent of usage — even one
zip/day costs the same as one zip/hour. If we onboard a second bank,
add another `--user-name` to the **same server** (don't spin a second
endpoint); incremental cost = 0.

## 9. What we hand the bank on the call

| Field they need | Our value |
|-----------------|-----------|
| Adresse IP ou nom DNS | `s-<server-id>.server.transfer.eu-central-2.amazonaws.com` |
| User | `avaloq-gva` |
| Mot de passe | n/a — SSH key auth |
| Répertoire | `/incoming/` (auto-chrooted to `gva/` prefix in S3) |
| Port | `22` |
| Public key (their side) | Generated by them, sent to us; we install via `create-user` |

## 10. Decommissioning the legacy Swiss-VPS kit

Once AWS is live and the bank has tested:

- Move `ops/avaloq/sshd_config.snippet`,
  `setup_avaloq_sftp_user.sh`, `firewall_rules.sh`,
  `fail2ban-jail.local` to `ops/avaloq/legacy-swiss-vps/` with a
  README explaining they're kept for the split-deployment fallback
  scenario but no longer the recommended path.

Don't delete them — Thomas may still want a Swiss-VPS option for a
specific bank that refuses to push to AWS-resident infrastructure.
