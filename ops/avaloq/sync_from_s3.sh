#!/usr/bin/env bash
# Pull new Avaloq zips from S3 into the local AVALOQ_INCOMING_DIR before
# the existing ingest_avaloq.sh sweep runs.
#
# This is the bridge between AWS Transfer Family (which lands zips in
# S3) and the existing ingest pipeline (which expects a local directory).
# The app code is unchanged — this script keeps the local dir in sync.
#
# Sample cron entry (production, paired with the existing ingest):
#
#   */15 6-8 * * * /opt/beakon/ops/avaloq/sync_from_s3.sh && \
#                  /opt/beakon/ops/avaloq/ingest_avaloq.sh
#
# Honours:
#   $REPO_ROOT — defaults to two dirs above this script.
#   $AVALOQ_S3_INCOMING — the S3 source prefix.
#                          Default: s3://beakon-avaloq-incoming/
#   $AVALOQ_INCOMING_DIR — the local destination dir (matches Django settings).
#
# Idempotency: `aws s3 sync` only copies new/changed objects. Re-running
# is cheap. After a zip has been ingested-and-archived locally, it's
# absent from incoming and won't be re-fetched (S3 still has it under
# the same key — that's by design; the bank's audit trail lives in S3,
# our local copy is transient).

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
LOG_DIR="${REPO_ROOT}/logs/avaloq"
LOG_FILE="${LOG_DIR}/s3-sync-$(date +%Y-%m-%d).log"

# These default to the production AWS layout but are env-overridable
# for staging / multi-bank deployments.
S3_SRC="${AVALOQ_S3_INCOMING:-s3://beakon-avaloq-incoming/}"
LOCAL_DST="${AVALOQ_INCOMING_DIR:-${REPO_ROOT}/incoming/avaloq}"
AWS_REGION="${AWS_REGION:-eu-central-2}"

mkdir -p "$LOG_DIR" "$LOCAL_DST"

{
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] s3 sync starting"
    echo "  source: $S3_SRC"
    echo "  dest:   $LOCAL_DST"
    # --exact-timestamps so a manual re-upload at the bank causes a re-sync.
    # Do NOT use --delete here — locally archived zips have been deleted
    # from incoming by the ingest step, and we don't want sync to redownload
    # them. `aws s3 sync` without --delete only copies new objects.
    aws s3 sync "$S3_SRC" "$LOCAL_DST" \
        --region "$AWS_REGION" \
        --exclude "*" \
        --include "*.zip" \
        --exact-timestamps
    rc=$?
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] s3 sync finished (exit $rc)"
    exit $rc
} >>"$LOG_FILE" 2>&1
