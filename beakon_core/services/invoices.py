"""InvoiceService — AR (accounts receivable) workflow.

Mirror of BillService:
    issue(invoice)        → DR AR / CR Revenue (per line)
    record_payment(invoice, ...) → DR Bank / CR AR

System creates+submits both JEs; user approves+posts. Same self-approval-
safe pattern as bills.
"""
from decimal import Decimal
from datetime import date as dt_date
from typing import Optional

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .. import constants as c
from ..exceptions import InvalidTransition, ValidationError
from ..models import (
    Account, Customer, Entity, Invoice, InvoiceLine, JournalEntry,
)
from ..models.ar import (
    INVOICE_CANCELLED, INVOICE_DRAFT, INVOICE_EDITABLE, INVOICE_ISSUED,
    INVOICE_PAID, INVOICE_PENDING_APPROVAL, INVOICE_REJECTED,
    INVOICE_TRANSITIONS,
)
from .journal import JournalService


ZERO = Decimal("0")


class InvoiceService:
    # ── Creation / editing ──────────────────────────────────────────
    @staticmethod
    @transaction.atomic
    def create_draft(
        *,
        organization,
        entity: Entity,
        customer: Customer,
        invoice_date: dt_date,
        due_date: Optional[dt_date] = None,
        invoice_number: str = "",
        currency: Optional[str] = None,
        lines: list[dict] = None,
        subtotal: Optional[Decimal] = None,
        tax_amount: Optional[Decimal] = None,
        total: Optional[Decimal] = None,
        description: str = "",
        user=None,
    ) -> Invoice:
        if customer.organization_id != organization.id:
            raise ValidationError("Customer does not belong to this organization.",
                                   code="AR001")
        if entity.organization_id != organization.id:
            raise ValidationError("Entity does not belong to this organization.",
                                   code="AR002")
        if not lines:
            raise ValidationError("An invoice needs at least one line.", code="AR003")

        currency = (currency or customer.default_currency
                    or entity.functional_currency).upper()
        if due_date is None:
            from datetime import timedelta
            due_date = invoice_date + timedelta(days=customer.default_payment_terms_days)

        line_sum = sum(
            (Decimal(str(ln.get("amount") or 0)) for ln in lines),
            Decimal("0"),
        )
        subtotal = Decimal(subtotal) if subtotal is not None else line_sum
        tax_amount = Decimal(tax_amount) if tax_amount is not None else Decimal("0")
        total = Decimal(total) if total is not None else (subtotal + tax_amount)

        invoice = Invoice.objects.create(
            organization=organization, entity=entity, customer=customer,
            reference=_next_invoice_ref(organization),
            invoice_number=invoice_number or "",
            invoice_date=invoice_date, due_date=due_date,
            currency=currency,
            subtotal=subtotal, tax_amount=tax_amount, total=total,
            status=INVOICE_DRAFT,
            description=description,
            created_by=user,
        )
        for i, ln in enumerate(lines):
            _create_line(invoice, ln, idx=i)
        return invoice

    @staticmethod
    @transaction.atomic
    def replace_lines(invoice: Invoice, lines: list[dict]) -> Invoice:
        if invoice.status not in INVOICE_EDITABLE:
            raise ValidationError(
                f"Cannot edit lines on a {invoice.status} invoice.",
                code="AR004",
            )
        invoice.lines.all().delete()
        for i, ln in enumerate(lines):
            _create_line(invoice, ln, idx=i)
        new_sub = sum((line.amount for line in invoice.lines.all()), Decimal("0"))
        invoice.subtotal = new_sub
        invoice.total = new_sub + invoice.tax_amount
        invoice.save(update_fields=["subtotal", "total", "updated_at"])
        return invoice

    # ── State transitions ──────────────────────────────────────────
    @staticmethod
    @transaction.atomic
    def submit_for_approval(invoice: Invoice, user=None) -> Invoice:
        _require(invoice.status, INVOICE_PENDING_APPROVAL)
        if invoice.lines.count() == 0:
            raise ValidationError("Invoice has no lines.", code="AR005")
        if invoice.total <= 0:
            raise ValidationError("Invoice total must be > 0.", code="AR006")
        line_sum = sum((ln.amount for ln in invoice.lines.all()), Decimal("0"))
        if abs(line_sum - invoice.subtotal) > Decimal("0.01"):
            raise ValidationError(
                f"Invoice line sum ({line_sum}) doesn't match subtotal ({invoice.subtotal}).",
                code="AR007",
            )
        if abs((invoice.subtotal + invoice.tax_amount) - invoice.total) > Decimal("0.01"):
            raise ValidationError(
                f"subtotal+tax != total.", code="AR008",
            )
        _resolve_ar_account(invoice.entity)  # verify exists

        invoice.status = INVOICE_PENDING_APPROVAL
        invoice.submitted_by = user
        invoice.submitted_at = timezone.now()
        invoice.save(update_fields=["status", "submitted_by", "submitted_at", "updated_at"])
        return invoice

    @staticmethod
    @transaction.atomic
    def return_to_draft(invoice: Invoice, user=None) -> Invoice:
        _require(invoice.status, INVOICE_DRAFT)
        invoice.status = INVOICE_DRAFT
        invoice.save(update_fields=["status", "updated_at"])
        return invoice

    @staticmethod
    @transaction.atomic
    def reject(invoice: Invoice, user=None, reason: str = "") -> Invoice:
        _require(invoice.status, INVOICE_REJECTED)
        invoice.status = INVOICE_REJECTED
        invoice.rejected_by = user
        invoice.rejected_at = timezone.now()
        invoice.rejection_reason = reason
        invoice.save(update_fields=[
            "status", "rejected_by", "rejected_at", "rejection_reason", "updated_at",
        ])
        return invoice

    @staticmethod
    @transaction.atomic
    def issue(invoice: Invoice, user=None) -> Invoice:
        """Post the issuance JE (DR AR / CR Revenue) and move to issued."""
        _require(invoice.status, INVOICE_ISSUED)
        ar_account = _resolve_ar_account(invoice.entity)
        if ar_account is None:
            raise ValidationError(
                f"Entity {invoice.entity.code} has no accounts_receivable account.",
                code="AR010",
            )

        je_lines = [{
            "account_id": ar_account.id,
            "debit": invoice.total,
            "currency": invoice.currency,
            "description": f"AR from {invoice.customer.code} {invoice.reference}",
        }]
        for ln in invoice.lines.select_related("revenue_account").order_by("line_order"):
            je_lines.append({
                "account_id": ln.revenue_account_id,
                "credit": ln.amount,
                "currency": invoice.currency,
                "description": f"{invoice.customer.code} {invoice.reference}: {ln.description}",
            })
        # v1 lumps tax into the first line's revenue account; v2 will split
        # to a tax_payable liability when the tax engine ships.
        if invoice.tax_amount > 0:
            je_lines.append({
                "account_id": invoice.lines.first().revenue_account_id,
                "credit": invoice.tax_amount,
                "currency": invoice.currency,
                "description": f"{invoice.customer.code} {invoice.reference}: tax",
            })

        je = JournalService.create_draft(
            organization=invoice.organization, entity=invoice.entity,
            date=invoice.invoice_date,
            lines=je_lines,
            user=None,
            memo=f"Invoice {invoice.reference} · {invoice.customer.name}" + (
                f" · {invoice.description[:100]}" if invoice.description else ""
            ),
            reference=invoice.invoice_number or invoice.reference,
            source_type=c.SOURCE_INVOICE,
            source_id=invoice.id,
            source_ref=invoice.reference,
            currency=invoice.currency,
        )
        je.customer = invoice.customer
        je.save(update_fields=["customer", "updated_at"])
        JournalService.submit_for_approval(je, user=None)
        JournalService.approve(je, user=user)
        JournalService.post(je, user=user)

        invoice.status = INVOICE_ISSUED
        invoice.issued_by = user
        invoice.issued_at = timezone.now()
        invoice.issued_journal_entry = je
        invoice.save(update_fields=[
            "status", "issued_by", "issued_at",
            "issued_journal_entry", "updated_at",
        ])
        return invoice

    @staticmethod
    @transaction.atomic
    def record_payment(
        invoice: Invoice,
        *,
        bank_account: Account,
        payment_date: dt_date,
        user=None,
        reference: str = "",
    ) -> Invoice:
        """Post the payment-receipt JE (DR Bank / CR AR) and move to paid."""
        _require(invoice.status, INVOICE_PAID)
        if bank_account.organization_id != invoice.organization_id:
            raise ValidationError("Bank account not in this organization.", code="AR011")
        ar_account = _resolve_ar_account(invoice.entity)
        if ar_account is None:
            raise ValidationError(
                f"Entity {invoice.entity.code} has no accounts_receivable account.",
                code="AR010",
            )

        je_lines = [
            {"account_id": bank_account.id, "debit": invoice.total,
             "currency": invoice.currency,
             "description": f"Receipt from {invoice.customer.code} {invoice.reference}"
                             + (f" ref {reference}" if reference else "")},
            {"account_id": ar_account.id, "credit": invoice.total,
             "currency": invoice.currency,
             "description": f"Settle {invoice.customer.code} {invoice.reference}"},
        ]
        je = JournalService.create_draft(
            organization=invoice.organization, entity=invoice.entity,
            date=payment_date,
            lines=je_lines,
            user=None,
            memo=f"Receipt for invoice {invoice.reference} from {invoice.customer.name}",
            reference=reference or invoice.invoice_number or invoice.reference,
            source_type=c.SOURCE_INVOICE_PAYMENT,
            source_id=invoice.id,
            source_ref=invoice.reference,
            currency=invoice.currency,
        )
        je.customer = invoice.customer
        je.save(update_fields=["customer", "updated_at"])
        JournalService.submit_for_approval(je, user=None)
        JournalService.approve(je, user=user)
        JournalService.post(je, user=user)

        invoice.status = INVOICE_PAID
        invoice.paid_by = user
        invoice.paid_at = timezone.now()
        invoice.payment_date = payment_date
        invoice.payment_bank_account = bank_account
        invoice.payment_reference = reference
        invoice.payment_journal_entry = je
        invoice.save(update_fields=[
            "status", "paid_by", "paid_at",
            "payment_date", "payment_bank_account", "payment_reference",
            "payment_journal_entry", "updated_at",
        ])
        return invoice

    @staticmethod
    @transaction.atomic
    def cancel(invoice: Invoice, user=None) -> Invoice:
        _require(invoice.status, INVOICE_CANCELLED)
        invoice.status = INVOICE_CANCELLED
        invoice.cancelled_by = user
        invoice.cancelled_at = timezone.now()
        invoice.save(update_fields=[
            "status", "cancelled_by", "cancelled_at", "updated_at",
        ])
        return invoice


# ── Helpers ─────────────────────────────────────────────────────────────

def _require(from_status: str, to_status: str) -> None:
    if to_status not in INVOICE_TRANSITIONS.get(from_status, set()):
        raise InvalidTransition(
            f"Cannot move an Invoice from '{from_status}' to '{to_status}'.",
            code="AR020",
            details={"from": from_status, "to": to_status},
        )


def _next_invoice_ref(organization) -> str:
    last = (
        Invoice.objects.filter(organization=organization)
        .order_by("-id").values_list("reference", flat=True).first()
    )
    if last and last.startswith("INV-"):
        try:
            n = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            n = 1
    else:
        n = 1
    return f"INV-{n:06d}"


def _resolve_ar_account(entity: Entity) -> Optional[Account]:
    return (
        Account.objects
        .filter(
            Q(entity=entity) | Q(entity__isnull=True),
            organization=entity.organization,
            is_active=True,
            account_subtype="accounts_receivable",
        )
        .order_by("code")
        .first()
    )


def _create_line(invoice: Invoice, spec: dict, idx: int) -> InvoiceLine:
    amount = Decimal(str(spec.get("amount") or 0))
    qty = Decimal(str(spec.get("quantity") or 1))
    unit_price = Decimal(str(spec.get("unit_price") or (amount / qty if qty else 0)))
    return InvoiceLine.objects.create(
        invoice=invoice,
        revenue_account_id=spec["revenue_account_id"],
        description=spec.get("description", "")[:500],
        quantity=qty,
        unit_price=unit_price,
        amount=amount,
        line_order=spec.get("line_order", idx),
    )
