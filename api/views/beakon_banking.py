"""API for Beakon's first feeder (bank CSV import)."""
import json

from rest_framework import generics, status as http
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from api.permissions import IsOrganizationMember
from api.serializers.beakon_banking import (
    BankAccountSerializer,
    BankTransactionSerializer,
    CategorizeRequestSerializer,
    FeedImportSerializer,
    IgnoreRequestSerializer,
    ImportCSVSerializer,
)
from beakon_banking.exceptions import BankingError
from beakon_banking.models import BankAccount, BankTransaction, FeedImport
from beakon_banking.services import AIBankCategorizer, Categorizer, CSVImporter
from beakon_core.models import Account


def _err(exc: BankingError):
    return Response(
        {"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
        status=http.HTTP_422_UNPROCESSABLE_ENTITY,
    )


class BankAccountViewSet(ModelViewSet):
    serializer_class = BankAccountSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    filterset_fields = ["entity", "is_active", "currency"]
    search_fields = ["name", "bank_name"]
    ordering_fields = ["name", "created_at"]

    def get_queryset(self):
        return BankAccount.objects.filter(
            organization=self.request.organization,
        ).select_related("entity", "account")

    def perform_create(self, serializer):
        serializer.save(
            organization=self.request.organization,
            created_by=self.request.user,
        )

    @action(detail=True, methods=["post"], url_path="import",
            parser_classes=[MultiPartParser, FormParser, JSONParser])
    def import_csv(self, request, pk=None):
        """Upload a CSV + column mapping, get back a FeedImport row with counts."""
        ba = self.get_object()

        # column_mapping may arrive as a JSON-encoded string via multipart.
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
        raw_mapping = data.get("column_mapping")
        if isinstance(raw_mapping, str):
            try:
                data["column_mapping"] = json.loads(raw_mapping)
            except json.JSONDecodeError:
                return Response(
                    {"error": {"message": "column_mapping is not valid JSON"}},
                    status=http.HTTP_400_BAD_REQUEST,
                )

        serializer = ImportCSVSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        v = serializer.validated_data
        uploaded = v["file"]

        importer = CSVImporter(
            bank_account=ba,
            column_mapping=v["column_mapping"],
            date_format=v["date_format"],
            has_header=v["has_header"],
        )
        feed = importer.run(
            file_bytes=uploaded.read(),
            file_name=getattr(uploaded, "name", "upload.csv"),
            user=request.user,
        )
        return Response(FeedImportSerializer(feed).data, status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def transactions(self, request, pk=None):
        """Bank txns scoped to this account. Accepts ?status=new and ?date_from="""
        ba = self.get_object()
        qs = BankTransaction.objects.filter(bank_account=ba).select_related(
            "bank_account", "proposed_journal_entry",
        )
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        date_from = request.query_params.get("date_from")
        if date_from:
            qs = qs.filter(date__gte=date_from)
        date_to = request.query_params.get("date_to")
        if date_to:
            qs = qs.filter(date__lte=date_to)
        qs = qs.order_by(request.query_params.get("ordering", "-date"))[:500]
        return Response({
            "count": len(qs),
            "results": BankTransactionSerializer(qs, many=True).data,
        })


class FeedImportListView(generics.ListAPIView):
    serializer_class = FeedImportSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    filterset_fields = ["bank_account", "status"]
    ordering_fields = ["created_at"]

    def get_queryset(self):
        return FeedImport.objects.filter(
            bank_account__organization=self.request.organization,
        ).select_related("bank_account")


class FeedImportDetailView(generics.RetrieveAPIView):
    serializer_class = FeedImportSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get_queryset(self):
        return FeedImport.objects.filter(
            bank_account__organization=self.request.organization,
        ).select_related("bank_account")


class BankTransactionViewSet(GenericViewSet):
    """Read + state-change actions on bank transactions.

    Writes (categorize / ignore / undo) go through the Categorizer service,
    which creates or tears down draft JEs in beakon_core.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    serializer_class = BankTransactionSerializer
    filterset_fields = ["status", "bank_account", "is_duplicate"]
    search_fields = ["description"]
    ordering_fields = ["date"]

    def get_queryset(self):
        return BankTransaction.objects.filter(
            bank_account__organization=self.request.organization,
        ).select_related("bank_account", "proposed_journal_entry")

    def list(self, request):
        qs = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(qs)
        ser = self.get_serializer(page or qs, many=True)
        return self.get_paginated_response(ser.data) if page is not None else Response(ser.data)

    def retrieve(self, request, pk=None):
        return Response(self.get_serializer(self.get_object()).data)

    @action(detail=True, methods=["post"])
    def categorize(self, request, pk=None):
        txn = self.get_object()
        serializer = CategorizeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        v = serializer.validated_data
        try:
            offset = Account.objects.get(
                id=v["offset_account_id"], organization=request.organization,
            )
        except Account.DoesNotExist:
            return Response(status=http.HTTP_404_NOT_FOUND)

        try:
            txn, je = Categorizer.categorize(
                txn=txn, offset_account=offset, user=request.user,
                memo=v.get("memo", ""),
            )
        except BankingError as e:
            return _err(e)

        return Response({
            "transaction": BankTransactionSerializer(txn).data,
            "journal_entry_id": je.id,
            "journal_entry_number": je.entry_number,
            "journal_entry_status": je.status,
        }, status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="suggest-categorization")
    def suggest_categorization(self, request, pk=None):
        """Ask the local LLM which offset account this txn should book to.
        Returns the suggestion only — does NOT create the JE. The user
        still calls categorize/ to confirm."""
        import logging
        from beakon_core.exceptions import BeakonError
        txn = self.get_object()
        try:
            suggestion = AIBankCategorizer.suggest(txn)
        except BeakonError as e:
            return Response(
                {"error": {"code": e.code, "message": e.message,
                           "details": e.details}},
                status=http.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        except Exception as e:
            # Catch any unexpected error so the user sees a real message
            # instead of a generic 500. Log the traceback for debugging.
            logging.getLogger(__name__).exception(
                "AI categorize failed for txn %s", txn.id,
            )
            return Response(
                {"error": {
                    "code": "BNK999",
                    "message": f"AI categorization failed: {type(e).__name__}: {e}",
                    "details": {"exception_type": type(e).__name__},
                }},
                status=http.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        return Response({
            "transaction_id": txn.id,
            "suggested_account_id": suggestion["account_id"],
            "suggested_account_code": suggestion["account_code"],
            "suggested_account_name": suggestion["account_name"],
            "account_type": suggestion["account_type"],
            "account_subtype": suggestion["account_subtype"],
            "reasoning": suggestion["reasoning"],
            "confidence": suggestion["confidence"],
            "model_used": suggestion["model_used"],
        })

    @action(detail=True, methods=["post"])
    def ignore(self, request, pk=None):
        txn = self.get_object()
        serializer = IgnoreRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            Categorizer.ignore(
                txn=txn, user=request.user,
                reason=serializer.validated_data.get("reason", ""),
            )
        except BankingError as e:
            return _err(e)
        return Response(BankTransactionSerializer(txn).data)

    @action(detail=True, methods=["post"])
    def undo(self, request, pk=None):
        txn = self.get_object()
        try:
            Categorizer.undo(txn=txn, user=request.user)
        except BankingError as e:
            return _err(e)
        return Response(BankTransactionSerializer(txn).data)
