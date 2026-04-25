from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("beakon_core", "0008_journalline_dimensions"),
    ]

    operations = [
        migrations.AlterField(
            model_name="entity",
            name="entity_type",
            field=models.CharField(
                default="company",
                help_text="Built-in entity type or an org-defined CustomEntityType value.",
                max_length=50,
            ),
        ),
        migrations.CreateModel(
            name="CustomEntityType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("value", models.SlugField(max_length=50)),
                ("label", models.CharField(max_length=80)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("organization", models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="custom_entity_types", to="organizations.organization")),
            ],
            options={
                "db_table": "beakon_custom_entity_type",
                "ordering": ["label"],
                "unique_together": {("organization", "value")},
            },
        ),
    ]
