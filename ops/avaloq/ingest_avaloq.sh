#!/usr/bin/env bash
# Wrapper for the Linux production server. Wired to cron every 15 min
# between 06:00 and 09:00 CET.
#
# Sample crontab entry (adjust the repo path):
#
#   # Beakon — Avaloq daily SFTP ingest
#   */15 6-8 * * * /opt/beakon/ops/avaloq/ingest_avaloq.sh
#
# The cron schedule "*/15 6-8 * * *" fires at :00 :15 :30 :45 from 06:00
# through 08:45 inclusive. Add a 09:00 dotted slot only if the bank's
# SLA pushes deliveries later than the spec promises.
#
# Honours $REPO_ROOT for non-default install locations. Logs to
# $REPO_ROOT/logs/avaloq/ingest-YYYY-MM-DD.log.

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PYTHON="${REPO_ROOT}/venv/bin/python"
MANAGE="${REPO_ROOT}/manage.py"
LOG_DIR="${REPO_ROOT}/logs/avaloq"
LOG_FILE="${LOG_DIR}/ingest-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

{
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] ingest_avaloq starting"
    cd "$REPO_ROOT"
    "$PYTHON" "$MANAGE" ingest_avaloq
    rc=$?
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] ingest_avaloq finished (exit $rc)"
    exit $rc
} >>"$LOG_FILE" 2>&1
