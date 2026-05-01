"""Governed master tables — Thomas's workbook tabs 07–17.

Each master corresponds to one of the master tabs in the wealth-management CoA
workbook (`2026 04 17-DRAFT-CoA-Wealth management v2.xlsx`). The general rule
Thomas wrote: *"needs a master if the object has contractual terms, lifecycle
state, valuation rules, accrual / amortization logic, disclosure logic,
workflow ownership."*

This module starts with **TaxLot** (tab 17). Future masters will be added in
the same shape:

  - organization-scoped
  - workbook ID kept as the natural key (`tax_lot_id`, `loan_id`, …)
  - FK columns where the linked master already exists in the codebase;
    plain string codes where it doesn't yet (the workbook is the source of
    truth until those masters are built).
  - `workbook_metadata` JSONField for round-trip of any column not yet
    promoted to a dedicated DB column.
"""
from __future__ import annotations

from django.db import models

from organizations.models import Organization

from .core import Account


# ─────────────────────────── Tax Lot ─────────────────────────── #


class TaxLot(models.Model):
    """A single identifiable acquisition batch of an investment.

    Required by every disposal that needs cost-basis tracking — listed equities,
    ETFs, funds, bonds, private equity. Without per-lot tagging, FIFO/LIFO/
    specific-ID disposals are not reproducible and realised gain/loss cannot
    be defended at audit.

    Maps tab `17_Tax_Lot_Master` of the wealth-management workbook one-to-one.
    Some FK columns are stored as string codes for now because their master
    tables (Instrument, Portfolio, Custodian) are not yet built. They will be
    promoted to ForeignKey when those models land in this module.
    """

    # Cost basis methods (workbook column `Cost_Basis_Method`).
    COST_BASIS_FIFO = "FIFO"
    COST_BASIS_LIFO = "LIFO"
    COST_BASIS_AVERAGE = "AVERAGE"
    COST_BASIS_SPECIFIC_ID = "SPECIFIC_ID"
    COST_BASIS_HIFO = "HIFO"
    COST_BASIS_CHOICES = [
        (COST_BASIS_FIFO, "FIFO — first in, first out"),
        (COST_BASIS_LIFO, "LIFO — last in, first out"),
        (COST_BASIS_AVERAGE, "Average cost"),
        (COST_BASIS_SPECIFIC_ID, "Specific identification"),
        (COST_BASIS_HIFO, "HIFO — highest in, first out"),
    ]

    # Lifecycle status (workbook column `Lot_Status`).
    STATUS_OPEN = "OPEN"
    STATUS_PARTIAL = "PARTIAL"
    STATUS_CLOSED = "CLOSED"
    STATUS_CHOICES = [
        (STATUS_OPEN, "Open — no disposals yet"),
        (STATUS_PARTIAL, "Partial — some quantity disposed"),
        (STATUS_CLOSED, "Closed — fully disposed"),
    ]

    # ─── identity ───
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_tax_lots"
    )
    tax_lot_id = models.CharField(
        max_length=80,
        help_text="Stable workbook identifier, e.g. TLOT_EQ_0001.",
    )

    # ─── linked masters (codes today, FK once their masters are built) ───
    instrument_code = models.CharField(
        max_length=80, blank=True,
        help_text="Workbook Instrument_ID. FK to Instrument once that master exists.",
    )
    portfolio_code = models.CharField(
        max_length=80, blank=True,
        help_text="Workbook Portfolio_ID. FK to Portfolio once that master exists.",
    )
    custodian_code = models.CharField(
        max_length=80, blank=True,
        help_text="Workbook Custodian_ID. FK to Custodian once that master exists.",
    )

    # ─── linked accounting object (master that already exists) ───
    account = models.ForeignKey(
        Account, on_delete=models.PROTECT, null=True, blank=True,
        related_name="tax_lots",
        help_text="GL account this lot posts against (workbook Account_No).",
    )
    account_no = models.CharField(
        max_length=20, blank=True,
        help_text="Raw workbook Account_No, kept for round-trip safety.",
    )

    # ─── opening details ───
    lot_open_date = models.DateField(null=True, blank=True)
    acquisition_trade_date = models.DateField(null=True, blank=True)
    settlement_date = models.DateField(null=True, blank=True)
    original_quantity = models.DecimalField(
        max_digits=24, decimal_places=8, default=0,
    )
    remaining_quantity = models.DecimalField(
        max_digits=24, decimal_places=8, default=0,
    )
    unit_of_measure = models.CharField(
        max_length=20, blank=True,
        help_text="e.g. SHARES, KG, OZ, UNITS.",
    )
    acquisition_price_per_unit = models.DecimalField(
        max_digits=24, decimal_places=8, null=True, blank=True,
    )
    acquisition_currency = models.CharField(max_length=3, blank=True)
    acquisition_fx_rate_to_reporting = models.DecimalField(
        max_digits=20, decimal_places=10, null=True, blank=True,
        help_text="FX rate at acquisition into the reporting currency.",
    )
    acquisition_cost_transaction_ccy = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
    )
    acquisition_cost_reporting_ccy = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
    )
    cost_basis_method = models.CharField(
        max_length=20, choices=COST_BASIS_CHOICES, default=COST_BASIS_FIFO,
    )

    # ─── lifecycle / disposals ───
    lot_status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_OPEN,
    )
    disposal_date = models.DateField(null=True, blank=True)
    disposed_quantity = models.DecimalField(
        max_digits=24, decimal_places=8, default=0,
    )
    cumulative_disposed_quantity = models.DecimalField(
        max_digits=24, decimal_places=8, default=0,
    )
    remaining_cost_reporting_ccy = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
    )
    realized_gain_loss_reporting_ccy = models.DecimalField(
        max_digits=24, decimal_places=4, default=0,
    )

    # ─── flags ───
    wash_sale_flag = models.BooleanField(default=False)
    corporate_action_adjusted_flag = models.BooleanField(default=False)
    active_flag = models.BooleanField(default=True)

    # ─── source linking ───
    source_transaction_reference = models.CharField(max_length=120, blank=True)
    source_document_reference = models.CharField(
        max_length=120, blank=True,
        help_text="Workbook reference. May later FK to SourceDocument.",
    )

    # ─── notes + workbook round-trip ───
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(
        default=dict, blank=True,
        help_text="Any workbook columns not yet promoted to a dedicated DB field.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_tax_lot"
        unique_together = ("organization", "tax_lot_id")
        ordering = ["tax_lot_id"]
        indexes = [
            models.Index(fields=["organization", "instrument_code"]),
            models.Index(fields=["organization", "portfolio_code"]),
            models.Index(fields=["organization", "custodian_code"]),
            models.Index(fields=["organization", "lot_status"]),
            models.Index(fields=["organization", "account"]),
        ]

    def __str__(self):
        return f"{self.tax_lot_id} · {self.instrument_code or '—'} · {self.lot_status}"
