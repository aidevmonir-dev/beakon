"""Smoke test for the Beakon reporting engine.

Seeds a realistic two-entity scenario (USD HoldCo + GBP OpCo), posts
transactions across them, then verifies:

- Trial balance (single-entity, USD)
- Trial balance (consolidated, USD)
- P&L (single-entity; covers all four bucket types)
- Balance Sheet (single-entity; Assets = Liab + Equity)
- Journal listing (filters work)
- Account ledger drill-down (opening/running/closing)
- Entry detail (includes lines + approval history)

Rolls back at the end.
"""
import os
import sys
from datetime import date
from decimal import Decimal

import django

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "digits_clone.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.db import transaction  # noqa: E402

from beakon_core import constants as bc  # noqa: E402
from beakon_core.models import (  # noqa: E402
    Account, Currency, Entity, FXRate, Period,
)
from beakon_core.services import JournalService, ReportsService  # noqa: E402
from organizations.models import Organization  # noqa: E402


User = get_user_model()
TODAY = date(2026, 4, 17)


def seed(org):
    for code, name, sym in [("USD", "US Dollar", "$"), ("GBP", "Pound Sterling", "£")]:
        Currency.objects.update_or_create(code=code, defaults={"name": name, "symbol": sym})

    # Use isolated entity codes so we don't collide with seeded demo data
    # (which uses HOLDCO / OPCO-UK).
    holdco, _ = Entity.objects.update_or_create(
        organization=org, code="RPT-HOLDCO",
        defaults={"name": "Reports-test HoldCo", "entity_type": bc.ENTITY_COMPANY,
                   "functional_currency": "USD", "country": "US"},
    )
    opco, _ = Entity.objects.update_or_create(
        organization=org, code="RPT-OPCO-UK",
        defaults={"name": "Reports-test OpCo UK", "entity_type": bc.ENTITY_COMPANY,
                   "functional_currency": "GBP", "country": "GB", "parent": holdco},
    )

    FXRate.objects.update_or_create(
        from_currency="GBP", to_currency="USD", as_of=date(2026, 4, 1),
        defaults={"rate": Decimal("1.2500"), "source": "smoketest"},
    )

    accounts = {}
    for (entity, code, name, atype, subtype) in [
        (holdco, "1010", "HoldCo Bank", bc.ACCOUNT_TYPE_ASSET, "bank"),
        (holdco, "4000", "HoldCo Revenue", bc.ACCOUNT_TYPE_REVENUE, "operating_revenue"),
        (holdco, "5000", "HoldCo COGS", bc.ACCOUNT_TYPE_EXPENSE, "cogs"),
        (holdco, "6000", "HoldCo Opex", bc.ACCOUNT_TYPE_EXPENSE, "operating_expense"),
        (holdco, "3000", "HoldCo Capital", bc.ACCOUNT_TYPE_EQUITY, "capital"),
        (opco, "1010", "OpCo Bank", bc.ACCOUNT_TYPE_ASSET, "bank"),
        (opco, "4000", "OpCo Revenue", bc.ACCOUNT_TYPE_REVENUE, "operating_revenue"),
        (opco, "6000", "OpCo Opex", bc.ACCOUNT_TYPE_EXPENSE, "operating_expense"),
        (opco, "3000", "OpCo Capital", bc.ACCOUNT_TYPE_EQUITY, "capital"),
    ]:
        obj, _ = Account.objects.update_or_create(
            organization=org, entity=entity, code=code,
            defaults={"name": name, "account_type": atype, "account_subtype": subtype},
        )
        accounts[(entity.code, code)] = obj

    for entity in (holdco, opco):
        Period.objects.update_or_create(
            entity=entity, start_date=date(2026, 4, 1), end_date=date(2026, 4, 30),
            defaults={"name": "April 2026", "period_type": bc.PERIOD_MONTH,
                       "status": bc.PERIOD_OPEN},
        )

    return {"holdco": holdco, "opco": opco, "accounts": accounts}


def full_cycle(entry, *, creator, approver):
    """Submit, approve, post a JE."""
    JournalService.submit_for_approval(entry, user=creator)
    JournalService.approve(entry, user=approver)
    JournalService.post(entry, user=approver)


def main():
    org = Organization.objects.first()
    if not org:
        print("FAIL: no Organization")
        sys.exit(1)

    alice, _ = User.objects.get_or_create(
        email="alice@beakon-reports.local",
        defaults={"first_name": "Alice"},
    )
    bob, _ = User.objects.get_or_create(
        email="bob@beakon-reports.local",
        defaults={"first_name": "Bob"},
    )

    with transaction.atomic():
        sid = transaction.savepoint()
        w = seed(org)
        holdco, opco = w["holdco"], w["opco"]
        A = w["accounts"]

        # ── Scenario for HoldCo (USD) ────────────────────────────────
        # Opening equity: DR Bank 100,000 / CR Capital 100,000
        je_open = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 1),
            memo="Initial capital",
            lines=[
                {"account_id": A[("RPT-HOLDCO","1010")].id, "debit": Decimal("100000")},
                {"account_id": A[("RPT-HOLDCO","3000")].id, "credit": Decimal("100000")},
            ], user=alice,
            source_type=bc.SOURCE_OPENING_BALANCE,
        )
        full_cycle(je_open, creator=alice, approver=bob)

        # Revenue: DR Bank 30,000 / CR Revenue 30,000
        je_rev = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 5),
            memo="Services invoiced + received",
            lines=[
                {"account_id": A[("RPT-HOLDCO","1010")].id, "debit": Decimal("30000")},
                {"account_id": A[("RPT-HOLDCO","4000")].id, "credit": Decimal("30000")},
            ], user=alice,
        )
        full_cycle(je_rev, creator=alice, approver=bob)

        # COGS: DR COGS 8,000 / CR Bank 8,000
        je_cogs = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 10),
            memo="Materials bought",
            lines=[
                {"account_id": A[("RPT-HOLDCO","5000")].id, "debit": Decimal("8000")},
                {"account_id": A[("RPT-HOLDCO","1010")].id, "credit": Decimal("8000")},
            ], user=alice,
        )
        full_cycle(je_cogs, creator=alice, approver=bob)

        # Opex: DR Opex 5,000 / CR Bank 5,000
        je_opex = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 15),
            memo="Rent + utilities",
            lines=[
                {"account_id": A[("RPT-HOLDCO","6000")].id, "debit": Decimal("5000")},
                {"account_id": A[("RPT-HOLDCO","1010")].id, "credit": Decimal("5000")},
            ], user=alice,
        )
        full_cycle(je_opex, creator=alice, approver=bob)

        # ── Scenario for OpCo (GBP) ─────────────────────────────────
        # Capital in GBP
        je_o1 = JournalService.create_draft(
            organization=org, entity=opco, date=date(2026, 4, 2),
            memo="Capital into OpCo",
            currency="GBP",
            lines=[
                {"account_id": A[("RPT-OPCO-UK","1010")].id, "debit": Decimal("40000"),
                 "currency": "GBP", "exchange_rate": Decimal("1")},  # functional = GBP
                {"account_id": A[("RPT-OPCO-UK","3000")].id, "credit": Decimal("40000"),
                 "currency": "GBP", "exchange_rate": Decimal("1")},
            ], user=alice,
        )
        full_cycle(je_o1, creator=alice, approver=bob)

        # OpCo revenue 10,000 GBP
        je_o2 = JournalService.create_draft(
            organization=org, entity=opco, date=date(2026, 4, 8),
            memo="OpCo sales",
            currency="GBP",
            lines=[
                {"account_id": A[("RPT-OPCO-UK","1010")].id, "debit": Decimal("10000"),
                 "currency": "GBP", "exchange_rate": Decimal("1")},
                {"account_id": A[("RPT-OPCO-UK","4000")].id, "credit": Decimal("10000"),
                 "currency": "GBP", "exchange_rate": Decimal("1")},
            ], user=alice,
        )
        full_cycle(je_o2, creator=alice, approver=bob)

        # OpCo opex 3,000 GBP
        je_o3 = JournalService.create_draft(
            organization=org, entity=opco, date=date(2026, 4, 20),
            memo="OpCo expenses",
            currency="GBP",
            lines=[
                {"account_id": A[("RPT-OPCO-UK","6000")].id, "debit": Decimal("3000"),
                 "currency": "GBP", "exchange_rate": Decimal("1")},
                {"account_id": A[("RPT-OPCO-UK","1010")].id, "credit": Decimal("3000"),
                 "currency": "GBP", "exchange_rate": Decimal("1")},
            ], user=alice,
        )
        full_cycle(je_o3, creator=alice, approver=bob)

        # ── TB: HoldCo only ─────────────────────────────────────────
        print("-- TB: HoldCo only (USD)")
        tb = ReportsService.trial_balance(entity=holdco, as_of=date(2026, 4, 30))
        print(f"  balanced={tb['totals']['is_balanced']} "
              f"DR={tb['totals']['total_debits']} CR={tb['totals']['total_credits']}")
        for row in tb["accounts"]:
            print(f"    {row['code']} {row['name']:<20} DR={row['debit']:>12} CR={row['credit']:>12}")
        assert tb["totals"]["is_balanced"], "HoldCo TB must balance"
        assert Decimal(tb["totals"]["total_debits"]) == Decimal("143000.00")

        # ── TB: Consolidated to USD ─────────────────────────────────
        # Org-wide consolidation includes any pre-existing entities (e.g. the
        # seeded demo data). We assert only that the consolidated TB balances
        # and that our RPT- entities' contribution is picked up — not the
        # absolute total, which depends on what else is in the org.
        print("-- TB: Consolidated (USD, translating GBP lines at 1.25)")
        tbc = ReportsService.trial_balance(organization=org, as_of=date(2026, 4, 30),
                                            reporting_currency="USD")
        print(f"  balanced={tbc['totals']['is_balanced']} "
              f"DR={tbc['totals']['total_debits']} CR={tbc['totals']['total_credits']}")
        assert tbc["totals"]["is_balanced"], "Consolidated TB must balance"
        # Our RPT-OPCO-UK's GBP 40k+10k+3k = 53k should translate to 66,250 USD in consolidation.
        rpt_contribution = Decimal("143000.00") + Decimal("53000.00") * Decimal("1.25")
        assert Decimal(tbc["totals"]["total_debits"]) >= rpt_contribution.quantize(Decimal("0.01")), (
            f"consolidated total < our RPT- contribution ({rpt_contribution}); got {tbc['totals']['total_debits']}"
        )

        # ── P&L: HoldCo ────────────────────────────────────────────
        print("-- P&L: HoldCo (April 2026)")
        pnl = ReportsService.profit_loss(
            entity=holdco, date_from=date(2026, 4, 1), date_to=date(2026, 4, 30),
        )
        print(f"  revenue={pnl['revenue']['total']} cogs={pnl['cogs']['total']} "
              f"opex={pnl['operating_expenses']['total']} net={pnl['net_income']}")
        assert Decimal(pnl["revenue"]["total"]) == Decimal("30000.00")
        assert Decimal(pnl["cogs"]["total"]) == Decimal("8000.00")
        assert Decimal(pnl["operating_expenses"]["total"]) == Decimal("5000.00")
        assert Decimal(pnl["gross_profit"]) == Decimal("22000.00")  # 30k - 8k
        assert Decimal(pnl["net_income"]) == Decimal("17000.00")  # 22k - 5k

        # ── BS: HoldCo ─────────────────────────────────────────────
        print("-- BS: HoldCo (as of 2026-04-30)")
        bs = ReportsService.balance_sheet(entity=holdco, as_of=date(2026, 4, 30))
        print(f"  assets={bs['total_assets']} liab+eq={bs['total_liabilities_equity']} "
              f"balanced={bs['is_balanced']} ytd_ni={bs['ytd_net_income']}")
        assert bs["is_balanced"], "HoldCo BS must balance"
        # Bank = 100k + 30k - 8k - 5k = 117k ; Capital 100k + YTD NI 17k = 117k
        assert Decimal(bs["total_assets"]) == Decimal("117000.00")
        assert Decimal(bs["total_liabilities_equity"]) == Decimal("117000.00")
        assert Decimal(bs["ytd_net_income"]) == Decimal("17000.00")

        # ── Journal listing ────────────────────────────────────────
        print("-- Journal listing (posted only, HoldCo)")
        jl = ReportsService.journal_listing(entity=holdco, status=bc.JE_POSTED)
        print(f"  count={jl['count']}")
        assert jl["count"] == 4
        entry_numbers = [e["entry_number"] for e in jl["entries"]]
        assert je_open.entry_number in entry_numbers

        # ── Account ledger drill-down ──────────────────────────────
        print("-- Account ledger: HoldCo Bank")
        led = ReportsService.account_ledger(
            account=A[("RPT-HOLDCO","1010")],
            date_from=date(2026, 4, 1), date_to=date(2026, 4, 30),
        )
        print(f"  opening={led['opening_balance']} closing={led['closing_balance']} "
              f"entries={len(led['entries'])}")
        assert Decimal(led["closing_balance"]) == Decimal("117000.00")
        # Bank sees 4 lines: opening DR 100k, revenue DR 30k, COGS CR 8k, opex CR 5k.
        assert len(led["entries"]) == 4, f"expected 4 bank lines, got {len(led['entries'])}"

        # Running balance on the last line should equal closing.
        last = led["entries"][-1]
        assert Decimal(last["running_balance"]) == Decimal(led["closing_balance"])
        print(f"  last-line running balance matches closing ({last['running_balance']})")

        # ── Entry detail drill-down ────────────────────────────────
        print("-- Entry detail: je_rev")
        je_rev.refresh_from_db()
        detail = ReportsService.entry_detail(entry=je_rev)
        print(f"  {detail['entry_number']} status={detail['status']} "
              f"lines={len(detail['lines'])} history={len(detail['approval_history'])}")
        assert detail["is_balanced_functional"] is True
        assert len(detail["lines"]) == 2
        # History: draft-create, submitted, approved, posted
        assert len(detail["approval_history"]) >= 3

        print("OK: reports smoke test passed -- rolling back.")
        transaction.savepoint_rollback(sid)


if __name__ == "__main__":
    main()
