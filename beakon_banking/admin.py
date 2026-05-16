from django.contrib import admin

from .models import (
    AvaloqFeedDrop,
    BankAccount,
    BankTransaction,
    FeedImport,
    ReconciliationBreak,
)


@admin.register(BankAccount)
class BankAccountAdmin(admin.ModelAdmin):
    list_display = ("name", "entity", "account", "currency",
                    "account_number_last4", "is_active", "organization")
    list_filter = ("is_active", "currency", "organization")
    search_fields = ("name", "bank_name")
    raw_id_fields = ("entity", "account", "created_by")


@admin.register(FeedImport)
class FeedImportAdmin(admin.ModelAdmin):
    list_display = ("created_at", "bank_account", "source", "status",
                    "total_rows", "imported_rows", "duplicate_rows", "error_rows")
    list_filter = ("status", "source")
    raw_id_fields = ("bank_account", "imported_by")
    readonly_fields = ("error_log", "started_at", "completed_at")


@admin.register(BankTransaction)
class BankTransactionAdmin(admin.ModelAdmin):
    list_display = ("date", "bank_account", "_desc", "amount", "currency",
                    "status", "is_duplicate", "proposed_journal_entry")
    list_filter = ("status", "is_duplicate", "bank_account")
    search_fields = ("description", "external_id")
    raw_id_fields = ("bank_account", "feed_import", "proposed_journal_entry")
    date_hierarchy = "date"

    @admin.display(description="description")
    def _desc(self, obj):
        return (obj.description or "")[:60]


@admin.register(AvaloqFeedDrop)
class AvaloqFeedDropAdmin(admin.ModelAdmin):
    list_display = ("file_name", "business_date", "custodian", "status",
                    "received_at", "ingest_completed_at")
    list_filter = ("status", "custodian")
    search_fields = ("file_name", "sha256")
    raw_id_fields = ("custodian", "cash_feed_import", "received_by")
    readonly_fields = ("sha256", "file_counts", "error_log",
                       "received_at", "ingest_started_at", "ingest_completed_at")
    date_hierarchy = "business_date"


@admin.register(ReconciliationBreak)
class ReconciliationBreakAdmin(admin.ModelAdmin):
    list_display = ("created_at", "drop", "portfolio", "break_type",
                    "isin", "resolved")
    list_filter = ("break_type", "resolved")
    search_fields = ("isin", "detail", "bank_value", "beakon_value")
    raw_id_fields = ("drop", "portfolio", "resolved_by")
