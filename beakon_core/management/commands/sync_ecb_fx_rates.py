"""manage.py sync_ecb_fx_rates [--days N]

Pulls EUR-base reference rates from the European Central Bank, derives
inverses + CHF cross-rates, upserts to FXRate. Designed for cron use:

    # Daily refresh (one row per ECB-quoted ccy + inverses + CHF crosses)
    0 17 * * 1-5  cd /app && python manage.py sync_ecb_fx_rates

    # First-time backfill 90 business days
    python manage.py sync_ecb_fx_rates --days 90

ECB publishes after market close around 16:00 CET, so a 17:00 CET cron
catches the day's fixing comfortably. Idempotent — re-running same-day
is a no-op write.
"""
from django.core.management.base import BaseCommand, CommandError

from beakon_core.services import ECBFXService
from beakon_core.services.ecb_fx import ECBSyncError


class Command(BaseCommand):
    help = "Sync FX rates from the European Central Bank."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days", type=int, default=1,
            help="Days of history to pull (1-90). Default 1.",
        )

    def handle(self, *args, **opts):
        days = max(1, min(int(opts["days"]), 90))
        try:
            result = ECBFXService.sync(days=days)
        except ECBSyncError as e:
            raise CommandError(str(e))
        self.stdout.write(self.style.SUCCESS(
            f"Synced {result.fetched_days} day(s) from ECB.\n"
            f"  Latest fixing:    {result.latest_date}\n"
            f"  Rows upserted:    {result.rows_upserted}\n"
            f"  Inverses added:   {result.inverses_added}\n"
            f"  Cross-rates:      {result.cross_rates_added}\n"
            f"  Source:           {result.source_url}"
        ))
