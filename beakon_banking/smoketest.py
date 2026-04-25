"""Beakon banking feeder smoke test — Objective 3 end-to-end.

Flow:
  1. Seed entity + COA (bank + expense + revenue accounts).
  2. Create a BankAccount linked to entity + bank COA.
  3. Import a small CSV (3 rows) ->BankTransactions land in ``new``.
  4. Re-import same CSV ->all 3 marked as duplicates.
  5. Categorize row 1 (a cafe expense) ->draft JE created, txn flips to ``proposed``.
  6. Submit + approve (different user) + post ->signal flips txn to ``matched``.
  7. Ignore row 2.
  8. Undo row 3's categorization (returns JE to draft, then deletes).
  9. Trial balance reflects the one posted JE.

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

from beakon_banking import constants as bc  # noqa: E402
from beakon_banking.models import BankAccount, BankTransaction  # noqa: E402
from beakon_banking.services import Categorizer, CSVImporter  # noqa: E402
from beakon_core import constants as core_c  # noqa: E402
from beakon_core.models import Account, Currency, Entity, Period  # noqa: E402
from beakon_core.services import JournalService, ReportsService  # noqa: E402
from organizations.models import Organization  # noqa: E402


User = get_user_model()


CSV_SAMPLE = (
    b"date,description,amount,balance\n"
    b"2026-04-03,BLUE BOTTLE COFFEE SF CA,-6.25,994.75\n"
    b"2026-04-05,STRIPE PAYOUT ACH,2500.00,3494.75\n"
    b"2026-04-10,OFFICE DEPOT,-142.17,3352.58\n"
)


def seed(org):
    Currency.objects.update_or_create(code="USD", defaults={"name": "US Dollar"})
    entity, _ = Entity.objects.update_or_create(
        organization=org, code="BNK-SMOKE",
        defaults={"name": "Banking Smoke Entity",
                   "entity_type": core_c.ENTITY_COMPANY,
                   "functional_currency": "USD", "country": "US"},
    )
    bank_coa, _ = Account.objects.update_or_create(
        organization=org, entity=entity, code="1010",
        defaults={"name": "Checking", "account_type": core_c.ACCOUNT_TYPE_ASSET,
                   "account_subtype": "bank"},
    )
    expense, _ = Account.objects.update_or_create(
        organization=org, entity=entity, code="6100",
        defaults={"name": "Office Supplies", "account_type": core_c.ACCOUNT_TYPE_EXPENSE,
                   "account_subtype": "operating_expense"},
    )
    revenue, _ = Account.objects.update_or_create(
        organization=org, entity=entity, code="4000",
        defaults={"name": "Service Revenue", "account_type": core_c.ACCOUNT_TYPE_REVENUE,
                   "account_subtype": "operating_revenue"},
    )
    Period.objects.update_or_create(
        entity=entity, start_date=date(2026, 4, 1), end_date=date(2026, 4, 30),
        defaults={"name": "April 2026", "period_type": core_c.PERIOD_MONTH,
                   "status": core_c.PERIOD_OPEN},
    )
    return entity, bank_coa, expense, revenue


def main():
    org = Organization.objects.first()
    if not org:
        print("FAIL: no Organization"); sys.exit(1)

    alice, _ = User.objects.get_or_create(
        email="alice-bnk@beakon-smoke.local", defaults={"first_name": "Alice"},
    )
    bob, _ = User.objects.get_or_create(
        email="bob-bnk@beakon-smoke.local", defaults={"first_name": "Bob"},
    )

    with transaction.atomic():
        sid = transaction.savepoint()
        entity, bank_coa, expense_acc, revenue_acc = seed(org)

        # ── 1. Create BankAccount ────────────────────────────────────
        print("-- 1. create BankAccount")
        ba = BankAccount.objects.create(
            organization=org, entity=entity, account=bank_coa,
            name="Operating Checking", bank_name="Mercury",
            account_number_last4="4567", currency="USD",
            opening_balance=Decimal("1000"),
        )
        print(f"  {ba.name} ->entity {entity.code}, COA {bank_coa.code}")

        # ── 2. Import CSV ────────────────────────────────────────────
        print("-- 2. import CSV (3 rows)")
        importer = CSVImporter(
            bank_account=ba,
            column_mapping={"date": 0, "description": 1, "amount": 2, "balance": 3},
            date_format="%Y-%m-%d", has_header=True,
        )
        feed = importer.run(file_bytes=CSV_SAMPLE, file_name="demo.csv", user=alice)
        print(f"  feed: total={feed.total_rows} imported={feed.imported_rows} "
              f"dup={feed.duplicate_rows} errors={feed.error_rows} status={feed.status}")
        assert feed.status == bc.FEED_COMPLETED
        assert feed.imported_rows == 3

        # ── 3. Re-import same CSV ->dedup ────────────────────────────
        print("-- 3. re-import same file")
        feed2 = importer.run(file_bytes=CSV_SAMPLE, file_name="demo.csv", user=alice)
        print(f"  feed2: imported={feed2.imported_rows} dup={feed2.duplicate_rows}")
        assert feed2.duplicate_rows == 3
        assert feed2.imported_rows == 0

        # Grab the real txns (not the duplicate re-imports).
        txns = list(
            BankTransaction.objects.filter(bank_account=ba, is_duplicate=False)
            .order_by("date")
        )
        assert len(txns) == 3
        cafe, deposit, office = txns

        # ── 4. Categorize the cafe purchase ->draft JE ───────────────
        print("-- 4. categorize cafe txn")
        t, je = Categorizer.categorize(
            txn=cafe, offset_account=expense_acc, user=alice,
            memo="Coffee during team sync",
        )
        t.refresh_from_db()
        je.refresh_from_db()
        print(f"  txn.status={t.status}  je={je.entry_number} je.status={je.status}")
        assert t.status == bc.TXN_PROPOSED
        assert je.status == core_c.JE_DRAFT
        assert je.lines.count() == 2

        # ── 5. Move JE through approval pipeline ─────────────────────
        print("-- 5. submit ->approve ->post")
        JournalService.submit_for_approval(je, user=alice)
        JournalService.approve(je, user=bob)
        JournalService.post(je, user=bob)
        t.refresh_from_db()
        print(f"  txn.status={t.status} (signal should have flipped to 'matched')")
        assert t.status == bc.TXN_MATCHED

        # ── 6. Ignore the Stripe deposit row ─────────────────────────
        print("-- 6. ignore deposit")
        Categorizer.ignore(txn=deposit, user=alice, reason="Internal test deposit")
        deposit.refresh_from_db()
        print(f"  deposit.status={deposit.status}")
        assert deposit.status == bc.TXN_IGNORED

        # ── 7. Categorize + undo the office purchase ─────────────────
        print("-- 7. categorize office purchase then undo")
        _, je_office = Categorizer.categorize(
            txn=office, offset_account=expense_acc, user=alice,
        )
        office.refresh_from_db()
        assert office.status == bc.TXN_PROPOSED
        assert office.proposed_journal_entry_id == je_office.id
        Categorizer.undo(txn=office, user=alice)
        office.refresh_from_db()
        print(f"  after undo: office.status={office.status}  proposed_je_id={office.proposed_journal_entry_id}")
        assert office.status == bc.TXN_NEW
        assert office.proposed_journal_entry_id is None

        # ── 8. Undo-after-matched is blocked ─────────────────────────
        print("-- 8. undo on matched txn blocked")
        from beakon_banking.exceptions import AlreadyMatched
        try:
            Categorizer.undo(txn=cafe, user=alice)
            print("  FAIL: undo allowed on matched txn"); sys.exit(1)
        except AlreadyMatched as e:
            print(f"  OK blocked: {e.message}")

        # ── 9. Trial balance reflects the posted JE ──────────────────
        print("-- 9. trial balance after posting")
        tb = ReportsService.trial_balance(entity=entity, as_of=date(2026, 4, 30))
        bank_row = next((r for r in tb["accounts"] if r["code"] == "1010"), None)
        exp_row = next((r for r in tb["accounts"] if r["code"] == "6100"), None)
        print(f"  bank 1010 net={bank_row and bank_row['net']} / "
              f"expense 6100 net={exp_row and exp_row['net']}")
        assert tb["totals"]["is_balanced"]
        assert bank_row and Decimal(bank_row["net"]) == Decimal("-6.25")  # cash down by 6.25
        assert exp_row and Decimal(exp_row["net"]) == Decimal("6.25")     # expense up by 6.25

        print("OK: banking feeder smoke test passed -- rolling back.")
        transaction.savepoint_rollback(sid)


if __name__ == "__main__":
    main()
