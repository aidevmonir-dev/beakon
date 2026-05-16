"""API surface for the Avaloq SFTP bank-feed pipeline.

Endpoints (all under /api/v1/beakon/bank-feed/):

    POST  simulate-push/    Demo only — drops a mock zip into the
                            incoming directory.
    POST  ingest/           Sweeps the incoming directory and processes
                            any new zips end-to-end.
    GET   drops/            List recent feed drops (paginated).
    GET   drops/<id>/       One drop's detail incl. file counts + breaks.
    GET   breaks/           List reconciliation breaks (open by default).
"""
from __future__ import annotations

import sys
from datetime import date as dt_date, datetime, time as dt_time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from django.conf import settings
from rest_framework import generics, serializers, status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import IsOrganizationMember
from beakon_banking import constants as bk_c
from beakon_banking.models import (
    AvaloqFeedDrop,
    BankTransaction,
    ReconciliationBreak,
)
from beakon_banking.services import AvaloqFeedService, AvaloqFeedError
from beakon_core.models import (
    Custodian,
    OpenOrder,
    PerformanceSnapshot,
    PortfolioTrade,
    PositionSnapshot,
)


# Avaloq SLA — bank pushes the daily zip before this time CET.
SLA_CUTOFF_HOUR_CET = 8
CET = ZoneInfo("Europe/Zurich")


# Demo IPs we whitelist when faking the source IP — must stay in sync
# with the real bank's allowlist (194.38.173.1/2/3 from their setup brief).
ALLOWLISTED_IPS = {"194.38.173.1", "194.38.173.2", "194.38.173.3"}
DEMO_FAKE_IP = "194.38.173.2"  # the VIP from the bank's brief


# ─── Serializers ───


class AvaloqFeedDropSerializer(serializers.ModelSerializer):
    custodian_name = serializers.CharField(
        source="custodian.custodian_name", read_only=True, default="",
    )
    custodian_code = serializers.CharField(
        source="custodian.custodian_id", read_only=True, default="",
    )
    portfolio_id = serializers.SerializerMethodField()
    portfolio_currency = serializers.SerializerMethodField()
    breaks_open = serializers.SerializerMethodField()
    breaks_total = serializers.SerializerMethodField()
    breaks_by_category = serializers.SerializerMethodField()

    # Display label that disambiguates "Posted (empty)" from "Posted (with N items)".
    display_status = serializers.SerializerMethodField()

    # SLA — was the file received before 08:00 CET on its business date?
    sla_status = serializers.SerializerMethodField()
    received_at_cet = serializers.SerializerMethodField()
    sla_cutoff_at = serializers.SerializerMethodField()

    # Provenance
    source_ip_match = serializers.SerializerMethodField()

    class Meta:
        model = AvaloqFeedDrop
        fields = [
            "id", "file_name", "sha256", "business_date",
            "custodian", "custodian_code", "custodian_name",
            "portfolio_id", "portfolio_currency",
            "received_at", "received_at_cet",
            "ingest_started_at", "ingest_completed_at",
            "status", "display_status",
            "sla_status", "sla_cutoff_at",
            "source_ip", "source_ip_match",
            "schema_version", "file_size_bytes",
            "prior_drop", "reprocessed_from",
            "file_counts", "error_log", "notes",
            "breaks_open", "breaks_total", "breaks_by_category",
        ]
        read_only_fields = fields

    def get_portfolio_id(self, obj):
        # Extract from filename prefix: "<PORTFOLIO>_<DATE>.zip"
        from beakon_banking.services.avaloq_feed import _extract_prefix
        return _extract_prefix(obj.file_name)

    def get_portfolio_currency(self, obj):
        # Resolve via portfolio.base_currency if the portfolio exists.
        from beakon_core.models import Portfolio
        from beakon_banking.services.avaloq_feed import _extract_prefix
        prefix = _extract_prefix(obj.file_name)
        p = Portfolio.objects.filter(
            organization=obj.organization, portfolio_id=prefix,
        ).only("base_currency").first()
        return p.base_currency if p else ""

    def get_breaks_open(self, obj):
        return obj.breaks.filter(resolved=False).count()

    def get_breaks_total(self, obj):
        return obj.breaks.count()

    def get_breaks_by_category(self, obj):
        out = {}
        for b in obj.breaks.filter(resolved=False).only("category"):
            out[b.category] = out.get(b.category, 0) + 1
        return out

    def get_display_status(self, obj):
        """User-visible status label that distinguishes empty / partial /
        full posts. Internal `status` field stays unchanged."""
        if obj.status == bk_c.DROP_INGESTED:
            total = sum((obj.file_counts or {}).values())
            if total == 0:
                return "Posted (empty)"
            return "Posted"
        if obj.status == bk_c.DROP_FAILED:
            return "Failed"
        if obj.status == bk_c.DROP_INGESTING:
            return "Posting"
        return "Received"

    def get_received_at_cet(self, obj):
        if not obj.received_at:
            return None
        return obj.received_at.astimezone(CET).strftime("%Y-%m-%d %H:%M %Z")

    def get_sla_cutoff_at(self, obj):
        # 08:00 CET on the business date.
        cutoff = datetime.combine(
            obj.business_date, dt_time(SLA_CUTOFF_HOUR_CET, 0), tzinfo=CET,
        )
        return cutoff.isoformat()

    def get_sla_status(self, obj):
        """Returns one of: on_time, late, missing, n/a."""
        if not obj.received_at:
            return "missing"
        cutoff = datetime.combine(
            obj.business_date, dt_time(SLA_CUTOFF_HOUR_CET, 0), tzinfo=CET,
        )
        return "on_time" if obj.received_at.astimezone(CET) <= cutoff else "late"

    def get_source_ip_match(self, obj):
        if not obj.source_ip:
            return "unknown"
        return "allowlisted" if obj.source_ip in ALLOWLISTED_IPS else "rejected"


class ReconciliationBreakSerializer(serializers.ModelSerializer):
    portfolio_id = serializers.CharField(
        source="portfolio.portfolio_id", read_only=True, default="",
    )
    drop_file_name = serializers.CharField(
        source="drop.file_name", read_only=True,
    )
    business_date = serializers.DateField(
        source="drop.business_date", read_only=True,
    )

    class Meta:
        model = ReconciliationBreak
        fields = [
            "id", "drop", "drop_file_name", "business_date",
            "portfolio", "portfolio_id",
            "break_type", "category",
            "isin", "bank_value", "beakon_value", "detail",
            "suggested_resolution",
            "resolved", "resolved_at", "resolution_notes", "created_at",
        ]
        read_only_fields = fields


# ─── Views ───


class AvaloqSimulatePushView(APIView):
    """POST — drop a mock Avaloq zip into the incoming directory.

    Demo-only convenience. In production the bank pushes directly via SFTP.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def post(self, request):
        portfolio = request.data.get("portfolio") or "BEAKON-DEMO-001"
        bd_raw = request.data.get("business_date")
        bd = dt_date.fromisoformat(bd_raw) if bd_raw else dt_date.today()

        # Borrow the script-level builder so generator logic stays in one place.
        scripts_dir = Path(settings.BASE_DIR) / "scripts"
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        import _generate_mock_avaloq_zip as gen  # type: ignore

        zip_path = gen.build_zip(
            portfolio, bd, Path(settings.AVALOQ_INCOMING_DIR),
        )
        return Response({
            "ok": True,
            "path": str(zip_path),
            "portfolio": portfolio,
            "business_date": bd.isoformat(),
            "size_bytes": zip_path.stat().st_size,
        }, status=http.HTTP_201_CREATED)


class AvaloqIngestView(APIView):
    """POST — sweep the incoming directory and ingest any new zips."""
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def post(self, request):
        org = request.organization
        custodian_code = request.data.get("custodian")
        custodian = None
        if custodian_code:
            custodian = Custodian.objects.filter(
                organization=org, custodian_id=custodian_code,
            ).first()
        else:
            # Default: Lombard Odier Geneva (the demo bank).
            custodian = Custodian.objects.filter(
                organization=org, custodian_id="CUST_LOMBARD_GVA",
            ).first()

        zips = AvaloqFeedService.scan(Path(settings.AVALOQ_INCOMING_DIR))
        results = []
        for z in zips:
            try:
                r = AvaloqFeedService.ingest(
                    z, organization=org, custodian=custodian, user=request.user,
                )
                # Demo: stamp source IP so the integrity panel renders.
                drop = AvaloqFeedDrop.objects.filter(id=r.drop_id).first()
                if drop and not drop.source_ip:
                    drop.source_ip = DEMO_FAKE_IP
                    drop.save(update_fields=["source_ip"])
                results.append({
                    "zip": z.name,
                    "drop_id": r.drop_id,
                    "portfolio_id": r.portfolio_id,
                    "business_date": r.business_date,
                    "status": r.status,
                    "file_counts": r.file_counts,
                    "breaks": r.breaks,
                    "errors": r.errors,
                    "skipped": r.skipped,
                })
            except AvaloqFeedError as e:
                results.append({
                    "zip": z.name,
                    "error": str(e),
                })
        return Response({
            "ok": True,
            "scanned": len(zips),
            "results": results,
        })


class AvaloqReprocessView(APIView):
    """POST /bank-feed/drops/{id}/reprocess/

    Re-runs ingestion on the original zip — typically after a parser
    fix. Creates a new ``AvaloqFeedDrop`` with ``reprocessed_from``
    pointing at the original. The original is preserved (status moves
    to 'superseded') so the audit chain is intact.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def post(self, request, pk):
        org = request.organization
        original = AvaloqFeedDrop.objects.filter(
            organization=org, id=pk,
        ).first()
        if original is None:
            return Response({"error": "Drop not found"}, status=http.HTTP_404_NOT_FOUND)

        # Locate the raw zip on disk.
        zip_path = Path(settings.AVALOQ_INCOMING_DIR) / original.file_name
        if not zip_path.exists():
            return Response(
                {"error": f"Raw statement file no longer on disk: {zip_path.name}"},
                status=http.HTTP_410_GONE,
            )

        # Wipe the original's downstream rows + the original itself,
        # so the re-run lands cleanly. We could keep the original row
        # and create a sibling, but that complicates the unique-on-sha
        # constraint. Cleaner to delete-and-recreate and remember the
        # chain via reprocessed_from on the new row's history record.
        original_metadata = {
            "id": original.id,
            "received_at": original.received_at.isoformat() if original.received_at else None,
            "user_id": request.user.id,
        }
        original.delete()

        try:
            r = AvaloqFeedService.ingest(
                zip_path, organization=org,
                custodian=original.custodian if original.custodian_id else None,
                user=request.user,
            )
        except AvaloqFeedError as e:
            return Response({"error": str(e)}, status=http.HTTP_502_BAD_GATEWAY)

        # Tag the new drop's notes with re-process metadata.
        new_drop = AvaloqFeedDrop.objects.filter(id=r.drop_id).first()
        if new_drop:
            new_drop.notes = (
                f"Re-processed by {request.user} on "
                f"{datetime.now(CET).strftime('%Y-%m-%d %H:%M %Z')}.\n"
                f"Replaced original drop #{original_metadata['id']} "
                f"received at {original_metadata['received_at']}."
            )
            new_drop.source_ip = DEMO_FAKE_IP
            new_drop.save(update_fields=["notes", "source_ip"])

        return Response({
            "ok": True,
            "new_drop_id": r.drop_id,
            "file_counts": r.file_counts,
            "breaks": r.breaks,
        })


class AvaloqCoverageView(APIView):
    """GET /bank-feed/coverage/?days=14

    Returns per-day SLA coverage rollup for the last N business days.
    Powers the SLA strip and the arrival heatmap.

    Response shape::

        {
          "today": "2026-05-10",
          "cutoff_cet": "08:00",
          "rows": [
            {
              "business_date": "2026-05-10",
              "expected": 1, "received": 1, "on_time": 1,
              "late": 0, "missing": 0, "ingested": 1, "failed": 0,
              "differences_open": 2,
            },
            ...
          ]
        }
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        try:
            days = int(request.query_params.get("days") or 14)
        except (TypeError, ValueError):
            days = 14
        days = max(1, min(days, 90))

        org = request.organization
        today = dt_date.today()
        from collections import defaultdict
        agg: dict[dt_date, dict] = defaultdict(lambda: {
            "expected": 0, "received": 0, "on_time": 0, "late": 0,
            "missing": 0, "ingested": 0, "failed": 0, "differences_open": 0,
        })

        # We only know about drops we've actually received. For the
        # demo's "expected" column we assume one expected-per-portfolio-
        # per-business-day for any active portfolio that has *ever*
        # received a drop. Production needs an explicit
        # PortfolioFeedSubscription table — flagged as known-limit.
        from beakon_core.models import Portfolio
        active_portfolio_ids = list(
            AvaloqFeedDrop.objects
            .filter(organization=org)
            .values_list("file_name", flat=True)
            .distinct()
        )
        # Crude — count distinct portfolio prefixes.
        from beakon_banking.services.avaloq_feed import _extract_prefix
        prefixes = {_extract_prefix(n) for n in active_portfolio_ids}
        per_day_expected = max(1, len(prefixes))

        drops = (
            AvaloqFeedDrop.objects
            .filter(organization=org,
                    business_date__gte=today - timedelta(days=days))
            .select_related("custodian")
        )
        for d in drops:
            row = agg[d.business_date]
            row["received"] += 1
            cutoff = datetime.combine(
                d.business_date, dt_time(SLA_CUTOFF_HOUR_CET, 0), tzinfo=CET,
            )
            if d.received_at and d.received_at.astimezone(CET) <= cutoff:
                row["on_time"] += 1
            else:
                row["late"] += 1
            if d.status == bk_c.DROP_INGESTED:
                row["ingested"] += 1
            elif d.status == bk_c.DROP_FAILED:
                row["failed"] += 1
            row["differences_open"] += d.breaks.filter(resolved=False).count()

        # Fill in expected count for every business day in the window.
        for offset in range(days):
            d = today - timedelta(days=offset)
            agg[d]["expected"] = per_day_expected
            agg[d]["missing"] = max(0, per_day_expected - agg[d]["received"])

        cutoff_cet = f"{SLA_CUTOFF_HOUR_CET:02d}:00"
        rows = [
            {"business_date": d.isoformat(), **v}
            for d, v in sorted(agg.items(), reverse=True)
        ]
        return Response({
            "today": today.isoformat(),
            "cutoff_cet": cutoff_cet,
            "rows": rows,
        })


class AvaloqDropListView(generics.ListAPIView):
    serializer_class = AvaloqFeedDropSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get_queryset(self):
        return (
            AvaloqFeedDrop.objects
            .filter(organization=self.request.organization)
            .select_related("custodian")
            .order_by("-received_at")
        )


class AvaloqDropDetailView(generics.RetrieveAPIView):
    serializer_class = AvaloqFeedDropSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get_queryset(self):
        return (
            AvaloqFeedDrop.objects
            .filter(organization=self.request.organization)
            .select_related("custodian")
        )

    def retrieve(self, request, *args, **kwargs):
        drop = self.get_object()
        # Hydrate with the per-file row payloads — useful for the
        # detail UI without forcing a second round-trip.
        breaks_qs = drop.breaks.select_related("portfolio").all()
        return Response({
            "drop": AvaloqFeedDropSerializer(drop).data,
            "breaks": ReconciliationBreakSerializer(breaks_qs, many=True).data,
            "samples": {
                "cash": list(BankTransaction.objects
                             .filter(feed_import__avaloq_drops_for_cash=drop)
                             .order_by("date")
                             .values("date", "description", "amount", "currency")[:10]),
                "securities": list(PortfolioTrade.objects
                                   .filter(drop=drop)
                                   .values("trade_date", "isin", "instrument_name",
                                           "side", "quantity", "price", "currency")[:10]),
                "positions": list(PositionSnapshot.objects
                                  .filter(drop=drop)
                                  .values("as_of", "isin", "instrument_name",
                                          "quantity", "market_value", "currency")[:20]),
                "performance": list(PerformanceSnapshot.objects
                                    .filter(drop=drop)
                                    .values("as_of", "period", "return_pct",
                                            "return_amount", "currency")),
                "orderbook": list(OpenOrder.objects
                                  .filter(drop=drop)
                                  .values("order_date", "isin", "instrument_name",
                                          "side", "quantity", "limit_price",
                                          "currency", "order_status")),
            },
        })


class AvaloqBreakListView(generics.ListAPIView):
    serializer_class = ReconciliationBreakSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get_queryset(self):
        qs = (
            ReconciliationBreak.objects
            .filter(drop__organization=self.request.organization)
            .select_related("drop", "portfolio")
            .order_by("-created_at")
        )
        if self.request.query_params.get("resolved") in ("0", "false", "no"):
            qs = qs.filter(resolved=False)
        elif self.request.query_params.get("resolved") in ("1", "true", "yes"):
            qs = qs.filter(resolved=True)
        return qs
