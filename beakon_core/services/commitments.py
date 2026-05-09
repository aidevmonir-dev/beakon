"""CommitmentService — capital calls + distributions on PE / private commitments.

Two flows, both tagged with ``dimension_commitment_id`` so accounts that
require the COM dimension (e.g. private-investment buckets) are
satisfied automatically.

  capital_call(commitment, bank, amount, investment_account):
      DR Investment / CR Bank
      Tag: dimension_commitment_id

  distribution(commitment, bank, total_amount, return_of_capital, gain):
      Two flavours rolled into one:
        - return_of_capital portion   → CR Investment (basis reduction)
        - gain portion                → CR Investment Income (gain)
      Caller declares the split. This is *the* accounting policy decision
      for PE distributions and Beakon doesn't try to derive it.

The investment account is caller-provided because there is no single
"investment" subtype that covers all PE products — the bookkeeper picks
the GL account they want the basis to live in.
"""
from __future__ import annotations

from decimal import Decimal
from datetime import date as dt_date
from typing import Optional

from django.db import transaction

from .. import constants as c
from ..exceptions import ValidationError
from ..models import Account, Commitment, Entity, JournalEntry
from .journal import JournalService


_BANK_SUBTYPES = ("bank", "cash")


class CommitmentService:

    @staticmethod
    @transaction.atomic
    def capital_call(
        *,
        organization,
        entity: Entity,
        commitment: Commitment,
        bank_account: Account,
        investment_account: Account,
        amount: Decimal,
        date: dt_date,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        amount = _positive(amount, "Capital call amount", "CC001")
        _check_bank(bank_account, organization, code="CC002")
        _check_org(commitment, organization, code="CC003")
        if investment_account.organization_id != organization.id:
            raise ValidationError(
                "Investment account does not belong to this organization.",
                code="CC004",
            )
        if investment_account.account_type != c.ACCOUNT_TYPE_ASSET:
            raise ValidationError(
                f"Account {investment_account.code} is not an asset account.",
                code="CC005",
            )

        currency = bank_account.currency or entity.functional_currency
        memo = description or f"Capital call · {commitment.commitment_id}"
        line_desc = description or "Capital call funded"

        return JournalService.create_draft(
            organization=organization, entity=entity, date=date,
            currency=currency, memo=memo, reference=reference,
            source_type=c.SOURCE_BANK_TRANSACTION, source_ref=reference,
            user=user,
            lines=[
                _line(investment_account, debit=amount, currency=currency,
                      description=line_desc, commitment_id=commitment.id),
                _line(bank_account, credit=amount, currency=currency,
                      description=line_desc, commitment_id=commitment.id),
            ],
        )

    @staticmethod
    @transaction.atomic
    def distribution(
        *,
        organization,
        entity: Entity,
        commitment: Commitment,
        bank_account: Account,
        investment_account: Account,
        gain_account: Account,
        return_of_capital: Decimal,
        gain: Decimal,
        date: dt_date,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        roc = Decimal(str(return_of_capital))
        gn = Decimal(str(gain))
        if roc < 0 or gn < 0 or (roc + gn) <= 0:
            raise ValidationError(
                "return_of_capital and gain must be non-negative and total > 0.",
                code="CC010",
            )
        _check_bank(bank_account, organization, code="CC011")
        _check_org(commitment, organization, code="CC012")
        if investment_account.organization_id != organization.id:
            raise ValidationError(
                "Investment account does not belong to this organization.",
                code="CC013",
            )
        if gain > 0 and gain_account.account_type != c.ACCOUNT_TYPE_REVENUE:
            raise ValidationError(
                f"Gain account {gain_account.code} is not a revenue account.",
                code="CC014",
            )

        total = roc + gn
        currency = bank_account.currency or entity.functional_currency
        memo = description or f"Distribution · {commitment.commitment_id}"
        line_desc = description or "Distribution received"

        lines = [
            _line(bank_account, debit=total, currency=currency,
                  description=line_desc, commitment_id=commitment.id),
        ]
        if roc > 0:
            lines.append(_line(investment_account, credit=roc,
                               currency=currency, description=line_desc,
                               commitment_id=commitment.id))
        if gn > 0:
            lines.append(_line(gain_account, credit=gn, currency=currency,
                               description=line_desc,
                               commitment_id=commitment.id))

        return JournalService.create_draft(
            organization=organization, entity=entity, date=date,
            currency=currency, memo=memo, reference=reference,
            source_type=c.SOURCE_BANK_TRANSACTION, source_ref=reference,
            user=user, lines=lines,
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
          description: str, commitment_id: int) -> dict:
    return {
        "account_id": account.id,
        "debit": debit,
        "credit": credit,
        "currency": currency,
        "description": description,
        "dimension_commitment_id": commitment_id,
    }
