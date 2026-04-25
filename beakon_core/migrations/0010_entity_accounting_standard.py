"""Add Entity.accounting_standard.

Per Thomas's WhatsApp 2026-04-25: every entity declares its reporting
framework (IFRS / US GAAP / UK GAAP / Other) so the AI proposal flow
can tailor account suggestions and produce a teaching note that cites
the standard.

Existing rows are backfilled by country: US → US_GAAP, GB → UK_GAAP,
everything else → IFRS. Users can override per entity afterwards.
"""
from django.db import migrations, models


def _backfill(apps, schema_editor):
    Entity = apps.get_model("beakon_core", "Entity")
    for ent in Entity.objects.all().only("id", "country", "accounting_standard"):
        cc = (ent.country or "").upper().strip()
        if cc == "US":
            ent.accounting_standard = "us_gaap"
        elif cc == "GB":
            ent.accounting_standard = "uk_gaap"
        else:
            ent.accounting_standard = "ifrs"
        ent.save(update_fields=["accounting_standard"])


def _noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("beakon_core", "0009_customentitytype_and_entity_type_flex"),
    ]

    operations = [
        migrations.AddField(
            model_name="entity",
            name="accounting_standard",
            field=models.CharField(
                choices=[
                    ("ifrs", "IFRS — International Financial Reporting Standards"),
                    ("us_gaap", "US GAAP — United States Generally Accepted Accounting Principles"),
                    ("uk_gaap", "UK GAAP — FRS 102 / FRS 105"),
                    ("other", "Other / local standard (AI defaults to IFRS-equivalent)"),
                ],
                default="ifrs",
                help_text=(
                    "Reporting framework this entity's books follow. Drives both how "
                    "the AI proposes journal entries (booking conventions) and the "
                    "teaching note shown alongside each proposal."
                ),
                max_length=20,
            ),
        ),
        migrations.RunPython(_backfill, _noop),
    ]
