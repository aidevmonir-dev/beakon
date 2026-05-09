"""Entity-scoped helpers: period resolution, per-entity JE numbering."""
from datetime import date as dt_date

from django.db import transaction

from .. import constants as bc
from ..models import Account, Entity, JournalEntry, Period


# Minimum CoA every new entity needs so the kernel can post bills, invoices,
# bank moves, and the year-end close out of the box. Trimming this list will
# break the corresponding service: e.g. BillService raises AP010 when there
# is no `accounts_payable` account on the entity.
DEFAULT_COA_TEMPLATE = [
    # (code, name, type, subtype)
    ("1010", "Operating Bank",          bc.ACCOUNT_TYPE_ASSET,     "bank"),
    ("1200", "Accounts Receivable",     bc.ACCOUNT_TYPE_ASSET,     "accounts_receivable"),
    ("1210", "Input VAT (recoverable)", bc.ACCOUNT_TYPE_ASSET,     "vat_receivable"),
    ("2010", "Accounts Payable",        bc.ACCOUNT_TYPE_LIABILITY, "accounts_payable"),
    ("2200", "Output VAT (collected)",  bc.ACCOUNT_TYPE_LIABILITY, "vat_payable"),
    ("3000", "Capital",                 bc.ACCOUNT_TYPE_EQUITY,    "capital"),
    ("3100", "Retained Earnings",       bc.ACCOUNT_TYPE_EQUITY,    "retained_earnings"),
    ("4000", "Service Revenue",         bc.ACCOUNT_TYPE_REVENUE,   "operating_revenue"),
    ("6000", "Operating Expenses",      bc.ACCOUNT_TYPE_EXPENSE,   "operating_expense"),
]


class EntityService:
    @staticmethod
    def period_for_date(entity: Entity, date: dt_date):
        """Return the Period row that ``date`` falls inside, or None."""
        return Period.objects.filter(
            entity=entity, start_date__lte=date, end_date__gte=date,
        ).first()

    @staticmethod
    @transaction.atomic
    def next_entry_number(entity: Entity) -> str:
        """Generate the next sequential ``JE-000001``-style number per entity.

        Note: simple max+1; for heavy concurrency we'd switch to a per-entity
        sequence table with row locking. Fine for now.
        """
        last = (
            JournalEntry.objects
            .filter(entity=entity)
            .order_by("-id")
            .values_list("entry_number", flat=True).first()
        )
        if last and "-" in last:
            try:
                num = int(last.split("-")[1]) + 1
            except (IndexError, ValueError):
                num = 1
        else:
            num = 1
        return f"JE-{num:06d}"

    @staticmethod
    @transaction.atomic
    def seed_default_coa(entity: Entity) -> list[Account]:
        """Plant the minimum CoA on a freshly created entity.

        Idempotent: skips any (entity, code) that already exists so re-running
        on an existing entity is a no-op for that code. Returns the full list
        of `Account` rows on the entity after seeding.
        """
        existing = set(
            Account.objects
            .filter(organization=entity.organization, entity=entity)
            .values_list("code", flat=True)
        )
        to_create = [
            Account(
                organization=entity.organization,
                entity=entity,
                code=code,
                name=name,
                account_type=atype,
                account_subtype=subtype,
                currency=entity.functional_currency,
                is_active=True,
                posting_allowed=True,
            )
            for (code, name, atype, subtype) in DEFAULT_COA_TEMPLATE
            if code not in existing
        ]
        if to_create:
            Account.objects.bulk_create(to_create)
        return list(
            Account.objects
            .filter(organization=entity.organization, entity=entity)
            .order_by("code")
        )
