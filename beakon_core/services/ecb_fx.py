"""ECBFXService — fetch the European Central Bank's free reference rates
and persist them to the FXRate table.

ECB publishes a daily reference fixing at ~16:00 CET. Three free, no-key
endpoints:
    eurofxref-daily.xml      latest day only
    eurofxref-hist-90d.xml   last 90 business days
    eurofxref-hist.xml       full history back to 1999

All quotes are EUR-base: "1 EUR = X foreign currency". For an entity in
CHF (or USD, GBP, ...), we additionally derive cross-rates and inverses
so the kernel never needs to triangulate at posting time:
    EUR -> X     (direct, from ECB)
    X   -> EUR   (inverse)
    CHF -> X     (cross via EUR — only when CHF and X are both ECB-listed)
    X   -> CHF   (inverse cross)

Rates are upserted on (from, to, as_of) — re-running the sync is safe
and idempotent.

Source field is always set to ``"ecb"`` so the UI can filter or badge
ECB-sourced rows distinct from manual entries.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date as dt_date, datetime
from decimal import Decimal, InvalidOperation
from typing import Iterable, Optional
from xml.etree import ElementTree as ET

import requests
from django.db import transaction

from ..models import FXRate


log = logging.getLogger(__name__)

# ECB endpoints. Public, no auth, ~5 KB / 50 KB / 5 MB respectively.
ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
ECB_HIST_90D_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"

# ECB XML namespaces. The "main" namespace is the gesmes envelope; the
# "ecb" namespace is the actual rate cube.
NS = {
    "gesmes": "http://www.gesmes.org/xml/2002-08-01",
    "ecb":    "http://www.ecb.int/vocabulary/2002-08-01/eurofxref",
}

SOURCE = "ecb"

# Reporting cross-rates we derive automatically. ECB only quotes EUR->X,
# but most callers want X->Y for a Y that isn't EUR. CHF leads because
# Thomas's entities are CHF-functional; add more if other reporting
# currencies become common.
CROSS_BASES = ("CHF",)


@dataclass
class SyncResult:
    """Summary of one sync run."""
    fetched_days: int
    rows_upserted: int
    inverses_added: int
    cross_rates_added: int
    latest_date: Optional[dt_date]
    source_url: str

    def as_dict(self) -> dict:
        return {
            "fetched_days":      self.fetched_days,
            "rows_upserted":     self.rows_upserted,
            "inverses_added":    self.inverses_added,
            "cross_rates_added": self.cross_rates_added,
            "latest_date":       self.latest_date.isoformat() if self.latest_date else None,
            "source_url":        self.source_url,
        }


class ECBFXService:
    @staticmethod
    def sync(*, days: int = 1, timeout_seconds: int = 20) -> SyncResult:
        """Fetch ECB rates and upsert to FXRate.

        ``days=1`` hits the daily endpoint (one day, ~30 rows).
        ``days>1`` hits the 90-day endpoint and keeps that many days back
        from the most recent fixing — enough for any near-term JE without
        bloating the table.
        """
        url = ECB_HIST_90D_URL if days > 1 else ECB_DAILY_URL
        try:
            resp = requests.get(url, timeout=timeout_seconds)
            resp.raise_for_status()
        except requests.RequestException as e:
            raise ECBSyncError(f"Could not reach ECB ({url}): {e}") from e

        try:
            tree = ET.fromstring(resp.content)
        except ET.ParseError as e:
            raise ECBSyncError(f"ECB returned malformed XML: {e}") from e

        # Each <Cube time="YYYY-MM-DD"><Cube currency="XXX" rate="..."/></Cube>
        all_cubes = tree.findall(".//ecb:Cube[@time]", NS)
        # Newest first (ECB orders newest first, but be defensive)
        all_cubes.sort(key=lambda c: c.attrib.get("time", ""), reverse=True)

        if days > 1:
            cubes = all_cubes[: days]
        else:
            cubes = all_cubes[:1]

        if not cubes:
            raise ECBSyncError("ECB feed contained no Cube elements.")

        rows: list[FXRate] = []
        inverses = 0
        cross_added = 0
        latest_date: Optional[dt_date] = None

        for day_cube in cubes:
            try:
                d = datetime.strptime(day_cube.attrib["time"], "%Y-%m-%d").date()
            except (KeyError, ValueError):
                continue
            if latest_date is None or d > latest_date:
                latest_date = d

            # EUR-base rates for this day
            eur_to: dict[str, Decimal] = {}
            for cube in day_cube.findall("./ecb:Cube[@currency]", NS):
                ccy = cube.attrib.get("currency", "").upper()
                rate_raw = cube.attrib.get("rate", "")
                if not ccy or not rate_raw:
                    continue
                try:
                    rate = Decimal(rate_raw)
                except (InvalidOperation, ValueError):
                    continue
                if rate <= 0:
                    continue
                eur_to[ccy] = rate

            for ccy, rate in eur_to.items():
                # EUR -> CCY (direct)
                rows.append(_row("EUR", ccy, rate, d))
                # CCY -> EUR (inverse)
                rows.append(_row(ccy, "EUR", _inv(rate), d))
                inverses += 1

            # Cross-rates: BASE -> X for every BASE in CROSS_BASES that ECB quotes
            for base in CROSS_BASES:
                base_rate = eur_to.get(base)
                if not base_rate:
                    continue
                for ccy, rate in eur_to.items():
                    if ccy == base:
                        continue
                    # 1 BASE = (rate / base_rate) CCY
                    cross = rate / base_rate
                    rows.append(_row(base, ccy, cross, d))
                    rows.append(_row(ccy, base, _inv(cross), d))
                    cross_added += 2

        upserted = _bulk_upsert(rows)
        return SyncResult(
            fetched_days=len(cubes),
            rows_upserted=upserted,
            inverses_added=inverses,
            cross_rates_added=cross_added,
            latest_date=latest_date,
            source_url=url,
        )


# ── helpers ─────────────────────────────────────────────────────────────

class ECBSyncError(Exception):
    pass


def _inv(rate: Decimal) -> Decimal:
    """Inverse with full precision — kept under the model's 10-decimal
    DecimalField cap. Quantize to avoid trailing noise from division."""
    if rate == 0:
        return Decimal("0")
    return (Decimal("1") / rate).quantize(Decimal("0.0000000001"))


def _row(from_ccy: str, to_ccy: str, rate: Decimal, as_of: dt_date) -> FXRate:
    # Rate is bounded by the model column at max_digits=20, decimal_places=10
    rounded = rate.quantize(Decimal("0.0000000001")) if rate else Decimal("0")
    return FXRate(
        from_currency=from_ccy,
        to_currency=to_ccy,
        rate=rounded,
        as_of=as_of,
        source=SOURCE,
    )


@transaction.atomic
def _bulk_upsert(rows: Iterable[FXRate]) -> int:
    """Idempotent upsert on (from_currency, to_currency, as_of)."""
    rows = list(rows)
    if not rows:
        return 0
    keys = {(r.from_currency, r.to_currency, r.as_of): r for r in rows}
    # Pull existing rows in one query
    existing = {
        (r.from_currency, r.to_currency, r.as_of): r
        for r in FXRate.objects.filter(
            from_currency__in=[k[0] for k in keys],
            to_currency__in=[k[1] for k in keys],
            as_of__in=[k[2] for k in keys],
        )
    }
    to_create: list[FXRate] = []
    to_update: list[FXRate] = []
    for k, new in keys.items():
        ex = existing.get(k)
        if ex is None:
            to_create.append(new)
        else:
            ex.rate = new.rate
            ex.source = SOURCE
            to_update.append(ex)
    if to_create:
        FXRate.objects.bulk_create(to_create, ignore_conflicts=True)
    if to_update:
        FXRate.objects.bulk_update(to_update, ["rate", "source"])
    return len(to_create) + len(to_update)
