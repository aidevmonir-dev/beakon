"""Credit-note services — refund / adjustment flows.

Two services here, mirror images of each other:

  - VendorCreditNoteService   : DR Accounts Payable / CR Expense
                                (vendor refund or AP-side adjustment)
  - CustomerCreditNoteService : DR Revenue / CR Accounts Receivable
                                (customer refund or AR-side adjustment)

Both auto-derive the CP dimension from vendor/customer code (mirroring
BillService / InvoiceService) so the workbook's dimension-validation
rule for AP/AR/Revenue/Expense accounts is satisfied automatically.

Credit notes are simpler than bills/invoices in this v1 — the service
drafts a 2-line JE directly rather than maintaining a separate
CreditNote model. If credit-note tracking with status / payment becomes
needed later, promote it to a model the same way Bill / Invoice already
are.
"""
from __future__ import annotations

from decimal import Decimal
from datetime import date as dt_date
from typing import Optional

from django.db import transaction
from django.db.models import Q

from .. import constants as c
from ..exceptions import ValidationError
from ..models import Account, Counterparty, Customer, Entity, JournalEntry, Vendor
from .journal import JournalService


# ─────────────────────────────────────────────────────────────────────────
class VendorCreditNoteService:
    """Vendor credit note — reverses (part of) a prior bill.

    Books DR Accounts Payable / CR Expense. The vendor IS the
    counterparty; the CP dimension is stamped automatically when a
    matching Counterparty master row exists.
    """

    @staticmethod
    @transaction.atomic
    def create_draft(
        *,
        organization,
        entity: Entity,
        vendor: Vendor,
        amount: Decimal,
        credit_note_date: dt_date,
        expense_account: Account,
        description: str = "",
        reference: str = "",
        currency: Optional[str] = None,
        user=None,
    ) -> JournalEntry:
        amount = Decimal(str(amount))
        if amount <= 0:
            raise ValidationError(
                "Credit note amount must be positive.", code="VCN001",
            )
        if vendor.organization_id != organization.id:
            raise ValidationError(
                "Vendor does not belong to this organization.", code="VCN002",
            )
        if expense_account.account_type != c.ACCOUNT_TYPE_EXPENSE:
            raise ValidationError(
                f"Account {expense_account.code} is not an expense account.",
                code="VCN003",
            )

        ap_account = _resolve_ap_account(entity)
        if ap_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no accounts_payable account.",
                code="VCN004",
            )

        currency = currency or vendor.default_currency or entity.functional_currency
        cp_id = _resolve_counterparty_for_party_code(vendor.code, organization.id)
        memo = description or f"Credit note from {vendor.code}"
        line_desc = description or f"Credit note · {vendor.code}"

        return JournalService.create_draft(
            organization=organization,
            entity=entity,
            date=credit_note_date,
            currency=currency,
            memo=memo,
            reference=reference,
            source_type=c.SOURCE_ADJUSTMENT,
            source_ref=reference,
            user=user,
            lines=[
                {
                    "account_id": ap_account.id,
                    "debit": amount,
                    "currency": currency,
                    "description": line_desc,
                    "dimension_counterparty_id": cp_id,
                },
                {
                    "account_id": expense_account.id,
                    "credit": amount,
                    "currency": currency,
                    "description": line_desc,
                    "dimension_counterparty_id": cp_id,
                },
            ],
        )


# ─────────────────────────────────────────────────────────────────────────
class CustomerCreditNoteService:
    """Customer credit note — reverses (part of) a prior invoice.

    Books DR Revenue / CR Accounts Receivable. The customer IS the
    counterparty for CP-dimension purposes.
    """

    @staticmethod
    @transaction.atomic
    def create_draft(
        *,
        organization,
        entity: Entity,
        customer: Customer,
        amount: Decimal,
        credit_note_date: dt_date,
        revenue_account: Account,
        description: str = "",
        reference: str = "",
        currency: Optional[str] = None,
        user=None,
    ) -> JournalEntry:
        amount = Decimal(str(amount))
        if amount <= 0:
            raise ValidationError(
                "Credit note amount must be positive.", code="CCN001",
            )
        if customer.organization_id != organization.id:
            raise ValidationError(
                "Customer does not belong to this organization.", code="CCN002",
            )
        if revenue_account.account_type != c.ACCOUNT_TYPE_REVENUE:
            raise ValidationError(
                f"Account {revenue_account.code} is not a revenue account.",
                code="CCN003",
            )

        ar_account = _resolve_ar_account(entity)
        if ar_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no accounts_receivable account.",
                code="CCN004",
            )

        currency = currency or customer.default_currency or entity.functional_currency
        cp_id = _resolve_counterparty_for_party_code(customer.code, organization.id)
        memo = description or f"Credit note to {customer.code}"
        line_desc = description or f"Credit note · {customer.code}"

        return JournalService.create_draft(
            organization=organization,
            entity=entity,
            date=credit_note_date,
            currency=currency,
            memo=memo,
            reference=reference,
            source_type=c.SOURCE_ADJUSTMENT,
            source_ref=reference,
            user=user,
            lines=[
                {
                    "account_id": revenue_account.id,
                    "debit": amount,
                    "currency": currency,
                    "description": line_desc,
                    "dimension_counterparty_id": cp_id,
                },
                {
                    "account_id": ar_account.id,
                    "credit": amount,
                    "currency": currency,
                    "description": line_desc,
                    "dimension_counterparty_id": cp_id,
                },
            ],
        )


# ── Internal helpers ────────────────────────────────────────────────────
def _resolve_ap_account(entity: Entity) -> Optional[Account]:
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


def _resolve_counterparty_for_party_code(code: str, organization_id) -> Optional[int]:
    """Match Counterparty by stable workbook id == party code (vendor or customer)."""
    if not code:
        return None
    cp = (
        Counterparty.objects
        .filter(
            organization_id=organization_id,
            counterparty_id=code,
            active_flag=True,
        )
        .only("id")
        .first()
    )
    return cp.id if cp else None
