"""seed_engine_demo — load a worked example so anyone can demo the engine.

Idempotent — safe to re-run. Creates / refreshes:

  - A clean demo entity (DEMO-CO) on the first organization.
  - A small chart of accounts (clean codes, no required-dim baggage).
  - An April 2026 open period.
  - A Swiss VAT 8.1% TaxCode (CH-VAT-STD).
  - A vendor and a customer.
  - One posted Bill with VAT (DR Expense + DR Input VAT / CR AP).
  - One posted Invoice with VAT (DR AR / CR Revenue + CR Output VAT).
  - One posted rebillable expense (visible in Disbursements).
  - A prepaid-insurance Recognition Rule (Nov 2025 – Apr 2026 schedule).

Usage:
  python manage.py seed_engine_demo                 # uses first org + first user
  python manage.py seed_engine_demo --org-id 1
  python manage.py seed_engine_demo --reset         # wipe demo entity first
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from beakon_core import constants as bc
from beakon_core.models import (
    Account, Currency, Customer, DimensionType, DimensionValue,
    Entity, FXRate, Period, Vendor,
)
from beakon_core.models import RecognitionRule, TaxCode  # noqa: F401
from beakon_core.services import (
    BillService, InvoiceService, JournalService, RecognitionService,
)
from organizations.models import Organization

User = get_user_model()


DEMO_ENTITY_CODE = "DEMO-CO"
DEMO_TAX_CODE = "CH-VAT-STD"
DEMO_RULE_CODE = "DEMO-PREPAID-INS"


class Command(BaseCommand):
    help = "Seed a worked example so the engine is demonstrable in the UI."

    def add_arguments(self, parser):
        parser.add_argument("--org-id", type=int, help="Organization id (defaults to first).")
        parser.add_argument("--reset", action="store_true",
                            help="Delete the demo entity and its rows first.")

    def handle(self, *args, **opts):
        org = self._resolve_org(opts.get("org_id"))
        admin, approver = self._resolve_users()
        self.stdout.write(f"\n>> Seeding into organization {org.name} (id={org.id}). "
                          f"Submit-by: {admin.email} | approve-by: {approver.email}\n")

        if opts.get("reset"):
            self._wipe(org)

        with transaction.atomic():
            entity = self._entity(org)
            accounts = self._accounts(org, entity)
            self._period(entity)
            self._fx_rates()
            tax_code = self._tax_code(org, accounts)
            vendor = self._vendor(org)
            customer = self._customer(org)

            bill_je = self._bill_with_vat(org, entity, vendor, accounts, tax_code, admin, approver)
            inv_je = self._invoice_with_vat(org, entity, customer, accounts, tax_code, admin, approver)
            rebill_je = self._rebillable_expense(org, entity, accounts, admin, approver)
            rule = self._recognition_rule(org, entity, accounts, admin)

        self.stdout.write(self.style.SUCCESS("\nOK: Demo data seeded.\n"))
        self.stdout.write("Try these pages in your browser:\n")
        for path, what in [
            (f"/dashboard/entities/{entity.id}", "the demo entity"),
            (f"/dashboard/journal-entries", "see the posted JEs (3 of them)"),
            (f"/dashboard/bills", "the bill with VAT"),
            (f"/dashboard/invoices", "the invoice with VAT"),
            (f"/dashboard/disbursements", "the rebillable line waiting to be invoiced"),
            (f"/dashboard/recognition", "the prepaid-insurance recognition schedule"),
            (f"/dashboard/reports/vat", "VAT report (Apr 2026)"),
        ]:
            self.stdout.write(f"  - {path}  -- {what}")
        self.stdout.write("")

    # ── Helpers ────────────────────────────────────────────────────

    def _resolve_org(self, org_id):
        qs = Organization.objects.all()
        if org_id:
            try:
                return qs.get(id=org_id)
            except Organization.DoesNotExist:
                raise CommandError(f"Organization id {org_id} not found.")
        org = qs.first()
        if org is None:
            raise CommandError("No organization exists.")
        return org

    def _resolve_users(self):
        users = list(User.objects.order_by("id"))
        if not users:
            raise CommandError("No users in the system. Create one first.")
        admin = users[0]
        if len(users) >= 2:
            approver = users[1]
        else:
            # Make a stub approver so submit-by ≠ approve-by stays satisfied.
            approver = User.objects.create_user(
                email="seed-approver@beakon.local",
                first_name="Demo", last_name="Approver",
                password="x" * 16,
            )
        return admin, approver

    def _wipe(self, org):
        ent = Entity.objects.filter(organization=org, code=DEMO_ENTITY_CODE).first()
        if ent:
            self.stdout.write(f"  - Deleting entity {DEMO_ENTITY_CODE} and its data...")
            ent.delete()
        TaxCode.objects.filter(organization=org, code=DEMO_TAX_CODE).delete()
        RecognitionRule.objects.filter(organization=org, code=DEMO_RULE_CODE).delete()

    def _entity(self, org):
        Currency.objects.get_or_create(code="USD", defaults={"name": "US Dollar"})
        Currency.objects.get_or_create(code="CHF", defaults={"name": "Swiss Franc"})
        ent, created = Entity.objects.update_or_create(
            organization=org, code=DEMO_ENTITY_CODE,
            defaults={
                "name": "Demo Trading Co.",
                "legal_name": "Demo Trading Co. AG",
                "entity_type": bc.ENTITY_COMPANY,
                "functional_currency": "CHF",
                "country": "CH",
                "fiscal_year_start_month": 1,
            },
        )
        self.stdout.write(f"  - Entity {ent.code} {'created' if created else 'refreshed'}")
        return ent

    def _accounts(self, org, entity):
        """Build a small clean CoA scoped to the demo entity. These accounts
        carry no dimension requirements, so the operator can focus on the
        engine flow rather than juggling dim codes."""
        spec = [
            # code, name, type, subtype
            ("1010", "Operating Bank",            bc.ACCOUNT_TYPE_ASSET,     "bank"),
            ("1200", "Accounts Receivable",       bc.ACCOUNT_TYPE_ASSET,     "accounts_receivable"),
            ("1210", "Input VAT (recoverable)",   bc.ACCOUNT_TYPE_ASSET,     "vat_receivable"),
            ("1130", "Prepaid Expenses",          bc.ACCOUNT_TYPE_ASSET,     "prepaid"),
            ("2010", "Accounts Payable",          bc.ACCOUNT_TYPE_LIABILITY, "accounts_payable"),
            ("2200", "Output VAT (collected)",    bc.ACCOUNT_TYPE_LIABILITY, "vat_payable"),
            ("3000", "Capital",                   bc.ACCOUNT_TYPE_EQUITY,    "capital"),
            ("3100", "Retained Earnings",         bc.ACCOUNT_TYPE_EQUITY,    "retained_earnings"),
            ("4000", "Service Revenue",           bc.ACCOUNT_TYPE_REVENUE,   "operating_revenue"),
            ("6000", "Operating Expenses",        bc.ACCOUNT_TYPE_EXPENSE,   "operating_expense"),
            ("6100", "Insurance Expense",         bc.ACCOUNT_TYPE_EXPENSE,   "operating_expense"),
            ("6200", "Rebillable Costs",          bc.ACCOUNT_TYPE_EXPENSE,   "operating_expense"),
        ]
        out = {}
        for code, name, atype, subtype in spec:
            obj, _ = Account.objects.update_or_create(
                organization=org, entity=entity, code=code,
                defaults={
                    "name": name,
                    "account_type": atype,
                    "account_subtype": subtype,
                    "is_active": True,
                    "posting_allowed": True,
                },
            )
            out[code] = obj
        self.stdout.write(f"  - Accounts: {len(out)} ready")
        return out

    def _fx_rates(self):
        """Seed USD<->CHF and EUR<->CHF rates so consolidated reports work
        even when the demo entity is USD-functional but the reporting
        currency is CHF (as in the WM_CLIENT_V1 CoA).
        """
        # Effective from a year before our oldest demo data (Nov 2025
        # recognition rule starts on 2025-11-01).
        rates = [
            ("USD", "CHF", Decimal("0.9000"), date(2025, 11, 1)),
            ("CHF", "USD", Decimal("1.1111"), date(2025, 11, 1)),
            ("EUR", "CHF", Decimal("0.9500"), date(2025, 11, 1)),
            ("CHF", "EUR", Decimal("1.0526"), date(2025, 11, 1)),
            ("USD", "EUR", Decimal("0.9474"), date(2025, 11, 1)),
            ("EUR", "USD", Decimal("1.0556"), date(2025, 11, 1)),
        ]
        created = 0
        for frm, to, rate, asof in rates:
            _, made = FXRate.objects.update_or_create(
                from_currency=frm, to_currency=to, as_of=asof,
                defaults={"rate": rate, "source": "seed_engine_demo"},
            )
            if made:
                created += 1
        self.stdout.write(f"  - FX rates: {len(rates)} pairs ready ({created} new)")

    def _period(self, entity):
        p, _ = Period.objects.update_or_create(
            entity=entity,
            start_date=date(2026, 4, 1), end_date=date(2026, 4, 30),
            defaults={
                "name": "April 2026", "period_type": bc.PERIOD_MONTH,
                "status": bc.PERIOD_OPEN,
            },
        )
        self.stdout.write(f"  - Period {p.name} open")

    def _tax_code(self, org, accounts):
        tc, _ = TaxCode.objects.update_or_create(
            organization=org, code=DEMO_TAX_CODE,
            defaults={
                "name": "Swiss Standard VAT 8.1%",
                "country_code": "CH",
                "tax_type": "STANDARD",
                "rate": Decimal("8.10"),
                "output_account": accounts["2200"],
                "input_account": accounts["1210"],
                "active_flag": True,
            },
        )
        self.stdout.write(f"  - Tax code {tc.code} ({tc.rate}%) ready")
        return tc

    def _vendor(self, org):
        v, _ = Vendor.objects.update_or_create(
            organization=org, code="DEMO-VENDOR",
            defaults={
                "name": "ACME Supplies AG",
                "default_currency": "USD",
                "default_payment_terms_days": 30,
                "is_active": True,
            },
        )
        self.stdout.write(f"  - Vendor {v.code} ready")
        return v

    def _customer(self, org):
        c, _ = Customer.objects.update_or_create(
            organization=org, code="DEMO-CUSTOMER",
            defaults={
                "name": "Globex Industries Ltd",
                "default_currency": "USD",
                "default_payment_terms_days": 30,
                "is_active": True,
            },
        )
        self.stdout.write(f"  - Customer {c.code} ready")
        return c

    # ── Postings ───────────────────────────────────────────────────

    def _bill_with_vat(self, org, entity, vendor, accounts, tax_code, admin, approver):
        bill = BillService.create_draft(
            organization=org, entity=entity, vendor=vendor,
            invoice_date=date(2026, 4, 10),
            currency="USD", description="Office supplies — VAT demo",
            lines=[{
                "expense_account_id": accounts["6000"].id,
                "description": "April supplies",
                "amount": Decimal("500.00"),
                "tax_code_id": tax_code.id,
            }],
            user=admin,
        )
        BillService.submit_for_approval(bill, user=admin)
        BillService.approve(bill, user=approver)
        self.stdout.write(f"  - Bill {bill.reference} posted "
                          f"(subtotal=500, VAT=40.50, total=540.50)")
        return bill.accrual_journal_entry

    def _invoice_with_vat(self, org, entity, customer, accounts, tax_code, admin, approver):
        inv = InvoiceService.create_draft(
            organization=org, entity=entity, customer=customer,
            invoice_date=date(2026, 4, 12),
            currency="USD", description="Consulting — VAT demo",
            lines=[{
                "revenue_account_id": accounts["4000"].id,
                "description": "April advisory services",
                "amount": Decimal("2000.00"),
                "tax_code_id": tax_code.id,
            }],
            user=admin,
        )
        InvoiceService.submit_for_approval(inv, user=admin)
        InvoiceService.issue(inv, user=approver)
        self.stdout.write(f"  - Invoice {inv.reference} issued "
                          f"(subtotal=2000, VAT=162.00, total=2162.00)")
        return inv.issued_journal_entry

    def _rebillable_expense(self, org, entity, accounts, admin, approver):
        # Rebillable cost: DR 6200 Rebillable / CR 1010 Bank - is_rebillable=True
        client_dt, _ = DimensionType.objects.get_or_create(
            organization=org, code="DEMO_CLIENT",
            defaults={"name": "Demo Client", "active_flag": True},
        )
        client_dv, _ = DimensionValue.objects.get_or_create(
            organization=org, dimension_type=client_dt, code="DEMO-CLIENT",
            defaults={"name": "Demo Client", "active_flag": True},
        )
        je = JournalService.create_draft(
            organization=org, entity=entity, date=date(2026, 4, 15),
            currency="USD",
            memo="DHL shipment for Demo Client — rebillable",
            lines=[
                {"account_id": accounts["6200"].id, "debit": Decimal("180.00"),
                 "currency": "USD", "description": "DHL passthrough"},
                {"account_id": accounts["1010"].id, "credit": Decimal("180.00"),
                 "currency": "USD", "description": "DHL paid"},
            ],
            user=admin,
        )
        eline = je.lines.filter(account=accounts["6200"]).first()
        eline.is_rebillable = True
        eline.rebill_client_dimension_value = client_dv
        eline.save(update_fields=["is_rebillable", "rebill_client_dimension_value"])
        JournalService.submit_for_approval(je, user=admin)
        JournalService.approve(je, user=approver)
        JournalService.post(je, user=approver)
        self.stdout.write(f"  - Rebillable JE {je.entry_number} posted "
                          f"(180 USD pending in /dashboard/disbursements)")
        return je

    def _recognition_rule(self, org, entity, accounts, admin):
        rule, created = RecognitionRule.objects.filter(
            organization=org, code=DEMO_RULE_CODE,
        ).first(), False
        if rule:
            return rule
        rule = RecognitionService.create_rule(
            organization=org, entity=entity,
            code=DEMO_RULE_CODE,
            name="Demo prepaid insurance Nov 2025 – Apr 2026",
            rule_type="PREPAID_EXPENSE",
            total_amount=Decimal("1000.00"),
            currency="USD",
            start_date=date(2025, 11, 1),
            end_date=date(2026, 4, 30),
            deferral_account=accounts["1130"],
            recognition_account=accounts["6100"],
            notes="Demo data — Thomas's Nov–Apr $1,000 example.",
            user=admin,
        )
        self.stdout.write(f"  - Recognition rule {rule.code} created with 6-period schedule")
        return rule
