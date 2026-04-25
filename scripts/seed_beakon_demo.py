"""Seed the Beakon kernel + banking feeder with realistic family-office demo data.

Run (committing to the real DB):
    venv\\Scripts\\python.exe scripts\\seed_beakon_demo.py

Idempotent — re-running adds what's missing and skips what exists.

What it creates:
  * 3 currencies (USD/GBP/EUR) + FX rates for April 2026
  * 2 users for the approval flow (maker + approver) — invented here so
    the demo doesn't depend on specific accounts existing
  * 4 entities: HOLDCO (USD top-of-house), OPCO-US (USD), OPCO-UK (GBP),
    TRUST (USD)
  * A realistic chart of accounts per entity (~12 accounts each)
  * An open April-2026 period per entity
  * Journal entries spanning every kernel state:
      draft · pending_approval · approved · rejected · posted · reversed
    Including an intercompany pair (HOLDCO lends to OPCO-UK)
  * One linked bank account on HOLDCO with 6 imported transactions:
      2 new, 1 proposed (draft JE pending), 3 posted/matched
"""
import os
import sys
from datetime import date
from decimal import Decimal

import django

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "digits_clone.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.db import transaction  # noqa: E402

from beakon_banking.models import BankAccount, BankTransaction  # noqa: E402
from beakon_banking.services import Categorizer, CSVImporter  # noqa: E402
from beakon_core import constants as c  # noqa: E402
from beakon_core.models import (  # noqa: E402
    Account, Currency, Entity, FXRate, IntercompanyGroup, Period,
)
from beakon_core.services import JournalService  # noqa: E402
from organizations.models import Organization, OrganizationMember, Role  # noqa: E402


User = get_user_model()


DEMO_MARKER = "DEMO-SEED"


# ─── Reference data ────────────────────────────────────────────────────────

def seed_reference():
    for code, name, sym in [("USD", "US Dollar", "$"),
                             ("GBP", "Pound Sterling", "£"),
                             ("EUR", "Euro", "€")]:
        Currency.objects.update_or_create(code=code, defaults={"name": name, "symbol": sym})

    rates = [
        ("GBP", "USD", Decimal("1.2500")),
        ("EUR", "USD", Decimal("1.0900")),
        ("USD", "GBP", Decimal("0.8000")),
        ("USD", "EUR", Decimal("0.9174")),
    ]
    for fr, to, rate in rates:
        for d in [date(2026, 4, 1), date(2026, 3, 1), date(2026, 2, 1)]:
            FXRate.objects.update_or_create(
                from_currency=fr, to_currency=to, as_of=d,
                defaults={"rate": rate, "source": DEMO_MARKER},
            )


# ─── Users ─────────────────────────────────────────────────────────────────

def seed_users(org):
    maker, _ = User.objects.get_or_create(
        email="demo-maker@beakon.local",
        defaults={"first_name": "Demo", "last_name": "Maker", "is_active": True},
    )
    maker.set_password("beakon-demo-pass!")
    maker.save()

    approver, _ = User.objects.get_or_create(
        email="demo-approver@beakon.local",
        defaults={"first_name": "Demo", "last_name": "Approver", "is_active": True},
    )
    approver.set_password("beakon-demo-pass!")
    approver.save()

    # Both need org membership so the kernel's IsOrganizationMember passes.
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
    return maker, approver


# ─── Entities + CoA + Periods ─────────────────────────────────────────────

ENTITY_SPECS = [
    # (code, name, legal, type, currency, country, parent_code)
    ("HOLDCO", "Smith Family Holdings", "Smith Family Holdings Ltd",
     c.ENTITY_COMPANY, "USD", "US", None),
    ("OPCO-US", "Smith Operating US", "Smith Operating Co LLC",
     c.ENTITY_COMPANY, "USD", "US", "HOLDCO"),
    ("OPCO-UK", "Smith Operating UK", "Smith UK Ltd",
     c.ENTITY_COMPANY, "GBP", "GB", "HOLDCO"),
    ("TRUST",  "Smith Family Trust 2020", "Smith Family Trust 2020",
     c.ENTITY_TRUST,   "USD", "US", None),
    ("JSMITH", "John Smith", "John R. Smith",
     c.ENTITY_INDIVIDUAL, "USD", "US", None),
]


# Base CoA applied to every entity. Code → (name, type, subtype)
BASE_COA = [
    ("1010", "Operating Bank Account", c.ACCOUNT_TYPE_ASSET, "bank"),
    ("1100", "Accounts Receivable", c.ACCOUNT_TYPE_ASSET, "accounts_receivable"),
    ("1500", "Due From Affiliates", c.ACCOUNT_TYPE_ASSET, "intercompany_receivable"),
    ("1800", "Investments", c.ACCOUNT_TYPE_ASSET, "investment"),
    ("2000", "Accounts Payable", c.ACCOUNT_TYPE_LIABILITY, "accounts_payable"),
    ("2500", "Due To Affiliates", c.ACCOUNT_TYPE_LIABILITY, "intercompany_payable"),
    ("3000", "Capital Contributions", c.ACCOUNT_TYPE_EQUITY, "capital"),
    ("3100", "Retained Earnings", c.ACCOUNT_TYPE_EQUITY, "retained_earnings"),
    ("4000", "Service Revenue", c.ACCOUNT_TYPE_REVENUE, "operating_revenue"),
    ("4200", "Investment Income", c.ACCOUNT_TYPE_REVENUE, "investment_income"),
    ("5000", "Cost of Services", c.ACCOUNT_TYPE_EXPENSE, "cogs"),
    ("6100", "Office Expenses", c.ACCOUNT_TYPE_EXPENSE, "operating_expense"),
    ("6200", "Rent", c.ACCOUNT_TYPE_EXPENSE, "operating_expense"),
    ("6600", "Professional Fees", c.ACCOUNT_TYPE_EXPENSE, "professional_fees"),
    ("7100", "Interest Expense", c.ACCOUNT_TYPE_EXPENSE, "other_expense"),
    ("8100", "FX Gain", c.ACCOUNT_TYPE_REVENUE, "fx_gain"),
    ("8200", "FX Loss", c.ACCOUNT_TYPE_EXPENSE, "fx_loss"),
]


def seed_entities_and_coa(org):
    # First pass — entities without parents.
    entities = {}
    for code, name, legal, etype, ccy, country, _parent in ENTITY_SPECS:
        ent, _ = Entity.objects.update_or_create(
            organization=org, code=code,
            defaults={
                "name": name, "legal_name": legal,
                "entity_type": etype, "functional_currency": ccy,
                "country": country, "is_active": True,
            },
        )
        entities[code] = ent

    # Second pass — link parents now that all entities exist.
    for code, _n, _l, _t, _c, _cy, parent_code in ENTITY_SPECS:
        if parent_code:
            e = entities[code]
            e.parent = entities[parent_code]
            e.save(update_fields=["parent"])

    # CoA per entity
    accounts = {}  # {(entity_code, acct_code): Account}
    for ent in entities.values():
        for code, name, atype, subtype in BASE_COA:
            acc, _ = Account.objects.update_or_create(
                organization=org, entity=ent, code=code,
                defaults={
                    "name": name, "account_type": atype,
                    "account_subtype": subtype, "is_active": True,
                },
            )
            accounts[(ent.code, code)] = acc

    return entities, accounts


def seed_periods(entities):
    periods = {}
    for ent in entities.values():
        p, _ = Period.objects.update_or_create(
            entity=ent, start_date=date(2026, 4, 1), end_date=date(2026, 4, 30),
            defaults={
                "name": "April 2026", "period_type": c.PERIOD_MONTH,
                "status": c.PERIOD_OPEN,
            },
        )
        # Also mark March closed to exercise the period-lock logic for reports.
        Period.objects.update_or_create(
            entity=ent, start_date=date(2026, 3, 1), end_date=date(2026, 3, 31),
            defaults={
                "name": "March 2026", "period_type": c.PERIOD_MONTH,
                "status": c.PERIOD_CLOSED,
            },
        )
        periods[ent.code] = p
    return periods


# ─── Journal entries ──────────────────────────────────────────────────────

def _already_seeded_jes(org) -> bool:
    from beakon_core.models import JournalEntry
    return JournalEntry.objects.filter(
        organization=org, source_ref__startswith=DEMO_MARKER,
    ).exists()


def seed_journal_entries(org, entities, accounts, maker, approver):
    if _already_seeded_jes(org):
        return 0

    A = accounts  # shorthand
    created = 0

    def mk(entity_code, entry_date, memo, lines, currency=None, *, target="posted",
           ic_group=None, counterparty=None, ref_suffix=""):
        """Create and fast-track a JE to the requested status."""
        nonlocal created
        ent = entities[entity_code]
        je = JournalService.create_draft(
            organization=org, entity=ent,
            date=entry_date, memo=memo,
            currency=currency or ent.functional_currency,
            lines=lines, user=maker,
            source_type=c.SOURCE_MANUAL,
            source_ref=f"{DEMO_MARKER}-{ref_suffix or str(created+1).zfill(3)}",
            intercompany_group=ic_group,
            counterparty_entity=counterparty,
        )
        if target == "draft":
            created += 1
            return je
        JournalService.submit_for_approval(je, user=maker)
        if target == "pending_approval":
            created += 1
            return je
        if target == "rejected":
            JournalService.reject(je, user=approver, reason="Demo — flagged for review")
            created += 1
            return je
        JournalService.approve(je, user=approver)
        if target == "approved":
            created += 1
            return je
        JournalService.post(je, user=approver)
        created += 1
        return je

    # ── HOLDCO opening capital (posted) ────────────────────────────────
    mk("HOLDCO", date(2026, 4, 1),
       "Initial capital contribution from founder",
       lines=[
           {"account_id": A[("HOLDCO", "1010")].id, "debit": Decimal("500000")},
           {"account_id": A[("HOLDCO", "3000")].id, "credit": Decimal("500000")},
       ])

    # ── HOLDCO consulting revenue (posted) ────────────────────────────
    mk("HOLDCO", date(2026, 4, 4),
       "Advisory fee · Widget Corp",
       lines=[
           {"account_id": A[("HOLDCO", "1010")].id, "debit": Decimal("45000")},
           {"account_id": A[("HOLDCO", "4000")].id, "credit": Decimal("45000")},
       ])

    # ── HOLDCO professional fees (posted) ─────────────────────────────
    mk("HOLDCO", date(2026, 4, 7),
       "Legal fees · Goodwin Procter",
       lines=[
           {"account_id": A[("HOLDCO", "6600")].id, "debit": Decimal("8500")},
           {"account_id": A[("HOLDCO", "1010")].id, "credit": Decimal("8500")},
       ])

    # ── Intercompany: HOLDCO lends £80,000 to OPCO-UK ─────────────────
    # Two paired JEs, one per entity, linked via IntercompanyGroup.
    ic = IntercompanyGroup.objects.create(
        organization=org,
        reference="HOLDCO→OPCO-UK April intercompany funding",
        description="Working-capital advance to OPCO-UK",
        created_by=maker,
    )
    # HOLDCO side: DR Due From OPCO-UK $100,000 / CR Bank $100,000
    # (100,000 USD = 80,000 GBP at 1.25)
    mk("HOLDCO", date(2026, 4, 9),
       "Funding advance to OPCO-UK",
       lines=[
           {"account_id": A[("HOLDCO", "1500")].id, "debit": Decimal("100000"),
            "counterparty_entity_id": entities["OPCO-UK"].id},
           {"account_id": A[("HOLDCO", "1010")].id, "credit": Decimal("100000")},
       ],
       ic_group=ic, counterparty=entities["OPCO-UK"], ref_suffix="IC-HOLD")
    # OPCO-UK side: DR Bank £80,000 / CR Due To HOLDCO £80,000
    mk("OPCO-UK", date(2026, 4, 9),
       "Funding received from HOLDCO",
       currency="GBP",
       lines=[
           {"account_id": A[("OPCO-UK", "1010")].id, "debit": Decimal("80000"),
            "currency": "GBP", "exchange_rate": Decimal("1")},
           {"account_id": A[("OPCO-UK", "2500")].id, "credit": Decimal("80000"),
            "currency": "GBP", "exchange_rate": Decimal("1"),
            "counterparty_entity_id": entities["HOLDCO"].id},
       ],
       ic_group=ic, counterparty=entities["HOLDCO"], ref_suffix="IC-OPUK")

    # ── OPCO-UK rent (posted) ─────────────────────────────────────────
    mk("OPCO-UK", date(2026, 4, 12),
       "London office rent · April",
       currency="GBP",
       lines=[
           {"account_id": A[("OPCO-UK", "6200")].id, "debit": Decimal("12000"),
            "currency": "GBP", "exchange_rate": Decimal("1")},
           {"account_id": A[("OPCO-UK", "1010")].id, "credit": Decimal("12000"),
            "currency": "GBP", "exchange_rate": Decimal("1")},
       ])

    # ── OPCO-US first client invoice (posted) ─────────────────────────
    mk("OPCO-US", date(2026, 4, 3),
       "First client invoice · Acme Corp",
       lines=[
           {"account_id": A[("OPCO-US", "1100")].id, "debit": Decimal("22500")},
           {"account_id": A[("OPCO-US", "4000")].id, "credit": Decimal("22500")},
       ])
    mk("OPCO-US", date(2026, 4, 10),
       "Payment received · Acme Corp",
       lines=[
           {"account_id": A[("OPCO-US", "1010")].id, "debit": Decimal("22500")},
           {"account_id": A[("OPCO-US", "1100")].id, "credit": Decimal("22500")},
       ])

    # ── TRUST investment income (posted) ──────────────────────────────
    mk("TRUST", date(2026, 4, 15),
       "Dividend from Acme bond fund",
       lines=[
           {"account_id": A[("TRUST", "1010")].id, "debit": Decimal("17500")},
           {"account_id": A[("TRUST", "4200")].id, "credit": Decimal("17500")},
       ])

    # ── A pending-approval JE (appears in Approval Inbox) ─────────────
    mk("HOLDCO", date(2026, 4, 14),
       "Q2 office supply order · Staples (needs review)",
       lines=[
           {"account_id": A[("HOLDCO", "6100")].id, "debit": Decimal("2340")},
           {"account_id": A[("HOLDCO", "1010")].id, "credit": Decimal("2340")},
       ],
       target="pending_approval")

    # ── Another pending ──────────────────────────────────────────────
    mk("OPCO-US", date(2026, 4, 15),
       "Software subscription · Linear (needs review)",
       lines=[
           {"account_id": A[("OPCO-US", "6100")].id, "debit": Decimal("490")},
           {"account_id": A[("OPCO-US", "1010")].id, "credit": Decimal("490")},
       ],
       target="pending_approval")

    # ── A draft that hasn't been submitted yet ────────────────────────
    mk("HOLDCO", date(2026, 4, 16),
       "Meals & entertainment — client dinner (draft)",
       lines=[
           {"account_id": A[("HOLDCO", "6100")].id, "debit": Decimal("315.50")},
           {"account_id": A[("HOLDCO", "1010")].id, "credit": Decimal("315.50")},
       ],
       target="draft")

    # ── An approved JE waiting to be posted ──────────────────────────
    mk("HOLDCO", date(2026, 4, 13),
       "Professional services · Deloitte",
       lines=[
           {"account_id": A[("HOLDCO", "6600")].id, "debit": Decimal("14000")},
           {"account_id": A[("HOLDCO", "1010")].id, "credit": Decimal("14000")},
       ],
       target="approved")

    # ── A rejected JE ────────────────────────────────────────────────
    mk("OPCO-UK", date(2026, 4, 11),
       "Questionable expense — approver flagged",
       currency="GBP",
       lines=[
           {"account_id": A[("OPCO-UK", "6100")].id, "debit": Decimal("1250"),
            "currency": "GBP", "exchange_rate": Decimal("1")},
           {"account_id": A[("OPCO-UK", "1010")].id, "credit": Decimal("1250"),
            "currency": "GBP", "exchange_rate": Decimal("1")},
       ],
       target="rejected")

    # ── A posted then reversed pair (correction of an earlier error) ──
    bad = mk("HOLDCO", date(2026, 4, 5),
             "Erroneous booking · to be reversed",
             lines=[
                 {"account_id": A[("HOLDCO", "6100")].id, "debit": Decimal("9999")},
                 {"account_id": A[("HOLDCO", "1010")].id, "credit": Decimal("9999")},
             ],
             ref_suffix="REVERSAL-TARGET")
    JournalService.reverse(
        bad, reversal_date=date(2026, 4, 8), user=approver,
        memo="Reversal — wrong entity (correction)",
    )
    created += 1  # reversal entry counted

    return created


# ─── Personal entity demo (JSMITH) ────────────────────────────────────────
# Idempotent per-JE so this works on databases where the main journal seed
# has already run. Gives the JSMITH (Individual) entity a small but realistic
# posted history — opening personal cash, an investment purchase, a dividend —
# so the entity-detail drill-down has something to show.

def seed_person_journals(org, entities, accounts, maker, approver):
    from beakon_core.models import JournalEntry
    A = accounts
    person = entities["JSMITH"]
    created = 0

    def mk(ref_suffix, entry_date, memo, lines):
        nonlocal created
        source_ref = f"{DEMO_MARKER}-{ref_suffix}"
        if JournalEntry.objects.filter(organization=org, source_ref=source_ref).exists():
            return
        je = JournalService.create_draft(
            organization=org, entity=person,
            date=entry_date, memo=memo,
            currency=person.functional_currency,
            lines=lines, user=maker,
            source_type=c.SOURCE_MANUAL,
            source_ref=source_ref,
        )
        JournalService.submit_for_approval(je, user=maker)
        JournalService.approve(je, user=approver)
        JournalService.post(je, user=approver)
        created += 1

    mk("JSMITH-OPEN", date(2026, 4, 1),
       "Opening personal bank balance",
       lines=[
           {"account_id": A[("JSMITH", "1010")].id, "debit": Decimal("250000")},
           {"account_id": A[("JSMITH", "3000")].id, "credit": Decimal("250000")},
       ])
    mk("JSMITH-BUY", date(2026, 4, 3),
       "Purchase: Apple / Shell shares + corporate bond",
       lines=[
           {"account_id": A[("JSMITH", "1800")].id, "debit": Decimal("120000")},
           {"account_id": A[("JSMITH", "1010")].id, "credit": Decimal("120000")},
       ])
    mk("JSMITH-DIV", date(2026, 4, 15),
       "Dividend received · Apple Inc",
       lines=[
           {"account_id": A[("JSMITH", "1010")].id, "debit": Decimal("1850")},
           {"account_id": A[("JSMITH", "4200")].id, "credit": Decimal("1850")},
       ])
    # ── EUR investment: Nestlé + ASML shares paid from USD bank @ 1.09 ──
    # Multi-currency JE: debit EUR, credit USD — balances in functional (USD).
    mk("JSMITH-EU-BUY", date(2026, 4, 6),
       "Purchase: Nestlé + ASML shares (EUR-denominated)",
       lines=[
           {"account_id": A[("JSMITH", "1800")].id, "debit": Decimal("40000"),
            "currency": "EUR", "exchange_rate": Decimal("1.09")},
           {"account_id": A[("JSMITH", "1010")].id, "credit": Decimal("43600"),
            "currency": "USD", "exchange_rate": Decimal("1")},
       ])
    # ── EUR dividend received into USD bank ────────────────────────────
    mk("JSMITH-EU-DIV", date(2026, 4, 20),
       "Dividend received · Nestlé SA (EUR)",
       lines=[
           {"account_id": A[("JSMITH", "1010")].id, "debit": Decimal("545"),
            "currency": "USD", "exchange_rate": Decimal("1")},
           {"account_id": A[("JSMITH", "4200")].id, "credit": Decimal("500"),
            "currency": "EUR", "exchange_rate": Decimal("1.09")},
       ])
    return created


# ─── Bank feeder demo ──────────────────────────────────────────────────────

SAMPLE_CSV = (
    b"date,description,amount,balance\n"
    b"2026-04-02,STRIPE PAYOUT ACH,12500.00,12500.00\n"
    b"2026-04-03,AWS BILLING MAR-2026,-842.16,11657.84\n"
    b"2026-04-05,STAPLES #4412,-182.33,11475.51\n"
    b"2026-04-09,WIRE FEE INTERNATIONAL,-45.00,11430.51\n"
    b"2026-04-12,LINEAR ORBIT SUBSCR,-96.00,11334.51\n"
    b"2026-04-16,SEQUOIA ADVISORY INVOICE,15000.00,26334.51\n"
)


def seed_bank(org, entities, accounts, maker, approver):
    # Bank account on HOLDCO linked to 1010
    ba, created = BankAccount.objects.get_or_create(
        organization=org, entity=entities["HOLDCO"],
        account=accounts[("HOLDCO", "1010")],
        defaults={
            "name": "HoldCo Operating Checking",
            "bank_name": "Mercury",
            "account_number_last4": "4812",
            "currency": "USD",
            "opening_balance": Decimal("0"),
            "created_by": maker,
        },
    )
    # Skip the CSV import if we've already imported (keyed by external_id presence).
    if BankTransaction.objects.filter(
        bank_account=ba, external_id__isnull=False,
    ).exists():
        return 0

    importer = CSVImporter(
        bank_account=ba,
        column_mapping={"date": 0, "description": 1, "amount": 2, "balance": 3},
        date_format="%Y-%m-%d", has_header=True,
    )
    importer.run(file_bytes=SAMPLE_CSV, file_name="demo-april.csv", user=maker)

    txns = list(BankTransaction.objects.filter(bank_account=ba).order_by("date"))

    # Categorize STRIPE PAYOUT → revenue, then submit + approve + post so
    # it ends up ``matched``.
    if txns:
        rev_acc = accounts[("HOLDCO", "4000")]
        Categorizer.categorize(
            txn=txns[0], offset_account=rev_acc, user=maker,
            memo="Stripe settlement",
        )
        je = txns[0].proposed_journal_entry
        JournalService.submit_for_approval(je, user=maker)
        JournalService.approve(je, user=approver)
        JournalService.post(je, user=approver)

    # Categorize AWS → 6100 Office Expenses but leave as `proposed` (so
    # the approval inbox shows this pending too).
    if len(txns) >= 2:
        ofc = accounts[("HOLDCO", "6100")]
        Categorizer.categorize(
            txn=txns[1], offset_account=ofc, user=maker,
            memo="AWS monthly cloud bill",
        )

    return len(txns)


# ─── Orchestrator ─────────────────────────────────────────────────────────

def main():
    org = Organization.objects.first()
    if not org:
        print("FAIL: no Organization — create one via admin first.")
        sys.exit(1)
    print(f"Seeding org: {org.name} (id={org.id})")

    # Everything in one transaction — either the whole demo lands, or none.
    with transaction.atomic():
        seed_reference()
        maker, approver = seed_users(org)
        entities, accounts = seed_entities_and_coa(org)
        seed_periods(entities)

        print(f"  entities:  {', '.join(sorted(entities))}")
        print(f"  accounts:  {len(accounts)}")
        print(f"  users:     {maker.email} · {approver.email}")

        je_count = seed_journal_entries(org, entities, accounts, maker, approver)
        print(f"  journals:  +{je_count} new JEs")

        person_count = seed_person_journals(org, entities, accounts, maker, approver)
        print(f"  person:    +{person_count} JSMITH JEs")

        tx_count = seed_bank(org, entities, accounts, maker, approver)
        print(f"  bank:      +{tx_count} imported transactions")

    from beakon_core.models import JournalEntry
    total_jes = JournalEntry.objects.filter(organization=org).count()
    total_ents = Entity.objects.filter(organization=org).count()
    total_bank = BankTransaction.objects.filter(
        bank_account__organization=org,
    ).count()
    print("")
    print("Totals in org:")
    print(f"  Entities: {total_ents}")
    print(f"  Journal entries: {total_jes}")
    print(f"  Bank transactions: {total_bank}")
    print("")
    print("Demo credentials (password: beakon-demo-pass!):")
    print("  demo-maker@beakon.local      - creates + submits JEs")
    print("  demo-approver@beakon.local   - approves + posts (can't self-approve)")


if __name__ == "__main__":
    main()
