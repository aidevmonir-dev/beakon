"""Extend Kaushik Ghosh's books with a full end-to-end story for the demo.

Layers on top of ``seed_kaushik_demo.py`` (run that first). Adds:

  * 4 additional accounts (Investment Income, Realized Gains, Brokerage Fees,
    Personal Expenses) + 1 extra investment (iShares Core MSCI ETF)
  * 8 journal entries spanning every approval state the blueprint requires:
      posted · approved · pending_approval · draft · rejected
  * 1 linked bank account (UBS Swiss Personal) + 3 imported CSV transactions

Run (Windows venv):
    venv\\Scripts\\python.exe scripts\\seed_kaushik_lifecycle.py

Idempotent — re-running updates what changed and skips JEs already created.
"""
import hashlib
import io
import os
import sys
from datetime import date, datetime
from decimal import Decimal

# Windows console defaults to cp1252 which chokes on European characters.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
else:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import django

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "digits_clone.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.db import transaction  # noqa: E402
from django.utils import timezone  # noqa: E402

from beakon_banking.models import BankAccount, BankTransaction, FeedImport  # noqa: E402
from beakon_banking import constants as bc  # noqa: E402
from beakon_core import constants as c  # noqa: E402
from beakon_core.models import Account, Entity, JournalEntry  # noqa: E402
from beakon_core.services import JournalService  # noqa: E402
from organizations.models import Organization  # noqa: E402


User = get_user_model()
MARKER = "KAUSHIK-LIFECYCLE"


def txn_external_id(bank_account_id, tx_date, amount, description):
    """Mirrors the importer's dedup hash so re-runs stay idempotent."""
    norm = description.strip().lower()
    payload = f"{bank_account_id}|{tx_date.isoformat()}|{amount}|{norm}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


@transaction.atomic
def main():
    org = Organization.objects.first()
    if not org:
        print("No organization found. Run seed_kaushik_demo.py first.")
        sys.exit(1)

    try:
        kaushik = Entity.objects.get(organization=org, code="KGHOSH")
    except Entity.DoesNotExist:
        print("Kaushik Ghosh entity not found. Run seed_kaushik_demo.py first.")
        sys.exit(1)

    maker = User.objects.get(email="demo-maker@beakon.local")
    approver = User.objects.get(email="demo-approver@beakon.local")

    print(f"Using organization: {org.name}")
    print(f"Using entity: {kaushik.code} · {kaushik.name}  (id={kaushik.id})")

    # ── Additional accounts ──────────────────────────────────────────────
    NEW_ACCOUNTS = [
        ("1804", "iShares Core MSCI World ETF",   c.ACCOUNT_TYPE_ASSET,   "investment", "debit"),
        ("4200", "Investment Income",              c.ACCOUNT_TYPE_REVENUE, "investment_income", "credit"),
        ("4201", "Realized Gains on Investments",  c.ACCOUNT_TYPE_REVENUE, "investment_income", "credit"),
        ("6100", "Personal Expenses",              c.ACCOUNT_TYPE_EXPENSE, "operating_expense", "debit"),
        ("7100", "Brokerage & Advisor Fees",       c.ACCOUNT_TYPE_EXPENSE, "professional_fees", "debit"),
    ]
    accounts = {}
    for code in ["1010", "1801", "1802", "1803", "3000"]:
        accounts[code] = Account.objects.get(entity=kaushik, code=code)
    for code, name, atype, subtype, normal in NEW_ACCOUNTS:
        acc, created = Account.objects.update_or_create(
            organization=org, entity=kaushik, code=code,
            defaults={
                "name": name,
                "account_type": atype,
                "account_subtype": subtype,
                "normal_balance": normal,
                "currency": "EUR",
                "is_active": True,
            },
        )
        accounts[code] = acc
        print(f"  Account {code} · {name}  ({'created' if created else 'updated'})")

    # ── Journal-entry lifecycle ──────────────────────────────────────────
    # Each spec: (date, memo, lines, target_status, ref_suffix)
    JE_SPECS = [
        # Normal operations — posted.
        (date(2026, 4, 5), "Consulting fee deposited into personal account",
            [("1010", "debit", "15000"), ("3000", "credit", "15000")],
            "posted", "CONSULT"),

        (date(2026, 4, 8), "Purchase of additional Nestle SA shares",
            [("1801", "debit", "10000"), ("1010", "credit", "10000")],
            "posted", "BUY-NESTLE"),

        (date(2026, 4, 12), "Nestle SA quarterly dividend",
            [("1010", "debit", "500"), ("4200", "credit", "500")],
            "posted", "DIV-NESTLE"),

        (date(2026, 4, 15), "Partial sale of Swiss Confederation bond — realized gain",
            [("1010", "debit", "12000"),
             ("1803", "credit", "10000"),
             ("4201", "credit", "2000")],
            "posted", "SELL-BOND"),

        (date(2026, 4, 18), "Q2 investment advisor fee",
            [("7100", "debit", "250"), ("1010", "credit", "250")],
            "posted", "FEE-ADVISOR"),

        # Rejected — approver caught a mis-booked expense.
        (date(2026, 4, 22), "Lunch at Kronenhalle (personal, booked in error)",
            [("6100", "debit", "180"), ("1010", "credit", "180")],
            "rejected", "REJ-LUNCH"),

        # Approved, not yet posted.
        (date(2026, 4, 25), "Additional Apple Inc share purchase",
            [("1802", "debit", "8000"), ("1010", "credit", "8000")],
            "approved", "BUY-APPLE"),

        # Pending approval — sitting in the Review Queue.
        (date(2026, 4, 28), "Monthly brokerage platform fee",
            [("7100", "debit", "75"), ("1010", "credit", "75")],
            "pending_approval", "FEE-BROKER"),

        # Draft — still being prepared by the maker.
        (date(2026, 4, 29), "Planned purchase of iShares MSCI World ETF",
            [("1804", "debit", "5000"), ("1010", "credit", "5000")],
            "draft", "BUY-ETF"),
    ]

    created_count = 0
    for je_date, memo, line_specs, target, ref_suffix in JE_SPECS:
        ref = f"{MARKER}-{ref_suffix}"
        if JournalEntry.objects.filter(
            organization=org, entity=kaushik, source_ref=ref,
        ).exists():
            print(f"  JE [{target:18s}] {memo[:48]:48s}  exists")
            continue

        lines = []
        for code, side, amount in line_specs:
            lines.append({
                "account_id": accounts[code].id,
                side: Decimal(amount),
            })

        je = JournalService.create_draft(
            organization=org, entity=kaushik,
            date=je_date, memo=memo,
            currency="EUR",
            lines=lines, user=maker,
            source_type=c.SOURCE_MANUAL,
            source_ref=ref,
        )

        # Drive to requested terminal state.
        if target == "draft":
            pass
        else:
            JournalService.submit_for_approval(je, user=maker)
            if target == "pending_approval":
                pass
            elif target == "rejected":
                JournalService.reject(je, user=approver,
                                      reason="Personal expense — should not run through the investment ledger.")
            else:
                JournalService.approve(je, user=approver)
                if target != "approved":
                    JournalService.post(je, user=approver)

        print(f"  JE [{target:18s}] {memo[:48]:48s}  created (#{je.id})")
        created_count += 1

    # ── Bank feed — 1 account, 3 imported transactions ───────────────────
    bank_account, bank_created = BankAccount.objects.update_or_create(
        organization=org, entity=kaushik, account=accounts["1010"],
        defaults={
            "name": "UBS Swiss Personal Account",
            "bank_name": "UBS",
            "account_number_last4": "4812",
            "currency": "EUR",
            "is_active": True,
            "opening_balance": Decimal("0"),
            "created_by": maker,
        },
    )
    print(f"  Bank: UBS Swiss Personal Account  ({'created' if bank_created else 'updated'})  id={bank_account.id}")

    feed_import, _ = FeedImport.objects.update_or_create(
        bank_account=bank_account, file_name="kaushik_ubs_apr2026.csv",
        defaults={
            "status": bc.FEED_COMPLETED,
            "imported_by": maker,
            "started_at": timezone.now(),
            "completed_at": timezone.now(),
            "total_rows": 3,
            "imported_rows": 3,
        },
    )

    BANK_TXNS = [
        # (date, description, amount, status)
        (date(2026, 4, 30), "APPLE INC DIVIDEND USD→EUR FX",    Decimal("320.00"), bc.TXN_NEW),
        (date(2026, 4, 30), "SWISSQUOTE PLATFORM FEE",           Decimal("-18.50"), bc.TXN_NEW),
        (date(2026, 4, 30), "COUPON CH CONFED BOND 10Y",         Decimal("800.00"), bc.TXN_NEW),
    ]
    for tx_date, desc, amt, status in BANK_TXNS:
        ext_id = txn_external_id(bank_account.id, tx_date, amt, desc)
        BankTransaction.objects.update_or_create(
            bank_account=bank_account, external_id=ext_id,
            defaults={
                "feed_import": feed_import,
                "date": tx_date,
                "description": desc,
                "original_description": desc,
                "amount": amt,
                "currency": "EUR",
                "status": status,
            },
        )
        print(f"  Bank txn {tx_date}  {amt:>10.2f} EUR  {desc[:36]:36s}  [{status}]")

    print(f"\nDone. {created_count} new JE(s) posted through the lifecycle.")
    print(f"Navigate to /dashboard/entities/{kaushik.id}  -> Investments tab, then")
    print("walk the sidebar: Journal Entries → Review Queue → Financials → Bank Feed → Audit Log.")


if __name__ == "__main__":
    main()
