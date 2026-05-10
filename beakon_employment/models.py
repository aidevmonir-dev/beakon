"""Employment — canonical employee master.

Per the UI philosophy doc (2026-05-10), Data Architecture Philosophy:

    "Data lives once. Modules reference it.
       Employee data lives in Employment.
       Accounting references employees as dimensions.
       Travel Expense Management references employees.
       Reporting aggregates all modules.
       Avoid duplicate tables."

So this app owns the canonical row for any human in the workspace —
employees, contractors, interns. Other modules (Travel, Accounting
dimensions, Documents) reference an Employee row rather than carrying
their own copy of name / email / role.

The optional `user` link maps an Employee to a Beakon login (an
`accounts.User`). Not every employee needs an account (e.g. a
contractor who only ever submits paper expense reports), and not every
user is an employee (the org owner may be a User without an Employee
row), so the relationship is nullable on both sides.
"""
from django.conf import settings
from django.db import models

from beakon_core.models.core import Entity
from organizations.models import Organization


# ── Employment-type constants ────────────────────────────────────────


EMPLOYMENT_TYPE_FULL_TIME = "full_time"
EMPLOYMENT_TYPE_PART_TIME = "part_time"
EMPLOYMENT_TYPE_CONTRACTOR = "contractor"
EMPLOYMENT_TYPE_INTERN = "intern"
EMPLOYMENT_TYPE_OTHER = "other"

EMPLOYMENT_TYPE_CHOICES = [
    (EMPLOYMENT_TYPE_FULL_TIME, "Full-time"),
    (EMPLOYMENT_TYPE_PART_TIME, "Part-time"),
    (EMPLOYMENT_TYPE_CONTRACTOR, "Contractor"),
    (EMPLOYMENT_TYPE_INTERN, "Intern"),
    (EMPLOYMENT_TYPE_OTHER, "Other"),
]


class Employee(models.Model):
    """A person employed (or contracted) by an entity in the org."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="employees",
    )
    entity = models.ForeignKey(
        Entity, on_delete=models.PROTECT, related_name="employees",
        help_text="The entity that employs this person.",
    )
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="employee_profile",
        help_text="Beakon login linked to this employee. Optional — not "
                  "every employee has an account.",
    )

    employee_number = models.CharField(
        max_length=30,
        help_text="Unique short identifier within the organization. "
                  "Auto-generated from name when not supplied.",
    )
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)

    title = models.CharField(
        max_length=150, blank=True,
        help_text="Job title — e.g. 'Senior Accountant', 'CFO', 'Trainee'.",
    )
    employment_type = models.CharField(
        max_length=20,
        choices=EMPLOYMENT_TYPE_CHOICES,
        default=EMPLOYMENT_TYPE_FULL_TIME,
    )

    manager = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reports",
    )

    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(
        null=True, blank=True,
        help_text="Date employment ended. Leave blank for active employees.",
    )

    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_employee"
        ordering = ["last_name", "first_name"]
        unique_together = (("organization", "employee_number"),)
        indexes = [
            models.Index(fields=["organization", "is_active"]),
            models.Index(fields=["organization", "entity"]),
        ]

    def __str__(self):
        return f"{self.full_name} ({self.employee_number})"

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.email or self.employee_number
