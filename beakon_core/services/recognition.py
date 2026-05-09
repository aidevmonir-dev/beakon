"""RecognitionService — multi-period revenue/expense allocation engine.

Implements the founder-paper "Nov–Apr $1,000" use case:

  1. Operator creates a ``RecognitionRule`` describing what to spread,
     over what window, by what method, into which accounts.
  2. ``create_rule()`` builds the ``RecognitionSchedule`` rows up front
     so the full plan is visible before any JE posts.
  3. ``recognize(rule, as_of)`` posts every scheduled period whose
     ``period_end`` falls on or before ``as_of`` and isn't yet posted.
     One JE per period — straight through ``JournalService`` so it picks
     up validation, FX, audit trail, period locks.

Direction of the JE depends on ``rule.rule_type``:

    PREPAID_EXPENSE   →  DR recognition (expense)  / CR deferral (asset)
    DEFERRED_REVENUE  →  DR deferral (liability)   / CR recognition (revenue)
    ACCRUED_EXPENSE   →  DR recognition (expense)  / CR deferral (liability)
    ACCRUED_REVENUE   →  DR deferral (asset)       / CR recognition (revenue)
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date as dt_date
from decimal import Decimal
from typing import Optional

from dateutil.relativedelta import relativedelta
from django.db import transaction
from django.utils import timezone

from .. import constants as c
from ..exceptions import ValidationError
from ..models import (
    Account,
    BillLine,
    Entity,
    InvoiceLine,
    JournalEntry,
    JournalLine,
    RecognitionRule,
    RecognitionSchedule,
)
from ..models.recognition import (
    METHOD_STRAIGHT_LINE_BY_DAY,
    METHOD_STRAIGHT_LINE_BY_PERIOD,
    PERIOD_ANNUAL,
    PERIOD_MONTHLY,
    PERIOD_QUARTERLY,
    RULE_ACCRUED_EXPENSE,
    RULE_ACCRUED_REVENUE,
    RULE_DEFERRED_REVENUE,
    RULE_PREPAID_EXPENSE,
    STATUS_ACTIVE,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
)
from .journal import JournalService


ZERO = Decimal("0")
ROUND = Decimal("0.01")


# Direction map: (debit_attr, credit_attr) → which rule field gets which side.
# Each value is a tuple naming which Account FK on the rule receives DR vs CR.
_DIRECTION = {
    RULE_PREPAID_EXPENSE:  ("recognition_account", "deferral_account"),
    RULE_DEFERRED_REVENUE: ("deferral_account",   "recognition_account"),
    RULE_ACCRUED_EXPENSE:  ("recognition_account", "deferral_account"),
    RULE_ACCRUED_REVENUE:  ("deferral_account",   "recognition_account"),
}


@dataclass
class RecognitionRunResult:
    rule: RecognitionRule
    posted: list[JournalEntry]
    skipped_already_posted: int
    completed_now: bool


class RecognitionService:

    # ── Rule creation ─────────────────────────────────────────────────

    @staticmethod
    @transaction.atomic
    def create_rule(
        *,
        organization,
        entity: Entity,
        code: str,
        name: str,
        rule_type: str,
        total_amount: Decimal,
        currency: str,
        start_date: dt_date,
        end_date: dt_date,
        deferral_account: Account,
        recognition_account: Account,
        period_type: str = PERIOD_MONTHLY,
        method: str = METHOD_STRAIGHT_LINE_BY_PERIOD,
        source_bill_line: Optional[BillLine] = None,
        source_invoice_line: Optional[InvoiceLine] = None,
        source_journal_line: Optional[JournalLine] = None,
        notes: str = "",
        user=None,
    ) -> RecognitionRule:
        """Create a rule and pre-build its schedule rows."""
        if rule_type not in _DIRECTION:
            raise ValidationError(
                f"Unknown rule_type {rule_type!r}.", code="REC001",
            )
        if total_amount <= 0:
            raise ValidationError("total_amount must be positive.", code="REC002")
        if end_date < start_date:
            raise ValidationError("end_date must be on or after start_date.", code="REC003")
        for acct in (deferral_account, recognition_account):
            if acct.organization_id != organization.id:
                raise ValidationError(
                    f"Account {acct.code} does not belong to this organization.",
                    code="REC004",
                )
        if entity.organization_id != organization.id:
            raise ValidationError("Entity does not belong to this organization.", code="REC005")

        rule = RecognitionRule.objects.create(
            organization=organization,
            entity=entity,
            code=code,
            name=name,
            rule_type=rule_type,
            currency=currency.upper(),
            total_amount=Decimal(total_amount),
            recognized_to_date=ZERO,
            start_date=start_date,
            end_date=end_date,
            period_type=period_type,
            method=method,
            deferral_account=deferral_account,
            recognition_account=recognition_account,
            status=STATUS_ACTIVE,
            source_bill_line=source_bill_line,
            source_invoice_line=source_invoice_line,
            source_journal_line=source_journal_line,
            notes=notes,
            created_by=user,
        )
        _build_schedule(rule)
        return rule

    # ── Schedule introspection ────────────────────────────────────────

    @staticmethod
    def schedule(rule: RecognitionRule) -> list[dict]:
        """Return the schedule as a JSON-friendly list."""
        return [
            {
                "sequence": p.sequence,
                "period_start": p.period_start.isoformat(),
                "period_end": p.period_end.isoformat(),
                "amount": str(p.amount),
                "posted": p.is_posted,
                "posted_journal_entry": (
                    p.posted_journal_entry.entry_number if p.posted_journal_entry_id
                    else None
                ),
            }
            for p in rule.schedule_periods.all()
        ]

    # ── Recognition ───────────────────────────────────────────────────

    @staticmethod
    @transaction.atomic
    def recognize(
        rule: RecognitionRule,
        *,
        as_of: dt_date,
        user=None,
    ) -> RecognitionRunResult:
        """Post every pending schedule period with ``period_end <= as_of``.

        Idempotent — a period that already has ``posted_journal_entry`` set
        is skipped silently. When the last pending period is posted, the
        rule flips to COMPLETED.
        """
        if rule.status == STATUS_CANCELLED:
            raise ValidationError(
                f"Rule {rule.code} is cancelled — cannot recognise.",
                code="REC010",
            )

        debit_attr, credit_attr = _DIRECTION[rule.rule_type]
        debit_account = getattr(rule, debit_attr)
        credit_account = getattr(rule, credit_attr)

        due_periods = list(
            rule.schedule_periods
            .filter(posted_journal_entry__isnull=True, period_end__lte=as_of)
            .order_by("sequence")
        )
        already_posted = rule.schedule_periods.filter(
            posted_journal_entry__isnull=False, period_end__lte=as_of,
        ).count()

        posted: list[JournalEntry] = []
        for period in due_periods:
            je_lines = [
                {
                    "account_id": debit_account.id,
                    "debit": period.amount,
                    "currency": rule.currency,
                    "description": (
                        f"{rule.code}: recognise {period.period_start}–"
                        f"{period.period_end} ({period.sequence}/{rule.schedule_periods.count()})"
                    ),
                },
                {
                    "account_id": credit_account.id,
                    "credit": period.amount,
                    "currency": rule.currency,
                    "description": (
                        f"{rule.code}: release deferral for "
                        f"{period.period_start}–{period.period_end}"
                    ),
                },
            ]
            je = JournalService.create_draft(
                organization=rule.organization, entity=rule.entity,
                date=period.period_end,
                lines=je_lines,
                user=None,  # system-created so user can approve
                memo=f"Recognition · {rule.name} · period {period.sequence}",
                reference=f"{rule.code}#{period.sequence}",
                source_type=c.SOURCE_RECOGNITION,
                source_id=rule.id,
                source_ref=f"{rule.code}#{period.sequence}",
                currency=rule.currency,
            )
            JournalService.submit_for_approval(je, user=None)
            JournalService.approve(je, user=user)
            JournalService.post(je, user=user)

            period.posted_journal_entry = je
            period.posted_at = timezone.now()
            period.posted_by = user
            period.save(update_fields=["posted_journal_entry", "posted_at", "posted_by"])

            rule.recognized_to_date = (rule.recognized_to_date or ZERO) + period.amount
            posted.append(je)

        # Flip rule to COMPLETED when every period has posted.
        completed_now = False
        if not rule.schedule_periods.filter(posted_journal_entry__isnull=True).exists():
            if rule.status != STATUS_COMPLETED:
                rule.status = STATUS_COMPLETED
                completed_now = True
        rule.save(update_fields=["recognized_to_date", "status", "updated_at"])

        return RecognitionRunResult(
            rule=rule,
            posted=posted,
            skipped_already_posted=already_posted,
            completed_now=completed_now,
        )

    @staticmethod
    @transaction.atomic
    def cancel(rule: RecognitionRule, *, user=None, reason: str = "") -> RecognitionRule:
        """Mark a rule cancelled. Already-posted periods stay posted.

        Pending periods are simply ignored from now on. Caller is
        responsible for reversing any over-recognised amount via a
        separate JE if needed.
        """
        if rule.status == STATUS_CANCELLED:
            return rule
        rule.status = STATUS_CANCELLED
        rule.cancelled_by = user
        rule.cancelled_at = timezone.now()
        if reason:
            rule.notes = (
                (rule.notes + "\n" if rule.notes else "")
                + f"Cancelled: {reason}"
            )
        rule.save(update_fields=[
            "status", "cancelled_by", "cancelled_at", "notes", "updated_at",
        ])
        return rule


# ── Schedule construction ─────────────────────────────────────────────

def _build_schedule(rule: RecognitionRule) -> None:
    """Generate ``RecognitionSchedule`` rows for the rule's window."""
    periods = list(_period_boundaries(
        rule.start_date, rule.end_date, rule.period_type,
    ))
    if not periods:
        raise ValidationError(
            "Recognition window produced zero periods — check dates / period_type.",
            code="REC020",
        )

    if rule.method == METHOD_STRAIGHT_LINE_BY_PERIOD:
        amounts = _split_equal(rule.total_amount, len(periods))
    elif rule.method == METHOD_STRAIGHT_LINE_BY_DAY:
        amounts = _split_by_days(rule.total_amount, periods)
    else:
        raise ValidationError(
            f"Unsupported allocation method {rule.method!r}.", code="REC021",
        )

    for i, (start, end) in enumerate(periods, start=1):
        RecognitionSchedule.objects.create(
            rule=rule,
            sequence=i,
            period_start=start,
            period_end=end,
            amount=amounts[i - 1],
        )


def _period_boundaries(
    start: dt_date, end: dt_date, period_type: str,
) -> list[tuple[dt_date, dt_date]]:
    """Slice (start, end) into period (start, end) tuples.

    Both endpoints are inclusive. Periods are calendar-aligned for the
    standard cases — monthly returns calendar-month chunks; first chunk
    may begin mid-month, last chunk may end mid-month, so use
    METHOD_STRAIGHT_LINE_BY_DAY when the window is irregular.
    """
    bounds: list[tuple[dt_date, dt_date]] = []
    if period_type == PERIOD_MONTHLY:
        step = relativedelta(months=1)
    elif period_type == PERIOD_QUARTERLY:
        step = relativedelta(months=3)
    elif period_type == PERIOD_ANNUAL:
        step = relativedelta(years=1)
    else:
        raise ValidationError(
            f"Unsupported period_type {period_type!r}.", code="REC022",
        )

    current_start = start
    while current_start <= end:
        # Period end = (current_start + step - 1 day) clamped to overall end.
        candidate_end = current_start + step - relativedelta(days=1)
        period_end = min(candidate_end, end)
        bounds.append((current_start, period_end))
        current_start = period_end + relativedelta(days=1)
    return bounds


def _split_equal(total: Decimal, n: int) -> list[Decimal]:
    """Split ``total`` into ``n`` equal parts, putting rounding remainder
    on the last period so the sum reconciles exactly.
    """
    if n <= 0:
        return []
    base = (Decimal(total) / Decimal(n)).quantize(ROUND)
    parts = [base] * (n - 1)
    parts.append(Decimal(total) - sum(parts, ZERO))
    return parts


def _split_by_days(total: Decimal, periods: list[tuple[dt_date, dt_date]]) -> list[Decimal]:
    """Pro-rata by day count across the period window."""
    day_counts = [(end - start).days + 1 for start, end in periods]
    total_days = sum(day_counts)
    if total_days <= 0:
        return _split_equal(total, len(periods))
    parts: list[Decimal] = []
    running = ZERO
    for i, days in enumerate(day_counts):
        if i == len(day_counts) - 1:
            parts.append(Decimal(total) - running)
        else:
            piece = (Decimal(total) * Decimal(days) / Decimal(total_days)).quantize(ROUND)
            parts.append(piece)
            running += piece
    return parts
