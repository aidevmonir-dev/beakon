"""Tax / VAT models — Architecture PDF layer 4 (Accounting Engine, "VAT logic").

A ``TaxCode`` is the bridge between a transactional rate (e.g. Swiss
standard VAT 8.1%) and the GL accounts that VAT lands on:

  - ``output_account``  — credited when the firm collects VAT on sales
    (a liability, e.g. "VAT payable").
  - ``input_account``   — debited when the firm pays VAT on purchases
    (an asset, e.g. "VAT receivable / input VAT recoverable"). May be
    NULL for sales-only or non-recoverable codes.

A ``BillLine`` or ``InvoiceLine`` links to a ``TaxCode`` and carries its
own ``tax_amount`` — the engine then splits the JE into a VAT line per
tax code at posting time.

V1 supports accrual-basis VAT (book at bill approval / invoice issue).
Cash-basis (the Swiss "effective" small-business method) needs a follow-
up service that defers VAT until payment — out of scope for this build.
"""
from __future__ import annotations

from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from organizations.models import Organization


# ── TaxCode "tax_type" controlled list ─────────────────────────────────
TAX_TYPE_STANDARD = "STANDARD"
TAX_TYPE_REDUCED = "REDUCED"
TAX_TYPE_SPECIAL = "SPECIAL"          # e.g. Swiss accommodation 3.8%
TAX_TYPE_ZERO = "ZERO"                # zero-rated (taxable but 0%)
TAX_TYPE_EXEMPT = "EXEMPT"            # exempt-from-VAT (out-of-scope)
TAX_TYPE_REVERSE_CHARGE = "REVERSE_CHARGE"

TAX_TYPE_CHOICES = [
    (TAX_TYPE_STANDARD, "Standard"),
    (TAX_TYPE_REDUCED, "Reduced"),
    (TAX_TYPE_SPECIAL, "Special"),
    (TAX_TYPE_ZERO, "Zero-rated"),
    (TAX_TYPE_EXEMPT, "Exempt"),
    (TAX_TYPE_REVERSE_CHARGE, "Reverse charge"),
]


class TaxCode(models.Model):
    """A reusable VAT/tax rate definition."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="tax_codes",
    )
    code = models.CharField(
        max_length=40,
        help_text="Stable identifier — e.g. CH-VAT-STD, CH-VAT-RED, CH-VAT-ZERO.",
    )
    name = models.CharField(max_length=120)
    country_code = models.CharField(
        max_length=4, blank=True,
        help_text="ISO country code, e.g. CH, DE, GB.",
    )
    tax_type = models.CharField(
        max_length=20, choices=TAX_TYPE_CHOICES, default=TAX_TYPE_STANDARD,
    )
    rate = models.DecimalField(
        max_digits=7, decimal_places=4, default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100"))],
        help_text="Percentage rate. 8.1000 means 8.1%.",
    )

    output_account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.PROTECT,
        null=True, blank=True, related_name="tax_codes_as_output",
        help_text="GL account credited on sales (typically a vat_payable subtype). "
                  "Can be NULL for purchase-only codes.",
    )
    input_account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.PROTECT,
        null=True, blank=True, related_name="tax_codes_as_input",
        help_text="GL account debited on purchases (typically vat_receivable). "
                  "NULL = non-recoverable (e.g. exempt) — VAT cost gets baked into expense.",
    )

    is_reverse_charge = models.BooleanField(
        default=False,
        help_text="If true, posting books both DR Input VAT and CR Output VAT for the "
                  "same amount (B2B cross-border services in EU/CH).",
    )
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)
    active_flag = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_tax_code"
        unique_together = ("organization", "code")
        ordering = ["country_code", "code"]
        indexes = [
            models.Index(fields=["organization", "active_flag"]),
            models.Index(fields=["organization", "country_code"]),
        ]

    def __str__(self):
        return f"{self.code} · {self.name} ({self.rate}%)"

    @property
    def rate_decimal(self) -> Decimal:
        """Return the rate as a 0–1 multiplier (e.g. 8.1% → Decimal('0.081'))."""
        return self.rate / Decimal("100")

    def compute_tax(self, base: Decimal) -> Decimal:
        """Compute VAT amount from a pre-tax base. Caller is responsible for rounding."""
        return (Decimal(base) * self.rate_decimal)
