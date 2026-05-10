from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("beakon_core", "0047_plan_organizationsubscription_activationrequest"),
    ]

    operations = [
        migrations.AddField(
            model_name="entity",
            name="chart_template",
            field=models.CharField(
                blank=True,
                choices=[
                    ("", "Not chosen yet"),
                    ("swiss_sme", "Swiss SME"),
                    ("lux_soparfi", "Luxembourg SOPARFI"),
                    ("uk_standard", "UK Standard"),
                    ("uae_standard", "UAE Standard"),
                    ("phase1_universal", "Phase 1 — Universal CoA"),
                ],
                default="",
                help_text=(
                    "Chart-of-accounts template chosen during Accounting Setup "
                    "(Swiss SME / Luxembourg SOPARFI / UK Standard / UAE Standard / "
                    "Phase 1 Universal). The chart itself is loaded via existing CoA "
                    "tooling; this field captures the entity's intended template."
                ),
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="entity",
            name="vat_enabled",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Whether this entity registers VAT and posts to VAT control "
                    "accounts. Drives whether tax-code pickers appear on bills, "
                    "invoices and journal entries for this entity."
                ),
            ),
        ),
    ]
