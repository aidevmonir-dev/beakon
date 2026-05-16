"""Wealth-management dashboard aggregations.

Read-only views that crunch ``PositionSnapshot`` + ``PerformanceSnapshot``
into the shapes the Wealth dashboard cards need. No new write surface.

Endpoints:

  GET /beakon/wealth/summary/?as_of=YYYY-MM-DD
      AUM headline, value-weighted YTD return, top portfolios/holdings,
      asset-class allocation, custodian overview.

  GET /beakon/wealth/performance-trend/?months=12
      Total AUM at each month-end across the trailing N months. Each
      point uses the most-recent per-portfolio snapshot with
      ``as_of <= the month-end``.

All currency translation is naive — we assume snapshots already share a
single reporting currency. Multi-currency translation is a follow-up
when the snapshots start carrying mixed denominations.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date as dt_date, timedelta
from decimal import Decimal

from django.db.models import Max, Q
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import IsOrganizationMember
from beakon_core.models import Custodian, Instrument, Portfolio
from beakon_core.models.portfolio_feed import (
    PERF_YTD, PerformanceSnapshot, PositionSnapshot,
)


ZERO = Decimal("0")
HUNDRED = Decimal("100")


def _s(d: Decimal | None) -> str:
    """JSON-friendly 2dp string for a Decimal."""
    return str((d or ZERO).quantize(Decimal("0.01")))


def _label_asset_class(code: str) -> str:
    """Map workbook ``ACL_*`` code → friendly label."""
    if not code:
        return "Other"
    labels = {
        "ACL_EQUITY": "Equities",
        "ACL_LISTED_EQUITY": "Equities",
        "ACL_EQUITIES": "Equities",
        "ACL_FIXED_INCOME": "Fixed Income",
        "ACL_BOND": "Fixed Income",
        "ACL_BONDS": "Fixed Income",
        "ACL_CASH": "Cash",
        "ACL_ALTERNATIVES": "Alternatives",
        "ACL_PRIVATE_EQUITY": "Alternatives",
        "ACL_HEDGE_FUND": "Alternatives",
        "ACL_REAL_ESTATE": "Real Estate",
        "ACL_COMMODITIES": "Commodities",
        "ACL_CRYPTO": "Crypto",
    }
    if code in labels:
        return labels[code]
    return code.replace("ACL_", "").replace("_", " ").title() or "Other"


def _month_ends(today: dt_date, n: int) -> list[dt_date]:
    """Last day of each of the trailing n months, earliest first."""
    out: list[dt_date] = []
    y, m = today.year, today.month
    for i in range(n - 1, -1, -1):
        mm = m - i
        yy = y
        while mm <= 0:
            mm += 12
            yy -= 1
        next_first = (
            dt_date(yy + 1, 1, 1) if mm == 12 else dt_date(yy, mm + 1, 1)
        )
        out.append(next_first - timedelta(days=1))
    return out


class WealthSummaryView(APIView):
    """GET /beakon/wealth/summary/?as_of=YYYY-MM-DD"""
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        org = request.organization
        as_of_param = request.query_params.get("as_of")
        as_of: dt_date | None
        try:
            as_of = dt_date.fromisoformat(as_of_param) if as_of_param else None
        except ValueError:
            return Response(
                {"detail": "as_of must be YYYY-MM-DD"},
                status=http.HTTP_400_BAD_REQUEST,
            )

        # ── Latest as_of per portfolio (clamped to as_of when given) ──
        latest_q = PositionSnapshot.objects.filter(organization=org)
        if as_of is not None:
            latest_q = latest_q.filter(as_of__lte=as_of)
        latest_map = list(
            latest_q.values("portfolio_id").annotate(max_as_of=Max("as_of"))
        )
        keys = [(r["portfolio_id"], r["max_as_of"]) for r in latest_map]
        if not keys:
            return Response(self._empty(org))

        # Fetch the matching positions
        key_q = Q()
        for pid, ad in keys:
            key_q |= Q(portfolio_id=pid, as_of=ad)
        latest_positions = list(
            PositionSnapshot.objects
            .filter(organization=org)
            .filter(key_q)
            .select_related("portfolio")
        )

        # ── Aggregations ──────────────────────────────────────────────
        aum = ZERO
        per_portfolio: dict[int, dict] = defaultdict(
            lambda: {"value": ZERO, "portfolio": None},
        )
        per_isin: dict[str, dict] = defaultdict(
            lambda: {"value": ZERO, "instrument_name": "", "isin": ""},
        )
        per_custodian: dict[str, Decimal] = defaultdict(lambda: ZERO)
        isin_to_custodian: dict[str, str] = {}

        for p in latest_positions:
            v = Decimal(str(p.market_value or 0))
            aum += v
            pp = per_portfolio[p.portfolio_id]
            pp["value"] += v
            pp["portfolio"] = p.portfolio
            ii = per_isin[p.isin]
            ii["value"] += v
            ii["instrument_name"] = ii["instrument_name"] or (p.instrument_name or "")
            ii["isin"] = p.isin

            cust_obj = getattr(p.portfolio, "linked_custodian_obj", None)
            cust_name = (
                (cust_obj.short_name or cust_obj.custodian_name)
                if cust_obj else "Unallocated"
            )
            per_custodian[cust_name] += v
            isin_to_custodian.setdefault(p.isin, cust_name)

        # ISIN → asset_class via Instrument
        isin_to_class: dict[str, str] = {}
        if per_isin:
            for inst in Instrument.objects.filter(
                organization=org,
                isin_or_ticker__in=list(per_isin.keys()),
            ).values("isin_or_ticker", "asset_class_code"):
                isin_to_class[inst["isin_or_ticker"]] = (
                    inst["asset_class_code"] or ""
                )

        # ── Latest YTD return per portfolio ──
        perf_rows = (
            PerformanceSnapshot.objects
            .filter(
                organization=org,
                period=PERF_YTD,
                portfolio_id__in=[k[0] for k in keys],
            )
            .order_by("portfolio_id", "-as_of")
        )
        latest_perf: dict[int, Decimal] = {}
        for r in perf_rows:
            if r.portfolio_id not in latest_perf:
                latest_perf[r.portfolio_id] = Decimal(str(r.return_pct))

        # ── Top portfolios ──
        top_portfolios = sorted(
            per_portfolio.items(), key=lambda kv: kv[1]["value"], reverse=True,
        )[:4]
        top_portfolios_out = []
        for pid, pp in top_portfolios:
            pf = pp["portfolio"]
            ret = latest_perf.get(pid)
            top_portfolios_out.append({
                "portfolio_code": pf.portfolio_id if pf else "",
                "portfolio_name": pf.portfolio_name if pf else "",
                "value": _s(pp["value"]),
                "ytd_return_pct":
                    float((ret / HUNDRED).quantize(Decimal("0.0001")))
                    if ret is not None else None,
            })

        # ── Top holdings ──
        top_holdings = sorted(
            per_isin.values(), key=lambda x: x["value"], reverse=True,
        )[:5]
        top_holdings_out = []
        for h in top_holdings:
            weight = (h["value"] / aum * HUNDRED) if aum else ZERO
            top_holdings_out.append({
                "isin": h["isin"],
                "instrument_name": h["instrument_name"] or h["isin"],
                "asset_class": _label_asset_class(isin_to_class.get(h["isin"], "")),
                "custodian": isin_to_custodian.get(h["isin"], ""),
                "market_value": _s(h["value"]),
                "weight_pct": float(weight.quantize(Decimal("0.1"))),
            })

        # ── Asset class allocation ──
        per_class: dict[str, Decimal] = defaultdict(lambda: ZERO)
        for isin, info in per_isin.items():
            cls = isin_to_class.get(isin, "")
            per_class[cls] += info["value"]
        by_asset_class = []
        for cls, v in sorted(per_class.items(), key=lambda kv: kv[1], reverse=True):
            by_asset_class.append({
                "asset_class": _label_asset_class(cls),
                "value": _s(v),
                "pct": float((v / aum * HUNDRED).quantize(Decimal("0.1")))
                       if aum else 0.0,
            })

        # ── By custodian ──
        by_custodian = []
        for name, v in sorted(per_custodian.items(), key=lambda kv: kv[1], reverse=True):
            by_custodian.append({
                "custodian_name": name,
                "value": _s(v),
                "pct": float((v / aum * HUNDRED).quantize(Decimal("0.1")))
                       if aum else 0.0,
            })

        # ── AUM delta vs ~90 days ago ──
        latest_as_of = max(keys, key=lambda k: k[1])[1]
        prior_target = latest_as_of - timedelta(days=90)
        prior_per_pf: dict[int, Decimal] = {}
        for r in (
            PositionSnapshot.objects
            .filter(organization=org, as_of__lte=prior_target)
            .values("portfolio_id", "as_of", "market_value")
            .order_by("portfolio_id", "-as_of")
        ):
            pid = r["portfolio_id"]
            if pid in prior_per_pf:
                continue
            prior_per_pf[pid] = Decimal(str(r["market_value"] or 0))
        # Re-aggregate by *summing* the latest-on-or-before-prior_target
        # snapshot per portfolio. The list-comprehension above only
        # captures one row per (portfolio, as_of); we need to sum across
        # all ISINs at that as_of. Re-fetch with a tighter query.
        prior_aum = ZERO
        if prior_per_pf:
            # Build (pid, max_as_of) pairs
            prior_keys: list[tuple[int, dt_date]] = []
            for pid in prior_per_pf.keys():
                max_ad = (
                    PositionSnapshot.objects
                    .filter(organization=org, portfolio_id=pid,
                            as_of__lte=prior_target)
                    .aggregate(m=Max("as_of"))["m"]
                )
                if max_ad:
                    prior_keys.append((pid, max_ad))
            if prior_keys:
                pq = Q()
                for pid, ad in prior_keys:
                    pq |= Q(portfolio_id=pid, as_of=ad)
                prior_aum = sum(
                    (Decimal(str(r["market_value"] or 0))
                     for r in PositionSnapshot.objects
                        .filter(organization=org).filter(pq)
                        .values("market_value")),
                    ZERO,
                )
        aum_delta_pct = (
            float(((aum - prior_aum) / prior_aum).quantize(Decimal("0.0001")))
            if prior_aum else None
        )

        # ── Value-weighted YTD return ──
        w_sum = ZERO
        w_w = ZERO
        for pid, ret in latest_perf.items():
            w = per_portfolio.get(pid, {}).get("value", ZERO)
            w_sum += w * ret
            w_w += w
        ytd_return_pct = (
            float((w_sum / w_w / HUNDRED).quantize(Decimal("0.0001")))
            if w_w else None
        )

        # ── Currency (most common across positions) ──
        ccy_counter: Counter[str] = Counter()
        for p in latest_positions:
            if p.currency:
                ccy_counter[p.currency] += 1
        currency = (
            ccy_counter.most_common(1)[0][0]
            if ccy_counter
            else (latest_positions[0].portfolio.reporting_currency
                  if latest_positions else "")
        )

        return Response({
            "currency": currency,
            "as_of": str(latest_as_of),
            "aum": _s(aum),
            "aum_delta_pct": aum_delta_pct,
            "ytd_return_pct": ytd_return_pct,
            "portfolio_count": Portfolio.objects.filter(organization=org).count(),
            "custodian_count": Custodian.objects.filter(organization=org).count(),
            "top_portfolios": top_portfolios_out,
            "top_holdings": top_holdings_out,
            "by_asset_class": by_asset_class,
            "by_custodian": by_custodian,
        })

    def _empty(self, org):
        return {
            "currency": "",
            "as_of": None,
            "aum": "0",
            "aum_delta_pct": None,
            "ytd_return_pct": None,
            "portfolio_count": Portfolio.objects.filter(organization=org).count(),
            "custodian_count": Custodian.objects.filter(organization=org).count(),
            "top_portfolios": [],
            "top_holdings": [],
            "by_asset_class": [],
            "by_custodian": [],
        }


class WealthPerformanceTrendView(APIView):
    """GET /beakon/wealth/performance-trend/?months=12"""
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        org = request.organization
        try:
            months = int(request.query_params.get("months", "12"))
        except ValueError:
            months = 12
        months = max(1, min(months, 36))

        month_ends = _month_ends(dt_date.today(), months)

        # Pull all positions ordered, then iterate to pick per-portfolio
        # most-recent for each month-end.
        snapshots = list(
            PositionSnapshot.objects
            .filter(organization=org)
            .values("portfolio_id", "as_of", "market_value", "currency")
            .order_by("portfolio_id", "-as_of")
        )
        by_pf: dict[int, list] = defaultdict(list)
        for s in snapshots:
            by_pf[s["portfolio_id"]].append(s)

        rows = []
        ccy = ""
        for me in month_ends:
            total = ZERO
            for _, ordered in by_pf.items():
                pick = next((r for r in ordered if r["as_of"] <= me), None)
                if pick:
                    total += Decimal(str(pick["market_value"] or 0))
                    if not ccy and pick["currency"]:
                        ccy = pick["currency"]
            rows.append({"month": me.isoformat(), "value": _s(total)})

        if not ccy:
            first = Portfolio.objects.filter(organization=org).first()
            ccy = first.reporting_currency if first else ""

        return Response({"currency": ccy, "months": rows})
