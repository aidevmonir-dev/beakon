# ECB foreign-exchange reference-rate sync

| Field      | Value |
|------------|-------|
| Date       | 2026-05-10 |
| Component  | FX |
| Author     | Monirul |
| Status     | Installed |
| Reversible | Yes — manual rates are preserved; ECB rows can be deleted by `source="ecb"` filter without touching anything else. |

---

## 1. What this is

Beakon now pulls daily foreign-exchange reference rates directly from
the **European Central Bank**, with one click in the UI or one cron
line on the server. Roughly 30 major currency pairs (EUR-base), plus
inverses, plus CHF cross-rates so the kernel never has to triangulate
at posting time. ECB publishes free, no-API-key rates around 16:00 CET
on every business day. The data lands in the existing `FXRate` table
with `source = "ecb"`, which keeps it visually distinct from
hand-keyed entries.

## 2. Why we built it

Multi-currency posting and FX revaluation are blueprint requirements
(layer 5 in the 2026-04-30 architecture document — multi-dimensional
posting + Swiss reporting). Without rates the kernel cannot:

- Translate a USD bill into the entity's CHF functional currency.
- Run period-end FX revaluation on monetary balances.
- Render reports in a chosen presentation currency.

ECB is the right *first* source: free, official, no key, daily, and
covers every currency Thomas's entities transact in today.
Commercial sources (Bloomberg, OANDA) can layer on later for
intraday, exotic pairs, or audit-grade fixings.

## 3. What's installed (technical)

- **Models / migrations:** none new — uses the existing `FXRate`
  table (already present pre-2026-05). The `source` column is the
  filter key.
- **Service:** `beakon_core/services/ecb_fx.py`
  - `ECBFXService.sync(days=N)` — pulls daily or 90-day endpoint,
    parses the gesmes / ECB XML, derives inverses + CHF crosses,
    idempotent upsert on `(from, to, as_of)`.
  - Returns a `SyncResult` dataclass with row counts.
  - Raises `ECBSyncError` on network or parse failure.
- **Management command:**
  `beakon_core/management/commands/sync_ecb_fx_rates.py`
  - `manage.py sync_ecb_fx_rates [--days N]` (1–90, default 1)
- **API:** `POST /beakon/fx-rates/sync-ecb/`
  - View: `api/views/beakon.py::FXRateSyncECBView`
  - URL wired in `api/beakon_urls.py`
  - Body: `{"days": 1}` (default) or `{"days": 90}` for backfill
  - Auth: `IsAuthenticated + IsOrganizationMember`
  - Returns the `SyncResult` JSON; `502` on ECB unreachable.
- **Frontend:** `frontend/src/app/dashboard/fx-rates/page.tsx`
  - "Sync ECB" button in the page header.
  - Source-tone badge: `ecb` styled in brand colour, `manual` neutral.
  - Stats card "ECB rows" with latest sync date.
- **Settings / env vars:** none. Runs out of the box.

## 4. What the admin needs to do

```powershell
# 1. Pull the latest code (already done if you are reading this
#    after `git pull`).
git pull

# 2. No migration is required — FXRate predates this update.

# 3. One-time backfill of the last 90 business days so reports for
#    historical periods can revalue without gaps.
python manage.py sync_ecb_fx_rates --days 90

# 4. Schedule the daily refresh.

#    Linux / production cron — runs at 17:00 CET, Mon–Fri:
#    0 17 * * 1-5 cd /app && python manage.py sync_ecb_fx_rates

#    Windows (Allina dev box) — Task Scheduler:
#    schtasks /Create /SC DAILY /TN "Beakon ECB FX" /ST 17:00 ^
#       /TR "powershell -Command \"cd D:\bookkeeper; python manage.py sync_ecb_fx_rates\""
```

ECB has no holiday calendar in its XML — non-publishing days are
simply absent. The cron is safe to fire on weekends/holidays; it
will see "no new fixing" and write nothing.

## 5. How to use it

- **UI:** Dashboard → **FX Rates** → top-right **Sync ECB** button.
  Click once for today, or expand the dropdown for a 90-day backfill.
  The success banner reports rows upserted + latest fixing date.
- **CLI:**
  ```powershell
  python manage.py sync_ecb_fx_rates --days 1
  ```
  Sample output:
  ```
  Synced 1 day(s) from ECB.
    Latest fixing:    2026-05-08
    Rows upserted:    114
    Inverses added:   30
    Cross-rates:      58
    Source:           https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
  ```
- **API:**
  ```http
  POST /beakon/fx-rates/sync-ecb/
  Content-Type: application/json
  {"days": 1}
  ```
  Response (200):
  ```json
  {
    "fetched_days": 1,
    "rows_upserted": 114,
    "inverses_added": 30,
    "cross_rates_added": 58,
    "latest_date": "2026-05-08",
    "source_url": "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
  }
  ```

## 6. What runs automatically

Once the cron / scheduled task in step 4 is in place, Beakon refreshes
ECB rates every weekday at 17:00 CET. There is no signal-based or
on-demand auto-fetch — postings against missing dates fall back to
the most-recent prior rate per the kernel's standard FX lookup.

## 7. Verifying it works

After clicking **Sync ECB** (or running the CLI), at least one of the
following should be true:

- The "ECB rows" summary card on the FX Rates page shows a non-zero
  number with a recent "Latest:" date.
- Django shell:
  ```python
  from beakon_core.models import FXRate
  FXRate.objects.filter(source="ecb").count()      # > 0
  FXRate.objects.filter(source="ecb").latest("as_of").as_of
  ```
- Pick any ECB-quoted pair and check the value matches
  https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml for
  the same date.

## 8. Rolling back

In order of severity:

- **Stop refreshing:** disable the cron / scheduled task. Existing
  rows remain usable.
- **Hide the UI button:** comment out the "Sync ECB" `<button>` in
  `frontend/src/app/dashboard/fx-rates/page.tsx` (search for
  `Sync ECB`).
- **Wipe ECB-sourced rows only** (manual entries are preserved):
  ```python
  from beakon_core.models import FXRate
  FXRate.objects.filter(source="ecb").delete()
  ```
- **Revert the code:** the service and command landed in commit
  `111de0f` ("Beakon engine + masters + AI workflow build-out") —
  cherry-pick a revert of those two files plus the URL line and the
  frontend button.

## 9. Known limits

- ECB does **not** quote weekends, ECB holidays, or non-EUR-cross
  exotics (e.g. EGP, NGN, ARS). Postings in those currencies need a
  manual rate or a future commercial-data integration.
- Cross-rates are derived only for currencies in `CROSS_BASES = ("CHF",)`.
  Adding GBP or USD cross-rates is a one-line tuple change in
  `ecb_fx.py`.
- ECB is a daily *reference* fixing, not an intraday or audit-grade
  rate. For audit-grade FX (e.g. acquisition-date rates for a
  business combination), record the rate manually with `source` set
  to a descriptive string (not `"ecb"`).
- The 90-day endpoint is the deepest history fetched today. ECB's
  full-history endpoint (`eurofxref-hist.xml`, ~5 MB back to 1999)
  is intentionally not wired in — opt in by editing `ecb_fx.py` if a
  deeper backfill is needed.

## 10. Files touched

```
beakon_core/services/ecb_fx.py                        | new (+234)
beakon_core/management/commands/sync_ecb_fx_rates.py  | new ( +45)
beakon_core/services/__init__.py                      | export ECBFXService
api/views/beakon.py                                   | +FXRateSyncECBView
api/beakon_urls.py                                    | +fx-rates/sync-ecb/ route
frontend/src/app/dashboard/fx-rates/page.tsx          | "Sync ECB" UI
```

## 11. References

- Beakon Architecture (2026-04-30), layer 5: multi-dimensional
  posting + Swiss reporting requires reliable FX.
- Founder working paper: multi-entity, multi-currency mandate.
- ECB feed documentation: <https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html>
- First install-update document — sets the format for everything
  that follows. See `_TEMPLATE.md`.
