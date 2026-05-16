# Wrapper invoked by Windows Task Scheduler every 15 min between 06:00 and 09:00 CET.
#
# Sweeps the incoming SFTP drop directory, ingests new zips, archives or
# quarantines each based on outcome. Idempotent — re-running is safe.
#
# Install (run once, elevated PowerShell):
#   schtasks /Create /TN "Beakon\Avaloq Ingest" `
#     /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"D:\bookkeeper\ops\avaloq\ingest_avaloq.ps1`"" `
#     /SC MINUTE /MO 15 /ST 06:00 /DU 03:00 /RU SYSTEM /RL HIGHEST
#
# The /DU 03:00 limits the schedule to the 06:00-09:00 window; outside
# that range the task is dormant. /RU SYSTEM ensures it runs without an
# interactive login.

$ErrorActionPreference = "Stop"

# Resolve the repo root from this script's location so the wrapper is
# portable across deployments.
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Python   = Join-Path $RepoRoot "venv\Scripts\python.exe"
$Manage   = Join-Path $RepoRoot "manage.py"
$LogDir   = Join-Path $RepoRoot "logs\avaloq"
$LogFile  = Join-Path $LogDir ("ingest-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$Stamp] ingest_avaloq starting" | Out-File -FilePath $LogFile -Append -Encoding utf8

# Push working directory so settings.AVALOQ_INCOMING_DIR resolves correctly.
Push-Location $RepoRoot
try {
    & $Python $Manage ingest_avaloq 2>&1 | Tee-Object -FilePath $LogFile -Append
    $exit = $LASTEXITCODE
} finally {
    Pop-Location
}

$Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$Stamp] ingest_avaloq finished (exit $exit)" | Out-File -FilePath $LogFile -Append -Encoding utf8

exit $exit
