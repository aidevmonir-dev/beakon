"""manage.py train_bank_categorizer
    [--entity CODE] [--all] [--organization-id 1]

Fits the on-device logistic-regression categoriser per entity from every
matched bank transaction whose proposed JE is posted. Writes the joblib
artefact to media/ml/bank_categorizer/<ENTITY>-v1.joblib.

Examples:
    python manage.py train_bank_categorizer --entity THOMAS-HOLD
    python manage.py train_bank_categorizer --all
    python manage.py train_bank_categorizer --organization-id 1 --all
"""
from django.core.management.base import BaseCommand, CommandError

from beakon_core.models import Entity
from beakon_banking.services.ml_categorizer import MLBankCategorizer


class Command(BaseCommand):
    help = "Train the per-entity bank-transaction categoriser from labelled history."

    def add_arguments(self, parser):
        parser.add_argument(
            "--entity", help="Entity code (e.g. THOMAS-HOLD). Mutually exclusive with --all.",
        )
        parser.add_argument(
            "--all", action="store_true",
            help="Train every active entity in the org. Skips entities below "
                 "the minimum-sample threshold (reported in the output).",
        )
        parser.add_argument(
            "--organization-id", type=int,
            help="Restrict to one org. If omitted, the only org is used.",
        )

    def handle(self, *args, **opts):
        entity_code = opts.get("entity")
        train_all = bool(opts.get("all"))
        org_id = opts.get("organization_id")

        if not entity_code and not train_all:
            raise CommandError("Pass --entity CODE or --all.")

        qs = Entity.objects.all()
        if org_id:
            qs = qs.filter(organization_id=org_id)
        if entity_code:
            qs = qs.filter(code=entity_code)
        elif train_all:
            qs = qs.filter(is_active=True)

        entities = list(qs)
        if not entities:
            raise CommandError("No matching entity found.")

        self.stdout.write(f"Training categoriser for {len(entities)} entit"
                          f"{'y' if len(entities) == 1 else 'ies'}...\n")
        for ent in entities:
            result = MLBankCategorizer.train(ent)
            cv = (
                f"cv_acc={result.cv_accuracy:.3f}"
                if result.cv_accuracy is not None else "cv_acc=skipped"
            )
            self.stdout.write(
                f"  {ent.code:<14} samples={result.samples:<4} "
                f"classes={result.classes:<3} {cv:<20} "
                f"{'->' if result.path else '  '} "
                f"{result.path or result.message}"
            )
        self.stdout.write(self.style.SUCCESS("\nDone."))
