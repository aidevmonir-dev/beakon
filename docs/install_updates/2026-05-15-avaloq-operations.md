# Avaloq SFTP feed — operations runbook (live cutover)

| Field | Value |
|-------|-------|
| Date | 2026-05-15 |
| Status | **Live-ready code; awaiting AWS infra provisioning** |
| Deployment target | **AWS Zurich (`eu-central-2`) via Transfer Family** — Thomas 2026-05-15 |
| Predecessor spec | [docs/integrations/2026-05-10-geneva-bank-avaloq-sftp.md](../integrations/2026-05-10-geneva-bank-avaloq-sftp.md) — *§3.1 (Swiss self-host) superseded by AWS Transfer Family path below* |
| Predecessor demo | [docs/install_updates/2026-05-10-custodian-feed-DEMO-RUNBOOK.md](2026-05-10-custodian-feed-DEMO-RUNBOOK.md) |
| Pre-call agenda | [docs/integrations/2026-05-15-avaloq-bank-call-agenda.md](../integrations/2026-05-15-avaloq-bank-call-agenda.md) |
| AWS setup | [ops/avaloq/aws-setup.md](../../ops/avaloq/aws-setup.md) |

This is the operational counterpart to the spec doc. It documents the
production-grade pieces installed on 2026-05-15 — what they are, where
they live, and how to wire them up on the Swiss VPS once that's
provisioned.

---

## What shipped on 2026-05-15

### Code

| Change | File | Purpose |
|--------|------|---------|
| Archive/quarantine settings | `digits_clone/settings.py` | `AVALOQ_ARCHIVE_DIR`, `AVALOQ_QUARANTINE_DIR` (env-overridable). |
| `archive_path` field on `AvaloqFeedDrop` | `beakon_banking/models.py` | Records where the source zip ended up. |
| Migration `0005_avaloqfeeddrop_archive_path` | `beakon_banking/migrations/` | Applied. |
| `archive_zip()` / `quarantine_zip()` helpers | `beakon_banking/services/avaloq_feed.py` | Idempotent file movers, update `drop.archive_path`. |
| `ingest_avaloq` lifecycle wiring | `beakon_banking/management/commands/ingest_avaloq.py` | Calls archive/quarantine after each ingest. Backfills moves for pre-feature zips. `--zip` and `--no-archive` flags preserve files for debugging. |
| `check_avaloq_arrivals` command | `beakon_banking/management/commands/check_avaloq_arrivals.py` | Reports custodians with stale latest drops; non-zero exit when any are late. |

### Operational artifacts (under `ops/avaloq/`)

**AWS (recommended):**

| File | Role |
|------|------|
| `aws-setup.md` | Step-by-step AWS Transfer Family + S3 + Security Group + IAM provisioning. |
| `sync_from_s3.sh` | Pulls new zips from `s3://beakon-avaloq-incoming/` into the local incoming dir before ingest. |
| `ingest_avaloq.sh` | Linux wrapper (cron). |
| `check_arrivals.sh` | Linux SLA wrapper (cron). |

**Swiss-VPS / split-deployment fallback (legacy):**

| File | Role |
|------|------|
| `sshd_config.snippet` | Hardened `Match` block for the chrooted SFTP user. |
| `setup_avaloq_sftp_user.sh` | Provisions one chrooted SFTP user per bank. |
| `firewall_rules.sh` | iptables allowlist for the three bank source IPs. |
| `fail2ban-jail.local` | Defence-in-depth jail for the SFTP receiver. |
| `ingest_avaloq.ps1` / `check_arrivals.ps1` | Windows Task Scheduler equivalents. |

### Email artifact (under `docs/integrations/`)

| File | Role |
|------|------|
| `2026-05-15-avaloq-bank-call-agenda.md` | Mailable agenda Thomas sends the bank 24–48 h before the kick-off call. |

---

## Install order — AWS (recommended path)

Per Thomas's 2026-05-15 directive Beakon deploys on AWS, region
`eu-central-2` (Zurich). The Avaloq SFTP feed lands on AWS Transfer
Family. Full step-by-step in [ops/avaloq/aws-setup.md](../../ops/avaloq/aws-setup.md);
abbreviated here:

1. **Provision S3 buckets** for incoming / archive / quarantine
   (region `eu-central-2`, block all public access, default SSE-S3).
2. **Create IAM role** `BeakonAvaloqGvaSftpRole` granting write-only
   to `s3://beakon-avaloq-incoming/gva/`.
3. **Create Transfer Family server** with VPC endpoint, attach a
   Security Group that allows port 22 *only* from the three bank
   source IPs.
4. **Create SFTP user** `avaloq-gva` after the bank hands us their
   public key on the kick-off call:
   ```bash
   aws transfer create-user --server-id <id> --user-name avaloq-gva \
     --role arn:aws:iam::<acct>:role/BeakonAvaloqGvaSftpRole \
     --home-directory /beakon-avaloq-incoming/gva \
     --home-directory-type PATH \
     --ssh-public-key-body "$(cat /tmp/bank_pubkey.pub)"
   ```
5. **Wire cron** on the Beakon application host (EC2 / ECS task):
   ```cron
   */15 6-8 * * * /opt/beakon/ops/avaloq/sync_from_s3.sh && \
                  /opt/beakon/ops/avaloq/ingest_avaloq.sh
   30 8   * * * /opt/beakon/ops/avaloq/check_arrivals.sh \
                  || /opt/beakon/ops/alert.sh "Avaloq drop missing"
   ```
   `sync_from_s3.sh` pulls new zips from S3 to `AVALOQ_INCOMING_DIR`;
   `ingest_avaloq.sh` then runs as today.
6. **Verify**: ask the bank to push a test zip; watch
   `logs/avaloq/s3-sync-<date>.log` and `ingest-<date>.log`.

The application code is unchanged — Transfer Family lands the zip in
S3, `sync_from_s3.sh` mirrors it to the local incoming dir, and the
existing `ingest_avaloq` command + archive/quarantine helpers
operate on the local dir exactly as on the Swiss-VPS path.

---

## Install order — Swiss VPS (legacy / split-deployment fallback)

Use this path if a specific bank refuses to push to AWS-resident
infrastructure, or for a hybrid setup where the SFTP receiver lives
on a Swiss bastion that sync-forwards to the AWS application. The
artifacts below are kept in `ops/avaloq/` for that scenario.

Assumes Debian-style Linux. Adapt paths for whatever distro the host
runs.

1. **Clone the repo + Python env.**
   ```bash
   cd /opt
   git clone <repo-url> beakon
   cd beakon
   python3 -m venv venv
   ./venv/bin/pip install -r requirements.txt
   ./venv/bin/python manage.py migrate
   ```

2. **Decide the SFTP directory layout** and set env vars in
   `/etc/default/beakon` (or systemd `EnvironmentFile=`):
   ```
   AVALOQ_INCOMING_DIR=/home/avaloq-gva/incoming
   AVALOQ_ARCHIVE_DIR=/var/beakon/avaloq/archive
   AVALOQ_QUARANTINE_DIR=/var/beakon/avaloq/quarantine
   ```
   Ensure both archive and quarantine dirs are owned by the Beakon
   application user (the one cron runs as), not the SFTP user.

3. **Provision the bank's SFTP user.** The bank should have handed you
   their public key in advance of the kick-off call.
   ```bash
   sudo /opt/beakon/ops/avaloq/setup_avaloq_sftp_user.sh gva /tmp/bank_pubkey.pub
   ```

4. **Lock down the SSH listener.** Append `sshd_config.snippet` to
   `/etc/ssh/sshd_config`, substituting the user name and IPs.
   ```bash
   sudo sshd -t && sudo systemctl reload sshd
   ```

5. **Apply the firewall allowlist.**
   ```bash
   sudo /opt/beakon/ops/avaloq/firewall_rules.sh
   sudo iptables-save > /etc/iptables/rules.v4
   ```

6. **Install fail2ban jail.**
   ```bash
   sudo cp /opt/beakon/ops/avaloq/fail2ban-jail.local /etc/fail2ban/jail.d/beakon-avaloq.local
   sudo systemctl restart fail2ban
   ```

7. **Wire cron.**
   ```cron
   # Avaloq daily ingest — every 15 min, 06:00-08:45 CET
   */15 6-8 * * * /opt/beakon/ops/avaloq/ingest_avaloq.sh
   # Late-arrival SLA check — once at 08:30
   30 8 * * * /opt/beakon/ops/avaloq/check_arrivals.sh || /opt/beakon/ops/alert.sh "Avaloq drop missing"
   ```
   `alert.sh` is whatever notification hook is in place (mail / Slack
   webhook / PagerDuty CLI). It must accept a single string argument.

8. **Verify with an empty sweep.**
   ```bash
   /opt/beakon/ops/avaloq/ingest_avaloq.sh
   tail -1 /opt/beakon/logs/avaloq/ingest-$(date +%F).log
   # → expect "ingest_avaloq finished (exit 0)"
   ```

9. **Ask the bank to push a test zip** from one of their three source
   IPs. Watch `logs/avaloq/ingest-<date>.log` for the arrival. Confirm
   the zip ended up under `AVALOQ_ARCHIVE_DIR/<date>/`.

## Install order on Windows (dev / interim)

The same wrappers exist in PowerShell for the case where the bank
agrees to push to a Windows host (uncommon but supported).

1. Same Python env setup (`venv\Scripts\python.exe manage.py migrate`).
2. Register the scheduled tasks (elevated PowerShell):
   ```powershell
   schtasks /Create /TN "Beakon\Avaloq Ingest" `
     /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"D:\bookkeeper\ops\avaloq\ingest_avaloq.ps1`"" `
     /SC MINUTE /MO 15 /ST 06:00 /DU 03:00 /RU SYSTEM /RL HIGHEST

   schtasks /Create /TN "Beakon\Avaloq Arrivals Check" `
     /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"D:\bookkeeper\ops\avaloq\check_arrivals.ps1`"" `
     /SC DAILY /ST 08:30 /RU SYSTEM /RL HIGHEST
   ```
3. SSH server hardening on Windows is out of scope — if the host is
   Windows, use the OpenSSH built-in but plan a Linux migration. The
   `sshd_config.snippet` syntax is largely portable; the chroot rule
   is not.

---

## What's still blocking go-live

These need a human decision or external action — not code.

| Item | Owner | Notes |
|------|-------|-------|
| AWS account + VPC for `eu-central-2` provisioned | Thomas / Ops | Includes private subnets, NAT for outbound, the Beakon application host (EC2 or ECS). |
| Transfer Family server created + Security Group | Monirul | Per `ops/avaloq/aws-setup.md` §3-4. |
| DNS CNAME pointing at the Transfer Family endpoint | Thomas | Suggest `avaloq-gva.beakon.ch` → `s-<server-id>.server.transfer.eu-central-2.amazonaws.com`. Optional — the bank can also use the raw AWS hostname. |
| Bank's three source IPs entered into the Security Group | Monirul (post-call) | The IPs in the spec doc (`194.38.173.1/2/3`) need confirmation on the call. |
| Bank's public key handed to us | Bank | We pass it through `aws transfer create-user --ssh-public-key-body`. |
| `alert.sh` notification hook on the application host | Monirul | Mail / SNS / Slack — whichever the on-call uses. |
| Sample zip from the bank | Bank | Section A.2 of the pre-call agenda. Until this arrives, the parsers are speculative. |

---

## Rollback

The work installed here is additive — no destructive migrations, no
removal of existing code paths. Disabling the schedulers (`schtasks
/Delete` or commenting the cron lines) immediately stops new ingests.
The `AvaloqFeedDrop.archive_path` field stays harmlessly populated on
existing rows.

If a parser change goes bad after a real sample arrives:

```bash
# Move quarantined zips back to incoming and re-run.
mv /var/beakon/avaloq/quarantine/*.zip /home/avaloq-gva/incoming/
/opt/beakon/ops/avaloq/ingest_avaloq.sh
```

`ingest_avaloq` is idempotent on `(sha256, business_date)`, so the
re-ingest writes nothing new at the row level — it just re-attempts
the parse and re-classifies.
