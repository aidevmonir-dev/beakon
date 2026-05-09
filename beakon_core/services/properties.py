"""PropertyService — rental income + property expense.

Two flows tagged with ``dimension_property_id`` so the PROP dimension
required by accounts like 720200 Property maintenance, 530100 Rental
income, etc. is satisfied automatically.

  rental_income(property, bank, amount, income_account):
      DR Bank / CR Rental Income

  property_expense(property, bank, amount, expense_account):
      DR Property Expense / CR Bank
"""
from __future__ import annotations

from decimal import Decimal
from datetime import date as dt_date
from typing import Optional

from django.db import transaction

from .. import constants as c
from ..exceptions import ValidationError
from ..models import Account, Entity, JournalEntry, Property
from .journal import JournalService


_BANK_SUBTYPES = ("bank", "cash")


class PropertyService:

    @staticmethod
    @transaction.atomic
    def rental_income(
        *,
        organization,
        entity: Entity,
        property: Property,
        bank_account: Account,
        income_account: Account,
        amount: Decimal,
        date: dt_date,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        amount = _positive(amount, "Rental income amount", "PR001")
        _check_bank(bank_account, organization, code="PR002")
        _check_org(property, organization, code="PR003")
        if income_account.account_type != c.ACCOUNT_TYPE_REVENUE:
            raise ValidationError(
                f"Account {income_account.code} is not a revenue account.",
                code="PR004",
            )

        currency = bank_account.currency or entity.functional_currency
        memo = description or f"Rental income · {property.property_id}"
        line_desc = description or "Rental income"

        return JournalService.create_draft(
            organization=organization, entity=entity, date=date,
            currency=currency, memo=memo, reference=reference,
            source_type=c.SOURCE_BANK_TRANSACTION, source_ref=reference,
            user=user,
            lines=[
                _line(bank_account, debit=amount, currency=currency,
                      description=line_desc, property_id=property.id),
                _line(income_account, credit=amount, currency=currency,
                      description=line_desc, property_id=property.id),
            ],
        )

    @staticmethod
    @transaction.atomic
    def property_expense(
        *,
        organization,
        entity: Entity,
        property: Property,
        bank_account: Account,
        expense_account: Account,
        amount: Decimal,
        date: dt_date,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        amount = _positive(amount, "Property expense amount", "PR010")
        _check_bank(bank_account, organization, code="PR011")
        _check_org(property, organization, code="PR012")
        if expense_account.account_type != c.ACCOUNT_TYPE_EXPENSE:
            raise ValidationError(
                f"Account {expense_account.code} is not an expense account.",
                code="PR013",
            )

        currency = bank_account.currency or entity.functional_currency
        memo = description or f"Property expense · {property.property_id}"
        line_desc = description or "Property expense"

        return JournalService.create_draft(
            organization=organization, entity=entity, date=date,
            currency=currency, memo=memo, reference=reference,
            source_type=c.SOURCE_BANK_TRANSACTION, source_ref=reference,
            user=user,
            lines=[
                _line(expense_account, debit=amount, currency=currency,
                      description=line_desc, property_id=property.id),
                _line(bank_account, credit=amount, currency=currency,
                      description=line_desc, property_id=property.id),
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
          description: str, property_id: int) -> dict:
    return {
        "account_id": account.id,
        "debit": debit,
        "credit": credit,
        "currency": currency,
        "description": description,
        "dimension_property_id": property_id,
    }
