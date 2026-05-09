"""InsuranceService — premium paid + claim received.

Two flows tagged with ``dimension_policy_id`` so accounts that require
the POL dimension (e.g. 180300 Prepaid insurance, insurance-wrapped
investments) are satisfied automatically.

  premium_paid(policy, bank, amount, expense_account):
      DR Insurance Expense / CR Bank

  claim_received(policy, bank, amount, recovery_account):
      DR Bank / CR Insurance Recovery (revenue / other_income)
"""
from __future__ import annotations

from decimal import Decimal
from datetime import date as dt_date
from typing import Optional

from django.db import transaction

from .. import constants as c
from ..exceptions import ValidationError
from ..models import Account, Entity, JournalEntry, Policy
from .journal import JournalService


_BANK_SUBTYPES = ("bank", "cash")


class InsuranceService:

    @staticmethod
    @transaction.atomic
    def premium_paid(
        *,
        organization,
        entity: Entity,
        policy: Policy,
        bank_account: Account,
        expense_account: Account,
        amount: Decimal,
        date: dt_date,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        amount = _positive(amount, "Premium amount", "INS001")
        _check_bank(bank_account, organization, code="INS002")
        _check_org(policy, organization, code="INS003")
        if expense_account.account_type != c.ACCOUNT_TYPE_EXPENSE:
            raise ValidationError(
                f"Account {expense_account.code} is not an expense account.",
                code="INS004",
            )

        currency = bank_account.currency or entity.functional_currency
        memo = description or f"Premium paid · {policy.policy_id}"
        line_desc = description or "Insurance premium"

        return JournalService.create_draft(
            organization=organization, entity=entity, date=date,
            currency=currency, memo=memo, reference=reference,
            source_type=c.SOURCE_BANK_TRANSACTION, source_ref=reference,
            user=user,
            lines=[
                _line(expense_account, debit=amount, currency=currency,
                      description=line_desc, policy_id=policy.id),
                _line(bank_account, credit=amount, currency=currency,
                      description=line_desc, policy_id=policy.id),
            ],
        )

    @staticmethod
    @transaction.atomic
    def claim_received(
        *,
        organization,
        entity: Entity,
        policy: Policy,
        bank_account: Account,
        recovery_account: Account,
        amount: Decimal,
        date: dt_date,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        amount = _positive(amount, "Claim amount", "INS010")
        _check_bank(bank_account, organization, code="INS011")
        _check_org(policy, organization, code="INS012")
        if recovery_account.account_type != c.ACCOUNT_TYPE_REVENUE:
            raise ValidationError(
                f"Account {recovery_account.code} is not a revenue account.",
                code="INS013",
            )

        currency = bank_account.currency or entity.functional_currency
        memo = description or f"Claim received · {policy.policy_id}"
        line_desc = description or "Insurance claim"

        return JournalService.create_draft(
            organization=organization, entity=entity, date=date,
            currency=currency, memo=memo, reference=reference,
            source_type=c.SOURCE_BANK_TRANSACTION, source_ref=reference,
            user=user,
            lines=[
                _line(bank_account, debit=amount, currency=currency,
                      description=line_desc, policy_id=policy.id),
                _line(recovery_account, credit=amount, currency=currency,
                      description=line_desc, policy_id=policy.id),
            ],
        )


# ── helpers ──────────────────────────────────────────────────────────
def _positive(value, label: str, code: str) -> Decimal:
    v = Decimal(str(value))
    if v <= 0:
        raise ValidationError(f"{label} must be positive.", code=code)
    return v


def _check_bank(account: Account, organization, *, code: str) -> None:
    if account.organization_id != organization.id:
        raise ValidationError(
            "Bank account does not belong to this organization.", code=code,
        )
    if account.account_subtype not in _BANK_SUBTYPES:
        raise ValidationError(
            f"Account {account.code} is not a bank/cash account.", code=code,
        )


def _check_org(obj, organization, *, code: str) -> None:
    if obj.organization_id != organization.id:
        raise ValidationError(
            f"{type(obj).__name__} does not belong to this organization.",
            code=code,
        )


def _line(account: Account, *, debit: Decimal = Decimal("0"),
          credit: Decimal = Decimal("0"), currency: str,
          description: str, policy_id: int) -> dict:
    return {
        "account_id": account.id,
        "debit": debit,
        "credit": credit,
        "currency": currency,
        "description": description,
        "dimension_policy_id": policy_id,
    }
