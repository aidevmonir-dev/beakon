"""Entity-scoped helpers: period resolution, per-entity JE numbering."""
from datetime import date as dt_date

from django.db import transaction

from ..models import Entity, JournalEntry, Period


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
