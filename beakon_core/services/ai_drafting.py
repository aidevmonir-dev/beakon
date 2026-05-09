"""AIBillDraftingService — turn an OCR extraction into a draft JE.

Workflow:
    1. Caller passes a file (image or PDF) + entity + payment style.
    2. ``OCRService.extract_invoice`` returns structured data + a
       suggested expense account_id.
    3. We build a 2-line JE:
           DR  suggested expense account     (extracted total)
           CR  Accounts Payable / Cash       (extracted total)
    4. JE is created via ``JournalService.create_draft`` so it goes
       through the same validation, period attach, FX capture, and
       audit-action plumbing as a manual entry.
    5. The uploaded file is attached via ``SourceDocumentService``.
    6. An ``AuditEvent`` row is logged with ``actor_type='ai'`` and the
       full extraction payload — Thomas can answer "what did the AI
       say" forever.

The user always reviews the draft and submits → approves → posts.
Nothing is auto-posted.
"""
from __future__ import annotations

from datetime import date as dt_date, datetime
from decimal import Decimal
from io import BytesIO
from typing import Optional

from django.db import transaction
from django.db.models import Q

from audit.services import log_event

from .. import constants as c
from ..exceptions import ValidationError
from ..models import Account, Entity, JournalEntry, Vendor
from .documents import SourceDocumentService
from .journal import JournalService
from .ocr import OCRService


PAYMENT_AP = "ap"      # bill to be paid later → CR Accounts Payable
PAYMENT_CASH = "cash"  # paid immediately → CR Cash/Bank
PAYMENT_CHOICES = (PAYMENT_AP, PAYMENT_CASH)


class AIBillDraftingService:
    @staticmethod
    def draft_from_bill(
        *,
        entity: Entity,
        file_bytes: bytes,
        filename: str,
        content_type: str,
        user=None,
        payment_via: str = PAYMENT_AP,
        bank_account_id: Optional[int] = None,
        memo_prefix: str = "",
    ) -> dict:
        """Sync convenience wrapper: OCR → draft. Use ``draft_from_extraction``
        directly when you already have the extracted dict (e.g. the
        streaming view, which extracts in a generator and creates the JE
        afterwards).
        """
        extracted = OCRService.extract_invoice(
            entity=entity,
            file_bytes=file_bytes,
            content_type=content_type,
        )
        return AIBillDraftingService.draft_from_extraction(
            entity=entity,
            extracted=extracted,
            file_bytes=file_bytes,
            filename=filename,
            content_type=content_type,
            user=user,
            payment_via=payment_via,
            bank_account_id=bank_account_id,
            memo_prefix=memo_prefix,
        )

    @staticmethod
    @transaction.atomic
    def draft_from_extraction(
        *,
        entity: Entity,
        extracted: dict,
        file_bytes: bytes,
        filename: str,
        content_type: str,
        user=None,
        payment_via: str = PAYMENT_AP,
        bank_account_id: Optional[int] = None,
        memo_prefix: str = "",
    ) -> dict:
        """Given an already-extracted dict, create the draft JE, attach the
        source file, and write the audit trail. Wrapped in a single atomic
        transaction so a failure rolls back everything.

        Returns::
            {"entry": JournalEntry, "extraction": dict, "warnings": [str, ...]}
        """
        if payment_via not in PAYMENT_CHOICES:
            raise ValidationError(
                f"payment_via must be one of {PAYMENT_CHOICES}; got {payment_via!r}",
                code="OCR010",
            )

        warnings: list[str] = []

        # ── 2. Resolve accounts ─────────────────────────────────────────
        debit_account = _resolve_debit_account(entity, extracted)

        credit_account = _resolve_credit_account(
            entity=entity,
            payment_via=payment_via,
            bank_account_id=bank_account_id,
        )
        if credit_account is None:
            raise ValidationError(
                f"No account found for payment_via={payment_via!r}. "
                "Configure Accounts Payable (or pick a bank account).",
                code="OCR012",
            )

        # ── 3. Resolve fields with safe fallbacks ───────────────────────
        total = extracted["total"]
        if total <= Decimal("0"):
            raise ValidationError(
                "Extracted total is zero or missing — cannot draft a JE.",
                code="OCR013",
                details={"extraction": extracted},
            )

        invoice_date = _parse_date(extracted.get("invoice_date")) or dt_date.today()
        if extracted.get("invoice_date") is None:
            warnings.append("Invoice date not detected — using today's date.")

        currency = extracted.get("currency") or entity.functional_currency
        if not extracted.get("currency"):
            warnings.append(
                f"Currency not detected — defaulting to entity functional ({currency})."
            )

        if extracted.get("confidence", 0.0) < 0.5:
            warnings.append(
                f"Low overall confidence ({extracted['confidence']:.2f}) — "
                "verify all fields carefully before submitting."
            )
        if extracted.get("confidence_in_account", 0.0) < 0.5:
            warnings.append(
                f"Low confidence in suggested account "
                f"({extracted['confidence_in_account']:.2f}) — please verify."
            )

        # ── Multi-period revenue-recognition flag ──────────────────────
        # Per Thomas's WhatsApp (2026-04-25, $1,000 Nov–Apr example):
        # when the AI extracts a service period that spans more than one
        # accounting period, surface a clear warning to the reviewer so
        # they can apply the right deferral / accrual treatment. We don't
        # auto-split yet — that requires the rules registry Thomas wants
        # to design with us. For now: detect, flag, let the human decide.
        sp_start = _parse_date(extracted.get("service_period_start"))
        sp_end = _parse_date(extracted.get("service_period_end"))
        if sp_start and sp_end and sp_end >= sp_start:
            # Distinct calendar months covered, inclusive on both ends.
            months = (sp_end.year - sp_start.year) * 12 + (sp_end.month - sp_start.month) + 1
            if months > 1:
                std_label = c.ACCOUNTING_STANDARD_SHORT.get(
                    entity.accounting_standard or c.ACCT_STD_IFRS, "IFRS",
                )
                warnings.append(
                    f"Service period {sp_start.isoformat()} to {sp_end.isoformat()} "
                    f"spans {months} months. Under {std_label} this typically requires "
                    f"period allocation: recognise the portion that falls in the current "
                    f"period as expense, defer the rest to a prepaid asset and amortise "
                    f"over the remaining months. AI proposed a single-period booking — "
                    f"reviewer to apply the deferral before posting."
                )

        # ── 4. Build the JE ─────────────────────────────────────────────
        memo = (
            f"{memo_prefix}"
            f"{extracted.get('vendor_name') or 'Unknown vendor'}"
            f" — {extracted.get('description') or 'bill'}"
            + (f" (#{extracted['invoice_number']})" if extracted.get("invoice_number") else "")
        ).strip(" —")

        ai_line_desc = (
            f"AI-extracted [{extracted['model_used']}, "
            f"{extracted['mode']}, conf {extracted['confidence']:.2f}]"
        )

        # Try to link to an existing Vendor by case-insensitive name/legal_name
        # match. If no match, leave unlinked — user can create the vendor and
        # re-link from the JE detail page. (Fuzzy match is v2.)
        vendor_match = None
        vendor_name = (extracted.get("vendor_name") or "").strip()
        if vendor_name:
            vendor_match = (
                Vendor.objects
                .filter(organization=entity.organization, is_active=True)
                .filter(
                    Q(name__iexact=vendor_name) | Q(legal_name__iexact=vendor_name),
                )
                .first()
            )
            if vendor_match is None:
                warnings.append(
                    f"No Vendor record matched '{vendor_name}'. "
                    "Create one in Vendors and re-link from this JE if desired."
                )

        entry = JournalService.create_draft(
            organization=entity.organization,
            entity=entity,
            date=invoice_date,
            lines=[
                {
                    "account_id": debit_account.id,
                    "debit": total,
                    "currency": currency,
                    "description": ai_line_desc,
                },
                {
                    "account_id": credit_account.id,
                    "credit": total,
                    "currency": currency,
                    "description": ai_line_desc,
                },
            ],
            user=user,
            memo=memo[:500],
            reference=extracted.get("invoice_number") or "",
            source_type=c.SOURCE_BILL,
            source_ref=(extracted.get("vendor_name") or "")[:255],
            currency=currency,
        )
        if vendor_match is not None:
            entry.vendor = vendor_match
            entry.save(update_fields=["vendor", "updated_at"])

        # ── 5. Attach source file ───────────────────────────────────────
        SourceDocumentService.attach(
            journal_entry=entry,
            file=BytesIO(file_bytes),
            filename=filename,
            content_type=content_type,
            user=user,
            description=f"Source bill — extracted by {extracted['model_used']}",
        )

        # ── 6. Audit log (actor_type='ai') ──────────────────────────────
        log_event(
            organization=entity.organization,
            action="create",
            object_type="JournalEntry",
            object_id=entry.id,
            object_repr=entry.entry_number,
            actor=user,
            actor_type="ai",
            metadata={
                "source": "ai_bill_drafting",
                "model": extracted["model_used"],
                "mode": extracted["mode"],
                "confidence": extracted["confidence"],
                "confidence_in_account": extracted["confidence_in_account"],
                "extracted_vendor": extracted.get("vendor_name"),
                "extracted_total": str(extracted["total"]),
                "extracted_currency": extracted.get("currency"),
                "suggested_account_id": extracted.get("suggested_account_id"),
                "suggested_account_reasoning": extracted.get("suggested_account_reasoning"),
                "accounting_standard_reasoning": extracted.get("accounting_standard_reasoning"),
                "entity_accounting_standard": entity.accounting_standard,
                "service_period_start": extracted.get("service_period_start"),
                "service_period_end": extracted.get("service_period_end"),
                "warnings": warnings,
            },
        )

        return {"entry": entry, "extraction": extracted, "warnings": warnings}


# ── Account resolution ────────────────────────────────────────────────────

def _resolve_debit_account(entity: Entity, extracted: dict) -> Account:
    """Use the AI's suggestion if it's a real account on this entity;
    otherwise fall back to an 'Uncategorized Expense' account, creating
    it if necessary."""
    suggested_id = extracted.get("suggested_account_id")
    if suggested_id:
        acc = (
            Account.objects
            .filter(
                Q(entity=entity) | Q(entity__isnull=True),
                organization=entity.organization,
                id=suggested_id,
                is_active=True,
            )
            .first()
        )
        if acc:
            return acc
    # Fallback by name match — common COA practice
    fallback = (
        Account.objects
        .filter(
            Q(entity=entity) | Q(entity__isnull=True),
            organization=entity.organization,
            is_active=True,
            account_type=c.ACCOUNT_TYPE_EXPENSE,
        )
        .filter(Q(name__icontains="uncategorized") | Q(name__icontains="other expense"))
        .order_by("code")
        .first()
    )
    if fallback:
        return fallback

    return Account.objects.create(
        organization=entity.organization,
        entity=entity,
        name="Uncategorized Expense",
        account_type=c.ACCOUNT_TYPE_EXPENSE,
        account_subtype="other_expense",
        normal_balance=c.NORMAL_BALANCE_DEBIT,
        code="UNCAT",
        is_active=True,
    )


def _resolve_credit_account(
    *, entity: Entity, payment_via: str, bank_account_id: Optional[int],
) -> Optional[Account]:
    if payment_via == PAYMENT_CASH and bank_account_id is not None:
        return Account.objects.filter(
            organization=entity.organization, id=bank_account_id, is_active=True,
        ).first()
    if payment_via == PAYMENT_CASH:
        # Fallback: first active bank/cash account on the entity
        return (
            Account.objects
            .filter(
                Q(entity=entity) | Q(entity__isnull=True),
                organization=entity.organization,
                is_active=True,
                account_subtype__in=("bank", "cash"),
            )
            .order_by("code")
            .first()
        )
    # AP path
    return (
        Account.objects
        .filter(
            Q(entity=entity) | Q(entity__isnull=True),
            organization=entity.organization,
            is_active=True,
            account_subtype="accounts_payable",
        )
        .order_by("code")
        .first()
    )


def _parse_date(s) -> Optional[dt_date]:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None
