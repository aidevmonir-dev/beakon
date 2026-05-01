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

    # ── parties / refs (codes today, FK once masters exist) ──
    borrower_or_lender_code = models.CharField(
        max_length=80, blank=True,
        help_text="Counterparty or RelatedParty code. FK once those masters exist.",
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
        help_text="Workbook Portfolio code. FK to Portfolio once that master exists.",
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
    portfolio_default = models.CharField(max_length=40, blank=True, help_text="PORT_* code; FK to Portfolio later.")
    custodian_default = models.CharField(max_length=40, blank=True, help_text="CUST_* code; FK to Custodian later.")
    issuer_or_counterparty_code = models.CharField(
        max_length=80, blank=True,
        help_text="Issuer code (CP_*) or related-party (RP_*); FK once those masters exist.",
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

    # ── ownership / parties (codes today, FK later) ──
    owner_type = models.CharField(max_length=20, choices=OWNER_TYPE_CHOICES, blank=True)
    owner_id = models.CharField(
        max_length=80, blank=True,
        help_text="Owner code (RP_*, CO_*, …); FK to RelatedParty/Entity once those masters exist.",
    )
    primary_related_party_id = models.CharField(
        max_length=80, blank=True,
        help_text="RP_* code; FK to RelatedParty later.",
    )
    linked_custodian_id = models.CharField(
        max_length=80, blank=True,
        help_text="CUST_* code; FK to Custodian later.",
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
