"""DRF serializers for Employment."""
from rest_framework import serializers

from beakon_employment.models import Employee


class EmployeeSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    employment_type_label = serializers.SerializerMethodField()
    entity_code = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    user_email = serializers.SerializerMethodField()
    report_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Employee
        fields = (
            "id",
            "employee_number", "full_name",
            "first_name", "last_name", "email", "phone",
            "title", "employment_type", "employment_type_label",
            "entity", "entity_code",
            "user", "user_email",
            "manager", "manager_name",
            "start_date", "end_date",
            "notes", "is_active",
            "report_count",
            "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "full_name", "employment_type_label", "entity_code",
            "manager_name", "user_email", "report_count",
            "created_at", "updated_at",
        )

    def get_employment_type_label(self, obj):
        return obj.get_employment_type_display()

    def get_entity_code(self, obj):
        return obj.entity.code if obj.entity_id else ""

    def get_manager_name(self, obj):
        return obj.manager.full_name if obj.manager_id else ""

    def get_user_email(self, obj):
        return getattr(obj.user, "email", "") if obj.user_id else ""
