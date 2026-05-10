from django.contrib import admin

from .models import Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = (
        "title", "category", "entity", "employee",
        "size_bytes", "uploaded_by", "uploaded_at", "is_deleted",
    )
    list_filter = ("category", "is_deleted", "entity")
    search_fields = ("title", "description", "original_filename")
    raw_id_fields = ("entity", "employee", "uploaded_by", "deleted_by")
    readonly_fields = (
        "original_filename", "content_type", "size_bytes", "content_hash",
        "uploaded_at", "deleted_at",
    )
