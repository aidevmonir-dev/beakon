"""CSV import pipeline for the beakon banking feeder.

Takes a user-uploaded CSV + column mapping, produces BankTransaction rows.
SHA1 dedup on (bank_account, date, amount, normalized description) keeps
re-imports idempotent. All txns land in status ``new`` — the Categorizer
moves them forward.
"""
import csv
import hashlib
import io
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from .. import constants as c
from ..exceptions import CSVParseError
from ..models import BankTransaction, FeedImport


_NOISE = re.compile(r"\s+")


def _normalize_desc(s: str) -> str:
    return _NOISE.sub(" ", (s or "").strip().upper())


def _dedup_key(bank_account_id, date, amount, description):
    raw = f"{bank_account_id}|{date.isoformat()}|{amount}|{_normalize_desc(description)}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _parse_decimal(raw):
    if raw is None:
        raise CSVParseError("amount is empty", code=c.ERR_INVALID_AMOUNT)
    s = str(raw).strip()
    if not s:
        raise CSVParseError("amount is empty", code=c.ERR_INVALID_AMOUNT)
    negative = s.startswith("(") and s.endswith(")")
    if negative:
        s = s[1:-1]
    s = s.replace("$", "").replace("£", "").replace("€", "")
    s = s.replace(",", "").replace(" ", "")
    try:
        val = Decimal(s)
    except (InvalidOperation, ValueError) as e:
        raise CSVParseError(f"cannot parse amount {raw!r}", code=c.ERR_INVALID_AMOUNT) from e
    return -val if negative else val


def _parse_date(raw, fmt):
    s = str(raw or "").strip()
    if not s:
        raise CSVParseError("date is empty", code=c.ERR_INVALID_DATE)
    try:
        return datetime.strptime(s, fmt).date()
    except ValueError as e:
        raise CSVParseError(
            f"cannot parse date {raw!r} with format {fmt!r}",
            code=c.ERR_INVALID_DATE,
        ) from e


class CSVImporter:
    """Parse a CSV file into BankTransaction rows.

    ``column_mapping`` is a dict of {"date": 0, "description": 1, "amount": 3,
    "balance": 4 (optional)}. Missing required columns raise at import time.
    """

    def __init__(self, bank_account, column_mapping, date_format="%Y-%m-%d",
                 has_header=True):
        for required in ("date", "description", "amount"):
            if required not in column_mapping:
                raise CSVParseError(
                    f"column_mapping missing required key '{required}'",
                    code=c.ERR_MISSING_COLUMN,
                )
        self.bank_account = bank_account
        self.mapping = column_mapping
        self.date_format = date_format
        self.has_header = has_header

    @transaction.atomic
    def run(self, *, file_bytes: bytes, file_name: str, user=None):
        feed = FeedImport.objects.create(
            bank_account=self.bank_account,
            source=c.SOURCE_CSV,
            file_name=file_name or "upload.csv",
            status=c.FEED_PROCESSING,
            started_at=timezone.now(),
            imported_by=user,
        )

        try:
            text = file_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = file_bytes.decode("latin-1")
        rows = list(csv.reader(io.StringIO(text)))
        if self.has_header and rows:
            rows = rows[1:]

        feed.total_rows = len(rows)
        existing_keys = set(
            BankTransaction.objects.filter(bank_account=self.bank_account)
            .values_list("external_id", flat=True)
        )

        errors = []
        imported = 0
        duplicates = 0

        for idx, row in enumerate(rows, start=2 if self.has_header else 1):
            try:
                date = _parse_date(row[self.mapping["date"]], self.date_format)
                description = str(row[self.mapping["description"]]).strip()
                amount = _parse_decimal(row[self.mapping["amount"]])
                balance = None
                if "balance" in self.mapping and self.mapping["balance"] < len(row):
                    try:
                        balance = _parse_decimal(row[self.mapping["balance"]])
                    except CSVParseError:
                        balance = None
            except (CSVParseError, IndexError, KeyError) as e:
                errors.append({"row": idx, "error": str(e)})
                continue

            key = _dedup_key(self.bank_account.id, date, amount, description)
            if key in existing_keys:
                # Already imported — count and skip. Keeps the txn list
                # clean; the feed counters still report what the user uploaded.
                duplicates += 1
                continue

            BankTransaction.objects.create(
                bank_account=self.bank_account,
                feed_import=feed,
                external_id=key,
                date=date,
                description=description,
                original_description=description,
                amount=amount,
                balance_after=balance,
                currency=self.bank_account.currency,
                status=c.TXN_NEW,
                is_duplicate=False,
            )
            existing_keys.add(key)
            imported += 1

        feed.imported_rows = imported
        feed.duplicate_rows = duplicates
        feed.error_rows = len(errors)
        feed.error_log = errors
        feed.status = (
            c.FEED_FAILED if (errors and imported == 0) else c.FEED_COMPLETED
        )
        feed.completed_at = timezone.now()
        feed.save()
        return feed
