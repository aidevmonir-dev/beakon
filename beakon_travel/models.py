"""Travel & Expense — claim header + line items.

Per the UI philosophy doc (2026-05-10), Travel Expense Management is a
full operational workflow (trips, claims, receipts, approvals,
reimbursements, policies, reporting), designed to grow into broader
Expense / Spend Management later.

v1 scope:
  • TripClaim — header (purpose, destination, dates, currency, status)
  • TripExpense — line items (category, merchant, amount, receipt URL)
  • Status flow: draft → submitted → approved (or rejected) → reimbursed

Reimbursement currently flips a status flag and timestamps the row.
Auto-posting reimbursement journal entries (AP integration) is a
separate workstream — the engine kernel intentionally stays untouched
in this commit.

The "employee" on a claim is the User who created it. When the
Employment module ships (Item 11), claims will FK to a proper
Employee row; until then we use User to keep the data layer honest
about who incurred the spend.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models

from beakon_core.models.core import Entity
from organizations.models import Organization


# ── Status & category constants ───────────────────────────────────────

STATUS_DRAFT = "draft"
STATUS_SUBMITTED = "submitted"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_REIMBURSED = "reimbursed"

STATUS_CHOICES = [
    (STATUS_DRAFT, "Draft"),
    (STATUS_SUBMITTED, "Submitted for approval"),
    (STATUS_APPROVED, "Approved"),
    (STATUS_REJECTED, "Rejected"),
    (STATUS_REIMBURSED, "Reimbursed"),
]


CATEGORY_TRANSPORT = "transport"
CATEGORY_ACCOMMODATION = "accommodation"
CATEGORY_MEALS = "meals"
CATEGORY_PER_DIEM = "per_diem"
CATEGORY_ENTERTAINMENT = "entertainment"
CATEGORY_FUEL = "fuel"
CATEGORY_MILEAGE = "mileage"
CATEGORY_CONFERENCE = "conference"
CATEGORY_OTHER = "other"

CATEGORY_CHOICES = [
    (CATEGORY_TRANSPORT, "Transport (flight, train, taxi)"),
    (CATEGORY_ACCOMMODATION, "Accommodation"),
    (CATEGORY_MEALS, "Meals"),
    (CATEGORY_PER_DIEM, "Per diem"),
    (CATEGORY_ENTERTAINMENT, "Entertainment"),
    (CATEGORY_FUEL, "Fuel"),
    (CATEGORY_MILEAGE, "Mileage"),
    (CATEGORY_CONFERENCE, "Conference / training"),
    (CATEGORY_OTHER, "Other"),
]


class TripClaim(models.Model):
    """A travel-expense claim — one trip, many expense lines.

    The "employee" is `created_by` for v1; will migrate to a proper
    Employee FK once the Employment module exists.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="trip_claims",
    )
    entity = models.ForeignKey(
        Entity, on_delete=models.PROTECT, related_name="trip_claims",
        help_text="The entity that bears this cost.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="trip_claims",
    )
    employee = models.ForeignKey(
        "beakon_employment.Employee",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="trip_claims",
        help_text="Employee record for the claimant — auto-linked when the "
                  "user has an Employee profile. Per the data-architecture "
                  "principle: Travel references the canonical Employee row "
                  "rather than duplicating identity fields.",
    )

    title = models.CharField(
        max_length=200,
        help_text="Short label, e.g. 'Trip to Geneva — March 2026'.",
    )
    purpose = models.TextField(
        blank=True,
        help_text="Business purpose of the trip.",
    )
    destination = models.CharField(max_length=200, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    currency = models.CharField(
        max_length=3, default="CHF",
        help_text="Currency in which the claim totals are expressed.",
    )

    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT,
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="approved_trip_claims",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    reimbursed_at = models.DateTimeField(null=True, blank=True)

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_trip_claim"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "created_by"]),
        ]

    def __str__(self):
        return f"{self.title} ({self.get_status_display()})"

    @property
    def total_amount(self) -> Decimal:
        agg = self.expenses.aggregate(total=models.Sum("amount_in_claim_currency"))
        return agg["total"] or Decimal("0")

    @property
    def is_editable(self) -> bool:
        """Expense lines can be added/edited only while claim is draft
        or has been rejected (so the employee can fix and resubmit)."""
        return self.status in (STATUS_DRAFT, STATUS_REJECTED)


class TripExpense(models.Model):
    """A single receipt / expense line on a trip claim."""

    claim = models.ForeignKey(
        TripClaim, on_delete=models.CASCADE, related_name="expenses",
    )

    date = models.DateField(null=True, blank=True)
    category = models.CharField(
        max_length=30, choices=CATEGORY_CHOICES, default=CATEGORY_OTHER,
    )
    description = models.CharField(max_length=255, blank=True)
    merchant = models.CharField(max_length=200, blank=True)

    amount = models.DecimalField(
        max_digits=14, decimal_places=2,
        help_text="Amount on the receipt, in `currency`.",
    )
    currency = models.CharField(max_length=3, default="CHF")
    fx_rate = models.DecimalField(
        max_digits=20, decimal_places=10, null=True, blank=True,
        help_text="FX rate used to translate to the claim currency. "
                  "Blank = same currency.",
    )
    amount_in_claim_currency = models.DecimalField(
        max_digits=14, decimal_places=2,
        help_text="Translated amount in the claim's currency.",
    )
    vat_amount = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        help_text="VAT included in `amount`, in the receipt currency. Optional.",
    )

    receipt_url = models.URLField(
        max_length=500, blank=True,
        help_text="External link to the receipt image / PDF. v1 placeholder "
                  "until Document module attaches files directly.",
    )
    billable_to_client = models.BooleanField(
        default=False,
        help_text="If true, this line can be invoiced to a client via the "
                  "Disbursements flow.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_trip_expense"
        ordering = ["date", "id"]
        indexes = [
            models.Index(fields=["claim", "category"]),
        ]

    def __str__(self):
        return f"{self.get_category_display()} · {self.amount} {self.currency}"
