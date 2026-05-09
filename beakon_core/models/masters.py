"""Governed master tables — Thomas's workbook tabs 07–17.

Each master corresponds to one of the master tabs in the wealth-management CoA
workbook (`2026 04 17-DRAFT-CoA-Wealth management v2.xlsx`). The general rule
Thomas wrote: *"needs a master if the object has contractual terms, lifecycle
state, valuation rules, accrual / amortization logic, disclosure logic,
workflow ownership."*

Build order: **TaxLot** (tab 17), **Loan** (tab 07), Instrument (tab 08),
Portfolio (tab 14), Custodian (tab 13), then Counterparty / RelatedParty /
BankAccount / Property / Policy. Each follows the same shape:

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
    STATUS_PARTIALLY_DISPOSED = "PARTIALLY_DISPOSED"
    STATUS_CLOSED = "CLOSED"
    STATUS_CHOICES = [
        (STATUS_OPEN, "Open — no disposals yet"),
        (STATUS_PARTIALLY_DISPOSED, "Partially disposed — some quantity sold"),
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

    # ─── linked masters (codes for round-trip + FK for referential integrity) ───
    instrument_code = models.CharField(
        max_length=80, blank=True,
        help_text="Workbook Instrument_ID. Mirrored to ``instrument`` FK at import.",
    )
    instrument = models.ForeignKey(
        "Instrument", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="tax_lots",
    )
    portfolio_code = models.CharField(
        max_length=80, blank=True,
        help_text="Workbook Portfolio_ID. Mirrored to ``portfolio`` FK at import.",
    )
    portfolio = models.ForeignKey(
        "Portfolio", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="tax_lots",
    )
    custodian_code = models.CharField(
        max_length=80, blank=True,
        help_text="Workbook Custodian_ID. Mirrored to ``custodian`` FK at import.",
    )
    custodian = models.ForeignKey(
        "Custodian", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="tax_lots",
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
        max_length=24, choices=STATUS_CHOICES, default=STATUS_OPEN,
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


# ─────────────────────────── Loan ─────────────────────────── #


class Loan(models.Model):
    """A governed loan agreement — receivable (asset) or payable (liability).

    Maps tab `07 Loan Master` of the wealth-management workbook one-to-one.
    Drives interest accrual, principal/interest posting, FX remeasurement,
    and impairment for every account that requires LOAN as a dimension
    (e.g. ``120100 Interest receivable``, ``120800 ST Loan Rec``,
    ``140600 Direct private loans``, ``220100 Lombard``,
    ``230100 Mortgage payable``).

    String codes (``borrower_or_lender_code``, ``reporting_portfolio_code``,
    ``collateral_link_id``) will become FKs once their masters land
    (Counterparty / RelatedParty / Portfolio / Property).

    The `default_*_account_code` fields are workbook codes; the engine should
    resolve them to ``Account`` rows at posting time, allowing the workbook to
    declare "if this is a Lombard, expense interest to 520100" without
    hard-coding the rule in Python.
    """

    # ── workbook controlled vocabularies ──
    LOAN_TYPE_LOMBARD = "LOMBARD"
    LOAN_TYPE_MORTGAGE = "MORTGAGE"
    LOAN_TYPE_PRIVATE = "PRIVATE_LOAN"
    LOAN_TYPE_RELATED_PARTY = "RELATED_PARTY_LOAN"
    LOAN_TYPE_CONVERTIBLE = "CONVERTIBLE_LOAN"
    LOAN_TYPE_CREDIT_LINE = "CREDIT_LINE"
    LOAN_TYPE_CHOICES = [
        (LOAN_TYPE_LOMBARD, "Lombard / margin facility"),
        (LOAN_TYPE_MORTGAGE, "Mortgage"),
        (LOAN_TYPE_PRIVATE, "Private loan"),
        (LOAN_TYPE_RELATED_PARTY, "Related-party loan"),
        (LOAN_TYPE_CONVERTIBLE, "Convertible loan / note"),
        (LOAN_TYPE_CREDIT_LINE, "Credit line / revolver"),
    ]

    LOAN_SIDE_ASSET = "ASSET"
    LOAN_SIDE_LIABILITY = "LIABILITY"
    LOAN_SIDE_CHOICES = [
        (LOAN_SIDE_ASSET, "Asset — Beakon entity is the lender"),
        (LOAN_SIDE_LIABILITY, "Liability — Beakon entity is the borrower"),
    ]

    STATUS_ACTIVE = "ACTIVE"
    STATUS_MATURED = "MATURED"
    STATUS_REPAID = "REPAID"
    STATUS_DEFAULTED = "DEFAULTED"
    STATUS_CANCELLED = "CANCELLED"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_MATURED, "Matured"),
        (STATUS_REPAID, "Repaid"),
        (STATUS_DEFAULTED, "Defaulted"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    INTEREST_RATE_FIXED = "FIXED"
    INTEREST_RATE_FLOATING = "FLOATING"
    INTEREST_RATE_CHOICES = [
        (INTEREST_RATE_FIXED, "Fixed rate"),
        (INTEREST_RATE_FLOATING, "Floating rate"),
    ]

    REPAYMENT_AMORTIZING = "AMORTIZING"
    REPAYMENT_BULLET = "BULLET"
    REPAYMENT_REVOLVING = "REVOLVING"
    REPAYMENT_CHOICES = [
        (REPAYMENT_AMORTIZING, "Amortizing"),
        (REPAYMENT_BULLET, "Bullet"),
        (REPAYMENT_REVOLVING, "Revolving"),
    ]

    # ── identity ──
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_loans",
    )
    loan_id = models.CharField(max_length=80, help_text="Stable workbook identifier, e.g. LOAN_LMB_001.")
    loan_name = models.CharField(max_length=255, blank=True)
    loan_type = models.CharField(max_length=24, choices=LOAN_TYPE_CHOICES, blank=True)
    loan_side = models.CharField(max_length=12, choices=LOAN_SIDE_CHOICES, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE)

    # ── parties / refs (codes + polymorphic FK pair) ──
    borrower_or_lender_code = models.CharField(
        max_length=80, blank=True,
        help_text="Counterparty (CP_*) or RelatedParty (RP_*) code. The import "
                  "command sets the matching FK below based on prefix.",
    )
    borrower_or_lender_counterparty = models.ForeignKey(
        "Counterparty", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="loans_as_borrower_or_lender",
    )
    borrower_or_lender_related_party = models.ForeignKey(
        "RelatedParty", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="loans_as_borrower_or_lender",
    )
    related_party_flag = models.BooleanField(default=False)
    facility_reference = models.CharField(max_length=80, blank=True)
    internal_reference = models.CharField(max_length=80, blank=True)

    # ── principal & rate ──
    loan_currency = models.CharField(
        max_length=10, blank=True,
        help_text="Workbook value, e.g. CCY_CHF / CCY_USD. Engine strips the prefix.",
    )
    principal_original = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
    )
    current_principal_outstanding = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
    )
    interest_rate_type = models.CharField(
        max_length=12, choices=INTEREST_RATE_CHOICES, blank=True,
    )
    fixed_rate = models.DecimalField(
        max_digits=10, decimal_places=6, null=True, blank=True,
        help_text="Annual fixed rate, e.g. 1.85 = 1.85%.",
    )
    reference_rate_code = models.CharField(
        max_length=24, blank=True,
        help_text="Floating reference rate, e.g. SARON, SOFR, EURIBOR_3M.",
    )
    spread_bps = models.CharField(
        max_length=40, blank=True,
        help_text="Basis-point spread over the reference rate. Stored as text "
                  "until Thomas fixes the workbook (column was Excel-coerced "
                  "into dates).",
    )

    # ── frequencies & day count ──
    interest_reset_frequency = models.CharField(max_length=20, blank=True)
    interest_payment_frequency = models.CharField(max_length=20, blank=True)
    day_count_convention = models.CharField(
        max_length=16, blank=True,
        help_text="Workbook codes: 30_360 / ACT_360 / ACT_365 / ACT_ACT.",
    )

    # ── lifecycle dates ──
    start_date = models.DateField(null=True, blank=True)
    first_accrual_date = models.DateField(null=True, blank=True)
    maturity_date = models.DateField(null=True, blank=True)
    next_reset_date = models.DateField(null=True, blank=True)
    next_interest_payment_date = models.DateField(null=True, blank=True)
    next_principal_payment_date = models.DateField(null=True, blank=True)
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)

    # ── repayment & amortization ──
    repayment_type = models.CharField(max_length=16, choices=REPAYMENT_CHOICES, blank=True)
    amortization_method = models.CharField(
        max_length=24, blank=True,
        help_text="EFFECTIVE_INTEREST / LEVEL_PAYMENT / STRAIGHT_LINE / NA.",
    )
    bullet_flag = models.BooleanField(default=False)
    scheduled_principal_amount = models.CharField(
        max_length=40, blank=True,
        help_text="Stored as text until workbook column is cleaned (Excel "
                  "coerced numeric values to dates).",
    )
    prepayment_allowed_flag = models.BooleanField(default=False)
    capitalized_interest_flag = models.BooleanField(default=False)

    # ── linkage ──
    reporting_portfolio_code = models.CharField(
        max_length=80, blank=True,
        help_text="Workbook Portfolio code. Mirrored to ``reporting_portfolio`` FK.",
    )
    reporting_portfolio = models.ForeignKey(
        "Portfolio", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="loans_reporting",
    )
    collateral_link_type = models.CharField(
        max_length=24, blank=True,
        help_text="BANK / CUSTODY_POOL / PROPERTY / RELATED_PARTY / NONE.",
    )
    collateral_link_id = models.CharField(
        max_length=80, blank=True,
        help_text="Polymorphic ref into the master named by collateral_link_type.",
    )

    # ── valuation & accounting policy ──
    current_noncurrent_split_method = models.CharField(max_length=32, blank=True)
    valuation_basis = models.CharField(
        max_length=24, blank=True,
        help_text="AMORTIZED_COST / FAIR_VALUE.",
    )
    impairment_method = models.CharField(max_length=32, blank=True)
    accrual_required_flag = models.BooleanField(default=False)
    fx_remeasure_flag = models.BooleanField(default=False)

    # ── default GL accounts (codes, resolved by engine) ──
    default_principal_account_code = models.CharField(max_length=20, blank=True)
    default_principal_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="loans_default_principal",
    )
    default_interest_income_account_code = models.CharField(max_length=20, blank=True)
    default_interest_income_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="loans_default_interest_income",
    )
    default_interest_expense_account_code = models.CharField(max_length=20, blank=True)
    default_interest_expense_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="loans_default_interest_expense",
    )
    default_fx_gain_loss_account_code = models.CharField(
        max_length=40, blank=True,
        help_text="Workbook code, may need cleanup (column was Excel-coerced).",
    )
    default_fx_gain_loss_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="loans_default_fx_gain_loss",
    )

    # ── workflow flags ──
    approval_required_flag = models.BooleanField(default=True)
    manual_override_allowed_flag = models.BooleanField(default=False)
    source_document_required_flag = models.BooleanField(default=True)

    # ── round-trip & metadata ──
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_loan"
        unique_together = ("organization", "loan_id")
        ordering = ["loan_id"]
        indexes = [
            models.Index(fields=["organization", "loan_type"]),
            models.Index(fields=["organization", "loan_side"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "borrower_or_lender_code"]),
            models.Index(fields=["organization", "maturity_date"]),
        ]

    def __str__(self):
        return f"{self.loan_id} · {self.loan_type or '—'} · {self.loan_side or '—'}"


# ─────────────────────────── Instrument ─────────────────────────── #


class Instrument(models.Model):
    """A governed investment instrument — equity, fund, bond, derivative,
    digital asset, real-asset wrapper, etc.

    Maps tab `08 Instrument Master` of the wealth-management workbook one-to-
    one. Drives valuation method, income type, default GL routing, and the
    INST dimension on every investment posting (130100 Listed equities,
    130400 Government bonds, 140200 PE Funds, 150600 Crypto, …).

    String codes (``portfolio_default``, ``custodian_default``,
    ``issuer_or_counterparty_code``, etc.) become FKs once their masters land.
    ``loan_id`` resolves to the ``Loan`` master immediately because Loan
    already exists in this module.
    """

    # ── workbook controlled vocabularies ──
    QUOTED = "QUOTED"
    UNQUOTED = "UNQUOTED"
    QUOTED_CHOICES = [
        (QUOTED, "Quoted / listed"),
        (UNQUOTED, "Unquoted / private"),
    ]

    INCOME_TYPE_CHOICES = [
        ("DIVIDEND", "Dividend"),
        ("COUPON", "Coupon"),
        ("DISTRIBUTION", "Distribution"),
        ("RENTAL", "Rental"),
        ("OTHER", "Other"),
        ("NONE", "None"),
    ]

    INCOME_FREQUENCY_CHOICES = [
        ("MONTHLY", "Monthly"),
        ("QUARTERLY", "Quarterly"),
        ("SEMI_ANNUAL", "Semi-annual"),
        ("ANNUAL", "Annual"),
        ("AD_HOC", "Ad hoc"),
        ("NONE", "None"),
    ]

    VALUATION_METHOD_CHOICES = [
        ("FVPL", "Fair value through P&L"),
        ("FAIR_VALUE", "Fair value (other)"),
        ("AMORTIZED_COST", "Amortized cost"),
        ("HISTORICAL", "Historical cost"),
    ]

    PRICE_SOURCE_CHOICES = [
        ("MARKET_PRICE", "Market price"),
        ("EXCHANGE_PRICE", "Exchange price"),
        ("MANAGER_STATEMENT", "Manager statement"),
        ("APPRAISAL", "Appraisal"),
    ]

    IMPAIRMENT_CHOICES = [
        ("NA", "Not applicable"),
        ("SIMPLE_IMPAIRMENT", "Simple impairment"),
        ("ECL_SIMPLE", "ECL — simple model"),
        ("ECL_NONE", "ECL — none"),
        ("IMPAIRMENT_ONLY", "Impairment only"),
        ("FAIR_VALUE_REVIEW", "Fair-value review"),
        ("CASE_BY_CASE", "Case-by-case"),
    ]

    SETTLEMENT_CHOICES = [
        ("T_PLUS_0", "T+0 / same day"),
        ("T_PLUS_1", "T+1"),
        ("T_PLUS_2", "T+2"),
        ("MONTHLY", "Monthly"),
        ("NA", "Not applicable"),
    ]

    STATUS_ACTIVE = "ACTIVE"
    STATUS_MATURED = "MATURED"
    STATUS_REDEEMED = "REDEEMED"
    STATUS_DELISTED = "DELISTED"
    STATUS_CLOSED = "CLOSED"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_MATURED, "Matured"),
        (STATUS_REDEEMED, "Redeemed"),
        (STATUS_DELISTED, "Delisted"),
        (STATUS_CLOSED, "Closed"),
    ]

    # ── identity ──
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_instruments",
    )
    instrument_id = models.CharField(max_length=80, help_text="Stable workbook identifier, e.g. INS_LISTED_EQ_001.")
    instrument_name = models.CharField(max_length=255, blank=True)
    instrument_type = models.CharField(
        max_length=40, blank=True,
        help_text="Workbook code, e.g. LISTED_EQUITY, GOV_BOND, ETF, PE_FUND, CRYPTO.",
    )
    quoted_unquoted_flag = models.CharField(
        max_length=10, choices=QUOTED_CHOICES, blank=True,
    )

    # ── classification (codes; FKs once masters exist) ──
    asset_class_code = models.CharField(max_length=40, blank=True, help_text="ACL_* code from dimension values.")
    strategy_code = models.CharField(max_length=40, blank=True, help_text="STR_* code from dimension values.")
    portfolio_default = models.CharField(
        max_length=40, blank=True,
        help_text="PORT_* code. Mirrored to ``portfolio_default_obj`` FK at import.",
    )
    portfolio_default_obj = models.ForeignKey(
        "Portfolio", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="instruments_default_to",
    )
    custodian_default = models.CharField(
        max_length=40, blank=True,
        help_text="CUST_* code. Mirrored to ``custodian_default_obj`` FK at import.",
    )
    custodian_default_obj = models.ForeignKey(
        "Custodian", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="instruments_default_to",
    )
    issuer_or_counterparty_code = models.CharField(
        max_length=80, blank=True,
        help_text="Issuer code (CP_*) or related-party (RP_*). The import "
                  "command sets the matching FK below based on prefix.",
    )
    issuer_counterparty = models.ForeignKey(
        "Counterparty", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="instruments_issued",
    )
    issuer_related_party = models.ForeignKey(
        "RelatedParty", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="instruments_issued",
    )
    related_party_flag = models.BooleanField(default=False)
    isin_or_ticker = models.CharField(max_length=64, blank=True)
    internal_reference = models.CharField(max_length=80, blank=True)

    # ── currency / jurisdiction ──
    currency = models.CharField(max_length=10, blank=True, help_text="Workbook code, e.g. CCY_CHF / CCY_USD.")
    jurisdiction_code = models.CharField(max_length=20, blank=True)
    domicile_code = models.CharField(max_length=20, blank=True)

    # ── commitment / loan linkage ──
    commitment_flag = models.BooleanField(default=False)
    commitment_code = models.CharField(max_length=40, blank=True, help_text="COM_* code; FK to Commitment master later.")
    loan_linked_flag = models.BooleanField(default=False)
    loan_workbook_id = models.CharField(
        max_length=80, blank=True,
        help_text="Workbook Loan_ID. Resolved to the loan FK at import time.",
    )
    loan = models.ForeignKey(
        "Loan", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="instruments",
    )
    tax_lot_required = models.BooleanField(default=False)

    # ── income / valuation ──
    income_type = models.CharField(max_length=20, choices=INCOME_TYPE_CHOICES, blank=True)
    income_frequency = models.CharField(max_length=20, choices=INCOME_FREQUENCY_CHOICES, blank=True)
    valuation_method = models.CharField(max_length=20, choices=VALUATION_METHOD_CHOICES, blank=True)
    price_source = models.CharField(max_length=24, choices=PRICE_SOURCE_CHOICES, blank=True)
    fx_exposure_flag = models.BooleanField(default=False)
    impairment_method = models.CharField(max_length=24, choices=IMPAIRMENT_CHOICES, blank=True)
    esg_or_restriction_flag = models.BooleanField(default=False)
    restriction_type_code = models.CharField(max_length=40, blank=True)

    # ── lifecycle ──
    inception_date = models.DateField(null=True, blank=True)
    maturity_date = models.DateField(null=True, blank=True)
    settlement_cycle = models.CharField(max_length=12, choices=SETTLEMENT_CHOICES, blank=True)
    day_count_convention = models.CharField(max_length=16, blank=True)

    # ── reporting ──
    performance_group = models.CharField(max_length=40, blank=True)
    report_category_code = models.CharField(max_length=40, blank=True)

    # ── default GL accounts (codes + FK once resolved) ──
    default_principal_account_code = models.CharField(max_length=20, blank=True)
    default_principal_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="instruments_default_principal",
    )
    default_income_account_code = models.CharField(max_length=20, blank=True)
    default_income_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="instruments_default_income",
    )
    default_expense_account_code = models.CharField(max_length=20, blank=True)
    default_expense_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="instruments_default_expense",
    )
    default_realized_gl_account_code = models.CharField(max_length=20, blank=True)
    default_realized_gl_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="instruments_default_realized_gl",
    )
    default_unrealized_gl_account_code = models.CharField(max_length=20, blank=True)
    default_unrealized_gl_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="instruments_default_unrealized_gl",
    )
    default_fx_gl_account_code = models.CharField(max_length=20, blank=True)
    default_fx_gl_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="instruments_default_fx_gl",
    )

    # ── status / round-trip ──
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_instrument"
        unique_together = ("organization", "instrument_id")
        ordering = ["instrument_id"]
        indexes = [
            models.Index(fields=["organization", "instrument_type"]),
            models.Index(fields=["organization", "quoted_unquoted_flag"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "portfolio_default"]),
            models.Index(fields=["organization", "custodian_default"]),
            models.Index(fields=["organization", "asset_class_code"]),
            models.Index(fields=["organization", "loan"]),
        ]

    def __str__(self):
        return f"{self.instrument_id} · {self.instrument_type or '—'}"


# ─────────────────────────── Portfolio ─────────────────────────── #


class Portfolio(models.Model):
    """A reporting / strategy bucket — main portfolio, family portfolio,
    trust portfolio, alternatives, etc.

    Maps tab `14_Portfolio_Master` of the wealth-management workbook
    one-to-one. Drives the PORT dimension on every investment posting and
    the cross-entity / cross-custodian rollup at reporting time. Self-
    references for parent-child hierarchies (e.g. PORT_FAMILY → PORT_MAIN).

    String codes (``owner_id``, ``primary_related_party_id``,
    ``linked_custodian_id``) become FKs once their masters land
    (RelatedParty / Custodian).
    """

    PORTFOLIO_TYPE_CHOICES = [
        ("PERSONAL", "Personal"),
        ("COMPANY", "Company"),
        ("FAMILY", "Family"),
        ("FOUNDATION", "Foundation"),
        ("INVESTMENT", "Investment"),
        ("PARTNERSHIP", "Partnership"),
        ("TRUST", "Trust"),
    ]

    OWNER_TYPE_CHOICES = [
        ("INDIVIDUAL", "Individual"),
        ("COMPANY", "Company"),
        ("FOUNDATION", "Foundation"),
        ("PARTNERSHIP", "Partnership"),
        ("TRUST", "Trust"),
    ]

    STATUS_ACTIVE = "ACTIVE"
    STATUS_INACTIVE = "INACTIVE"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    # ── identity ──
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_portfolios",
    )
    portfolio_id = models.CharField(max_length=80, help_text="Stable workbook identifier, e.g. PORT_MAIN.")
    portfolio_name = models.CharField(max_length=255, blank=True)
    short_name = models.CharField(max_length=80, blank=True)
    portfolio_type = models.CharField(max_length=20, choices=PORTFOLIO_TYPE_CHOICES, blank=True)
    portfolio_subtype = models.CharField(max_length=40, blank=True)

    # ── ownership / parties (codes + FKs where masters exist) ──
    owner_type = models.CharField(max_length=20, choices=OWNER_TYPE_CHOICES, blank=True)
    owner_id = models.CharField(
        max_length=80, blank=True,
        help_text="Owner code (RP_* primarily). Mirrored to ``owner_related_party`` FK at import.",
    )
    owner_related_party = models.ForeignKey(
        "RelatedParty", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="portfolios_owned_as_owner",
    )
    primary_related_party_id = models.CharField(
        max_length=80, blank=True,
        help_text="RP_* code. Mirrored to ``primary_related_party_obj`` FK at import.",
    )
    primary_related_party_obj = models.ForeignKey(
        "RelatedParty", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="portfolios_primary",
    )
    linked_custodian_id = models.CharField(
        max_length=80, blank=True,
        help_text="CUST_* code. Mirrored to ``linked_custodian_obj`` FK at import.",
    )
    linked_custodian_obj = models.ForeignKey(
        "Custodian", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="portfolios_linked",
    )

    # ── currency / jurisdiction ──
    base_currency = models.CharField(max_length=3, blank=True)
    reporting_currency = models.CharField(max_length=3, blank=True)
    country_code = models.CharField(max_length=4, blank=True)
    jurisdiction_code = models.CharField(max_length=20, blank=True)

    # ── strategy / allocation ──
    strategy_code = models.CharField(max_length=40, blank=True)
    asset_allocation_profile = models.CharField(max_length=40, blank=True)

    # ── flags ──
    discretionary_flag = models.BooleanField(default=False)
    consolidation_flag = models.BooleanField(default=True)
    net_worth_inclusion_flag = models.BooleanField(default=True)
    performance_report_flag = models.BooleanField(default=True)
    posting_allowed_flag = models.BooleanField(default=True)

    # ── lifecycle ──
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    active_flag = models.BooleanField(default=True)
    open_date = models.DateField(null=True, blank=True)
    close_date = models.DateField(null=True, blank=True)

    # ── hierarchy (self-reference) ──
    parent_portfolio_workbook_id = models.CharField(
        max_length=80, blank=True,
        help_text="Workbook Parent_Portfolio_ID. Resolved to the parent FK at import time.",
    )
    parent = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="children",
    )

    # ── reporting ──
    reporting_group = models.CharField(max_length=40, blank=True)

    # ── workflow flags ──
    approval_required_flag = models.BooleanField(default=True)
    source_document_required_flag = models.BooleanField(default=True)

    # ── round-trip ──
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_portfolio"
        unique_together = ("organization", "portfolio_id")
        ordering = ["portfolio_id"]
        indexes = [
            models.Index(fields=["organization", "portfolio_type"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "linked_custodian_id"]),
            models.Index(fields=["organization", "owner_id"]),
            models.Index(fields=["organization", "parent"]),
        ]

    def __str__(self):
        return f"{self.portfolio_id} · {self.portfolio_type or '—'}"


# ─────────────────────────── Custodian ─────────────────────────── #


class Custodian(models.Model):
    """A custodian / booking center holding investments — bank, broker,
    transfer agent, digital-asset custodian, etc.

    Maps tab `13_Custodian_Master` of the wealth-management workbook one-
    to-one. Drives the CUST dimension on every investment/cash posting and
    the per-custodian capability checks (e.g. derivatives only post against
    custodians with ``supports_derivatives_flag = True``).

    Resolves ``default_portfolio_code`` to a real ``Portfolio`` FK because
    that master now exists. ``linked_counterparty_id`` stays a string code
    until the Counterparty master lands.
    """

    CUSTODIAN_TYPE_CHOICES = [
        ("PRIVATE_BANK", "Private bank"),
        ("GLOBAL_CUSTODIAN", "Global custodian"),
        ("BROKER_CUSTODIAN", "Broker custodian"),
        ("CUSTODY_AGENT", "Custody agent"),
        ("NOMINEE_PLATFORM", "Nominee platform"),
        ("DIGITAL_CUSTODIAN", "Digital-asset custodian"),
        ("TRANSFER_AGENT", "Transfer agent"),
        ("CUSTODIAN", "Custodian (generic)"),
    ]

    STATUS_ACTIVE = "ACTIVE"
    STATUS_INACTIVE = "INACTIVE"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    # ── identity ──
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_custodians",
    )
    custodian_id = models.CharField(max_length=80, help_text="Stable workbook identifier, e.g. CUST_UBS_ZRH.")
    custodian_name = models.CharField(max_length=255, blank=True)
    short_name = models.CharField(max_length=80, blank=True)
    custodian_type = models.CharField(max_length=24, choices=CUSTODIAN_TYPE_CHOICES, blank=True)
    custodian_subtype = models.CharField(max_length=120, blank=True)

    # ── linkage ──
    linked_counterparty_id = models.CharField(
        max_length=80, blank=True,
        help_text="CP_* code. Mirrored to ``linked_counterparty_obj`` FK at import.",
    )
    linked_counterparty_obj = models.ForeignKey(
        "Counterparty", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="custodians_linked",
    )

    # ── legal / location ──
    legal_entity_name = models.CharField(max_length=255, blank=True)
    booking_center = models.CharField(max_length=80, blank=True)
    country_code = models.CharField(max_length=4, blank=True)
    jurisdiction_code = models.CharField(max_length=20, blank=True)

    # ── currency ──
    base_currency = models.CharField(max_length=3, blank=True)
    reporting_currency = models.CharField(max_length=3, blank=True)

    # ── relationship lifecycle ──
    relationship_start_date = models.DateField(null=True, blank=True)
    relationship_end_date = models.DateField(null=True, blank=True)

    # ── capability flags ──
    supports_listed_securities_flag = models.BooleanField(default=False)
    supports_private_assets_flag = models.BooleanField(default=False)
    supports_funds_flag = models.BooleanField(default=False)
    supports_derivatives_flag = models.BooleanField(default=False)
    supports_digital_assets_flag = models.BooleanField(default=False)
    supports_cash_sweep_flag = models.BooleanField(default=False)
    nominee_holding_flag = models.BooleanField(default=False)
    segregated_account_flag = models.BooleanField(default=False)

    # ── default linkage (resolved to FK) ──
    default_portfolio_code = models.CharField(
        max_length=80, blank=True,
        help_text="PORT_* code from workbook. Resolved to default_portfolio at import.",
    )
    default_portfolio = models.ForeignKey(
        Portfolio, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="custodians_defaulting_to",
    )

    # ── status / workflow ──
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    active_flag = models.BooleanField(default=True)
    posting_allowed_flag = models.BooleanField(default=True)
    approval_required_flag = models.BooleanField(default=True)
    source_document_required_flag = models.BooleanField(default=True)

    # ── round-trip ──
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_custodian"
        unique_together = ("organization", "custodian_id")
        ordering = ["custodian_id"]
        indexes = [
            models.Index(fields=["organization", "custodian_type"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "country_code"]),
            models.Index(fields=["organization", "linked_counterparty_id"]),
            models.Index(fields=["organization", "default_portfolio"]),
        ]

    def __str__(self):
        return f"{self.custodian_id} · {self.custodian_type or '—'}"


# ─────────────────────────── RelatedParty ─────────────────────────── #


class RelatedParty(models.Model):
    """A person or entity connected to the client — family member, holdco,
    trust, foundation, partnership, beneficiary, settlor, protector, etc.

    Maps tab `11_Related_Party_Master` of the wealth-management workbook
    one-to-one. Drives the RP / FAM dimensions on every related-party,
    family-expense, beneficiary, and ownership posting (160000-series
    accounts plus all FAM-tagged personal expenses).

    Resolves ``default_portfolio_code`` to a real ``Portfolio`` FK.
    ``default_property_code`` and ``default_bank_reference`` stay string codes
    until Property and BankAccount masters are built.
    """

    PARTY_TYPE_CHOICES = [
        ("INDIVIDUAL", "Individual"),
        ("COMPANY", "Company"),
        ("TRUST", "Trust"),
        ("FOUNDATION", "Foundation"),
        ("PARTNERSHIP", "Partnership"),
    ]

    PARTY_FORM_CHOICES = [
        ("PERSON", "Person"),
        ("ENTITY", "Entity"),
    ]

    STATUS_ACTIVE = "ACTIVE"
    STATUS_INACTIVE = "INACTIVE"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    # ── identity ──
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_related_parties",
    )
    related_party_id = models.CharField(
        max_length=80,
        help_text="Stable workbook identifier, e.g. RP_CLIENT_001 / RP_HOLDCO_001 / FAM_CHILD1.",
    )
    related_party_name = models.CharField(max_length=255, blank=True)
    short_name = models.CharField(max_length=80, blank=True)
    related_party_type = models.CharField(max_length=20, choices=PARTY_TYPE_CHOICES, blank=True)
    related_party_subtype = models.CharField(max_length=120, blank=True)
    party_form = models.CharField(max_length=10, choices=PARTY_FORM_CHOICES, blank=True)
    relationship_to_client = models.CharField(max_length=40, blank=True)

    # ── ownership / control ──
    ownership_percent = models.DecimalField(
        max_digits=8, decimal_places=4, null=True, blank=True,
        help_text="Percent ownership of/by this party (0–100).",
    )

    # ── role flags ──
    control_flag = models.BooleanField(default=False)
    beneficiary_flag = models.BooleanField(default=False)
    settlor_flag = models.BooleanField(default=False)
    protector_flag = models.BooleanField(default=False)
    director_flag = models.BooleanField(default=False)
    signer_flag = models.BooleanField(default=False)

    # ── status ──
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    active_flag = models.BooleanField(default=True)

    # ── jurisdiction / currency ──
    country_code = models.CharField(max_length=4, blank=True)
    jurisdiction_code = models.CharField(max_length=20, blank=True)
    base_currency = models.CharField(max_length=3, blank=True)
    reporting_currency = models.CharField(max_length=3, blank=True)
    tax_residence_country = models.CharField(max_length=4, blank=True)

    # ── relationship lifecycle ──
    related_party_since = models.DateField(null=True, blank=True)
    related_party_until = models.DateField(null=True, blank=True)

    # ── eligibility flags ──
    loan_eligible_flag = models.BooleanField(default=False)
    distribution_eligible_flag = models.BooleanField(default=False)
    capital_contribution_eligible_flag = models.BooleanField(default=False)
    expense_allocation_eligible_flag = models.BooleanField(default=False)
    family_expense_eligible_flag = models.BooleanField(default=False)
    net_worth_inclusion_flag = models.BooleanField(default=False)

    # ── default linkage ──
    default_portfolio_code = models.CharField(
        max_length=80, blank=True,
        help_text="PORT_* code from workbook. Resolved to default_portfolio at import.",
    )
    default_portfolio = models.ForeignKey(
        Portfolio, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="related_parties_defaulting_to",
    )
    default_property_code = models.CharField(
        max_length=80, blank=True,
        help_text="PROP_* code. Mirrored to ``default_property`` FK at import.",
    )
    default_property = models.ForeignKey(
        "Property", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="related_parties_defaulting_to",
    )
    default_bank_reference = models.CharField(
        max_length=80, blank=True,
        help_text="BANKREF_* / BA_* code. Mirrored to ``default_bank_account`` FK at import.",
    )
    default_bank_account = models.ForeignKey(
        "BankAccount", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="related_parties_defaulting_to",
    )

    # ── workflow ──
    source_document_required_flag = models.BooleanField(default=True)
    approval_required_flag = models.BooleanField(default=True)

    # ── round-trip ──
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_related_party"
        unique_together = ("organization", "related_party_id")
        ordering = ["related_party_id"]
        indexes = [
            models.Index(fields=["organization", "related_party_type"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "country_code"]),
            models.Index(fields=["organization", "default_portfolio"]),
            models.Index(fields=["organization", "control_flag"]),
            models.Index(fields=["organization", "beneficiary_flag"]),
        ]

    def __str__(self):
        return f"{self.related_party_id} · {self.related_party_type or '—'}"


# ─────────────────────────── Counterparty ─────────────────────────── #


class Counterparty(models.Model):
    """An external party — vendor, school, law firm, insurer, tax authority,
    bank-as-service-provider, etc.

    Maps tab `10_Counterparty_Master` of the wealth-management workbook one-
    to-one. Drives the CP dimension on every AP/AR posting plus eligibility
    flags that gate which expense or income categories the counterparty is
    valid for.
    """

    STATUS_ACTIVE = "ACTIVE"
    STATUS_INACTIVE = "INACTIVE"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    # ── identity ──
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_counterparties",
    )
    counterparty_id = models.CharField(max_length=80, help_text="Stable workbook identifier, e.g. CP_BANK_001.")
    counterparty_name = models.CharField(max_length=255, blank=True)
    short_name = models.CharField(max_length=80, blank=True)
    counterparty_type = models.CharField(max_length=40, blank=True)
    counterparty_subtype = models.CharField(max_length=80, blank=True)

    # ── status ──
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    active_flag = models.BooleanField(default=True)

    # ── external refs ──
    external_reference = models.CharField(max_length=80, blank=True)
    tax_id = models.CharField(max_length=80, blank=True)
    registration_no = models.CharField(max_length=80, blank=True)

    # ── jurisdiction / currency ──
    country_code = models.CharField(max_length=4, blank=True)
    jurisdiction_code = models.CharField(max_length=20, blank=True)
    base_currency = models.CharField(max_length=3, blank=True)
    default_payment_currency = models.CharField(max_length=3, blank=True)
    language_code = models.CharField(max_length=8, blank=True)

    # ── payment / settlement ──
    payment_terms = models.CharField(max_length=24, blank=True)
    settlement_method = models.CharField(max_length=24, blank=True)
    default_bank_reference = models.CharField(
        max_length=80, blank=True,
        help_text="BANKREF_* / BA_* code. Mirrored to ``default_bank_account`` FK at import.",
    )
    default_bank_account = models.ForeignKey(
        "BankAccount", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="counterparties_defaulting_to",
    )

    # ── risk / compliance ──
    risk_rating = models.CharField(max_length=16, blank=True)
    kyc_status = models.CharField(max_length=24, blank=True)
    aml_risk_level = models.CharField(max_length=16, blank=True)
    sanctions_check_flag = models.BooleanField(default=False)

    # ── relationship type flags ──
    related_party_flag = models.BooleanField(default=False)
    intercompany_flag = models.BooleanField(default=False)

    # ── eligibility flags ──
    loan_eligible_flag = models.BooleanField(default=False)
    ap_eligible_flag = models.BooleanField(default=False)
    ar_eligible_flag = models.BooleanField(default=False)
    tax_eligible_flag = models.BooleanField(default=False)
    insurance_eligible_flag = models.BooleanField(default=False)
    education_eligible_flag = models.BooleanField(default=False)
    professional_fees_eligible_flag = models.BooleanField(default=False)

    # ── round-trip ──
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_counterparty"
        unique_together = ("organization", "counterparty_id")
        ordering = ["counterparty_id"]
        indexes = [
            models.Index(fields=["organization", "counterparty_type"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "country_code"]),
            models.Index(fields=["organization", "related_party_flag"]),
            models.Index(fields=["organization", "intercompany_flag"]),
        ]

    def __str__(self):
        return f"{self.counterparty_id} · {self.counterparty_type or '—'}"


# ─────────────────────────── BankAccount (governed) ─────────────────────────── #


class BankAccount(models.Model):
    """A governed bank account — the workbook's full-shape `12_Bank_Account_
    Master` (33 cols). Distinct from `beakon_banking.BankAccount` which is a
    feed-import-oriented model. This master defines posting rules, holder,
    purpose, restrictions, and links into the rest of the master graph.

    Maps tab `12_Bank_Account_Master` one-to-one. Resolves ``account_holder_id``
    and ``default_related_party_id`` to ``RelatedParty``, ``bank_counterparty_id``
    and ``default_counterparty_id`` to ``Counterparty``, ``credit_line_linked_loan_id``
    to ``Loan``, and ``default_portfolio_code`` to ``Portfolio``.
    """

    STATUS_ACTIVE = "ACTIVE"
    STATUS_INACTIVE = "INACTIVE"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    # ── identity ──
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_bank_accounts_master",
    )
    bank_account_id = models.CharField(max_length=80, help_text="Stable workbook identifier, e.g. BANK_CH_MAIN_001.")
    bank_account_name = models.CharField(max_length=255, blank=True)
    short_name = models.CharField(max_length=80, blank=True)

    # ── holder ──
    account_holder_type = models.CharField(max_length=24, blank=True)
    account_holder_id_code = models.CharField(
        max_length=80, blank=True,
        help_text="RP_* / CO_* code; resolved to account_holder_related_party at import.",
    )
    account_holder_related_party = models.ForeignKey(
        RelatedParty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bank_accounts_held",
    )

    # ── bank ──
    bank_counterparty_id_code = models.CharField(
        max_length=80, blank=True,
        help_text="CP_* code for the bank itself; resolved at import.",
    )
    bank_counterparty = models.ForeignKey(
        Counterparty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bank_accounts",
    )
    bank_name = models.CharField(max_length=255, blank=True)
    booking_center = models.CharField(max_length=80, blank=True)
    iban_or_account_no_masked = models.CharField(max_length=64, blank=True)
    swift_bic = models.CharField(max_length=24, blank=True)

    # ── currency / location ──
    account_currency = models.CharField(max_length=3, blank=True)
    reporting_currency = models.CharField(max_length=3, blank=True)
    country_code = models.CharField(max_length=4, blank=True)
    jurisdiction_code = models.CharField(max_length=20, blank=True)

    # ── account profile ──
    account_type = models.CharField(max_length=24, blank=True)
    account_subtype = models.CharField(max_length=40, blank=True)
    account_purpose = models.CharField(max_length=40, blank=True)

    # ── status / flags ──
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    active_flag = models.BooleanField(default=True)
    posting_allowed_flag = models.BooleanField(default=True)
    restricted_flag = models.BooleanField(default=False)
    interest_bearing_flag = models.BooleanField(default=False)
    overdraft_allowed_flag = models.BooleanField(default=False)

    # ── credit line linkage ──
    credit_line_linked_loan_id_code = models.CharField(
        max_length=80, blank=True,
        help_text="LOAN_* code; resolved to credit_line_linked_loan at import.",
    )
    credit_line_linked_loan = models.ForeignKey(
        Loan, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bank_accounts_linked",
    )

    # ── default linkage ──
    default_portfolio_code = models.CharField(max_length=80, blank=True)
    default_portfolio = models.ForeignKey(
        Portfolio, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bank_accounts_defaulting_to",
    )
    default_related_party_id_code = models.CharField(max_length=80, blank=True)
    default_related_party = models.ForeignKey(
        RelatedParty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bank_accounts_defaulting_to",
    )
    default_counterparty_id_code = models.CharField(max_length=80, blank=True)
    default_counterparty = models.ForeignKey(
        Counterparty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bank_accounts_defaulting_to",
    )

    # ── lifecycle ──
    opening_date = models.DateField(null=True, blank=True)
    closing_date = models.DateField(null=True, blank=True)

    # ── compliance / workflow ──
    kyc_status = models.CharField(max_length=24, blank=True)
    approval_required_flag = models.BooleanField(default=True)
    source_document_required_flag = models.BooleanField(default=True)

    # ── round-trip ──
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_bank_account_master"
        unique_together = ("organization", "bank_account_id")
        ordering = ["bank_account_id"]
        indexes = [
            models.Index(fields=["organization", "account_type"]),
            models.Index(fields=["organization", "account_purpose"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "country_code"]),
            models.Index(fields=["organization", "account_holder_related_party"]),
            models.Index(fields=["organization", "bank_counterparty"]),
        ]

    def __str__(self):
        return f"{self.bank_account_id} · {self.account_currency or '—'}"


# ─────────────────────────── Property ─────────────────────────── #


class Property(models.Model):
    """A real asset — primary residence, rental, SPV building, etc.

    Maps tab `15_Property_Master` of the wealth-management workbook one-to-
    one. Drives the PROP dimension on personal-asset, property-expense, and
    mortgage-collateral postings. Resolves ``owner_id`` and
    ``primary_related_party_id`` to ``RelatedParty``, ``linked_portfolio_id``
    to ``Portfolio``, and ``linked_loan_id`` to ``Loan``.
    """

    STATUS_ACTIVE = "ACTIVE"
    STATUS_INACTIVE = "INACTIVE"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    # ── identity ──
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_properties",
    )
    property_id = models.CharField(max_length=80, help_text="Stable workbook identifier, e.g. PROP_RES_001.")
    property_name = models.CharField(max_length=255, blank=True)
    short_name = models.CharField(max_length=80, blank=True)
    property_type = models.CharField(max_length=40, blank=True)
    property_subtype = models.CharField(max_length=40, blank=True)
    usage_type = models.CharField(max_length=40, blank=True)
    ownership_type = models.CharField(max_length=24, blank=True)

    # ── owner / related party ──
    owner_type = models.CharField(max_length=20, blank=True)
    owner_id_code = models.CharField(
        max_length=80, blank=True,
        help_text="Workbook Owner_ID. Resolved to owner_related_party at import.",
    )
    owner_related_party = models.ForeignKey(
        RelatedParty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="properties_owned",
    )
    primary_related_party_id_code = models.CharField(max_length=80, blank=True)
    primary_related_party = models.ForeignKey(
        RelatedParty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="properties_primary",
    )

    # ── linkage ──
    linked_portfolio_id_code = models.CharField(max_length=80, blank=True)
    linked_portfolio = models.ForeignKey(
        Portfolio, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="properties",
    )
    linked_spv_id = models.CharField(max_length=80, blank=True, help_text="SPV / holdco code.")

    # ── address ──
    address_line_1 = models.CharField(max_length=255, blank=True)
    address_line_2 = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=80, blank=True)
    region = models.CharField(max_length=40, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)
    country_code = models.CharField(max_length=4, blank=True)
    jurisdiction_code = models.CharField(max_length=20, blank=True)

    # ── currency ──
    property_currency = models.CharField(max_length=3, blank=True)
    reporting_currency = models.CharField(max_length=3, blank=True)

    # ── lifecycle / valuation ──
    acquisition_date = models.DateField(null=True, blank=True)
    disposal_date = models.DateField(null=True, blank=True)
    acquisition_cost = models.DecimalField(max_digits=24, decimal_places=4, null=True, blank=True)
    current_carrying_value = models.DecimalField(max_digits=24, decimal_places=4, null=True, blank=True)
    valuation_method = models.CharField(max_length=24, blank=True)
    valuation_date = models.DateField(null=True, blank=True)

    # ── mortgage / loan linkage ──
    mortgage_linked_flag = models.BooleanField(default=False)
    linked_loan_id_code = models.CharField(max_length=80, blank=True)
    linked_loan = models.ForeignKey(
        Loan, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="properties_collateral",
    )

    # ── usage / inclusion ──
    rental_income_flag = models.BooleanField(default=False)
    personal_use_flag = models.BooleanField(default=False)
    expense_allocation_allowed_flag = models.BooleanField(default=False)
    net_worth_inclusion_flag = models.BooleanField(default=False)

    # ── status / workflow ──
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    active_flag = models.BooleanField(default=True)
    posting_allowed_flag = models.BooleanField(default=True)
    approval_required_flag = models.BooleanField(default=True)
    source_document_required_flag = models.BooleanField(default=True)

    # ── round-trip ──
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_property"
        unique_together = ("organization", "property_id")
        ordering = ["property_id"]
        verbose_name_plural = "properties"
        indexes = [
            models.Index(fields=["organization", "property_type"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "country_code"]),
            models.Index(fields=["organization", "owner_related_party"]),
            models.Index(fields=["organization", "linked_portfolio"]),
        ]

    def __str__(self):
        return f"{self.property_id} · {self.property_type or '—'}"


# ─────────────────────────── Policy (insurance) ─────────────────────────── #


class Policy(models.Model):
    """An insurance / wrapper policy — health, life, home, professional, etc.

    Maps tab `16_Policy_Master` of the wealth-management workbook one-to-
    one. Drives the POL dimension on insurance-linked investments
    (150700) and prepaid-insurance accounts (180300). Resolves
    ``policy_owner_id`` / ``primary_related_party_id`` / ``insured_party_id`` /
    ``linked_beneficiary_id`` to ``RelatedParty``, ``insurer_counterparty_id``
    to ``Counterparty``, ``linked_portfolio_id`` to ``Portfolio``,
    ``linked_property_id`` to ``Property``.
    """

    STATUS_ACTIVE = "ACTIVE"
    STATUS_INACTIVE = "INACTIVE"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    # ── identity ──
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_policies",
    )
    policy_id = models.CharField(max_length=80, help_text="Stable workbook identifier, e.g. POL_HEALTH_001.")
    policy_name = models.CharField(max_length=255, blank=True)
    short_name = models.CharField(max_length=80, blank=True)
    policy_type = models.CharField(max_length=40, blank=True)
    policy_subtype = models.CharField(max_length=40, blank=True)

    # ── owner / parties ──
    policy_owner_type = models.CharField(max_length=20, blank=True)
    policy_owner_id_code = models.CharField(max_length=80, blank=True)
    policy_owner_related_party = models.ForeignKey(
        RelatedParty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="policies_owned",
    )
    primary_related_party_id_code = models.CharField(max_length=80, blank=True)
    primary_related_party = models.ForeignKey(
        RelatedParty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="policies_primary",
    )
    insured_party_id_code = models.CharField(max_length=80, blank=True)
    insured_party_related_party = models.ForeignKey(
        RelatedParty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="policies_insured",
    )
    insurer_counterparty_id_code = models.CharField(max_length=80, blank=True)
    insurer_counterparty = models.ForeignKey(
        Counterparty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="policies_issued",
    )

    # ── policy details ──
    policy_number_masked = models.CharField(max_length=80, blank=True)

    # ── jurisdiction / currency ──
    country_code = models.CharField(max_length=4, blank=True)
    jurisdiction_code = models.CharField(max_length=20, blank=True)
    policy_currency = models.CharField(max_length=3, blank=True)
    reporting_currency = models.CharField(max_length=3, blank=True)

    # ── lifecycle / premium ──
    inception_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    renewal_date = models.DateField(null=True, blank=True)
    premium_frequency = models.CharField(max_length=20, blank=True)
    coverage_amount = models.DecimalField(max_digits=24, decimal_places=4, null=True, blank=True)
    deductible_amount = models.DecimalField(max_digits=24, decimal_places=4, null=True, blank=True)

    # ── linkage ──
    investment_linked_flag = models.BooleanField(default=False)
    linked_portfolio_id_code = models.CharField(max_length=80, blank=True)
    linked_portfolio = models.ForeignKey(
        Portfolio, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="policies",
    )
    linked_property_id_code = models.CharField(max_length=80, blank=True)
    linked_property = models.ForeignKey(
        Property, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="policies",
    )
    linked_beneficiary_id_code = models.CharField(max_length=80, blank=True)
    linked_beneficiary_related_party = models.ForeignKey(
        RelatedParty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="policies_beneficiary",
    )

    # ── flags ──
    claim_eligible_flag = models.BooleanField(default=False)
    premium_payable_flag = models.BooleanField(default=False)

    # ── status / workflow ──
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    active_flag = models.BooleanField(default=True)
    posting_allowed_flag = models.BooleanField(default=True)
    approval_required_flag = models.BooleanField(default=True)
    source_document_required_flag = models.BooleanField(default=True)

    # ── round-trip ──
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_policy"
        unique_together = ("organization", "policy_id")
        ordering = ["policy_id"]
        verbose_name_plural = "policies"
        indexes = [
            models.Index(fields=["organization", "policy_type"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "policy_owner_related_party"]),
            models.Index(fields=["organization", "insurer_counterparty"]),
        ]

    def __str__(self):
        return f"{self.policy_id} · {self.policy_type or '—'}"


# ─────────────────────────── Pension ─────────────────────────── #


class Pension(models.Model):
    """A pension / retirement-savings master record.

    Thomas's `Notes` tab on the workbook flags pension assets as a TODO:
    *"Need to incorporate pension assets, like LPP, 3rd pillar."* No
    workbook tab exists yet — this scaffold stands up the master so the
    accounting engine can carry the ``PEN`` dimension on journal lines and
    so future imports have a target table.

    Common pension types in scope (drives accrual / disclosure later):

      - ``LPP_2ND_PILLAR``      — Swiss occupational pension (BVG / LPP)
      - ``PILLAR_3A``           — Swiss tied private pension (tax-privileged)
      - ``PILLAR_3B``           — Swiss free private pension
      - ``FOREIGN_PENSION``     — non-Swiss schemes
      - ``EMPLOYER_DC``         — generic defined-contribution employer scheme
      - ``EMPLOYER_DB``         — generic defined-benefit employer scheme

    The shape mirrors `Policy` — single insured/holder party, a counterparty
    (the pension provider / fund / insurer), currency + jurisdiction,
    valuation amounts, and standard governance flags.
    """

    STATUS_ACTIVE = "ACTIVE"
    STATUS_INACTIVE = "INACTIVE"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    # ── identity ──
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_pensions",
    )
    pension_id = models.CharField(
        max_length=80,
        help_text="Stable identifier — e.g. PEN_LPP_001, PEN_PILLAR3A_001.",
    )
    pension_name = models.CharField(max_length=255, blank=True)
    short_name = models.CharField(max_length=80, blank=True)
    pension_type = models.CharField(
        max_length=40, blank=True,
        help_text="LPP_2ND_PILLAR / PILLAR_3A / PILLAR_3B / FOREIGN_PENSION / "
                  "EMPLOYER_DC / EMPLOYER_DB / OTHER.",
    )
    pension_subtype = models.CharField(max_length=40, blank=True)

    # ── owner / parties ──
    holder_related_party_id_code = models.CharField(max_length=80, blank=True)
    holder_related_party = models.ForeignKey(
        RelatedParty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="pensions_held",
        help_text="The person whose retirement savings this represents.",
    )
    provider_counterparty_id_code = models.CharField(max_length=80, blank=True)
    provider_counterparty = models.ForeignKey(
        Counterparty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="pensions_provided",
        help_text="The pension fund / insurer / institution administering the plan.",
    )
    employer_counterparty_id_code = models.CharField(max_length=80, blank=True)
    employer_counterparty = models.ForeignKey(
        Counterparty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="pensions_employer",
        help_text="Sponsoring employer for occupational schemes (LPP / DC / DB).",
    )

    # ── plan details ──
    plan_number_masked = models.CharField(max_length=80, blank=True)
    contribution_basis = models.CharField(
        max_length=40, blank=True,
        help_text="DEFINED_CONTRIBUTION / DEFINED_BENEFIT / HYBRID.",
    )
    vesting_status = models.CharField(
        max_length=40, blank=True,
        help_text="VESTED / PARTIALLY_VESTED / UNVESTED.",
    )

    # ── jurisdiction / currency ──
    country_code = models.CharField(max_length=4, blank=True)
    jurisdiction_code = models.CharField(max_length=20, blank=True)
    pension_currency = models.CharField(max_length=3, blank=True)
    reporting_currency = models.CharField(max_length=3, blank=True)

    # ── lifecycle ──
    enrollment_date = models.DateField(null=True, blank=True)
    earliest_withdrawal_date = models.DateField(
        null=True, blank=True,
        help_text="Earliest date holder may legally draw benefits — e.g. age 60 for "
                  "Swiss Pillar 3A; varies by jurisdiction.",
    )
    expected_retirement_date = models.DateField(null=True, blank=True)
    payout_start_date = models.DateField(null=True, blank=True)
    closure_date = models.DateField(null=True, blank=True)

    # ── valuation amounts ──
    contributions_to_date = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
        help_text="Cumulative contributions (employee + employer) since inception, in pension_currency.",
    )
    vested_balance = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
        help_text="Current vested cash value, in pension_currency.",
    )
    projected_benefit = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
        help_text="Estimated benefit at retirement — DB plans or projected DC.",
    )
    employer_contribution_rate = models.DecimalField(
        max_digits=7, decimal_places=4, null=True, blank=True,
        help_text="Percentage (0–100). NULL for non-employer plans.",
    )
    employee_contribution_rate = models.DecimalField(
        max_digits=7, decimal_places=4, null=True, blank=True,
    )

    # ── linkage ──
    linked_portfolio_id_code = models.CharField(max_length=80, blank=True)
    linked_portfolio = models.ForeignKey(
        Portfolio, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="pensions",
        help_text="Portfolio bucket where the pension is reported.",
    )
    linked_bank_account_id_code = models.CharField(max_length=80, blank=True)
    linked_bank_account = models.ForeignKey(
        "BankAccount", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="pensions_funded",
        help_text="Bank account from which contributions are paid (for personal pillars).",
    )

    # ── flags ──
    tax_privileged_flag = models.BooleanField(
        default=False,
        help_text="True for tax-advantaged plans (Pillar 3A, 401(k), IRA, etc.).",
    )
    employer_sponsored_flag = models.BooleanField(default=False)
    net_worth_inclusion_flag = models.BooleanField(
        default=True,
        help_text="Include in client net-worth reporting. Some jurisdictions exclude unvested balances.",
    )

    # ── status / workflow ──
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    active_flag = models.BooleanField(default=True)
    posting_allowed_flag = models.BooleanField(default=True)
    approval_required_flag = models.BooleanField(default=True)
    source_document_required_flag = models.BooleanField(default=True)

    # ── round-trip ──
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_pension"
        unique_together = ("organization", "pension_id")
        ordering = ["pension_id"]
        verbose_name_plural = "pensions"
        indexes = [
            models.Index(fields=["organization", "pension_type"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "holder_related_party"]),
            models.Index(fields=["organization", "provider_counterparty"]),
        ]

    def __str__(self):
        return f"{self.pension_id} · {self.pension_type or '—'}"


# ─────────────────────────── Commitment ─────────────────────────── #


class Commitment(models.Model):
    """A private-market commitment master record.

    Workbook tab `04 Dimensions Reference` defines ``COM`` as
    *"Commitment record for private market subscriptions or capital calls"*
    and Thomas's `Master tabs` instruction lists Commitments under the
    *"needs a master if"* test (contractual terms, lifecycle state,
    valuation rules — every commitment qualifies).

    Until now Commitments only existed as ``dimension_commitment_code``
    strings on ``JournalLine`` and as a code on ``Instrument``. This master
    promotes them so capital-call / distribution / unfunded-balance logic
    can attach to a real row.

    Common types (drives accrual + disclosure later):

      - ``LP_FUND``         — limited partnership in a PE/VC/PD/Infra fund
      - ``DIRECT_PRIVATE``  — direct private-equity holding with funding cycle
      - ``CO_INVEST``       — co-investment alongside a sponsor
      - ``REAL_ESTATE_FUND``— real-estate fund LP
      - ``OTHER``
    """

    STATUS_ACTIVE = "ACTIVE"
    STATUS_FULLY_CALLED = "FULLY_CALLED"
    STATUS_WOUND_DOWN = "WOUND_DOWN"
    STATUS_INACTIVE = "INACTIVE"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_FULLY_CALLED, "Fully Called"),
        (STATUS_WOUND_DOWN, "Wound Down"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    # ── identity ──
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_commitments",
    )
    commitment_id = models.CharField(
        max_length=80,
        help_text="Stable identifier — e.g. COM_PE_001, COM_VC_002.",
    )
    commitment_name = models.CharField(max_length=255, blank=True)
    short_name = models.CharField(max_length=80, blank=True)
    commitment_type = models.CharField(
        max_length=40, blank=True,
        help_text="LP_FUND / DIRECT_PRIVATE / CO_INVEST / REAL_ESTATE_FUND / OTHER.",
    )
    commitment_subtype = models.CharField(max_length=40, blank=True)

    # ── parties ──
    holder_related_party_id_code = models.CharField(max_length=80, blank=True)
    holder_related_party = models.ForeignKey(
        RelatedParty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="commitments_held",
        help_text="Investor / LP — the party that has committed capital.",
    )
    general_partner_counterparty_id_code = models.CharField(max_length=80, blank=True)
    general_partner_counterparty = models.ForeignKey(
        Counterparty, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="commitments_as_gp",
        help_text="GP / sponsor / fund manager.",
    )
    vehicle_instrument_id_code = models.CharField(max_length=80, blank=True)
    vehicle_instrument = models.ForeignKey(
        "Instrument", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="commitments",
        help_text="The fund / vehicle this commitment subscribes into, if modelled "
                  "as an Instrument.",
    )

    # ── jurisdiction / currency ──
    country_code = models.CharField(max_length=4, blank=True)
    jurisdiction_code = models.CharField(max_length=20, blank=True)
    commitment_currency = models.CharField(max_length=3, blank=True)
    reporting_currency = models.CharField(max_length=3, blank=True)

    # ── lifecycle ──
    vintage_year = models.IntegerField(null=True, blank=True)
    inception_date = models.DateField(null=True, blank=True)
    final_close_date = models.DateField(null=True, blank=True)
    investment_period_end_date = models.DateField(null=True, blank=True)
    expected_term_years = models.IntegerField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    closure_date = models.DateField(null=True, blank=True)

    # ── capital amounts (in commitment_currency) ──
    total_commitment_amount = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
        help_text="Total committed capital (the headline subscription amount).",
    )
    called_to_date = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
        help_text="Cumulative drawn capital from capital calls.",
    )
    distributions_to_date = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
        help_text="Cumulative cash distributed back to the LP.",
    )
    unfunded_balance = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
        help_text="Remaining uncalled commitment. Should equal total - called + recallable.",
    )
    nav = models.DecimalField(
        max_digits=24, decimal_places=4, null=True, blank=True,
        help_text="Latest reported net asset value of the LP interest.",
    )
    nav_date = models.DateField(null=True, blank=True)

    # ── economics ──
    management_fee_rate = models.DecimalField(
        max_digits=7, decimal_places=4, null=True, blank=True,
        help_text="Annual management fee percentage (0–100).",
    )
    carried_interest_rate = models.DecimalField(
        max_digits=7, decimal_places=4, null=True, blank=True,
        help_text="GP carry percentage (0–100).",
    )
    hurdle_rate = models.DecimalField(
        max_digits=7, decimal_places=4, null=True, blank=True,
        help_text="Preferred return percentage before carry kicks in.",
    )

    # ── linkage ──
    linked_portfolio_id_code = models.CharField(max_length=80, blank=True)
    linked_portfolio = models.ForeignKey(
        Portfolio, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="commitments",
    )
    funding_bank_account_id_code = models.CharField(max_length=80, blank=True)
    funding_bank_account = models.ForeignKey(
        "BankAccount", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="commitments_funded",
        help_text="Bank account from which capital calls are paid.",
    )

    # ── flags ──
    recallable_distributions_flag = models.BooleanField(
        default=False,
        help_text="True if distributions can be recalled by the GP, increasing unfunded balance.",
    )
    net_worth_inclusion_flag = models.BooleanField(default=True)

    # ── status / workflow ──
    status = models.CharField(max_length=14, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    active_flag = models.BooleanField(default=True)
    posting_allowed_flag = models.BooleanField(default=True)
    approval_required_flag = models.BooleanField(default=True)
    source_document_required_flag = models.BooleanField(default=True)

    # ── round-trip ──
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_commitment"
        unique_together = ("organization", "commitment_id")
        ordering = ["commitment_id"]
        indexes = [
            models.Index(fields=["organization", "commitment_type"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "holder_related_party"]),
            models.Index(fields=["organization", "general_partner_counterparty"]),
            models.Index(fields=["organization", "vintage_year"]),
        ]

    def __str__(self):
        return f"{self.commitment_id} · {self.commitment_type or '—'}"
