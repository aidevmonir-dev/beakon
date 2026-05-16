"""manage.py check_avaloq_arrivals [--expected-date YYYY-MM-DD]

Reports custodians whose daily Avaloq zip has not arrived for the expected
business date. Designed to run from cron shortly after the bank's stated
delivery cutoff (07:00 CET per the spec) so a missing file becomes a
same-day alert rather than a Monday-morning surprise.

Algorithm:
  For each (organization, custodian) pair that has ever received a drop,
  find the latest drop. If its business_date is older than the expected
  business date, emit a WARNING line.

  Custodians with zero history are not checked — they haven't been
  onboarded into the feed yet, so silence is not an SLA breach.

Exit code:
  0 — every active custodian is up to date.
  1 — at least one custodian is late. Cron wrappers should escalate.
"""
from __future__ import annotations

from datetime import date, timedelta

from django.core.management.base import BaseCommand
from django.db.models import Max
from django.utils import timezone

from beakon_banking.models import AvaloqFeedDrop


def _previous_business_day(reference: date) -> date:
    """Return the last business day strictly before ``reference``.

    Banking holidays are out of scope for v1 — the spec acknowledges the
    bank may legitimately skip specific days. Operators silence those
    by hand from the resulting alerts.
    """
    candidate = reference - timedelta(days=1)
    while candidate.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
        candidate -= timedelta(days=1)
    return candidate


class Command(BaseCommand):
    help = "Alert on custodians whose daily Avaloq zip is late or missing."

    def add_arguments(self, parser):
        parser.add_argument(
            "--expected-date",
            help="Business date that should have been delivered by now "
                 "(YYYY-MM-DD). Defaults to the previous business day "
                 "relative to today.",
        )

    def handle(self, *args, **opts):
        today = timezone.localdate()
        if opts["expected_date"]:
            expected = date.fromisoformat(opts["expected_date"])
        else:
            expected = _previous_business_day(today)

        latest_by_custodian = list(
            AvaloqFeedDrop.objects
            .exclude(custodian__isnull=True)
            .values("organization_id", "custodian_id",
                    "custodian__custodian_id", "custodian__custodian_name",
                    "organization__name")
            .annotate(latest=Max("business_date"))
            .order_by("organization_id", "custodian__custodian_id")
        )

        late = []
        ok = []
        for row in latest_by_custodian:
            if row["latest"] < expected:
                late.append(row)
            else:
                ok.append(row)

        self.stdout.write(f"Checked {len(latest_by_custodian)} custodian(s) "
                          f"against expected business date {expected.isoformat()}.")
        for row in ok:
            self.stdout.write(self.style.SUCCESS(
                f"  OK    org={row['organization__name']!r} "
                f"custodian={row['custodian__custodian_id']} "
                f"latest={row['latest'].isoformat()}"
            ))
        for row in late:
            days_behind = (expected - row["latest"]).days
            self.stdout.write(self.style.WARNING(
                f"  LATE  org={row['organization__name']!r} "
                f"custodian={row['custodian__custodian_id']} "
                f"({row['custodian__custodian_name']}) "
                f"latest={row['latest'].isoformat()} "
                f"({days_behind} business-day(s) behind)"
            ))

        if late:
            self.stdout.write(self.style.ERROR(
                f"\n{len(late)} custodian(s) have not delivered the "
                f"{expected.isoformat()} zip."
            ))
            exit(1)
