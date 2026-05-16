"""manage.py ingest_avaloq [--organization N] [--custodian X] [--zip path]

Sweeps settings.AVALOQ_INCOMING_DIR for daily zips and ingests each one
through ``AvaloqFeedService.ingest``. Idempotent — re-running is safe.

In production this is wired to a scheduled task (Windows Task Scheduler
or Linux cron) that fires every 15 minutes between 06:00 and 09:00 CET,
catching whichever delivery slot the bank used on the day.
"""
from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from beakon_banking.constants import DROP_INGESTED
from beakon_banking.models import AvaloqFeedDrop
from beakon_banking.services import (
    AvaloqFeedError,
    AvaloqFeedService,
    archive_zip,
    quarantine_zip,
)
from beakon_core.models import Custodian
from organizations.models import Organization


class Command(BaseCommand):
    help = "Sweep AVALOQ_INCOMING_DIR and ingest any new zips."

    def add_arguments(self, parser):
        parser.add_argument(
            "--organization", type=int, default=None,
            help="Organization ID to attribute the drops to. "
                 "Default: first organization in the database (single-tenant dev).",
        )
        parser.add_argument(
            "--custodian", default=None,
            help="Custodian code (Custodian.custodian_id). Optional — "
                 "without it the drop is recorded with no custodian FK.",
        )
        parser.add_argument(
            "--zip", default=None,
            help="Process a specific zip path instead of sweeping the directory. "
                 "When used, post-ingest archive/quarantine is skipped so the "
                 "operator's source file is preserved as-is.",
        )
        parser.add_argument(
            "--no-archive", action="store_true",
            help="Skip post-ingest move to archive/quarantine. Useful for "
                 "rehearsals against a fixed sample set.",
        )

    def handle(self, *args, **opts):
        org_id = opts["organization"]
        if org_id:
            org = Organization.objects.filter(id=org_id).first()
        else:
            org = Organization.objects.order_by("id").first()
        if org is None:
            raise CommandError(
                "No organization found. Pass --organization or create one."
            )

        custodian = None
        if opts["custodian"]:
            custodian = Custodian.objects.filter(
                organization=org, custodian_id=opts["custodian"],
            ).first()
            if custodian is None:
                self.stdout.write(self.style.WARNING(
                    f"Custodian '{opts['custodian']}' not found in organization "
                    f"{org.id}; ingesting without a custodian FK."
                ))

        explicit_zip = bool(opts["zip"])
        if explicit_zip:
            zips = [Path(opts["zip"])]
            if not zips[0].exists():
                raise CommandError(f"Zip not found: {zips[0]}")
        else:
            zips = AvaloqFeedService.scan(Path(settings.AVALOQ_INCOMING_DIR))

        if not zips:
            self.stdout.write("No zips to ingest.")
            return

        # File lifecycle is on for the production sweep, off for explicit
        # re-ingests (operator's source is preserved) and when --no-archive
        # is passed for rehearsals.
        move_after = not explicit_zip and not opts["no_archive"]
        archive_root = Path(settings.AVALOQ_ARCHIVE_DIR)
        quarantine_root = Path(settings.AVALOQ_QUARANTINE_DIR)

        self.stdout.write(f"Ingesting {len(zips)} zip(s) for org={org.id}…")
        for z in zips:
            try:
                result = AvaloqFeedService.ingest(
                    z, organization=org, custodian=custodian,
                )
            except AvaloqFeedError as e:
                self.stdout.write(self.style.ERROR(f"  {z.name}: {e}"))
                continue

            # Move the source zip into archive (success) or quarantine
            # (failure) so the incoming directory stays a true work queue.
            # A zip that was ingested on a prior run but never archived
            # (e.g. from before this feature shipped) is moved on this run.
            moved_to = ""
            if move_after:
                drop = AvaloqFeedDrop.objects.get(pk=result.drop_id)
                if not drop.archive_path:
                    try:
                        if drop.status == DROP_INGESTED:
                            moved_to = str(archive_zip(z, drop, archive_root))
                        else:
                            moved_to = str(quarantine_zip(z, drop, quarantine_root))
                    except OSError as e:
                        self.stdout.write(self.style.WARNING(
                            f"  {z.name}: could not move source file ({e}). "
                            f"The drop row is intact; move manually."
                        ))

            tag = "skipped (already ingested)" if result.skipped else result.status
            lines = [
                f"  {z.name}",
                f"    drop_id:      {result.drop_id}",
                f"    portfolio:    {result.portfolio_id}",
                f"    status:       {tag}",
                f"    file counts:  {result.file_counts}",
                f"    breaks:       {result.breaks}",
                f"    errors:       {len(result.errors)}",
            ]
            if moved_to:
                lines.append(f"    moved to:     {moved_to}")
            self.stdout.write(self.style.SUCCESS("\n".join(lines)))
