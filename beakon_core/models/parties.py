"""Vendor & Customer master data — the "counterparty" dimension on a JE.

Design notes (blueprint p.3: "intake invoices, receipts, bank transactions";
p.7: "drill down from reports to journal entries to source documents"):

- **Org-scoped, not entity-scoped.** A family-office utility provider bills
  HoldCo AND OpCo; forcing per-entity duplication is friction. Vendors and
  customers live at the Organization level. If Thomas later wants to
  restrict a vendor to a single entity, add an optional ``entity`` FK.

- **Soft delete via ``is_active``.** Never hard-delete — past JEs reference
  them and history must remain readable.

- **Default account suggestions.** ``default_expense_account`` on a vendor
  lets OCR / manual-bill workflows pre-fill the debit side. ``default_
  revenue_account`` does the same for customer invoices.

- **AP/AR aging** will read off the ``vendor`` / ``customer`` FKs on
  ``JournalEntry`` once bill/invoice lifecycles are built. For now the
  linkage is informational — drill-down shows "who did this JE come from".
"""
from django.conf import settings
from django.db import models

from organizations.models import Organization


class Party(models.Model):
    """Abstract base shared by Vendor + Customer."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE,
        related_name="%(class)ss",
    )
    code = models.CharField(
        max_length=30,
        help_text="Short identifier, unique per organization (e.g. STAPLES, ACME-INC).",
    )
    name = models.CharField(max_length=255)
    legal_name = models.CharField(max_length=255, blank=True)
    tax_id = models.CharField(
        max_length=100, blank=True,
        help_text="EIN, VAT number, etc. Kept as free text for multi-jurisdiction flexibility.",
    )

    email = models.EmailField(max_length=255, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    website = models.URLField(max_length=255, blank=True)

    # Address
    address_line1 = models.CharField(max_length=255, blank=True)
    address_line2 = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=100, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)
    country = models.CharField(max_length=2, blank=True, help_text="ISO 3166 alpha-2.")

    default_currency = models.CharField(
        max_length=3, blank=True,
        help_text="ISO 4217. Blank = falls back to the entity's functional currency.",
    )
    default_payment_terms_days = models.PositiveIntegerField(
        default=30,
        help_text="Net days for bills (vendor) or invoices (customer).",
    )

    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ["name"]

    def __str__(self):
        return f"{self.code} · {self.name}"


class Vendor(Party):
    """A supplier we pay. Bills, expense allocations, AP aging key off this."""

    default_expense_account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="default_for_vendors",
        help_text="Pre-fills the debit line on bills from this vendor.",
    )
    bank_details = models.TextField(
        blank=True,
        help_text="Remittance instructions, IBAN/SWIFT, etc. Kept as free text.",
    )

    class Meta:
        db_table = "beakon_vendor"
        unique_together = ("organization", "code")
        indexes = [
            models.Index(fields=["organization", "is_active"]),
            models.Index(fields=["organization", "name"]),
        ]


class Customer(Party):
    """A party we bill. Invoices, revenue allocations, AR aging key off this."""

    default_revenue_account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="default_for_customers",
        help_text="Pre-fills the credit line on invoices to this customer.",
    )
    credit_limit = models.DecimalField(
        max_digits=19, decimal_places=2, null=True, blank=True,
        help_text="Optional cap on outstanding AR. Informational in v1.",
    )

    class Meta:
        db_table = "beakon_customer"
        unique_together = ("organization", "code")
        indexes = [
            models.Index(fields=["organization", "is_active"]),
            models.Index(fields=["organization", "name"]),
        ]
