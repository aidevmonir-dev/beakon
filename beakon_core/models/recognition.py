"""Recognition rules registry — multi-period revenue/expense allocation.

Founder-paper headline use case (Nov–Apr $1,000 example):
    "I pay $1,000 for an insurance policy in Nov; the cover runs Nov–Apr.
    I want $166.67 expensed each month, not the whole $1,000 in November."

Four rule types, all running on the same engine — only the journal direction
differs:

    PREPAID_EXPENSE   — money has been paid; cost is a prepaid asset; each
                        period: DR expense / CR prepaid.
    DEFERRED_REVENUE  — money has been received; carried as a liability;
                        each period: DR deferred / CR revenue.
    ACCRUED_EXPENSE   — service consumed before invoice; each period:
                        DR expense / CR accrued liability.
    ACCRUED_REVENUE   — revenue earned before invoice; each period:
                        DR accrued asset / CR revenue.

A ``RecognitionRule`` is the policy. ``RecognitionSchedule`` rows are the
per-period plan with ``posted_journal_entry`` FKs that flip from null to
set as the engine posts each period. This keeps the audit trail crystal-
clear ("show me which periods have been recognised, which JEs they were").
"""
from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from organizations.models import Organization


# ── Rule type ─────────────────────────────────────────────────────────
RULE_PREPAID_EXPENSE = "PREPAID_EXPENSE"
RULE_DEFERRED_REVENUE = "DEFERRED_REVENUE"
RULE_ACCRUED_EXPENSE = "ACCRUED_EXPENSE"
RULE_ACCRUED_REVENUE = "ACCRUED_REVENUE"

RECOGNITION_RULE_TYPE_CHOICES = [
    (RULE_PREPAID_EXPENSE, "Prepaid expense (amortize over time)"),
    (RULE_DEFERRED_REVENUE, "Deferred revenue (release over time)"),
    (RULE_ACCRUED_EXPENSE, "Accrued expense (recognise before invoice)"),
    (RULE_ACCRUED_REVENUE, "Accrued revenue (recognise before invoice)"),
]


# ── Allocation method ─────────────────────────────────────────────────
METHOD_STRAIGHT_LINE_BY_PERIOD = "STRAIGHT_LINE_BY_PERIOD"
METHOD_STRAIGHT_LINE_BY_DAY = "STRAIGHT_LINE_BY_DAY"

ALLOCATION_METHOD_CHOICES = [
    (METHOD_STRAIGHT_LINE_BY_PERIOD,
     "Straight line — equal amount per period (rounding lands on last)"),
    (METHOD_STRAIGHT_LINE_BY_DAY,
     "Straight line — pro-rata by day count"),
]


# ── Period type ───────────────────────────────────────────────────────
PERIOD_MONTHLY = "MONTHLY"
PERIOD_QUARTERLY = "QUARTERLY"
PERIOD_ANNUAL = "ANNUAL"

RECOGNITION_PERIOD_CHOICES = [
    (PERIOD_MONTHLY, "Monthly"),
    (PERIOD_QUARTERLY, "Quarterly"),
    (PERIOD_ANNUAL, "Annual"),
]


# ── Rule status ───────────────────────────────────────────────────────
STATUS_ACTIVE = "ACTIVE"
STATUS_COMPLETED = "COMPLETED"
STATUS_CANCELLED = "CANCELLED"

RECOGNITION_STATUS_CHOICES = [
    (STATUS_ACTIVE, "Active"),
    (STATUS_COMPLETED, "Completed"),
    (STATUS_CANCELLED, "Cancelled"),
]


class RecognitionRule(models.Model):
    """Policy for spreading one amount across multiple periods."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="recognition_rules",
    )
    entity = models.ForeignKey(
        "beakon_core.Entity", on_delete=models.PROTECT,
        related_name="recognition_rules",
    )
    code = models.CharField(
        max_length=80,
        help_text="Stable identifier — e.g. PREPAID-INS-2026, DEF-REV-Q3.",
    )
    name = models.CharField(max_length=255)
    rule_type = models.CharField(max_length=20, choices=RECOGNITION_RULE_TYPE_CHOICES)

    # ── Source linkage (optional — provenance only; engine doesn't depend on it) ──
    source_bill_line = models.ForeignKey(
        "beakon_core.BillLine", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="recognition_rules",
    )
    source_invoice_line = models.ForeignKey(
        "beakon_core.InvoiceLine", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="recognition_rules",
    )
    source_journal_line = models.ForeignKey(
        "beakon_core.JournalLine", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="recognition_rules",
    )

    # ── Amount ──
    currency = models.CharField(max_length=3)
    total_amount = models.DecimalField(
        max_digits=19, decimal_places=4,
        validators=[MinValueValidator(Decimal("0.0001"))],
    )
    recognized_to_date = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
    )

    # ── Schedule ──
    start_date = models.DateField()
    end_date = models.DateField()
    period_type = models.CharField(
        max_length=12, choices=RECOGNITION_PERIOD_CHOICES, default=PERIOD_MONTHLY,
    )
    method = models.CharField(
        max_length=32, choices=ALLOCATION_METHOD_CHOICES,
        default=METHOD_STRAIGHT_LINE_BY_PERIOD,
    )

    # ── Accounts ──
    # Naming kept neutral so all four rule types use the same shape:
    #   - PREPAID_EXPENSE: deferral=Prepaid (asset),  recognition=Expense
    #   - DEFERRED_REVENUE: deferral=Deferred (liab), recognition=Revenue
    #   - ACCRUED_EXPENSE: deferral=Accrued (liab),   recognition=Expense
    #   - ACCRUED_REVENUE: deferral=Accrued (asset),  recognition=Revenue
    deferral_account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.PROTECT,
        related_name="recognition_rules_as_deferral",
        help_text="Balance-sheet account holding the unrecognised amount.",
    )
    recognition_account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.PROTECT,
        related_name="recognition_rules_as_recognition",
        help_text="P&L account each period's recognised amount lands on.",
    )

    # ── Lifecycle ──
    status = models.CharField(
        max_length=12, choices=RECOGNITION_STATUS_CHOICES, default=STATUS_ACTIVE,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="recognition_rules_created",
    )
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="recognition_rules_cancelled",
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_recognition_rule"
        unique_together = ("organization", "code")
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["entity", "status"]),
            models.Index(fields=["rule_type", "status"]),
        ]

    def __str__(self):
        return f"{self.code} · {self.rule_type} · {self.total_amount} {self.currency}"

    @property
    def remaining_amount(self) -> Decimal:
        return self.total_amount - self.recognized_to_date


class RecognitionSchedule(models.Model):
    """One scheduled recognition period for a rule.

    Generated from the rule at creation time (so the operator can see the
    full schedule up front). ``posted_journal_entry`` is null until the
    engine posts that period; recognising a period more than once is
    refused at the service layer.
    """

    rule = models.ForeignKey(
        RecognitionRule, on_delete=models.CASCADE, related_name="schedule_periods",
    )
    sequence = models.PositiveIntegerField(
        help_text="1-based ordinal — the Nth period in the schedule.",
    )
    period_start = models.DateField()
    period_end = models.DateField()
    amount = models.DecimalField(max_digits=19, decimal_places=4)

    posted_journal_entry = models.ForeignKey(
        "beakon_core.JournalEntry", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="recognition_schedule_periods",
    )
    posted_at = models.DateTimeField(null=True, blank=True)
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="recognition_periods_posted",
    )

    class Meta:
        db_table = "beakon_recognition_schedule"
        unique_together = ("rule", "sequence")
        ordering = ["rule", "sequence"]
        indexes = [
            models.Index(fields=["rule", "posted_journal_entry"]),
            models.Index(fields=["period_end"]),
        ]

    def __str__(self):
        posted = "posted" if self.posted_journal_entry_id else "pending"
        return f"{self.rule.code} #{self.sequence} {self.period_end} {self.amount} ({posted})"

    @property
    def is_posted(self) -> bool:
        return self.posted_journal_entry_id is not None
