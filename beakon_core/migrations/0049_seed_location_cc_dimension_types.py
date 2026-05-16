"""Seed the LOCATION and CC (Cost Centre) DimensionType + Dimension_Type_Code
controlled-list entries for every organisation that already has the workbook
dimension types loaded.

Driven by Thomas's 2026-05-12 directive — the Dimensions hub already lists
axes generically, but he wants dedicated detail screens for Location and
Cost Centre. Both axes need their DimensionType seeded first so the hub
counts and the detail pages have something to render.

Mirrors migration 0027 (PEN) so future workbook imports don't fight us.
Reverse: drop the LOCATION + CC rows we created.
"""
from django.db import migrations


LOCATION_DIM = {
    "code": "LOCATION",
    "name": "Location",
    "description": "Geographic or premises classification — country, city, "
                   "building, site. Drives location-based reporting and "
                   "cost allocation.",
    "applies_to": "REPORTING,COST_ALLOCATION",
    "mandatory_flag": False,
    "multi_select_allowed": False,
    "master_data_owner": "Finance",
    "hierarchy_allowed": True,
    "active_flag": True,
    "notes": "Seeded by migration 0049 — Location dimension scaffold.",
}

CC_DIM = {
    "code": "CC",
    "name": "Cost Centre",
    "description": "Department, team, or activity bucket used for internal "
                   "cost allocation and management reporting.",
    "applies_to": "REPORTING,COST_ALLOCATION,BUDGETING",
    "mandatory_flag": False,
    "multi_select_allowed": False,
    "master_data_owner": "Finance",
    "hierarchy_allowed": True,
    "active_flag": True,
    "notes": "Seeded by migration 0049 — Cost Centre dimension scaffold.",
}

CONTROLLED_LIST_ROWS = [
    {
        "list_name": "Dimension_Type_Code",
        "list_code": "LOCATION",
        "list_value": "Location",
        "display_order": 23,
        "active_flag": True,
        "description": "Location dimension code — seeded with the Location master scaffold.",
        "notes": "",
    },
    {
        "list_name": "Dimension_Type_Code",
        "list_code": "CC",
        "list_value": "Cost Centre",
        "display_order": 24,
        "active_flag": True,
        "description": "Cost Centre dimension code — seeded with the Cost Centre master scaffold.",
        "notes": "",
    },
]


def _seed(apps, dim):
    DimensionType = apps.get_model("beakon_core", "DimensionType")
    Organization = apps.get_model("organizations", "Organization")
    for org in Organization.objects.all():
        # Only seed orgs that already have the workbook dimensions loaded.
        # Fresh tenants will pick these up from the workbook import once
        # Thomas adds rows to tab 04 (mirrors the PEN seed pattern).
        if not DimensionType.objects.filter(organization=org).exists():
            continue
        DimensionType.objects.update_or_create(
            organization=org,
            code=dim["code"],
            defaults={k: v for k, v in dim.items() if k != "code"},
        )


def _seed_controlled_list(apps, row):
    ControlledListEntry = apps.get_model("beakon_core", "ControlledListEntry")
    Organization = apps.get_model("organizations", "Organization")
    for org in Organization.objects.all():
        # Only orgs that already have Dimension_Type_Code entries; the
        # smoke check keeps the new rows alongside the existing taxonomy.
        if not ControlledListEntry.objects.filter(
            organization=org, list_name="Dimension_Type_Code",
        ).exists():
            continue
        ControlledListEntry.objects.update_or_create(
            organization=org,
            list_name=row["list_name"],
            list_code=row["list_code"],
            defaults={k: v for k, v in row.items()
                      if k not in {"list_name", "list_code"}},
        )


def seed(apps, schema_editor):
    _seed(apps, LOCATION_DIM)
    _seed(apps, CC_DIM)
    for row in CONTROLLED_LIST_ROWS:
        _seed_controlled_list(apps, row)


def unseed(apps, schema_editor):
    DimensionType = apps.get_model("beakon_core", "DimensionType")
    ControlledListEntry = apps.get_model("beakon_core", "ControlledListEntry")
    DimensionType.objects.filter(code__in=["LOCATION", "CC"]).delete()
    ControlledListEntry.objects.filter(
        list_name="Dimension_Type_Code", list_code__in=["LOCATION", "CC"],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("beakon_core", "0048_entity_chart_template_vat_enabled"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
