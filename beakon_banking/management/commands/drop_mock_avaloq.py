"""manage.py drop_mock_avaloq [--portfolio X] [--business-date Y]

Demo-only. Generates a mock Avaloq daily zip and drops it into the
configured incoming directory (settings.AVALOQ_INCOMING_DIR), exactly
as a real SFTP push would.

Use ``manage.py ingest_avaloq`` afterwards to process it.
"""
from __future__ import annotations

import sys
from datetime import date as dt_date
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Generate a mock Avaloq zip and drop it into the incoming directory."

    def add_arguments(self, parser):
        parser.add_argument(
            "--portfolio", default="BEAKON-DEMO-001",
            help="Portfolio prefix used in filenames.",
        )
        parser.add_argument(
            "--business-date", default=None,
            help="Reporting date (YYYY-MM-DD). Default: today.",
        )

    def handle(self, *args, **opts):
        # Reach the script that already builds the zip — keeps generator
        # logic in one place. Path-import dance avoids polluting INSTALLED_APPS.
        scripts_dir = Path(settings.BASE_DIR) / "scripts"
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        import _generate_mock_avaloq_zip as gen  # type: ignore

        bd = (dt_date.fromisoformat(opts["business_date"])
              if opts["business_date"] else dt_date.today())

        out_dir = Path(settings.AVALOQ_INCOMING_DIR)
        zip_path = gen.build_zip(opts["portfolio"], bd, out_dir)

        self.stdout.write(self.style.SUCCESS(
            f"Dropped mock zip:\n"
            f"  Path:           {zip_path}\n"
            f"  Portfolio:      {opts['portfolio']}\n"
            f"  Business date:  {bd.isoformat()}\n"
            f"  Size:           {zip_path.stat().st_size} bytes\n"
            f"\nRun 'python manage.py ingest_avaloq' to process it."
        ))
