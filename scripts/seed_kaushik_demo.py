"""Create Kaushik Ghosh (Person entity, Swiss, EUR) with a few investment
holdings posted to the ledger so the Investments tab shows real values.

Run (Windows venv):
    venv\\Scripts\\python.exe scripts\\seed_kaushik_demo.py

Idempotent — re-running updates records and skips the opening JE if posted.
"""
import io
import os
import sys
from datetime import date
from decimal import Decimal

# Windows console defaults to cp1252 which chokes on common European chars.
# Force UTF-8 before any print() hits the wire.
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

from beakon_core import constants as c  # noqa: E402
from beakon_core.models import Account, Currency, Entity, JournalEntry, Period  # noqa: E402
from beakon_core.services import JournalService  # noqa: E402
from organizations.models import Organization, OrganizationMember, Role  # noqa: E402


User = get_user_model()
MARKER = "KAUSHIK-DEMO"


@transaction.atomic
def main():
    # 1. Organization — reuse the first one; create a Swiss default if none.
    org = Organization.objects.first()
    if not org:
        org = Organization.objects.create(
            name="Ghosh Family Office",
            currency="EUR",
            country="CH",
            timezone="Europe/Zurich",
        )
        print(f"Created organization: {org.name}  (id={org.id})")
    else:
        print(f"Using existing organization: {org.name}  (id={org.id})")

    # 2. Make sure EUR is in the currency catalog.
    Currency.objects.update_or_create(
        code="EUR", defaults={"name": "Euro", "symbol": "€"},
    )

    # 3. Maker + approver users for the journal-entry approval flow.
    maker, _ = User.objects.get_or_create(
        email="demo-maker@beakon.local",
        defaults={"first_name": "Demo", "last_name": "Maker", "is_active": True},
    )
    approver, _ = User.objects.get_or_create(
        email="demo-approver@beakon.local",
        defaults={"first_name": "Demo", "last_name": "Approver", "is_active": True},
    )
    role, _ = Role.objects.get_or_create(
        organization=org, name="Demo Role",
        defaults={"permissions": {
            "view_ledger": True, "create_journal": True, "approve_journal": True,
            "post_journal": True, "close_period": True, "manage_users": False,
        }},
    )
    for u in (maker, approver):
        OrganizationMember.objects.update_or_create(
            organization=org, user=u,
            defaults={"role": role, "is_active": True},
        )

    # 4. Kaushik — Person (individual) entity, Swiss, EUR-functional.
    kaushik, created = Entity.objects.update_or_create(
        organization=org, code="KGHOSH",
        defaults={
            "name": "Kaushik Ghosh",
            "legal_name": "Kaushik Ghosh",
            "entity_type": c.ENTITY_INDIVIDUAL,
            "functional_currency": "EUR",
            "reporting_currency": "EUR",
            "country": "CH",
            "fiscal_year_start_month": 1,
            "is_active": True,
        },
    )
    print(f"Entity: {kaushik.code} · {kaushik.name}  ({'created' if created else 'updated'})  id={kaushik.id}")

    # 5. Open April 2026 period so the JE can post.
    Period.objects.update_or_create(
        entity=kaushik, start_date=date(2026, 4, 1), end_date=date(2026, 4, 30),
        defaults={
            "name": "April 2026",
            "period_type": c.PERIOD_MONTH,
            "status": c.PERIOD_OPEN,
        },
    )

    # 6. Accounts on Kaushik — 1 cash, 3 investments, 1 capital.
    ACCOUNTS = [
        ("1010", "Personal Cash (Swiss)",          c.ACCOUNT_TYPE_ASSET,  "bank",       "debit"),
        ("1801", "Nestle SA",                       c.ACCOUNT_TYPE_ASSET,  "investment", "debit"),
        ("1802", "Apple Inc (AAPL)",                c.ACCOUNT_TYPE_ASSET,  "investment", "debit"),
        ("1803", "Swiss Confederation 10Y Bond",    c.ACCOUNT_TYPE_ASSET,  "investment", "debit"),
        ("3000", "Capital Contributions",           c.ACCOUNT_TYPE_EQUITY, "capital",    "credit"),
    ]
    accounts = {}
    for code, name, atype, subtype, normal in ACCOUNTS:
        acc, _ = Account.objects.update_or_create(
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
        print(f"  Account {code} · {name}")

    # 7. Opening-balance JE — posted. Skip if already seeded.
    if JournalEntry.objects.filter(
        organization=org, entity=kaushik, source_ref__startswith=MARKER,
    ).exists():
        print("Opening JE already exists; not re-posting.")
        print(f"\nDone. Navigate to /dashboard/entities/{kaushik.id}  -> Investments tab.")
        return

    je = JournalService.create_draft(
        organization=org, entity=kaushik,
        date=date(2026, 4, 1),
        memo="Opening capital — personal investment portfolio",
        currency="EUR",
        lines=[
            {"account_id": accounts["1010"].id, "debit": Decimal("40000")},
            {"account_id": accounts["1801"].id, "debit": Decimal("50000")},
            {"account_id": accounts["1802"].id, "debit": Decimal("30000")},
            {"account_id": accounts["1803"].id, "debit": Decimal("80000")},
            {"account_id": accounts["3000"].id, "credit": Decimal("200000")},
        ],
        user=maker,
        source_type=c.SOURCE_MANUAL,
        source_ref=f"{MARKER}-OPENING",
    )
    JournalService.submit_for_approval(je, user=maker)
    JournalService.approve(je, user=approver)
    JournalService.post(je, user=approver)
    print(f"Posted JE #{je.id} — total EUR 200,000 across 5 lines.")

    print(f"\nDone. Navigate to /dashboard/entities/{kaushik.id}  -> Investments tab.")


if __name__ == "__main__":
    main()
