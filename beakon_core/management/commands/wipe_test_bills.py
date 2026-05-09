"""Wipe bills and their linked journal entries — for demo / test cleanup.

Use cases:
    - Demo prep: clean slate before showing Thomas
    - QA cleanup: remove drafts left behind from testing
    - Reset after experimenting with the AI bill-import flow

Safety:
    - Default is dry-run. Pass --confirm to actually delete.
    - --organization filters to one org by slug
    - --status filters to one status (draft, approved, paid, ...)
    - All deletes happen in a single atomic transaction — if anything
      fails partway, the DB rolls back. Audit trail is preserved
      because we're deleting the records themselves, not just
      hiding them.

Examples:
    python manage.py wipe_test_bills                              # dry-run all bills (preview)
    python manage.py wipe_test_bills --confirm                    # delete all bills (every org)
    python manage.py wipe_test_bills --confirm --status draft     # only drafts
    python manage.py wipe_test_bills --confirm --organization beakon

Note: This is irreversible. Bills referenced by approved/paid JEs will
have those JEs deleted too — so the trial balance changes. Don't run
on production data unless you really mean it.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from beakon_core.models import Bill, JournalEntry
from organizations.models import Organization


class Command(BaseCommand):
    help = "Delete bills and their linked journal entries (demo / test cleanup)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm", action="store_true",
            help="Actually delete. Without this flag the command runs as a "
                 "preview and changes nothing.",
        )
        parser.add_argument(
            "--organization",
            help="Slug of the organization to scope to. Default: all orgs.",
        )
        parser.add_argument(
            "--status",
            help="Only wipe bills in this status (e.g. 'draft', 'approved', "
                 "'paid', 'cancelled'). Default: every status.",
        )

    def handle(self, *args, **opts):
        bills_qs = Bill.objects.all().select_related(
            "organization", "accrual_journal_entry", "payment_journal_entry",
        )

        if opts["organization"]:
            try:
                org = Organization.objects.get(slug=opts["organization"])
            except Organization.DoesNotExist:
                self.stderr.write(self.style.ERROR(
                    f"No organization with slug={opts['organization']!r}"
                ))
                return
            bills_qs = bills_qs.filter(organization=org)

        if opts["status"]:
            bills_qs = bills_qs.filter(status=opts["status"])

        bills = list(bills_qs)
        if not bills:
            self.stdout.write("No bills match the filter — nothing to wipe.")
            return

        # Collect linked JE IDs ahead of bill deletion. SET_NULL on the FK
        # would otherwise null these out before we get a chance to read them.
        je_ids: set[int] = set()
        for b in bills:
            if b.accrual_journal_entry_id:
                je_ids.add(b.accrual_journal_entry_id)
            if b.payment_journal_entry_id:
                je_ids.add(b.payment_journal_entry_id)

        # ── Preview ────────────────────────────────────────────────
        self.stdout.write(self.style.WARNING(
            f"Will delete {len(bills)} bill(s) and {len(je_ids)} linked JE(s)."
        ))
        for b in bills[:30]:
            self.stdout.write(
                f"  • {b.organization.slug:<24} {b.reference:<24} "
                f"status={b.status:<18} total={b.total} {b.currency}"
            )
        if len(bills) > 30:
            self.stdout.write(f"  ... and {len(bills) - 30} more")

        if not opts["confirm"]:
            self.stdout.write(self.style.NOTICE(
                "\nDry run. Re-run with --confirm to actually delete."
            ))
            return

        # ── Execute ─────────────────────────────────────────────────
        with transaction.atomic():
            # Bill -> BillLine cascade is handled by FK on_delete=CASCADE
            # (or PROTECT, depending on schema — Bill.delete() will raise
            # ProtectedError if it can't cascade, surfacing the issue).
            line_count = 0
            for b in bills:
                line_count += b.lines.count()
                b.delete()

            # JEs were FK'd from Bill with SET_NULL, so nothing prevents
            # deleting them now that the Bills are gone.
            jes = JournalEntry.objects.filter(id__in=je_ids)
            je_count = jes.count()
            jes.delete()  # JournalLine cascades

        self.stdout.write(self.style.SUCCESS(
            f"\nDeleted {len(bills)} bill(s), {line_count} bill line(s), "
            f"{je_count} journal entry/entries."
        ))
