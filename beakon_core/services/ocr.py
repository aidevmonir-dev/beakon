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
# Mirror for AR-side invoices: the suggested account is the credit half
# of a customer invoice, almost always revenue.
ACCEPTABLE_CREDIT_TYPES = (c.ACCOUNT_TYPE_REVENUE,)

DOCUMENT_TYPE_BILL = "bill"
DOCUMENT_TYPE_INVOICE = "invoice"
# Cap COA entries sent to the model. Family-office orgs can have 100+
# accounts; sending all of them slows down generation noticeably without
# improving suggestions much.
MAX_COA_ENTRIES_IN_PROMPT = 50


_PROMPT_HEADER_INVOICE = """You are a precise bookkeeping assistant reading a CUSTOMER INVOICE that this company issued (sent OUT, not received).

Extract structured data, suggest the best REVENUE account to credit
(not expense — these are amounts billed to a customer), AND explain
the booking from the perspective of the entity's accounting standard
so the reviewer learns the underlying rule.

Treat the document the same way as a bill — same fields (vendor_name
field is REUSED for the CUSTOMER name in this case), same JSON shape,
same accounting-standard reasoning. The ONLY conceptual difference is
the perspective: this is money coming IN, so the suggested_account_id
must be one of the IDs from the chart of accounts below (which has
been filtered to revenue accounts only)."""


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
  "service_period_start": "YYYY-MM-DD" or null,
  "service_period_end": "YYYY-MM-DD" or null,
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

SERVICE PERIOD RULES — critical for revenue recognition / matching:
- Many invoices cover a SERVICE PERIOD (e.g. "subscription Nov 2026 — Apr 2027",
  "rent for Q1 2027", "annual licence 2027", "policy period 01/11/26-30/04/27").
- If a service / coverage / subscription period is visible on the document,
  extract its start and end as ISO dates in service_period_start /
  service_period_end. Use the FIRST and LAST day of the period.
- If only a single month or year is visible (e.g. "March 2027"), set start to
  the first day and end to the last day of that month/year.
- If NO service period is visible, set BOTH service_period_start and
  service_period_end to null. Do not guess.
- These dates may differ from invoice_date — invoice_date is when the document
  was issued; service_period_* is when the goods/service is delivered. They
  drive period accruals and deferrals downstream.

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


def _coa_for_prompt(
    entity: Entity, document_type: str = DOCUMENT_TYPE_BILL,
) -> list[dict]:
    """Return a TRIMMED COA for the prompt — capped, and with only the
    fields the model actually needs (id/code/name/subtype). Bills get
    expense accounts; invoices get revenue accounts."""
    types = (
        ACCEPTABLE_CREDIT_TYPES
        if document_type == DOCUMENT_TYPE_INVOICE
        else ACCEPTABLE_DEBIT_TYPES
    )
    rows = (
        Account.objects
        .filter(
            organization=entity.organization,
            is_active=True,
            account_type__in=types,
        )
        # entity-scoped OR shared
        .filter(Q(entity=entity) | Q(entity__isnull=True))
        .order_by("code")
        .values("id", "code", "name", "account_subtype")
        [:MAX_COA_ENTRIES_IN_PROMPT]
    )
    return list(rows)


def _build_prompt(
    entity: Entity,
    document_text: Optional[str] = None,
    document_type: str = DOCUMENT_TYPE_BILL,
) -> str:
    coa = _coa_for_prompt(entity, document_type=document_type)
    standard_label = c.ACCOUNTING_STANDARD_SHORT.get(
        entity.accounting_standard or c.ACCT_STD_IFRS, "IFRS",
    )
    header = (
        _PROMPT_HEADER_INVOICE
        if document_type == DOCUMENT_TYPE_INVOICE
        else _PROMPT_HEADER
    )
    fence_label = (
        "Customer invoice text:" if document_type == DOCUMENT_TYPE_INVOICE
        else "Bill / receipt text:"
    )
    parts = [
        header,
        "",
        f"Entity functional currency: {entity.functional_currency}",
        f"Entity accounting standard: {standard_label}",
        f"  → Set accounting_standard_reasoning.standard to exactly: \"{standard_label}\".",
        "",
        "Chart of accounts (pick suggested_account_id from this list):",
        json.dumps(coa, indent=2),
    ]
    if document_text:
        parts += ["", fence_label, "```", document_text, "```"]
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


# ── Fast OCR path (RapidOCR) ──────────────────────────────────────────────
# Vision LLMs on CPU/integrated graphics are 60-180s per bill. RapidOCR
# (ONNX-based, pure Python install) extracts text in 2-5s, then a small
# text model handles the structured-extraction job. Net ~10x speed-up
# on the image / scanned-PDF paths with no quality loss on machine-
# printed receipts. The vision LLM stays as fallback for cases where
# RapidOCR can't find enough text (badly-scanned, dim, or skewed bills).

_rapidocr_instance = None


def _get_rapidocr():
    """Lazy-load RapidOCR — ONNX models load once and stay in process
    memory. First call ~1s; subsequent calls reuse the loaded models."""
    global _rapidocr_instance
    if _rapidocr_instance is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError:
            return None
        try:
            _rapidocr_instance = RapidOCR()
        except Exception:
            return None
    return _rapidocr_instance


def _rapidocr_extract_text(image_bytes: bytes) -> Optional[str]:
    """Run RapidOCR on raw image bytes (PNG/JPG/WebP). Returns the
    concatenated text, or None if RapidOCR is unavailable, the image
    can't be parsed, or no text was found."""
    ocr = _get_rapidocr()
    if ocr is None:
        return None
    try:
        from PIL import Image
        import numpy as np
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        result, _ = ocr(np.array(img))
    except Exception:
        return None
    if not result:
        return None
    lines = [r[1] for r in result if isinstance(r, (list, tuple)) and len(r) > 1 and r[1]]
    text = "\n".join(line.strip() for line in lines if line.strip())
    return text or None


def _render_pdf_first_page_to_png_b64(file_bytes: bytes) -> Optional[str]:
    """Render page 1 of a PDF to a base64-encoded PNG for the vision
    path. Used when the PDF is image-only (scanned). Returns None if
    pypdfium2 isn't installed or rendering fails — caller falls back to
    the OCR007 user-facing error in that case.

    v1: page 1 only. Most bills/receipts are single-page, and multi-page
    invoices typically carry totals + vendor info on page 1. Multi-page
    coverage would need a Tesseract step to OCR every page and feed the
    concatenated text into the TEXT path — out of scope here.

    200 DPI: ~2.78× scale up from PDF's native 72 DPI. Solid for OCR
    without ballooning the image past what local vision models accept.
    """
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return None
    try:
        pdf = pdfium.PdfDocument(file_bytes)
        if len(pdf) == 0:
            return None
        bitmap = pdf[0].render(scale=200 / 72)
        pil = bitmap.to_pil()
        buf = BytesIO()
        pil.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


# ── Public service ────────────────────────────────────────────────────────

def _use_claude() -> bool:
    return getattr(settings, "OCR_BACKEND", "ollama").lower() == "claude"


class OCRService:
    @staticmethod
    def extract_invoice(
        *,
        entity: Entity,
        file_bytes: bytes,
        content_type: str,
        document_type: str = DOCUMENT_TYPE_BILL,
    ) -> dict:
        """Run OCR + extraction for a bill/receipt or customer invoice.
        ``document_type`` selects which COA slice and prompt to use:
        "bill" (expense accounts, default) or "invoice" (revenue accounts).
        Returns a dict with structured fields plus ``model_used`` and
        ``mode`` ('text' | 'vision' | 'ocr-text').
        """
        if _use_claude():
            from .ocr_claude import ClaudeOCRBackend
            return ClaudeOCRBackend.extract_invoice(
                entity=entity, file_bytes=file_bytes, content_type=content_type,
                document_type=document_type,
            )
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
                prompt = _build_prompt(entity, document_text=text, document_type=document_type)
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

        # Vision path for images and scanned/image-only PDFs.
        # Resolve raw bytes (for RapidOCR) and base64 (for the LLM-vision
        # fallback) up front — both paths may be exercised below.
        if is_pdf:
            b64 = _render_pdf_first_page_to_png_b64(file_bytes)
            if b64 is None:
                raise ValidationError(
                    "PDF appears scanned/image-only and rendering to image "
                    "failed. Make sure pypdfium2 is installed (pip install "
                    "pypdfium2), or convert the PDF to PNG/JPG and re-upload.",
                    code="OCR007",
                )
            image_bytes_raw = base64.b64decode(b64)
        else:
            image_bytes_raw = file_bytes
            b64 = base64.b64encode(file_bytes).decode("ascii")

        # Fast path: RapidOCR (~2-5s on CPU) → text model. Beats running
        # the vision LLM directly by ~10x on machines without a GPU,
        # with negligible quality loss for clean machine-printed bills.
        ocr_text = _rapidocr_extract_text(image_bytes_raw)
        if ocr_text and len(ocr_text) >= MIN_PDF_TEXT_CHARS:
            prompt = _build_prompt(entity, document_text=ocr_text, document_type=document_type)
            model = settings.OLLAMA_TEXT_MODEL
            data = _ollama_chat(model=model, prompt=prompt)
            data["model_used"] = f"{model} + rapidocr"
            data["mode"] = "ocr-text"
            normalised = _normalise(data)
            _backfill_amounts_from_text(normalised, ocr_text)
            return normalised

        # Fallback: vision LLM. Slower but more robust on poor-quality
        # scans, handwritten notes, or layouts RapidOCR can't parse.
        prompt = _build_prompt(entity, document_type=document_type)
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
        document_type: str = DOCUMENT_TYPE_BILL,
    ) -> Iterator[dict]:
        """Streaming variant — yields phase + token events while the LLM
        works, then a final ``{"type": "result", "data": <normalised>}``.

        ``document_type`` selects bill (default, expense COA) or invoice
        (revenue COA, AR perspective).

        Events:
            {"type": "phase",  "phase": str, "pct": int}
            {"type": "token",  "n": int}
            {"type": "result", "data": dict}    # terminal success
            {"type": "error",  "message": str}  # terminal failure
        """
        if _use_claude():
            from .ocr_claude import ClaudeOCRBackend
            yield from ClaudeOCRBackend.extract_invoice_streaming(
                entity=entity, file_bytes=file_bytes, content_type=content_type,
                document_type=document_type,
            )
            return
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
                prompt = _build_prompt(entity, document_text=text, document_type=document_type)
                model = settings.OLLAMA_TEXT_MODEL
                mode = "text"
                text_for_backfill = text
            else:
                yield {"type": "phase",
                       "phase": "Rendering scanned PDF to image…", "pct": 6}
                image_b64 = _render_pdf_first_page_to_png_b64(file_bytes)
                if image_b64 is None:
                    yield {"type": "error", "message":
                           "PDF appears scanned and rendering failed. "
                           "Make sure pypdfium2 is installed, or convert "
                           "the PDF to PNG/JPG and re-upload."}
                    return
                # Fast path: RapidOCR on the rendered page → text model
                yield {"type": "phase",
                       "phase": "Running fast OCR (RapidOCR)…", "pct": 8}
                ocr_text = _rapidocr_extract_text(base64.b64decode(image_b64))
                if ocr_text and len(ocr_text) >= MIN_PDF_TEXT_CHARS:
                    prompt = _build_prompt(entity, document_text=ocr_text, document_type=document_type)
                    model = settings.OLLAMA_TEXT_MODEL
                    mode = "ocr-text"
                    text_for_backfill = ocr_text
                    image_b64 = None
                else:
                    yield {"type": "phase",
                           "phase": "OCR text sparse — falling back to vision model…",
                           "pct": 10}
                    prompt = _build_prompt(entity, document_type=document_type)
                    model = settings.OLLAMA_VISION_MODEL
                    mode = "vision"
        else:
            # Image upload — try RapidOCR first, then fall back to vision LLM
            yield {"type": "phase",
                   "phase": "Running fast OCR (RapidOCR)…", "pct": 6}
            ocr_text = _rapidocr_extract_text(file_bytes)
            if ocr_text and len(ocr_text) >= MIN_PDF_TEXT_CHARS:
                prompt = _build_prompt(entity, document_text=ocr_text, document_type=document_type)
                model = settings.OLLAMA_TEXT_MODEL
                mode = "ocr-text"
                text_for_backfill = ocr_text
                image_b64 = None
            else:
                yield {"type": "phase",
                       "phase": "OCR text sparse — falling back to vision model…",
                       "pct": 8}
                image_b64 = base64.b64encode(file_bytes).decode("ascii")
                prompt = _build_prompt(entity, document_type=document_type)
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
        "service_period_start": data.get("service_period_start") or None,
        "service_period_end": data.get("service_period_end") or None,
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
