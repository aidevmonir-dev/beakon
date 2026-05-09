"""Resolve cross-master string codes into ForeignKey columns.

Walks every master that carries a workbook string code paired with a
parallel ``ForeignKey`` and looks up the target object by its natural key.
Reports per-column resolved-vs-unresolved counts so workbook data quality
can be addressed in a focused pass.

The masters' import commands also resolve FKs at import time — this
command is for the cross-master batch backfill after a fresh workbook
import, or to re-run after the workbook is corrected.

Usage:
    python manage.py promote_master_fks [--organization-id ID] [--dry-run]
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from beakon_core.models import (
    BankAccountMaster, Counterparty, Custodian, Instrument, Loan,
    Portfolio, Property, RelatedParty, TaxLot,
)
from organizations.models import Organization


class Command(BaseCommand):
    help = "Resolve cross-master string codes into ForeignKey columns."

    def add_arguments(self, parser):
        parser.add_argument("--organization-id", type=int)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        org = _resolve_organization(options.get("organization_id"))

        # Build code -> object lookups once for the whole org.
        portfolios = {p.portfolio_id: p for p in Portfolio.objects.filter(organization=org)}
        custodians = {c.custodian_id: c for c in Custodian.objects.filter(organization=org)}
        instruments = {i.instrument_id: i for i in Instrument.objects.filter(organization=org)}
        related_parties = {r.related_party_id: r for r in RelatedParty.objects.filter(organization=org)}
        counterparties = {c.counterparty_id: c for c in Counterparty.objects.filter(organization=org)}
        properties = {p.property_id: p for p in Property.objects.filter(organization=org)}
        bank_accounts = {b.bank_account_id: b for b in BankAccountMaster.objects.filter(organization=org)}

        report: list[tuple[str, int, int, list[str]]] = []  # (label, resolved, unresolved, samples)

        with transaction.atomic():
            # ── TaxLot ──
            report.append(_resolve_simple(
                "TaxLot.instrument_code -> instrument",
                qs=TaxLot.objects.filter(organization=org).exclude(instrument_code=""),
                code_field="instrument_code", fk_field="instrument", lookup=instruments,
            ))
            report.append(_resolve_simple(
                "TaxLot.portfolio_code -> portfolio",
                qs=TaxLot.objects.filter(organization=org).exclude(portfolio_code=""),
                code_field="portfolio_code", fk_field="portfolio", lookup=portfolios,
            ))
            report.append(_resolve_simple(
                "TaxLot.custodian_code -> custodian",
                qs=TaxLot.objects.filter(organization=org).exclude(custodian_code=""),
                code_field="custodian_code", fk_field="custodian", lookup=custodians,
            ))

            # ── Loan ──
            report.append(_resolve_simple(
                "Loan.reporting_portfolio_code -> reporting_portfolio",
                qs=Loan.objects.filter(organization=org).exclude(reporting_portfolio_code=""),
                code_field="reporting_portfolio_code", fk_field="reporting_portfolio",
                lookup=portfolios,
            ))
            report.append(_resolve_polymorphic(
                "Loan.borrower_or_lender_code -> counterparty/related_party",
                qs=Loan.objects.filter(organization=org).exclude(borrower_or_lender_code=""),
                code_field="borrower_or_lender_code",
                fk_field_cp="borrower_or_lender_counterparty", lookup_cp=counterparties,
                fk_field_rp="borrower_or_lender_related_party", lookup_rp=related_parties,
            ))

            # ── Instrument ──
            report.append(_resolve_simple(
                "Instrument.portfolio_default -> portfolio_default_obj",
                qs=Instrument.objects.filter(organization=org).exclude(portfolio_default=""),
                code_field="portfolio_default", fk_field="portfolio_default_obj",
                lookup=portfolios,
            ))
            report.append(_resolve_simple(
                "Instrument.custodian_default -> custodian_default_obj",
                qs=Instrument.objects.filter(organization=org).exclude(custodian_default=""),
                code_field="custodian_default", fk_field="custodian_default_obj",
                lookup=custodians,
            ))
            report.append(_resolve_polymorphic(
                "Instrument.issuer_or_counterparty_code -> counterparty/related_party",
                qs=Instrument.objects.filter(organization=org).exclude(issuer_or_counterparty_code=""),
                code_field="issuer_or_counterparty_code",
                fk_field_cp="issuer_counterparty", lookup_cp=counterparties,
                fk_field_rp="issuer_related_party", lookup_rp=related_parties,
            ))

            # ── Portfolio ──
            report.append(_resolve_simple(
                "Portfolio.owner_id -> owner_related_party",
                qs=Portfolio.objects.filter(organization=org).exclude(owner_id=""),
                code_field="owner_id", fk_field="owner_related_party",
                lookup=related_parties,
            ))
            report.append(_resolve_simple(
                "Portfolio.primary_related_party_id -> primary_related_party_obj",
                qs=Portfolio.objects.filter(organization=org).exclude(primary_related_party_id=""),
                code_field="primary_related_party_id", fk_field="primary_related_party_obj",
                lookup=related_parties,
            ))
            report.append(_resolve_simple(
                "Portfolio.linked_custodian_id -> linked_custodian_obj",
                qs=Portfolio.objects.filter(organization=org).exclude(linked_custodian_id=""),
                code_field="linked_custodian_id", fk_field="linked_custodian_obj",
                lookup=custodians,
            ))

            # ── Custodian ──
            report.append(_resolve_simple(
                "Custodian.linked_counterparty_id -> linked_counterparty_obj",
                qs=Custodian.objects.filter(organization=org).exclude(linked_counterparty_id=""),
                code_field="linked_counterparty_id", fk_field="linked_counterparty_obj",
                lookup=counterparties,
            ))

            # ── RelatedParty ──
            report.append(_resolve_simple(
                "RelatedParty.default_property_code -> default_property",
                qs=RelatedParty.objects.filter(organization=org).exclude(default_property_code=""),
                code_field="default_property_code", fk_field="default_property",
                lookup=properties,
            ))
            report.append(_resolve_simple(
                "RelatedParty.default_bank_reference -> default_bank_account",
                qs=RelatedParty.objects.filter(organization=org).exclude(default_bank_reference=""),
                code_field="default_bank_reference", fk_field="default_bank_account",
                lookup=bank_accounts,
            ))

            # ── Counterparty ──
            report.append(_resolve_simple(
                "Counterparty.default_bank_reference -> default_bank_account",
                qs=Counterparty.objects.filter(organization=org).exclude(default_bank_reference=""),
                code_field="default_bank_reference", fk_field="default_bank_account",
                lookup=bank_accounts,
            ))

            if options["dry_run"]:
                transaction.set_rollback(True)

        prefix = "DRY RUN" if options["dry_run"] else "Promoted"
        self.stdout.write(self.style.SUCCESS(f"{prefix} master FKs for org {org.id} ({org.name})"))
        self.stdout.write("")
        self.stdout.write(f"  {'column':<58} {'resolved':>9} {'unresolved':>11}")
        for label, resolved, unresolved, samples in report:
            tag = self.style.WARNING(f"{unresolved:>11}") if unresolved else f"{unresolved:>11}"
            self.stdout.write(f"  {label:<58} {resolved:>9} {tag}")
        self.stdout.write("")
        unresolved_total = sum(u for _, _, u, _ in report)
        if unresolved_total:
            self.stdout.write(self.style.WARNING(
                f"{unresolved_total} unresolved code(s) total. "
                "Sample values per column:"
            ))
            for label, _, unresolved, samples in report:
                if unresolved and samples:
                    self.stdout.write(f"  {label}: {samples}")


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


def _resolve_simple(label: str, *, qs, code_field: str, fk_field: str, lookup: dict):
    """Resolve a single string-code column to a single FK column."""
    resolved = 0
    unresolved_samples: set[str] = set()
    fk_id_field = f"{fk_field}_id"
    for obj in qs.iterator():
        code = getattr(obj, code_field) or ""
        if not code:
            continue
        target = lookup.get(code)
        if target is None:
            unresolved_samples.add(code)
            continue
        if getattr(obj, fk_id_field) != target.pk:
            setattr(obj, fk_field, target)
            obj.save(update_fields=[fk_field])
        resolved += 1
    return (label, resolved, len(unresolved_samples), sorted(unresolved_samples)[:5])


def _resolve_polymorphic(label: str, *, qs, code_field: str,
                         fk_field_cp: str, lookup_cp: dict,
                         fk_field_rp: str, lookup_rp: dict):
    """Resolve a code that could point at Counterparty (CP_*) or RelatedParty (RP_*).

    Resolution rule: prefix-based. ``CP_*`` -> counterparty FK; ``RP_*`` →
    related_party FK; anything else is reported as unresolved.
    """
    resolved = 0
    unresolved_samples: set[str] = set()
    cp_id_field = f"{fk_field_cp}_id"
    rp_id_field = f"{fk_field_rp}_id"
    for obj in qs.iterator():
        code = getattr(obj, code_field) or ""
        if not code:
            continue
        target = None
        target_field = None
        if code.startswith("CP_"):
            target = lookup_cp.get(code)
            target_field = fk_field_cp
        elif code.startswith("RP_"):
            target = lookup_rp.get(code)
            target_field = fk_field_rp
        if target is None:
            unresolved_samples.add(code)
            continue
        # Clear the other FK (in case the row's prefix flipped) and set this one.
        other_field = fk_field_rp if target_field == fk_field_cp else fk_field_cp
        other_id = f"{other_field}_id"
        changed = False
        if getattr(obj, f"{target_field}_id") != target.pk:
            setattr(obj, target_field, target)
            changed = True
        if getattr(obj, other_id) is not None:
            setattr(obj, other_field, None)
            changed = True
        if changed:
            obj.save(update_fields=[target_field, other_field])
        resolved += 1
    return (label, resolved, len(unresolved_samples), sorted(unresolved_samples)[:5])
