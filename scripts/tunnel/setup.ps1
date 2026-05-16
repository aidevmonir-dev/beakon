# ---------------------------------------------------------------------------
# OPTION A — ngrok (recommended right now: no DNS / nameserver changes needed)
# ---------------------------------------------------------------------------
# Prereqs:
#   1. Sign up free at https://dashboard.ngrok.com/signup
#   2. Claim a free static domain in the dashboard (1 per free account).
#   3. Copy your authtoken from the dashboard.
#   4. Install ngrok if not present:  winget install ngrok.ngrok
#
# Then:
#      ngrok config add-authtoken <YOUR_AUTHTOKEN>
#      # Edit scripts/tunnel/ngrok.yml — replace YOUR-STATIC-DOMAIN.ngrok-free.app
#      ngrok start --config D:\bookkeeper\scripts\tunnel\ngrok.yml beakon
#
# Make sure these are already running on this machine:
#      cd frontend && npm run dev          (port 3000)
#      python manage.py runserver           (port 8000)
#
# Add your ngrok hostname to frontend\.env.local so HMR doesn't bark:
#      NEXT_PUBLIC_DEV_ORIGINS=your-static-domain.ngrok-free.app
#
# Django side — add the ngrok hostname to .env:
#      ALLOWED_HOSTS=localhost,127.0.0.1,your-static-domain.ngrok-free.app
#      CSRF_TRUSTED_ORIGINS=https://your-static-domain.ngrok-free.app
#
# Restart both dev servers after .env changes.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# OPTION B — Cloudflare Tunnel (requires getbeakon.com nameservers on Cloudflare,
# so use this once you're able to migrate DNS).
# ---------------------------------------------------------------------------
# Run these commands MANUALLY, one at a time — do NOT execute this file as a script.
# Each step waits on the previous one (browser login, name confirmation, etc.).

$ErrorActionPreference = "Stop"
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

# --- STEP 1 -----------------------------------------------------------------
# Authenticate cloudflared with your Cloudflare account.
# Opens a browser; pick the domain you want to use. This drops cert.pem in
# C:\Users\User\.cloudflared\
& $cloudflared tunnel login

# --- STEP 2 -----------------------------------------------------------------
# Create the named tunnel. Note the TUNNEL UUID printed at the end — you need
# it for config.yml.
& $cloudflared tunnel create beakon-demo

# --- STEP 3 -----------------------------------------------------------------
# Point DNS records at the tunnel. Replace yourdomain.com with your real one.
& $cloudflared tunnel route dns beakon-demo app.yourdomain.com
& $cloudflared tunnel route dns beakon-demo api.yourdomain.com

# --- STEP 4 -----------------------------------------------------------------
# Edit D:\bookkeeper\scripts\tunnel\config.yml — replace TUNNEL_ID + yourdomain.com.
# Then copy it into the cloudflared config directory:
Copy-Item D:\bookkeeper\scripts\tunnel\config.yml C:\Users\User\.cloudflared\config.yml -Force

# --- STEP 5 -----------------------------------------------------------------
# Test-run the tunnel in the foreground (Ctrl+C to stop).
# Make sure `npm run dev` (port 3000) and `python manage.py runserver` (port 8000)
# are already running first.
& $cloudflared tunnel run beakon-demo

# --- STEP 6 (optional) ------------------------------------------------------
# Install as a Windows service so it auto-starts on boot and survives reboots.
# Run PowerShell as Administrator for this one.
& $cloudflared service install
Start-Service cloudflared
