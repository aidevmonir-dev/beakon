"""Bill + BillLine — accounts payable workflow on top of the kernel.

Blueprint p.4 ("invoice/receipt ingestion") + p.2 ("no ledger entry should
be posted without appropriate approval"). A Bill has its own status machine
and emits journal entries at two lifecycle points:

    approve()     → accrual JE posted: DR Expense / CR Accounts Payable
    mark_paid()   → payment  JE posted: DR Accounts Payable / CR Bank

Both JEs are created + submitted by the SYSTEM and approved + posted by the
user who triggered the lifecycle action. That keeps the self-approval
guard happy (system ≠ user) while avoiding a second human approval step.

Status machine (v1):

    draft → pending_approval → approved → paid
                            → rejected → draft
    draft → cancelled
    pending_approval → cancelled

Fields the AP aging report keys off: ``status='approved'`` AND no ``paid_at``
yet. ``due_date`` slots those into age buckets.
"""
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from organizations.models import Organization


# ── Bill status ────────────────────────────────────────────────────────────
BILL_DRAFT = "draft"
BILL_PENDING_APPROVAL = "pending_approval"
BILL_APPROVED = "approved"
BILL_PAID = "paid"
BILL_REJECTED = "rejected"
BILL_CANCELLED = "cancelled"

BILL_STATUS_CHOICES = [
    (BILL_DRAFT, "Draft"),
    (BILL_PENDING_APPROVAL, "Pending Approval"),
    (BILL_APPROVED, "Approved"),
    (BILL_PAID, "Paid"),
    (BILL_REJECTED, "Rejected"),
    (BILL_CANCELLED, "Cancelled"),
]

# Allowed status transitions — the service layer enforces these.
BILL_TRANSITIONS = {
    BILL_DRAFT:              {BILL_PENDING_APPROVAL, BILL_CANCELLED},
    BILL_PENDING_APPROVAL:   {BILL_APPROVED, BILL_REJECTED, BILL_CANCELLED, BILL_DRAFT},
    BILL_APPROVED:           {BILL_PAID},
    BILL_REJECTED:           {BILL_DRAFT},
    BILL_PAID:               set(),  # terminal — use JE reversal to correct
    BILL_CANCELLED:          set(),  # terminal
}

BILL_EDITABLE = {BILL_DRAFT, BILL_REJECTED}
# Bills in these statuses contribute to AP aging (outstanding payables).
BILL_OUTSTANDING = {BILL_APPROVED}


class Bill(models.Model):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="bills",
    )
    entity = models.ForeignKey(
        "beakon_core.Entity", on_delete=models.PROTECT, related_name="bills",
    )
    vendor = models.ForeignKey(
        "beakon_core.Vendor", on_delete=models.PROTECT, related_name="bills",
    )

    # Our internal reference — sequential per org.
    reference = models.CharField(
        max_length=50,
        help_text="Auto-assigned BILL-NNNNNN per organization.",
    )
    # Vendor's invoice number — free text, often their system's ID.
    bill_number = models.CharField(max_length=100, blank=True)

    invoice_date = models.DateField()
    due_date = models.DateField()
    received_at = models.DateTimeField(auto_now_add=True)

    currency = models.CharField(max_length=3)
    subtotal = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    tax_amount = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    total = models.DecimalField(
        max_digits=19, decimal_places=4,
        validators=[MinValueValidator(Decimal("0"))],
    )

    status = models.CharField(
        max_length=20, choices=BILL_STATUS_CHOICES, default=BILL_DRAFT,
    )

    description = models.TextField(blank=True)
    explanation = models.TextField(
        blank=True,
        help_text=(
            "Long-form rationale: WHY this bill exists and WHY each side of "
            "the resulting JE is debited or credited. Propagates to "
            "JournalEntry.explanation when the accrual JE posts."
        ),
    )
    notes = models.TextField(blank=True)

    # ── B6: which LearningRules the AI followed when prefilling this
    # draft. Used by the feedback loop — success_count goes up when this
    # bill is approved, override_count goes up if the reviewer files a
    # BillCorrection. Empty list when the bill was created manually or
    # when no rules applied.
    ai_applied_rule_ids = models.JSONField(default=list, blank=True)

    # ── Accrual JE linkage (DR Expense / CR AP on approval) ──────────
    accrual_journal_entry = models.ForeignKey(
        "beakon_core.JournalEntry", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="billed_as_accrual",
    )

    # ── Payment linkage (DR AP / CR Bank on mark_paid) ───────────────
    payment_journal_entry = models.ForeignKey(
        "beakon_core.JournalEntry", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="billed_as_payment",
    )
    payment_date = models.DateField(null=True, blank=True)
    payment_bank_account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.PROTECT,
        null=True, blank=True, related_name="bills_paid_from",
        help_text="Cash / bank account the payment was drawn from.",
    )
    payment_reference = models.CharField(
        max_length=255, blank=True,
        help_text="Wire ref, check number, or similar.",
    )

    # ── Actor stamps for each status transition ─────────────────────
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="bills_created",
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bills_submitted",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bills_approved",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bills_rejected",
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bills_paid",
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bills_cancelled",
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_bill"
        unique_together = ("organization", "reference")
        ordering = ["-invoice_date", "-reference"]
        indexes = [
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["vendor", "status"]),
            models.Index(fields=["entity", "status"]),
            models.Index(fields=["due_date"]),
        ]

    def __str__(self):
        return f"{self.reference} · {self.vendor.code} · {self.total} {self.currency}"


class BillLine(models.Model):
    bill = models.ForeignKey(
        Bill, on_delete=models.CASCADE, related_name="lines",
    )
    expense_account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.PROTECT,
        related_name="bill_lines",
        help_text="The account that will be DEBITED on the accrual JE.",
    )
    description = models.CharField(max_length=500, blank=True)
    quantity = models.DecimalField(
        max_digits=12, decimal_places=4, default=Decimal("1"),
    )
    unit_price = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    amount = models.DecimalField(
        max_digits=19, decimal_places=4,
        validators=[MinValueValidator(Decimal("0"))],
        help_text="Pre-tax amount for this line (= quantity × unit_price, usually).",
    )
    tax_code = models.ForeignKey(
        "beakon_core.TaxCode", on_delete=models.PROTECT,
        null=True, blank=True, related_name="bill_lines",
        help_text="VAT/tax code applied to this line. NULL = no tax on this line.",
    )
    tax_amount = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
        help_text="VAT amount on this line. Auto-derivable from tax_code.rate × amount, "
                  "but stored explicitly so manual overrides + rounding decisions stick.",
    )
    line_order = models.IntegerField(default=0)

    class Meta:
        db_table = "beakon_billline"
        ordering = ["line_order"]
        indexes = [
            models.Index(fields=["bill"]),
            models.Index(fields=["expense_account"]),
        ]

    def __str__(self):
        return f"{self.bill.reference}#{self.line_order}: {self.expense_account.code} {self.amount}"


class BillCorrection(models.Model):
    """User-written note telling Beakon what the AI got wrong on a bill.

    Thomas's 2026-05-12 directive: when the AI proposes a JE that's not
    quite right, the reviewer writes the rationale here ("VAT here is
    non-recoverable", "this is rent not opex", "split across 6 months").
    Phase A captures the note + a snapshot of what the AI originally
    proposed. Phase B retrieves the latest corrections for a vendor and
    injects them into the next OCR extraction prompt so Beakon learns.

    One row per save event — we keep history so the future learning loop
    can query "all corrections from this org for this vendor over time".

    Vendor is denormalised off the bill at write time so Phase B can
    range-scan by vendor without joining through Bill (and so the
    correction stays attached to a vendor even if the bill is later
    cancelled).
    """

    bill = models.ForeignKey(
        Bill, on_delete=models.CASCADE, related_name="corrections",
    )
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE,
        related_name="bill_corrections",
    )
    vendor = models.ForeignKey(
        "beakon_core.Vendor", on_delete=models.PROTECT,
        related_name="bill_corrections",
        help_text="Denormalised from bill.vendor for fast retrieval at "
                  "extraction time.",
    )
    # Plain-English explanation of the correction (always saved).
    correction_text = models.TextField(
        help_text="Plain-language description of what the AI got wrong "
                  "on this draft. Always required.",
    )
    # Structured labels per Thomas's 2026-05-12 spec §3: lets the future
    # learning loop classify what kind of mistake it was. Stored as an
    # array of canonical keys (wrong_account, wrong_amount, duplicate_line,
    # vat_treatment_wrong, missing_allocation, wrong_entity, wrong_vendor,
    # wrong_description, other). Free-form so the UI taxonomy can evolve
    # without a migration.
    error_types = models.JSONField(
        default=list, blank=True,
        help_text="List of structured error-type keys the user checked.",
    )
    # Thomas §3 step 5: a correction may be one-off OR become a reusable
    # rule. This flag captures the user's scope choice; when True, B3's
    # LearningRule promotion logic will create a rule from this row.
    make_reusable_rule = models.BooleanField(
        default=False,
        help_text="True = user opted to remember this for future invoices.",
    )
    # When make_reusable_rule is True, this is the plain-English rule
    # instruction (different from correction_text — describes how Beakon
    # should handle SIMILAR invoices, not what was wrong with this one).
    future_rule_instruction = models.TextField(
        blank=True,
        help_text="Plain-English instruction for future similar invoices. "
                  "Empty for one-off corrections.",
    )
    ai_proposal_snapshot = models.JSONField(
        default=dict, blank=True,
        help_text="Snapshot of the AI's proposed JE / extraction at the "
                  "moment the correction was written. Lets later UIs show "
                  "'AI proposed X, you corrected to Y'.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="bill_corrections_made",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "beakon_billcorrection"
        ordering = ["-created_at"]
        indexes = [
            # Phase B's hot path: latest corrections per (org, vendor).
            models.Index(fields=["organization", "vendor", "-created_at"]),
            models.Index(fields=["bill"]),
        ]

    def __str__(self):
        return f"Correction on {self.bill.reference} by {self.created_by_id or '—'}"
