"""LoanService — drawdown, repayment, accrued interest.

Three flows, all tagged with ``dimension_loan_id`` so the LOAN dimension
required by accounts like 230100 Mortgage payable / 220100 Lombard /
120800 ST Loan Receivable is satisfied automatically.

  drawdown(loan, bank, amount):
      Side=LIABILITY (we're the borrower):  DR Bank / CR Loan Payable
      Side=ASSET     (we're the lender):    DR Loan Receivable / CR Bank

  repayment(loan, bank, principal, interest):
      Side=LIABILITY:  DR Loan Payable (principal) + DR Interest Expense
                       (interest) / CR Bank (total)
      Side=ASSET:      DR Bank (total) / CR Loan Receivable (principal)
                       + CR Interest Income (interest)

  accrue_interest(loan, amount):
      Side=LIABILITY:  DR Interest Expense / CR Loan Payable (or accrued
                       interest payable; we use loan_payable for simplicity)
      Side=ASSET:      DR Loan Receivable / CR Interest Income
"""
from __future__ import annotations

from decimal import Decimal
from datetime import date as dt_date
from typing import Optional

from django.db import transaction
from django.db.models import Q

from .. import constants as c
from ..exceptions import ValidationError
from ..models import Account, Entity, JournalEntry, Loan
from .journal import JournalService


_BANK_SUBTYPES = ("bank", "cash")


class LoanService:

    @staticmethod
    @transaction.atomic
    def drawdown(
        *,
        organization,
        entity: Entity,
        loan: Loan,
        bank_account: Account,
        amount: Decimal,
        date: dt_date,
        loan_account: Optional[Account] = None,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        """Cash hits the bank when a loan is drawn (or paid out, on the
        asset side)."""
        amount = _positive(amount, "Drawdown amount", "LN001")
        _check_bank(bank_account, organization, code="LN002")
        _check_loan_org(loan, organization)
        loan_account = loan_account or _resolve_loan_account(entity, loan)
        if loan_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no {_loan_subtype(loan)} account "
                "and none was provided.",
                code="LN003",
            )

        currency = bank_account.currency or entity.functional_currency
        memo = description or f"Drawdown · {loan.loan_id}"
        line_desc = description or "Loan drawdown"

        if loan.loan_side == Loan.LOAN_SIDE_LIABILITY:
            # Cash in / liability up
            lines = [
                _line(bank_account, debit=amount, currency=currency,
                      description=line_desc, loan_id=loan.id),
                _line(loan_account, credit=amount, currency=currency,
                      description=line_desc, loan_id=loan.id),
            ]
        else:
            # We're lending: receivable up / cash down
            lines = [
                _line(loan_account, debit=amount, currency=currency,
                      description=line_desc, loan_id=loan.id),
                _line(bank_account, credit=amount, currency=currency,
                      description=line_desc, loan_id=loan.id),
            ]

        return JournalService.create_draft(
            organization=organization, entity=entity, date=date,
            currency=currency, memo=memo, reference=reference,
            source_type=c.SOURCE_BANK_TRANSACTION, source_ref=reference,
            user=user, lines=lines,
        )

    @staticmethod
    @transaction.atomic
    def repayment(
        *,
        organization,
        entity: Entity,
        loan: Loan,
        bank_account: Account,
        principal: Decimal,
        interest: Decimal,
        date: dt_date,
        loan_account: Optional[Account] = None,
        interest_account: Optional[Account] = None,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        principal = Decimal(str(principal))
        interest = Decimal(str(interest))
        if principal < 0 or interest < 0 or (principal + interest) <= 0:
            raise ValidationError(
                "Principal and interest must be non-negative and total > 0.",
                code="LN010",
            )
        _check_bank(bank_account, organization, code="LN011")
        _check_loan_org(loan, organization)
        loan_account = loan_account or _resolve_loan_account(entity, loan)
        if loan_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no {_loan_subtype(loan)} account.",
                code="LN012",
            )
        interest_account = interest_account or _resolve_interest_account(
            entity, loan,
        )
        if interest > 0 and interest_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no interest "
                f"{'expense' if loan.loan_side == Loan.LOAN_SIDE_LIABILITY else 'income'} "
                "account and none was provided.",
                code="LN013",
            )

        total = principal + interest
        currency = bank_account.currency or entity.functional_currency
        memo = description or f"Repayment · {loan.loan_id}"
        line_desc = description or "Loan repayment"

        lines = []
        if loan.loan_side == Loan.LOAN_SIDE_LIABILITY:
            # Pay principal + interest out
            if principal > 0:
                lines.append(_line(loan_account, debit=principal,
                                   currency=currency, description=line_desc,
                                   loan_id=loan.id))
            if interest > 0:
                lines.append(_line(interest_account, debit=interest,
                                   currency=currency, description=line_desc,
                                   loan_id=loan.id))
            lines.append(_line(bank_account, credit=total,
                               currency=currency, description=line_desc,
                               loan_id=loan.id))
        else:
            # We receive principal + interest in
            lines.append(_line(bank_account, debit=total,
                               currency=currency, description=line_desc,
                               loan_id=loan.id))
            if principal > 0:
                lines.append(_line(loan_account, credit=principal,
                                   currency=currency, description=line_desc,
                                   loan_id=loan.id))
            if interest > 0:
                lines.append(_line(interest_account, credit=interest,
                                   currency=currency, description=line_desc,
                                   loan_id=loan.id))

        return JournalService.create_draft(
            organization=organization, entity=entity, date=date,
            currency=currency, memo=memo, reference=reference,
            source_type=c.SOURCE_BANK_TRANSACTION, source_ref=reference,
            user=user, lines=lines,
        )

    @staticmethod
    @transaction.atomic
    def accrue_interest(
        *,
        organization,
        entity: Entity,
        loan: Loan,
        amount: Decimal,
        date: dt_date,
        loan_account: Optional[Account] = None,
        interest_account: Optional[Account] = None,
        description: str = "",
        reference: str = "",
        user=None,
    ) -> JournalEntry:
        """Accrue interest on the loan without paying it (period-end style)."""
        amount = _positive(amount, "Accrued interest", "LN020")
        _check_loan_org(loan, organization)
        loan_account = loan_account or _resolve_loan_account(entity, loan)
        interest_account = interest_account or _resolve_interest_account(
            entity, loan,
        )
        if loan_account is None or interest_account is None:
            raise ValidationError(
                "Need both loan account and interest account "
                "(auto-resolve failed).",
                code="LN021",
            )

        currency = entity.functional_currency
        memo = description or f"Accrued interest · {loan.loan_id}"
        line_desc = description or "Accrued interest"

        if loan.loan_side == Loan.LOAN_SIDE_LIABILITY:
            lines = [
                _line(interest_account, debit=amount, currency=currency,
                      description=line_desc, loan_id=loan.id),
                _line(loan_account, credit=amount, currency=currency,
                      description=line_desc, loan_id=loan.id),
            ]
        else:
            lines = [
                _line(loan_account, debit=amount, currency=currency,
                      description=line_desc, loan_id=loan.id),
                _line(interest_account, credit=amount, currency=currency,
                      description=line_desc, loan_id=loan.id),
            ]

        return JournalService.create_draft(
            organization=organization, entity=entity, date=date,
            currency=currency, memo=memo, reference=reference,
            source_type=c.SOURCE_RECOGNITION, source_ref=reference,
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


def _check_loan_org(loan: Loan, organization) -> None:
    if loan.organization_id != organization.id:
        raise ValidationError(
            "Loan does not belong to this organization.", code="LN030",
        )


def _loan_subtype(loan: Loan) -> str:
    return ("loan_payable"
            if loan.loan_side == Loan.LOAN_SIDE_LIABILITY
            else "loan_receivable")


def _resolve_loan_account(entity: Entity, loan: Loan) -> Optional[Account]:
    return (
        Account.objects
        .filter(
            Q(entity=entity) | Q(entity__isnull=True),
            organization=entity.organization,
            is_active=True,
            account_subtype=_loan_subtype(loan),
        )
        .order_by("code")
        .first()
    )


def _resolve_interest_account(entity: Entity, loan: Loan) -> Optional[Account]:
    if loan.loan_side == Loan.LOAN_SIDE_LIABILITY:
        # Interest expense
        return (
            Account.objects
            .filter(
                Q(entity=entity) | Q(entity__isnull=True),
                organization=entity.organization,
                is_active=True,
                account_type=c.ACCOUNT_TYPE_EXPENSE,
                name__icontains="interest",
            )
            .order_by("code")
            .first()
        )
    # Interest income
    return (
        Account.objects
        .filter(
            Q(entity=entity) | Q(entity__isnull=True),
            organization=entity.organization,
            is_active=True,
            account_type=c.ACCOUNT_TYPE_REVENUE,
            name__icontains="interest",
        )
        .order_by("code")
        .first()
    )


def _line(account: Account, *, debit: Decimal = Decimal("0"),
          credit: Decimal = Decimal("0"), currency: str,
          description: str, loan_id: int) -> dict:
    return {
        "account_id": account.id,
        "debit": debit,
        "credit": credit,
        "currency": currency,
        "description": description,
        "dimension_loan_id": loan_id,
    }
