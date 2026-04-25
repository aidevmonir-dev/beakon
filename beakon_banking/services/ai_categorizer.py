"""AI-powered categorization for bank transactions.

For an uncategorised BankTransaction, send the description + amount + the
relevant slice of the entity's COA to the local Ollama text model and get
back a suggested offset account.

Same privacy stance as the rest of Beakon's AI: nothing leaves the local
machine. Same "AI never posts" rule: this returns a *suggestion* — the
draft JE only gets created when the user (or signer) clicks confirm in
the existing Categorizer flow.

Output schema (JSON, enforced via Ollama format=json):
    {
      "suggested_account_id": int,    # one of the COA ids passed in
      "suggested_account_code": str,  # for sanity/UX echo
      "reasoning": str,               # one short sentence
      "confidence": float             # 0.0 – 1.0
    }
"""
import json
import re
from decimal import Decimal
from typing import Optional

import requests
from django.conf import settings
from django.db.models import Q

from beakon_core.exceptions import ValidationError
from beakon_core.models import Account

from ..models import BankTransaction


# COA filter — accounts the AI is allowed to suggest. Bank txns book to
# expense, revenue, or current-asset/liability typically — so we exclude
# pure equity/COGS-only edge cases. Bank/cash subtypes are excluded too
# because they're already on the OTHER side of the JE.
_PROMPT_DEBIT_TYPES = ("expense", "revenue", "asset", "liability")
_EXCLUDED_SUBTYPES = ("bank", "cash", "fx_gain", "fx_loss")
MAX_COA_ROWS = 60


_PROMPT = """You are a bookkeeping assistant choosing the OFFSET account for a single bank transaction.

The bank account itself is one side of the journal entry. You must pick the OTHER side from the chart of accounts below.

Rules:
1. **Sign convention**: a NEGATIVE amount means money LEFT the bank (a payment / withdrawal). A POSITIVE amount means money came IN (deposit / receipt).
2. For payments (negative amount), the offset is usually an expense account or a liability/payable being settled.
3. For deposits (positive amount), the offset is usually a revenue account or a receivable being collected.
4. Suggest the SINGLE most likely account by ID. The ID must come from the chart of accounts list — DO NOT invent an ID.
5. Output ONLY valid JSON with exactly these keys:
   {{
     "suggested_account_id": int,
     "suggested_account_code": "string (the matching account code)",
     "reasoning": "one short sentence (under 80 characters)",
     "confidence": float between 0.0 and 1.0
   }}
6. No markdown fences. No preamble. JSON only.

# Transaction
- Date: {date}
- Description: "{description}"
- Amount: {signed_amount} {currency}  (negative = withdrawal, positive = deposit)
- Bank account on the other side: {bank_code} · {bank_name}

# Chart of accounts (pick suggested_account_id from this list)
{coa_json}
"""


def _coa_rows(entity) -> list[dict]:
    qs = (
        Account.objects
        .filter(
            organization=entity.organization,
            is_active=True,
            account_type__in=_PROMPT_DEBIT_TYPES,
        )
        .filter(Q(entity=entity) | Q(entity__isnull=True))
        .exclude(account_subtype__in=_EXCLUDED_SUBTYPES)
        .order_by("code")
        .values("id", "code", "name", "account_type", "account_subtype")
        [:MAX_COA_ROWS]
    )
    return list(qs)


class AIBankCategorizer:
    @staticmethod
    def suggest(txn: BankTransaction) -> dict:
        """Return ``{suggested_account, account_id, code, reasoning, confidence}``
        or raise ValidationError on transport / model issues."""
        ba = txn.bank_account
        coa = _coa_rows(ba.entity)
        if not coa:
            raise ValidationError(
                "No COA accounts available for AI categorization on this entity.",
                code="BNK001",
            )

        prompt = _PROMPT.format(
            date=txn.date,
            description=(txn.description or "").replace('"', "'")[:300],
            signed_amount=str(txn.amount),
            currency=ba.currency,
            bank_code=ba.account.code,
            bank_name=ba.account.name,
            coa_json=json.dumps(coa, indent=2),
        )

        url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
        # Use the OCR text model (qwen2.5:1.5b is good for short JSON-formatted
        # extraction tasks). Falls back to the chat model if not configured.
        model = settings.OLLAMA_TEXT_MODEL
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "format": "json",
            "keep_alive": "30m",
            "options": {
                "temperature": 0.1,
                "num_predict": 200,
                "num_ctx": 4096,
            },
        }
        try:
            resp = requests.post(
                url, json=payload, timeout=settings.OLLAMA_TIMEOUT_SECONDS,
            )
        except requests.RequestException as e:
            raise ValidationError(
                f"Could not reach Ollama at {settings.OLLAMA_BASE_URL}: {e}",
                code="BNK002",
            )
        if resp.status_code == 404:
            raise ValidationError(
                f"Model '{model}' not pulled. Run: ollama pull {model}",
                code="BNK003",
            )
        if resp.status_code != 200:
            raise ValidationError(
                f"Ollama returned {resp.status_code}: {resp.text[:200]}",
                code="BNK004",
            )

        body = resp.json()
        raw = body.get("message", {}).get("content", "")
        cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(),
                         flags=re.MULTILINE).strip()
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise ValidationError(
                f"Ollama returned non-JSON: {e}",
                code="BNK005", details={"raw": cleaned[:500]},
            )

        # Validate the suggestion: account_id must be in the COA we sent.
        sid = parsed.get("suggested_account_id")
        try:
            sid = int(sid) if sid is not None else None
        except (ValueError, TypeError):
            sid = None
        valid_ids = {row["id"] for row in coa}
        if sid not in valid_ids:
            raise ValidationError(
                f"AI suggested an account_id ({sid}) that isn't in the "
                f"COA we sent. Try again or pick manually.",
                code="BNK006",
                details={"suggested_id": sid, "raw_response": parsed},
            )

        try:
            account = Account.objects.get(pk=sid)
        except Account.DoesNotExist:
            raise ValidationError("Suggested account vanished.", code="BNK007")

        try:
            confidence = float(parsed.get("confidence") or 0.0)
        except (ValueError, TypeError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))

        return {
            "account": account,
            "account_id": account.id,
            "account_code": account.code,
            "account_name": account.name,
            "account_type": account.account_type,
            "account_subtype": account.account_subtype,
            "reasoning": (parsed.get("reasoning") or "")[:200],
            "confidence": confidence,
            "model_used": model,
        }
