"""BankChargeService — the 5th transaction type from Thomas's
Accounting_Engine_Developer_Instructions.docx, §3 step 3:

    "Bank charge — When a bank charge is entered:
     Debit Bank Charges Expense, credit Bank"

Bank charges are primary entries (not derivative of an approved Bill or
Invoice) so they go through the standard JournalService state machine:
the service drafts a balanced 2-line JE and the bookkeeper reviews it
in the approval queue before posting.

The expense account may be passed explicitly. If omitted, the service
auto-resolves it on the entity by preferring (in order):
  1. Account whose name matches /bank.*charge/i
  2. The first active account with subtype 'operating_expense'
  3. ValidationError
"""
from __future__ import annotations

import re
from decimal import Decimal
from datetime import date as dt_date
from typing import Optional

from django.db import transaction
from django.db.models import Q

from .. import constants as c
from ..exceptions import ValidationError
from ..models import Account, Entity, JournalEntry
from .journal import JournalService


_BANK_CHARGE_NAME_RE = re.compile(r"bank.*charge|service.*fee|bank.*fee", re.IGNORECASE)


class BankChargeService:
    """Auto-draft the Dr Bank Charges Expense / Cr Bank Account JE."""

    @staticmethod
    @transaction.atomic
    def create_draft(
        *,
        organization,
        entity: Entity,
        bank_account: Account,
        amount: Decimal,
        charge_date: dt_date,
        expense_account: Optional[Account] = None,
        description: str = "",
        reference: str = "",
        currency: Optional[str] = None,
        user=None,
    ) -> JournalEntry:
        amount = Decimal(str(amount))
        if amount <= 0:
            raise ValidationError(
                "Bank charge amount must be positive.",
                code="BC001",
            )
        if bank_account.organization_id != organization.id:
            raise ValidationError(
                "Bank account does not belong to this organization.",
                code="BC002",
            )
        if bank_account.account_subtype not in ("bank", "cash"):
            raise ValidationError(
                f"Account {bank_account.code} is not a bank/cash account "
                f"(subtype={bank_account.account_subtype}).",
                code="BC003",
            )

        if expense_account is None:
            expense_account = _resolve_bank_charge_expense_account(entity)
        if expense_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no bank-charge expense account "
                "and none was provided.",
                code="BC004",
            )
        if expense_account.account_type != c.ACCOUNT_TYPE_EXPENSE:
            raise ValidationError(
                f"Account {expense_account.code} is not an expense account.",
                code="BC005",
            )

        currency = currency or bank_account.currency or entity.functional_currency
        memo = description or f"Bank charge — {bank_account.code}"
        line_desc = description or "Bank charge"

        je = JournalService.create_draft(
            organization=organization,
            entity=entity,
            date=charge_date,
            currency=currency,
            memo=memo,
            reference=reference,
            source_type=c.SOURCE_BANK_TRANSACTION,
            source_ref=reference,
            user=user,
            lines=[
                {
                    "account_id": expense_account.id,
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
        return je


def _resolve_bank_charge_expense_account(entity: Entity) -> Optional[Account]:
    """Best-effort lookup of a bank-charge expense account on this entity.

    Preference order: (1) name pattern 'bank charge'/'service fee', then
    (2) first active operating_expense account. Returns None if neither.
    """
    base = Account.objects.filter(
        Q(entity=entity) | Q(entity__isnull=True),
        organization=entity.organization,
        is_active=True,
        account_type=c.ACCOUNT_TYPE_EXPENSE,
    )

    for acct in base.order_by("code"):
        if _BANK_CHARGE_NAME_RE.search(acct.name or ""):
            return acct

    return base.filter(account_subtype="operating_expense").order_by("code").first()
