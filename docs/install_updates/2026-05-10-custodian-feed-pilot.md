# Custodian Statements pilot — Avaloq daily-statement ingestion

| Field      | Value |
|------------|-------|
| Date       | 2026-05-10 |
| Component  | Banking / Custodian feed |
| Author     | Monirul |
| Status     | Installed (demo-only) — pilot wiring against mock files |
| Reversible | Yes — ingested rows are scoped via `AvaloqFeedDrop`; deleting the drop cascades. New models can be reverted by dropping migrations 0044 / 0003. |

---

## 1. What this is

Beakon now ingests a **daily SFTP zip from a custodian** (Geneva
Avaloq pilot). One zip contains five files — cash, securities,
positions, performance, open orders — and lands as a single
``AvaloqFeedDrop`` audit row. Each file is parsed into the right
domain table; positions are reconciled against Beakon's running
TaxLot view and disagreements raise a ``ReconciliationBreak`` for
review.

There is a new dashboard page (**Custodian Statements**) that walks
the user from "statement received" → "statement contents" →
"reconciliation differences" without leaving the screen. For Monday's
demo, a **Receive sample statement** button brings in a mock daily
package locally — when real bank samples arrive, the same flow picks
them up unchanged.

## 2. Why we built it

The first private clients Beakon will onboard hold investments at a
Geneva-based Avaloq private bank. The bank will push files to our
SFTP endpoint daily — see the integration spec at
``docs/integrations/2026-05-10-geneva-bank-avaloq-sftp.md``.

Building the pipeline now (against mock files) lets us:

- Show Thomas a working demo on Monday.
- De-risk the architecture before the bank's IT call so we go in with
  concrete questions instead of a blank slate.
- Isolate format-specific work behind per-file parsers — when real
  Avaloq samples arrive only the column-mappers change.

## 3. What's installed (technical)

### Models / migrations

- **beakon_banking** (migration `0003_alter_feedimport_source_avaloqfeeddrop_and_more`):
  - `AvaloqFeedDrop` — one row per daily zip; idempotent on
    `(organization, sha256, business_date)`.
  - `ReconciliationBreak` — discrepancies between bank truth and
    Beakon's ledger.
  - Added `avaloq_sftp` to `FeedImport.source` choices.
- **beakon_core** (migration `0044_openorder_performancesnapshot_portfoliotrade_and_more`):
  - `PortfolioTrade` ← XXX_securities
  - `PositionSnapshot` ← XXX_positions
  - `PerformanceSnapshot` ← XXX_perf
  - `OpenOrder` ← XXX_orderbook

### Service

- `beakon_banking/services/avaloq_feed.py`
  - `AvaloqFeedService.scan(incoming_dir)` — list new zips.
  - `AvaloqFeedService.ingest(zip, organization, custodian, user)` —
    extract, dispatch, parse, reconcile. Idempotent.
  - Per-file parsers (`_parse_cash`, `_parse_securities`,
    `_parse_positions`, `_parse_performance`, `_parse_orderbook`) —
    the only part that changes when real samples arrive.
  - `_reconcile_positions(drop, portfolio, organization)` — bank
    snapshot vs. open TaxLot quantities.

### Management commands

- `manage.py drop_mock_avaloq [--portfolio X] [--business-date Y]` —
  demo only; generates a mock zip into `AVALOQ_INCOMING_DIR`.
- `manage.py ingest_avaloq [--organization N] [--custodian X] [--zip path]` —
  sweep + process; idempotent.
- `manage.py seed_avaloq_demo` — idempotent demo data: entity,
  cash accounts, three bank accounts (USD/CHF/EUR), portfolio
  `BEAKON-DEMO-001`, five TaxLot rows wired to surface exactly two
  reconciliation breaks (ROCHE in TaxLot but missing from positions;
  NESTLE in positions but no TaxLot).

### API

All under `/api/v1/beakon/bank-feed/`:

| Method | Path                       | Purpose |
|--------|----------------------------|---------|
| POST   | `simulate-push/`           | Demo: drop a mock zip into the incoming dir. Body: `{"portfolio": "BEAKON-DEMO-001", "business_date": "2026-05-10"}` (both optional). |
| POST   | `ingest/`                  | Sweep incoming and process. Body: `{"custodian": "CUST_LOMBARD_GVA"}` (optional). |
| GET    | `drops/`                   | List recent drops. |
| GET    | `drops/<id>/`              | Detail: counts + breaks + sample rows of each file type. |
| GET    | `breaks/?resolved=false`   | Reconciliation break list (open by default). |

### Frontend

- New page: `/dashboard/bank-feed/`
  - "Simulate Avaloq push" + "Ingest now" buttons.
  - Stats: zips ingested, rows imported, open breaks, last ingest.
  - Drops table with file-type chips and per-drop break count.
  - Open-breaks list with bank-vs-Beakon comparison.
  - Drill-down drawer: per-drop sample rows of cash, trades,
    positions, performance, orderbook.
- Sidebar: new "Custodian Feed" entry under **Money**.

### Settings / env vars

- `AVALOQ_INCOMING_DIR` (default
  `<BASE_DIR>/incoming/avaloq/`) — where the SFTP daemon lands
  custodian zips. Override in production to the chrooted SFTP
  user's home.

## 4. What the admin needs to do

```powershell
# 1. Pull and install
git pull
python manage.py migrate

# 2. Seed the demo data (idempotent — safe to re-run)
python manage.py seed_avaloq_demo

# 3. Smoke test on the CLI
python manage.py drop_mock_avaloq --portfolio BEAKON-DEMO-001
python manage.py ingest_avaloq --custodian CUST_LOMBARD_GVA
# Expect: cash 10, securities 4, orderbook 3, positions 5, perf 4
#         + 2 reconciliation breaks (ROCHE / NESTLE)

# 4. Start the dev servers (if not already running)
python manage.py runserver 0.0.0.0:8000
# In another terminal
cd frontend ; npm run dev
```

Open <http://localhost:3000/dashboard/bank-feed/> and click
**Simulate Avaloq push** → **Ingest now** → drill into the drop.

For production scheduling once the real bank pushes are live:

```text
# Linux cron — every 15 min between 06:00 and 09:00 CET, Mon–Fri
*/15 6-9 * * 1-5  cd /app && python manage.py ingest_avaloq

# Windows Task Scheduler equivalent
schtasks /Create /SC DAILY /TN "Beakon Avaloq Sweep" /ST 06:00 ^
  /RI 15 /DU 03:00 ^
  /TR "powershell -Command \"cd D:\bookkeeper; python manage.py ingest_avaloq\""
```

## 5. How to use it

- **UI:** Dashboard → **Custodian Statements**.
  1. **Receive sample statement** brings in a mock daily statement.
  2. **Post statement** records it in the ledger and reconciles
     holdings against your books.
  3. The "Statements received" table shows section chips with
     line-item counts; click any row for the statement drawer.
  4. The "Reconciliation differences" section shows
     per-custodian-vs-per-ledger comparisons line-by-line.
- **CLI:** see step 3 above.
- **API:** see endpoint table in section 3.

## 6. What runs automatically

Nothing yet — the sweep is manual until the real SFTP feed is live.
Once the bank's IT call is done and we have sample files + a real
custodian SFTP push, schedule the sweep via cron or Task Scheduler
(see section 4).

## 7. Verifying it works

After running the seed + the smoke test in section 4, in the Django
shell:

```python
from beakon_banking.models import AvaloqFeedDrop, ReconciliationBreak
from beakon_core.models import PositionSnapshot, PortfolioTrade

drop = AvaloqFeedDrop.objects.first()
assert drop.status == "ingested"
assert drop.file_counts == {
    "cash": 10, "securities": 4, "orderbook": 3,
    "positions": 5, "perf": 4,
}

breaks = ReconciliationBreak.objects.filter(drop=drop)
assert breaks.count() == 2
assert {b.isin for b in breaks} == {"CH0012032048", "CH0038863350"}
```

The dashboard page shows the same three counts (zips ingested,
rows imported, open breaks) at the top.

## 8. Rolling back

In order of severity:

- **Hide the page:** comment out the "Custodian Feed" item in
  `frontend/src/components/sidebar-nav.ts`.
- **Stop ingestion:** disable any cron / Task Scheduler entry. The
  incoming directory will simply accumulate zips.
- **Wipe ingested data** (drops cascade-delete child rows):
  ```python
  from beakon_banking.models import AvaloqFeedDrop
  AvaloqFeedDrop.objects.all().delete()
  ```
- **Revert the schema:**
  ```powershell
  python manage.py migrate beakon_core 0043
  python manage.py migrate beakon_banking 0002
  ```

## 9. Known limits

- **Mock files only.** The CSV column shapes are *preliminary* —
  invented in `scripts/_generate_mock_avaloq_zip.py`. When the bank
  shares real samples, only the per-file parsers in
  `beakon_banking/services/avaloq_feed.py` need to change.
- **Cash → BankTransaction needs a BankAccount per currency.** The
  parser writes nothing for currencies with no matching active
  bank account. The seed creates USD / CHF / EUR; anything else
  silently skips. *In production, the seed step is replaced by
  client onboarding.*
- **Portfolio resolution by zip prefix only.** The `XXX` filename
  prefix must equal `Portfolio.portfolio_id`. Mismatches raise a
  `missing_portfolio` break and the rest of the zip is skipped.
- **Reconciliation is positions-only today.** Cash and securities
  trades are not reconciled against bank balances yet.
- **No SFTP receiver.** The drop directory is local. Real SFTP
  hosting is a separate work item — see the integration spec.

## 10. Files touched

```
beakon_banking/constants.py                       | +Avaloq + break constants
beakon_banking/models.py                          | +AvaloqFeedDrop, ReconciliationBreak
beakon_banking/admin.py                           | + admin pages
beakon_banking/services/avaloq_feed.py            | new (+560)
beakon_banking/services/__init__.py               | export AvaloqFeedService
beakon_banking/management/commands/drop_mock_avaloq.py   | new
beakon_banking/management/commands/ingest_avaloq.py      | new
beakon_banking/migrations/0003_*.py               | new
beakon_core/models/__init__.py                    | export portfolio_feed
beakon_core/models/portfolio_feed.py              | new (+260)
beakon_core/management/commands/seed_avaloq_demo.py     | new
beakon_core/migrations/0044_*.py                  | new
api/views/beakon_bank_feed.py                     | new (+220)
api/beakon_urls.py                                | +5 routes
digits_clone/settings.py                          | +AVALOQ_INCOMING_DIR
scripts/_generate_mock_avaloq_zip.py              | new (+220)
frontend/src/app/dashboard/bank-feed/page.tsx     | new (+560)
frontend/src/components/sidebar-nav.ts            | + Custodian Feed nav item
.gitignore                                        | + /incoming/
```

## 11. References

- `docs/integrations/2026-05-10-geneva-bank-avaloq-sftp.md` — the
  pre-build spec (what the bank offers, what we still need from
  them, kick-off agenda).
- `docs/install_updates/_TEMPLATE.md` — install-update doc format.
- Beakon Architecture (2026-04-30), layer 3 (ingestion) and layer 5
  (multi-dimensional posting).
