"""Seed DimensionType.category with explicit values for Beakon's known
codes. The previous migration (0045) used a code/name heuristic that
landed most rows in 'other' for real Beakon data; this one applies the
intentional classification per Thomas's voice memo (2026-05-10):

    financial   → drives the GL itself (subaccounts only — those live in
                  CoA, not as a DimensionType row).
    operational → tag transactions for internal reporting (counterparty
                  masters, investment positions, strategies).
    reporting   → slice the books for management or external views
                  (taxonomies — asset class, maturity, jurisdiction,
                  report category, restriction, transfer type).
    other       → CCY and any axis Beakon hasn't explicitly classified.

Adding a new DimensionType code? Add it to the right bucket below or
default behaviour will leave it in 'other' and Thomas will need to edit
the row in the UI to slot it into the hub correctly.
"""
from django.db import migrations


OPERATIONAL_CODES = {
    # Counterparty masters — "who" of a transaction
    "BANK", "CUST", "CP", "CLIENT", "DEMO_CLIENT", "FAM", "RP",
    # Investment positions / contracts — "what / where" of an exposure
    "INST", "PORT", "TLOT", "POL", "LOAN", "COM", "PROP", "WAL",
    "OPEN_ORDER", "PEN",
    # Strategy — operational slicer
    "STR",
}

REPORTING_CODES = {
    # Reporting taxonomies — "how is this rolled up"
    "ACL", "MAT", "JUR", "RCAT", "RST", "TRF",
}


def seed_categories(apps, schema_editor):
    DimensionType = apps.get_model("beakon_core", "DimensionType")
    for dt in DimensionType.objects.all():
        code = (dt.code or "").upper()
        if code in OPERATIONAL_CODES:
            target = "operational"
        elif code in REPORTING_CODES:
            target = "reporting"
        else:
            # Leave existing classification — covers anything custom,
            # plus CCY and anything else not in our maps.
            continue
        if dt.category != target:
            dt.category = target
            dt.save(update_fields=["category"])


def reverse_noop(apps, schema_editor):
    return


class Migration(migrations.Migration):

    dependencies = [
        ('beakon_core', '0045_dimensiontype_category'),
    ]

    operations = [
        migrations.RunPython(seed_categories, reverse_noop),
    ]
