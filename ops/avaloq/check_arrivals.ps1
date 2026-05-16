# Wrapper invoked once daily by Windows Task Scheduler at 08:30 CET.
#
# Reports custodians whose latest Avaloq drop is behind the expected
# business day. Non-zero exit when any are late so the scheduler's
# "On failure" hook can fire an alert (email, Slack, etc.).
#
# Install (run once, elevated PowerShell):
#   schtasks /Create /TN "Beakon\Avaloq Arrivals Check" `
#     /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"D:\bookkeeper\ops\avaloq\check_arrivals.ps1`"" `
#     /SC DAILY /ST 08:30 /RU SYSTEM /RL HIGHEST

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Python   = Join-Path $RepoRoot "venv\Scripts\python.exe"
$Manage   = Join-Path $RepoRoot "manage.py"
$LogDir   = Join-Path $RepoRoot "logs\avaloq"
$LogFile  = Join-Path $LogDir ("arrivals-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$Stamp] check_avaloq_arrivals starting" | Out-File -FilePath $LogFile -Append -Encoding utf8

Push-Location $RepoRoot
try {
    & $Python $Manage check_avaloq_arrivals 2>&1 | Tee-Object -FilePath $LogFile -Append
    $exit = $LASTEXITCODE
} finally {
    Pop-Location
}

$Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$Stamp] check_avaloq_arrivals finished (exit $exit)" | Out-File -FilePath $LogFile -Append -Encoding utf8

exit $exit
