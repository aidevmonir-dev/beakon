"""Dashboard-specific report endpoints.

Cash trend: monthly closing balances for bank-subtype accounts. Used by
the Digits-style "Total Cash" widget on the home dashboard.
"""
from __future__ import annotations

from datetime import date as dt_date
from decimal import Decimal

from django.db.models import Sum
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import IsOrganizationMember
from beakon_core import constants as c
from beakon_core.models import Account, Entity, JournalLine


def _month_starts(months: int) -> list[dt_date]:
    """Return the first-of-month for each of the last ``months`` months,
    oldest → newest, ending on the current month."""
    today = dt_date.today()
    out: list[dt_date] = []
    y, m = today.year, today.month
    for _ in range(months):
        out.append(dt_date(y, m, 1))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(out))


def _next_month(d: dt_date) -> dt_date:
    if d.month == 12:
        return dt_date(d.year + 1, 1, 1)
    return dt_date(d.year, d.month + 1, 1)


class CashTrendView(APIView):
    """GET /beakon/reports/cash-trend/?months=12&entity=<id>

    Returns ``{ currency, months: [{month: 'YYYY-MM-01', balance: 'X.XX'}] }``
    where each balance is the closing GL balance on bank-subtype accounts
    at the end of that month.

    All bank accounts in the org's reporting currency are summed. For now
    we don't translate FX — the endpoint assumes a single dominant
    currency, picked by largest closing-balance magnitude.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        org = request.organization
        try:
            months = int(request.query_params.get("months", "12"))
        except ValueError:
            months = 12
        months = max(1, min(months, 60))

        entity_id = request.query_params.get("entity")
        bank_accounts = Account.objects.filter(
            organization=org,
            account_subtype__in=("bank", "cash"),
        )
        if entity_id:
            try:
                bank_accounts = bank_accounts.filter(entity_id=int(entity_id))
            except ValueError:
                return Response(
                    {"detail": "entity must be an integer."},
                    status=http.HTTP_400_BAD_REQUEST,
                )

        # Choose the currency: the one with the largest cumulative bank
        # balance across the org. Cheap-and-correct for our single-ccy
        # demos; multi-ccy translation is a follow-up.
        ccy_totals: dict[str, Decimal] = {}
        for acct_id, ccy in bank_accounts.values_list("id", "currency"):
            agg = (
                JournalLine.objects
                .filter(
                    account_id=acct_id,
                    journal_entry__status=c.JE_POSTED,
                )
                .aggregate(d=Sum("debit"), c=Sum("credit"))
            )
            net = (agg["d"] or Decimal("0")) - (agg["c"] or Decimal("0"))
            ccy_totals[ccy] = ccy_totals.get(ccy, Decimal("0")) + net

        if not ccy_totals:
            return Response({
                "currency": "",
                "months": [],
                "total_now": "0",
                "delta_pct": None,
            })

        currency = max(ccy_totals.items(), key=lambda kv: abs(kv[1]))[0]
        ccy_account_ids = list(
            bank_accounts.filter(currency=currency).values_list("id", flat=True)
        )

        # Closing balance at end of each month = sum(d - c) on these
        # accounts where JE.status=posted and JE.date < first-of-next-month.
        starts = _month_starts(months)
        out: list[dict] = []
        for first in starts:
            cutoff = _next_month(first)
            agg = (
                JournalLine.objects
                .filter(
                    account_id__in=ccy_account_ids,
                    journal_entry__status=c.JE_POSTED,
                    journal_entry__date__lt=cutoff,
                )
                .aggregate(d=Sum("debit"), c=Sum("credit"))
            )
            bal = (agg["d"] or Decimal("0")) - (agg["c"] or Decimal("0"))
            out.append({
                "month": first.isoformat(),
                "balance": str(bal.quantize(Decimal("0.01"))),
            })

        # Headline number = latest closing balance
        total_now = Decimal(out[-1]["balance"]) if out else Decimal("0")
        prior = Decimal(out[-2]["balance"]) if len(out) >= 2 else None
        delta_pct: float | None = None
        if prior is not None and prior != 0:
            delta_pct = float(((total_now - prior) / abs(prior)) * 100)

        return Response({
            "currency": currency,
            "months": out,
            "total_now": str(total_now.quantize(Decimal("0.01"))),
            "delta_pct": delta_pct,
        })
