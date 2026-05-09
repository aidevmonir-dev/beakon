"""Promote workbook governance metadata into dedicated Account columns.

The 02 CoA Master workbook tab carries 35 columns. The Account model
historically mapped ~22 to dedicated fields and preserved the rest in a
``workbook_metadata`` JSON column. This command promotes the 9 governance
fields the engine reads at posting / valuation time:

    Economic_Nature, Client_View_Category, Subledger_Required,
    Subledger_Type, Valuation_Basis, Allow_Foreign_Currency_Posting,
    FX_Remeasure_Flag, FX_Gain_Loss_Bucket, Historical_vs_Closing_Rate_Method

After promotion, the engine can query e.g. ``Account.subledger_type ==
"INVESTMENT"`` directly instead of unpacking JSON.

Workbook hygiene: many rows have shifted columns where a value lands in
the wrong cell (e.g. ``FX_Revalue_Flag = 'INST CUST PORT and CCY mandatory'``).
This command validates each value against a known controlled vocabulary
per column; off-vocab values are silently skipped, leaving the column
blank for the row. The raw value remains in ``workbook_metadata`` so
nothing is lost.

Usage:
    python manage.py promote_account_metadata [--organization-id ID] [--dry-run]
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from beakon_core.models import Account
from organizations.models import Organization


# Column → (Account field, vocabulary). Empty vocab means "any string".
ECONOMIC_NATURES = {
    "BALANCE_SHEET", "ACCRUAL", "PORTFOLIO_ASSET", "RELATED_PARTY_BALANCE",
    "SETTLEMENT", "IMPAIRMENT", "CAPITAL_MOVEMENT", "CLEARING", "TAX",
    "PREPAYMENT", "VALUATION_MOVEMENT", "PERFORMANCE",
}

CLIENT_VIEW_CATEGORIES = {
    "LIQUIDITY", "RECEIVABLES", "QUOTED_INVESTMENTS", "PRIVATE_INVESTMENTS",
    "ALTERNATIVES", "REAL_ASSETS", "DIGITAL_ASSETS",
    "RELATED_PARTIES", "PERSONAL_ASSETS", "PREPAYMENTS",
    "CONTROLS", "TRANSFERS", "TAX", "EDUCATION", "HOUSING",
    "PROFESSIONAL_FEES", "INSURANCE", "OTHER_ASSETS", "NET_WORTH",
    "PERFORMANCE",
}

SUBLEDGER_TYPES = {
    "NONE", "BANK", "INVESTMENT", "RELATED_PARTY", "COUNTERPARTY",
    "PROPERTY", "FIXED_ASSET",
}

VALUATION_BASES = {
    "NA", "FVPL", "FAIR_VALUE", "AMORTIZED_COST", "COST", "HISTORICAL",
}

FX_REMEASURE_FLAGS = {"YES", "NO", "BY_VALUATION_METHOD"}

FX_GAIN_LOSS_BUCKETS = {
    "NA", "UNREALIZED_FX", "COMBINED_REALIZED_UNREALIZED", "FAIR_VALUE_FX",
}

HIST_RATE_METHODS = {
    "NA", "CLOSING", "AVERAGE", "HISTORICAL", "FAIR_VALUE",
    "BY_VALUATION_METHOD",
}


class Command(BaseCommand):
    help = "Promote 9 governance fields from Account.workbook_metadata to columns."

    def add_arguments(self, parser):
        parser.add_argument("--organization-id", type=int)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        org = _resolve_organization(options.get("organization_id"))

        stats = {
            "total_accounts": 0,
            "promoted_economic_nature": 0,
            "promoted_client_view_category": 0,
            "promoted_subledger_required": 0,
            "promoted_subledger_type": 0,
            "promoted_valuation_basis": 0,
            "promoted_allow_foreign_currency_posting": 0,
            "promoted_fx_remeasure_flag": 0,
            "promoted_fx_gain_loss_bucket": 0,
            "promoted_historical_vs_closing_rate_method": 0,
            "skipped_offvocab_values": 0,
        }

        offvocab_examples: dict[str, set[str]] = {}

        with transaction.atomic():
            for account in Account.objects.filter(organization=org).iterator():
                stats["total_accounts"] += 1
                meta = account.workbook_metadata or {}
                changed_fields: list[str] = []

                # Economic_Nature
                v = _vocab(meta.get("Economic_Nature"), ECONOMIC_NATURES)
                if v:
                    if account.economic_nature != v:
                        account.economic_nature = v
                        changed_fields.append("economic_nature")
                    stats["promoted_economic_nature"] += 1
                elif meta.get("Economic_Nature"):
                    _record_offvocab(offvocab_examples, "Economic_Nature", meta["Economic_Nature"])
                    stats["skipped_offvocab_values"] += 1

                # Client_View_Category — accept anything alphanumeric short
                v = _strip_short(meta.get("Client_View_Category"), max_len=60)
                if v:
                    if account.client_view_category != v:
                        account.client_view_category = v
                        changed_fields.append("client_view_category")
                    stats["promoted_client_view_category"] += 1

                # Subledger_Required (Yes/No)
                v = _yesno(meta.get("Subledger_Required"))
                if v is not None:
                    if account.subledger_required != v:
                        account.subledger_required = v
                        changed_fields.append("subledger_required")
                    stats["promoted_subledger_required"] += 1

                # Subledger_Type
                v = _vocab(meta.get("Subledger_Type"), SUBLEDGER_TYPES)
                if v:
                    if account.subledger_type != v:
                        account.subledger_type = v
                        changed_fields.append("subledger_type")
                    stats["promoted_subledger_type"] += 1
                elif meta.get("Subledger_Type"):
                    _record_offvocab(offvocab_examples, "Subledger_Type", meta["Subledger_Type"])
                    stats["skipped_offvocab_values"] += 1

                # Valuation_Basis
                v = _vocab(meta.get("Valuation_Basis"), VALUATION_BASES)
                if v:
                    if account.valuation_basis != v:
                        account.valuation_basis = v
                        changed_fields.append("valuation_basis")
                    stats["promoted_valuation_basis"] += 1
                elif meta.get("Valuation_Basis"):
                    _record_offvocab(offvocab_examples, "Valuation_Basis", meta["Valuation_Basis"])
                    stats["skipped_offvocab_values"] += 1

                # Allow_Foreign_Currency_Posting (Yes/No)
                v = _yesno(meta.get("Allow_Foreign_Currency_Posting"))
                if v is not None:
                    if account.allow_foreign_currency_posting != v:
                        account.allow_foreign_currency_posting = v
                        changed_fields.append("allow_foreign_currency_posting")
                    stats["promoted_allow_foreign_currency_posting"] += 1

                # FX_Remeasure_Flag — Yes/No/BY_VALUATION_METHOD
                v = _vocab(_normalize_flag(meta.get("FX_Remeasure_Flag")), FX_REMEASURE_FLAGS)
                if v:
                    if account.fx_remeasure_flag != v:
                        account.fx_remeasure_flag = v
                        changed_fields.append("fx_remeasure_flag")
                    stats["promoted_fx_remeasure_flag"] += 1

                # FX_Gain_Loss_Bucket
                v = _vocab(meta.get("FX_Gain_Loss_Bucket"), FX_GAIN_LOSS_BUCKETS)
                if v:
                    if account.fx_gain_loss_bucket != v:
                        account.fx_gain_loss_bucket = v
                        changed_fields.append("fx_gain_loss_bucket")
                    stats["promoted_fx_gain_loss_bucket"] += 1
                elif meta.get("FX_Gain_Loss_Bucket"):
                    _record_offvocab(offvocab_examples, "FX_Gain_Loss_Bucket", meta["FX_Gain_Loss_Bucket"])
                    stats["skipped_offvocab_values"] += 1

                # Historical_vs_Closing_Rate_Method
                v = _vocab(meta.get("Historical_vs_Closing_Rate_Method"), HIST_RATE_METHODS)
                if v:
                    if account.historical_vs_closing_rate_method != v:
                        account.historical_vs_closing_rate_method = v
                        changed_fields.append("historical_vs_closing_rate_method")
                    stats["promoted_historical_vs_closing_rate_method"] += 1
                elif meta.get("Historical_vs_Closing_Rate_Method"):
                    _record_offvocab(offvocab_examples, "Historical_vs_Closing_Rate_Method",
                                     meta["Historical_vs_Closing_Rate_Method"])
                    stats["skipped_offvocab_values"] += 1

                if changed_fields:
                    account.save(update_fields=changed_fields)

            if options["dry_run"]:
                transaction.set_rollback(True)

        prefix = "DRY RUN" if options["dry_run"] else "Promoted"
        self.stdout.write(self.style.SUCCESS(
            f"{prefix} Account metadata for org {org.id} ({org.name})"
        ))
        for k, v in stats.items():
            self.stdout.write(f"  {k}: {v}")
        if offvocab_examples:
            self.stdout.write(self.style.WARNING(
                f"\nOff-vocab values rejected (sample of 5 per column):"
            ))
            for col, samples in offvocab_examples.items():
                self.stdout.write(f"  {col}: {sorted(samples)[:5]}")


def _resolve_organization(organization_id: int | None) -> Organization:
    if organization_id:
        try:
            return Organization.objects.get(id=organization_id)
        except Organization.DoesNotExist as exc:
            raise CommandError(f"Organization id {organization_id} does not exist.") from exc

    orgs = list(Organization.objects.all()[:2])
    if not orgs:
        raise CommandError("No Organization exists.")
    if len(orgs) > 1:
        raise CommandError("Multiple organizations exist. Pass --organization-id.")
    return orgs[0]


def _vocab(raw, allowed: set[str]) -> str:
    """Return the value if it sits in the controlled vocabulary, else empty."""
    if raw is None:
        return ""
    s = str(raw).strip().upper()
    return s if s in allowed else ""


def _yesno(raw):
    """Parse a Yes/No flag. Return None if the value is anything else."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if s in {"yes", "y", "true", "1"}:
        return True
    if s in {"no", "n", "false", "0"}:
        return False
    return None


def _normalize_flag(raw):
    """Some workbook flags use 'BY_VALUATION_METHOD' instead of Yes/No."""
    if raw is None:
        return raw
    return str(raw).strip().upper()


def _strip_short(raw, *, max_len: int) -> str:
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s or len(s) > max_len:
        return ""
    # Reject strings that are clearly free-text (contain spaces beyond
    # underscored controlled-list values).
    if " " in s and "_" not in s:
        return ""
    return s.upper() if all(c.isalnum() or c == "_" for c in s) else ""


def _record_offvocab(store: dict[str, set[str]], col: str, value):
    s = str(value).strip()[:60]
    store.setdefault(col, set()).add(s)
