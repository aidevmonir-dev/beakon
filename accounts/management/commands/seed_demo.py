"""
Seed comprehensive demo data for the Digits Clone platform.
Run: python manage.py seed_demo
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import User
from ledger.constants import (
    JE_STATUS_POSTED,
    SOURCE_BILL,
    SOURCE_INVOICE,
    SOURCE_MANUAL,
)
from ledger.models import Account, AccountingPolicy, FiscalPeriod, JournalEntry, JournalLine
from organizations.models import Organization, OrganizationMember


class Command(BaseCommand):
    help = "Seed demo data: fiscal periods, journal entries, and sample transactions"

    def handle(self, *args, **options):
        try:
            user = User.objects.get(email="guest@beakon.local")
        except User.DoesNotExist:
            self.stderr.write("Run 'python manage.py create_guest' first.")
            return

        org = Organization.objects.filter(
            members__user=user, members__is_active=True
        ).first()
        if not org:
            self.stderr.write("No organization found for guest user.")
            return

        self.stdout.write(f"Seeding demo data for: {org.name}")

        # Ensure accounting policy
        AccountingPolicy.objects.get_or_create(
            organization=org, defaults={"default_currency": "USD"}
        )

        self._create_fiscal_periods(org)
        accounts = self._get_accounts(org)
        self._create_journal_entries(org, user, accounts)

        self.stdout.write(self.style.SUCCESS("\nDemo data seeded successfully!"))
        self._print_summary(org)

    def _create_fiscal_periods(self, org):
        self.stdout.write("  Creating fiscal periods...")
        months = [
            ("January 2026", date(2026, 1, 1), date(2026, 1, 31)),
            ("February 2026", date(2026, 2, 1), date(2026, 2, 28)),
            ("March 2026", date(2026, 3, 1), date(2026, 3, 31)),
            ("April 2026", date(2026, 4, 1), date(2026, 4, 30)),
            ("May 2026", date(2026, 5, 1), date(2026, 5, 31)),
            ("June 2026", date(2026, 6, 1), date(2026, 6, 30)),
        ]
        for name, start, end in months:
            FiscalPeriod.objects.get_or_create(
                organization=org, start_date=start, end_date=end,
                defaults={"name": name, "period_type": "month"},
            )
        # Close Jan-Mar
        FiscalPeriod.objects.filter(
            organization=org, end_date__lt=date(2026, 4, 1)
        ).update(is_closed=True, closed_at=timezone.now())
        self.stdout.write(self.style.SUCCESS("    6 fiscal periods (Jan-Mar closed)"))

    def _get_accounts(self, org):
        accs = {}
        for a in Account.objects.filter(organization=org):
            accs[a.code] = a
        return accs

    def _post_entry(self, entry):
        entry.status = JE_STATUS_POSTED
        entry.posted_at = timezone.now()
        entry.posted_by = entry.created_by
        total = entry.lines.aggregate(t=__import__("django").db.models.Sum("debit", default=Decimal("0")))
        entry.total_amount = total["t"]
        period = FiscalPeriod.objects.filter(
            organization=entry.organization,
            start_date__lte=entry.date,
            end_date__gte=entry.date,
        ).first()
        entry.fiscal_period = period
        entry.save()

    def _je(self, org, user, num, entry_date, memo, lines_data, source=SOURCE_MANUAL):
        entry_number = f"JE-{num:06d}"
        if JournalEntry.objects.filter(organization=org, entry_number=entry_number).exists():
            return None
        entry = JournalEntry.objects.create(
            organization=org,
            entry_number=entry_number,
            date=entry_date,
            memo=memo,
            source_type=source,
            created_by=user,
        )
        for i, (code, desc, dr, cr) in enumerate(lines_data):
            acct = Account.objects.get(organization=org, code=code)
            JournalLine.objects.create(
                journal_entry=entry, account=acct,
                description=desc, debit=Decimal(str(dr)), credit=Decimal(str(cr)),
                line_order=i,
            )
        self._post_entry(entry)
        return entry

    def _create_journal_entries(self, org, user, accounts):
        self.stdout.write("  Creating journal entries...")
        n = 0

        # ── JANUARY 2026 ──────────────────────────────────────────────
        # Owner investment
        n += 1
        self._je(org, user, n, date(2026, 1, 2),
            "Owner initial capital investment",
            [("1010", "Capital deposit", 50000, 0),
             ("3000", "Owner investment", 0, 50000)])

        # Rent
        n += 1
        self._je(org, user, n, date(2026, 1, 5),
            "January office rent - WeWork",
            [("6200", "Office rent Jan", 3500, 0),
             ("1010", "Rent payment", 0, 3500)], SOURCE_BILL)

        # Software subscriptions
        n += 1
        self._je(org, user, n, date(2026, 1, 6),
            "Software subscriptions - Slack, GitHub, Figma",
            [("6700", "Slack Pro", 450, 0),
             ("6700", "GitHub Team", 250, 0),
             ("6700", "Figma Business", 375, 0),
             ("1010", "Subscription payments", 0, 1075)])

        # Client invoice - Widget Corp
        n += 1
        self._je(org, user, n, date(2026, 1, 10),
            "Invoice #INV-001 - Widget Corp consulting",
            [("1100", "AR - Widget Corp", 12000, 0),
             ("4000", "Consulting services Jan", 0, 12000)], SOURCE_INVOICE)

        # Salaries
        n += 1
        self._je(org, user, n, date(2026, 1, 15),
            "January payroll - 3 employees",
            [("6000", "Salaries Jan", 15000, 0),
             ("1010", "Payroll disbursement", 0, 15000)])

        # Office supplies
        n += 1
        self._je(org, user, n, date(2026, 1, 18),
            "Office supplies - Staples order",
            [("6100", "Printer paper, toner, pens", 285, 0),
             ("1010", "Staples payment", 0, 285)], SOURCE_BILL)

        # Client payment received
        n += 1
        self._je(org, user, n, date(2026, 1, 25),
            "Payment received - Widget Corp INV-001",
            [("1010", "Widget Corp payment", 12000, 0),
             ("1100", "AR clearance", 0, 12000)])

        # Marketing
        n += 1
        self._je(org, user, n, date(2026, 1, 28),
            "Google Ads campaign - January",
            [("6500", "Google Ads Jan", 1200, 0),
             ("1010", "Google payment", 0, 1200)])

        # Utilities
        n += 1
        self._je(org, user, n, date(2026, 1, 30),
            "January utilities - Electric & Internet",
            [("6300", "Electric bill", 180, 0),
             ("6300", "Internet service", 120, 0),
             ("1010", "Utility payments", 0, 300)])

        # Insurance
        n += 1
        self._je(org, user, n, date(2026, 1, 31),
            "Business insurance premium - Q1",
            [("6400", "Insurance Q1 2026", 900, 0),
             ("1010", "Insurance payment", 0, 900)])

        # ── FEBRUARY 2026 ─────────────────────────────────────────────
        # Rent
        n += 1
        self._je(org, user, n, date(2026, 2, 3),
            "February office rent - WeWork",
            [("6200", "Office rent Feb", 3500, 0),
             ("1010", "Rent payment", 0, 3500)], SOURCE_BILL)

        # Client invoice - TechStart Inc
        n += 1
        self._je(org, user, n, date(2026, 2, 5),
            "Invoice #INV-002 - TechStart Inc development project",
            [("1100", "AR - TechStart Inc", 18500, 0),
             ("4000", "Development services Feb", 0, 18500)], SOURCE_INVOICE)

        # Salaries
        n += 1
        self._je(org, user, n, date(2026, 2, 15),
            "February payroll - 3 employees",
            [("6000", "Salaries Feb", 15000, 0),
             ("1010", "Payroll disbursement", 0, 15000)])

        # Professional services - Legal
        n += 1
        self._je(org, user, n, date(2026, 2, 18),
            "Legal consultation - contract review",
            [("6600", "Legal fees", 2500, 0),
             ("1010", "Legal payment", 0, 2500)], SOURCE_BILL)

        # Software
        n += 1
        self._je(org, user, n, date(2026, 2, 6),
            "Software subscriptions - Feb",
            [("6700", "SaaS subscriptions Feb", 1075, 0),
             ("1010", "Subscription payments", 0, 1075)])

        # Client payment
        n += 1
        self._je(org, user, n, date(2026, 2, 20),
            "Payment received - TechStart Inc INV-002",
            [("1010", "TechStart payment", 18500, 0),
             ("1100", "AR clearance", 0, 18500)])

        # Equipment purchase
        n += 1
        self._je(org, user, n, date(2026, 2, 22),
            "MacBook Pro for new developer",
            [("1500", "MacBook Pro M4", 2800, 0),
             ("1010", "Equipment purchase", 0, 2800)])

        # Utilities
        n += 1
        self._je(org, user, n, date(2026, 2, 27),
            "February utilities",
            [("6300", "Electric & Internet Feb", 310, 0),
             ("1010", "Utility payments", 0, 310)])

        # Travel
        n += 1
        self._je(org, user, n, date(2026, 2, 28),
            "Business trip - client meeting NYC",
            [("6800", "Flights", 450, 0),
             ("6800", "Hotel 2 nights", 380, 0),
             ("6800", "Meals & transport", 175, 0),
             ("1010", "Travel expenses", 0, 1005)])

        # ── MARCH 2026 ────────────────────────────────────────────────
        # Rent
        n += 1
        self._je(org, user, n, date(2026, 3, 3),
            "March office rent - WeWork",
            [("6200", "Office rent Mar", 3500, 0),
             ("1010", "Rent payment", 0, 3500)], SOURCE_BILL)

        # Two invoices
        n += 1
        self._je(org, user, n, date(2026, 3, 5),
            "Invoice #INV-003 - Widget Corp phase 2",
            [("1100", "AR - Widget Corp", 15000, 0),
             ("4000", "Consulting phase 2", 0, 15000)], SOURCE_INVOICE)

        n += 1
        self._je(org, user, n, date(2026, 3, 8),
            "Invoice #INV-004 - DataFlow LLC analytics setup",
            [("1100", "AR - DataFlow LLC", 8500, 0),
             ("4000", "Analytics consulting", 0, 8500)], SOURCE_INVOICE)

        # Product revenue
        n += 1
        self._je(org, user, n, date(2026, 3, 10),
            "Product license sales - March",
            [("1010", "License payments received", 4200, 0),
             ("4100", "Product license revenue", 0, 4200)])

        # Salaries
        n += 1
        self._je(org, user, n, date(2026, 3, 15),
            "March payroll - 4 employees (new hire)",
            [("6000", "Salaries Mar", 19500, 0),
             ("1010", "Payroll disbursement", 0, 19500)])

        # Software
        n += 1
        self._je(org, user, n, date(2026, 3, 6),
            "Software subscriptions - Mar",
            [("6700", "SaaS subscriptions Mar", 1075, 0),
             ("1010", "Subscription payments", 0, 1075)])

        # Marketing - bigger campaign
        n += 1
        self._je(org, user, n, date(2026, 3, 12),
            "Marketing campaign - LinkedIn + Google Ads",
            [("6500", "LinkedIn Ads", 800, 0),
             ("6500", "Google Ads Mar", 1500, 0),
             ("1010", "Ad payments", 0, 2300)])

        # Client payments
        n += 1
        self._je(org, user, n, date(2026, 3, 18),
            "Payment received - Widget Corp INV-003",
            [("1010", "Widget Corp payment", 15000, 0),
             ("1100", "AR clearance", 0, 15000)])

        n += 1
        self._je(org, user, n, date(2026, 3, 22),
            "Payment received - DataFlow LLC INV-004",
            [("1010", "DataFlow payment", 8500, 0),
             ("1100", "AR clearance", 0, 8500)])

        # Bank fees
        n += 1
        self._je(org, user, n, date(2026, 3, 28),
            "Q1 bank service fees",
            [("7000", "Monthly service fees Q1", 75, 0),
             ("1010", "Bank fees", 0, 75)])

        # Interest income
        n += 1
        self._je(org, user, n, date(2026, 3, 31),
            "Q1 savings account interest",
            [("1020", "Interest deposit", 125, 0),
             ("4600", "Interest earned Q1", 0, 125)])

        # Utilities
        n += 1
        self._je(org, user, n, date(2026, 3, 30),
            "March utilities",
            [("6300", "Electric & Internet Mar", 295, 0),
             ("1010", "Utility payments", 0, 295)])

        # Depreciation
        n += 1
        self._je(org, user, n, date(2026, 3, 31),
            "Q1 depreciation - equipment",
            [("6900", "Depreciation Q1", 233, 0),
             ("1510", "Accumulated depreciation", 0, 233)])

        # ── APRIL 2026 (current month, partial) ──────────────────────
        # Rent
        n += 1
        self._je(org, user, n, date(2026, 4, 2),
            "April office rent - WeWork",
            [("6200", "Office rent Apr", 3500, 0),
             ("1010", "Rent payment", 0, 3500)], SOURCE_BILL)

        # New invoice
        n += 1
        self._je(org, user, n, date(2026, 4, 5),
            "Invoice #INV-005 - Apex Corp platform build",
            [("1100", "AR - Apex Corp", 25000, 0),
             ("4000", "Platform development", 0, 25000)], SOURCE_INVOICE)

        # Software
        n += 1
        self._je(org, user, n, date(2026, 4, 6),
            "Software subscriptions - Apr",
            [("6700", "SaaS subscriptions Apr", 1150, 0),
             ("1010", "Subscription payments", 0, 1150)])

        # Office supplies
        n += 1
        self._je(org, user, n, date(2026, 4, 8),
            "Office supplies - Amazon order",
            [("6100", "Standing desks, monitors", 1850, 0),
             ("1010", "Amazon payment", 0, 1850)], SOURCE_BILL)

        # Salaries
        n += 1
        self._je(org, user, n, date(2026, 4, 10),
            "April payroll advance",
            [("6000", "Salaries Apr (advance)", 19500, 0),
             ("1010", "Payroll disbursement", 0, 19500)])

        self.stdout.write(self.style.SUCCESS(f"    {n} journal entries created and posted"))

    def _print_summary(self, org):
        from django.db.models import Sum
        posted = JournalEntry.objects.filter(organization=org, status=JE_STATUS_POSTED).count()
        periods = FiscalPeriod.objects.filter(organization=org).count()

        revenue = JournalLine.objects.filter(
            journal_entry__organization=org,
            journal_entry__status=JE_STATUS_POSTED,
            account__account_type="revenue",
        ).aggregate(
            cr=Sum("credit", default=Decimal("0")),
            dr=Sum("debit", default=Decimal("0")),
        )
        total_revenue = revenue["cr"] - revenue["dr"]

        expenses = JournalLine.objects.filter(
            journal_entry__organization=org,
            journal_entry__status=JE_STATUS_POSTED,
            account__account_type="expense",
        ).aggregate(
            dr=Sum("debit", default=Decimal("0")),
            cr=Sum("credit", default=Decimal("0")),
        )
        total_expenses = expenses["dr"] - expenses["cr"]

        self.stdout.write(f"\n  Summary:")
        self.stdout.write(f"    Fiscal Periods: {periods}")
        self.stdout.write(f"    Posted Entries: {posted}")
        self.stdout.write(f"    Total Revenue:  ${total_revenue:,.2f}")
        self.stdout.write(f"    Total Expenses: ${total_expenses:,.2f}")
        self.stdout.write(f"    Net Income:     ${total_revenue - total_expenses:,.2f}")
