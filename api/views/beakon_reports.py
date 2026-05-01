"""Beakon kernel report endpoints — trial balance, P&L, balance sheet,
journal listing, account ledger, entry detail.

All read-only; all scoped by organization. The frontend drills down by
chaining: trial-balance row → account-ledger(account_id) → entry-detail(entry_id).
"""
import json
from collections import defaultdict
from datetime import date as dt_date
from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import TruncMonth
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import IsOrganizationMember
from beakon_core import constants as c
from beakon_core.models import Account, Entity, JournalEntry, JournalLine
from beakon_core.services import ReportsService


def _parse_date(s):
    if not s:
        return None
    return dt_date.fromisoformat(s)


def _parse_dimension_filter(request):
    """Parse the ``?dimension_filter=<json>`` query param.

    Wire shape: a JSON object mapping ``DimensionType.code`` → list of
    ``DimensionValue.code`` strings, e.g.
        ?dimension_filter=%7B%22BANK%22%3A%5B%22BANK_A%22%5D%7D

    Returns ``(parsed_dict_or_None, error_response_or_None)``. Malformed
    JSON or non-object values produce a 400 response. The kernel's
    ``ReportsService`` then validates type codes and raises ``ValueError``
    on unknown ones — callers catch that and return 400 too.
    """
    raw = request.query_params.get("dimension_filter")
    if not raw:
        return None, None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        return None, Response(
            {"error": {"message": f"Invalid JSON in dimension_filter: {e}"}},
            status=http.HTTP_400_BAD_REQUEST,
        )
    if not isinstance(data, dict):
        return None, Response(
            {"error": {"message": "dimension_filter must be a JSON object"}},
            status=http.HTTP_400_BAD_REQUEST,
        )
    return data, None


def _bad_request(message):
    return Response({"error": {"message": message}}, status=http.HTTP_400_BAD_REQUEST)


def _resolve_entity(request):
    """Optional entity_id query param — None means consolidated."""
    entity_id = request.query_params.get("entity_id")
    if not entity_id:
        return None
    try:
        return Entity.objects.get(id=entity_id, organization=request.organization)
    except Entity.DoesNotExist:
        return "NOT_FOUND"


class _ReportBase(APIView):
    """Shared scoping for every report view."""
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def _scope(self, request):
        """Return (entity, organization) where exactly one is not None.
        entity=None + organization=request.organization = consolidated.
        """
        entity = _resolve_entity(request)
        if entity == "NOT_FOUND":
            return None, None, Response(status=http.HTTP_404_NOT_FOUND)
        organization = None if entity else request.organization
        return entity, organization, None


class TrialBalanceView(_ReportBase):
    def get(self, request):
        entity, organization, err = self._scope(request)
        if err is not None:
            return err
        as_of = _parse_date(request.query_params.get("as_of"))
        if not as_of:
            return _bad_request("as_of is required (YYYY-MM-DD)")
        reporting_currency = request.query_params.get("reporting_currency") or None
        df, df_err = _parse_dimension_filter(request)
        if df_err:
            return df_err
        try:
            data = ReportsService.trial_balance(
                entity=entity, organization=organization,
                as_of=as_of, reporting_currency=reporting_currency,
                dimension_filter=df,
            )
        except ValueError as e:
            return _bad_request(str(e))
        return Response(data)


class ProfitLossView(_ReportBase):
    def get(self, request):
        entity, organization, err = self._scope(request)
        if err is not None:
            return err
        date_from = _parse_date(request.query_params.get("date_from"))
        date_to = _parse_date(request.query_params.get("date_to"))
        if not date_from or not date_to:
            return _bad_request("date_from and date_to are required")
        reporting_currency = request.query_params.get("reporting_currency") or None
        df, df_err = _parse_dimension_filter(request)
        if df_err:
            return df_err
        try:
            data = ReportsService.profit_loss(
                entity=entity, organization=organization,
                date_from=date_from, date_to=date_to,
                reporting_currency=reporting_currency,
                dimension_filter=df,
            )
        except ValueError as e:
            return _bad_request(str(e))
        return Response(data)


class BalanceSheetView(_ReportBase):
    def get(self, request):
        entity, organization, err = self._scope(request)
        if err is not None:
            return err
        as_of = _parse_date(request.query_params.get("as_of"))
        if not as_of:
            return _bad_request("as_of is required (YYYY-MM-DD)")
        reporting_currency = request.query_params.get("reporting_currency") or None
        df, df_err = _parse_dimension_filter(request)
        if df_err:
            return df_err
        try:
            data = ReportsService.balance_sheet(
                entity=entity, organization=organization,
                as_of=as_of, reporting_currency=reporting_currency,
                dimension_filter=df,
            )
        except ValueError as e:
            return _bad_request(str(e))
        return Response(data)


class CashFlowView(_ReportBase):
    def get(self, request):
        entity, organization, err = self._scope(request)
        if err is not None:
            return err
        date_from = _parse_date(request.query_params.get("date_from"))
        date_to = _parse_date(request.query_params.get("date_to"))
        if not date_from or not date_to:
            return Response(
                {"error": {"message": "date_from and date_to are required"}},
                status=http.HTTP_400_BAD_REQUEST,
            )
        reporting_currency = request.query_params.get("reporting_currency") or None
        data = ReportsService.cash_flow_statement(
            entity=entity, organization=organization,
            date_from=date_from, date_to=date_to,
            reporting_currency=reporting_currency,
        )
        return Response(data)


class APAgingView(_ReportBase):
    def get(self, request):
        entity, organization, err = self._scope(request)
        if err is not None:
            return err
        as_of = _parse_date(request.query_params.get("as_of")) or dt_date.today()
        reporting_currency = request.query_params.get("reporting_currency") or None
        data = ReportsService.ap_aging(
            entity=entity, organization=organization,
            as_of=as_of, reporting_currency=reporting_currency,
        )
        return Response(data)


class ARAgingView(_ReportBase):
    def get(self, request):
        entity, organization, err = self._scope(request)
        if err is not None:
            return err
        as_of = _parse_date(request.query_params.get("as_of")) or dt_date.today()
        reporting_currency = request.query_params.get("reporting_currency") or None
        data = ReportsService.ar_aging(
            entity=entity, organization=organization,
            as_of=as_of, reporting_currency=reporting_currency,
        )
        return Response(data)


class JournalListingView(_ReportBase):
    def get(self, request):
        entity, organization, err = self._scope(request)
        if err is not None:
            return err
        data = ReportsService.journal_listing(
            entity=entity, organization=organization,
            date_from=_parse_date(request.query_params.get("date_from")),
            date_to=_parse_date(request.query_params.get("date_to")),
            status=request.query_params.get("status") or None,
            source_type=request.query_params.get("source_type") or None,
            limit=int(request.query_params.get("limit", 200)),
        )
        return Response(data)


class LinesListingView(_ReportBase):
    """Flat cross-account line listing — the general-ledger view.

    Backs the ``/dashboard/ledger`` page. Filters: entity, account, date
    range, status, only_posted.
    """

    def get(self, request):
        entity, organization, err = self._scope(request)
        if err is not None:
            return err

        account = None
        account_id = request.query_params.get("account_id")
        if account_id:
            try:
                account = Account.objects.get(
                    id=account_id, organization=request.organization,
                )
            except Account.DoesNotExist:
                return Response(status=http.HTTP_404_NOT_FOUND)

        only_posted = request.query_params.get("only_posted", "false").lower() == "true"
        data = ReportsService.lines_listing(
            entity=entity, organization=organization, account=account,
            date_from=_parse_date(request.query_params.get("date_from")),
            date_to=_parse_date(request.query_params.get("date_to")),
            status=request.query_params.get("status") or None,
            only_posted=only_posted,
            limit=int(request.query_params.get("limit", 500)),
        )
        return Response(data)


class AccountLedgerView(APIView):
    """Drill-down: all journal lines against an account, with running balance."""
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        account_id = request.query_params.get("account_id")
        if not account_id:
            return _bad_request("account_id is required")
        try:
            account = Account.objects.get(id=account_id, organization=request.organization)
        except Account.DoesNotExist:
            return Response(status=http.HTTP_404_NOT_FOUND)
        df, df_err = _parse_dimension_filter(request)
        if df_err:
            return df_err
        try:
            data = ReportsService.account_ledger(
                account=account,
                date_from=_parse_date(request.query_params.get("date_from")),
                date_to=_parse_date(request.query_params.get("date_to")),
                only_posted=request.query_params.get("only_posted", "true").lower() != "false",
                dimension_filter=df,
            )
        except ValueError as e:
            return _bad_request(str(e))
        return Response(data)


class EntryDetailView(APIView):
    """Drill-down: one JE with lines + approval history. Same as retrieving
    a JournalEntry at /journal-entries/{id}/ but exposed here as a report
    surface for consistency with the report pattern.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        entry_id = request.query_params.get("entry_id")
        if not entry_id:
            return _bad_request("entry_id is required")
        try:
            entry = JournalEntry.objects.select_related(
                "entity", "period", "reversal_of",
            ).prefetch_related("lines__account", "approval_actions__actor").get(
                id=entry_id, organization=request.organization,
            )
        except JournalEntry.DoesNotExist:
            return Response(status=http.HTTP_404_NOT_FOUND)
        df, df_err = _parse_dimension_filter(request)
        if df_err:
            return df_err
        try:
            data = ReportsService.entry_detail(entry=entry, dimension_filter=df)
        except ValueError as e:
            return _bad_request(str(e))
        return Response(data)


def _month_starts_back(n: int):
    """Return n month-start dates ending with the current month (oldest first)."""
    today = dt_date.today()
    cur_year, cur_month = today.year, today.month
    starts = []
    for i in range(n - 1, -1, -1):
        m = cur_month - i
        y = cur_year
        while m <= 0:
            m += 12
            y -= 1
        starts.append(dt_date(y, m, 1))
    return starts


class AccountSummaryView(_ReportBase):
    """Per-account current balance + 12-month sparkline of month-end balances.

    Read-only. Balances are in each account's own line functional-currency
    amounts (no cross-currency FX translation) — safe for visual drill-down
    but not a substitute for the trial balance.

    Sign convention: debit-normal accounts (asset, expense) report
    (debits - credits); credit-normal (liability, equity, revenue) report
    (credits - debits). Both come out positive in normal operations.
    """

    def get(self, request):
        entity, organization, err = self._scope(request)
        if err is not None:
            return err

        lines = JournalLine.objects.filter(
            journal_entry__status__in=c.JE_LEDGER_IMPACTING,
        )
        if entity is not None:
            lines = lines.filter(journal_entry__entity=entity)
        else:
            lines = lines.filter(journal_entry__organization=organization)

        # Aggregate once: for each (account_id, month) → (dr, cr).
        buckets = (
            lines
            .annotate(m=TruncMonth("journal_entry__date"))
            .values("account_id", "m")
            .annotate(dr=Sum("functional_debit"), cr=Sum("functional_credit"))
        )

        # per_account[account_id][year, month] = (dr, cr)
        per_account: dict = defaultdict(dict)
        for b in buckets:
            d = b["m"]
            if d is None:
                continue
            per_account[b["account_id"]][(d.year, d.month)] = (
                b["dr"] or Decimal("0"),
                b["cr"] or Decimal("0"),
            )

        # Load account metadata (scope by org + optional entity — include
        # shared accounts when filtering by entity).
        acc_qs = Account.objects.filter(organization=request.organization)
        if entity is not None:
            from django.db.models import Q
            acc_qs = acc_qs.filter(Q(entity=entity) | Q(entity__isnull=True))

        debit_normal_types = {c.ACCOUNT_TYPE_ASSET, c.ACCOUNT_TYPE_EXPENSE}

        month_starts = _month_starts_back(12)
        # Target month-keys (year, month).
        month_keys = [(d.year, d.month) for d in month_starts]

        results = []
        for acc in acc_qs:
            totals = per_account.get(acc.id, {})
            # Running balance at end of each of the 12 months (oldest → newest).
            running_dr = Decimal("0")
            running_cr = Decimal("0")
            spark = []
            # Determine all months actually touched + the 12 target months.
            # Iterate months chronologically from earliest touched to latest
            # target, accumulating.
            # We need running totals; simplest is to accumulate only through
            # the target months' cutoffs.
            # For simplicity: compute cumulative dr/cr up to and including
            # each of the 12 target months by summing entries whose (y, m)
            # is <= target.
            # To do this in O(N) rather than O(N*12), sort touched months and
            # accumulate alongside the target sequence.
            touched = sorted(totals.keys())
            ti = 0
            for tm in month_keys:
                while ti < len(touched) and touched[ti] <= tm:
                    dr, cr = totals[touched[ti]]
                    running_dr += dr
                    running_cr += cr
                    ti += 1
                if acc.account_type in debit_normal_types:
                    bal = running_dr - running_cr
                else:
                    bal = running_cr - running_dr
                spark.append(float(bal))

            # Final running totals include every month (even after last target,
            # which shouldn't happen since target ends at current month) —
            # ensure we've consumed all.
            while ti < len(touched):
                dr, cr = totals[touched[ti]]
                running_dr += dr
                running_cr += cr
                ti += 1
            if acc.account_type in debit_normal_types:
                current = running_dr - running_cr
            else:
                current = running_cr - running_dr

            results.append({
                "id": acc.id,
                "balance": str(current),
                "sparkline": spark,
            })

        return Response({
            "as_of": dt_date.today().isoformat(),
            "months": [d.isoformat() for d in month_starts],
            "accounts": results,
        })
