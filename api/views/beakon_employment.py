"""Employment API.

  /api/v1/beakon/employees/         — list, create
  /api/v1/beakon/employees/<id>/    — retrieve, update, delete
"""
from django.db.models import Count
from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from api.mixins import OrganizationFilterMixin
from api.permissions import IsOrganizationMember
from api.serializers.beakon_employment import EmployeeSerializer
from beakon_employment.models import Employee


class EmployeeViewSet(OrganizationFilterMixin, ModelViewSet):
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    serializer_class = EmployeeSerializer
    queryset = (
        Employee.objects
        .select_related("entity", "manager", "user")
        .annotate(report_count=Count("reports"))
    )
    filterset_fields = ["entity", "employment_type", "is_active"]
    search_fields = ["employee_number", "first_name", "last_name", "email", "title"]
    ordering_fields = ["last_name", "first_name", "employee_number", "start_date", "created_at"]

    def perform_create(self, serializer):
        validated = dict(serializer.validated_data)
        if not validated.get("employee_number"):
            validated["employee_number"] = _next_employee_number(
                self.request.organization,
                validated.get("first_name", ""),
                validated.get("last_name", ""),
            )
        serializer.save(
            organization=self.request.organization,
            employee_number=validated["employee_number"],
        )


def _next_employee_number(organization, first_name: str, last_name: str) -> str:
    """Generate a short employee number like 'AB-042'.

    Two letters from the name + a sequential suffix scoped to the
    organization. Falls back to 'EMP-NNN' if the name is empty.
    """
    initials = (
        ((first_name or "").strip()[:1] + (last_name or "").strip()[:1]) or "EMP"
    ).upper()
    existing = (
        Employee.objects
        .filter(organization=organization, employee_number__startswith=f"{initials}-")
        .count()
    )
    return f"{initials}-{existing + 1:03d}"
