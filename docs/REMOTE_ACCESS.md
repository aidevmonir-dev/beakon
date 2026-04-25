# Giving Thomas remote access via Cloudflare Tunnel

Goal: let Thomas in Switzerland click around your local Beakon instance,
without deploying anywhere. Setup time: ~15 minutes.

## One-time setup

### 1. Install cloudflared
```powershell
winget install --id Cloudflare.cloudflared
```

### 2. Confirm the env-var plumbing is in place
The frontend's API base URL is now read from `NEXT_PUBLIC_API_BASE` (or
`NEXT_PUBLIC_API_HOST`); see `frontend/.env.local.example`. Django's
`ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS` are read from the project
`.env`. Both already support tunnel URLs without code changes — you only
need to update env files.

## Each time you want to give Thomas access

### 1. Start Django (bind to all interfaces)
```powershell
cd D:\bookkeeper
venv\Scripts\python.exe manage.py runserver 0.0.0.0:8000
```

### 2. Start a tunnel for Django (separate terminal)
```powershell
cloudflared tunnel --url http://localhost:8000
```
Copy the printed `https://random-words.trycloudflare.com` URL — this is
your **Django tunnel URL**. Call it `DJANGO_URL` for the next steps.

### 3. Add the Django URL to `.env` (project root)
Append (or replace existing lines):
```
ALLOWED_HOSTS=localhost,127.0.0.1,random-words.trycloudflare.com
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend-tunnel.trycloudflare.com
```
Replace `random-words.trycloudflare.com` with the actual hostname from
the tunnel output (no `https://` prefix on `ALLOWED_HOSTS`).

You'll fill in the frontend tunnel URL in step 5 once you have it.
Then **restart Django** to pick up the new env vars.

### 4. Update the frontend env
Create or edit `frontend/.env.local`:
```
NEXT_PUBLIC_API_BASE=https://random-words.trycloudflare.com/api/v1
```
Restart Next:
```powershell
cd frontend
npm run dev
```

### 5. Start a tunnel for Next.js (separate terminal)
```powershell
cloudflared tunnel --url http://localhost:3000
```
Copy this second `https://*.trycloudflare.com` URL — this is what you
send Thomas.

### 6. Update Django CORS again
Add the frontend tunnel URL to `CORS_ALLOWED_ORIGINS` in `.env` and
restart Django:
```
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://your-next-tunnel.trycloudflare.com
```

### 7. Send Thomas
- The frontend tunnel URL
- Login: `guest@beakon.local` / `guest1234` (consider changing the
  password before exposing)

## What to tell Thomas

> Beakon dev preview — running on Monirul's machine via Cloudflare Tunnel.
> AI features (OCR, chat, narrative) take 30–90 seconds: local Ollama on
> CPU plus transatlantic round-trip. With a real GPU server it's 2–5s.
> Click the **✨ Get AI commentary** button on Reports for the AI demo.
> Bills (AP), Invoices (AR), Anomalies, and Ask Beakon AI (bottom centre)
> are the most interesting flows.

## Caveats

- **Your machine must stay on** while Thomas is reviewing.
- **Single user at a time** — the dev server isn't designed for concurrent
  access. If Thomas hits errors, ask him to refresh.
- **The tunnel URL changes every time you restart `cloudflared`** unless you
  set up a named tunnel (free Cloudflare account required, ~10 min extra).
- **`SECRET_KEY` and `DEBUG=True`** — fine for a quick demo, NOT fine for
  long-term exposure. For ongoing access, set `DEBUG=False` and use a
  proper `SECRET_KEY`.

## Tearing it down

Just Ctrl+C the two `cloudflared` processes. The tunnel URLs stop working
immediately. Your local services keep running.
