"""VATRemittanceService — settlement of net VAT to the tax authority.

After running ``VATReportService.report(...)`` for a period, the entity
owes (or is owed) the net VAT to the tax authority. This service drafts
the JE that settles that liability against the bank account:

  Net VAT payable owed (most common):
    DR  VAT Payable        (clear the liability)
    CR  Bank               (cash out)

  Net VAT receivable (refund — less common, supported with the same call
  using the input-VAT account and a credit on Bank → debit, etc.):
    DR  Bank
    CR  VAT Receivable

The service auto-resolves the VAT-payable account by subtype if not
provided. The amount is whatever the bookkeeper enters from the VAT
report — the service is deliberately decoupled from the report so
manual adjustments and partial settlements are supported.
"""
from __future__ import annotations

from decimal import Decimal
from datetime import date as dt_date
from typing import Optional

from django.db import transaction
from django.db.models import Q

from .. import constants as c
from ..exceptions import ValidationError
from ..models import Account, Entity, JournalEntry
from .journal import JournalService


_BANK_SUBTYPES = ("bank", "cash")


class VATRemittanceService:

    @staticmethod
    @transaction.atomic
    def record(
        *,
        organization,
        entity: Entity,
        bank_account: Account,
        amount: Decimal,
        date: dt_date,
        vat_account: Optional[Account] = None,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        """Settle net VAT to authority. Books DR VAT Payable / CR Bank.

        Use the existing ``VATReportService.report`` to compute the net
        amount, then call this service with that amount to post the
        settlement.
        """
        amount = Decimal(str(amount))
        if amount <= 0:
            raise ValidationError(
                "VAT remittance amount must be positive.", code="VR001",
            )
        if bank_account.organization_id != organization.id:
            raise ValidationError(
                "Bank account does not belong to this organization.",
                code="VR002",
            )
        if bank_account.account_subtype not in _BANK_SUBTYPES:
            raise ValidationError(
                f"Account {bank_account.code} is not a bank/cash account "
                f"(subtype={bank_account.account_subtype}).",
                code="VR003",
            )
        if vat_account is None:
            vat_account = _resolve_vat_payable_account(entity)
        if vat_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no vat_payable account "
                "and none was provided.",
                code="VR004",
            )
        if vat_account.account_subtype not in ("vat_payable", "tax_payable"):
            raise ValidationError(
                f"Account {vat_account.code} is not a VAT/tax payable "
                f"account (subtype={vat_account.account_subtype}).",
                code="VR005",
            )

        currency = bank_account.currency or entity.functional_currency
        memo = description or f"VAT remittance — {bank_account.code}"
        line_desc = description or "VAT remitted to authority"
        return JournalService.create_draft(
            organization=organization,
            entity=entity,
            date=date,
            currency=currency,
            memo=memo,
            reference=reference,
            source_type=c.SOURCE_ADJUSTMENT,
            source_ref=reference,
            user=user,
            lines=[
                {
                    "account_id": vat_account.id,
                    "debit": amount,
                    "currency": currency,
                    "description": line_desc,
                },
                {
                    "account_id": bank_account.id,
                    "credit": amount,
                    "currency": currency,
                    "description": line_desc,
                },
            ],
        )


def _resolve_vat_payable_account(entity: Entity) -> Optional[Account]:
    return (
        Account.objects
        .filter(
            Q(entity=entity) | Q(entity__isnull=True),
            organization=entity.organization,
            is_active=True,
            account_subtype="vat_payable",
        )
        .order_by("code")
        .first()
    )
