"""manage.py seed_avaloq_demo

Idempotent. Sets up the minimum data the Avaloq feed demo needs:

- Entity ``BEAKON-DEMO`` (CHF functional, CH country).
- Three Accounts on that entity: cash USD, cash CHF, cash EUR.
- Three BankAccounts (one per currency) — receiving end of the cash file.
- Portfolio ``BEAKON-DEMO-001`` linked to existing Lombard Odier Geneva
  custodian (`CUST_LOMBARD_GVA`).
- Five TaxLot rows for the portfolio. Counts are deliberately set so
  the position-vs-TaxLot reconciliation surfaces exactly **two** breaks
  on the next ingest:

      * ROCHE in TaxLot (100 shares) but NOT in the bank's position
        snapshot — break type ``position_qty_mismatch``.
      * NESTLE in the bank's position snapshot (80 shares) but no
        TaxLot — break type ``unknown_isin``.

  Two breaks is the sweet spot for the demo: enough to show the
  reconciliation actually does something, few enough that we can drill
  into each one in front of Thomas.

Re-run safely as often as needed.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from beakon_core import constants as core_c
from beakon_core.models import Account, Custodian, Entity, Instrument, Portfolio, TaxLot
from beakon_core.models.portfolio_feed import (
    PERF_MTD, PERF_YTD, PerformanceSnapshot, PositionSnapshot,
)
from beakon_banking.models import BankAccount
from organizations.models import Organization


DEMO_ENTITY_CODE = "BEAKON-DEMO"
DEMO_PORTFOLIO_ID = "BEAKON-DEMO-001"
DEMO_CUSTODIAN_ID = "CUST_LOMBARD_GVA"


CASH_ACCOUNTS = [
    # (code, name, currency)
    ("1011", "Cash at Bank — USD", "USD"),
    ("1012", "Cash at Bank — CHF", "CHF"),
    ("1013", "Cash at Bank — EUR", "EUR"),
]


TAX_LOTS = [
    # (lot_id, isin, instrument, qty, ccy, price)
    ("TLOT-DEMO-AAPL", "US0378331005", "APPLE INC",        150, "USD", 178.20),
    ("TLOT-DEMO-MSFT", "US5949181045", "MICROSOFT CORP",    70, "USD", 402.10),
    ("TLOT-DEMO-ROG",  "CH0012032048", "ROCHE HOLDING AG", 100, "CHF", 261.30),
    ("TLOT-DEMO-GOOG", "US02079K3059", "ALPHABET INC CL A", 40, "USD", 165.80),
    ("TLOT-DEMO-NVDA", "US67066G1040", "NVIDIA CORP",       28, "USD", 905.00),
]


# Instrument-master rows so the Wealth dashboard can resolve ISIN →
# asset_class for the allocation donut. The acquisition prices in
# TAX_LOTS double as market prices for the position snapshot below.
INSTRUMENTS = [
    # (instrument_id, isin, name, type, asset_class_code)
    ("INS_AAPL", "US0378331005", "Apple Inc.",         "LISTED_EQUITY", "ACL_EQUITY"),
    ("INS_MSFT", "US5949181045", "Microsoft Corp.",    "LISTED_EQUITY", "ACL_EQUITY"),
    ("INS_ROG",  "CH0012032048", "Roche Holding AG",   "LISTED_EQUITY", "ACL_EQUITY"),
    ("INS_GOOG", "US02079K3059", "Alphabet Inc. Cl A", "LISTED_EQUITY", "ACL_EQUITY"),
    ("INS_NVDA", "US67066G1040", "NVIDIA Corp.",       "LISTED_EQUITY", "ACL_EQUITY"),
    # Diversifiers so the allocation donut shows >1 slice
    ("INS_GOVT_CH_10Y",  "CH0009980895", "Swiss Confederation 1.25% 2034", "GOV_BOND", "ACL_FIXED_INCOME"),
    ("INS_CORP_NESTLE",  "XS2055605660", "Nestle Finance 0.875% 2027",     "CORP_BOND", "ACL_FIXED_INCOME"),
    ("INS_BLACKSTONE_VII","XS9999999991", "Blackstone PE Fund VII",        "PE_FUND",   "ACL_PRIVATE_EQUITY"),
    ("INS_SWISS_REIT",   "CH0228127059", "Swiss Property Real Estate Fund","REAL_ESTATE_FUND", "ACL_REAL_ESTATE"),
]


# Snapshot positions for the demo portfolio. Used to feed
# PositionSnapshot + drive the Wealth dashboard's AUM, top holdings,
# allocation donut and custodian overview. Each row is (isin, name,
# qty, price, ccy) and the snapshot value = qty × price.
POSITIONS_TODAY = [
    ("US0378331005", "Apple Inc.",             160, 195.40, "USD"),
    ("US5949181045", "Microsoft Corp.",         70, 432.10, "USD"),
    ("CH0012032048", "Roche Holding AG",       100, 268.50, "CHF"),
    ("US02079K3059", "Alphabet Inc. Cl A",      40, 175.20, "USD"),
    ("US67066G1040", "NVIDIA Corp.",            28, 948.00, "USD"),
    ("CH0009980895", "Swiss Confederation Bond", 5_000, 102.30, "CHF"),
    ("XS2055605660", "Nestle Finance Bond",     3_200, 101.10, "CHF"),
    ("XS9999999991", "Blackstone PE Fund VII",    150, 9_750.00, "USD"),
    ("CH0228127059", "Swiss Property REIT",     1_800, 142.50, "CHF"),
]


# YTD return per portfolio (single demo portfolio for now). Used by
# WealthSummaryView for the "Net Performance" KPI and Top Portfolios
# YTD column.
DEMO_YTD_RETURN_PCT = Decimal("8.20")
DEMO_MTD_RETURN_PCT = Decimal("1.40")


class Command(BaseCommand):
    help = "Seed the Avaloq feed demo (entity, portfolio, bank accounts, tax lots)."

    @transaction.atomic
    def handle(self, *args, **opts):
        org = Organization.objects.order_by("id").first()
        if org is None:
            self.stderr.write(self.style.ERROR(
                "No Organization in the database — bootstrap the tenant first."
            ))
            return

        # 1. Entity
        entity, created = Entity.objects.get_or_create(
            organization=org, code=DEMO_ENTITY_CODE,
            defaults={
                "name": "Beakon Demo Client (Geneva)",
                "legal_name": "Beakon Demo Client SA",
                "functional_currency": "CHF",
                "country": "CH",
                "accounting_standard": core_c.ACCT_STD_IFRS,
                "is_active": True,
            },
        )
        self._log("Entity", entity.code, created)

        # 2. Cash accounts (one per currency)
        cash_accounts: dict[str, Account] = {}
        for code, name, ccy in CASH_ACCOUNTS:
            acc, created = Account.objects.get_or_create(
                organization=org, entity=entity, code=code,
                defaults={
                    "name": name,
                    "account_type": core_c.ACCOUNT_TYPE_ASSET,
                    "currency": ccy,
                    "is_active": True,
                    "posting_allowed": True,
                },
            )
            cash_accounts[ccy] = acc
            self._log(f"Account {code}", name, created)

        # 3. Bank accounts (one per currency, all on demo entity)
        for ccy, acc in cash_accounts.items():
            ba, created = BankAccount.objects.get_or_create(
                organization=org, entity=entity, currency=ccy,
                defaults={
                    "account": acc,
                    "name": f"Lombard Odier Geneva — {ccy}",
                    "bank_name": "Lombard Odier",
                    "account_number_last4": "0001",
                    "is_active": True,
                },
            )
            self._log(f"BankAccount {ccy}", ba.name, created)

        # 4. Custodian must exist (reuses an existing master row)
        custodian = Custodian.objects.filter(
            organization=org, custodian_id=DEMO_CUSTODIAN_ID,
        ).first()
        if custodian is None:
            self.stderr.write(self.style.WARNING(
                f"Custodian {DEMO_CUSTODIAN_ID} not found — proceeding "
                f"without a custodian FK. The demo still works."
            ))

        # 5. Portfolio
        portfolio, created = Portfolio.objects.get_or_create(
            organization=org, portfolio_id=DEMO_PORTFOLIO_ID,
            defaults={
                "portfolio_name": "Beakon Demo Portfolio (Geneva)",
                "short_name": "BEAKON-DEMO",
                "portfolio_type": "PERSONAL",
                "base_currency": "USD",
                "reporting_currency": "CHF",
                "country_code": "CH",
                "linked_custodian_obj": custodian,
                "linked_custodian_id": DEMO_CUSTODIAN_ID,
                "status": "ACTIVE",
                "active_flag": True,
                "posting_allowed_flag": True,
            },
        )
        self._log("Portfolio", portfolio.portfolio_id, created)

        # 6. Instruments — needed for ISIN → asset_class mapping in the
        # Wealth dashboard's allocation donut + top-holdings card.
        for inst_id, isin, name, kind, acl in INSTRUMENTS:
            inst, created = Instrument.objects.get_or_create(
                organization=org, instrument_id=inst_id,
                defaults={
                    "instrument_name": name,
                    "instrument_type": kind,
                    "asset_class_code": acl,
                    "isin_or_ticker": isin,
                    "status": "ACTIVE",
                    "currency": "CHF",
                },
            )
            self._log(f"Instrument {inst_id}", name, created)

        # 7. Today's PositionSnapshot per ISIN — drives every Wealth card
        # other than the performance trend. We write fresh rows for
        # today so re-running the seed always produces a current view.
        today = date.today()
        for isin, name, qty, price, ccy in POSITIONS_TODAY:
            qty_d = Decimal(str(qty))
            price_d = Decimal(str(price))
            market_value = (qty_d * price_d).quantize(Decimal("0.0001"))
            ps, created = PositionSnapshot.objects.update_or_create(
                organization=org, portfolio=portfolio, as_of=today, isin=isin,
                defaults={
                    "instrument_name": name,
                    "quantity": qty_d,
                    "market_value": market_value,
                    "currency": ccy,
                },
            )
            self._log(
                f"PositionSnapshot {isin}",
                f"{name} mv={market_value} {ccy}",
                created,
            )

        # 8. Performance snapshots — one YTD + one MTD row for today so
        # the dashboard's KPI + Top Portfolios card have something
        # meaningful. Also drop a sparse 12-month MTD/YTD trail so the
        # /wealth/performance-trend/ endpoint has data to interpolate.
        PerformanceSnapshot.objects.update_or_create(
            organization=org, portfolio=portfolio, as_of=today, period=PERF_YTD,
            defaults={
                "return_pct": DEMO_YTD_RETURN_PCT,
                "return_amount": Decimal("0"),
                "currency": "CHF",
            },
        )
        PerformanceSnapshot.objects.update_or_create(
            organization=org, portfolio=portfolio, as_of=today, period=PERF_MTD,
            defaults={
                "return_pct": DEMO_MTD_RETURN_PCT,
                "return_amount": Decimal("0"),
                "currency": "CHF",
            },
        )

        # Sparse trailing series for the performance-trend chart: drop a
        # month-end PositionSnapshot per ISIN going back 12 months so
        # the trend line has shape. The values scale linearly with a
        # mild upward drift — enough to read as growth without faking
        # detailed history.
        for offset in range(1, 13):
            month_back = _months_ago(today, offset)
            scale = Decimal(str(0.86 + (12 - offset) * 0.012))  # 0.86 → ~1.00
            for isin, name, qty, price, ccy in POSITIONS_TODAY:
                qty_d = Decimal(str(qty))
                price_d = Decimal(str(price))
                scaled_mv = (qty_d * price_d * scale).quantize(Decimal("0.0001"))
                PositionSnapshot.objects.update_or_create(
                    organization=org, portfolio=portfolio,
                    as_of=month_back, isin=isin,
                    defaults={
                        "instrument_name": name,
                        "quantity": qty_d,
                        "market_value": scaled_mv,
                        "currency": ccy,
                    },
                )

        self._log("Snapshots", f"position {len(POSITIONS_TODAY)} × 13 months", False)

        # 9. Tax lots
        for lot_id, isin, name, qty, ccy, price in TAX_LOTS:
            tl, created = TaxLot.objects.get_or_create(
                organization=org, tax_lot_id=lot_id,
                defaults={
                    "instrument_code": isin,
                    "portfolio_code": DEMO_PORTFOLIO_ID,
                    "portfolio": portfolio,
                    "custodian_code": DEMO_CUSTODIAN_ID,
                    "custodian": custodian,
                    "lot_open_date": date(2026, 1, 15),
                    "acquisition_trade_date": date(2026, 1, 15),
                    "original_quantity": qty,
                    "remaining_quantity": qty,
                    "unit_of_measure": "SHARES",
                    "acquisition_price_per_unit": price,
                    "acquisition_currency": ccy,
                    "lot_status": TaxLot.STATUS_OPEN,
                    "active_flag": True,
                    "notes": f"{name} — seeded by seed_avaloq_demo for the Geneva-feed demo.",
                },
            )
            self._log(f"TaxLot {lot_id}", f"{name} qty={qty}", created)

        self.stdout.write(self.style.SUCCESS(
            f"\nDemo data ready. Try:\n"
            f"  python manage.py drop_mock_avaloq --portfolio {DEMO_PORTFOLIO_ID}\n"
            f"  python manage.py ingest_avaloq --custodian {DEMO_CUSTODIAN_ID}"
        ))

    def _log(self, kind: str, label: str, created: bool):
        verb = "created" if created else "exists"
        style = self.style.SUCCESS if created else self.style.NOTICE
        self.stdout.write(style(f"  [{verb}] {kind}: {label}"))


def _months_ago(d: date, n: int) -> date:
    """Last day of the month n calendar months before d's month."""
    y, m = d.year, d.month - n
    while m <= 0:
        m += 12
        y -= 1
    next_first = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return next_first - timedelta(days=1)
