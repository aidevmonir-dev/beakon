from django.contrib import admin

from .models import BankAccount, BankTransaction, FeedImport


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
