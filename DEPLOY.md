# Deploying Beakon

This gets the app off your laptop so Thomas can hit it any time.

**Stack:**
- **Backend** → Fly.io (Dockerized Django, always-on, no idle spin-down)
- **Database** → Neon (Postgres, generous free tier)
- **Frontend** → Vercel (Next.js, free, global CDN)

**Total cost** for a demo-scale deployment: **$0/month** on free tiers. Bump to paid if you need guaranteed uptime or more than 3GB Postgres.

---

## 0 · One-time prerequisites

1. **Install the Fly CLI**
   ```powershell
   iwr https://fly.io/install.ps1 -useb | iex
   ```
2. **Install the Vercel CLI** (optional — the web dashboard works too)
   ```bash
   npm i -g vercel
   ```
3. **Create accounts**
   - [fly.io](https://fly.io) — needs a card on file, but won't charge for free-tier usage
   - [neon.tech](https://neon.tech) — no card
   - [vercel.com](https://vercel.com) — no card

4. **Git-ify the repo** (Vercel needs a GitHub repo)
   ```bash
   cd D:/bookkeeper
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create beakon --private --source=. --push
   ```

---

## 1 · Provision the database (Neon)

1. Create a project on Neon → pick the US-East region.
2. Copy the **pooled connection string** (it starts with `postgres://`). It looks like:
   ```
   postgres://user:password@ep-xxxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

---

## 2 · Deploy the backend (Fly)

```bash
cd D:/bookkeeper
fly auth login
fly launch --no-deploy --name beakon-api --region iad --copy-config
```

- When prompted to set up Postgres or Redis — **skip both**. We use Neon instead.
- This writes your app name into `fly.toml`.

Set production secrets:

```bash
fly secrets set \
  SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(50))')" \
  DEBUG=False \
  DATABASE_URL="postgres://...neon.tech/...?sslmode=require" \
  ALLOWED_HOSTS="beakon-api.fly.dev,your-frontend.vercel.app" \
  CORS_ALLOWED_ORIGINS="https://your-frontend.vercel.app" \
  FRONTEND_URL="https://your-frontend.vercel.app" \
  ANTHROPIC_API_KEY="sk-ant-..."
```

Deploy:

```bash
fly deploy
```

The release command (`python manage.py migrate`) runs automatically before traffic switches. If it fails, the old version keeps serving — nothing breaks.

**Seed a demo user** (optional, for Thomas to log in):
```bash
fly ssh console -C "python manage.py createsuperuser"
# or run a custom seed script you already have
```

Verify:
```bash
curl https://beakon-api.fly.dev/healthz
# {"status": "ok"}
```

---

## 3 · Deploy the frontend (Vercel)

From the `frontend/` directory:

```bash
cd frontend
vercel
```

Follow the prompts. Vercel autodetects Next.js.

**Set the API base URL** (Vercel dashboard → Settings → Environment Variables, or CLI):

```bash
vercel env add NEXT_PUBLIC_API_BASE production
# paste: https://beakon-api.fly.dev/api/v1
```

Redeploy so the new env var is baked in:
```bash
vercel --prod
```

---

## 4 · Loop back CORS

After Vercel gives you the production URL (e.g. `beakon-xyz.vercel.app`), update the backend so CORS lets it through:

```bash
fly secrets set \
  CORS_ALLOWED_ORIGINS="https://beakon-xyz.vercel.app" \
  ALLOWED_HOSTS="beakon-api.fly.dev,beakon-xyz.vercel.app" \
  FRONTEND_URL="https://beakon-xyz.vercel.app"
```

(Vercel preview URLs like `beakon-xyz-git-main.vercel.app` are auto-allowed via the `*.vercel.app` regex already in `settings.py`.)

---

## 5 · Known gaps

These don't block a demo but are worth knowing:

1. **AI features won't work in cloud.** `Ask Beakon`, bill OCR streaming, and the narrative-box all hit `OLLAMA_BASE_URL=http://localhost:11434`, which doesn't exist on Fly. Either:
   - Run Ollama on a GPU VM and point `OLLAMA_BASE_URL` at it, or
   - Replace Ollama calls with Anthropic (uses the existing `ANTHROPIC_API_KEY`) — code change needed.

   Everything non-AI (CoA, entities, journal entries, bills, invoices, reports, approvals) works fully.

2. **Media uploads are ephemeral.** Bill receipts / source documents uploaded on Fly land on the VM's local filesystem and disappear on restart. For persistent storage, either:
   - Attach a Fly volume (`fly volumes create media --size 3`) and mount it at `/app/media`, or
   - Switch `DEFAULT_FILE_STORAGE` to S3 (boto3 is already in `requirements.txt`).

3. **WeasyPrint PDF generation** is wired up and containerized, but OOMs on 512mb machines when PDFs are large. If the Bills page starts returning 500s on `Generate PDF`, bump the VM:
   ```bash
   fly scale memory 1024
   ```

4. **Celery** (background tasks) needs a Redis instance. None of the currently-wired flows actually enqueue tasks, so this can wait. Add `UPSTASH_REDIS_URL` later if needed.

---

## 6 · Ongoing workflow

- **Redeploy backend:** `fly deploy`
- **Redeploy frontend:** `vercel --prod` (or push to the GitHub main branch — auto-deploys)
- **View backend logs:** `fly logs -a beakon-api`
- **Shell in:** `fly ssh console -a beakon-api`
- **DB console:** run `psql "$DATABASE_URL"` from the Fly shell, or use Neon's web SQL console
- **Rollback:** `fly releases` → `fly deploy --image <previous-image>`

---

## 7 · Production checklist before inviting external users

- [ ] Rotate `SECRET_KEY` (regenerate with `python -c 'import secrets; print(secrets.token_urlsafe(50))'`)
- [ ] Bump `SECURE_HSTS_SECONDS` from 3600 to 31536000 in `settings.py`
- [ ] Switch `EMAIL_BACKEND` from console → real SMTP (AWS SES or Postmark)
- [ ] Set up backups on Neon (free tier includes point-in-time for 7 days)
- [ ] Add `fly scale count 2 --region iad,lhr` for regional redundancy
- [ ] Enable Fly's certificate for a custom domain (`fly certs add api.beakon.com`)
- [ ] Add Sentry for error tracking (`SENTRY_DSN` env var + middleware)
