# Beakon — AI-native finance operating system

Django 6 backend + Next.js 16 frontend + PostgreSQL.

Scope per the founder working paper (2026-04-17): multi-entity accounting,
intercompany, multi-currency, controlled approval workflow, bank feeder.
AI is an enabling layer, not the foundation.

---

## Active Django apps

| App | Role |
|---|---|
| `accounts` | User identity, auth, sessions |
| `organizations` | Tenant master (org → members → roles) |
| `audit` | AuditEvent + middleware |
| `api` | URL shell |
| `beakon_core` | **Accounting kernel** — Entity, CoA, FX, Period, JournalEntry, ApprovalAction |
| `beakon_banking` | **Feeder** — BankAccount, CSV import, Categorizer |

Everything ledger-related lives under `/api/v1/beakon/`.

---

## Setup

### Prerequisites
- Python 3.11+ (venv is at `./venv/`; activate with `venv\Scripts\activate` on Windows or `source venv/bin/activate` on Mac/Linux)
- PostgreSQL 14+
- Node 20+ for the frontend

### 1. Environment
```bash
cp .env.example .env
# Edit .env — at minimum DB_NAME, DB_USER, DB_PASSWORD, SECRET_KEY.
# Optional: ANTHROPIC_API_KEY (not yet consumed by the kernel).
```

### 2. Database
```bash
createdb beakon
```

### 3. Backend
```bash
python -m venv venv
source venv/bin/activate          # or venv\Scripts\activate on Windows
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 8000
```

### 4. Frontend (second terminal)
```bash
cd frontend
npm install
npm run dev
```

UI at http://localhost:3000, API at http://localhost:8000/api/v1/, admin at http://localhost:8000/admin/.

After login, create an Organization in admin and add your user as an OrganizationMember with a Role (Owner).

---

## Smoke tests

All four run against the real DB inside a rolled-back transaction:

```bash
python beakon_core/smoketest.py          # state machine + FX + reversal
python beakon_core/reports_smoketest.py  # TB / P&L / BS / ledger / entry detail
python beakon_core/api_smoketest.py      # full HTTP flow via test client
python beakon_banking/smoketest.py       # CSV import → categorize → post → matched
```

Each one prints `OK: … -- rolling back.` on success.

---

## UI pages

| Path | Purpose |
|---|---|
| `/dashboard` | Home — approval inbox, recent posted, quick links |
| `/dashboard/entities` | Legal / reporting units (multi-entity master) |
| `/dashboard/accounts` | Chart of Accounts — entity-scoped or shared |
| `/dashboard/journal-entries` | JE list with status filters |
| `/dashboard/journal-entries/[id]` | JE detail with every approval action |
| `/dashboard/reports` | Trial Balance · P&L · Balance Sheet (single-entity or consolidated) |
| `/dashboard/bank` | Bank accounts list |
| `/dashboard/bank/[id]` | Bank feed — CSV import + per-txn categorize |
| `/dashboard/periods` | Per-entity period control (open / soft-close / closed) |
| `/dashboard/audit` | Approval action log |
| `/dashboard/demo` | Module walkthrough with comment boxes |

---

## Project structure

```
beakon/
├── digits_clone/          # Django project config (name kept for migration safety)
├── accounts/              # auth
├── organizations/         # tenancy
├── audit/                 # audit log
├── api/                   # URL shell + non-kernel endpoints (auth, orgs, audit)
├── beakon_core/           # the kernel
│   ├── models/            # Entity, Account, Period, JE, Line, ApprovalAction, FXRate
│   ├── services/          # JournalService, ReportsService, FXService, EntityService
│   ├── admin.py
│   └── *_smoketest.py
├── beakon_banking/        # bank feeder
│   ├── models.py
│   ├── services/          # CSVImporter, Categorizer
│   ├── signals.py         # auto-sync matched status when linked JE posts
│   └── smoketest.py
├── frontend/              # Next.js 16 UI
│   └── src/app/dashboard/ # real pages only; nothing stubbed
├── docs/                  # original module plan + schema (reference material)
├── manage.py
├── requirements.txt
└── .env.example
```

---

## Troubleshooting

**`psycopg2` install fails**: Linux/Mac → `apt install libpq-dev` or `brew install postgresql`. Windows → the binary wheel usually works out of the box.

**Frontend dev server hangs**: `rm -rf frontend/.next` then `cd frontend && npm run dev`.

**No organization context** (401s on every `/api/v1/*` call): log in to `/admin/`, create an Organization, add your user as an OrganizationMember with an Owner role.

**API call returns `BK016 self-approval`**: the kernel refuses to let the same user both submit and approve a JE. Log in as a second user to approve.
