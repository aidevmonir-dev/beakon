"""Seed AP/AR demo data designed to trigger Beakon's anomaly detectors.

Run AFTER scripts/seed_beakon_demo.py — that one creates entities + COA;
this one adds vendors, customers, bills, and invoices with deliberate
patterns that each anomaly check will catch.

What triggers when (today is assumed 2026-04-20):

  duplicate_bill        STAPLES bills BILL-DUP-A on 2026-04-14 for 250 USD
                        + BILL-DUP-B on 2026-04-18 for 250 USD
                        (same vendor, same total, within 14d window)

  vendor_spend_spike    AWS bills 200 USD in Jan, Feb, Mar (baseline avg 200)
                        then 850 USD in April → 4.25× spike, >100 floor

  missing_recurring     CONED bills 180 USD Jan, Feb, Mar (3 of last 6 mo)
                        no April bill yet

  stale_approval_bill   LEGAL bill submitted 8 days ago, still pending

  ap_overdue            LANDLORD bill approved, due 75 days ago, unpaid

  ar_overdue            BIGCORP invoice issued, due 70 days ago, unpaid

Plus normal-looking activity (paid bills, paid invoices, ordinary AWS/STAPLES
months) so the anomalies stand out against a realistic baseline.

Idempotent: uses vendor/customer codes as natural keys; bills use bill_number
as a dedup tag. Re-running adds what's missing, skips what exists.
"""
import os
import sys
from datetime import date, timedelta
from decimal import Decimal

import django

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "digits_clone.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.db import transaction  # noqa: E402
from django.utils import timezone  # noqa: E402

from beakon_core.models import (  # noqa: E402
    Account, Bill, Customer, Entity, Invoice, Period, Vendor,
)
from beakon_core.models.ap import BILL_APPROVED, BILL_PENDING_APPROVAL  # noqa: E402
from beakon_core.services import BillService, InvoiceService  # noqa: E402
from organizations.models import Organization  # noqa: E402


User = get_user_model()
TODAY = date(2026, 4, 20)


def _get_user(email_substring: str):
    """Find one of the demo users created by seed_beakon_demo.py."""
    u = User.objects.filter(email__icontains=email_substring).first()
    if u is None:
        raise RuntimeError(
            f"No user found matching '{email_substring}'. "
            "Run scripts/seed_beakon_demo.py first."
        )
    return u


def _entity(org, code):
    try:
        return Entity.objects.get(organization=org, code=code)
    except Entity.DoesNotExist:
        raise RuntimeError(
            f"Entity '{code}' missing. Run scripts/seed_beakon_demo.py first."
        )


def _account_or_create(*, org, entity, code, name, atype, subtype):
    """Get or create an account on a given entity."""
    obj, created = Account.objects.update_or_create(
        organization=org, entity=entity, code=code,
        defaults={"name": name, "account_type": atype,
                  "account_subtype": subtype, "is_active": True},
    )
    return obj


# ── Period management ────────────────────────────────────────────────────

def _ensure_periods_open(entity, *, year, months):
    """Make sure each (entity, year, month) period exists and is OPEN.
    Re-opens any that the base seed script closed."""
    import calendar
    for m in months:
        last_day = calendar.monthrange(year, m)[1]
        start = date(year, m, 1)
        end = date(year, m, last_day)
        p, _ = Period.objects.update_or_create(
            entity=entity, start_date=start, end_date=end,
            defaults={
                "name": start.strftime("%B %Y"),
                "period_type": "month",
                "status": "open",
            },
        )
        # Force-open even if it was closed before
        if p.status != "open":
            p.status = "open"
            p.closed_by = None
            p.closed_at = None
            p.save(update_fields=["status", "closed_by", "closed_at", "updated_at"])


# ── Vendors ───────────────────────────────────────────────────────────────

def seed_vendors(org, holdco):
    """Create the vendor master list. Returns dict[code] = Vendor."""
    # Ensure required expense + AP accounts exist on HoldCo
    expense_acc = _account_or_create(
        org=org, entity=holdco, code="6100",
        name="Office & Supplies", atype="expense", subtype="operating_expense",
    )
    cloud_acc = _account_or_create(
        org=org, entity=holdco, code="6200",
        name="Cloud Hosting", atype="expense", subtype="operating_expense",
    )
    utility_acc = _account_or_create(
        org=org, entity=holdco, code="6300",
        name="Utilities", atype="expense", subtype="operating_expense",
    )
    legal_acc = _account_or_create(
        org=org, entity=holdco, code="6600",
        name="Professional Fees", atype="expense", subtype="professional_fees",
    )
    rent_acc = _account_or_create(
        org=org, entity=holdco, code="6400",
        name="Rent", atype="expense", subtype="operating_expense",
    )
    # AP account (required by BillService)
    _account_or_create(
        org=org, entity=holdco, code="2010",
        name="Accounts Payable", atype="liability", subtype="accounts_payable",
    )

    vendors_spec = [
        ("STAPLES",  "Staples Business Advantage", expense_acc, "USD", 30),
        ("AWS",      "Amazon Web Services",         cloud_acc,   "USD", 30),
        ("CONED",    "Consolidated Edison",         utility_acc, "USD", 30),
        ("LEGAL",    "Cromwell & Associates LLP",   legal_acc,   "USD", 15),
        ("LANDLORD", "118 Pine LLC",                rent_acc,    "USD", 5),
    ]
    out = {}
    for code, name, acc, ccy, terms in vendors_spec:
        v, _ = Vendor.objects.update_or_create(
            organization=org, code=code,
            defaults={
                "name": name, "default_currency": ccy,
                "default_payment_terms_days": terms,
                "default_expense_account": acc,
                "is_active": True,
            },
        )
        out[code] = v
    return out


# ── Customers ─────────────────────────────────────────────────────────────

def seed_customers(org, holdco):
    """Customers + the AR account they need."""
    revenue_acc = _account_or_create(
        org=org, entity=holdco, code="4000",
        name="Service Revenue", atype="revenue", subtype="operating_revenue",
    )
    _account_or_create(
        org=org, entity=holdco, code="1200",
        name="Accounts Receivable", atype="asset", subtype="accounts_receivable",
    )

    customers_spec = [
        ("ACME",      "Acme Industries Inc.",   "USD", 30, Decimal("100000")),
        ("WIDGETS",   "Widgets & Co.",          "USD", 30, Decimal("50000")),
        ("BIGCORP",   "BigCorp Holdings Ltd.",  "USD", 45, Decimal("250000")),
    ]
    out = {}
    for code, name, ccy, terms, limit in customers_spec:
        c, _ = Customer.objects.update_or_create(
            organization=org, code=code,
            defaults={
                "name": name, "default_currency": ccy,
                "default_payment_terms_days": terms,
                "default_revenue_account": revenue_acc,
                "credit_limit": limit, "is_active": True,
            },
        )
        out[code] = c
    return out


# ── Bills with deliberate patterns ────────────────────────────────────────

def _bill_exists(org, vendor, bill_number):
    return Bill.objects.filter(
        organization=org, vendor=vendor, bill_number=bill_number,
    ).exists()


def _backdate_field(obj, field, days_ago):
    """Set a datetime field to N days ago. Used to simulate aging."""
    setattr(obj, field, timezone.now() - timedelta(days=days_ago))
    obj.save(update_fields=[field, "updated_at"])


def _create_paid_bill(*, org, holdco, bank_acc, vendor, invoice_date,
                       amount, bill_number, description, maker, approver):
    """Helper: create + submit + approve + pay a bill in one shot."""
    if _bill_exists(org, vendor, bill_number):
        return None
    b = BillService.create_draft(
        organization=org, entity=holdco, vendor=vendor,
        invoice_date=invoice_date,
        bill_number=bill_number,
        currency="USD",
        lines=[{"expense_account_id": vendor.default_expense_account_id,
                "description": description,
                "amount": Decimal(str(amount))}],
        description=description,
        user=maker,
    )
    BillService.submit_for_approval(b, user=maker)
    BillService.approve(b, user=approver)
    BillService.mark_paid(b, bank_account=bank_acc,
                          payment_date=invoice_date + timedelta(days=2),
                          user=approver, reference=f"WIRE-{b.id}")
    return b


def seed_bills(org, holdco, vendors, maker, approver):
    """Build out the deliberate anomaly + baseline patterns."""
    bank_acc = (
        Account.objects
        .filter(organization=org, account_subtype__in=("bank", "cash"),
                entity=holdco, is_active=True)
        .order_by("code").first()
    )
    if bank_acc is None:
        raise RuntimeError(
            "No bank/cash account found on HOLDCO. Seed COA first."
        )

    counts = {"created": 0, "skipped_existing": 0}

    # ── BASELINE: STAPLES bills Jan/Feb/Mar (paid) — establishes recurring ──
    for m, ref_amount in [(1, 220), (2, 240), (3, 230)]:
        b = _create_paid_bill(
            org=org, holdco=holdco, bank_acc=bank_acc,
            vendor=vendors["STAPLES"],
            invoice_date=date(2026, m, 12),
            amount=ref_amount,
            bill_number=f"STP-2026-{m:02d}",
            description="Office supplies",
            maker=maker, approver=approver,
        )
        if b: counts["created"] += 1
        else: counts["skipped_existing"] += 1

    # ── DUPLICATE BILL: two STAPLES bills, same vendor, same amount, days apart ──
    for ref, day in [("STP-DUP-A", 14), ("STP-DUP-B", 18)]:
        if _bill_exists(org, vendors["STAPLES"], ref):
            counts["skipped_existing"] += 1
            continue
        b = BillService.create_draft(
            organization=org, entity=holdco, vendor=vendors["STAPLES"],
            invoice_date=date(2026, 4, day),
            bill_number=ref,
            currency="USD",
            lines=[{"expense_account_id": vendors["STAPLES"].default_expense_account_id,
                    "description": "Bulk office supplies order",
                    "amount": Decimal("250.00")}],
            user=maker,
        )
        BillService.submit_for_approval(b, user=maker)
        BillService.approve(b, user=approver)
        # Leave both UNPAID so they show as outstanding too
        counts["created"] += 1

    # ── SPEND SPIKE: AWS baseline 200 each Jan/Feb/Mar, then 850 in April ──
    for m, amt in [(1, 200), (2, 210), (3, 195)]:
        b = _create_paid_bill(
            org=org, holdco=holdco, bank_acc=bank_acc,
            vendor=vendors["AWS"],
            invoice_date=date(2026, m, 5),
            amount=amt,
            bill_number=f"AWS-2026-{m:02d}",
            description="Monthly cloud hosting",
            maker=maker, approver=approver,
        )
        if b: counts["created"] += 1
        else: counts["skipped_existing"] += 1
    # Spike — 4× normal
    aws_april = _create_paid_bill(
        org=org, holdco=holdco, bank_acc=bank_acc,
        vendor=vendors["AWS"],
        invoice_date=date(2026, 4, 5),
        amount=850,
        bill_number="AWS-2026-04",
        description="Cloud hosting + reserved instances upgrade",
        maker=maker, approver=approver,
    )
    if aws_april: counts["created"] += 1
    else: counts["skipped_existing"] += 1

    # ── MISSING RECURRING: CONED billed Jan/Feb/Mar, NOT April ──
    for m, amt in [(1, 180), (2, 195), (3, 175)]:
        b = _create_paid_bill(
            org=org, holdco=holdco, bank_acc=bank_acc,
            vendor=vendors["CONED"],
            invoice_date=date(2026, m, 8),
            amount=amt,
            bill_number=f"CONED-2026-{m:02d}",
            description="Electricity",
            maker=maker, approver=approver,
        )
        if b: counts["created"] += 1
        else: counts["skipped_existing"] += 1
    # No April CONED bill — that's the anomaly

    # ── STALE APPROVAL: LEGAL bill submitted 8 days ago, still pending ──
    legal_ref = "LEGAL-2026-04-CONTRACT"
    if not _bill_exists(org, vendors["LEGAL"], legal_ref):
        b = BillService.create_draft(
            organization=org, entity=holdco, vendor=vendors["LEGAL"],
            invoice_date=date(2026, 4, 8),
            bill_number=legal_ref,
            currency="USD",
            lines=[{"expense_account_id": vendors["LEGAL"].default_expense_account_id,
                    "description": "Vendor contract review",
                    "amount": Decimal("3500.00")}],
            user=maker,
        )
        BillService.submit_for_approval(b, user=maker)
        # Backdate submitted_at so it triggers the stale-approval check
        _backdate_field(b, "submitted_at", days_ago=8)
        counts["created"] += 1
    else:
        counts["skipped_existing"] += 1

    # ── AP OVERDUE: LANDLORD bill approved long ago, never paid ──
    rent_ref = "RENT-2026-02"
    if not _bill_exists(org, vendors["LANDLORD"], rent_ref):
        b = BillService.create_draft(
            organization=org, entity=holdco, vendor=vendors["LANDLORD"],
            invoice_date=date(2026, 2, 1),
            due_date=date(2026, 2, 5),  # 75 days ago by today
            bill_number=rent_ref,
            currency="USD",
            lines=[{"expense_account_id": vendors["LANDLORD"].default_expense_account_id,
                    "description": "February rent (disputed)",
                    "amount": Decimal("8500.00")}],
            user=maker,
        )
        BillService.submit_for_approval(b, user=maker)
        BillService.approve(b, user=approver)
        # Status is now 'approved' but no payment — triggers ap_overdue
        counts["created"] += 1
    else:
        counts["skipped_existing"] += 1

    return counts


# ── Invoices ──────────────────────────────────────────────────────────────

def _invoice_exists(org, customer, invoice_number):
    return Invoice.objects.filter(
        organization=org, customer=customer, invoice_number=invoice_number,
    ).exists()


def _create_paid_invoice(*, org, holdco, bank_acc, customer, invoice_date,
                          amount, invoice_number, description, maker, approver):
    if _invoice_exists(org, customer, invoice_number):
        return None
    inv = InvoiceService.create_draft(
        organization=org, entity=holdco, customer=customer,
        invoice_date=invoice_date,
        invoice_number=invoice_number,
        currency="USD",
        lines=[{"revenue_account_id": customer.default_revenue_account_id,
                "description": description,
                "amount": Decimal(str(amount))}],
        description=description,
        user=maker,
    )
    InvoiceService.submit_for_approval(inv, user=maker)
    InvoiceService.issue(inv, user=approver)
    InvoiceService.record_payment(inv,
                                   bank_account=bank_acc,
                                   payment_date=invoice_date + timedelta(days=15),
                                   user=approver,
                                   reference=f"ACH-{inv.id}")
    return inv


def seed_invoices(org, holdco, customers, maker, approver):
    bank_acc = (
        Account.objects
        .filter(organization=org, account_subtype__in=("bank", "cash"),
                entity=holdco, is_active=True)
        .order_by("code").first()
    )
    counts = {"created": 0, "skipped_existing": 0}

    # ── BASELINE: ACME paid invoices Jan/Feb/March ──
    for m, amt in [(1, 4500), (2, 5100), (3, 4750)]:
        inv = _create_paid_invoice(
            org=org, holdco=holdco, bank_acc=bank_acc,
            customer=customers["ACME"],
            invoice_date=date(2026, m, 3),
            amount=amt,
            invoice_number=f"ACME-2026-{m:02d}",
            description=f"Consulting services — {date(2026, m, 1).strftime('%B')}",
            maker=maker, approver=approver,
        )
        if inv: counts["created"] += 1
        else: counts["skipped_existing"] += 1

    # ── ACME April invoice — issued but not yet paid (normal) ──
    if not _invoice_exists(org, customers["ACME"], "ACME-2026-04"):
        inv = InvoiceService.create_draft(
            organization=org, entity=holdco, customer=customers["ACME"],
            invoice_date=date(2026, 4, 3),
            invoice_number="ACME-2026-04",
            currency="USD",
            lines=[{"revenue_account_id": customers["ACME"].default_revenue_account_id,
                    "description": "Consulting services — April",
                    "amount": Decimal("5200.00")}],
            user=maker,
        )
        InvoiceService.submit_for_approval(inv, user=maker)
        InvoiceService.issue(inv, user=approver)
        counts["created"] += 1
    else:
        counts["skipped_existing"] += 1

    # ── WIDGETS: one paid in March ──
    inv = _create_paid_invoice(
        org=org, holdco=holdco, bank_acc=bank_acc,
        customer=customers["WIDGETS"],
        invoice_date=date(2026, 3, 15),
        amount=12500,
        invoice_number="WID-2026-Q1",
        description="Q1 retainer",
        maker=maker, approver=approver,
    )
    if inv: counts["created"] += 1
    else: counts["skipped_existing"] += 1

    # ── AR OVERDUE: BIGCORP invoice issued, due 70 days ago ──
    if not _invoice_exists(org, customers["BIGCORP"], "BIG-2026-01-Q1"):
        inv = InvoiceService.create_draft(
            organization=org, entity=holdco, customer=customers["BIGCORP"],
            invoice_date=date(2026, 1, 5),
            due_date=date(2026, 2, 9),  # 70 days ago by 2026-04-20
            invoice_number="BIG-2026-01-Q1",
            currency="USD",
            lines=[{"revenue_account_id": customers["BIGCORP"].default_revenue_account_id,
                    "description": "Q1 strategy engagement",
                    "amount": Decimal("45000.00")}],
            user=maker,
        )
        InvoiceService.submit_for_approval(inv, user=maker)
        InvoiceService.issue(inv, user=approver)
        # Status is 'issued', no payment recorded — triggers ar_overdue
        counts["created"] += 1
    else:
        counts["skipped_existing"] += 1

    return counts


# ── Orchestrator ─────────────────────────────────────────────────────────

def main():
    org = Organization.objects.first()
    if not org:
        print("FAIL: no Organization. Run seed_beakon_demo.py first.")
        sys.exit(1)
    print(f"Seeding anomaly demo into: {org.name} (id={org.id})")

    holdco = _entity(org, "HOLDCO")
    maker = _get_user("demo-maker")
    approver = _get_user("demo-approver")
    print(f"  entity:   {holdco.code}  ·  users: {maker.email} / {approver.email}")

    with transaction.atomic():
        # Ensure Jan/Feb/Mar/Apr 2026 periods exist AND are open on HoldCo —
        # bills go back to January for the spend-spike baseline.
        _ensure_periods_open(holdco, year=2026, months=range(1, 5))

        vendors = seed_vendors(org, holdco)
        print(f"  vendors:  {', '.join(sorted(vendors))}")

        customers = seed_customers(org, holdco)
        print(f"  customers: {', '.join(sorted(customers))}")

        bill_counts = seed_bills(org, holdco, vendors, maker, approver)
        print(f"  bills:    +{bill_counts['created']} new "
              f"({bill_counts['skipped_existing']} already existed)")

        inv_counts = seed_invoices(org, holdco, customers, maker, approver)
        print(f"  invoices: +{inv_counts['created']} new "
              f"({inv_counts['skipped_existing']} already existed)")

    # Run the anomaly scanner to confirm everything triggered
    print("")
    print("Running anomaly scan (should find ALL 6 deliberate patterns)…")
    from beakon_core.services import AnomalyService
    anomalies = AnomalyService.scan(org, as_of=TODAY)
    by_kind = {}
    for a in anomalies:
        by_kind.setdefault(a["kind"], []).append(a)
    for kind, items in sorted(by_kind.items()):
        print(f"  [{items[0]['severity']:6}] {kind:25} ×{len(items)}")
        for it in items[:2]:
            print(f"           {it['title']}")
    print("")
    print(f"Total anomalies: {len(anomalies)}")
    print("Open /dashboard/anomalies in the UI to see them rendered.")


if __name__ == "__main__":
    main()
