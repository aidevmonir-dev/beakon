"""Avaloq SFTP daily-feed ingest pipeline.

The bank pushes one zip per portfolio per business day, containing five
files identified by suffix:

    XXX_cash         → BankTransaction (via existing FeedImport pipeline)
    XXX_securities   → beakon_core.PortfolioTrade
    XXX_orderbook    → beakon_core.OpenOrder
    XXX_positions    → beakon_core.PositionSnapshot   (reconciled vs TaxLot)
    XXX_perf         → beakon_core.PerformanceSnapshot

The `XXX` prefix is the portfolio identifier — used to look up the
``Portfolio`` record on our side. The first time we see a portfolio we
don't recognise, we raise a ``BREAK_MISSING_PORTFOLIO`` reconciliation
break and skip the file.

Format isolation
----------------
The bank schema is **preliminary** — we are running on mock files until
real Avaloq samples arrive. All format-dependent column lookups are
funnelled through the per-file ``_parse_*`` methods. When real samples
arrive, only those methods change; the dispatcher, idempotency,
reconciliation, and downstream models stay identical.

Idempotency
-----------
Each zip is identified by ``sha256(payload) + business_date``. Re-
ingesting the same zip is a no-op write at the row level (each parser
upserts on its own natural key) and the ``AvaloqFeedDrop`` row is
re-used.
"""
from __future__ import annotations

import csv
import hashlib
import io
import logging
import re
import shutil
import zipfile
from dataclasses import dataclass, field
from datetime import date as dt_date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable, Optional

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from beakon_core.models import (
    OpenOrder,
    PerformanceSnapshot,
    Portfolio,
    PortfolioTrade,
    PositionSnapshot,
    TaxLot,
)

# Statement schema version we currently understand. When the bank
# rolls a new column, we bump this and the validator surfaces a
# `SchemaMismatch`. For the demo we hard-code v1.
SCHEMA_VERSION = "avaloq-mock-v1"

# Trade-date proximity that classifies a quantity break as a *timing*
# break rather than a *missing trade*. Avaloq settlement is T+2 for
# equities, so a trade booked yesterday legitimately won't show up in
# the running TaxLot until tomorrow.
TIMING_BREAK_BD_WINDOW = 2
from organizations.models import Organization

from .. import constants as c
from ..models import (
    AvaloqFeedDrop,
    BankAccount,
    BankTransaction,
    FeedImport,
    ReconciliationBreak,
)
from .importer import _dedup_key, _normalize_desc


log = logging.getLogger(__name__)


# Match `<PORTFOLIO>_<TYPE>.csv` inside the zip and `<PORTFOLIO>_<DATE>.zip` outside.
_INNER_FILENAME = re.compile(r"^(?P<prefix>.+)_(?P<type>[a-z]+)\.csv$", re.IGNORECASE)
_OUTER_FILENAME = re.compile(
    r"^(?P<prefix>.+)_(?P<date>\d{4}-\d{2}-\d{2})\.zip$", re.IGNORECASE,
)


@dataclass
class IngestResult:
    """Summary returned by :py:meth:`AvaloqFeedService.ingest`."""
    drop_id: int
    portfolio_id: Optional[str]
    business_date: Optional[str]
    status: str
    file_counts: dict = field(default_factory=dict)
    breaks: int = 0
    errors: list = field(default_factory=list)
    skipped: bool = False  # True if the zip was already ingested


class AvaloqFeedError(Exception):
    """Recoverable ingest error — recorded on the drop's error_log."""


class AvaloqFeedService:

    # ─── public entry points ───

    @staticmethod
    def scan(incoming_dir: Path) -> list[Path]:
        """Return zips in ``incoming_dir`` that match the expected naming."""
        if not incoming_dir.exists():
            return []
        return sorted(
            p for p in incoming_dir.iterdir()
            if p.is_file() and p.suffix.lower() == ".zip"
            and _OUTER_FILENAME.match(p.name)
        )

    @classmethod
    def ingest(
        cls,
        zip_path: Path,
        *,
        organization: Organization,
        custodian=None,
        user=None,
    ) -> IngestResult:
        """Ingest one zip end-to-end.

        - Idempotent on (organization, sha256, business_date).
        - Writes one ``AvaloqFeedDrop`` (re-uses existing if found).
        - Dispatches each inner CSV to its parser.
        - Reconciles positions against TaxLot, raising
          :py:class:`ReconciliationBreak` rows for mismatches.
        - Returns a structured ``IngestResult``.
        """
        zip_path = Path(zip_path)
        if not zip_path.exists():
            raise AvaloqFeedError(f"Zip not found: {zip_path}")

        sha = _sha256(zip_path)
        business_date = _parse_business_date(zip_path.name)
        size_bytes = zip_path.stat().st_size

        # Idempotency: re-use existing drop if we've seen this zip before.
        drop, created = AvaloqFeedDrop.objects.get_or_create(
            organization=organization,
            sha256=sha,
            business_date=business_date,
            defaults={
                "file_name": zip_path.name,
                "custodian": custodian,
                "received_by": user,
                "status": c.DROP_RECEIVED,
                "schema_version": SCHEMA_VERSION,
                "file_size_bytes": size_bytes,
            },
        )

        # Wire prior-drop pointer (stable chain for vs-T-2 delta).
        if created:
            prefix = _extract_prefix(zip_path.name)
            prior = (
                AvaloqFeedDrop.objects
                .filter(
                    organization=organization,
                    file_name__startswith=f"{prefix}_",
                    business_date__lt=business_date,
                    status=c.DROP_INGESTED,
                )
                .order_by("-business_date")
                .first()
            )
            if prior:
                drop.prior_drop = prior
                drop.save(update_fields=["prior_drop"])
        if not created and drop.status == c.DROP_INGESTED:
            return IngestResult(
                drop_id=drop.id,
                portfolio_id=_extract_prefix(zip_path.name),
                business_date=business_date.isoformat(),
                status=drop.status,
                file_counts=drop.file_counts or {},
                breaks=drop.breaks.count(),
                skipped=True,
            )

        return cls._ingest_drop(drop, zip_path, organization=organization, user=user)

    # ─── internals ───

    @classmethod
    @transaction.atomic
    def _ingest_drop(
        cls,
        drop: AvaloqFeedDrop,
        zip_path: Path,
        *,
        organization: Organization,
        user=None,
    ) -> IngestResult:
        drop.status = c.DROP_INGESTING
        drop.ingest_started_at = timezone.now()
        drop.error_log = []
        drop.save(update_fields=["status", "ingest_started_at", "error_log"])

        prefix = _extract_prefix(zip_path.name)
        counts: dict[str, int] = {ft: 0 for ft in c.AVALOQ_FILE_TYPES}
        errors: list[dict] = []

        portfolio = Portfolio.objects.filter(
            organization=organization, portfolio_id=prefix,
        ).first()
        if portfolio is None:
            ReconciliationBreak.objects.create(
                drop=drop,
                portfolio=None,
                break_type=c.BREAK_MISSING_PORTFOLIO,
                detail=f"Zip prefix '{prefix}' does not match any "
                       f"Portfolio.portfolio_id for this organization. "
                       f"Cannot ingest until the portfolio master is set up.",
            )
            errors.append({"code": c.BREAK_MISSING_PORTFOLIO,
                           "detail": f"unknown portfolio prefix '{prefix}'"})
            drop.status = c.DROP_FAILED
            drop.file_counts = counts
            drop.error_log = errors
            drop.ingest_completed_at = timezone.now()
            drop.save()
            return _result(drop, prefix, errors)

        # Open the zip and dispatch each member.
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                for inner_name in zf.namelist():
                    m = _INNER_FILENAME.match(inner_name)
                    if not m:
                        continue
                    file_type = m.group("type").lower()
                    if file_type not in c.AVALOQ_FILE_TYPES:
                        continue
                    try:
                        text = zf.read(inner_name).decode("utf-8-sig")
                    except UnicodeDecodeError:
                        text = zf.read(inner_name).decode("latin-1")
                    rows = list(csv.DictReader(io.StringIO(text)))
                    n = cls._dispatch(
                        file_type, rows,
                        organization=organization,
                        portfolio=portfolio,
                        drop=drop,
                        user=user,
                    )
                    counts[file_type] = n
        except AvaloqFeedError as e:
            errors.append({"code": "INGEST_ERROR", "detail": str(e)})
            log.exception("Avaloq ingest failed for drop %s", drop.id)
        except Exception as e:  # pragma: no cover - safety net
            errors.append({"code": "INGEST_UNEXPECTED", "detail": str(e)})
            log.exception("Unexpected Avaloq ingest failure for drop %s", drop.id)

        # Reconciliation: positions vs TaxLot.
        breaks_added = cls._reconcile_positions(drop, portfolio, organization)

        drop.file_counts = counts
        drop.error_log = errors
        drop.ingest_completed_at = timezone.now()
        drop.status = c.DROP_FAILED if errors else c.DROP_INGESTED
        drop.save()

        return IngestResult(
            drop_id=drop.id,
            portfolio_id=prefix,
            business_date=drop.business_date.isoformat(),
            status=drop.status,
            file_counts=counts,
            breaks=breaks_added + drop.breaks.exclude(
                break_type=c.BREAK_MISSING_PORTFOLIO,
            ).count() - breaks_added,  # net of any pre-existing
            errors=errors,
        )

    # ─── per-file parsers ───
    # Each returns the number of rows written (or upserted).

    @staticmethod
    def _parse_cash(rows, *, organization, portfolio, drop, user):
        """Cash → BankTransaction via existing dedup pipeline.

        We need a BankAccount to write into. Resolution: first active
        BankAccount in the organization whose currency matches the cash
        row's currency. If none exists, log an error and skip the row.
        """
        if not rows:
            return 0

        # Cache (currency → BankAccount) per call so we don't re-query for every row.
        bank_account_cache: dict[str, Optional[BankAccount]] = {}

        def _resolve_bank_account(currency: str) -> Optional[BankAccount]:
            if currency in bank_account_cache:
                return bank_account_cache[currency]
            ba = BankAccount.objects.filter(
                organization=organization, currency=currency, is_active=True,
            ).order_by("id").first()
            bank_account_cache[currency] = ba
            return ba

        # Group rows by bank account so we create one FeedImport per (BA, drop).
        feed_import_by_ba: dict[int, FeedImport] = {}
        imported = 0

        for row in rows:
            try:
                d = _parse_date(row.get("date"))
                desc = (row.get("description") or "").strip()
                amount = _parse_decimal(row.get("amount"))
                ccy = (row.get("currency") or "").strip().upper()
                ext_id = (row.get("external_id") or "").strip()
                balance_after = _parse_decimal_optional(row.get("balance_after"))
            except AvaloqFeedError as e:
                drop.error_log.append({"file": "cash", "row": row, "error": str(e)})
                continue

            ba = _resolve_bank_account(ccy)
            if ba is None:
                drop.error_log.append({
                    "file": "cash", "row": row,
                    "error": f"No active BankAccount in organization for currency {ccy}",
                })
                continue

            fi = feed_import_by_ba.get(ba.id)
            if fi is None:
                fi = FeedImport.objects.create(
                    bank_account=ba,
                    source=c.SOURCE_AVALOQ_SFTP,
                    file_name=f"{drop.file_name}::cash",
                    status=c.FEED_PROCESSING,
                    started_at=timezone.now(),
                    imported_by=user,
                )
                feed_import_by_ba[ba.id] = fi

            external_id = ext_id or _dedup_key(ba.id, d, amount, desc)
            BankTransaction.objects.get_or_create(
                bank_account=ba,
                external_id=external_id,
                defaults={
                    "feed_import": fi,
                    "date": d,
                    "description": desc,
                    "original_description": desc,
                    "amount": amount,
                    "balance_after": balance_after,
                    "currency": ccy,
                },
            )
            # Count rows seen, not rows newly created. Re-posting a
            # statement should still report "10 cash movements".
            imported += 1

        # Close out the FeedImport rows.
        for fi in feed_import_by_ba.values():
            fi.status = c.FEED_COMPLETED
            fi.imported_rows = imported
            fi.total_rows = imported
            fi.completed_at = timezone.now()
            fi.save()

        # Pin the first FeedImport on the drop for traceability.
        if feed_import_by_ba:
            drop.cash_feed_import = next(iter(feed_import_by_ba.values()))
            drop.save(update_fields=["cash_feed_import"])

        return imported

    @staticmethod
    def _parse_securities(rows, *, organization, portfolio, drop, user):
        n = 0
        for row in rows:
            try:
                trade_date = _parse_date(row.get("trade_date"))
                ext_id = (row.get("external_trade_id") or "").strip()
                if not ext_id:
                    continue
                PortfolioTrade.objects.update_or_create(
                    organization=organization,
                    external_trade_id=ext_id,
                    defaults={
                        "portfolio": portfolio,
                        "custodian": drop.custodian,
                        "drop": drop,
                        "trade_date": trade_date,
                        "settlement_date": _parse_date_optional(row.get("settlement_date")),
                        "isin": (row.get("isin") or "").strip(),
                        "instrument_name": (row.get("instrument_name") or "").strip(),
                        "side": (row.get("side") or "").strip().upper(),
                        "quantity": _parse_decimal(row.get("quantity")),
                        "price": _parse_decimal(row.get("price")),
                        "gross_amount": _parse_decimal(row.get("gross_amount")),
                        "net_amount": _parse_decimal(row.get("net_amount")),
                        "fees": _parse_decimal_optional(row.get("fees")) or Decimal("0"),
                        "currency": (row.get("currency") or "").strip().upper(),
                        "raw_row": row,
                    },
                )
                n += 1
            except AvaloqFeedError as e:
                drop.error_log.append({"file": "securities", "row": row, "error": str(e)})
        return n

    @staticmethod
    def _parse_positions(rows, *, organization, portfolio, drop, user):
        n = 0
        for row in rows:
            try:
                as_of = _parse_date(row.get("as_of"))
                isin = (row.get("isin") or "").strip()
                if not isin:
                    continue
                PositionSnapshot.objects.update_or_create(
                    organization=organization,
                    portfolio=portfolio,
                    as_of=as_of,
                    isin=isin,
                    defaults={
                        "drop": drop,
                        "instrument_name": (row.get("instrument_name") or "").strip(),
                        "quantity": _parse_decimal(row.get("quantity")),
                        "market_value": _parse_decimal(row.get("market_value")),
                        "average_cost": _parse_decimal_optional(row.get("average_cost")),
                        "currency": (row.get("currency") or "").strip().upper(),
                        "raw_row": row,
                    },
                )
                n += 1
            except AvaloqFeedError as e:
                drop.error_log.append({"file": "positions", "row": row, "error": str(e)})
        return n

    @staticmethod
    def _parse_performance(rows, *, organization, portfolio, drop, user):
        n = 0
        for row in rows:
            try:
                as_of = _parse_date(row.get("as_of"))
                period = (row.get("period") or "").strip().upper()
                if not period:
                    continue
                PerformanceSnapshot.objects.update_or_create(
                    organization=organization,
                    portfolio=portfolio,
                    as_of=as_of,
                    period=period,
                    defaults={
                        "drop": drop,
                        "return_pct": _parse_decimal(row.get("return_pct")),
                        "return_amount": _parse_decimal_optional(row.get("return_amount")),
                        "currency": (row.get("currency") or "").strip().upper(),
                        "raw_row": row,
                    },
                )
                n += 1
            except AvaloqFeedError as e:
                drop.error_log.append({"file": "perf", "row": row, "error": str(e)})
        return n

    @staticmethod
    def _parse_orderbook(rows, *, organization, portfolio, drop, user):
        n = 0
        for row in rows:
            try:
                ext_id = (row.get("external_order_id") or "").strip()
                if not ext_id:
                    continue
                OpenOrder.objects.update_or_create(
                    organization=organization,
                    external_order_id=ext_id,
                    defaults={
                        "portfolio": portfolio,
                        "drop": drop,
                        "order_date": _parse_date(row.get("order_date")),
                        "isin": (row.get("isin") or "").strip(),
                        "instrument_name": (row.get("instrument_name") or "").strip(),
                        "side": (row.get("side") or "").strip().upper(),
                        "quantity": _parse_decimal(row.get("quantity")),
                        "limit_price": _parse_decimal_optional(row.get("limit_price")),
                        "currency": (row.get("currency") or "").strip().upper(),
                        "order_status": (row.get("order_status") or "OPEN").strip().upper(),
                        "raw_row": row,
                    },
                )
                n += 1
            except AvaloqFeedError as e:
                drop.error_log.append({"file": "orderbook", "row": row, "error": str(e)})
        return n

    @classmethod
    def _dispatch(cls, file_type, rows, **kwargs):
        if file_type == c.AVALOQ_FILE_CASH:
            return cls._parse_cash(rows, **kwargs)
        if file_type == c.AVALOQ_FILE_SECURITIES:
            return cls._parse_securities(rows, **kwargs)
        if file_type == c.AVALOQ_FILE_POSITIONS:
            return cls._parse_positions(rows, **kwargs)
        if file_type == c.AVALOQ_FILE_PERF:
            return cls._parse_performance(rows, **kwargs)
        if file_type == c.AVALOQ_FILE_ORDERBOOK:
            return cls._parse_orderbook(rows, **kwargs)
        return 0

    # ─── reconciliation ───

    @staticmethod
    def _reconcile_positions(drop: AvaloqFeedDrop, portfolio: Portfolio,
                             organization: Organization) -> int:
        """Compare position snapshot rows for this drop against the
        running TaxLot table for the same portfolio.

        - Sum bank quantity per ISIN from this drop's PositionSnapshot rows.
        - Sum Beakon quantity per ISIN from open TaxLot rows
          (lot_status != CLOSED).
        - Mismatches raise BREAK_QTY_MISMATCH or BREAK_UNKNOWN_ISIN.

        Returns the number of *new* break rows created in this run.
        """
        # Bank truth, from this drop only.
        bank_qty = {
            ps.isin: ps.quantity
            for ps in PositionSnapshot.objects.filter(drop=drop)
        }
        if not bank_qty:
            return 0  # No positions file in this zip — nothing to reconcile.

        # Beakon truth — sum open TaxLot remaining_quantity by instrument_code.
        beakon_qty_qs = (
            TaxLot.objects.filter(
                organization=organization,
                portfolio=portfolio,
            )
            .exclude(lot_status=TaxLot.STATUS_CLOSED)
            .values("instrument_code")
            .annotate(qty=Sum("remaining_quantity"))
        )
        beakon_qty = {
            row["instrument_code"]: row["qty"] or Decimal("0")
            for row in beakon_qty_qs
        }

        added = 0
        # Re-use existing breaks for this drop if we're re-running.
        drop.breaks.filter(break_type__in=[
            c.BREAK_QTY_MISMATCH, c.BREAK_UNKNOWN_ISIN,
        ]).delete()

        for isin, bqty in bank_qty.items():
            kqty = beakon_qty.get(isin)
            if kqty is None:
                cat, suggestion = _classify_unknown_isin(
                    organization, portfolio, isin, drop.business_date,
                )
                ReconciliationBreak.objects.create(
                    drop=drop, portfolio=portfolio,
                    break_type=c.BREAK_UNKNOWN_ISIN,
                    category=cat,
                    isin=isin,
                    bank_value=str(bqty),
                    beakon_value="0 (no holding on file)",
                    detail=f"Per custodian: {bqty} shares of {isin}. "
                           f"Per ledger: no open holding under "
                           f"portfolio {portfolio.portfolio_id}.",
                    suggested_resolution=suggestion,
                )
                added += 1
                continue
            if Decimal(bqty) != Decimal(kqty):
                cat, suggestion = _classify_qty_mismatch(
                    organization, portfolio, isin,
                    Decimal(bqty), Decimal(kqty), drop.business_date,
                )
                ReconciliationBreak.objects.create(
                    drop=drop, portfolio=portfolio,
                    break_type=c.BREAK_QTY_MISMATCH,
                    category=cat,
                    isin=isin,
                    bank_value=str(bqty),
                    beakon_value=str(kqty),
                    detail=f"Per custodian: {bqty} shares of {isin}. "
                           f"Per ledger: {kqty} shares. "
                           f"Difference: {Decimal(bqty) - Decimal(kqty)}.",
                    suggested_resolution=suggestion,
                )
                added += 1

        # ISINs Beakon has but bank doesn't show — also a break.
        for isin, kqty in beakon_qty.items():
            if isin not in bank_qty and kqty:
                cat, suggestion = _classify_qty_mismatch(
                    organization, portfolio, isin,
                    Decimal("0"), Decimal(kqty), drop.business_date,
                )
                ReconciliationBreak.objects.create(
                    drop=drop, portfolio=portfolio,
                    break_type=c.BREAK_QTY_MISMATCH,
                    category=cat,
                    isin=isin,
                    bank_value="0 (not in statement)",
                    beakon_value=str(kqty),
                    detail=f"Per ledger: {kqty} shares of {isin}. "
                           f"Per custodian: not on the holdings statement. "
                           f"The position was either sold or moved to "
                           f"another custodian.",
                    suggested_resolution=suggestion,
                )
                added += 1

        return added


# ─── module-level helpers ─────────────────────────────────────────────────


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _extract_prefix(zip_filename: str) -> str:
    m = _OUTER_FILENAME.match(zip_filename)
    if m:
        return m.group("prefix")
    # Fallback: strip suffix.
    return Path(zip_filename).stem


def _parse_business_date(zip_filename: str) -> dt_date:
    m = _OUTER_FILENAME.match(zip_filename)
    if m:
        return dt_date.fromisoformat(m.group("date"))
    raise AvaloqFeedError(
        f"Cannot extract business date from filename {zip_filename!r} — "
        f"expected '<prefix>_YYYY-MM-DD.zip'."
    )


def _parse_date(raw) -> dt_date:
    s = str(raw or "").strip()
    if not s:
        raise AvaloqFeedError("date is empty")
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError as e:
        raise AvaloqFeedError(f"cannot parse date {raw!r}") from e


def _parse_date_optional(raw):
    if raw is None or str(raw).strip() == "":
        return None
    return _parse_date(raw)


def _parse_decimal(raw) -> Decimal:
    s = str(raw if raw is not None else "").strip()
    if not s:
        raise AvaloqFeedError("amount is empty")
    s = s.replace(",", "").replace(" ", "")
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError) as e:
        raise AvaloqFeedError(f"cannot parse decimal {raw!r}") from e


def _parse_decimal_optional(raw):
    if raw is None or str(raw).strip() == "":
        return None
    return _parse_decimal(raw)


# ─── break classifier ────────────────────────────────────────────────────


def _classify_unknown_isin(organization, portfolio, isin, business_date):
    """An ISIN appears in the bank statement but Beakon has no open
    holding for it. Most likely causes, in order:

    1. **Missing trade** — we never booked the buy. The fix is in our
       court (post the trade, then the holding will exist).
    2. **Corporate action** — a stock split or scrip dividend created
       the new ISIN at the bank. Detected by *no trade history at all*
       for any ISIN under this portfolio in the last 30 BD plus the
       fact we have *some* holdings already, suggesting the portfolio
       isn't brand-new.

    No corporate-action calendar in v1, so corp-action detection is
    deliberately conservative — when the heuristic isn't confident we
    fall back to ``missing_trade`` which is both more common and
    actionable.
    """
    has_recent_trade = PortfolioTrade.objects.filter(
        organization=organization,
        portfolio=portfolio,
        isin=isin,
    ).exists()
    if has_recent_trade:
        return (
            c.BREAK_CAT_TIMING,
            "Trade booked on this ISIN; difference likely settles within "
            "the next two business days.",
        )
    return (
        c.BREAK_CAT_MISSING_TRADE,
        f"No trade on file for {isin}. Either book the missing buy or "
        f"ask the custodian why this position appears on the statement.",
    )


def _classify_qty_mismatch(organization, portfolio, isin,
                           bank_qty: Decimal, beakon_qty: Decimal,
                           business_date) -> tuple[str, str]:
    """Bank and ledger both have the ISIN but quantities differ.

    Decision tree:
    - We have a trade for this ISIN in the last 2 business days that
      mathematically explains the gap → ``timing``.
    - We have *any* trade for this ISIN in the last 30 BD but it
      doesn't explain the gap → ``true_error``.
    - The ratio (bank / beakon) matches a clean integer split (e.g.
      1:2, 1:3, 3:1) → ``corp_action``.
    - Else → ``unknown``.
    """
    delta = bank_qty - beakon_qty

    # Recent-trade reconciliation
    recent = PortfolioTrade.objects.filter(
        organization=organization, portfolio=portfolio, isin=isin,
    ).order_by("-trade_date")[:5]

    for t in recent:
        bd_age = (business_date - t.trade_date).days
        if bd_age <= TIMING_BREAK_BD_WINDOW:
            # If the trade direction + size mathematically explains the gap
            signed_qty = t.quantity if t.side == "BUY" else -t.quantity
            if (beakon_qty + signed_qty) == bank_qty:
                return (
                    c.BREAK_CAT_TIMING,
                    f"Trade {t.external_trade_id} ({t.side} {t.quantity}) "
                    f"on {t.trade_date.isoformat()} explains the gap. "
                    f"Settlement T+2 — break should clear by "
                    f"{(t.trade_date + timedelta(days=4)).isoformat()}.",
                )

    if recent.exists():
        return (
            c.BREAK_CAT_TRUE_ERROR,
            "Recent trade history exists for this ISIN but does not "
            "mathematically explain the difference — investigate.",
        )

    # Corporate-action heuristic — clean integer split ratio
    if beakon_qty > 0 and bank_qty > 0:
        ratio_b_to_l = bank_qty / beakon_qty
        ratio_l_to_b = beakon_qty / bank_qty
        for r in (ratio_b_to_l, ratio_l_to_b):
            for n in (2, 3, 4, 5, 10):
                if abs(r - Decimal(n)) < Decimal("0.001"):
                    return (
                        c.BREAK_CAT_CORP_ACTION,
                        f"Quantity ratio is ~1:{n} — looks like a stock "
                        f"split or scrip dividend. Confirm against the "
                        f"corporate-action calendar before posting.",
                    )

    return (
        c.BREAK_CAT_UNKNOWN,
        f"Holding differs by {abs(delta)} but no trade history and no "
        f"recognisable split ratio — needs a human review.",
    )


# ─── post-ingest file lifecycle ───────────────────────────────────────────

def archive_zip(zip_path: Path, drop: AvaloqFeedDrop, archive_root: Path) -> Path:
    """Move a successfully-ingested zip into ``archive_root/<business_date>/``.

    Idempotent: if the zip is already gone from ``zip_path`` and
    ``drop.archive_path`` is set, returns the recorded destination. If a
    file with the same name already exists at the destination (re-ingest
    after manual replay), the existing file is left in place and the
    source zip is removed.
    """
    zip_path = Path(zip_path)
    archive_root = Path(archive_root)
    target_dir = archive_root / drop.business_date.isoformat()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / zip_path.name

    if not zip_path.exists():
        # Already moved on a prior run.
        if drop.archive_path:
            return Path(drop.archive_path)
        return target

    if target.exists():
        # Destination already populated — drop the duplicate at source.
        zip_path.unlink()
    else:
        shutil.move(str(zip_path), str(target))

    drop.archive_path = str(target)
    drop.save(update_fields=["archive_path"])
    return target


def quarantine_zip(zip_path: Path, drop: AvaloqFeedDrop, quarantine_root: Path) -> Path:
    """Move a failed-ingest zip into ``quarantine_root/`` for operator review.

    Quarantined files are not sorted by date — they sit in a single
    directory where an operator can see them all at once. Failure mode
    matters more than calendar grouping here.
    """
    zip_path = Path(zip_path)
    quarantine_root = Path(quarantine_root)
    quarantine_root.mkdir(parents=True, exist_ok=True)
    target = quarantine_root / zip_path.name

    if not zip_path.exists():
        if drop.archive_path:
            return Path(drop.archive_path)
        return target

    if target.exists():
        # Two failures in a row on the same filename — append a counter.
        stem, suffix = target.stem, target.suffix
        i = 1
        while (quarantine_root / f"{stem}.{i}{suffix}").exists():
            i += 1
        target = quarantine_root / f"{stem}.{i}{suffix}"

    shutil.move(str(zip_path), str(target))
    drop.archive_path = str(target)
    drop.save(update_fields=["archive_path"])
    return target


def _result(drop, prefix, errors) -> IngestResult:
    return IngestResult(
        drop_id=drop.id,
        portfolio_id=prefix,
        business_date=drop.business_date.isoformat(),
        status=drop.status,
        file_counts=drop.file_counts or {},
        breaks=drop.breaks.count(),
        errors=errors,
    )
