#!/usr/bin/env bash
# Wrapper for the Linux production server. Wired to cron once daily at
# 08:30 CET.
#
# Sample crontab entry (adjust the repo path):
#
#   # Beakon — Avaloq arrival SLA check
#   30 8 * * * /opt/beakon/ops/avaloq/check_arrivals.sh || /opt/beakon/ops/alert.sh "Avaloq drop missing"
#
# The `|| alert.sh` chains a notification when this script exits non-zero.
# Replace alert.sh with whatever messaging hook is in place (mail,
# Slack webhook, PagerDuty CLI).
#
# Honours $REPO_ROOT for non-default install locations.

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PYTHON="${REPO_ROOT}/venv/bin/python"
MANAGE="${REPO_ROOT}/manage.py"
LOG_DIR="${REPO_ROOT}/logs/avaloq"
LOG_FILE="${LOG_DIR}/arrivals-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

{
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] check_avaloq_arrivals starting"
    cd "$REPO_ROOT"
    "$PYTHON" "$MANAGE" check_avaloq_arrivals
    rc=$?
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] check_avaloq_arrivals finished (exit $rc)"
    exit $rc
} >>"$LOG_FILE" 2>&1
