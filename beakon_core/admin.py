"""Admin for the Beakon kernel — the quickest way to inspect data without a UI.

Editable: Entity, FXRate, AccountGroup, Account, Currency.
Read-mostly: JournalEntry, JournalLine, ApprovalAction, Period, IntercompanyGroup.
  — writes should go through JournalService, not admin, so the state machine
    stays correct.
"""
from django.contrib import admin

from .models import (
    Account,
    AccountGroup,
    ActivationRequest,
    ApprovalAction,
    BankAccountMaster,
    CoAMapping,
    Commitment,
    ControlledListEntry,
    Counterparty,
    Currency,
    DimensionType,
    DimensionValue,
    Custodian,
    DimensionValidationRule,
    Entity,
    FXRate,
    Instrument,
    IntercompanyGroup,
    JournalEntry,
    JournalLine,
    Loan,
    OrganizationSubscription,
    Plan,
    Pension,
    Period,
    Policy,
    Portfolio,
    Property,
    RelatedParty,
    TaxCode,
    TaxLot,
)


# ── Entity + currency + FX (editable) ──────────────────────────────────────

@admin.register(Currency)
class CurrencyAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "symbol", "decimal_places", "is_active")
    list_filter = ("is_active",)
    search_fields = ("code", "name")


@admin.register(Entity)
class EntityAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "entity_type", "functional_currency",
                    "country", "parent", "is_active", "organization")
    list_filter = ("entity_type", "is_active", "functional_currency", "organization")
    search_fields = ("code", "name", "legal_name", "tax_id")
    raw_id_fields = ("parent", "created_by")
    ordering = ("organization", "code")


@admin.register(FXRate)
class FXRateAdmin(admin.ModelAdmin):
    list_display = ("from_currency", "to_currency", "rate", "as_of", "source")
    list_filter = ("from_currency", "to_currency", "source")
    search_fields = ("from_currency", "to_currency")
    date_hierarchy = "as_of"


# ── COA (editable) ─────────────────────────────────────────────────────────

@admin.register(AccountGroup)
class AccountGroupAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "parent", "sort_order", "organization")
    search_fields = ("code", "name")
    raw_id_fields = ("parent",)
    list_filter = ("organization",)


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "account_type", "account_subtype",
                    "source_account_type", "posting_allowed", "header_flag",
                    "normal_balance", "currency", "entity", "is_active", "is_system")
    list_filter = ("account_type", "account_subtype", "is_active", "is_system",
                   "posting_allowed", "header_flag", "coa_definition", "entity",
                   "organization")
    search_fields = ("code", "name")
    raw_id_fields = ("parent", "group", "entity", "coa_definition")
    ordering = ("organization", "entity", "code")


@admin.register(CoAMapping)
class CoAMappingAdmin(admin.ModelAdmin):
    list_display = ("mapping_id", "source_account_no", "source_account_name",
                    "universal_coa_code", "mapping_type", "mapping_percent",
                    "review_status", "coa_definition")
    list_filter = ("mapping_type", "review_status", "coa_definition", "organization")
    search_fields = ("mapping_id", "source_account_no", "source_account_name",
                     "universal_coa_code", "universal_coa_name")
    raw_id_fields = ("coa_definition", "account")
    ordering = ("organization", "source_account_no")


@admin.register(DimensionType)
class DimensionTypeAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "applies_to", "mandatory_flag",
                    "multi_select_allowed", "master_data_owner", "active_flag")
    list_filter = ("active_flag", "mandatory_flag", "organization")
    search_fields = ("code", "name", "description", "applies_to")
    ordering = ("organization", "code")


@admin.register(DimensionValue)
class DimensionValueAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "dimension_type", "parent_value_code",
                    "active_flag", "effective_from", "effective_to")
    list_filter = ("dimension_type", "active_flag", "organization")
    search_fields = ("code", "name", "description", "external_reference")
    raw_id_fields = ("dimension_type",)
    ordering = ("organization", "dimension_type__code", "code")


@admin.register(ControlledListEntry)
class ControlledListEntryAdmin(admin.ModelAdmin):
    list_display = ("list_name", "list_code", "list_value", "display_order",
                    "active_flag", "organization")
    list_filter = ("list_name", "active_flag", "organization")
    search_fields = ("list_name", "list_code", "list_value", "description")
    ordering = ("organization", "list_name", "display_order")


@admin.register(DimensionValidationRule)
class DimensionValidationRuleAdmin(admin.ModelAdmin):
    list_display = ("rule_id", "account_no", "account_name", "rule_type",
                    "trigger_event", "severity", "active_flag")
    list_filter = ("rule_type", "trigger_event", "severity", "active_flag",
                   "coa_definition", "organization")
    search_fields = ("rule_id", "account_no", "account_name",
                     "required_dimension_type_codes",
                     "optional_dimension_type_codes")
    raw_id_fields = ("coa_definition", "account")
    ordering = ("organization", "account_no", "rule_id")


# ── Periods (editable) ─────────────────────────────────────────────────────

@admin.register(Period)
class PeriodAdmin(admin.ModelAdmin):
    list_display = ("entity", "name", "period_type", "start_date", "end_date",
                    "status", "closed_by", "closed_at")
    list_filter = ("status", "period_type", "entity")
    date_hierarchy = "start_date"
    raw_id_fields = ("closed_by",)


# ── Journal (read-mostly — do not bypass the service layer) ────────────────

class JournalLineInline(admin.TabularInline):
    model = JournalLine
    extra = 0
    raw_id_fields = ("account", "counterparty_entity", "rebill_client_dimension_value")
    readonly_fields = ("exchange_rate", "functional_debit", "functional_credit",
                       "created_at", "updated_at")
    fields = ("line_order", "account", "description", "debit", "credit",
              "currency", "exchange_rate", "functional_debit", "functional_credit",
              "counterparty_entity", "is_rebillable", "rebill_client_dimension_value")


class ApprovalActionInline(admin.TabularInline):
    model = ApprovalAction
    extra = 0
    readonly_fields = ("action", "from_status", "to_status", "actor", "note", "at")
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(JournalEntry)
class JournalEntryAdmin(admin.ModelAdmin):
    list_display = ("entry_number", "entity", "date", "status",
                    "total_debit_functional", "total_credit_functional",
                    "source_type", "period", "posted_by")
    list_filter = ("status", "source_type", "entity", "organization")
    search_fields = ("entry_number", "memo", "reference", "source_ref")
    raw_id_fields = ("entity", "period", "reversal_of", "counterparty_entity",
                     "intercompany_group", "created_by", "submitted_for_approval_by",
                     "approved_by", "rejected_by", "posted_by")
    readonly_fields = ("entry_number", "total_debit_functional",
                       "total_credit_functional",
                       "submitted_for_approval_at", "approved_at",
                       "rejected_at", "posted_at", "created_at", "updated_at")
    inlines = [JournalLineInline, ApprovalActionInline]
    date_hierarchy = "date"
    ordering = ("-date", "-entry_number")


@admin.register(JournalLine)
class JournalLineAdmin(admin.ModelAdmin):
    list_display = ("journal_entry", "line_order", "account", "debit", "credit",
                    "currency", "functional_debit", "functional_credit",
                    "is_rebillable")
    list_filter = ("currency", "is_rebillable")
    raw_id_fields = ("journal_entry", "account", "counterparty_entity",
                     "rebill_client_dimension_value")
    search_fields = ("description", "journal_entry__entry_number")


@admin.register(ApprovalAction)
class ApprovalActionAdmin(admin.ModelAdmin):
    list_display = ("journal_entry", "action", "from_status", "to_status", "actor", "at")
    list_filter = ("action", "to_status")
    raw_id_fields = ("journal_entry", "actor")
    date_hierarchy = "at"
    readonly_fields = ("journal_entry", "action", "from_status", "to_status",
                       "actor", "note", "at")


@admin.register(IntercompanyGroup)
class IntercompanyGroupAdmin(admin.ModelAdmin):
    list_display = ("id", "reference", "organization", "created_by", "created_at")
    search_fields = ("reference", "description")
    raw_id_fields = ("created_by",)
    date_hierarchy = "created_at"


# ── Master tables (workbook tabs 07–17) ────────────────────────────────────

@admin.register(TaxLot)
class TaxLotAdmin(admin.ModelAdmin):
    list_display = (
        "tax_lot_id", "instrument_code", "portfolio_code", "custodian_code",
        "account", "lot_status", "remaining_quantity", "acquisition_currency",
        "acquisition_trade_date", "active_flag",
    )
    list_filter = (
        "lot_status", "cost_basis_method", "active_flag",
        "wash_sale_flag", "corporate_action_adjusted_flag",
        "acquisition_currency", "organization",
    )
    search_fields = (
        "tax_lot_id", "instrument_code", "portfolio_code", "custodian_code",
        "account_no", "source_transaction_reference", "source_document_reference",
    )
    raw_id_fields = ("account",)
    date_hierarchy = "acquisition_trade_date"
    fieldsets = (
        ("Identity", {
            "fields": ("organization", "tax_lot_id", "active_flag"),
        }),
        ("Linked masters", {
            "fields": ("instrument_code", "portfolio_code", "custodian_code",
                       "account", "account_no"),
        }),
        ("Opening", {
            "fields": ("lot_open_date", "acquisition_trade_date", "settlement_date",
                       "original_quantity", "remaining_quantity", "unit_of_measure",
                       "acquisition_price_per_unit", "acquisition_currency",
                       "acquisition_fx_rate_to_reporting",
                       "acquisition_cost_transaction_ccy",
                       "acquisition_cost_reporting_ccy",
                       "cost_basis_method"),
        }),
        ("Lifecycle", {
            "fields": ("lot_status", "disposal_date", "disposed_quantity",
                       "cumulative_disposed_quantity",
                       "remaining_cost_reporting_ccy",
                       "realized_gain_loss_reporting_ccy"),
        }),
        ("Flags & source", {
            "fields": ("wash_sale_flag", "corporate_action_adjusted_flag",
                       "source_transaction_reference",
                       "source_document_reference"),
        }),
        ("Round-trip", {
            "classes": ("collapse",),
            "fields": ("notes", "workbook_metadata", "created_at", "updated_at"),
        }),
    )
    readonly_fields = ("created_at", "updated_at")


@admin.register(Loan)
class LoanAdmin(admin.ModelAdmin):
    list_display = (
        "loan_id", "loan_type", "loan_side", "status",
        "borrower_or_lender_code", "loan_currency",
        "current_principal_outstanding", "interest_rate_type",
        "maturity_date", "organization",
    )
    list_filter = (
        "loan_type", "loan_side", "status",
        "interest_rate_type", "repayment_type", "valuation_basis",
        "related_party_flag", "approval_required_flag",
        "fx_remeasure_flag", "organization",
    )
    search_fields = (
        "loan_id", "loan_name", "borrower_or_lender_code",
        "facility_reference", "internal_reference",
        "default_principal_account_code",
        "default_interest_income_account_code",
        "default_interest_expense_account_code",
    )
    raw_id_fields = (
        "default_principal_account",
        "default_interest_income_account",
        "default_interest_expense_account",
        "default_fx_gain_loss_account",
    )
    date_hierarchy = "start_date"
    fieldsets = (
        ("Identity", {
            "fields": ("organization", "loan_id", "loan_name",
                       "loan_type", "loan_side", "status"),
        }),
        ("Parties / refs", {
            "fields": ("borrower_or_lender_code", "related_party_flag",
                       "facility_reference", "internal_reference"),
        }),
        ("Principal & rate", {
            "fields": ("loan_currency", "principal_original",
                       "current_principal_outstanding",
                       "interest_rate_type", "fixed_rate",
                       "reference_rate_code", "spread_bps"),
        }),
        ("Frequencies & day count", {
            "fields": ("interest_reset_frequency", "interest_payment_frequency",
                       "day_count_convention"),
        }),
        ("Lifecycle dates", {
            "fields": ("start_date", "first_accrual_date", "maturity_date",
                       "next_reset_date", "next_interest_payment_date",
                       "next_principal_payment_date",
                       "effective_from", "effective_to"),
        }),
        ("Repayment & amortization", {
            "fields": ("repayment_type", "amortization_method",
                       "bullet_flag", "scheduled_principal_amount",
                       "prepayment_allowed_flag", "capitalized_interest_flag"),
        }),
        ("Linkage & collateral", {
            "fields": ("reporting_portfolio_code",
                       "collateral_link_type", "collateral_link_id"),
        }),
        ("Valuation & policy", {
            "fields": ("current_noncurrent_split_method",
                       "valuation_basis", "impairment_method",
                       "accrual_required_flag", "fx_remeasure_flag"),
        }),
        ("Default GL accounts", {
            "fields": ("default_principal_account_code", "default_principal_account",
                       "default_interest_income_account_code",
                       "default_interest_income_account",
                       "default_interest_expense_account_code",
                       "default_interest_expense_account",
                       "default_fx_gain_loss_account_code",
                       "default_fx_gain_loss_account"),
        }),
        ("Workflow flags", {
            "fields": ("approval_required_flag", "manual_override_allowed_flag",
                       "source_document_required_flag"),
        }),
        ("Round-trip", {
            "classes": ("collapse",),
            "fields": ("notes", "workbook_metadata", "created_at", "updated_at"),
        }),
    )
    readonly_fields = ("created_at", "updated_at")


@admin.register(Instrument)
class InstrumentAdmin(admin.ModelAdmin):
    list_display = (
        "instrument_id", "instrument_name", "instrument_type",
        "quoted_unquoted_flag", "asset_class_code", "portfolio_default",
        "custodian_default", "currency", "valuation_method", "status",
    )
    list_filter = (
        "instrument_type", "quoted_unquoted_flag", "valuation_method",
        "price_source", "income_type", "income_frequency",
        "asset_class_code", "portfolio_default", "custodian_default",
        "currency", "status", "fx_exposure_flag", "tax_lot_required",
        "commitment_flag", "loan_linked_flag", "related_party_flag",
        "esg_or_restriction_flag", "organization",
    )
    search_fields = (
        "instrument_id", "instrument_name", "instrument_type",
        "isin_or_ticker", "internal_reference",
        "issuer_or_counterparty_code", "loan_workbook_id",
        "default_principal_account_code",
        "default_income_account_code",
        "default_expense_account_code",
        "default_realized_gl_account_code",
        "default_unrealized_gl_account_code",
        "default_fx_gl_account_code",
    )
    raw_id_fields = (
        "loan",
        "default_principal_account",
        "default_income_account",
        "default_expense_account",
        "default_realized_gl_account",
        "default_unrealized_gl_account",
        "default_fx_gl_account",
    )
    date_hierarchy = "inception_date"
    fieldsets = (
        ("Identity", {
            "fields": ("organization", "instrument_id", "instrument_name",
                       "instrument_type", "quoted_unquoted_flag", "status"),
        }),
        ("Classification", {
            "fields": ("asset_class_code", "strategy_code",
                       "portfolio_default", "custodian_default",
                       "issuer_or_counterparty_code", "related_party_flag",
                       "isin_or_ticker", "internal_reference"),
        }),
        ("Currency / jurisdiction", {
            "fields": ("currency", "jurisdiction_code", "domicile_code"),
        }),
        ("Commitment / loan linkage", {
            "fields": ("commitment_flag", "commitment_code",
                       "loan_linked_flag", "loan_workbook_id", "loan",
                       "tax_lot_required"),
        }),
        ("Income & valuation", {
            "fields": ("income_type", "income_frequency",
                       "valuation_method", "price_source",
                       "fx_exposure_flag", "impairment_method",
                       "esg_or_restriction_flag", "restriction_type_code"),
        }),
        ("Lifecycle", {
            "fields": ("inception_date", "maturity_date",
                       "settlement_cycle", "day_count_convention",
                       "effective_from", "effective_to"),
        }),
        ("Reporting", {
            "fields": ("performance_group", "report_category_code"),
        }),
        ("Default GL accounts", {
            "fields": ("default_principal_account_code", "default_principal_account",
                       "default_income_account_code", "default_income_account",
                       "default_expense_account_code", "default_expense_account",
                       "default_realized_gl_account_code", "default_realized_gl_account",
                       "default_unrealized_gl_account_code", "default_unrealized_gl_account",
                       "default_fx_gl_account_code", "default_fx_gl_account"),
        }),
        ("Round-trip", {
            "classes": ("collapse",),
            "fields": ("notes", "workbook_metadata", "created_at", "updated_at"),
        }),
    )
    readonly_fields = ("created_at", "updated_at")


@admin.register(Portfolio)
class PortfolioAdmin(admin.ModelAdmin):
    list_display = (
        "portfolio_id", "portfolio_name", "portfolio_type", "portfolio_subtype",
        "owner_type", "linked_custodian_id", "base_currency",
        "discretionary_flag", "status", "active_flag",
    )
    list_filter = (
        "portfolio_type", "portfolio_subtype", "owner_type", "status",
        "active_flag", "discretionary_flag", "consolidation_flag",
        "net_worth_inclusion_flag", "performance_report_flag",
        "posting_allowed_flag", "base_currency", "country_code",
        "linked_custodian_id", "reporting_group", "organization",
    )
    search_fields = (
        "portfolio_id", "portfolio_name", "short_name",
        "portfolio_subtype", "owner_id", "primary_related_party_id",
        "linked_custodian_id", "strategy_code", "asset_allocation_profile",
        "parent_portfolio_workbook_id", "reporting_group", "notes",
    )
    raw_id_fields = ("parent",)
    date_hierarchy = "open_date"
    fieldsets = (
        ("Identity", {
            "fields": ("organization", "portfolio_id", "portfolio_name",
                       "short_name", "portfolio_type", "portfolio_subtype"),
        }),
        ("Ownership", {
            "fields": ("owner_type", "owner_id", "primary_related_party_id",
                       "linked_custodian_id"),
        }),
        ("Currency / jurisdiction", {
            "fields": ("base_currency", "reporting_currency",
                       "country_code", "jurisdiction_code"),
        }),
        ("Strategy & allocation", {
            "fields": ("strategy_code", "asset_allocation_profile"),
        }),
        ("Flags", {
            "fields": ("discretionary_flag", "consolidation_flag",
                       "net_worth_inclusion_flag", "performance_report_flag",
                       "posting_allowed_flag"),
        }),
        ("Lifecycle", {
            "fields": ("status", "active_flag", "open_date", "close_date"),
        }),
        ("Hierarchy", {
            "fields": ("parent_portfolio_workbook_id", "parent"),
        }),
        ("Reporting & workflow", {
            "fields": ("reporting_group", "approval_required_flag",
                       "source_document_required_flag"),
        }),
        ("Round-trip", {
            "classes": ("collapse",),
            "fields": ("notes", "workbook_metadata", "created_at", "updated_at"),
        }),
    )
    readonly_fields = ("created_at", "updated_at")


@admin.register(Custodian)
class CustodianAdmin(admin.ModelAdmin):
    list_display = (
        "custodian_id", "custodian_name", "custodian_type",
        "booking_center", "country_code", "base_currency",
        "supports_listed_securities_flag", "supports_private_assets_flag",
        "supports_digital_assets_flag", "status", "active_flag",
    )
    list_filter = (
        "custodian_type", "status", "active_flag",
        "country_code", "base_currency",
        "supports_listed_securities_flag", "supports_private_assets_flag",
        "supports_funds_flag", "supports_derivatives_flag",
        "supports_digital_assets_flag", "supports_cash_sweep_flag",
        "nominee_holding_flag", "segregated_account_flag",
        "posting_allowed_flag", "organization",
    )
    search_fields = (
        "custodian_id", "custodian_name", "short_name",
        "linked_counterparty_id", "legal_entity_name",
        "booking_center", "default_portfolio_code", "notes",
    )
    raw_id_fields = ("default_portfolio",)
    date_hierarchy = "relationship_start_date"
    fieldsets = (
        ("Identity", {
            "fields": ("organization", "custodian_id", "custodian_name",
                       "short_name", "custodian_type", "custodian_subtype"),
        }),
        ("Linkage", {
            "fields": ("linked_counterparty_id",
                       "default_portfolio_code", "default_portfolio"),
        }),
        ("Legal / location", {
            "fields": ("legal_entity_name", "booking_center",
                       "country_code", "jurisdiction_code"),
        }),
        ("Currency", {
            "fields": ("base_currency", "reporting_currency"),
        }),
        ("Relationship lifecycle", {
            "fields": ("relationship_start_date", "relationship_end_date"),
        }),
        ("Capabilities", {
            "fields": ("supports_listed_securities_flag",
                       "supports_private_assets_flag",
                       "supports_funds_flag",
                       "supports_derivatives_flag",
                       "supports_digital_assets_flag",
                       "supports_cash_sweep_flag",
                       "nominee_holding_flag",
                       "segregated_account_flag"),
        }),
        ("Status & workflow", {
            "fields": ("status", "active_flag", "posting_allowed_flag",
                       "approval_required_flag",
                       "source_document_required_flag"),
        }),
        ("Round-trip", {
            "classes": ("collapse",),
            "fields": ("notes", "workbook_metadata", "created_at", "updated_at"),
        }),
    )
    readonly_fields = ("created_at", "updated_at")


@admin.register(RelatedParty)
class RelatedPartyAdmin(admin.ModelAdmin):
    list_display = (
        "related_party_id", "related_party_name", "related_party_type",
        "party_form", "relationship_to_client", "country_code",
        "control_flag", "beneficiary_flag", "status", "active_flag",
    )
    list_filter = (
        "related_party_type", "party_form", "status", "active_flag",
        "country_code", "tax_residence_country", "base_currency",
        "control_flag", "beneficiary_flag", "settlor_flag",
        "protector_flag", "director_flag", "signer_flag",
        "loan_eligible_flag", "distribution_eligible_flag",
        "capital_contribution_eligible_flag",
        "expense_allocation_eligible_flag",
        "family_expense_eligible_flag", "net_worth_inclusion_flag",
        "organization",
    )
    search_fields = (
        "related_party_id", "related_party_name", "short_name",
        "related_party_subtype", "relationship_to_client",
        "default_portfolio_code", "default_property_code",
        "default_bank_reference", "notes",
    )
    raw_id_fields = ("default_portfolio",)
    date_hierarchy = "related_party_since"
    fieldsets = (
        ("Identity", {
            "fields": ("organization", "related_party_id", "related_party_name",
                       "short_name", "related_party_type", "related_party_subtype",
                       "party_form", "relationship_to_client"),
        }),
        ("Ownership / control", {
            "fields": ("ownership_percent", "control_flag",
                       "beneficiary_flag", "settlor_flag",
                       "protector_flag", "director_flag", "signer_flag"),
        }),
        ("Status / lifecycle", {
            "fields": ("status", "active_flag",
                       "related_party_since", "related_party_until"),
        }),
        ("Jurisdiction / currency", {
            "fields": ("country_code", "jurisdiction_code",
                       "base_currency", "reporting_currency",
                       "tax_residence_country"),
        }),
        ("Eligibility", {
            "fields": ("loan_eligible_flag", "distribution_eligible_flag",
                       "capital_contribution_eligible_flag",
                       "expense_allocation_eligible_flag",
                       "family_expense_eligible_flag",
                       "net_worth_inclusion_flag"),
        }),
        ("Default linkage", {
            "fields": ("default_portfolio_code", "default_portfolio",
                       "default_property_code", "default_bank_reference"),
        }),
        ("Workflow", {
            "fields": ("source_document_required_flag", "approval_required_flag"),
        }),
        ("Round-trip", {
            "classes": ("collapse",),
            "fields": ("notes", "workbook_metadata", "created_at", "updated_at"),
        }),
    )
    readonly_fields = ("created_at", "updated_at")


@admin.register(Counterparty)
class CounterpartyAdmin(admin.ModelAdmin):
    list_display = ("counterparty_id", "counterparty_name", "counterparty_type",
                    "country_code", "base_currency", "kyc_status", "risk_rating",
                    "status", "active_flag")
    list_filter = ("counterparty_type", "status", "active_flag",
                   "country_code", "base_currency", "kyc_status",
                   "aml_risk_level", "risk_rating",
                   "related_party_flag", "intercompany_flag",
                   "loan_eligible_flag", "ap_eligible_flag", "ar_eligible_flag",
                   "tax_eligible_flag", "insurance_eligible_flag",
                   "education_eligible_flag", "professional_fees_eligible_flag",
                   "organization")
    search_fields = ("counterparty_id", "counterparty_name", "short_name",
                     "external_reference", "tax_id", "registration_no",
                     "default_bank_reference", "notes")
    fieldsets = (
        ("Identity", {"fields": ("organization", "counterparty_id", "counterparty_name",
                                  "short_name", "counterparty_type", "counterparty_subtype",
                                  "status", "active_flag")}),
        ("External refs", {"fields": ("external_reference", "tax_id", "registration_no")}),
        ("Jurisdiction / currency", {"fields": ("country_code", "jurisdiction_code",
                                                  "base_currency", "default_payment_currency",
                                                  "language_code")}),
        ("Payment / settlement", {"fields": ("payment_terms", "settlement_method",
                                              "default_bank_reference")}),
        ("Risk / compliance", {"fields": ("risk_rating", "kyc_status", "aml_risk_level",
                                           "sanctions_check_flag")}),
        ("Relationship flags", {"fields": ("related_party_flag", "intercompany_flag")}),
        ("Eligibility", {"fields": ("loan_eligible_flag", "ap_eligible_flag",
                                     "ar_eligible_flag", "tax_eligible_flag",
                                     "insurance_eligible_flag", "education_eligible_flag",
                                     "professional_fees_eligible_flag")}),
        ("Round-trip", {"classes": ("collapse",),
                        "fields": ("notes", "workbook_metadata", "created_at", "updated_at")}),
    )
    readonly_fields = ("created_at", "updated_at")


@admin.register(BankAccountMaster)
class BankAccountMasterAdmin(admin.ModelAdmin):
    list_display = ("bank_account_id", "bank_account_name", "bank_name",
                    "account_currency", "account_type", "account_purpose",
                    "country_code", "status", "active_flag", "posting_allowed_flag")
    list_filter = ("account_type", "account_subtype", "account_purpose",
                   "status", "active_flag", "posting_allowed_flag",
                   "restricted_flag", "interest_bearing_flag",
                   "overdraft_allowed_flag", "country_code",
                   "account_currency", "kyc_status", "organization")
    search_fields = ("bank_account_id", "bank_account_name", "short_name",
                     "bank_name", "iban_or_account_no_masked", "swift_bic",
                     "account_holder_id_code", "bank_counterparty_id_code",
                     "credit_line_linked_loan_id_code", "default_portfolio_code",
                     "default_related_party_id_code", "default_counterparty_id_code",
                     "notes")
    raw_id_fields = ("account_holder_related_party", "bank_counterparty",
                     "credit_line_linked_loan", "default_portfolio",
                     "default_related_party", "default_counterparty")
    date_hierarchy = "opening_date"
    readonly_fields = ("created_at", "updated_at")


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ("property_id", "property_name", "property_type",
                    "city", "country_code", "property_currency",
                    "current_carrying_value", "mortgage_linked_flag",
                    "status", "active_flag")
    list_filter = ("property_type", "property_subtype", "usage_type",
                   "ownership_type", "owner_type", "status", "active_flag",
                   "mortgage_linked_flag", "rental_income_flag",
                   "personal_use_flag", "expense_allocation_allowed_flag",
                   "net_worth_inclusion_flag", "country_code",
                   "property_currency", "valuation_method", "organization")
    search_fields = ("property_id", "property_name", "short_name",
                     "owner_id_code", "primary_related_party_id_code",
                     "linked_portfolio_id_code", "linked_loan_id_code",
                     "linked_spv_id", "city", "address_line_1",
                     "postal_code", "notes")
    raw_id_fields = ("owner_related_party", "primary_related_party",
                     "linked_portfolio", "linked_loan")
    date_hierarchy = "acquisition_date"
    readonly_fields = ("created_at", "updated_at")


@admin.register(Policy)
class PolicyAdmin(admin.ModelAdmin):
    list_display = ("policy_id", "policy_name", "policy_type",
                    "policy_currency", "premium_frequency",
                    "coverage_amount", "expiry_date", "status", "active_flag")
    list_filter = ("policy_type", "policy_subtype", "status", "active_flag",
                   "investment_linked_flag", "claim_eligible_flag",
                   "premium_payable_flag", "country_code",
                   "policy_currency", "premium_frequency", "organization")
    search_fields = ("policy_id", "policy_name", "short_name",
                     "policy_owner_id_code", "primary_related_party_id_code",
                     "insured_party_id_code", "insurer_counterparty_id_code",
                     "linked_portfolio_id_code", "linked_property_id_code",
                     "linked_beneficiary_id_code", "policy_number_masked",
                     "notes")
    raw_id_fields = ("policy_owner_related_party", "primary_related_party",
                     "insured_party_related_party", "insurer_counterparty",
                     "linked_portfolio", "linked_property",
                     "linked_beneficiary_related_party")
    date_hierarchy = "inception_date"
    readonly_fields = ("created_at", "updated_at")


@admin.register(Pension)
class PensionAdmin(admin.ModelAdmin):
    list_display = ("pension_id", "pension_name", "pension_type",
                    "pension_currency", "vested_balance",
                    "expected_retirement_date", "status", "active_flag")
    list_filter = ("pension_type", "pension_subtype", "status", "active_flag",
                   "tax_privileged_flag", "employer_sponsored_flag",
                   "country_code", "pension_currency", "organization")
    search_fields = ("pension_id", "pension_name", "short_name",
                     "holder_related_party_id_code",
                     "provider_counterparty_id_code",
                     "employer_counterparty_id_code",
                     "linked_portfolio_id_code", "linked_bank_account_id_code",
                     "plan_number_masked", "notes")
    raw_id_fields = ("holder_related_party", "provider_counterparty",
                     "employer_counterparty", "linked_portfolio",
                     "linked_bank_account")
    date_hierarchy = "enrollment_date"
    readonly_fields = ("created_at", "updated_at")


@admin.register(Commitment)
class CommitmentAdmin(admin.ModelAdmin):
    list_display = ("commitment_id", "commitment_name", "commitment_type",
                    "commitment_currency", "vintage_year",
                    "total_commitment_amount", "called_to_date",
                    "unfunded_balance", "status", "active_flag")
    list_filter = ("commitment_type", "commitment_subtype", "status", "active_flag",
                   "vintage_year", "recallable_distributions_flag",
                   "country_code", "commitment_currency", "organization")
    search_fields = ("commitment_id", "commitment_name", "short_name",
                     "holder_related_party_id_code",
                     "general_partner_counterparty_id_code",
                     "vehicle_instrument_id_code",
                     "linked_portfolio_id_code",
                     "funding_bank_account_id_code", "notes")
    raw_id_fields = ("holder_related_party", "general_partner_counterparty",
                     "vehicle_instrument", "linked_portfolio",
                     "funding_bank_account")
    date_hierarchy = "inception_date"
    readonly_fields = ("created_at", "updated_at")


@admin.register(TaxCode)
class TaxCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "country_code", "tax_type", "rate",
                    "output_account", "input_account", "is_reverse_charge",
                    "active_flag")
    list_filter = ("tax_type", "country_code", "active_flag",
                   "is_reverse_charge", "organization")
    search_fields = ("code", "name", "country_code", "notes")
    raw_id_fields = ("output_account", "input_account")
    readonly_fields = ("created_at", "updated_at")


# ── Commercial layer (plans / subscriptions / activation requests) ──


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ("sort_order", "name", "slug", "price", "currency",
                    "billing_cadence", "max_entities",
                    "is_self_serve", "is_active")
    list_filter = ("is_active", "is_self_serve", "billing_cadence")
    search_fields = ("name", "slug", "audience")


@admin.register(OrganizationSubscription)
class OrganizationSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("organization", "plan", "status",
                    "started_at", "trial_ends_at", "activated_at")
    list_filter = ("status", "plan")
    raw_id_fields = ("organization", "plan")
    readonly_fields = ("started_at", "created_at", "updated_at")
    actions = ["activate_selected"]

    @admin.action(description="Mark selected as active (after invoice paid)")
    def activate_selected(self, request, queryset):
        for sub in queryset:
            if sub.status != OrganizationSubscription.STATUS_ACTIVE:
                sub.activate(notes=f"Activated from admin by {request.user}.")
        self.message_user(request, f"Activated {queryset.count()} subscription(s).")


@admin.register(ActivationRequest)
class ActivationRequestAdmin(admin.ModelAdmin):
    list_display = ("requested_at", "subscription", "contact_name",
                    "contact_email", "status", "invoice_ref", "handled_at")
    list_filter = ("status",)
    search_fields = ("contact_name", "contact_email", "invoice_ref",
                     "subscription__organization__name")
    raw_id_fields = ("subscription", "requested_by", "handled_by")
    readonly_fields = ("requested_at",)
