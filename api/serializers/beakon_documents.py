"""DRF serializers for the Documents module."""
from rest_framework import serializers

from beakon_documents.models import Document


class DocumentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    category_label = serializers.SerializerMethodField()
    uploaded_by_email = serializers.SerializerMethodField()
    entity_code = serializers.SerializerMethodField()
    employee_name = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = (
            "id", "title", "description", "category", "category_label",
            "file", "file_url", "external_url",
            "original_filename", "content_type", "size_bytes", "content_hash",
            "entity", "entity_code",
            "employee", "employee_name",
            "document_date",
            "uploaded_by", "uploaded_by_email", "uploaded_at",
            "is_deleted",
        )
        read_only_fields = (
            "id", "category_label", "file_url",
            "original_filename", "content_type", "size_bytes", "content_hash",
            "entity_code", "employee_name",
            "uploaded_by", "uploaded_by_email", "uploaded_at",
            "is_deleted",
        )

    def get_file_url(self, obj):
        try:
            return obj.file.url if obj.file else ""
        except (ValueError, AttributeError):
            return ""

    def get_category_label(self, obj):
        return obj.get_category_display()

    def get_uploaded_by_email(self, obj):
        return getattr(obj.uploaded_by, "email", "") if obj.uploaded_by_id else ""

    def get_entity_code(self, obj):
        return obj.entity.code if obj.entity_id else ""

    def get_employee_name(self, obj):
        return obj.employee.full_name if obj.employee_id else ""

    def validate(self, attrs):
        # On create, require either a file (in self.initial_data) or
        # an external_url. On update we allow neither — the existing
        # file/url stays.
        if self.instance is None:
            has_file = bool(self.initial_data.get("file") if hasattr(self.initial_data, "get") else None)
            has_url = bool(attrs.get("external_url"))
            if not has_file and not has_url:
                raise serializers.ValidationError(
                    "Provide either a file upload or an external_url."
                )
        return attrs
