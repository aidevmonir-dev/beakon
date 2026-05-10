"""Backfill `selected_activities` for orgs that pre-date the activity model.

When the home launcher (per the UI philosophy doc, 2026-05-10) renders
tiles, it filters by `Organization.selected_activities`. New orgs pick
their activities during onboarding, but existing orgs default to an
empty list and would lose all activity-gated tiles.

This data migration backfills any org with an empty list to the full
set, preserving the previous behaviour where every module is visible.
Forward-only — no reverse, since we can't tell backfilled rows from
ones a user genuinely chose to fill in this way.
"""
from django.db import migrations


ALL_ACTIVITIES = [
    "structure_management",
    "accounting_finance",
    "travel_expense",
    "employment",
    "wealth_oversight",
    "document_management",
]


def backfill(apps, schema_editor):
    Organization = apps.get_model("organizations", "Organization")
    for org in Organization.objects.all():
        if not org.selected_activities:
            org.selected_activities = list(ALL_ACTIVITIES)
            org.save(update_fields=["selected_activities"])


class Migration(migrations.Migration):

    dependencies = [
        ("organizations", "0002_organization_activities_consent"),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
