"""seed_disbursements — populate the Disbursements page with realistic data.

Creates a multi-client, multi-currency portfolio of pending rebillable
journal lines so the Disbursements page demonstrates its grouping,
filtering, and per-client subtotals end-to-end.

Idempotent — safe to re-run. Skips lines that already exist (matched by
JE memo + account + amount). Builds on the entity / accounts seeded by
``seed_engine_demo`` (run that first if the demo entity is missing).

Creates:

  - 3 client dimension values (ACME-INC, SMITH-FAM, JONES-CO).
  - 3 customer records with the same codes so the drawer auto-picks
    the right customer when the operator selects a client's lines.
  - 7 posted JEs across April 2026:
      ACME-INC: 4 lines in USD (DHL courier, taxi, FedEx, document fees)
      SMITH-FAM: 2 lines in EUR (legal courier, notary fee)
      JONES-CO: 1 line in USD (postage)

Usage:
  python manage.py seed_disbursements                     # uses first org + demo entity
  python manage.py seed_disbursements --org-id 1
  python manage.py seed_disbursements --reset             # remove demo rebillables first
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from beakon_core.models import (
    Account, Customer, DimensionType, DimensionValue, Entity, JournalEntry,
)
from beakon_core.services import JournalService
from organizations.models import Organization

User = get_user_model()


DEMO_ENTITY_CODE = "DEMO-CO"
SEED_TAG = "[disbursements-seed]"


# (client_code, client_name, default_currency, payment_terms)
CLIENTS = [
    ("ACME-INC", "ACME Industries Inc.", "USD", 30),
    ("SMITH-FAM", "Smith Family Office", "EUR", 14),
    ("JONES-CO", "Jones & Co LLP", "USD", 30),
]

# Lines: (client_code, je_date, currency, amount, memo, line_description)
LINES = [
    # ACME — 4 USD lines, posted across mid-April
    ("ACME-INC", date(2026, 4, 6),  "USD", Decimal("245.00"),
     "DHL shipment for ACME — board pack",            "DHL passthrough"),
    ("ACME-INC", date(2026, 4, 9),  "USD", Decimal("78.50"),
     "Taxi to ACME counsel meeting",                  "Taxi reimbursable"),
    ("ACME-INC", date(2026, 4, 14), "USD", Decimal("420.00"),
     "FedEx priority — ACME closing binder",          "FedEx priority"),
    ("ACME-INC", date(2026, 4, 22), "USD", Decimal("125.00"),
     "Notarisation fees — ACME share transfer",       "Document fees"),
    # Smith — 2 EUR lines
    ("SMITH-FAM", date(2026, 4, 11), "EUR", Decimal("180.00"),
     "Courier — Smith family trust documents",        "Legal courier"),
    ("SMITH-FAM", date(2026, 4, 18), "EUR", Decimal("95.00"),
     "Notary fee — Smith mortgage refinance",         "Notary fee"),
    # Jones — 1 USD line
    ("JONES-CO", date(2026, 4, 16), "USD", Decimal("62.30"),
     "Postage — Jones quarterly statements",          "Postage"),
]


class Command(BaseCommand):
    help = "Populate the Disbursements page with multi-client demo data."

    def add_arguments(self, parser):
        parser.add_argument("--org-id", type=int,
                            help="Organization id (defaults to first).")
        parser.add_argument("--reset", action="store_true",
                            help="Delete prior disbursements-seed lines first.")

    def handle(self, *args, **opts):
        org = self._resolve_org(opts.get("org_id"))
        admin, approver = self._resolve_users()
        self.stdout.write(
            f"\n>> Seeding disbursements into {org.name} (id={org.id}). "
            f"Submit-by: {admin.email} | approve-by: {approver.email}\n",
        )

        entity = self._resolve_entity(org)
        rebillable_acct = self._resolve_rebillable_account(org, entity)
        bank_acct = self._resolve_bank_account(org, entity)

        if opts.get("reset"):
            self._wipe(org)

        with transaction.atomic():
            client_dvs = self._dimensions_and_customers(org)

            created = 0
            skipped = 0
            for client_code, je_date, ccy, amount, memo, desc in LINES:
                client_dv = client_dvs[client_code]
                full_memo = f"{SEED_TAG} {memo}"

                # Idempotency: skip if a JE with this exact memo already exists.
                existing = JournalEntry.objects.filter(
                    organization=org, entity=entity, memo=full_memo,
                ).first()
                if existing:
                    skipped += 1
                    continue

                je = JournalService.create_draft(
                    organization=org, entity=entity, date=je_date,
                    currency=ccy,
                    memo=full_memo,
                    lines=[
                        {"account_id": rebillable_acct.id,
                         "debit": amount, "currency": ccy,
                         "description": desc},
                        {"account_id": bank_acct.id,
                         "credit": amount, "currency": ccy,
                         "description": desc},
                    ],
                    user=admin,
                )
                # Tag the expense line as rebillable + assign client
                eline = je.lines.filter(account=rebillable_acct).first()
                eline.is_rebillable = True
                eline.rebill_client_dimension_value = client_dv
                eline.save(update_fields=[
                    "is_rebillable", "rebill_client_dimension_value",
                ])
                JournalService.submit_for_approval(je, user=admin)
                JournalService.approve(je, user=approver)
                JournalService.post(je, user=approver)
                created += 1

        self.stdout.write(self.style.SUCCESS(
            f"\nOK: {created} new rebillable line(s) posted, {skipped} already present."
        ))
        self.stdout.write(
            "Open /dashboard/disbursements to see them grouped by client.\n"
        )

    # ── Resolve fixtures ───────────────────────────────────────────────

    def _resolve_org(self, org_id: Optional[int]) -> Organization:
        if org_id:
            try:
                return Organization.objects.get(id=org_id)
            except Organization.DoesNotExist as e:
                raise CommandError(f"Organization {org_id} not found") from e
        org = Organization.objects.order_by("id").first()
        if org is None:
            raise CommandError(
                "No organizations exist. Create one and re-run seed_engine_demo first.",
            )
        return org

    def _resolve_users(self) -> tuple:
        admin = User.objects.filter(is_superuser=True).order_by("id").first()
        if admin is None:
            raise CommandError(
                "No superuser found. Create one with createsuperuser first.",
            )
        approver = (User.objects.exclude(id=admin.id)
                    .order_by("id").first()) or admin
        return admin, approver

    def _resolve_entity(self, org) -> Entity:
        try:
            return Entity.objects.get(organization=org, code=DEMO_ENTITY_CODE)
        except Entity.DoesNotExist as e:
            raise CommandError(
                f"Entity '{DEMO_ENTITY_CODE}' not found. "
                "Run `python manage.py seed_engine_demo` first.",
            ) from e

    def _resolve_rebillable_account(self, org, entity) -> Account:
        # Prefer the dedicated 6200 from seed_engine_demo, fall back to any expense.
        acct = Account.objects.filter(
            organization=org, entity=entity, code="6200",
        ).first()
        if acct:
            return acct
        acct = Account.objects.filter(
            organization=org, entity=entity, account_type="expense",
            is_active=True, posting_allowed=True,
        ).order_by("code").first()
        if acct is None:
            raise CommandError(
                "No expense account on the demo entity. "
                "Run `python manage.py seed_engine_demo` first.",
            )
        return acct

    def _resolve_bank_account(self, org, entity) -> Account:
        acct = Account.objects.filter(
            organization=org, entity=entity, code="1010",
        ).first()
        if acct:
            return acct
        acct = Account.objects.filter(
            organization=org, entity=entity, account_subtype="bank",
            is_active=True, posting_allowed=True,
        ).order_by("code").first()
        if acct is None:
            raise CommandError(
                "No bank account on the demo entity. "
                "Run `python manage.py seed_engine_demo` first.",
            )
        return acct

    def _dimensions_and_customers(self, org) -> dict:
        """Create one CLIENT DimensionType + a DimensionValue and matching
        Customer per client. Returns {client_code: DimensionValue}."""
        client_dt, _ = DimensionType.objects.get_or_create(
            organization=org, code="CLIENT",
            defaults={"name": "Client", "active_flag": True},
        )
        out: dict = {}
        for code, name, ccy, terms in CLIENTS:
            dv, _ = DimensionValue.objects.get_or_create(
                organization=org, dimension_type=client_dt, code=code,
                defaults={"name": name, "active_flag": True},
            )
            # Matching Customer record so the drawer auto-picks by code.
            Customer.objects.get_or_create(
                organization=org, code=code,
                defaults={
                    "name": name,
                    "default_currency": ccy,
                    "default_payment_terms_days": terms,
                    "is_active": True,
                },
            )
            out[code] = dv
        self.stdout.write(
            f"  - Clients ready: {', '.join(c[0] for c in CLIENTS)}",
        )
        return out

    # ── Reset ─────────────────────────────────────────────────────────

    def _wipe(self, org):
        """Remove only the JEs this seed created (matched by SEED_TAG)."""
        qs = JournalEntry.objects.filter(
            organization=org, memo__startswith=SEED_TAG,
        )
        n = qs.count()
        # Delete cascades through JournalLine; rebilled invoice lines are NULL
        # because we never invoiced these in the seed.
        qs.delete()
        self.stdout.write(f"  - Removed {n} prior seeded JE(s)")
