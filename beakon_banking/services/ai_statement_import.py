"""AIBankStatementImportService — turn a bank statement (PDF, CSV, image)
into draft BankTransaction rows the user can review + commit.

Mirrors AICoAImportService and AIBillDraftingService:
    preview(file)   -> list of {date, description, amount, balance_after?, currency?}
    commit(rows)    -> BankTransaction rows + FeedImport audit row

The preview is read-only. The user reviews/edits in the UI; commit
writes via the same dedup pipeline as CSVImporter so re-uploading the
same statement doesn't create duplicates.

For PDF input we send the raw PDF bytes to Claude as a `document`
content block — Claude reads native PDFs (text + scanned). For CSV/TXT
we send the decoded text. Image files (.jpg/.png screenshots of a
statement page) are sent as `image` blocks.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
from datetime import date as dt_date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .. import constants as c
from ..exceptions import CSVParseError
from ..models import BankAccount, BankTransaction, FeedImport
from .importer import _dedup_key, _normalize_desc


# Anthropic tool schema. Strict so the model can't drift on date/amount.
_STMT_TOOL = {
    "name": "extract_bank_transactions",
    "description": (
        "Return every transaction from the uploaded bank statement. "
        "Sign convention: positive amount = deposit/credit (money IN to "
        "the account); negative = withdrawal/debit (money OUT). If the "
        "statement uses a separate Debit and Credit column, combine them "
        "into one signed amount."
    ),
    "input_schema": {
        "type": "object",
        "required": ["transactions"],
        "properties": {
            "statement_period_start": {"type": ["string", "null"]},
            "statement_period_end":   {"type": ["string", "null"]},
            "account_iban":           {"type": ["string", "null"]},
            "currency":               {"type": ["string", "null"]},
            "opening_balance":        {"type": ["string", "null"]},
            "closing_balance":        {"type": ["string", "null"]},
            "transactions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["date", "description", "amount"],
                    "properties": {
                        "date": {
                            "type": "string",
                            "description": "YYYY-MM-DD (ISO date)",
                        },
                        "description": {"type": "string"},
                        "amount": {
                            "type": "string",
                            "description": (
                                "Signed decimal as string, e.g. '125.50' "
                                "for a deposit or '-89.00' for a debit."
                            ),
                        },
                        "balance_after": {"type": ["string", "null"]},
                        "currency": {"type": ["string", "null"]},
                    },
                },
            },
        },
    },
}


class AIBankStatementImportService:
    @staticmethod
    def preview(
        *, bank_account: BankAccount, file_bytes: bytes,
        content_type: str, filename: str,
    ) -> dict:
        """Send the file to Claude, return structured preview JSON."""
        result = _ask_claude(
            file_bytes=file_bytes,
            content_type=content_type,
            filename=filename,
            account_currency=bank_account.currency,
        )
        # Mark already-imported (dedup) so the UI can warn on duplicates.
        existing = set(
            BankTransaction.objects
            .filter(bank_account=bank_account)
            .values_list("external_id", flat=True)
        )
        for txn in result.get("transactions", []):
            try:
                d = datetime.strptime(str(txn["date"]), "%Y-%m-%d").date()
                amt = Decimal(str(txn["amount"]))
            except (KeyError, ValueError, InvalidOperation):
                txn["dedup_match"] = False
                continue
            key = _dedup_key(bank_account.id, d, amt, txn.get("description") or "")
            txn["dedup_match"] = key in existing
        result["filename"] = filename
        return result

    @staticmethod
    @transaction.atomic
    def commit(
        *, bank_account: BankAccount, rows: list[dict], filename: str = "",
        user=None,
    ) -> dict:
        """Write reviewed rows as BankTransaction records.

        Skips rows whose dedup key already exists (idempotent re-imports).
        Records a FeedImport row for the audit trail.
        """
        feed = FeedImport.objects.create(
            bank_account=bank_account,
            source=c.SOURCE_AI,
            file_name=filename or "ai-statement",
            status=c.FEED_PROCESSING,
            started_at=timezone.now(),
            imported_by=user,
        )
        existing = set(
            BankTransaction.objects
            .filter(bank_account=bank_account)
            .values_list("external_id", flat=True)
        )
        imported = 0
        duplicates = 0
        errors: list[dict] = []

        for idx, row in enumerate(rows, start=1):
            try:
                d = datetime.strptime(str(row["date"]).strip(), "%Y-%m-%d").date()
                amt = Decimal(str(row["amount"]).strip())
                desc = (row.get("description") or "").strip()
                if not desc:
                    raise ValueError("empty description")
                bal = row.get("balance_after")
                bal_dec = Decimal(str(bal)) if bal not in (None, "") else None
            except (KeyError, ValueError, InvalidOperation) as e:
                errors.append({"row": idx, "error": str(e)})
                continue
            key = _dedup_key(bank_account.id, d, amt, desc)
            if key in existing:
                duplicates += 1
                continue
            BankTransaction.objects.create(
                bank_account=bank_account,
                feed_import=feed,
                external_id=key,
                date=d,
                description=desc,
                original_description=desc,
                amount=amt,
                balance_after=bal_dec,
                currency=(row.get("currency") or bank_account.currency or "").upper(),
                status=c.TXN_NEW,
                is_duplicate=False,
            )
            existing.add(key)
            imported += 1

        feed.total_rows = len(rows)
        feed.imported_rows = imported
        feed.duplicate_rows = duplicates
        feed.error_rows = len(errors)
        feed.error_log = errors
        feed.status = c.FEED_FAILED if errors and imported == 0 else c.FEED_COMPLETED
        feed.completed_at = timezone.now()
        feed.save()
        return {
            "feed_import_id": feed.id,
            "imported": imported,
            "duplicates": duplicates,
            "errors": errors,
        }


# ── Claude wiring ────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are a precise bookkeeping assistant. The user
uploaded a bank statement. Extract every transaction line.

Rules:
- Use the bank's posting/value date (YYYY-MM-DD).
- Keep the description exactly as it appears (don't paraphrase).
- Combine separate debit/credit columns into ONE signed amount:
    deposit / credit   -> positive
    withdrawal / debit -> negative
- If the statement currency is not given, default to {currency}.
- If the statement has running balance, capture it as balance_after.
- IGNORE summary rows, page footers, "opening balance" / "closing
  balance" rows — those are statement metadata, not transactions.
- Capture statement_period_start, statement_period_end, opening_balance,
  closing_balance, and account_iban when visible.

Then call extract_bank_transactions with the structured data.
"""


def _ask_claude(
    *, file_bytes: bytes, content_type: str, filename: str,
    account_currency: str,
) -> dict:
    try:
        import anthropic
    except ImportError as exc:
        raise CSVParseError(
            "anthropic SDK is required for AI statement import.",
            code=c.ERR_AI_PARSE,
        ) from exc
    api_key = settings.ANTHROPIC_API_KEY or None
    if not api_key:
        raise CSVParseError(
            "ANTHROPIC_API_KEY is not configured.",
            code=c.ERR_AI_PARSE,
        )
    client = anthropic.Anthropic(api_key=api_key)
    model = getattr(settings, "CLAUDE_OCR_MODEL", "claude-haiku-4-5")

    name_lower = (filename or "").lower()
    is_pdf = "pdf" in (content_type or "") or name_lower.endswith(".pdf")
    is_image = (content_type or "").startswith("image/") or any(
        name_lower.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp")
    )

    if is_pdf:
        content_block = {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.b64encode(file_bytes).decode("ascii"),
            },
        }
    elif is_image:
        media = content_type or "image/png"
        if not media.startswith("image/"):
            media = "image/png"
        content_block = {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media,
                "data": base64.b64encode(file_bytes).decode("ascii"),
            },
        }
    else:
        # CSV / TXT / unknown — decode as text and send as a fenced block.
        try:
            text = file_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = file_bytes.decode("latin-1", errors="replace")
        # Cap to avoid huge prompts; bank statements rarely exceed 200 KB.
        text = text[:200_000]
        content_block = {
            "type": "text",
            "text": f"Bank statement contents:\n```\n{text}\n```",
        }

    user_content = [
        content_block,
        {
            "type": "text",
            "text": (
                "Read the bank statement above and call "
                "extract_bank_transactions with one row per transaction."
            ),
        },
    ]
    system = _SYSTEM_PROMPT.format(currency=account_currency or "")
    try:
        message = client.messages.create(
            model=model,
            max_tokens=16000,
            system=system,
            tools=[_STMT_TOOL],
            tool_choice={"type": "tool", "name": "extract_bank_transactions"},
            messages=[{"role": "user", "content": user_content}],
        )
    except anthropic.AuthenticationError as e:
        raise CSVParseError(
            "ANTHROPIC_API_KEY is invalid or revoked.",
            code=c.ERR_AI_PARSE,
        ) from e
    except anthropic.APIError as e:
        raise CSVParseError(
            f"Claude API error: {e}",
            code=c.ERR_AI_PARSE,
        ) from e

    tool_use = next(
        (b for b in message.content if getattr(b, "type", None) == "tool_use"),
        None,
    )
    if tool_use is None:
        raise CSVParseError(
            f"Claude did not call extract_bank_transactions; "
            f"stop_reason={message.stop_reason}.",
            code=c.ERR_AI_PARSE,
        )
    return dict(tool_use.input)
