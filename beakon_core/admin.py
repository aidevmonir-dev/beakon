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
    Currency,
    Entity,
    FXRate,
    IntercompanyGroup,
    JournalEntry,
    JournalLine,
    Period,
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
                    "normal_balance", "currency", "entity", "is_active", "is_system")
    list_filter = ("account_type", "account_subtype", "is_active", "is_system",
                   "entity", "organization")
    search_fields = ("code", "name")
    raw_id_fields = ("parent", "group", "entity")
    ordering = ("organization", "entity", "code")


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
    raw_id_fields = ("account", "counterparty_entity")
    readonly_fields = ("exchange_rate", "functional_debit", "functional_credit",
                       "created_at", "updated_at")
    fields = ("line_order", "account", "description", "debit", "credit",
              "currency", "exchange_rate", "functional_debit", "functional_credit",
              "counterparty_entity")


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
                    "currency", "functional_debit", "functional_credit")
    list_filter = ("currency",)
    raw_id_fields = ("journal_entry", "account", "counterparty_entity")
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
