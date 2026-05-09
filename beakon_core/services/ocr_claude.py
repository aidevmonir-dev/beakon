"""OCR + AI extraction via the Anthropic Claude API.

Drop-in alternative to the Ollama backend in ``ocr.py``: same
``extract_invoice`` / ``extract_invoice_streaming`` signatures, same
return shape (after ``_normalise``), so the dispatcher in ``OCRService``
can route to either without callers caring.

Why Claude (vs Ollama):
  * Native PDF support — both digital and scanned PDFs go through the
    same code path, fixing the ``OCR007`` "scanned PDF" gap.
  * Materially better at finding labels split across lines and at
    matching the suggested expense account to the COA.
  * Structured outputs via tool-use give us schema-validated JSON
    without the ``format=json`` regex-rescue dance.

Privacy note: bills are sent to api.anthropic.com. Use the Ollama
backend for entities that must stay local (Swiss-hosted blueprint
positioning).
"""
from __future__ import annotations

import base64
from decimal import Decimal
from typing import Iterator, Optional

import anthropic
from django.conf import settings

from .. import constants as c
from ..exceptions import ValidationError
from ..models import Entity
from .anthropic_throttle import claude_throttle, raise_friendly_rate_limit
from .ocr import (
    DOCUMENT_TYPE_BILL,
    DOCUMENT_TYPE_INVOICE,
    _coa_for_prompt,
    _normalise,
)


_SYSTEM_RULES_INVOICE = """You are a precise bookkeeping assistant reading a CUSTOMER INVOICE that this company issued (sent OUT, not received). The "vendor_name" field in the schema is REUSED for the customer name. Suggest the best REVENUE account to credit (not expense — these are amounts billed to a customer). Apply the same accounting-standard reasoning rules and same JSON schema as for bills."""


_SYSTEM_RULES = """You are a precise bookkeeping assistant reading a vendor bill or receipt.
Extract structured data, suggest the best expense account to debit, AND
explain the booking from the perspective of the entity's accounting
standard so the reviewer learns the underlying rule.

You will record your extraction by calling the `extract_bill` tool. The
tool's schema enforces the shape — your job is to fill it accurately.

CRITICAL RULES — read carefully:
1. Decimals must be strings with a single dot, no thousands separators
   ("241.49", not "241,49" or "$241.49").
2. The "total" is what the buyer owes — usually labelled "Total",
   "Total Due", "Grand Total", "Balance Due", or "Amount Due". It is the
   LARGEST monetary figure on the document. NEVER return "0" if any
   amount is visible — pick the largest.
3. The label and amount may sit on SEPARATE LINES of the document.
   "Subtotal\\n$241.49" means subtotal IS 241.49.
4. Strip currency symbols ($, €, £) before placing the number. The
   symbol goes in "currency", the number in the amount fields.
5. If a string/date field is genuinely absent, use null. For amounts,
   only use "0" when no monetary value is present at all.
6. "currency" MUST be a 3-letter ISO code. "$" → "USD", "€" → "EUR",
   "£" → "GBP".
7. "suggested_account_id" MUST be one of the IDs in the chart of
   accounts provided.

SERVICE PERIOD RULES — critical for revenue recognition / matching:
- Many invoices cover a SERVICE PERIOD (e.g. "subscription Nov 2026 —
  Apr 2027", "rent for Q1 2027", "annual licence 2027", "policy period
  01/11/26-30/04/27").
- If a service / coverage / subscription period is visible, extract its
  start and end as ISO dates in service_period_start /
  service_period_end. Use the FIRST and LAST day of the period.
- If only a single month or year is visible (e.g. "March 2027"), set
  start to the first day and end to the last day of that month/year.
- If NO service period is visible, set BOTH service_period_* to null.
  Do not guess.
- Service-period dates may differ from invoice_date — invoice_date is
  when the document was issued; service_period_* is when goods/services
  are delivered. They drive period accruals and deferrals downstream.

ACCOUNTING-STANDARD REASONING RULES — these protect the "accountants
should learn the rule" goal. A wrong citation is worse than no citation:
- "standard" MUST exactly match the standard named for this entity.
- DO NOT cite specific paragraph numbers, section codes, or topic
  numbers (no "IFRS 15.31", no "ASC 842-10-25-2"). Cite the standard by
  name and the principle by topic only — readers can look up the para.
- "principle" should be a phrase a working accountant would recognise:
  "matching principle", "accrual basis", "expense recognition",
  "operating expense vs capital expenditure", "VAT input recovery", etc.
- "explanation" is 2-3 sentences in plain English, written for a user
  who is NOT a CPA. Frame as "Under <standard>, <rule>. Therefore this
  booking <treatment>." Avoid jargon; if you must use a term, define it.
- If the entity's standard is "Other / local", set "standard" to "Other"
  and base the explanation on IFRS-equivalent treatment, noting
  "Treated as IFRS-equivalent — confirm against the local framework
  before posting."

KEEP THE RESPONSE COMPACT:
- "description" is ONE short sentence (under 100 characters).
- "suggested_account_reasoning" is ONE short phrase (under 80 chars).
- "accounting_standard_reasoning.explanation" is 2-3 sentences (under
  400 characters total).
- "line_items": at most 8 entries, each description under 60 chars. If
  the bill has more, summarise the rest in a single "Other items" line.
"""


_BILL_INPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "vendor_name": {"type": "string"},
        "invoice_number": {"type": ["string", "null"]},
        "invoice_date": {"type": ["string", "null"], "description": "ISO date YYYY-MM-DD or null"},
        "due_date": {"type": ["string", "null"]},
        "service_period_start": {"type": ["string", "null"]},
        "service_period_end": {"type": ["string", "null"]},
        "subtotal": {"type": "string", "description": "Decimal as string, e.g. '241.49'"},
        "tax_amount": {"type": "string"},
        "total": {"type": "string"},
        "currency": {"type": ["string", "null"], "description": "3-letter ISO code"},
        "description": {"type": "string"},
        "line_items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "description": {"type": "string"},
                    "amount": {"type": "string"},
                },
                "required": ["description", "amount"],
            },
        },
        "suggested_account_id": {"type": "integer"},
        "suggested_account_reasoning": {"type": "string"},
        "accounting_standard_reasoning": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "standard": {"type": "string"},
                "principle": {"type": "string"},
                "explanation": {"type": "string"},
            },
            "required": ["standard", "principle", "explanation"],
        },
        "confidence": {"type": "number", "description": "0.0-1.0 overall extraction quality"},
        "confidence_in_account": {"type": "number", "description": "0.0-1.0 confidence in account choice"},
    },
    "required": [
        "vendor_name", "invoice_number", "invoice_date", "due_date",
        "service_period_start", "service_period_end",
        "subtotal", "tax_amount", "total", "currency",
        "description", "line_items",
        "suggested_account_id", "suggested_account_reasoning",
        "accounting_standard_reasoning",
        "confidence", "confidence_in_account",
    ],
}

_BILL_TOOL = {
    "name": "extract_bill",
    "description": (
        "Record the structured data extracted from the bill or receipt. "
        "Call this exactly once per document with all fields filled in."
    ),
    "input_schema": _BILL_INPUT_SCHEMA,
}


def _entity_context_text(
    entity: Entity, document_type: str = DOCUMENT_TYPE_BILL,
) -> str:
    """Per-entity context block: currency, accounting standard, and the
    trimmed COA. Cached for 5 minutes per entity via cache_control."""
    coa = _coa_for_prompt(entity, document_type=document_type)
    standard_label = c.ACCOUNTING_STANDARD_SHORT.get(
        entity.accounting_standard or c.ACCT_STD_IFRS, "IFRS",
    )
    import json as _json
    role = (
        "revenue accounts (this is a customer invoice — credit side)"
        if document_type == DOCUMENT_TYPE_INVOICE
        else "expense accounts (this is a vendor bill — debit side)"
    )
    return (
        f"Entity functional currency: {entity.functional_currency}\n"
        f"Entity accounting standard: {standard_label}\n"
        f"  → Set accounting_standard_reasoning.standard to exactly: "
        f"\"{standard_label}\".\n"
        f"\n"
        f"Chart of accounts — {role}\n"
        f"(suggested_account_id MUST be one of these IDs):\n"
        f"{_json.dumps(coa, indent=2)}"
    )


def _document_block(file_bytes: bytes, content_type: str) -> dict:
    """Build the single content block carrying the bill itself.

    Claude reads PDFs natively (digital OR scanned) — no pypdf or render
    step. Image bills go through the image block; everything else
    raises.
    """
    is_image = content_type.startswith("image/")
    is_pdf = content_type == "application/pdf"
    if not (is_image or is_pdf):
        raise ValidationError(
            f"OCR supports PDF and images only; got {content_type}.",
            code="OCR006",
        )
    b64 = base64.b64encode(file_bytes).decode("ascii")
    if is_pdf:
        return {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": b64,
            },
        }
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": content_type,
            "data": b64,
        },
    }


def _build_request(
    entity: Entity,
    file_bytes: bytes,
    content_type: str,
    document_type: str = DOCUMENT_TYPE_BILL,
):
    """Return ``(system, user_content, mode)`` ready for messages.create.

    ``mode`` is "text" for PDF and "vision" for image — preserved from
    the Ollama backend so audit-trail strings stay consistent
    ("AI-extracted [model, mode, conf]").
    """
    document = _document_block(file_bytes, content_type)
    mode = "text" if content_type == "application/pdf" else "vision"

    rules = (
        _SYSTEM_RULES_INVOICE if document_type == DOCUMENT_TYPE_INVOICE
        else _SYSTEM_RULES
    )
    doc_label = "customer invoice" if document_type == DOCUMENT_TYPE_INVOICE else "bill"

    # Two-block system: rules (globally cacheable across all entities) +
    # entity context with cache_control breakpoint (caches per-entity for
    # 5 min). Combined size comfortably exceeds the 4096-token Opus
    # minimum cacheable prefix.
    system = [
        {"type": "text", "text": rules},
        {
            "type": "text",
            "text": _entity_context_text(entity, document_type=document_type),
            "cache_control": {"type": "ephemeral"},
        },
    ]
    user_content = [
        document,
        {
            "type": "text",
            "text": (
                f"Read the {doc_label} above and call the extract_bill tool "
                f"with the structured data. Pick the suggested_account_id "
                f"from the chart of accounts in the system context."
            ),
        },
    ]
    return system, user_content, mode


def _client() -> anthropic.Anthropic:
    api_key = settings.ANTHROPIC_API_KEY or None
    if not api_key:
        raise ValidationError(
            "OCR_BACKEND=claude requires ANTHROPIC_API_KEY to be set.",
            code="OCR020",
        )
    return anthropic.Anthropic(api_key=api_key)


def _result_from_message(message, *, model: str, mode: str) -> dict:
    """Pull the tool_use input out of a final Message and run it through
    the shared ``_normalise`` so the shape matches the Ollama path."""
    tool_use = next(
        (b for b in message.content if getattr(b, "type", None) == "tool_use"),
        None,
    )
    if tool_use is None:
        raise ValidationError(
            f"Claude did not call extract_bill; stop_reason={message.stop_reason}.",
            code="OCR021",
            details={"stop_reason": str(message.stop_reason)},
        )
    data = dict(tool_use.input)
    data["model_used"] = model
    data["mode"] = mode
    return _normalise(data)


class ClaudeOCRBackend:
    @staticmethod
    def extract_invoice(
        *,
        entity: Entity,
        file_bytes: bytes,
        content_type: str,
        document_type: str = DOCUMENT_TYPE_BILL,
    ) -> dict:
        system, user_content, mode = _build_request(
            entity, file_bytes, content_type, document_type=document_type,
        )
        model = settings.CLAUDE_OCR_MODEL
        client = _client()
        kwargs = {
            "model": model,
            "max_tokens": 16000,
            "system": system,
            "tools": [_BILL_TOOL],
            "tool_choice": {"type": "tool", "name": "extract_bill"},
            "messages": [{"role": "user", "content": user_content}],
        }
        # Adaptive thinking is supported on Opus 4.6/4.7 and Sonnet 4.6.
        # Haiku 4.5 doesn't support it and will 400 if we send it. Skip
        # the parameter for Haiku — bill extraction is structured enough
        # that thinking adds little quality but real cost.
        if not model.startswith("claude-haiku"):
            kwargs["thinking"] = {"type": "adaptive"}
        claude_throttle()
        try:
            message = client.messages.create(**kwargs)
        except anthropic.AuthenticationError as e:
            raise ValidationError(
                "ANTHROPIC_API_KEY is invalid or revoked.",
                code="OCR022",
                details={"error": str(e)},
            )
        except anthropic.RateLimitError as e:
            raise_friendly_rate_limit(e, code="OCR023_RATE_LIMIT")
        except anthropic.APIError as e:
            raise ValidationError(
                f"Claude API error: {e}",
                code="OCR023",
                details={"error": str(e)},
            )
        return _result_from_message(message, model=model, mode=mode)

    @staticmethod
    def extract_invoice_streaming(
        *,
        entity: Entity,
        file_bytes: bytes,
        content_type: str,
        document_type: str = DOCUMENT_TYPE_BILL,
    ) -> Iterator[dict]:
        try:
            system, user_content, mode = _build_request(
                entity, file_bytes, content_type,
                document_type=document_type,
            )
        except ValidationError as e:
            yield {"type": "error", "message": e.message}
            return

        model = settings.CLAUDE_OCR_MODEL
        try:
            client = _client()
        except ValidationError as e:
            yield {"type": "error", "message": e.message}
            return

        yield {
            "type": "phase",
            "phase": f"Streaming from {model}…",
            "pct": 12,
        }

        token_count = 0
        stream_kwargs = {
            "model": model,
            "max_tokens": 16000,
            "system": system,
            "tools": [_BILL_TOOL],
            "tool_choice": {"type": "tool", "name": "extract_bill"},
            "messages": [{"role": "user", "content": user_content}],
        }
        if not model.startswith("claude-haiku"):
            stream_kwargs["thinking"] = {"type": "adaptive"}
        claude_throttle()
        try:
            with client.messages.stream(**stream_kwargs) as stream:
                for event in stream:
                    if event.type == "content_block_delta":
                        delta_type = getattr(event.delta, "type", "")
                        if delta_type in (
                            "input_json_delta", "text_delta", "thinking_delta",
                        ):
                            token_count += 1
                            yield {"type": "token", "n": token_count}
                final_message = stream.get_final_message()
        except anthropic.AuthenticationError:
            yield {"type": "error",
                   "message": "ANTHROPIC_API_KEY is invalid or revoked."}
            return
        except anthropic.RateLimitError as e:
            try:
                retry_after = int(e.response.headers.get("retry-after", "0")) or None
            except (AttributeError, ValueError, TypeError):
                retry_after = None
            wait_msg = (f"Try again in ~{retry_after}s."
                        if retry_after else "Try again shortly.")
            yield {"type": "error",
                   "message": f"Claude rate limit reached (5/min per org). {wait_msg}"}
            return
        except anthropic.APIError as e:
            yield {"type": "error",
                   "message": f"Claude API error: {e}"}
            return

        try:
            data = _result_from_message(final_message, model=model, mode=mode)
        except ValidationError as e:
            yield {"type": "error", "message": e.message,
                   "details": e.details}
            return

        yield {"type": "result", "data": data}
