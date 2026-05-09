"""AI-powered categorization for bank transactions.

For an uncategorised BankTransaction, send the description + amount + the
relevant slice of the entity's COA to an LLM and get back a suggested
offset account. Two backends behind the same shared validation:

  * **Ollama** (default, ``OCR_BACKEND=ollama``) — local, free, runs on
    qwen2.5:3b. Privacy-first, decent on clear memos.
  * **Claude API** (``OCR_BACKEND=claude``) — Anthropic's Haiku/Sonnet/
    Opus via tool-use. Materially better on cryptic memos at the cost
    of $0.001-ish per call. Uses the same ``ANTHROPIC_API_KEY`` and
    ``CLAUDE_OCR_MODEL`` env vars as the OCR backend, so flipping
    ``OCR_BACKEND`` switches both bill OCR and bank categorization
    in one shot.

Same "AI never posts" rule applies: this returns a *suggestion* — the
draft JE only gets created when the user (or signer) clicks confirm
in the Categorizer flow.

Output schema (enforced via Ollama format=json or Claude tool input
schema, depending on backend):
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
from beakon_core.services.anthropic_throttle import (
    claude_throttle, raise_friendly_rate_limit,
)

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


_CATEGORIZER_TOOL = {
    "name": "suggest_offset_account",
    "description": (
        "Record the chosen offset (the OTHER side of the bank-side JE) "
        "for this bank transaction. Call exactly once."
    ),
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "suggested_account_id": {
                "type": "integer",
                "description": "Must be one of the IDs from the chart of accounts list provided.",
            },
            "suggested_account_code": {
                "type": "string",
                "description": "The account code matching suggested_account_id, for UX echo.",
            },
            "reasoning": {
                "type": "string",
                "description": "One short sentence under 80 characters explaining the choice.",
            },
            "confidence": {
                "type": "number",
                "description": "0.0 to 1.0 confidence in the suggestion.",
            },
        },
        "required": [
            "suggested_account_id", "suggested_account_code",
            "reasoning", "confidence",
        ],
    },
}


def _use_claude() -> bool:
    return getattr(settings, "OCR_BACKEND", "ollama").lower() == "claude"


def _suggest_via_ollama(prompt: str) -> tuple[dict, str]:
    """Send the rendered prompt to Ollama, return ``(parsed_json, model_used)``."""
    url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
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
        return json.loads(cleaned), model
    except json.JSONDecodeError as e:
        raise ValidationError(
            f"Ollama returned non-JSON: {e}",
            code="BNK005", details={"raw": cleaned[:500]},
        )


def _suggest_via_claude(coa: list, txn: BankTransaction) -> tuple[dict, str]:
    """Call Claude API with tool-use for structured JSON output. Same
    prompt rules as Ollama, but the schema is enforced by the tool's
    input_schema rather than format=json."""
    import anthropic

    api_key = settings.ANTHROPIC_API_KEY or None
    if not api_key:
        raise ValidationError(
            "OCR_BACKEND=claude requires ANTHROPIC_API_KEY to be set.",
            code="BNK008",
        )

    ba = txn.bank_account
    user_text = (
        f"Transaction:\n"
        f"- Date: {txn.date}\n"
        f"- Description: \"{(txn.description or '').replace(chr(34), chr(39))[:300]}\"\n"
        f"- Amount: {txn.amount} {ba.currency}  "
        f"(negative = withdrawal, positive = deposit)\n"
        f"- Bank account on the other side: "
        f"{ba.account.code} · {ba.account.name}\n\n"
        f"Chart of accounts (suggested_account_id MUST be one of these IDs):\n"
        f"{json.dumps(coa, indent=2)}"
    )

    # System prompt is stable across all transactions for this org —
    # cache_control gets a 5-minute reuse window. The COA is in the user
    # message and varies per call (different entity / different state),
    # so we don't try to cache it.
    client = anthropic.Anthropic(api_key=api_key)
    model = settings.CLAUDE_OCR_MODEL
    kwargs = {
        "model": model,
        "max_tokens": 1024,
        "system": [{
            "type": "text",
            "text": _PROMPT_HEADER_CLAUDE,
            "cache_control": {"type": "ephemeral"},
        }],
        "tools": [_CATEGORIZER_TOOL],
        "tool_choice": {"type": "tool", "name": "suggest_offset_account"},
        "messages": [{"role": "user", "content": user_text}],
    }
    # Adaptive thinking is supported on Opus 4.6/4.7 + Sonnet 4.6 but
    # not Haiku 4.5 (would 400). Categorization is structured enough
    # that thinking is not load-bearing on Haiku anyway.
    if not model.startswith("claude-haiku"):
        kwargs["thinking"] = {"type": "adaptive"}

    claude_throttle()
    try:
        message = client.messages.create(**kwargs)
    except anthropic.AuthenticationError:
        raise ValidationError(
            "ANTHROPIC_API_KEY is invalid or revoked.",
            code="BNK009",
        )
    except anthropic.RateLimitError as e:
        raise_friendly_rate_limit(e, code="BNK010_RATE_LIMIT")
    except anthropic.APIError as e:
        raise ValidationError(
            f"Claude API error: {e}",
            code="BNK010",
            details={"error": str(e)},
        )

    tool_use = next(
        (b for b in message.content if getattr(b, "type", None) == "tool_use"),
        None,
    )
    if tool_use is None:
        raise ValidationError(
            f"Claude did not call the suggest_offset_account tool; "
            f"stop_reason={message.stop_reason}.",
            code="BNK011",
            details={"stop_reason": str(message.stop_reason)},
        )
    return dict(tool_use.input), model


_PROMPT_HEADER_CLAUDE = """You are a bookkeeping assistant choosing the OFFSET account for a single bank transaction.

The bank account itself is one side of the journal entry. You must pick the OTHER side from the chart of accounts the user provides.

Rules:
1. **Sign convention**: a NEGATIVE amount means money LEFT the bank (a payment / withdrawal). A POSITIVE amount means money came IN (deposit / receipt).
2. For payments (negative amount), the offset is usually an expense account or a liability/payable being settled.
3. For deposits (positive amount), the offset is usually a revenue account or a receivable being collected.
4. Pick the SINGLE most likely account. Its ID must come from the chart of accounts list — do NOT invent an ID.
5. Record your answer by calling the suggest_offset_account tool. The tool's schema enforces the JSON shape — your job is to fill it accurately."""


class AIBankCategorizer:
    @staticmethod
    def suggest(txn: BankTransaction) -> dict:
        """Return ``{account, account_id, code, reasoning, confidence,
        model_used}`` or raise ValidationError on transport / model issues.

        Engine selection (cheapest first):
            1. **MLBankCategorizer** — if a trained model exists for this
               entity AND it's confident enough (>= HIGH_CONFIDENCE_THRESHOLD),
               return the ML pick directly. Sub-ms inference, no LLM cost.
            2. **Claude** — when ASK/OCR backend is set to claude.
            3. **Ollama** — local fallback.
        """
        ba = txn.bank_account
        coa = _coa_rows(ba.entity)
        if not coa:
            raise ValidationError(
                "No COA accounts available for AI categorization on this entity.",
                code="BNK001",
            )

        # ── ML fast-path ────────────────────────────────────────────
        # If a trained logreg exists for this entity and it's decisive,
        # skip the LLM call entirely. Low-confidence ML picks fall
        # through to the LLM so the user gets a second opinion on the
        # transactions the model isn't sure about.
        from .ml_categorizer import MLBankCategorizer, HIGH_CONFIDENCE_THRESHOLD
        ml_result = MLBankCategorizer.suggest(txn)
        if ml_result and ml_result["confidence"] >= HIGH_CONFIDENCE_THRESHOLD:
            return ml_result

        if _use_claude():
            parsed, model = _suggest_via_claude(coa, txn)
        else:
            prompt = _PROMPT.format(
                date=txn.date,
                description=(txn.description or "").replace('"', "'")[:300],
                signed_amount=str(txn.amount),
                currency=ba.currency,
                bank_code=ba.account.code,
                bank_name=ba.account.name,
                coa_json=json.dumps(coa, indent=2),
            )
            parsed, model = _suggest_via_ollama(prompt)

        # ── Shared validation ───────────────────────────────────────
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
