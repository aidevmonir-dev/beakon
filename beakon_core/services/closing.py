"""ClosingEntriesService — period-end revenue/expense rollup.

Architecture PDF layer 4 ("Closing entries and audit trail per posting").

A clean accounting close has three steps:

  1. Run all the period work (bills posted, invoices issued, FX revalued, etc.)
  2. **Generate closing entries** — zero out every revenue and expense
     account in the period and post the net P&L to Retained Earnings.
  3. Lock the period (``Period.status = closed``).

This service handles step 2. Step 3 stays with the operator (or a future
``MonthEndOrchestrator`` — build #17). The closing JE is a normal
``JournalEntry`` so it picks up the same audit trail, FX, validation and
state machine as every other posting; it is tagged ``source_type =
"period_close"`` for downstream filtering.

Behavior:

  - For each posting-allowed P&L account in the entity, sum all functional
    debits/credits across postings dated **inside the period** (and only
    those: prior-period close already cleared earlier balances).
  - Post one JE on ``period.end_date``:
        DR each revenue account at its closing balance (revenue normally
        carries credit balances, so it gets debited to zero).
        CR each expense account at its closing balance.
        Offset to Retained Earnings to balance: net income → CR; net loss → DR.
  - Idempotent guard: refuses to close twice — checks for an existing
    posted close JE on the period.

Caveats / what's deliberately NOT here:

  - We don't yet auto-lock the period after closing — that pairs with
    a richer month-end checklist orchestrator (queue item #17).
  - We don't handle multi-currency closing reserves (FX Translation
    Reserve) — that's part of consolidation, not single-entity close.
  - Equity sub-divisions (current-year-earnings vs. retained-earnings
    proper) are not split. Net P&L lands on a single retained earnings
    account.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date as dt_date
from decimal import Decimal
from typing import Optional

from django.db import transaction
from django.db.models import Q, Sum

from .. import constants as c
from ..exceptions import InvalidTransition, ValidationError
from ..models import Account, Entity, JournalEntry, JournalLine, Period
from .journal import JournalService


ZERO = Decimal("0")


@dataclass
class CloseResult:
    period: Period
    journal_entry: JournalEntry
    revenue_total: Decimal
    expense_total: Decimal
    net_income: Decimal           # positive = profit; negative = loss
    line_count: int


class ClosingEntriesService:
    """Generate the closing JE for a period."""

    @staticmethod
    @transaction.atomic
    def close_period(
        period: Period,
        *,
        retained_earnings_account: Optional[Account] = None,
        user=None,
        memo: Optional[str] = None,
    ) -> CloseResult:
        """Post the closing JE for ``period`` and return the result.

        Args:
            period: The period to close. Must be in OPEN or SOFT_CLOSE
                status — closing a closed period is a no-op error.
            retained_earnings_account: optional override; if omitted, the
                service auto-resolves the entity's retained-earnings
                account by ``account_subtype="retained_earnings"``.
            user: actor for the underlying JournalService approval +
                post calls. The closing JE is system-created, then approved
                and posted by this user.
            memo: optional override for the JE memo.

        Raises:
            ValidationError: if the period is already closed, no posting-
                allowed P&L lines exist, or no retained-earnings account
                can be resolved.
        """
        if period.status == c.PERIOD_CLOSED:
            raise ValidationError(
                f"Period {period.name} is already closed.",
                code=c.ERR_PERIOD_CLOSED,
            )

        # ── Idempotency guard ───────────────────────────────────────
        existing = JournalEntry.objects.filter(
            organization=period.entity.organization,
            entity=period.entity,
            source_type=c.SOURCE_PERIOD_CLOSE,
            source_id=period.id,
            status=c.JE_POSTED,
        ).first()
        if existing is not None:
            raise ValidationError(
                f"Period {period.name} already has a posted closing JE "
                f"({existing.entry_number}).",
                code="CLO001",
                details={"existing_entry": existing.entry_number},
            )

        entity = period.entity
        organization = entity.organization

        # ── Resolve Retained Earnings account ───────────────────────
        re_account = retained_earnings_account or _resolve_retained_earnings(entity)
        if re_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no retained_earnings account.",
                code="CLO002",
            )
        if re_account.organization_id != organization.id:
            raise ValidationError(
                "Retained earnings account does not belong to this entity's organization.",
                code="CLO003",
            )

        # ── Aggregate P&L balances over the period ─────────────────
        # Use functional-currency amounts so multi-currency activity rolls up
        # into a single closing JE in the entity's functional currency.
        pl_account_types = (c.ACCOUNT_TYPE_REVENUE, c.ACCOUNT_TYPE_EXPENSE)
        balances = (
            JournalLine.objects
            .filter(
                journal_entry__organization=organization,
                journal_entry__entity=entity,
                journal_entry__status=c.JE_POSTED,
                journal_entry__date__gte=period.start_date,
                journal_entry__date__lte=period.end_date,
                account__account_type__in=pl_account_types,
                account__posting_allowed=True,
            )
            .values("account_id", "account__code", "account__name",
                    "account__account_type")
            .annotate(
                total_debit=Sum("functional_debit"),
                total_credit=Sum("functional_credit"),
            )
            .order_by("account__code")
        )

        # ── Build closing JE lines ─────────────────────────────────
        # For each P&L account, post the line that *reverses* its balance:
        #   - revenue (credit-normal): a positive (CR - DR) net needs DR closure
        #   - expense (debit-normal):  a positive (DR - CR) net needs CR closure
        # Net income = sum(revenue net) - sum(expense net).
        je_lines: list[dict] = []
        revenue_total = ZERO
        expense_total = ZERO
        line_count = 0

        for row in balances:
            d = row["total_debit"] or ZERO
            ccr = row["total_credit"] or ZERO
            atype = row["account__account_type"]
            account_id = row["account_id"]

            if atype == c.ACCOUNT_TYPE_REVENUE:
                # Net revenue (positive = revenue earned)
                net = ccr - d
                if net == ZERO:
                    continue
                revenue_total += net
                # Close: DR <revenue> for net (or CR if net is negative)
                if net > 0:
                    je_lines.append({
                        "account_id": account_id, "debit": net,
                        "currency": entity.functional_currency,
                        "description": f"Close {row['account__code']} to RE",
                    })
                else:
                    je_lines.append({
                        "account_id": account_id, "credit": -net,
                        "currency": entity.functional_currency,
                        "description": f"Close {row['account__code']} to RE",
                    })
                line_count += 1
            else:  # expense
                net = d - ccr
                if net == ZERO:
                    continue
                expense_total += net
                # Close: CR <expense> for net
                if net > 0:
                    je_lines.append({
                        "account_id": account_id, "credit": net,
                        "currency": entity.functional_currency,
                        "description": f"Close {row['account__code']} to RE",
                    })
                else:
                    je_lines.append({
                        "account_id": account_id, "debit": -net,
                        "currency": entity.functional_currency,
                        "description": f"Close {row['account__code']} to RE",
                    })
                line_count += 1

        if not je_lines:
            raise ValidationError(
                f"No P&L activity to close in period {period.name}.",
                code="CLO004",
            )

        # ── Offset to Retained Earnings ────────────────────────────
        net_income = revenue_total - expense_total
        if net_income > 0:
            # Profit: CR Retained Earnings (equity goes up).
            je_lines.append({
                "account_id": re_account.id,
                "credit": net_income,
                "currency": entity.functional_currency,
                "description": f"{period.name} net income to retained earnings",
            })
        elif net_income < 0:
            # Loss: DR Retained Earnings.
            je_lines.append({
                "account_id": re_account.id,
                "debit": -net_income,
                "currency": entity.functional_currency,
                "description": f"{period.name} net loss to retained earnings",
            })
        # net_income == 0: still post the line (zero) so the audit trail shows
        # we ran. Skipped for cleanliness — JournalLine constraints forbid zero.

        # ── Build, submit, approve, post the closing JE ────────────
        je = JournalService.create_draft(
            organization=organization, entity=entity,
            date=period.end_date,
            lines=je_lines,
            user=None,  # system-created so user can approve
            memo=memo or f"Period close — {period.name}",
            reference=f"CLOSE-{period.name}",
            source_type=c.SOURCE_PERIOD_CLOSE,
            source_id=period.id,
            source_ref=period.name,
            currency=entity.functional_currency,
        )
        JournalService.submit_for_approval(je, user=None)
        JournalService.approve(je, user=user)
        JournalService.post(je, user=user)

        return CloseResult(
            period=period,
            journal_entry=je,
            revenue_total=revenue_total,
            expense_total=expense_total,
            net_income=net_income,
            line_count=line_count,
        )


def _resolve_retained_earnings(entity: Entity) -> Optional[Account]:
    """First active retained-earnings account on this entity (or shared)."""
    return (
        Account.objects
        .filter(
            Q(entity=entity) | Q(entity__isnull=True),
            organization=entity.organization,
            is_active=True,
            account_subtype="retained_earnings",
        )
        .order_by("code")
        .first()
    )
