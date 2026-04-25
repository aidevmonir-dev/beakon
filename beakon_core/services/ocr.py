"""OCR + AI extraction for vendor bills and receipts.

Blueprint p.4 ("AI-drafted journal entries for approval") + p.2 ("AI may
read documents, may draft journal entries — but no ledger entry posts
without approval"). This service is the read+draft layer; it never posts.

Privacy: uses local Ollama by default. Bills do not leave the machine
unless ``OLLAMA_BASE_URL`` is pointed elsewhere.

Two paths:
    1. **Text path** (digital PDFs with embedded text): pypdf extracts
       the raw text, we send TEXT to a text-only model. Works with any
       Ollama text model (default ``llama3.2:latest``).
    2. **Vision path** (images, scanned PDFs): we send the image bytes
       to a vision-capable model (default ``llama3.2-vision:11b``).
       Raises a clear error if the user hasn't pulled a vision model.

The extraction prompt is given the entity's COA so the model can suggest
which expense account to debit. The user always reviews before submit.
"""
from __future__ import annotations

import base64
import json
import re
from decimal import Decimal
from io import BytesIO
from typing import Iterator, Optional

import requests
from django.conf import settings
from django.db.models import Q

from .. import constants as c
from ..exceptions import ValidationError
from ..models import Account, Entity


MIN_PDF_TEXT_CHARS = 80  # below this we treat the PDF as scanned/image-only
DEFAULT_CONFIDENCE = 0.0


# Account types we'll suggest as the debit side of a bill. Bills almost
# always book to expense. Capitalisation to a fixed asset is uncommon
# enough that v1 omits asset accounts from the prompt — saves ~half the
# COA token cost. The user can re-categorise to a fixed asset on the
# draft JE if needed.
ACCEPTABLE_DEBIT_TYPES = (c.ACCOUNT_TYPE_EXPENSE,)
# Cap COA entries sent to the model. Family-office orgs can have 100+
# accounts; sending all of them slows down generation noticeably without
# improving suggestions much.
MAX_COA_ENTRIES_IN_PROMPT = 50


_PROMPT_HEADER = """You are a precise bookkeeping assistant reading a vendor bill or receipt.
Extract structured data, suggest the best expense account to debit, AND
explain the booking from the perspective of the entity's accounting
standard so the reviewer learns the underlying rule.

You MUST return a single valid JSON object with EXACTLY these keys:
{
  "vendor_name": string,
  "invoice_number": string or null,
  "invoice_date": "YYYY-MM-DD" or null,
  "due_date": "YYYY-MM-DD" or null,
  "subtotal": string decimal,
  "tax_amount": string decimal,
  "total": string decimal,
  "currency": "3-letter ISO code (e.g. USD, EUR, GBP)",
  "description": "one-sentence summary of what was bought",
  "line_items": [{"description": string, "amount": string decimal}],
  "suggested_account_id": int (one of the IDs from the chart of accounts below),
  "suggested_account_reasoning": "one short sentence why this account fits",
  "accounting_standard_reasoning": {
    "standard": "IFRS" | "US GAAP" | "UK GAAP" | "Other",
    "principle": "the high-level rule (e.g. 'matching principle', 'expense recognition', 'lease accounting')",
    "explanation": "2-3 sentences explaining how this entry follows the standard, in plain English"
  },
  "confidence": float 0.0–1.0 of overall extraction quality,
  "confidence_in_account": float 0.0–1.0 of the account choice
}

CRITICAL RULES — read carefully:
1. Decimals are strings with a single dot, no thousands separators ("241.49", not "241,49" or "$241.49").
2. The "total" field is what the buyer owes — usually labelled "Total", "Total Due", "Grand Total", "Balance Due", or "Amount Due". It is the LARGEST monetary figure on the document. NEVER return "0" if any amount is visible — pick the largest.
3. The label and the amount may sit on SEPARATE LINES of the document. If you see "Subtotal\\n$241.49", the subtotal IS 241.49.
4. Strip currency symbols ($, €, £) before placing the number in the JSON. The symbol goes in "currency", the number goes in the amount fields.
5. If a field is genuinely absent from the document, use null (for strings/dates) — for AMOUNTS, only use "0" when there really is no monetary value present.
6. The currency MUST be a 3-letter ISO code. "$" → "USD", "€" → "EUR", "£" → "GBP".
7. The suggested_account_id MUST be one of the IDs in the chart of accounts below.
8. Output ONLY the JSON object. No preamble, no markdown fences, no explanation.

ACCOUNTING-STANDARD REASONING RULES — these protect Thomas's "accountants
should learn the rule" goal. A wrong citation is worse than no citation:
- The "standard" field MUST exactly match the standard named below for this entity.
- DO NOT cite specific paragraph numbers, section codes, or topic numbers
  (no "IFRS 15.31", no "ASC 842-10-25-2"). Cite the standard by name and
  the principle by topic only — readers can look up the paragraph.
- "principle" should be a short phrase a working accountant would recognise:
  "matching principle", "accrual basis", "expense recognition",
  "operating expense vs capital expenditure", "VAT input recovery", etc.
- "explanation" must be 2-3 sentences in plain English, written for a
  user who is NOT a CPA. Frame it as "Under <standard>, <rule>. Therefore
  this booking <treatment>." Avoid jargon; if you must use a term, define it.
- If the entity's standard is "Other / local", set "standard" to "Other"
  and base your explanation on IFRS-equivalent treatment, with the
  explanation noting "Treated as IFRS-equivalent — confirm against the
  local framework before posting."

KEEP THE RESPONSE COMPACT:
- "description" must be ONE short sentence (under 100 characters).
- "suggested_account_reasoning" must be ONE short phrase (under 80 characters).
- "accounting_standard_reasoning.explanation" must be 2-3 sentences (under 400 characters total).
- "line_items": include at most 8 entries, each with a brief description (under 60 characters). If the bill has more line items, summarise the rest in a single "Other items" line.
- Do NOT add any keys beyond the schema. Do NOT include long quoted text from the document.

Example (for guidance — do NOT copy verbatim):
Document text fragment: "Acme Corp\\nInvoice #1234\\nDate 2026-04-15\\nWidget x2\\n$50.00\\nSubtotal\\n$50.00\\nTax\\n$3.50\\nTOTAL DUE\\n$53.50"
Correct extraction: vendor_name="Acme Corp", invoice_number="1234", invoice_date="2026-04-15", subtotal="50.00", tax_amount="3.50", total="53.50", currency="USD"."""


def _coa_for_prompt(entity: Entity) -> list[dict]:
    """Return a TRIMMED COA for the prompt — expense-only, capped, and
    with only the fields the model actually needs (id/code/name/subtype).
    The full account_type field is dropped: it's always 'expense' here."""
    rows = (
        Account.objects
        .filter(
            organization=entity.organization,
            is_active=True,
            account_type__in=ACCEPTABLE_DEBIT_TYPES,
        )
        # entity-scoped OR shared
        .filter(Q(entity=entity) | Q(entity__isnull=True))
        .order_by("code")
        .values("id", "code", "name", "account_subtype")
        [:MAX_COA_ENTRIES_IN_PROMPT]
    )
    return list(rows)


def _build_prompt(entity: Entity, document_text: Optional[str] = None) -> str:
    coa = _coa_for_prompt(entity)
    standard_label = c.ACCOUNTING_STANDARD_SHORT.get(
        entity.accounting_standard or c.ACCT_STD_IFRS, "IFRS",
    )
    parts = [
        _PROMPT_HEADER,
        "",
        f"Entity functional currency: {entity.functional_currency}",
        f"Entity accounting standard: {standard_label}",
        f"  → Set accounting_standard_reasoning.standard to exactly: \"{standard_label}\".",
        "",
        "Chart of accounts (pick suggested_account_id from this list):",
        json.dumps(coa, indent=2),
    ]
    if document_text:
        parts += ["", "Bill / receipt text:", "```", document_text, "```"]
    return "\n".join(parts)


# ── Ollama HTTP layer ──────────────────────────────────────────────────────

def _ollama_chat(*, model: str, prompt: str, image_b64: Optional[str] = None) -> dict:
    """Single-turn chat with Ollama. Returns the parsed JSON response from
    the assistant. Raises ValidationError on transport / format failures."""
    url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
    message: dict = {"role": "user", "content": prompt}
    if image_b64:
        message["images"] = [image_b64]
    payload = {
        "model": model,
        "messages": [message],
        "stream": False,
        "format": "json",
        # Keep the model in memory for 30 minutes after this call. The next
        # bill upload skips the 30-40s cold start.
        "keep_alive": "30m",
        "options": {
            "temperature": 0.1,
            # Cap the response length. 1500 tokens covers a long invoice
            # with many line items; the early 600-token cap was clipping
            # qwen2.5's verbose output mid-string and causing JSON parse
            # failures.
            "num_predict": 1500,
            # Make sure the prompt window is large enough for COA + bill
            # text. Default is 2048, which a long invoice can exceed.
            "num_ctx": 4096,
        },
    }
    try:
        resp = requests.post(url, json=payload, timeout=settings.OLLAMA_TIMEOUT_SECONDS)
    except requests.RequestException as e:
        raise ValidationError(
            f"Could not reach Ollama at {settings.OLLAMA_BASE_URL}: {e}",
            code="OCR001",
            details={"hint": "Is `ollama serve` running? Check OLLAMA_BASE_URL."},
        )
    if resp.status_code == 404:
        raise ValidationError(
            f"Ollama returned 404 — model '{model}' is probably not pulled. "
            f"Run: ollama pull {model}",
            code="OCR002",
            details={"model": model},
        )
    if resp.status_code != 200:
        raise ValidationError(
            f"Ollama returned {resp.status_code}: {resp.text[:200]}",
            code="OCR003",
        )

    body = resp.json()
    raw_content = body.get("message", {}).get("content", "")
    if not raw_content:
        raise ValidationError(
            "Ollama returned an empty response.",
            code="OCR004",
            details={"raw": str(body)[:300]},
        )
    return _parse_llm_json(raw_content)


def _parse_llm_json(raw: str) -> dict:
    # Some models still wrap in markdown fences despite format=json. Strip.
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValidationError(
            f"Ollama returned non-JSON content: {e}",
            code="OCR005",
            details={"raw": cleaned[:500]},
        )


def _ollama_chat_streaming(
    *, model: str, prompt: str, image_b64: Optional[str] = None,
) -> Iterator[dict]:
    """Same as ``_ollama_chat`` but yields events as tokens stream from Ollama.

    Events:
        {"type": "token", "n": int}  — emitted on every chunk; n = chunk count
        {"type": "result", "data": dict}  — final parsed JSON
        {"type": "error", "message": str}  — terminal failure (caller should stop)
    """
    url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
    message: dict = {"role": "user", "content": prompt}
    if image_b64:
        message["images"] = [image_b64]
    payload = {
        "model": model,
        "messages": [message],
        "stream": True,
        "format": "json",
        "keep_alive": "30m",
        "options": {
            "temperature": 0.1,
            "num_predict": 1500,
            "num_ctx": 4096,
        },
    }
    try:
        resp = requests.post(
            url, json=payload, timeout=settings.OLLAMA_TIMEOUT_SECONDS, stream=True,
        )
    except requests.RequestException as e:
        yield {"type": "error", "message":
               f"Could not reach Ollama at {settings.OLLAMA_BASE_URL}: {e}"}
        return

    if resp.status_code == 404:
        yield {"type": "error",
               "message": f"Model '{model}' not pulled. Run: ollama pull {model}"}
        return
    if resp.status_code != 200:
        yield {"type": "error",
               "message": f"Ollama returned {resp.status_code}: {resp.text[:200]}"}
        return

    accumulated = ""
    token_count = 0
    try:
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                chunk = json.loads(line)
            except json.JSONDecodeError:
                continue
            content = chunk.get("message", {}).get("content", "")
            if content:
                accumulated += content
                token_count += 1
                yield {"type": "token", "n": token_count}
            if chunk.get("done"):
                break
    finally:
        resp.close()

    if not accumulated:
        yield {"type": "error", "message": "Ollama returned an empty response."}
        return
    try:
        data = _parse_llm_json(accumulated)
    except ValidationError as e:
        yield {"type": "error", "message": e.message,
               "details": e.details}
        return
    yield {"type": "result", "data": data}


# ── PDF text extraction ───────────────────────────────────────────────────

def _try_extract_pdf_text(file_bytes: bytes) -> Optional[str]:
    """Return the embedded text from a PDF, or None if the PDF is
    image-only / extracted text is too sparse."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    try:
        reader = PdfReader(BytesIO(file_bytes))
    except Exception:
        return None
    chunks = []
    for page in reader.pages:
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        if t.strip():
            chunks.append(t)
    text = "\n\n".join(chunks).strip()
    if len(text) < MIN_PDF_TEXT_CHARS:
        return None
    return text


# ── Public service ────────────────────────────────────────────────────────

class OCRService:
    @staticmethod
    def extract_invoice(
        *,
        entity: Entity,
        file_bytes: bytes,
        content_type: str,
    ) -> dict:
        """Run OCR + extraction for a bill/receipt. Returns a dict with
        the structured fields plus ``model_used`` (which model handled it)
        and ``mode`` ('text' | 'vision').
        """
        is_image = content_type.startswith("image/")
        is_pdf = content_type == "application/pdf"
        if not (is_image or is_pdf):
            raise ValidationError(
                f"OCR supports PDF and images only; got {content_type}.",
                code="OCR006",
            )

        # Text path for digital PDFs (no LLM image needed)
        if is_pdf:
            text = _try_extract_pdf_text(file_bytes)
            if text:
                prompt = _build_prompt(entity, document_text=text)
                model = settings.OLLAMA_TEXT_MODEL
                data = _ollama_chat(model=model, prompt=prompt)
                data["model_used"] = model
                data["mode"] = "text"
                normalised = _normalise(data)
                # Regex fallback: small models often return "0" for amounts
                # they couldn't parse out of label-on-its-own-line layouts.
                # Recover from raw text when we have it.
                _backfill_amounts_from_text(normalised, text)
                return normalised

        # Vision path for images and image-only PDFs
        if is_pdf:
            # Could render PDF→image with pypdfium2 here. v1 just errors.
            raise ValidationError(
                "PDF appears to be scanned/image-only and we don't yet "
                "render PDFs to images. Convert the PDF to PNG/JPG and "
                "re-upload, or use a digital (text-embedded) PDF.",
                code="OCR007",
            )
        # Image: send to vision model
        b64 = base64.b64encode(file_bytes).decode("ascii")
        prompt = _build_prompt(entity)
        model = settings.OLLAMA_VISION_MODEL
        data = _ollama_chat(model=model, prompt=prompt, image_b64=b64)
        data["model_used"] = model
        data["mode"] = "vision"
        return _normalise(data)

    @staticmethod
    def extract_invoice_streaming(
        *,
        entity: Entity,
        file_bytes: bytes,
        content_type: str,
    ) -> Iterator[dict]:
        """Streaming variant — yields phase + token events while the LLM
        works, then a final ``{"type": "result", "data": <normalised>}``.

        Events:
            {"type": "phase",  "phase": str, "pct": int}
            {"type": "token",  "n": int}
            {"type": "result", "data": dict}    # terminal success
            {"type": "error",  "message": str}  # terminal failure
        """
        is_image = content_type.startswith("image/")
        is_pdf = content_type == "application/pdf"
        if not (is_image or is_pdf):
            yield {"type": "error",
                   "message": f"OCR supports PDF and images only; got {content_type}."}
            return

        # ── Resolve mode + prepare prompt ──────────────────────────────
        text_for_backfill: Optional[str] = None
        prompt: str
        model: str
        image_b64: Optional[str] = None
        mode: str

        if is_pdf:
            yield {"type": "phase", "phase": "Extracting text from PDF…", "pct": 8}
            text = _try_extract_pdf_text(file_bytes)
            if text:
                prompt = _build_prompt(entity, document_text=text)
                model = settings.OLLAMA_TEXT_MODEL
                mode = "text"
                text_for_backfill = text
            else:
                yield {"type": "error", "message":
                       "PDF appears scanned/image-only and we don't yet "
                       "render PDFs to images. Convert to PNG/JPG first."}
                return
        else:
            yield {"type": "phase", "phase": "Encoding image for vision model…", "pct": 6}
            image_b64 = base64.b64encode(file_bytes).decode("ascii")
            prompt = _build_prompt(entity)
            model = settings.OLLAMA_VISION_MODEL
            mode = "vision"

        yield {"type": "phase",
               "phase": f"Sending to {model} (first call may load the model)…",
               "pct": 12}

        # ── Stream the LLM call ────────────────────────────────────────
        result_data: Optional[dict] = None
        for evt in _ollama_chat_streaming(
            model=model, prompt=prompt, image_b64=image_b64,
        ):
            if evt["type"] == "result":
                result_data = evt["data"]
                # don't forward — we'll emit our own final result after
                # backfill + normalisation
            elif evt["type"] == "error":
                yield evt
                return
            else:
                yield evt

        if result_data is None:
            yield {"type": "error", "message": "Stream ended without a result."}
            return

        # ── Normalise + backfill ───────────────────────────────────────
        result_data["model_used"] = model
        result_data["mode"] = mode
        normalised = _normalise(result_data)
        if text_for_backfill:
            _backfill_amounts_from_text(normalised, text_for_backfill)
        yield {"type": "result", "data": normalised}


# ── Output cleanup ────────────────────────────────────────────────────────

def _normalise(data: dict) -> dict:
    """Coerce LLM output into a stable shape. Missing keys filled with
    safe defaults; numbers parsed to Decimal; currency upper-cased."""
    out = {
        "vendor_name": (data.get("vendor_name") or "").strip()[:255],
        "invoice_number": (data.get("invoice_number") or "")[:100] or None,
        "invoice_date": data.get("invoice_date") or None,
        "due_date": data.get("due_date") or None,
        "subtotal": _to_decimal(data.get("subtotal")),
        "tax_amount": _to_decimal(data.get("tax_amount")),
        "total": _to_decimal(data.get("total")),
        "currency": (data.get("currency") or "").upper().strip()[:3] or None,
        "description": (data.get("description") or "").strip()[:500],
        "line_items": [],
        "suggested_account_id": _to_int(data.get("suggested_account_id")),
        "suggested_account_reasoning": (data.get("suggested_account_reasoning") or "")[:500],
        "accounting_standard_reasoning": _normalise_standard_reasoning(
            data.get("accounting_standard_reasoning"),
        ),
        "confidence": _to_float(data.get("confidence"), default=DEFAULT_CONFIDENCE),
        "confidence_in_account": _to_float(data.get("confidence_in_account"), default=DEFAULT_CONFIDENCE),
        "model_used": data.get("model_used"),
        "mode": data.get("mode"),
    }
    for li in data.get("line_items") or []:
        if not isinstance(li, dict):
            continue
        out["line_items"].append({
            "description": (li.get("description") or "")[:500],
            "amount": _to_decimal(li.get("amount")),
        })
    return out


# ── Regex fallback for amounts ────────────────────────────────────────────
# Small text models (3B-class) sometimes return "0" for amounts when the
# label and value sit on separate lines of the document. We rescue by
# scanning the raw text for known patterns. The largest plausible match
# becomes the total; subtotal/tax patterns fill those fields if missing.

_AMOUNT_PAT = r"[\$€£]?\s*([\d]{1,3}(?:[,]\d{3})*(?:\.\d{1,4})?|\d+(?:\.\d{1,4})?)"

_TOTAL_LABELS = (
    "total\\s+due", "grand\\s+total", "balance\\s+due", "amount\\s+due",
    "total", "amount\\s+payable", "to\\s+pay",
)
_SUBTOTAL_LABELS = ("subtotal", "sub\\s*total", "net\\s+amount")
_TAX_LABELS = ("tax", "vat", "gst", "sales\\s+tax")


def _scan_amount(text: str, labels: tuple[str, ...]) -> Optional[Decimal]:
    """Find the first amount that follows one of the given labels, allowing
    the value to appear on the same line OR the next non-blank line."""
    for lbl in labels:
        pattern = re.compile(
            rf"{lbl}[\s:\-]*(?:\n|\r\n?)?\s*{_AMOUNT_PAT}",
            re.IGNORECASE | re.MULTILINE,
        )
        m = pattern.search(text)
        if m:
            try:
                return Decimal(m.group(1).replace(",", ""))
            except Exception:
                continue
    return None


def _backfill_amounts_from_text(data: dict, raw_text: str) -> None:
    """Mutate ``data`` to fill in amounts the LLM returned as zero.
    Marks the override in suggested_account_reasoning so reviewers see it."""
    notes = []

    if data.get("total", Decimal("0")) <= 0:
        recovered = _scan_amount(raw_text, _TOTAL_LABELS)
        if recovered and recovered > 0:
            data["total"] = recovered
            notes.append(f"total recovered from text via regex: {recovered}")

    if data.get("subtotal", Decimal("0")) <= 0:
        recovered = _scan_amount(raw_text, _SUBTOTAL_LABELS)
        if recovered and recovered > 0:
            data["subtotal"] = recovered
            notes.append(f"subtotal recovered: {recovered}")

    if data.get("tax_amount", Decimal("0")) <= 0:
        recovered = _scan_amount(raw_text, _TAX_LABELS)
        if recovered and recovered > 0:
            data["tax_amount"] = recovered
            notes.append(f"tax_amount recovered: {recovered}")

    if notes:
        existing = data.get("suggested_account_reasoning", "") or ""
        data["suggested_account_reasoning"] = (
            existing + (" · " if existing else "") + "; ".join(notes)
        )[:500]
        # Down-rate confidence so reviewers don't trust it blindly
        data["confidence"] = min(data.get("confidence", 1.0), 0.6)


def _normalise_standard_reasoning(v) -> Optional[dict]:
    """Coerce the LLM's standard-reasoning blob into ``{standard, principle,
    explanation}`` or ``None`` if the model didn't produce anything usable.

    Tolerant of older/smaller models that:
      * return a plain string instead of an object,
      * omit one of the keys,
      * pad numbers / extra fields we ignore.
    """
    if not v:
        return None
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        return {"standard": "", "principle": "", "explanation": s[:500]}
    if not isinstance(v, dict):
        return None
    standard = str(v.get("standard") or "").strip()[:40]
    principle = str(v.get("principle") or "").strip()[:120]
    explanation = str(v.get("explanation") or "").strip()[:500]
    if not (standard or principle or explanation):
        return None
    return {
        "standard": standard,
        "principle": principle,
        "explanation": explanation,
    }


def _to_decimal(v) -> Decimal:
    if v in (None, ""):
        return Decimal("0")
    try:
        return Decimal(str(v).replace(",", "").strip() or "0")
    except Exception:
        return Decimal("0")


def _to_int(v) -> Optional[int]:
    if v in (None, ""):
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def _to_float(v, *, default: float = 0.0) -> float:
    try:
        return float(v)
    except (ValueError, TypeError):
        return default
