from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("organizations", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="selected_activities",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="organization",
            name="ai_infra_consent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
