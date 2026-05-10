from django.contrib import admin

from .models import Employee


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = (
        "employee_number", "full_name", "email", "title",
        "entity", "employment_type", "is_active", "start_date",
    )
    list_filter = ("employment_type", "is_active", "entity")
    search_fields = ("employee_number", "first_name", "last_name", "email", "title")
    raw_id_fields = ("user", "manager")
