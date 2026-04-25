from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("organizations", "0001_initial"),
        ("beakon_core", "0006_alter_account_account_subtype_customaccountsubtype"),
    ]

    operations = [
        migrations.CreateModel(
            name="CoADefinition",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("coa_id", models.CharField(max_length=50)),
                ("name", models.CharField(max_length=255)),
                ("coa_type", models.CharField(max_length=50)),
                ("version_no", models.PositiveIntegerField(default=1)),
                ("status", models.CharField(default="Active", max_length=30)),
                ("effective_from", models.DateField(blank=True, null=True)),
                ("effective_to", models.DateField(blank=True, null=True)),
                ("base_currency", models.CharField(default="USD", max_length=3)),
                ("default_reporting_currency", models.CharField(blank=True, max_length=3)),
                ("additional_reporting_currencies", models.CharField(blank=True, help_text="Comma-separated ISO currency codes, e.g. USD,EUR", max_length=255)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="beakon_coa_definitions", to="organizations.organization")),
            ],
            options={
                "db_table": "beakon_coa_definition",
                "ordering": ["coa_type", "version_no", "coa_id"],
                "unique_together": {("organization", "coa_id"), ("organization", "coa_type", "version_no")},
            },
        ),
        migrations.AddField(
            model_name="account",
            name="coa_definition",
            field=models.ForeignKey(blank=True, help_text="Optional versioned CoA this account belongs to.", null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="accounts", to="beakon_core.coadefinition"),
        ),
        migrations.AddIndex(
            model_name="coadefinition",
            index=models.Index(fields=["organization", "status"], name="beakon_coa_organiz_2b2c34_idx"),
        ),
        migrations.AddIndex(
            model_name="coadefinition",
            index=models.Index(fields=["organization", "coa_type"], name="beakon_coa_organiz_1451a2_idx"),
        ),
        migrations.AddIndex(
            model_name="account",
            index=models.Index(fields=["organization", "coa_definition"], name="beakon_acc_organiz_c6bce3_idx"),
        ),
    ]
