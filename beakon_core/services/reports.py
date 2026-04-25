"""Reporting engine — the outputs the blueprint (p.4) mandates for the
Phase 1 prototype:

    trial balance · profit & loss · balance sheet · journal listing · drill-down

Design choices:

- Reports read only ``JournalLine`` rows whose parent ``JournalEntry``
  is in ``JE_LEDGER_IMPACTING`` (posted or reversed). Drafts, pending,
  approved, rejected entries do not move balances (matches "approval
  before ledger impact" from blueprint p.2). Reversed entries are
  included so that an original + its reversal mirror net to zero on
  the books — see ``constants.JE_LEDGER_IMPACTING`` docstring.

- Single-entity reports express amounts in the entity's functional
  currency. Consolidated (multi-entity) reports translate each line's
  ``functional_`` amount into a chosen ``reporting_currency`` via
  ``FXService`` at the report date. This is a v1 simplification — proper
  consolidation uses historical rates for equity, average rates for P&L,
  and closing rates for B/S. Thomas to refine.

- Drill-down: every balance row exposes an ``account_id``; callers pass it
  to ``account_ledger()`` to see the journal lines that compose the
  balance. From a line the caller reaches the JE via ``journal_entry_id``;
  ``entry_detail()`` returns lines + approval history + source reference.
"""
from collections import defaultdict
from datetime import date as dt_date
from decimal import Decimal
from typing import Iterable, Optional

from django.db import models as db_models
from django.db.models import Q, Sum

from .. import constants as c
from ..models import (
    Account,
    ApprovalAction,
    Bill,
    Entity,
    Invoice,
    JournalEntry,
    JournalLine,
)
from .fx import FXService


ZERO = Decimal("0")


# ── Cash flow categorization ───────────────────────────────────────────────
# Maps an account subtype → (section, friendly label).
#   section = "operating" | "investing" | "financing"
# Subtypes not in this map default to operating with the account's own name.
CASH_SUBTYPES = ("bank", "cash")

CF_SECTION = "section"
CF_LABEL = "label"

CASHFLOW_OFFSET_MAP: dict[str, dict[str, str]] = {
    # Operating — revenue side
    "operating_revenue":      {CF_SECTION: "operating", CF_LABEL: "Sales receipts"},
    "investment_income":      {CF_SECTION: "operating", CF_LABEL: "Investment income received"},
    "other_income":           {CF_SECTION: "operating", CF_LABEL: "Other income received"},
    "fx_gain":                {CF_SECTION: "operating", CF_LABEL: "FX gain (realised)"},
    # Operating — expense side
    "cogs":                   {CF_SECTION: "operating", CF_LABEL: "COGS payments"},
    "operating_expense":      {CF_SECTION: "operating", CF_LABEL: "Operating expenses paid"},
    "professional_fees":      {CF_SECTION: "operating", CF_LABEL: "Professional fees paid"},
    "depreciation":           {CF_SECTION: "operating", CF_LABEL: "Depreciation (non-cash adj.)"},
    "tax_expense":            {CF_SECTION: "operating", CF_LABEL: "Income tax paid"},
    "fx_loss":                {CF_SECTION: "operating", CF_LABEL: "FX loss (realised)"},
    "other_expense":          {CF_SECTION: "operating", CF_LABEL: "Other expenses paid"},
    # Operating — working capital
    "accounts_receivable":    {CF_SECTION: "operating", CF_LABEL: "Customer collections"},
    "intercompany_receivable":{CF_SECTION: "operating", CF_LABEL: "Intercompany receipts"},
    "prepaid":                {CF_SECTION: "operating", CF_LABEL: "Prepaid expense changes"},
    "inventory":              {CF_SECTION: "operating", CF_LABEL: "Inventory changes"},
    "accounts_payable":       {CF_SECTION: "operating", CF_LABEL: "Vendor payments"},
    "intercompany_payable":   {CF_SECTION: "operating", CF_LABEL: "Intercompany payments"},
    "accrued_liability":      {CF_SECTION: "operating", CF_LABEL: "Accrued liability changes"},
    "tax_payable":            {CF_SECTION: "operating", CF_LABEL: "Tax liability changes"},
    "vat_payable":            {CF_SECTION: "operating", CF_LABEL: "VAT settlements"},
    "current_liability":      {CF_SECTION: "operating", CF_LABEL: "Other current liability changes"},
    "current_asset":          {CF_SECTION: "operating", CF_LABEL: "Other current asset changes"},
    "other_asset":            {CF_SECTION: "operating", CF_LABEL: "Other asset changes"},
    "other_liability":        {CF_SECTION: "operating", CF_LABEL: "Other liability changes"},
    # Investing
    "fixed_asset":            {CF_SECTION: "investing", CF_LABEL: "Fixed asset purchases / sales"},
    "intangible_asset":       {CF_SECTION: "investing", CF_LABEL: "Intangible asset purchases / sales"},
    "accumulated_depreciation":{CF_SECTION: "investing", CF_LABEL: "Accumulated depreciation"},
    "investment":             {CF_SECTION: "investing", CF_LABEL: "Investment purchases / sales"},
    "loan_receivable":        {CF_SECTION: "investing", CF_LABEL: "Loans issued / repaid to us"},
    # Financing
    "loan_payable":           {CF_SECTION: "financing", CF_LABEL: "Loan proceeds / repayments"},
    "long_term_liability":    {CF_SECTION: "financing", CF_LABEL: "Long-term debt movements"},
    "capital":                {CF_SECTION: "financing", CF_LABEL: "Capital contributions / withdrawals"},
    "retained_earnings":      {CF_SECTION: "financing", CF_LABEL: "Retained earnings movements"},
    "distribution":           {CF_SECTION: "financing", CF_LABEL: "Distributions / dividends paid"},
    "revaluation_reserve":    {CF_SECTION: "financing", CF_LABEL: "Revaluation reserve"},
    "fx_translation_reserve": {CF_SECTION: "financing", CF_LABEL: "FX translation reserve"},
    "other_equity":           {CF_SECTION: "financing", CF_LABEL: "Other equity changes"},
}


# ── AP/AR aging buckets ────────────────────────────────────────────────────
# The list-of-tuples is (bucket_key, min_days_overdue, max_days_overdue).
# "current" means not yet due: days_overdue < 0. The final bucket is open-
# ended on the high end.
AGING_BUCKETS = [
    ("current", None, 0),      # days_overdue <= 0 (not yet due or due today)
    ("d_1_30",  1, 30),
    ("d_31_60", 31, 60),
    ("d_61_90", 61, 90),
    ("d_90_plus", 91, None),
]
AGING_BUCKET_ORDER = [k for k, _, _ in AGING_BUCKETS]


def _bucket_for(days_overdue: int) -> str:
    for key, lo, hi in AGING_BUCKETS:
        if lo is not None and days_overdue < lo:
            continue
        if hi is not None and days_overdue > hi:
            continue
        return key
    return "d_90_plus"


def _s(d: Decimal) -> str:
    """Format a decimal to 2dp string (presentation only; math stays at 4dp)."""
    return f"{(d or ZERO).quantize(Decimal('0.01'))}"


def _posted_lines_qs(*, entity=None, organization=None, date_to=None, date_from=None):
    """Base queryset: posted journal lines, optionally filtered by entity
    or org-wide (consolidation), and by date window."""
    qs = JournalLine.objects.filter(
        journal_entry__status__in=c.JE_LEDGER_IMPACTING,
    ).select_related("account", "journal_entry", "journal_entry__entity")
    if entity is not None:
        qs = qs.filter(journal_entry__entity=entity)
    elif organization is not None:
        qs = qs.filter(journal_entry__organization=organization)
    if date_from is not None:
        qs = qs.filter(journal_entry__date__gte=date_from)
    if date_to is not None:
        qs = qs.filter(journal_entry__date__lte=date_to)
    return qs


def _translate(amount: Decimal, *, from_ccy: str, to_ccy: str,
               as_of: dt_date) -> Decimal:
    """Convert ``amount`` from ``from_ccy`` to ``to_ccy`` using FXService.
    Same-currency short-circuits."""
    if from_ccy == to_ccy:
        return amount
    rate = FXService.rate(from_currency=from_ccy, to_currency=to_ccy, as_of=as_of)
    return (amount * rate).quantize(Decimal("0.0001"))


# ── Trial Balance ───────────────────────────────────────────────────────────

def _cash_balance_at(
    cash_account_ids: set,
    *,
    entity: Optional[Entity],
    organization,
    as_of: dt_date,
    reporting_currency: str,
) -> Decimal:
    """Sum the functional balance of the cash accounts as of ``as_of``,
    translated to ``reporting_currency`` at ``as_of``."""
    if not cash_account_ids:
        return ZERO
    qs = JournalLine.objects.filter(
        account_id__in=cash_account_ids,
        journal_entry__status__in=c.JE_LEDGER_IMPACTING,
        journal_entry__date__lte=as_of,
    ).select_related("journal_entry__entity")
    if entity is not None:
        qs = qs.filter(journal_entry__entity=entity)
    else:
        qs = qs.filter(journal_entry__organization=organization)

    total = ZERO
    for ln in qs:
        entity_fc = ln.journal_entry.entity.functional_currency
        delta_func = (ln.functional_debit or ZERO) - (ln.functional_credit or ZERO)
        if entity_fc != reporting_currency:
            rate = FXService.rate(
                from_currency=entity_fc, to_currency=reporting_currency,
                as_of=as_of,
            )
            total += (delta_func * rate).quantize(Decimal("0.0001"))
        else:
            total += delta_func
    return total


def _aging(
    *,
    model,
    party_attr: str,
    outstanding_statuses: tuple,
    amount_attr: str,
    due_attr: str,
    report_type: str,
    entity: Optional[Entity],
    organization,
    as_of: Optional[dt_date],
    reporting_currency: Optional[str],
    ref_attr: str,
    extra_ref_attr: str,
):
    """Shared aging engine used by both AP and AR.

    Groups outstanding documents (bills or invoices) by party (vendor or
    customer) and age-bucket. Returns totals per party + per bucket +
    grand total, and also the list of individual documents per party for
    drill-down in the UI.
    """
    if entity is None and organization is None:
        raise ValueError("aging: pass either entity or organization")

    today = as_of or dt_date.today()

    qs = model.objects.filter(status__in=outstanding_statuses)
    if entity is not None:
        qs = qs.filter(entity=entity)
    else:
        qs = qs.filter(organization=organization)
    qs = qs.select_related(party_attr, "entity")

    if reporting_currency is None:
        if entity is not None:
            reporting_currency = entity.functional_currency
        else:
            first = Entity.objects.filter(organization=organization).first()
            reporting_currency = (
                (first.reporting_currency or first.functional_currency)
                if first else "USD"
            )

    # Per-party aggregation
    parties = {}  # key = party.id → dict
    for doc in qs:
        party = getattr(doc, party_attr)
        if party is None:
            continue  # shouldn't happen — bills/invoices require a party
        due: dt_date = getattr(doc, due_attr)
        days_overdue = (today - due).days
        bucket = _bucket_for(days_overdue)

        amount_native = Decimal(str(getattr(doc, amount_attr)))
        if doc.currency != reporting_currency:
            rate = FXService.rate(
                from_currency=doc.currency,
                to_currency=reporting_currency,
                as_of=today,
            )
            amount = (amount_native * rate).quantize(Decimal("0.0001"))
        else:
            amount = amount_native

        if party.id not in parties:
            parties[party.id] = {
                "party_id": party.id,
                "party_code": party.code,
                "party_name": party.name,
                "buckets": {k: ZERO for k in AGING_BUCKET_ORDER},
                "total": ZERO,
                "docs": [],
            }
        p = parties[party.id]
        p["buckets"][bucket] += amount
        p["total"] += amount
        p["docs"].append({
            "id": doc.id,
            "reference": getattr(doc, ref_attr),
            "external_ref": getattr(doc, extra_ref_attr, "") or "",
            "entity_code": doc.entity.code,
            "invoice_date": str(doc.invoice_date),
            "due_date": str(due),
            "days_overdue": days_overdue,
            "bucket": bucket,
            "native_amount": _s(amount_native),
            "native_currency": doc.currency,
            "amount": _s(amount),
            "status": doc.status,
        })

    # Format + sort
    result_parties = []
    totals = {k: ZERO for k in AGING_BUCKET_ORDER}
    grand_total = ZERO
    for p in parties.values():
        p["docs"].sort(key=lambda d: (d["due_date"], d["reference"]))
        for k in AGING_BUCKET_ORDER:
            totals[k] += p["buckets"][k]
            p["buckets"][k] = _s(p["buckets"][k])
        grand_total += p["total"]
        p["total"] = _s(p["total"])
        result_parties.append(p)
    result_parties.sort(key=lambda p: p["party_code"])

    return {
        "report_type": report_type,
        "as_of": str(today),
        "reporting_currency": reporting_currency,
        "scope": {
            "entity": entity.code if entity else None,
            "organization": organization.id if organization else None,
        },
        "buckets": AGING_BUCKET_ORDER,
        "parties": result_parties,
        "totals": {k: _s(v) for k, v in totals.items()},
        "grand_total": _s(grand_total),
        "party_count": len(result_parties),
        "document_count": sum(len(p["docs"]) for p in result_parties),
    }


class ReportsService:
    @staticmethod
    def trial_balance(
        *,
        entity: Optional[Entity] = None,
        organization=None,
        as_of: dt_date,
        reporting_currency: Optional[str] = None,
    ):
        """Return all accounts with their DR/CR totals in the report currency.

        - Single-entity mode: pass ``entity=Entity``. Report currency
          defaults to the entity's functional currency.
        - Consolidated mode: pass ``organization=org`` (no entity). Report
          currency defaults to the first entity's reporting/functional
          currency; override with ``reporting_currency``.
        """
        if entity is None and organization is None:
            raise ValueError("trial_balance: must pass either entity or organization")

        lines = _posted_lines_qs(entity=entity, organization=organization, date_to=as_of)

        # Default reporting currency
        if reporting_currency is None:
            if entity is not None:
                reporting_currency = entity.functional_currency
            else:
                first = Entity.objects.filter(organization=organization).first()
                reporting_currency = (
                    first.reporting_currency or first.functional_currency
                ) if first else "USD"

        # Accumulate per-account. For consolidation we translate each line's
        # functional amount from its entity's functional currency to the
        # reporting currency.
        totals = defaultdict(lambda: {"dr": ZERO, "cr": ZERO})
        account_meta = {}

        for line in lines:
            acc = line.account
            entity_fc = line.journal_entry.entity.functional_currency
            dr = line.functional_debit or ZERO
            cr = line.functional_credit or ZERO
            if entity_fc != reporting_currency:
                dr = _translate(dr, from_ccy=entity_fc, to_ccy=reporting_currency, as_of=as_of)
                cr = _translate(cr, from_ccy=entity_fc, to_ccy=reporting_currency, as_of=as_of)
            totals[acc.id]["dr"] += dr
            totals[acc.id]["cr"] += cr
            account_meta[acc.id] = acc

        result = []
        total_dr = ZERO
        total_cr = ZERO
        for acc_id, t in totals.items():
            acc = account_meta[acc_id]
            dr, cr = t["dr"], t["cr"]
            if dr == ZERO and cr == ZERO:
                continue
            net = dr - cr  # positive = debit side
            result.append({
                "account_id": acc_id,
                "code": acc.code,
                "name": acc.name,
                "account_type": acc.account_type,
                "account_subtype": acc.account_subtype,
                "debit": _s(dr),
                "credit": _s(cr),
                "net": _s(net),
                "net_direction": "debit" if net >= 0 else "credit",
            })
            total_dr += dr
            total_cr += cr
        result.sort(key=lambda r: r["code"])

        return {
            "report_type": "trial_balance",
            "scope": {"entity": entity.code if entity else None,
                      "organization": organization.id if organization else None},
            "reporting_currency": reporting_currency,
            "as_of": str(as_of),
            "accounts": result,
            "totals": {
                "total_debits": _s(total_dr),
                "total_credits": _s(total_cr),
                "is_balanced": abs(total_dr - total_cr) <= Decimal("0.01"),
                "difference": _s(total_dr - total_cr),
            },
        }

    # ── Profit & Loss ───────────────────────────────────────────────────────
    @staticmethod
    def profit_loss(
        *,
        entity: Optional[Entity] = None,
        organization=None,
        date_from: dt_date,
        date_to: dt_date,
        reporting_currency: Optional[str] = None,
    ):
        """Revenue − Expenses for the date range."""
        if entity is None and organization is None:
            raise ValueError("profit_loss: must pass either entity or organization")

        lines = _posted_lines_qs(
            entity=entity, organization=organization,
            date_from=date_from, date_to=date_to,
        ).filter(account__account_type__in=[c.ACCOUNT_TYPE_REVENUE, c.ACCOUNT_TYPE_EXPENSE])

        if reporting_currency is None:
            reporting_currency = (
                entity.functional_currency if entity else
                (Entity.objects.filter(organization=organization).first().functional_currency
                 if Entity.objects.filter(organization=organization).exists() else "USD")
            )

        # Bucket by subtype for rollups.
        buckets = {
            "revenue": {"accounts": [], "total": ZERO},
            "cogs": {"accounts": [], "total": ZERO},
            "operating_expenses": {"accounts": [], "total": ZERO},
            "other_income": {"accounts": [], "total": ZERO},
            "other_expenses": {"accounts": [], "total": ZERO},
        }

        per_acc = defaultdict(lambda: {"dr": ZERO, "cr": ZERO, "meta": None})
        for line in lines:
            acc = line.account
            entity_fc = line.journal_entry.entity.functional_currency
            dr = line.functional_debit or ZERO
            cr = line.functional_credit or ZERO
            if entity_fc != reporting_currency:
                dr = _translate(dr, from_ccy=entity_fc, to_ccy=reporting_currency, as_of=date_to)
                cr = _translate(cr, from_ccy=entity_fc, to_ccy=reporting_currency, as_of=date_to)
            per_acc[acc.id]["dr"] += dr
            per_acc[acc.id]["cr"] += cr
            per_acc[acc.id]["meta"] = acc

        for acc_id, t in per_acc.items():
            acc = t["meta"]
            if acc.account_type == c.ACCOUNT_TYPE_REVENUE:
                amt = t["cr"] - t["dr"]  # credit-normal
                bucket = "other_income" if acc.account_subtype == "other_income" else "revenue"
            else:  # expense
                amt = t["dr"] - t["cr"]  # debit-normal
                if acc.account_subtype == "cogs":
                    bucket = "cogs"
                elif acc.account_subtype == "other_expense":
                    bucket = "other_expenses"
                else:
                    bucket = "operating_expenses"
            if amt == ZERO:
                continue
            buckets[bucket]["accounts"].append({
                "account_id": acc_id,
                "code": acc.code, "name": acc.name,
                "subtype": acc.account_subtype,
                "amount": _s(amt),
            })
            buckets[bucket]["total"] += amt

        for b in buckets.values():
            b["accounts"].sort(key=lambda r: r["code"])
            b["total"] = _s(b["total"])

        revenue = Decimal(buckets["revenue"]["total"])
        cogs = Decimal(buckets["cogs"]["total"])
        opex = Decimal(buckets["operating_expenses"]["total"])
        other_income = Decimal(buckets["other_income"]["total"])
        other_expenses = Decimal(buckets["other_expenses"]["total"])
        gross_profit = revenue - cogs
        operating_income = gross_profit - opex
        net_income = operating_income + other_income - other_expenses

        return {
            "report_type": "profit_loss",
            "scope": {"entity": entity.code if entity else None,
                      "organization": organization.id if organization else None},
            "reporting_currency": reporting_currency,
            "period_start": str(date_from),
            "period_end": str(date_to),
            "revenue": buckets["revenue"],
            "cogs": buckets["cogs"],
            "gross_profit": _s(gross_profit),
            "operating_expenses": buckets["operating_expenses"],
            "operating_income": _s(operating_income),
            "other_income": buckets["other_income"],
            "other_expenses": buckets["other_expenses"],
            "net_income": _s(net_income),
        }

    # ── Balance Sheet ────────────────────────────────────────────────────────
    @staticmethod
    def balance_sheet(
        *,
        entity: Optional[Entity] = None,
        organization=None,
        as_of: dt_date,
        reporting_currency: Optional[str] = None,
    ):
        """Assets = Liabilities + Equity as of a point in time.

        Includes a computed YTD net income line in equity so the equation
        balances even before the user formally closes the year-end into
        retained earnings.
        """
        if entity is None and organization is None:
            raise ValueError("balance_sheet: must pass either entity or organization")

        lines = _posted_lines_qs(
            entity=entity, organization=organization, date_to=as_of,
        ).filter(account__account_type__in=[
            c.ACCOUNT_TYPE_ASSET, c.ACCOUNT_TYPE_LIABILITY, c.ACCOUNT_TYPE_EQUITY,
        ])

        if reporting_currency is None:
            reporting_currency = (
                entity.functional_currency if entity else
                (Entity.objects.filter(organization=organization).first().functional_currency
                 if Entity.objects.filter(organization=organization).exists() else "USD")
            )

        sections = {
            "assets": {"accounts": [], "total": ZERO},
            "liabilities": {"accounts": [], "total": ZERO},
            "equity": {"accounts": [], "total": ZERO},
        }

        per_acc = defaultdict(lambda: {"dr": ZERO, "cr": ZERO, "meta": None})
        for line in lines:
            acc = line.account
            entity_fc = line.journal_entry.entity.functional_currency
            dr = line.functional_debit or ZERO
            cr = line.functional_credit or ZERO
            if entity_fc != reporting_currency:
                dr = _translate(dr, from_ccy=entity_fc, to_ccy=reporting_currency, as_of=as_of)
                cr = _translate(cr, from_ccy=entity_fc, to_ccy=reporting_currency, as_of=as_of)
            per_acc[acc.id]["dr"] += dr
            per_acc[acc.id]["cr"] += cr
            per_acc[acc.id]["meta"] = acc

        for acc_id, t in per_acc.items():
            acc = t["meta"]
            if acc.account_type == c.ACCOUNT_TYPE_ASSET:
                amt = t["dr"] - t["cr"]
                section = "assets"
            elif acc.account_type == c.ACCOUNT_TYPE_LIABILITY:
                amt = t["cr"] - t["dr"]
                section = "liabilities"
            else:
                amt = t["cr"] - t["dr"]
                section = "equity"
            if amt == ZERO:
                continue
            sections[section]["accounts"].append({
                "account_id": acc_id,
                "code": acc.code, "name": acc.name,
                "subtype": acc.account_subtype,
                "amount": _s(amt),
            })
            sections[section]["total"] += amt

        # Add YTD net income to equity so the equation balances before year-end close.
        ytd_start = dt_date(as_of.year, 1, 1)
        pnl = ReportsService.profit_loss(
            entity=entity, organization=organization,
            date_from=ytd_start, date_to=as_of,
            reporting_currency=reporting_currency,
        )
        ytd_net = Decimal(pnl["net_income"])
        sections["equity"]["accounts"].append({
            "account_id": None,
            "code": "—",
            "name": "Current year net income (computed)",
            "subtype": "computed",
            "amount": _s(ytd_net),
        })
        sections["equity"]["total"] += ytd_net

        for s in sections.values():
            s["accounts"].sort(key=lambda r: r["code"])
            s["total"] = _s(s["total"])

        assets_total = Decimal(sections["assets"]["total"])
        liab_eq_total = Decimal(sections["liabilities"]["total"]) + Decimal(sections["equity"]["total"])
        balanced = abs(assets_total - liab_eq_total) <= Decimal("0.01")

        return {
            "report_type": "balance_sheet",
            "scope": {"entity": entity.code if entity else None,
                      "organization": organization.id if organization else None},
            "reporting_currency": reporting_currency,
            "as_of": str(as_of),
            "assets": sections["assets"],
            "liabilities": sections["liabilities"],
            "equity": sections["equity"],
            "total_assets": _s(assets_total),
            "total_liabilities_equity": _s(liab_eq_total),
            "difference": _s(assets_total - liab_eq_total),
            "is_balanced": balanced,
            "ytd_net_income": _s(ytd_net),
        }

    # ── Journal Listing ─────────────────────────────────────────────────────
    @staticmethod
    def journal_listing(
        *,
        entity: Optional[Entity] = None,
        organization=None,
        date_from: Optional[dt_date] = None,
        date_to: Optional[dt_date] = None,
        status: Optional[str] = None,
        source_type: Optional[str] = None,
        limit: int = 200,
    ):
        """Flat list of journal entries with header-level metadata.

        Unlike the other reports this one includes ALL statuses (not just
        posted) so the UI can show the approval queue. Filter via ``status``.
        """
        qs = JournalEntry.objects.select_related("entity", "period", "created_by",
                                                  "approved_by", "posted_by")
        if entity is not None:
            qs = qs.filter(entity=entity)
        elif organization is not None:
            qs = qs.filter(organization=organization)
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        if status:
            qs = qs.filter(status=status)
        if source_type:
            qs = qs.filter(source_type=source_type)

        qs = qs.order_by("-date", "-entry_number")[:limit]

        result = []
        for je in qs:
            result.append({
                "id": je.id,
                "entry_number": je.entry_number,
                "entity_code": je.entity.code,
                "entity_name": je.entity.name,
                "date": str(je.date),
                "status": je.status,
                "source_type": je.source_type,
                "source_ref": je.source_ref,
                "memo": je.memo[:200],
                "currency": je.currency,
                "total": _s(je.total_debit_functional),
                "functional_currency": je.entity.functional_currency,
                "period": je.period.name if je.period_id else None,
                "created_by": je.created_by.email if je.created_by_id else None,
                "approved_by": je.approved_by.email if je.approved_by_id else None,
                "posted_by": je.posted_by.email if je.posted_by_id else None,
                "posted_at": je.posted_at.isoformat() if je.posted_at else None,
            })
        return {
            "report_type": "journal_listing",
            "count": len(result),
            "filters": {
                "entity": entity.code if entity else None,
                "organization": organization.id if organization else None,
                "date_from": str(date_from) if date_from else None,
                "date_to": str(date_to) if date_to else None,
                "status": status, "source_type": source_type,
            },
            "entries": result,
        }

    # ── Cash Flow Statement (direct method) ─────────────────────────────────
    @staticmethod
    def cash_flow_statement(
        *,
        entity: Optional[Entity] = None,
        organization=None,
        date_from: dt_date,
        date_to: dt_date,
        reporting_currency: Optional[str] = None,
    ):
        """Direct-method cash flow statement.

        For every posted JE in the period that touches a cash/bank account,
        we attribute the net cash movement to the OFFSET (non-cash) lines
        proportionally. Each offset line is categorised by its account
        subtype into one of three sections (operating / investing /
        financing) per the standard CF presentation.

        Cash-to-cash transfers (e.g. moving funds between bank accounts)
        net to zero on cash and are excluded.

        The closing cash balance is computed independently from the trial-
        balance snapshot and surfaced as a verification check — should
        equal opening_cash + net_change.
        """
        if entity is None and organization is None:
            raise ValueError("cash_flow_statement: pass entity or organization")

        if reporting_currency is None:
            if entity is not None:
                reporting_currency = entity.functional_currency
            else:
                first = Entity.objects.filter(organization=organization).first()
                reporting_currency = (
                    (first.reporting_currency or first.functional_currency)
                    if first else "USD"
                )

        # Identify cash-class accounts in scope
        org = entity.organization if entity else organization
        cash_account_qs = Account.objects.filter(
            organization=org,
            account_subtype__in=CASH_SUBTYPES,
        )
        if entity is not None:
            cash_account_qs = cash_account_qs.filter(
                Q(entity=entity) | Q(entity__isnull=True),
            )
        cash_account_ids = set(cash_account_qs.values_list("id", flat=True))

        # JEs in the period that hit at least one cash account
        je_qs = JournalEntry.objects.filter(
            status__in=c.JE_LEDGER_IMPACTING,
            date__gte=date_from, date__lte=date_to,
            lines__account_id__in=cash_account_ids,
        ).distinct()
        if entity is not None:
            je_qs = je_qs.filter(entity=entity)
        else:
            je_qs = je_qs.filter(organization=organization)

        je_qs = je_qs.select_related("entity").prefetch_related("lines__account")

        # Aggregate per-section, per-label
        sections = {
            "operating": defaultdict(lambda: ZERO),
            "investing": defaultdict(lambda: ZERO),
            "financing": defaultdict(lambda: ZERO),
        }

        for je in je_qs:
            entity_fc = je.entity.functional_currency
            cash_lines = [ln for ln in je.lines.all() if ln.account_id in cash_account_ids]
            non_cash_lines = [ln for ln in je.lines.all() if ln.account_id not in cash_account_ids]

            if not cash_lines or not non_cash_lines:
                # Pure cash-to-cash transfer (skip — no real cash flow at the entity level)
                # OR pure non-cash (won't happen given our filter, but safe-guard)
                continue

            net_cash_func = sum(
                ((ln.functional_debit or ZERO) - (ln.functional_credit or ZERO))
                for ln in cash_lines
            )
            if net_cash_func == 0:
                continue

            # Translate to reporting currency
            if entity_fc != reporting_currency:
                rate = FXService.rate(
                    from_currency=entity_fc, to_currency=reporting_currency,
                    as_of=je.date,
                )
                net_cash = (net_cash_func * rate).quantize(Decimal("0.0001"))
            else:
                net_cash = net_cash_func

            # Total absolute non-cash movement (denominator for proportional alloc)
            non_cash_total = sum(
                abs((ln.functional_debit or ZERO) - (ln.functional_credit or ZERO))
                for ln in non_cash_lines
            )
            if non_cash_total == 0:
                continue

            for ln in non_cash_lines:
                ln_movement = abs(
                    (ln.functional_debit or ZERO) - (ln.functional_credit or ZERO)
                )
                if ln_movement == 0:
                    continue
                allocation = (net_cash * ln_movement / non_cash_total).quantize(Decimal("0.0001"))
                subtype = ln.account.account_subtype or ""
                meta = CASHFLOW_OFFSET_MAP.get(subtype)
                if meta:
                    section = meta[CF_SECTION]
                    label = meta[CF_LABEL]
                else:
                    # Unmapped subtype falls back to operating with the account's name
                    section = "operating"
                    label = f"Other ({ln.account.name})"
                sections[section][label] += allocation

        def _format_section(section_key: str) -> dict:
            items = sorted(
                sections[section_key].items(),
                key=lambda kv: kv[1],  # negative (outflows) first
            )
            net = sum(sections[section_key].values(), ZERO)
            return {
                "items": [{"label": k, "amount": _s(v)} for k, v in items if v != 0],
                "net": _s(net),
            }

        operating = _format_section("operating")
        investing = _format_section("investing")
        financing = _format_section("financing")
        net_change = (
            Decimal(operating["net"]) +
            Decimal(investing["net"]) +
            Decimal(financing["net"])
        )

        # Opening + closing cash (from trial-balance snapshots)
        opening_cash = _cash_balance_at(
            cash_account_ids, entity=entity, organization=organization,
            as_of=date_from - __import__("datetime").timedelta(days=1),
            reporting_currency=reporting_currency,
        )
        closing_cash = _cash_balance_at(
            cash_account_ids, entity=entity, organization=organization,
            as_of=date_to,
            reporting_currency=reporting_currency,
        )
        # Verification: opening + net_change should equal closing
        derived_closing = opening_cash + net_change
        verification_diff = closing_cash - derived_closing

        return {
            "report_type": "cash_flow",
            "scope": {
                "entity": entity.code if entity else None,
                "organization": organization.id if organization else None,
            },
            "reporting_currency": reporting_currency,
            "method": "direct",
            "period_start": str(date_from),
            "period_end": str(date_to),
            "opening_cash": _s(opening_cash),
            "operating_activities": operating,
            "investing_activities": investing,
            "financing_activities": financing,
            "net_change": _s(net_change),
            "closing_cash": _s(closing_cash),
            "verification": {
                "derived_closing": _s(derived_closing),
                "balance_sheet_closing": _s(closing_cash),
                "difference": _s(verification_diff),
                "matches": abs(verification_diff) <= Decimal("0.01"),
            },
        }

    # ── AP / AR Aging ───────────────────────────────────────────────────────
    @staticmethod
    def ap_aging(
        *,
        entity: Optional[Entity] = None,
        organization=None,
        as_of: Optional[dt_date] = None,
        reporting_currency: Optional[str] = None,
    ):
        """Outstanding bills (status='approved', not yet paid) bucketed by age.

        Buckets: current (not-yet-due), 1-30, 31-60, 61-90, 90+ days overdue.
        Amounts per vendor. If bills are in multiple currencies and
        ``reporting_currency`` is given (or defaulted from the entity's
        functional currency), values are translated via FXService at the
        report date."""
        return _aging(
            model=Bill,
            party_attr="vendor",
            outstanding_statuses=("approved",),
            amount_attr="total",
            due_attr="due_date",
            report_type="ap_aging",
            entity=entity, organization=organization,
            as_of=as_of, reporting_currency=reporting_currency,
            ref_attr="reference",
            extra_ref_attr="bill_number",
        )

    @staticmethod
    def ar_aging(
        *,
        entity: Optional[Entity] = None,
        organization=None,
        as_of: Optional[dt_date] = None,
        reporting_currency: Optional[str] = None,
    ):
        """Outstanding invoices (status='issued') bucketed by age."""
        return _aging(
            model=Invoice,
            party_attr="customer",
            outstanding_statuses=("issued",),
            amount_attr="total",
            due_attr="due_date",
            report_type="ar_aging",
            entity=entity, organization=organization,
            as_of=as_of, reporting_currency=reporting_currency,
            ref_attr="reference",
            extra_ref_attr="invoice_number",
        )

    # ── Drill-down: account → lines → JEs ───────────────────────────────────
    @staticmethod
    def account_ledger(
        *,
        account: Account,
        date_from: Optional[dt_date] = None,
        date_to: Optional[dt_date] = None,
        only_posted: bool = True,
    ):
        """Return every journal line on ``account``, with a running
        balance. Bridges the trial-balance row → its composing journal
        entries (blueprint: 'drill-down from report to entry to source')."""
        qs = JournalLine.objects.filter(account=account).select_related(
            "journal_entry", "journal_entry__entity",
        )
        if only_posted:
            qs = qs.filter(journal_entry__status__in=c.JE_LEDGER_IMPACTING)
        if date_from:
            qs = qs.filter(journal_entry__date__gte=date_from)
        if date_to:
            qs = qs.filter(journal_entry__date__lte=date_to)
        qs = qs.order_by("journal_entry__date", "journal_entry__entry_number", "line_order")

        # Opening balance = sum of lines BEFORE date_from, if set.
        opening_dr = opening_cr = ZERO
        if date_from:
            pre = JournalLine.objects.filter(
                account=account,
                journal_entry__status__in=c.JE_LEDGER_IMPACTING,
                journal_entry__date__lt=date_from,
            ).aggregate(dr=Sum("functional_debit", default=ZERO),
                        cr=Sum("functional_credit", default=ZERO))
            opening_dr = pre["dr"] or ZERO
            opening_cr = pre["cr"] or ZERO

        # Running balance uses the account's normal balance side.
        if account.normal_balance == c.NORMAL_BALANCE_DEBIT:
            running = opening_dr - opening_cr
        else:
            running = opening_cr - opening_dr

        entries = []
        for ln in qs:
            delta = (ln.functional_debit - ln.functional_credit)
            if account.normal_balance == c.NORMAL_BALANCE_CREDIT:
                delta = -delta
            running += delta
            je = ln.journal_entry
            entries.append({
                "line_id": ln.id,
                "journal_entry_id": je.id,
                "entry_number": je.entry_number,
                "date": str(je.date),
                "entity": je.entity.code,
                "memo": je.memo[:120] or ln.description,
                "source_type": je.source_type,
                "source_id": je.source_id,
                "source_ref": je.source_ref,
                "debit": _s(ln.functional_debit),
                "credit": _s(ln.functional_credit),
                "native_currency": ln.currency,
                "native_debit": _s(ln.debit),
                "native_credit": _s(ln.credit),
                "exchange_rate": _s(ln.exchange_rate),
                "running_balance": _s(running),
            })
        return {
            "report_type": "account_ledger",
            "account": {
                "id": account.id, "code": account.code, "name": account.name,
                "type": account.account_type, "subtype": account.account_subtype,
                "normal_balance": account.normal_balance,
            },
            "opening_balance": _s(
                (opening_dr - opening_cr)
                if account.normal_balance == c.NORMAL_BALANCE_DEBIT
                else (opening_cr - opening_dr)
            ),
            "closing_balance": _s(running),
            "entries": entries,
        }

    # ── General ledger — flat line-level listing across accounts ───────────
    @staticmethod
    def lines_listing(
        *,
        entity: Optional[Entity] = None,
        organization=None,
        account: Optional[Account] = None,
        date_from: Optional[dt_date] = None,
        date_to: Optional[dt_date] = None,
        status: Optional[str] = None,
        only_posted: bool = False,
        limit: int = 500,
    ):
        """Flat, cross-account list of every journal line matching the
        filters. Backs the Ledger page — the blueprint's "journal listing /
        running log of every posted line" output.

        Unlike ``account_ledger`` this one spans accounts and entities so
        the user can audit the whole ledger without first picking an
        account. ``only_posted=True`` keeps it strictly ledger-impacting;
        leaving it False lets the UI show drafts / pending lines too.
        """
        qs = JournalLine.objects.select_related(
            "account",
            "journal_entry",
            "journal_entry__entity",
            "counterparty_entity",
        )
        if entity is not None:
            qs = qs.filter(journal_entry__entity=entity)
        elif organization is not None:
            qs = qs.filter(journal_entry__organization=organization)
        if account is not None:
            qs = qs.filter(account=account)
        if only_posted:
            qs = qs.filter(journal_entry__status__in=c.JE_LEDGER_IMPACTING)
        elif status:
            qs = qs.filter(journal_entry__status=status)
        if date_from:
            qs = qs.filter(journal_entry__date__gte=date_from)
        if date_to:
            qs = qs.filter(journal_entry__date__lte=date_to)

        qs = qs.order_by(
            "-journal_entry__date",
            "-journal_entry__entry_number",
            "line_order",
        )[:limit]

        lines = []
        for ln in qs:
            je = ln.journal_entry
            lines.append({
                "line_id": ln.id,
                "journal_entry_id": je.id,
                "entry_number": je.entry_number,
                "date": str(je.date),
                "entity_id": je.entity_id,
                "entity_code": je.entity.code,
                "entity_name": je.entity.name,
                "account_id": ln.account_id,
                "account_code": ln.account.code,
                "account_name": ln.account.name,
                "account_type": ln.account.account_type,
                "memo": (je.memo or ln.description or "")[:160],
                "status": je.status,
                "source_type": je.source_type,
                "debit": _s(ln.functional_debit),
                "credit": _s(ln.functional_credit),
                "native_currency": ln.currency,
                "native_debit": _s(ln.debit),
                "native_credit": _s(ln.credit),
                "exchange_rate": _s(ln.exchange_rate),
                "functional_currency": je.entity.functional_currency,
                "counterparty_entity": (
                    ln.counterparty_entity.code
                    if ln.counterparty_entity_id else None
                ),
            })

        return {
            "report_type": "lines_listing",
            "count": len(lines),
            "filters": {
                "entity": entity.code if entity else None,
                "organization": organization.id if organization else None,
                "account": account.code if account else None,
                "date_from": str(date_from) if date_from else None,
                "date_to": str(date_to) if date_to else None,
                "status": status,
                "only_posted": only_posted,
            },
            "lines": lines,
        }

    # ── Drill-down: single JE with full detail ──────────────────────────────
    @staticmethod
    def entry_detail(*, entry: JournalEntry):
        """Full JE payload: lines with account details, approval history,
        source ref. Consumed by the UI's drill-down pane."""
        lines = []
        for ln in entry.lines.select_related("account", "counterparty_entity").order_by("line_order"):
            lines.append({
                "line_id": ln.id,
                "account_id": ln.account_id,
                "account_code": ln.account.code,
                "account_name": ln.account.name,
                "account_type": ln.account.account_type,
                "description": ln.description,
                "debit": _s(ln.debit),
                "credit": _s(ln.credit),
                "currency": ln.currency,
                "exchange_rate": str(ln.exchange_rate),
                "functional_debit": _s(ln.functional_debit),
                "functional_credit": _s(ln.functional_credit),
                "counterparty_entity": ln.counterparty_entity.code if ln.counterparty_entity_id else None,
            })

        history = []
        for a in ApprovalAction.objects.filter(journal_entry=entry).select_related("actor").order_by("at"):
            history.append({
                "action": a.action,
                "from_status": a.from_status,
                "to_status": a.to_status,
                "actor": a.actor.email if a.actor_id else None,
                "at": a.at.isoformat(),
                "note": a.note,
            })

        # Attached source documents — closes the drill-down chain from
        # report → entry → source (blueprint p.2).
        attachments = []
        for d in entry.documents.filter(is_deleted=False).select_related("uploaded_by").order_by("uploaded_at"):
            attachments.append({
                "id": d.id,
                "filename": d.original_filename,
                "content_type": d.content_type,
                "size_bytes": d.size_bytes,
                "content_hash": d.content_hash,
                "uploaded_by": d.uploaded_by.email if d.uploaded_by_id else None,
                "uploaded_at": d.uploaded_at.isoformat(),
                "description": d.description,
                "url": d.file.url if d.file else None,
            })

        return {
            "report_type": "entry_detail",
            "id": entry.id,
            "entry_number": entry.entry_number,
            "entity": entry.entity.code,
            "entity_name": entry.entity.name,
            "functional_currency": entry.entity.functional_currency,
            "date": str(entry.date),
            "reference": entry.reference,
            "memo": entry.memo,
            "status": entry.status,
            "source_type": entry.source_type,
            "source_id": entry.source_id,
            "source_ref": entry.source_ref,
            "currency": entry.currency,
            "total_debit_functional": _s(entry.total_debit_functional),
            "total_credit_functional": _s(entry.total_credit_functional),
            "is_balanced_functional": entry.is_balanced_functional,
            "intercompany_group_id": entry.intercompany_group_id,
            "counterparty_entity": entry.counterparty_entity.code if entry.counterparty_entity_id else None,
            "period": entry.period.name if entry.period_id else None,
            "reversal_of_id": entry.reversal_of_id,
            "lines": lines,
            "approval_history": history,
            "attachments": attachments,
        }
