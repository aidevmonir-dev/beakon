"""Seed the PEN (Pension) DimensionType + Dimension_Type_Code controlled-list
entry for every organization that already has the workbook-loaded dimension
types. The workbook (`04 Dimensions Reference`) does not yet carry a PEN row —
Thomas flagged pension as a Notes-tab TODO — so the engine needs PEN seeded
in code before it can be used as a posting dimension.

Reverse: drop the PEN rows we created. Other organisations / future workbook
imports remain untouched.
"""
from django.db import migrations


PEN_DIM = {
    "code": "PEN",
    "name": "Pension",
    "description": "Specific pension or retirement-savings record (LPP, Pillar 3a/3b, "
                   "foreign pension, employer DC/DB).",
    "applies_to": "PERSONAL_EXPENSE,REPORTING,COMPLIANCE",
    "mandatory_flag": False,
    "multi_select_allowed": False,
    "master_data_owner": "Finance",
    "hierarchy_allowed": False,
    "active_flag": True,
    "notes": "Seeded by migration 0027 — pension master scaffold. Pending workbook update.",
}

CONTROLLED_LIST_ROW = {
    "list_name": "Dimension_Type_Code",
    "list_code": "PEN",
    "list_value": "Pension",
    "display_order": 22,
    "active_flag": True,
    "description": "Pension dimension code — seeded with the Pension master scaffold.",
    "notes": "",
}


def seed_pen(apps, schema_editor):
    DimensionType = apps.get_model("beakon_core", "DimensionType")
    ControlledListEntry = apps.get_model("beakon_core", "ControlledListEntry")
    Organization = apps.get_model("organizations", "Organization")

    for org in Organization.objects.all():
        # Only seed for organisations that already have the workbook dimensions
        # loaded — fresh tenants will get PEN from a subsequent workbook import
        # once Thomas adds a Pension row to tab 04.
        if not DimensionType.objects.filter(organization=org).exists():
            continue
        DimensionType.objects.update_or_create(
            organization=org,
            code=PEN_DIM["code"],
            defaults={k: v for k, v in PEN_DIM.items() if k != "code"},
        )
        ControlledListEntry.objects.update_or_create(
            organization=org,
            list_name=CONTROLLED_LIST_ROW["list_name"],
            list_code=CONTROLLED_LIST_ROW["list_code"],
            defaults={k: v for k, v in CONTROLLED_LIST_ROW.items()
                      if k not in {"list_name", "list_code"}},
        )


def unseed_pen(apps, schema_editor):
    DimensionType = apps.get_model("beakon_core", "DimensionType")
    ControlledListEntry = apps.get_model("beakon_core", "ControlledListEntry")
    DimensionType.objects.filter(code="PEN").delete()
    ControlledListEntry.objects.filter(
        list_name="Dimension_Type_Code", list_code="PEN",
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("beakon_core", "0026_pension_journalline_dimension_pension_and_more"),
    ]

    operations = [
        migrations.RunPython(seed_pen, unseed_pen),
    ]
