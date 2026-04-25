"""AnomalyService — proactive checks that surface things worth a human look.

Pure deterministic v1. No LLM in the loop — every anomaly is computed from
the existing ledger / bills / invoices / bank transactions. Cheap to run,
no false-positives from model hallucination, and explainable.

Each anomaly is a dict with a stable shape so the UI can render uniformly:

    {
        "id":          stable string for dedup / dismissal (future)
        "kind":        one of the KIND_* constants
        "severity":    "high" | "medium" | "low"
        "title":       short headline
        "description": one-sentence explanation
        "evidence":    list of {label, href, kind} links to the related objects
        "amount":      Decimal as string (or null) — for sorting / display
        "currency":    str — display currency code (or null)
        "detected_at": iso datetime string
        "suggested_action": str — what the user should do
    }

Severity guideline:
  high   = clear data error or material amount; act today
  medium = looks unusual; review this week
  low    = housekeeping (e.g. stale draft); review when convenient
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date as dt_date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from django.utils import timezone

from organizations.models import Organization

from beakon_banking.models import BankTransaction

from ..models import (
    Bill, Invoice, JournalEntry, Vendor,
)
from ..models.ap import BILL_APPROVED, BILL_PAID, BILL_PENDING_APPROVAL


# ── Anomaly kinds ─────────────────────────────────────────────────────────
KIND_DUPLICATE_BILL       = "duplicate_bill"
KIND_VENDOR_SPEND_SPIKE   = "vendor_spend_spike"
KIND_MISSING_RECURRING    = "missing_recurring_vendor"
KIND_STALE_APPROVAL_BILL  = "stale_approval_bill"
KIND_STALE_APPROVAL_INV   = "stale_approval_invoice"
KIND_STALE_APPROVAL_JE    = "stale_approval_je"
KIND_STALE_BANK_TXN       = "stale_bank_txn"
KIND_AP_AGING_OVERDUE     = "ap_overdue"
KIND_AR_AGING_OVERDUE     = "ar_overdue"


# ── Tunables ──────────────────────────────────────────────────────────────
DUPLICATE_LOOKBACK_DAYS    = 14   # match window for "duplicate bill"
SPEND_SPIKE_LOOKBACK_MONTHS = 3   # baseline window for spike detection
SPEND_SPIKE_MULTIPLIER     = Decimal("2.0")  # this month > 2x trailing avg
SPEND_SPIKE_MIN_AMOUNT     = Decimal("100")  # below this we don't bother
MISSING_RECURRING_HISTORY  = 3    # vendor must have billed in 3+ of last
MISSING_RECURRING_WINDOW   = 6    # 6 months to be considered "recurring"
STALE_APPROVAL_DAYS_BILL   = 5
STALE_APPROVAL_DAYS_INV    = 5
STALE_APPROVAL_DAYS_JE     = 5
STALE_BANK_TXN_DAYS        = 14
AP_OVERDUE_HIGH_DAYS       = 60   # >60 days overdue = high severity
AR_OVERDUE_HIGH_DAYS       = 60


class AnomalyService:
    @staticmethod
    def scan(
        organization: Organization,
        *,
        as_of: Optional[dt_date] = None,
    ) -> list[dict]:
        """Run every check and return a flat list of anomalies, sorted by
        severity (high first), then by detected_at desc."""
        today = as_of or dt_date.today()
        anomalies: list[dict] = []
        anomalies += _check_duplicate_bills(organization, today)
        anomalies += _check_vendor_spend_spikes(organization, today)
        anomalies += _check_missing_recurring_vendors(organization, today)
        anomalies += _check_stale_approvals(organization, today)
        anomalies += _check_stale_bank_txns(organization, today)
        anomalies += _check_ap_overdue(organization, today)
        anomalies += _check_ar_overdue(organization, today)

        sev_order = {"high": 0, "medium": 1, "low": 2}
        anomalies.sort(key=lambda a: (sev_order.get(a["severity"], 9),
                                       a["detected_at"]),
                       reverse=False)
        return anomalies


# ── Individual checks ────────────────────────────────────────────────────

def _check_duplicate_bills(organization: Organization, today: dt_date) -> list[dict]:
    """Two bills from the same vendor, same total, within DUPLICATE_LOOKBACK_DAYS."""
    cutoff = today - timedelta(days=DUPLICATE_LOOKBACK_DAYS)
    bills = (
        Bill.objects
        .filter(organization=organization,
                invoice_date__gte=cutoff)
        .exclude(status="cancelled")
        .select_related("vendor", "entity")
        .order_by("vendor_id", "total", "invoice_date")
    )
    seen = defaultdict(list)
    for b in bills:
        key = (b.vendor_id, str(b.total), b.currency)
        seen[key].append(b)

    out = []
    for (vendor_id, total, currency), group in seen.items():
        if len(group) < 2:
            continue
        # Sort by date and pair adjacent ones within window
        group.sort(key=lambda b: b.invoice_date)
        for a, b in zip(group, group[1:]):
            if (b.invoice_date - a.invoice_date).days <= DUPLICATE_LOOKBACK_DAYS:
                out.append({
                    "id": f"dup_bill::{a.id}::{b.id}",
                    "kind": KIND_DUPLICATE_BILL,
                    "severity": "high",
                    "title": f"Possible duplicate bill from {a.vendor.code}",
                    "description": (
                        f"Two bills for {total} {currency} from "
                        f"{a.vendor.name} dated {a.invoice_date} and "
                        f"{b.invoice_date} (Δ {(b.invoice_date - a.invoice_date).days} days)."
                    ),
                    "evidence": [
                        {"label": a.reference, "href": f"/dashboard/bills",
                         "kind": "bill", "id": a.id},
                        {"label": b.reference, "href": f"/dashboard/bills",
                         "kind": "bill", "id": b.id},
                    ],
                    "amount": str(total),
                    "currency": currency,
                    "detected_at": _now_iso(),
                    "suggested_action":
                        "Review both bills. If a duplicate, cancel one before paying.",
                })
    return out


def _check_vendor_spend_spikes(organization: Organization, today: dt_date) -> list[dict]:
    """Vendors whose this-month spend is > SPEND_SPIKE_MULTIPLIER × trailing
    SPEND_SPIKE_LOOKBACK_MONTHS-month average."""
    month_start = today.replace(day=1)
    baseline_start = _months_ago(month_start, SPEND_SPIKE_LOOKBACK_MONTHS)

    # Bills posted this month per vendor (only approved/paid count as spend)
    this_month = defaultdict(lambda: Decimal("0"))
    baseline = defaultdict(lambda: Decimal("0"))

    bills = (
        Bill.objects
        .filter(organization=organization,
                invoice_date__gte=baseline_start,
                status__in=(BILL_APPROVED, BILL_PAID))
        .select_related("vendor")
    )
    for b in bills:
        if b.invoice_date >= month_start:
            this_month[b.vendor_id] += b.total
        else:
            baseline[b.vendor_id] += b.total

    out = []
    for vendor_id, this_amt in this_month.items():
        if this_amt < SPEND_SPIKE_MIN_AMOUNT:
            continue
        baseline_avg = baseline[vendor_id] / SPEND_SPIKE_LOOKBACK_MONTHS
        if baseline_avg == 0:
            continue  # new vendor — no spike to detect, just normal first bill
        if this_amt < baseline_avg * SPEND_SPIKE_MULTIPLIER:
            continue
        ratio = (this_amt / baseline_avg).quantize(Decimal("0.1"))
        try:
            v = Vendor.objects.get(pk=vendor_id)
        except Vendor.DoesNotExist:
            continue
        out.append({
            "id": f"spike::{vendor_id}::{month_start.isoformat()}",
            "kind": KIND_VENDOR_SPEND_SPIKE,
            "severity": "medium",
            "title": f"{v.code} spend spike: {ratio}× normal",
            "description": (
                f"Bills from {v.name} this month total "
                f"{this_amt.quantize(Decimal('0.01'))} vs "
                f"{baseline_avg.quantize(Decimal('0.01'))} "
                f"trailing {SPEND_SPIKE_LOOKBACK_MONTHS}-month average."
            ),
            "evidence": [
                {"label": v.code, "href": "/dashboard/vendors",
                 "kind": "vendor", "id": v.id},
            ],
            "amount": str(this_amt.quantize(Decimal("0.01"))),
            "currency": None,
            "detected_at": _now_iso(),
            "suggested_action":
                "Verify the higher spend is expected (annual fees, project ramp).",
        })
    return out


def _check_missing_recurring_vendors(organization: Organization, today: dt_date) -> list[dict]:
    """Vendors that billed in MISSING_RECURRING_HISTORY+ of the last
    MISSING_RECURRING_WINDOW months but haven't billed THIS month."""
    month_start = today.replace(day=1)
    window_start = _months_ago(month_start, MISSING_RECURRING_WINDOW)

    bills = (
        Bill.objects
        .filter(organization=organization,
                invoice_date__gte=window_start,
                invoice_date__lt=month_start,
                status__in=(BILL_APPROVED, BILL_PAID))
        .select_related("vendor")
        .values_list("vendor_id", "invoice_date")
    )
    months_per_vendor = defaultdict(set)
    for vendor_id, idate in bills:
        months_per_vendor[vendor_id].add((idate.year, idate.month))

    # Vendors that ALSO billed this month — not missing
    this_month_billed = set(
        Bill.objects
        .filter(organization=organization,
                invoice_date__gte=month_start,
                status__in=(BILL_APPROVED, BILL_PAID))
        .values_list("vendor_id", flat=True)
    )

    out = []
    for vendor_id, months in months_per_vendor.items():
        if len(months) < MISSING_RECURRING_HISTORY:
            continue
        if vendor_id in this_month_billed:
            continue
        try:
            v = Vendor.objects.get(pk=vendor_id)
        except Vendor.DoesNotExist:
            continue
        out.append({
            "id": f"missing::{vendor_id}::{month_start.isoformat()}",
            "kind": KIND_MISSING_RECURRING,
            "severity": "low",
            "title": f"No bill yet from recurring vendor {v.code}",
            "description": (
                f"{v.name} has billed in {len(months)} of the last "
                f"{MISSING_RECURRING_WINDOW} months but no bill yet for "
                f"{month_start.strftime('%B %Y')}."
            ),
            "evidence": [
                {"label": v.code, "href": "/dashboard/vendors",
                 "kind": "vendor", "id": v.id},
            ],
            "amount": None,
            "currency": None,
            "detected_at": _now_iso(),
            "suggested_action":
                "Check whether the vendor's invoice is in the inbox or "
                "delayed.",
        })
    return out


def _check_stale_approvals(organization: Organization, today: dt_date) -> list[dict]:
    """Anything sitting in pending_approval longer than the threshold."""
    out = []

    bill_cutoff = timezone.now() - timedelta(days=STALE_APPROVAL_DAYS_BILL)
    for b in Bill.objects.filter(
        organization=organization, status=BILL_PENDING_APPROVAL,
        submitted_at__lt=bill_cutoff,
    ).select_related("vendor"):
        days = (timezone.now().date() - b.submitted_at.date()).days
        out.append({
            "id": f"stale_appr_bill::{b.id}",
            "kind": KIND_STALE_APPROVAL_BILL,
            "severity": "medium" if days > 10 else "low",
            "title": f"Bill {b.reference} pending approval {days}d",
            "description": (
                f"{b.vendor.name} bill for {b.total} {b.currency} has been "
                f"awaiting approval since {b.submitted_at.date()}."
            ),
            "evidence": [
                {"label": b.reference, "href": "/dashboard/bills",
                 "kind": "bill", "id": b.id},
            ],
            "amount": str(b.total),
            "currency": b.currency,
            "detected_at": _now_iso(),
            "suggested_action":
                "Approve, reject, or return to draft.",
        })

    inv_cutoff = timezone.now() - timedelta(days=STALE_APPROVAL_DAYS_INV)
    for i in Invoice.objects.filter(
        organization=organization, status="pending_approval",
        submitted_at__lt=inv_cutoff,
    ).select_related("customer"):
        days = (timezone.now().date() - i.submitted_at.date()).days
        out.append({
            "id": f"stale_appr_inv::{i.id}",
            "kind": KIND_STALE_APPROVAL_INV,
            "severity": "medium" if days > 10 else "low",
            "title": f"Invoice {i.reference} pending approval {days}d",
            "description": (
                f"Invoice to {i.customer.name} for {i.total} {i.currency} "
                f"has been awaiting approval since {i.submitted_at.date()}."
            ),
            "evidence": [
                {"label": i.reference, "href": "/dashboard/invoices",
                 "kind": "invoice", "id": i.id},
            ],
            "amount": str(i.total),
            "currency": i.currency,
            "detected_at": _now_iso(),
            "suggested_action":
                "Issue, reject, or return to draft.",
        })

    je_cutoff = timezone.now() - timedelta(days=STALE_APPROVAL_DAYS_JE)
    for je in JournalEntry.objects.filter(
        organization=organization, status="pending_approval",
        submitted_for_approval_at__lt=je_cutoff,
    ).select_related("entity"):
        days = (timezone.now().date() - je.submitted_for_approval_at.date()).days
        out.append({
            "id": f"stale_appr_je::{je.id}",
            "kind": KIND_STALE_APPROVAL_JE,
            "severity": "medium" if days > 10 else "low",
            "title": f"JE {je.entry_number} pending approval {days}d",
            "description": (
                f"Journal entry on {je.entity.code} for "
                f"{je.total_debit_functional} {je.currency} has been "
                f"awaiting approval since "
                f"{je.submitted_for_approval_at.date()}."
            ),
            "evidence": [
                {"label": je.entry_number,
                 "href": f"/dashboard/journal-entries/{je.id}",
                 "kind": "je", "id": je.id},
            ],
            "amount": str(je.total_debit_functional),
            "currency": je.currency,
            "detected_at": _now_iso(),
            "suggested_action":
                "Open the entry and approve / reject.",
        })
    return out


def _check_stale_bank_txns(organization: Organization, today: dt_date) -> list[dict]:
    """Bank transactions that have been status='new' for too long."""
    cutoff = today - timedelta(days=STALE_BANK_TXN_DAYS)
    qs = (
        BankTransaction.objects
        .filter(bank_account__organization=organization, status="new",
                date__lte=cutoff)
        .select_related("bank_account")
    )
    by_account = defaultdict(lambda: {"count": 0, "amount": Decimal("0"),
                                       "ba_name": None, "ba_id": None})
    for t in qs:
        ba = t.bank_account
        slot = by_account[ba.id]
        slot["count"] += 1
        slot["amount"] += abs(t.amount)
        slot["ba_name"] = ba.name
        slot["ba_id"] = ba.id

    out = []
    for ba_id, slot in by_account.items():
        out.append({
            "id": f"stale_bank::{ba_id}",
            "kind": KIND_STALE_BANK_TXN,
            "severity": "medium" if slot["count"] > 5 else "low",
            "title": f"{slot['count']} bank txn(s) uncategorized on {slot['ba_name']}",
            "description": (
                f"{slot['count']} bank transaction(s) older than "
                f"{STALE_BANK_TXN_DAYS} days are still status=new on "
                f"{slot['ba_name']}, total magnitude "
                f"{slot['amount'].quantize(Decimal('0.01'))}."
            ),
            "evidence": [
                {"label": slot["ba_name"],
                 "href": f"/dashboard/bank/{ba_id}",
                 "kind": "bank_account", "id": ba_id},
            ],
            "amount": str(slot["amount"].quantize(Decimal("0.01"))),
            "currency": None,
            "detected_at": _now_iso(),
            "suggested_action":
                "Open the bank account and categorize (or use AI suggest).",
        })
    return out


def _check_ap_overdue(organization: Organization, today: dt_date) -> list[dict]:
    """Bills approved-but-not-paid past their due date by a wide margin."""
    cutoff = today - timedelta(days=AP_OVERDUE_HIGH_DAYS)
    bills = (
        Bill.objects.filter(
            organization=organization, status=BILL_APPROVED,
            due_date__lt=cutoff,
        ).select_related("vendor")
    )
    out = []
    for b in bills:
        days = (today - b.due_date).days
        out.append({
            "id": f"ap_overdue::{b.id}",
            "kind": KIND_AP_AGING_OVERDUE,
            "severity": "high",
            "title": f"Bill {b.reference} is {days}d overdue",
            "description": (
                f"{b.vendor.name} bill for {b.total} {b.currency} due "
                f"{b.due_date}, approved but unpaid."
            ),
            "evidence": [
                {"label": b.reference, "href": "/dashboard/bills",
                 "kind": "bill", "id": b.id},
            ],
            "amount": str(b.total),
            "currency": b.currency,
            "detected_at": _now_iso(),
            "suggested_action":
                "Pay the bill from Bills (AP), or contact vendor about terms.",
        })
    return out


def _check_ar_overdue(organization: Organization, today: dt_date) -> list[dict]:
    """Invoices issued-but-not-paid past their due date by a wide margin."""
    cutoff = today - timedelta(days=AR_OVERDUE_HIGH_DAYS)
    invs = (
        Invoice.objects.filter(
            organization=organization, status="issued",
            due_date__lt=cutoff,
        ).select_related("customer")
    )
    out = []
    for inv in invs:
        days = (today - inv.due_date).days
        out.append({
            "id": f"ar_overdue::{inv.id}",
            "kind": KIND_AR_AGING_OVERDUE,
            "severity": "high",
            "title": f"Invoice {inv.reference} is {days}d overdue",
            "description": (
                f"Invoice to {inv.customer.name} for {inv.total} "
                f"{inv.currency} due {inv.due_date}, no receipt yet."
            ),
            "evidence": [
                {"label": inv.reference, "href": "/dashboard/invoices",
                 "kind": "invoice", "id": inv.id},
            ],
            "amount": str(inv.total),
            "currency": inv.currency,
            "detected_at": _now_iso(),
            "suggested_action":
                "Send a collection reminder or follow up with the customer.",
        })
    return out


# ── Helpers ──────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return timezone.now().isoformat()


def _months_ago(d: dt_date, n: int) -> dt_date:
    """Return a date that is ``n`` months before ``d`` (first of the month)."""
    year, month = d.year, d.month - n
    while month <= 0:
        year -= 1
        month += 12
    return dt_date(year, month, 1)
