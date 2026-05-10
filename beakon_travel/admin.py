from django.contrib import admin

from .models import TripClaim, TripExpense


class TripExpenseInline(admin.TabularInline):
    model = TripExpense
    extra = 0
    fields = (
        "date", "category", "merchant", "description",
        "amount", "currency", "amount_in_claim_currency",
        "billable_to_client",
    )


@admin.register(TripClaim)
class TripClaimAdmin(admin.ModelAdmin):
    list_display = (
        "title", "entity", "created_by", "status",
        "currency", "submitted_at", "approved_at", "reimbursed_at",
    )
    list_filter = ("status", "currency", "entity")
    search_fields = ("title", "purpose", "destination", "created_by__email")
    inlines = [TripExpenseInline]
    readonly_fields = (
        "created_at", "updated_at",
        "submitted_at", "approved_at", "rejected_at", "reimbursed_at",
    )


@admin.register(TripExpense)
class TripExpenseAdmin(admin.ModelAdmin):
    list_display = (
        "claim", "date", "category", "merchant",
        "amount", "currency", "amount_in_claim_currency",
        "billable_to_client",
    )
    list_filter = ("category", "currency", "billable_to_client")
    search_fields = ("merchant", "description", "claim__title")
