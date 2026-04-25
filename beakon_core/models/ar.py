"""Invoice + InvoiceLine — accounts receivable workflow.

Mirror of beakon_core.models.ap (Bill). On issue we DR the AR account and
CR each line's revenue account; on payment receipt we DR the bank account
and CR AR. Both JEs are system-created and user-approved, same self-
approval-safe pattern as bills.

Status machine (v1):
    draft → pending_approval → issued → paid
                            → rejected → draft
    draft → cancelled
    pending_approval → cancelled

We use "issued" rather than "approved" because that's the natural AR
language — internally it's the approval point that triggers the JE.
"""
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from organizations.models import Organization


# ── Invoice status ─────────────────────────────────────────────────────────
INVOICE_DRAFT = "draft"
INVOICE_PENDING_APPROVAL = "pending_approval"
INVOICE_ISSUED = "issued"
INVOICE_PAID = "paid"
INVOICE_REJECTED = "rejected"
INVOICE_CANCELLED = "cancelled"

INVOICE_STATUS_CHOICES = [
    (INVOICE_DRAFT, "Draft"),
    (INVOICE_PENDING_APPROVAL, "Pending Approval"),
    (INVOICE_ISSUED, "Issued"),
    (INVOICE_PAID, "Paid"),
    (INVOICE_REJECTED, "Rejected"),
    (INVOICE_CANCELLED, "Cancelled"),
]

INVOICE_TRANSITIONS = {
    INVOICE_DRAFT:              {INVOICE_PENDING_APPROVAL, INVOICE_CANCELLED},
    INVOICE_PENDING_APPROVAL:   {INVOICE_ISSUED, INVOICE_REJECTED, INVOICE_CANCELLED, INVOICE_DRAFT},
    INVOICE_ISSUED:             {INVOICE_PAID},
    INVOICE_REJECTED:           {INVOICE_DRAFT},
    INVOICE_PAID:               set(),    # terminal — reverse via JE if needed
    INVOICE_CANCELLED:          set(),
}

INVOICE_EDITABLE = {INVOICE_DRAFT, INVOICE_REJECTED}
# Issued-and-not-yet-paid invoices form the AR aging.
INVOICE_OUTSTANDING = {INVOICE_ISSUED}


class Invoice(models.Model):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="invoices",
    )
    entity = models.ForeignKey(
        "beakon_core.Entity", on_delete=models.PROTECT, related_name="invoices",
    )
    customer = models.ForeignKey(
        "beakon_core.Customer", on_delete=models.PROTECT, related_name="invoices",
    )

    # Our internal ref — sequential per org.
    reference = models.CharField(
        max_length=50,
        help_text="Auto-assigned INV-NNNNNN per organization.",
    )
    # The number we put on the invoice the customer sees.
    invoice_number = models.CharField(
        max_length=100, blank=True,
        help_text="Customer-facing invoice number; defaults to reference if blank.",
    )

    invoice_date = models.DateField()
    due_date = models.DateField()
    issued_at = models.DateTimeField(null=True, blank=True)

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
        max_length=20, choices=INVOICE_STATUS_CHOICES, default=INVOICE_DRAFT,
    )

    description = models.TextField(blank=True)
    notes = models.TextField(blank=True)

    # ── Issuance JE linkage (DR AR / CR Revenue on issue) ─────────────
    issued_journal_entry = models.ForeignKey(
        "beakon_core.JournalEntry", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="invoiced_as_issuance",
    )

    # ── Payment receipt linkage (DR Bank / CR AR) ─────────────────────
    payment_journal_entry = models.ForeignKey(
        "beakon_core.JournalEntry", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="invoiced_as_payment",
    )
    payment_date = models.DateField(null=True, blank=True)
    payment_bank_account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.PROTECT,
        null=True, blank=True, related_name="invoices_received_into",
        help_text="Cash / bank account the receipt landed in.",
    )
    payment_reference = models.CharField(max_length=255, blank=True)

    # ── Actor stamps ─────────────────────────────────────────────────
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="invoices_created",
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="invoices_submitted",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="invoices_issued",
    )
    rejected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="invoices_rejected",
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="invoices_paid",
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="invoices_cancelled",
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_invoice"
        unique_together = ("organization", "reference")
        ordering = ["-invoice_date", "-reference"]
        indexes = [
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["customer", "status"]),
            models.Index(fields=["entity", "status"]),
            models.Index(fields=["due_date"]),
        ]

    def __str__(self):
        return f"{self.reference} · {self.customer.code} · {self.total} {self.currency}"


class InvoiceLine(models.Model):
    invoice = models.ForeignKey(
        Invoice, on_delete=models.CASCADE, related_name="lines",
    )
    revenue_account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.PROTECT,
        related_name="invoice_lines",
        help_text="The account that will be CREDITED on the issuance JE.",
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
        help_text="Pre-tax amount for this line.",
    )
    line_order = models.IntegerField(default=0)

    class Meta:
        db_table = "beakon_invoiceline"
        ordering = ["line_order"]
        indexes = [
            models.Index(fields=["invoice"]),
            models.Index(fields=["revenue_account"]),
        ]

    def __str__(self):
        return f"{self.invoice.reference}#{self.line_order}: {self.revenue_account.code} {self.amount}"
