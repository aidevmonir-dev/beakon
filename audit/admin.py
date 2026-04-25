from django.contrib import admin

from .models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "action", "object_type", "object_repr", "organization")
    list_filter = ("action", "object_type", "actor_type", "organization")
    search_fields = ("object_repr", "actor__email")
    readonly_fields = (
        "organization", "actor", "actor_type", "action", "object_type",
        "object_id", "object_repr", "changes", "metadata", "ip_address",
        "user_agent", "created_at",
    )
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
