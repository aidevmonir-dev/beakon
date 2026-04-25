from django.apps import AppConfig


class BeakonBankingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "beakon_banking"

    def ready(self):
        # Import the signal handlers so they connect to JournalEntry.save.
        from . import signals  # noqa: F401
