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
    ApprovalAction,
    CoAMapping,
    ControlledListEntry,
    Currency,
    DimensionType,
    DimensionValue,
    DimensionValidationRule,
    Entity,
    FXRate,
    IntercompanyGroup,
    JournalEntry,
    JournalLine,
    Period,
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
