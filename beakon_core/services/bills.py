"""BillService — AP (accounts payable) workflow.

State machine:
    draft → pending_approval → approved → paid
                            → rejected → draft
    draft → cancelled
    pending_approval → cancelled

Accounting side-effects (per our agreed treatment — Thomas to review):
    approve(bill):
        Creates + posts the ACCRUAL journal entry:
            DR  each BillLine.expense_account        (bill line amount)
            CR  entity's Accounts Payable account    (bill.total)
        System creates + submits; user approves + posts — no self-approval.

    mark_paid(bill, bank_account, date):
        Creates + posts the PAYMENT journal entry:
            DR  entity's Accounts Payable account    (bill.total)
            CR  bank_account                         (bill.total)

Both JEs go through JournalService so they pick up: entry numbering,
period attach, FX rate capture, validation, and the ApprovalAction audit
row. The Bill itself keeps its own status + actor stamps on top.
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
    Account, Bill, BillLine, Counterparty, Entity, JournalEntry, Vendor,
)
from ..models.ap import (
    BILL_APPROVED, BILL_CANCELLED, BILL_DRAFT, BILL_EDITABLE, BILL_PAID,
    BILL_PENDING_APPROVAL, BILL_REJECTED, BILL_TRANSITIONS,
)
from .journal import JournalService


ZERO = Decimal("0")


class BillService:
    # ── Creation / editing ──────────────────────────────────────────
    @staticmethod
    @transaction.atomic
    def create_draft(
        *,
        organization,
        entity: Entity,
        vendor: Vendor,
        invoice_date: dt_date,
        due_date: Optional[dt_date] = None,
        bill_number: str = "",
        currency: Optional[str] = None,
        lines: list[dict] = None,
        subtotal: Optional[Decimal] = None,
        tax_amount: Optional[Decimal] = None,
        total: Optional[Decimal] = None,
        description: str = "",
        explanation: str = "",
        user=None,
    ) -> Bill:
        """Create a draft Bill with its lines. ``lines`` is a list of::
            {"expense_account_id", "description", "quantity"?, "unit_price"?, "amount"}
        """
        if vendor.organization_id != organization.id:
            raise ValidationError("Vendor does not belong to this organization.",
                                   code="AP001")
        if entity.organization_id != organization.id:
            raise ValidationError("Entity does not belong to this organization.",
                                   code="AP002")
        if not lines:
            raise ValidationError("A bill needs at least one line.", code="AP003")

        currency = (currency or vendor.default_currency
                    or entity.functional_currency).upper()
        if due_date is None:
            # Invoice date + vendor's net-days
            from datetime import timedelta
            due_date = invoice_date + timedelta(days=vendor.default_payment_terms_days)

        # Compute subtotal from lines if not given. When per-line tax_amount /
        # tax_code is supplied and the caller didn't pass an explicit top-level
        # tax_amount, sum the per-line tax so totals reconcile automatically.
        line_sum = sum(
            (Decimal(str(ln.get("amount") or 0)) for ln in lines),
            Decimal("0"),
        )
        line_tax_sum = sum(
            (
                Decimal(str(ln["tax_amount"])) if ln.get("tax_amount") is not None
                else _derive_tax_amount(ln.get("tax_code_id"), Decimal(str(ln.get("amount") or 0)))
                for ln in lines
            ),
            Decimal("0"),
        )
        subtotal = Decimal(subtotal) if subtotal is not None else line_sum
        tax_amount = (
            Decimal(tax_amount) if tax_amount is not None else line_tax_sum
        )
        total = Decimal(total) if total is not None else (subtotal + tax_amount)

        bill = Bill.objects.create(
            organization=organization, entity=entity, vendor=vendor,
            reference=_next_bill_ref(organization),
            bill_number=bill_number or "",
            invoice_date=invoice_date, due_date=due_date,
            currency=currency,
            subtotal=subtotal, tax_amount=tax_amount, total=total,
            status=BILL_DRAFT,
            description=description,
            explanation=explanation,
            created_by=user,
        )
        for i, ln in enumerate(lines):
            _create_line(bill, ln, idx=i)
        return bill

    @staticmethod
    @transaction.atomic
    def replace_lines(bill: Bill, lines: list[dict]) -> Bill:
        if bill.status not in BILL_EDITABLE:
            raise ValidationError(
                f"Cannot edit lines on a {bill.status} bill.",
                code="AP004",
            )
        bill.lines.all().delete()
        for i, ln in enumerate(lines):
            _create_line(bill, ln, idx=i)
        # Recompute subtotal from lines; keep tax; recompute total
        new_sub = sum((line.amount for line in bill.lines.all()), Decimal("0"))
        bill.subtotal = new_sub
        bill.total = new_sub + bill.tax_amount
        bill.save(update_fields=["subtotal", "total", "updated_at"])
        return bill

    # ── State transitions ──────────────────────────────────────────
    @staticmethod
    @transaction.atomic
    def submit_for_approval(bill: Bill, user=None) -> Bill:
        _require(bill.status, BILL_PENDING_APPROVAL)
        if bill.lines.count() == 0:
            raise ValidationError("Bill has no lines.", code="AP005")
        if bill.total <= 0:
            raise ValidationError("Bill total must be > 0.", code="AP006")
        # Line sum must match subtotal within a small tolerance
        line_sum = sum((ln.amount for ln in bill.lines.all()), Decimal("0"))
        if abs(line_sum - bill.subtotal) > Decimal("0.01"):
            raise ValidationError(
                f"Bill line sum ({line_sum}) doesn't match subtotal ({bill.subtotal}).",
                code="AP007",
            )
        if abs((bill.subtotal + bill.tax_amount) - bill.total) > Decimal("0.01"):
            raise ValidationError(
                f"subtotal+tax ({bill.subtotal}+{bill.tax_amount}) != total ({bill.total}).",
                code="AP008",
            )
        _resolve_ap_account(bill.entity)  # verify exists before submitting

        bill.status = BILL_PENDING_APPROVAL
        bill.submitted_by = user
        bill.submitted_at = timezone.now()
        bill.save(update_fields=["status", "submitted_by", "submitted_at", "updated_at"])
        return bill

    @staticmethod
    @transaction.atomic
    def return_to_draft(bill: Bill, user=None) -> Bill:
        _require(bill.status, BILL_DRAFT)
        bill.status = BILL_DRAFT
        bill.save(update_fields=["status", "updated_at"])
        return bill

    @staticmethod
    @transaction.atomic
    def reject(bill: Bill, user=None, reason: str = "") -> Bill:
        _require(bill.status, BILL_REJECTED)
        bill.status = BILL_REJECTED
        bill.rejected_by = user
        bill.rejected_at = timezone.now()
        bill.rejection_reason = reason
        bill.save(update_fields=[
            "status", "rejected_by", "rejected_at", "rejection_reason", "updated_at",
        ])
        return bill

    @staticmethod
    @transaction.atomic
    def approve(bill: Bill, user=None) -> Bill:
        """Post the accrual JE and move the bill to approved.

        The JE is SYSTEM-created/submitted and USER-approved/posted, so the
        JournalService self-approval guard doesn't fire.
        """
        _require(bill.status, BILL_APPROVED)
        ap_account = _resolve_ap_account(bill.entity)
        if ap_account is None:
            raise ValidationError(
                f"Entity {bill.entity.code} has no accounts_payable account.",
                code="AP010",
            )
        # The vendor IS the counterparty on a bill. If a Counterparty master
        # row matches the vendor code, stamp every JE line with its FK so the
        # CP dimension validation rule (workbook 09) is satisfied automatically.
        cp_id = _resolve_counterparty_for_vendor(bill.vendor, bill.organization_id)

        # Build JE lines: one DR per bill line + per-tax-code DR (Input VAT)
        # routed to the linked input_account when set + one CR on AP for total.
        #
        # Per-line tax behaviour:
        #   - Line has tax_code WITH input_account  → DR input_account once per
        #     code (summed) — recoverable VAT.
        #   - Line has tax_amount > 0 but NO input_account  → DR the line's own
        #     expense_account (legacy / non-recoverable / VAT baked into cost).
        #   - Bill.tax_amount > 0 but no per-line tax  → DR first expense
        #     account (legacy compatibility for hand-entered totals).
        je_lines = []
        line_tax_by_input_account: dict[int, Decimal] = {}
        non_recoverable_tax: Decimal = Decimal("0")
        line_level_tax_total: Decimal = Decimal("0")

        for ln in (
            bill.lines
            .select_related("expense_account", "tax_code", "tax_code__input_account")
            .order_by("line_order")
        ):
            je_lines.append({
                "account_id": ln.expense_account_id,
                "debit": ln.amount,
                "currency": bill.currency,
                "description": f"{bill.vendor.code} {bill.reference}: {ln.description}",
                "dimension_counterparty_id": cp_id,
            })
            if ln.tax_amount and ln.tax_amount > 0:
                line_level_tax_total += ln.tax_amount
                if ln.tax_code and ln.tax_code.input_account_id:
                    line_tax_by_input_account.setdefault(
                        ln.tax_code.input_account_id, Decimal("0"),
                    )
                    line_tax_by_input_account[ln.tax_code.input_account_id] += ln.tax_amount
                else:
                    # Non-recoverable: lump onto the expense account that bore the cost.
                    je_lines.append({
                        "account_id": ln.expense_account_id,
                        "debit": ln.tax_amount,
                        "currency": bill.currency,
                        "description": f"{bill.vendor.code} {bill.reference}: VAT (non-recoverable)",
                        "dimension_counterparty_id": cp_id,
                    })
                    non_recoverable_tax += ln.tax_amount

        # Per-tax-code recoverable Input VAT lines.
        for input_acct_id, total_for_code in line_tax_by_input_account.items():
            je_lines.append({
                "account_id": input_acct_id,
                "debit": total_for_code,
                "currency": bill.currency,
                "description": f"{bill.vendor.code} {bill.reference}: Input VAT",
                "dimension_counterparty_id": cp_id,
            })

        # Legacy fallback: hand-entered Bill.tax_amount with no per-line tax data.
        if bill.tax_amount > 0 and line_level_tax_total == 0:
            je_lines.append({
                "account_id": bill.lines.first().expense_account_id,
                "debit": bill.tax_amount,
                "currency": bill.currency,
                "description": f"{bill.vendor.code} {bill.reference}: tax",
                "dimension_counterparty_id": cp_id,
            })

        je_lines.append({
            "account_id": ap_account.id,
            "credit": bill.total,
            "currency": bill.currency,
            "description": f"AP to {bill.vendor.code} {bill.reference}",
            "dimension_counterparty_id": cp_id,
        })

        je = JournalService.create_draft(
            organization=bill.organization, entity=bill.entity,
            date=bill.invoice_date,
            lines=je_lines,
            user=None,  # system-created so user can approve
            memo=f"Bill {bill.reference} · {bill.vendor.name}" + (
                f" · {bill.description[:100]}" if bill.description else ""
            ),
            explanation=bill.explanation,
            reference=bill.bill_number or bill.reference,
            source_type=c.SOURCE_BILL,
            source_id=bill.id,
            source_ref=bill.reference,
            currency=bill.currency,
        )
        # Link vendor on the JE for drill-down
        je.vendor = bill.vendor
        je.save(update_fields=["vendor", "updated_at"])
        JournalService.submit_for_approval(je, user=None)
        JournalService.approve(je, user=user)
        JournalService.post(je, user=user)

        # Auto-transfer the bill's attachments (uploaded receipt etc.) to
        # the JE. Same SourceDocument rows; ``bill`` FK stays so the
        # source can be navigated from either side.
        from .documents import SourceDocumentService
        SourceDocumentService.transfer_bill_documents_to_je(bill, je)

        bill.status = BILL_APPROVED
        bill.approved_by = user
        bill.approved_at = timezone.now()
        bill.accrual_journal_entry = je
        bill.save(update_fields=[
            "status", "approved_by", "approved_at",
            "accrual_journal_entry", "updated_at",
        ])
        return bill

    @staticmethod
    @transaction.atomic
    def mark_paid(
        bill: Bill,
        *,
        bank_account: Account,
        payment_date: dt_date,
        user=None,
        reference: str = "",
    ) -> Bill:
        """Post the payment JE (DR AP / CR Bank) and move to paid."""
        _require(bill.status, BILL_PAID)
        if bank_account.organization_id != bill.organization_id:
            raise ValidationError("Bank account not in this organization.", code="AP011")
        ap_account = _resolve_ap_account(bill.entity)
        if ap_account is None:
            raise ValidationError(
                f"Entity {bill.entity.code} has no accounts_payable account.",
                code="AP010",
            )
        cp_id = _resolve_counterparty_for_vendor(bill.vendor, bill.organization_id)

        je_lines = [
            {"account_id": ap_account.id, "debit": bill.total,
             "currency": bill.currency,
             "description": f"Pay {bill.vendor.code} {bill.reference}",
             "dimension_counterparty_id": cp_id},
            {"account_id": bank_account.id, "credit": bill.total,
             "currency": bill.currency,
             "description": f"Pay {bill.vendor.code} {bill.reference}"
                             + (f" ref {reference}" if reference else ""),
             "dimension_counterparty_id": cp_id},
        ]
        je = JournalService.create_draft(
            organization=bill.organization, entity=bill.entity,
            date=payment_date,
            lines=je_lines,
            user=None,
            memo=f"Payment of bill {bill.reference} to {bill.vendor.name}",
            reference=reference or bill.bill_number or bill.reference,
            source_type=c.SOURCE_BILL_PAYMENT,
            source_id=bill.id,
            source_ref=bill.reference,
            currency=bill.currency,
        )
        je.vendor = bill.vendor
        je.save(update_fields=["vendor", "updated_at"])
        JournalService.submit_for_approval(je, user=None)
        JournalService.approve(je, user=user)
        JournalService.post(je, user=user)

        bill.status = BILL_PAID
        bill.paid_by = user
        bill.paid_at = timezone.now()
        bill.payment_date = payment_date
        bill.payment_bank_account = bank_account
        bill.payment_reference = reference
        bill.payment_journal_entry = je
        bill.save(update_fields=[
            "status", "paid_by", "paid_at",
            "payment_date", "payment_bank_account", "payment_reference",
            "payment_journal_entry", "updated_at",
        ])
        return bill

    @staticmethod
    @transaction.atomic
    def cancel(bill: Bill, user=None) -> Bill:
        _require(bill.status, BILL_CANCELLED)
        bill.status = BILL_CANCELLED
        bill.cancelled_by = user
        bill.cancelled_at = timezone.now()
        bill.save(update_fields=[
            "status", "cancelled_by", "cancelled_at", "updated_at",
        ])
        return bill


# ── Helpers ─────────────────────────────────────────────────────────────

def _require(from_status: str, to_status: str) -> None:
    if to_status not in BILL_TRANSITIONS.get(from_status, set()):
        raise InvalidTransition(
            f"Cannot move a Bill from '{from_status}' to '{to_status}'.",
            code="AP020",
            details={"from": from_status, "to": to_status},
        )


def _next_bill_ref(organization) -> str:
    """BILL-000001 style, sequential per organization."""
    last = (
        Bill.objects.filter(organization=organization)
        .order_by("-id").values_list("reference", flat=True).first()
    )
    if last and last.startswith("BILL-"):
        try:
            n = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            n = 1
    else:
        n = 1
    return f"BILL-{n:06d}"


def _resolve_ap_account(entity: Entity) -> Optional[Account]:
    """First active AP account on this entity (or shared)."""
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


def _resolve_counterparty_for_vendor(vendor: Vendor, organization_id) -> Optional[int]:
    """Return Counterparty.id whose ``counterparty_id`` matches ``vendor.code``.

    On a bill the vendor IS the counterparty; the workbook's CP dimension on
    AP/expense accounts is satisfied automatically when this match exists.
    Returns None when no Counterparty row matches — in that case the
    dimension validator will surface its standard "missing CP" error and the
    bookkeeper is told to add the counterparty master row first.
    """
    if not vendor or not vendor.code:
        return None
    cp = (
        Counterparty.objects
        .filter(
            organization_id=organization_id,
            counterparty_id=vendor.code,
            active_flag=True,
        )
        .only("id")
        .first()
    )
    return cp.id if cp else None


def _create_line(bill: Bill, spec: dict, idx: int) -> BillLine:
    amount = Decimal(str(spec.get("amount") or 0))
    qty = Decimal(str(spec.get("quantity") or 1))
    unit_price = Decimal(str(spec.get("unit_price") or (amount / qty if qty else 0)))
    tax_code_id = spec.get("tax_code_id")
    tax_amount_raw = spec.get("tax_amount")
    tax_amount = (
        Decimal(str(tax_amount_raw)) if tax_amount_raw is not None
        else _derive_tax_amount(tax_code_id, amount)
    )
    return BillLine.objects.create(
        bill=bill,
        expense_account_id=spec["expense_account_id"],
        description=spec.get("description", "")[:500],
        quantity=qty,
        unit_price=unit_price,
        amount=amount,
        tax_code_id=tax_code_id,
        tax_amount=tax_amount,
        line_order=spec.get("line_order", idx),
    )


def _derive_tax_amount(tax_code_id, base: Decimal) -> Decimal:
    """Compute tax from rate × base when caller didn't supply tax_amount.

    Imported lazily to avoid the kernel pulling in the tax model at import time.
    Returns 0 when no tax_code is given.
    """
    if not tax_code_id:
        return Decimal("0")
    from ..models import TaxCode
    try:
        tc = TaxCode.objects.only("rate").get(id=tax_code_id)
    except TaxCode.DoesNotExist:
        return Decimal("0")
    return (Decimal(base) * tc.rate / Decimal("100")).quantize(Decimal("0.01"))
