from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("beakon_core", "0007_coadefinition_account_coa_definition"),
    ]

    operations = [
        migrations.AddField(
            model_name="journalline",
            name="dimension_asset_class_code",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="journalline",
            name="dimension_bank_code",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="journalline",
            name="dimension_custodian_code",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="journalline",
            name="dimension_instrument_code",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="journalline",
            name="dimension_maturity_code",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="journalline",
            name="dimension_portfolio_code",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="journalline",
            name="dimension_strategy_code",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddIndex(
            model_name="journalline",
            index=models.Index(fields=["journal_entry", "dimension_bank_code"], name="beakon_jou_journal_cf9719_idx"),
        ),
        migrations.AddIndex(
            model_name="journalline",
            index=models.Index(fields=["journal_entry", "dimension_custodian_code"], name="beakon_jou_journal_01fdfd_idx"),
        ),
        migrations.AddIndex(
            model_name="journalline",
            index=models.Index(fields=["journal_entry", "dimension_portfolio_code"], name="beakon_jou_journal_93ba3c_idx"),
        ),
        migrations.AddIndex(
            model_name="journalline",
            index=models.Index(fields=["journal_entry", "dimension_instrument_code"], name="beakon_jou_journal_370f97_idx"),
        ),
    ]
