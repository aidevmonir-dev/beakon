"""Cash-movement services — flows where both legs are bank/cash side.

Three services here, all variations of the same shape (resolve an account,
build a 2-line JE, hand off to JournalService for the standard approval
state machine):

  - BankTransferService     : Bank A → Bank B, same currency
  - BankInterestService     : DR Bank / CR Interest Income
  - OwnerContributionService: DR Bank / CR Capital (owner equity injection)

Cross-currency transfers are deliberately excluded from
BankTransferService — they're an FX-conversion transaction with FX
gain/loss treatment, which lives in its own (Tier 2) service.
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


# ─────────────────────────────────────────────────────────────────────────
class BankTransferService:
    """Move cash between two bank/cash accounts on the same entity.

    Books DR Target / CR Source for ``amount``. Same currency only in v1
    (cross-currency is a separate FX-conversion transaction type).
    """

    @staticmethod
    @transaction.atomic
    def transfer(
        *,
        organization,
        entity: Entity,
        source_account: Account,
        target_account: Account,
        amount: Decimal,
        transfer_date: dt_date,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        amount = Decimal(str(amount))
        if amount <= 0:
            raise ValidationError("Transfer amount must be positive.", code="BT001")
        if source_account.id == target_account.id:
            raise ValidationError(
                "Source and target accounts must be different.",
                code="BT002",
            )
        for acct, label in ((source_account, "Source"), (target_account, "Target")):
            if acct.organization_id != organization.id:
                raise ValidationError(
                    f"{label} account does not belong to this organization.",
                    code="BT003",
                )
            if acct.account_subtype not in _BANK_SUBTYPES:
                raise ValidationError(
                    f"{label} account {acct.code} is not a bank/cash account "
                    f"(subtype={acct.account_subtype}).",
                    code="BT004",
                )
        # Same-currency only in v1.
        src_ccy = (source_account.currency or entity.functional_currency).upper()
        tgt_ccy = (target_account.currency or entity.functional_currency).upper()
        if src_ccy != tgt_ccy:
            raise ValidationError(
                f"Cross-currency transfer ({src_ccy}→{tgt_ccy}) is not "
                f"supported by BankTransferService. Use the FX-conversion "
                f"flow with explicit FX gain/loss.",
                code="BT005",
            )

        memo = description or f"Transfer {source_account.code} → {target_account.code}"
        line_desc = description or "Bank transfer"
        return JournalService.create_draft(
            organization=organization,
            entity=entity,
            date=transfer_date,
            currency=src_ccy,
            memo=memo,
            reference=reference,
            source_type=c.SOURCE_BANK_TRANSACTION,
            source_ref=reference,
            user=user,
            lines=[
                {
                    "account_id": target_account.id,
                    "debit": amount,
                    "currency": src_ccy,
                    "description": line_desc,
                },
                {
                    "account_id": source_account.id,
                    "credit": amount,
                    "currency": src_ccy,
                    "description": line_desc,
                },
            ],
        )


# ─────────────────────────────────────────────────────────────────────────
class BankInterestService:
    """Bank interest received — DR Bank / CR Interest Income.

    If ``income_account`` is omitted, picks the first active revenue
    account whose name matches /interest/i, falling back to subtype
    ``other_income`` then ``investment_income``.
    """

    @staticmethod
    @transaction.atomic
    def record(
        *,
        organization,
        entity: Entity,
        bank_account: Account,
        amount: Decimal,
        date: dt_date,
        income_account: Optional[Account] = None,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        amount = Decimal(str(amount))
        if amount <= 0:
            raise ValidationError(
                "Interest amount must be positive.", code="BI001",
            )
        _check_bank_account(bank_account, organization, code="BI002")
        if income_account is None:
            income_account = _resolve_interest_income_account(entity)
        if income_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no interest-income account "
                "and none was provided.",
                code="BI003",
            )
        if income_account.account_type != c.ACCOUNT_TYPE_REVENUE:
            raise ValidationError(
                f"Account {income_account.code} is not a revenue account.",
                code="BI004",
            )

        currency = bank_account.currency or entity.functional_currency
        memo = description or f"Bank interest — {bank_account.code}"
        line_desc = description or "Bank interest received"
        return JournalService.create_draft(
            organization=organization,
            entity=entity,
            date=date,
            currency=currency,
            memo=memo,
            reference=reference,
            source_type=c.SOURCE_BANK_TRANSACTION,
            source_ref=reference,
            user=user,
            lines=[
                {
                    "account_id": bank_account.id,
                    "debit": amount,
                    "currency": currency,
                    "description": line_desc,
                },
                {
                    "account_id": income_account.id,
                    "credit": amount,
                    "currency": currency,
                    "description": line_desc,
                },
            ],
        )


# ─────────────────────────────────────────────────────────────────────────
class OwnerContributionService:
    """Owner capital contribution — DR Bank / CR Capital.

    If ``capital_account`` is omitted, picks the first active equity
    account with subtype ``capital``.
    """

    @staticmethod
    @transaction.atomic
    def record(
        *,
        organization,
        entity: Entity,
        bank_account: Account,
        amount: Decimal,
        date: dt_date,
        capital_account: Optional[Account] = None,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        amount = Decimal(str(amount))
        if amount <= 0:
            raise ValidationError(
                "Contribution amount must be positive.", code="OC001",
            )
        _check_bank_account(bank_account, organization, code="OC002")
        if capital_account is None:
            capital_account = _resolve_capital_account(entity)
        if capital_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no capital account "
                "and none was provided.",
                code="OC003",
            )
        if capital_account.account_type != c.ACCOUNT_TYPE_EQUITY:
            raise ValidationError(
                f"Account {capital_account.code} is not an equity account.",
                code="OC004",
            )

        currency = bank_account.currency or entity.functional_currency
        memo = description or f"Capital contribution — {bank_account.code}"
        line_desc = description or "Owner capital contribution"
        return JournalService.create_draft(
            organization=organization,
            entity=entity,
            date=date,
            currency=currency,
            memo=memo,
            reference=reference,
            source_type=c.SOURCE_OPENING_BALANCE,
            source_ref=reference,
            user=user,
            lines=[
                {
                    "account_id": bank_account.id,
                    "debit": amount,
                    "currency": currency,
                    "description": line_desc,
                },
                {
                    "account_id": capital_account.id,
                    "credit": amount,
                    "currency": currency,
                    "description": line_desc,
                },
            ],
        )


# ── Internal helpers ────────────────────────────────────────────────────
def _check_bank_account(account: Account, organization, *, code: str) -> None:
    if account.organization_id != organization.id:
        raise ValidationError(
            "Bank account does not belong to this organization.", code=code,
        )
    if account.account_subtype not in _BANK_SUBTYPES:
        raise ValidationError(
            f"Account {account.code} is not a bank/cash account "
            f"(subtype={account.account_subtype}).",
            code=code,
        )


def _resolve_interest_income_account(entity: Entity) -> Optional[Account]:
    base = Account.objects.filter(
        Q(entity=entity) | Q(entity__isnull=True),
        organization=entity.organization,
        is_active=True,
        account_type=c.ACCOUNT_TYPE_REVENUE,
    )
    by_name = base.filter(name__icontains="interest").order_by("code").first()
    if by_name:
        return by_name
    by_subtype = (
        base.filter(account_subtype__in=("other_income", "investment_income"))
        .order_by("code")
        .first()
    )
    return by_subtype


def _resolve_capital_account(entity: Entity) -> Optional[Account]:
    return (
        Account.objects
        .filter(
            Q(entity=entity) | Q(entity__isnull=True),
            organization=entity.organization,
            is_active=True,
            account_type=c.ACCOUNT_TYPE_EQUITY,
            account_subtype="capital",
        )
        .order_by("code")
        .first()
    )
