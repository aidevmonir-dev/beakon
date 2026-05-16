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
from django.db import models

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


_INVOICE_OVERRIDE = """
INVOICE-SPECIFIC OVERRIDES (this is a CUSTOMER INVOICE sent OUT, not a
vendor bill received):
- The "vendor_name" field in the schema is REUSED for the customer name.
- "suggested_account_id" picks the best REVENUE account to CREDIT (not an
  expense to debit). The COA in the system context already lists revenue
  accounts only for invoices.
- "accounting_standard_reasoning.principle" should reference revenue
  recognition ("revenue recognition", "performance-obligation transfer",
  "accrual basis"), not expense recognition.
- The same VAT/tax rules apply: line_items[].amount is NET of output VAT,
  tax_amount is output VAT, total = subtotal + tax_amount = gross
  receivable. AR is booked gross, revenue net, output VAT separately.
"""


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

VAT / TAX RULES — accounting-correctness critical:
8. ALL amount fields are recorded NET of VAT/tax:
     - "subtotal" = sum of line amounts, BEFORE VAT
     - "tax_amount" = VAT only
     - "total" = subtotal + tax_amount = gross amount due
     - "line_items[].amount" = the line's NET (pre-VAT) amount.
9. Receipts often show line items at gross (VAT-inclusive). When that
   happens, you MUST back out the VAT before filling line_items[].amount.
   Example: a CHF 107.50 line at 7.5% VAT becomes line.amount = "100.00";
   the CHF 7.50 VAT belongs in the document-level tax_amount, never in
   the line.
10. The arithmetic MUST reconcile: sum(line_items[].amount) ≈ subtotal
    (within 0.01 rounding). If a document lacks an explicit subtotal,
    derive it as total − tax_amount and split line amounts net pro-rata.
11. NEVER place a gross figure into line_items[].amount. Booking the
    expense gross over-states the P&L and double-counts the tax —
    audit-fail.

INVOICE HIERARCHY — never double-count totals against their components:
12. Many invoices show the SAME money in multiple places (cover summary
    + detailed VAT declaration + per-line itemisation). These are
    ALTERNATIVE VIEWS of the same total, NOT additional lines to sum.
    Pick ONE view and use it consistently.
13. If a line is labelled "Total X", "Mobile total", "Subtotal X" or is
    visually the sum of nearby rows, do NOT also include the rows that
    feed into it as separate line_items. Example: an invoice showing
    "Mobile 137.70" followed by "Device instalment 41.90" inside that
    Mobile total — emit ONE line for Mobile, never Mobile + Device on
    top. Adding both yields a JE that doesn't reconcile to the invoice.
14. When a "Detailed VAT declaration" or equivalent tax-treatment table
    is present (rows split by VAT rate, sum equal to invoice total),
    PREFER IT as the source of truth for line_items. The table is
    designed to reconcile to the invoice total by construction, and it
    already classifies each portion's VAT treatment (vatable / exempt /
    handled-on-separate-invoice). Map those rows to line_items 1-to-1.
15. The final arithmetic check is binding: sum(line_items[].amount) +
    tax_amount MUST equal "total". If your extracted lines + VAT don't
    reconcile to the invoice total, you have double-counted or missed a
    component — reread the document and adjust before returning.

LEARNING RULES — past corrections from this organisation:
16. The user context may include a section labelled "PAST_RULES" listing
    LearningRules that the org's reviewer has approved. Each rule names a
    vendor (and optionally a customer number / invoice pattern), the
    correction it teaches, and a plain-English instruction.
17. If the invoice you are reading matches a rule's vendor (case-
    insensitive name match is enough) AND its scope conditions, FOLLOW
    THE RULE. The reviewer has already decided how invoices like this
    should be booked; treat their instruction as binding.
18. List every rule you followed in "applied_rule_ids". Include a rule
    ONLY if its guidance actually changed your output — do not pad the
    list. Use [] when no rule applied.
19. If a rule conflicts with the document (e.g. the rule says X but the
    invoice clearly shows Y), prefer the document and OMIT the rule from
    applied_rule_ids. The reviewer can update the rule later.
20. Never invent rule IDs that weren't in PAST_RULES.

DUPLICATE / ABSORBED LINES — when the same money is itemised twice:
21. For each entry in line_items, set is_absorbed=true and a short
    absorbed_note when the line's amount is ALREADY captured by another
    line above it on the cover summary or VAT declaration table.
    Classic case: Sunrise invoice — the cover shows "Mobile 137.70"; the
    per-SIM detail then itemises "Up Mobile L 36.60", "Flex Upgrade
    10.00", "Device instalment 20.95" twice. The detail rows are
    informational; the 137.70 cover figure is what was paid. Mark the
    detail rows is_absorbed=true with absorbed_note like "Included in
    Mobile total". The reconciliation arithmetic in rule 15 applies
    ONLY to non-absorbed lines.
22. When in doubt, prefer FEWER non-absorbed lines and mark the rest
    absorbed. It is safer to under-itemise than to double-count.

CUSTOMER NUMBER — the vendor's identifier for the bill recipient:
23. If the invoice prints a "customer number", "subscriber number",
    "account number", "client number" or equivalent, copy it into
    customer_number verbatim. This is NEVER the same as invoice_number.
    If the invoice does not print one, return an empty string.

RANKED ACCOUNT CANDIDATES — when confidence is low:
25a. If your confidence_in_account is below 0.6, you MUST also fill
     account_candidates with 3-5 alternative account IDs ranked from
     most to least likely. Each entry has id (from the provided CoA),
     score (0.0-1.0 likelihood, monotone-decreasing across the list),
     and reason (one sentence under 90 chars). When confidence is
     0.0 (you have no preferred pick), still return a ranked list —
     give the reviewer something to click instead of an empty form.
25b. When confidence_in_account >= 0.6, you may return an empty
     account_candidates list — the reviewer will accept your
     suggested_account_id as-is. Don't pad the list for the sake of
     it; only include candidates a working bookkeeper would genuinely
     consider.
25c. Every id in account_candidates MUST be a real ID from the chart
     of accounts you were given. Never invent IDs.

SUGGESTED RULE TEXT — proactive teaching:
24. After you finish extraction, ask yourself: "is there a structural
    quirk on this invoice that is likely to recur on the next invoice
    from this vendor — a duplicate-line layout, an unusual VAT split,
    a known mis-categorisation hazard?" If yes, draft a SHORT
    plain-English paragraph in suggested_rule_text telling the next
    extractor (or the human reviewer) how to handle it. Address the
    instruction to "Beakon" / "the extractor", not the reader. If
    nothing stands out, return an empty string.

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
                    # B7 — when an invoice lists the same money twice
                    # (e.g. Sunrise: the device instalment row in the
                    # per-line breakdown is already inside the Mobile
                    # subtotal on the cover summary), mark the duplicate
                    # detail row with is_absorbed=true. Absorbed lines
                    # are NOT posted — they're surfaced in the UI for
                    # auditor visibility and excluded from the JE.
                    "is_absorbed": {
                        "type": "boolean",
                        "description": "True if this line's amount is "
                                        "ALREADY included in another "
                                        "line/subtotal on the same "
                                        "invoice. Do not post absorbed "
                                        "lines. Default false.",
                    },
                    "absorbed_note": {
                        "type": "string",
                        "description": "Short note for the auditor "
                                        "explaining why this line is "
                                        "absorbed (e.g. 'Included in "
                                        "Mobile total'). Empty when "
                                        "is_absorbed=false.",
                    },
                },
                "required": ["description", "amount"],
            },
        },
        "customer_number": {
            "type": ["string", "null"],
            "description": "The vendor's own customer / subscriber / "
                            "account number for the bill recipient — "
                            "if printed on the invoice. NOT the invoice "
                            "number; NOT our vendor code. Example: "
                            "Sunrise '1000779477'.",
        },
        "suggested_rule_text": {
            "type": "string",
            "description": "If you noticed something on this invoice "
                            "that would be worth teaching Beakon for "
                            "future bills from THIS vendor (a "
                            "structural quirk, a recurring duplicate, "
                            "a VAT treatment), draft a single-paragraph "
                            "instruction in plain English the reviewer "
                            "can save as a LearningRule. Empty string "
                            "when there's nothing rule-worthy.",
        },
        "suggested_account_id": {"type": "integer"},
        "suggested_account_reasoning": {"type": "string"},
        # B8 — when confidence_in_account is low (< 0.6), the reviewer
        # still needs a shortlist. Return up to 5 candidate account IDs
        # ranked by score with a one-line reason each. The frontend
        # renders these as clickable chips beneath the empty dropdown.
        "account_candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "integer"},
                    "score": {
                        "type": "number",
                        "description": "0.0-1.0 likelihood this account fits the bill.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "One sentence (< 90 chars) on why this account.",
                    },
                },
                "required": ["id", "score", "reason"],
            },
            "description": "Up to 5 ranked account candidates. Required "
                            "when confidence_in_account < 0.6; can be "
                            "empty otherwise. IDs must come from the "
                            "provided chart of accounts.",
        },
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
        # B5 — list the rule IDs that you actively followed while
        # extracting this invoice. Empty array when no rules applied.
        "applied_rule_ids": {
            "type": "array",
            "items": {"type": "integer"},
            "description": "IDs of LearningRules from PAST_RULES that you "
                           "followed for this invoice. Empty array if none "
                           "applied. Only include rules whose vendor/scope "
                           "matched and that actually changed your output.",
        },
    },
    "required": [
        "vendor_name", "invoice_number", "invoice_date", "due_date",
        "service_period_start", "service_period_end",
        "subtotal", "tax_amount", "total", "currency",
        "description", "line_items",
        "customer_number", "suggested_rule_text",
        "suggested_account_id", "suggested_account_reasoning",
        "account_candidates",
        "accounting_standard_reasoning",
        "confidence", "confidence_in_account",
        "applied_rule_ids",
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


def _learning_rules_block(
    organization, entity: Entity, limit: int = 20,
) -> Optional[str]:
    """Build the PAST_RULES block injected into the OCR system prompt.

    Returns formatted text or None when the org has no active rules
    (avoids sending an empty section to the model). Rules are scoped to
    the org and either entity-agnostic OR matching this entity. We cap
    at `limit` most-recently-created rules so prompt size stays bounded
    — B6 can refine the ranking with last_used / success_count once
    those metrics start filling in.
    """
    # Lazy import — beakon_core kernel must not pull learning models at
    # module load time (the same pattern other ocr_claude lookups use).
    from ..models import LearningRule  # noqa: WPS433

    qs = (
        LearningRule.objects
        .filter(organization=organization, is_active=True)
        .filter(
            # Entity-agnostic rules apply to every entity in the org.
            # Entity-specific rules only apply when entity matches.
            models.Q(entity__isnull=True) | models.Q(entity=entity)
        )
        .select_related("vendor")
        .order_by("-created_at")[:limit]
    )
    rules = list(qs)
    if not rules:
        return None

    lines = [
        "PAST_RULES — corrections the reviewer has approved. Follow these "
        "when the invoice matches the vendor/scope. Report applied rule "
        "IDs in applied_rule_ids. The reviewer has already decided how "
        "invoices like this should be booked; treat their instructions "
        "as binding for matching invoices, but defer to the document if "
        "they conflict outright.",
        "",
    ]
    for r in rules:
        v_code = r.vendor.code if r.vendor_id else "?"
        v_name = r.vendor.name if r.vendor_id else "?"
        lines.append(f"--- Rule #{r.id} ---")
        lines.append(f"Vendor: {v_code} ({v_name})")
        if r.customer_number:
            lines.append(f"Customer number on invoice: {r.customer_number}")
        if r.invoice_pattern:
            lines.append(f"Invoice pattern: {r.invoice_pattern}")
        if r.correction_type:
            lines.append(f"Correction type: {r.correction_type}")
        lines.append(f"Scope: {r.get_scope_display()}")
        lines.append("Instruction:")
        lines.append(r.human_instruction)
        lines.append("")
    return "\n".join(lines)


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

    # Invoices share the bill extraction rules — same schema, same VAT
    # logic, same arithmetic checks — with a small override block that
    # flips the debit/credit framing. Sending bill rules alone to an
    # invoice produced thin extractions; this concatenation is the
    # documented contract.
    rules = (
        _SYSTEM_RULES + _INVOICE_OVERRIDE
        if document_type == DOCUMENT_TYPE_INVOICE
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
    # B5: append active LearningRules for this org. Only when at least
    # one rule exists — empty block would waste tokens and confuse the
    # model. Ephemeral cache so per-extraction additions don't break the
    # entity-context cache hit when no rules exist.
    rules_block = _learning_rules_block(entity.organization, entity)
    if rules_block:
        system.append({
            "type": "text",
            "text": rules_block,
            "cache_control": {"type": "ephemeral"},
        })
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
