"""DRF views for the Beakon accounting kernel.

All state-transition endpoints go through ``JournalService`` — never edit
status directly. Organization scoping is provided by the existing
``IsOrganizationMember`` permission.
"""
from django.conf import settings
from django.db import transaction
from django.db.models import ProtectedError
from django.utils import timezone
from rest_framework import generics, status as http
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from api.mixins import OrganizationFilterMixin
from api.permissions import IsOrganizationMember
from api.serializers.beakon import (
    AccountGroupSerializer,
    CoADefinitionSerializer,
    AccountSerializer,
    CustomAccountSubtypeSerializer,
    CustomEntityTypeSerializer,
    ApprovalActionSerializer,
    BillCreateSerializer,
    BillDetailSerializer,
    BillPaymentSerializer,
    BillRejectSerializer,
    BillSummarySerializer,
    CurrencySerializer,
    CustomerSerializer,
    EntitySerializer,
    FXRateSerializer,
    IntercompanyGroupSerializer,
    InvoiceCreateSerializer,
    InvoiceDetailSerializer,
    InvoicePaymentSerializer,
    InvoiceRejectSerializer,
    InvoiceSummarySerializer,
    JournalEntryCreateSerializer,
    JournalEntryDetailSerializer,
    JournalEntryNoteSerializer,
    JournalEntryRejectSerializer,
    JournalEntryReverseSerializer,
    JournalEntrySummarySerializer,
    PeriodCloseSerializer,
    PeriodSerializer,
    VendorSerializer,
)
from beakon_core import constants as bc
from beakon_core.exceptions import BeakonError
from beakon_core.models import (
    Account,
    AccountGroup,
    ApprovalAction,
    Bill,
    CoADefinition,
    Currency,
    CustomAccountSubtype,
    CustomEntityType,
    Customer,
    Entity,
    FXRate,
    IntercompanyGroup,
    Invoice,
    JournalEntry,
    Period,
    Vendor,
)
from beakon_core.services import (
    AIBillDraftingService,
    AnomalyService,
    AskBeakonService,
    BillService,
    FXRevaluationService,
    InvoiceService,
    JournalService,
    NarrativeService,
)


# ── Utility error handler ───────────────────────────────────────────────────

def _beakon_error_response(exc: BeakonError):
    return Response(
        {"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
        status=http.HTTP_422_UNPROCESSABLE_ENTITY,
    )


# ── Reference data ──────────────────────────────────────────────────────────

class CurrencyListView(generics.ListAPIView):
    """Registry lookup — no tenant scoping needed."""
    permission_classes = [IsAuthenticated]
    queryset = Currency.objects.filter(is_active=True)
    serializer_class = CurrencySerializer
    pagination_class = None


class FXRateListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = FXRate.objects.all()
    serializer_class = FXRateSerializer
    filterset_fields = ["from_currency", "to_currency"]
    ordering_fields = ["as_of"]


# ── Entity ──────────────────────────────────────────────────────────────────

class EntityViewSet(OrganizationFilterMixin, ModelViewSet):
    serializer_class = EntitySerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = Entity.objects.select_related("parent")
    filterset_fields = ["entity_type", "is_active", "functional_currency"]
    search_fields = ["code", "name", "legal_name", "tax_id"]
    ordering_fields = ["code", "name", "created_at"]

    def perform_create(self, serializer):
        from beakon_core.constants import (
            default_accounting_standard_for_country,
        )
        # Country-aware fallback for the accounting standard. If the client
        # didn't specify one (older API consumers, scripted seeds), pick a
        # sensible default from the entity's country instead of letting the
        # model fall back to IFRS unconditionally.
        validated = dict(serializer.validated_data)
        if not validated.get("accounting_standard"):
            validated["accounting_standard"] = (
                default_accounting_standard_for_country(validated.get("country") or "")
            )
        serializer.save(
            organization=self.request.organization,
            created_by=self.request.user,
            accounting_standard=validated["accounting_standard"],
        )

    def destroy(self, request, *args, **kwargs):
        """Hard-delete an entity. Blocked by PROTECT FKs (journal entries,
        bank accounts) to preserve accounting history. On block, return 409
        with a breakdown of blockers so the UI can offer "deactivate instead".
        """
        entity = self.get_object()
        try:
            with transaction.atomic():
                entity.delete()
        except ProtectedError:
            from beakon_banking.models import BankAccount
            blockers = {
                "journal_entries": JournalEntry.objects.filter(entity=entity).count(),
                "bank_accounts": BankAccount.objects.filter(entity=entity).count(),
                "child_entities": Entity.objects.filter(parent=entity).count(),
            }
            return Response(
                {"error": {
                    "code": "entity_has_dependencies",
                    "message": (
                        "This entity has ledger history or linked bank accounts and "
                        "cannot be hard-deleted. Deactivate it instead to hide it from "
                        "active lists while preserving audit trail."
                    ),
                    "blockers": blockers,
                }},
                status=http.HTTP_409_CONFLICT,
            )
        return Response(status=http.HTTP_204_NO_CONTENT)


# ── COA ─────────────────────────────────────────────────────────────────────

class AccountGroupViewSet(OrganizationFilterMixin, ModelViewSet):
    serializer_class = AccountGroupSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = AccountGroup.objects.all()
    search_fields = ["code", "name"]
    ordering_fields = ["code", "sort_order"]

    def perform_create(self, serializer):
        serializer.save(organization=self.request.organization)


class CoADefinitionViewSet(OrganizationFilterMixin, ModelViewSet):
    serializer_class = CoADefinitionSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = CoADefinition.objects.all()
    filterset_fields = ["coa_type", "status", "base_currency"]
    search_fields = ["coa_id", "name", "coa_type"]
    ordering_fields = ["coa_id", "coa_type", "version_no", "effective_from", "created_at"]

    def perform_create(self, serializer):
        serializer.save(organization=self.request.organization)


class AccountViewSet(OrganizationFilterMixin, ModelViewSet):
    serializer_class = AccountSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = Account.objects.select_related("entity", "group", "parent", "coa_definition")
    filterset_fields = ["entity", "coa_definition", "account_type", "account_subtype", "is_active"]
    search_fields = ["code", "name"]
    ordering_fields = ["code", "name", "account_type"]

    def perform_create(self, serializer):
        serializer.save(organization=self.request.organization)


# ── Account subtype catalog ─────────────────────────────────────────────────

class AccountSubtypeCatalogView(APIView):
    """Unified subtype catalog = built-ins (from constants) + per-org customs.

    GET → {asset: [{value,label,is_custom,id?}, ...], liability: [...], ...}
    POST → create a CustomAccountSubtype. Body: {account_type, value, label}
    DELETE /<id>/ → remove one custom subtype (see AccountSubtypeDeleteView).

    Collision rule: built-ins win. If an org tries to create a custom with
    the same value as a built-in, the serializer allows it but GET will not
    duplicate — the built-in shadows it.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        # Group built-ins by account type. The constants list is flat, but
        # ordered by type; we walk it and bucket using the TYPE_FOR_SUBTYPE
        # heuristic below (same buckets as the legacy frontend list).
        buckets: dict = {t: [] for t, _ in bc.ACCOUNT_TYPE_CHOICES}
        seen_values_by_type: dict = {t: set() for t in buckets}

        # Seed built-ins. We infer the bucket from the constants file ordering
        # using a small lookup — if you change the list in constants, keep the
        # block comments aligned.
        type_for_value = _BUILTIN_SUBTYPE_TYPE_MAP
        for value, label in bc.ACCOUNT_SUBTYPE_CHOICES:
            t = type_for_value.get(value)
            if t is None:
                continue  # orphan entry — skip silently
            buckets[t].append({"value": value, "label": label, "is_custom": False})
            seen_values_by_type[t].add(value)

        # Merge in customs.
        customs = CustomAccountSubtype.objects.filter(organization=request.organization)
        for cs in customs:
            if cs.value in seen_values_by_type.get(cs.account_type, set()):
                continue  # built-in shadows it
            buckets.setdefault(cs.account_type, []).append({
                "id": cs.id, "value": cs.value, "label": cs.label, "is_custom": True,
            })

        return Response(buckets)

    def post(self, request):
        ser = CustomAccountSubtypeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        # Reject collisions with built-ins up-front (nicer error than IntegrityError).
        if ser.validated_data["value"] in {v for v, _ in bc.ACCOUNT_SUBTYPE_CHOICES}:
            return Response(
                {"detail": "That value is already a built-in subtype. Pick a different value."},
                status=http.HTTP_400_BAD_REQUEST,
            )
        try:
            ser.save(organization=request.organization)
        except Exception as e:
            # Unique-constraint collisions (same org + same value) land here.
            return Response(
                {"detail": "A subtype with that value already exists for this organization."},
                status=http.HTTP_409_CONFLICT,
            )
        return Response(ser.data, status=http.HTTP_201_CREATED)


class AccountSubtypeDeleteView(APIView):
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def delete(self, request, pk: int):
        try:
            obj = CustomAccountSubtype.objects.get(
                pk=pk, organization=request.organization,
            )
        except CustomAccountSubtype.DoesNotExist:
            return Response(status=http.HTTP_404_NOT_FOUND)
        # If any account still uses this subtype, refuse — the user should
        # reassign first.
        in_use = Account.objects.filter(
            organization=request.organization,
            account_subtype=obj.value,
        ).exists()
        if in_use:
            return Response(
                {"detail": "This subtype is still in use. Reassign the accounts first."},
                status=http.HTTP_409_CONFLICT,
            )
        obj.delete()
        return Response(status=http.HTTP_204_NO_CONTENT)


class EntityTypeCatalogView(APIView):
    """Unified entity type catalog = built-ins + per-org customs."""

    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        seen = set()
        options = []
        for value, label in bc.ENTITY_TYPE_CHOICES:
            options.append({"value": value, "label": label, "is_custom": False})
            seen.add(value)

        customs = CustomEntityType.objects.filter(organization=request.organization)
        for item in customs:
            if item.value in seen:
                continue
            options.append({
                "id": item.id,
                "value": item.value,
                "label": item.label,
                "is_custom": True,
            })
        return Response(options)

    def post(self, request):
        ser = CustomEntityTypeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if ser.validated_data["value"] in {v for v, _ in bc.ENTITY_TYPE_CHOICES}:
            return Response(
                {"detail": "That value is already a built-in entity type. Pick a different value."},
                status=http.HTTP_400_BAD_REQUEST,
            )
        try:
            ser.save(organization=request.organization)
        except Exception:
            return Response(
                {"detail": "An entity type with that value already exists for this organization."},
                status=http.HTTP_409_CONFLICT,
            )
        return Response(ser.data, status=http.HTTP_201_CREATED)


class EntityTypeDeleteView(APIView):
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def delete(self, request, pk: int):
        try:
            obj = CustomEntityType.objects.get(pk=pk, organization=request.organization)
        except CustomEntityType.DoesNotExist:
            return Response(status=http.HTTP_404_NOT_FOUND)
        in_use = Entity.objects.filter(
            organization=request.organization,
            entity_type=obj.value,
        ).exists()
        if in_use:
            return Response(
                {"detail": "This entity type is still in use. Reassign the entities first."},
                status=http.HTTP_409_CONFLICT,
            )
        obj.delete()
        return Response(status=http.HTTP_204_NO_CONTENT)


# Inline map: built-in subtype value → which account_type bucket it belongs to.
# Kept here (not in constants) because it's purely a UI/catalog concern.
_BUILTIN_SUBTYPE_TYPE_MAP = {
    # Assets
    "bank": "asset", "cash": "asset", "current_asset": "asset",
    "accounts_receivable": "asset", "intercompany_receivable": "asset",
    "prepaid": "asset", "inventory": "asset", "investment": "asset",
    "loan_receivable": "asset", "fixed_asset": "asset",
    "accumulated_depreciation": "asset", "intangible_asset": "asset",
    "other_asset": "asset",
    # Liabilities
    "accounts_payable": "liability", "intercompany_payable": "liability",
    "accrued_liability": "liability", "current_liability": "liability",
    "loan_payable": "liability", "long_term_liability": "liability",
    "tax_payable": "liability", "vat_payable": "liability",
    "other_liability": "liability",
    # Equity
    "capital": "equity", "retained_earnings": "equity",
    "revaluation_reserve": "equity", "fx_translation_reserve": "equity",
    "distribution": "equity", "other_equity": "equity",
    # Revenue
    "operating_revenue": "revenue", "investment_income": "revenue",
    "fx_gain": "revenue", "other_income": "revenue",
    # Expense
    "cogs": "expense", "operating_expense": "expense",
    "professional_fees": "expense", "depreciation": "expense",
    "fx_loss": "expense", "tax_expense": "expense", "other_expense": "expense",
}


# ── Period ──────────────────────────────────────────────────────────────────

class PeriodViewSet(ModelViewSet):
    """Periods live under an entity; scope filters via the entity's
    organization rather than a direct Period.organization field."""
    serializer_class = PeriodSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    filterset_fields = ["entity", "period_type", "status"]
    ordering_fields = ["start_date", "name"]

    def get_queryset(self):
        return Period.objects.filter(
            entity__organization=self.request.organization,
        ).select_related("entity")

    def perform_create(self, serializer):
        # Entity is on the request body; just make sure it belongs to the org.
        entity = serializer.validated_data["entity"]
        if entity.organization_id != self.request.organization.id:
            raise ValueError("Entity not in this organization")
        serializer.save()

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """Flip status to soft_close or closed. Reversible via ``reopen``."""
        period = self.get_object()
        serializer = PeriodCloseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data["status"]
        period.status = new_status
        period.closed_by = request.user
        period.closed_at = timezone.now()
        period.save(update_fields=["status", "closed_by", "closed_at", "updated_at"])
        return Response(PeriodSerializer(period).data)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        period = self.get_object()
        period.status = bc.PERIOD_OPEN
        period.closed_by = None
        period.closed_at = None
        period.save(update_fields=["status", "closed_by", "closed_at", "updated_at"])
        return Response(PeriodSerializer(period).data)


# ── Vendors ─────────────────────────────────────────────────────────────────

class VendorViewSet(OrganizationFilterMixin, ModelViewSet):
    serializer_class = VendorSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = Vendor.objects.select_related("default_expense_account").all()
    filterset_fields = ["is_active"]
    search_fields = ["code", "name", "legal_name", "tax_id", "email"]
    ordering_fields = ["name", "code", "created_at"]

    def perform_create(self, serializer):
        serializer.save(
            organization=self.request.organization,
            created_by=self.request.user,
        )


# ── Customers ───────────────────────────────────────────────────────────────

class CustomerViewSet(OrganizationFilterMixin, ModelViewSet):
    serializer_class = CustomerSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = Customer.objects.select_related("default_revenue_account").all()
    filterset_fields = ["is_active"]
    search_fields = ["code", "name", "legal_name", "tax_id", "email"]
    ordering_fields = ["name", "code", "created_at"]

    def perform_create(self, serializer):
        serializer.save(
            organization=self.request.organization,
            created_by=self.request.user,
        )


# ── Bills (AP) ──────────────────────────────────────────────────────────────

class BillViewSet(OrganizationFilterMixin, GenericViewSet):
    """Bills go through BillService — never write status / lines directly.

    Routes:
        GET    /bills/                     -> list (summary)
        POST   /bills/                     -> create draft
        GET    /bills/{pk}/                -> detail
        PATCH  /bills/{pk}/lines/          -> replace lines (draft only)
        POST   /bills/{pk}/submit-for-approval/
        POST   /bills/{pk}/approve/        -> creates+posts accrual JE
        POST   /bills/{pk}/reject/
        POST   /bills/{pk}/return-to-draft/
        POST   /bills/{pk}/mark-paid/      -> creates+posts payment JE
        POST   /bills/{pk}/cancel/
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = Bill.objects.select_related(
        "entity", "vendor", "accrual_journal_entry", "payment_journal_entry",
        "payment_bank_account",
    ).prefetch_related("lines__expense_account")
    filterset_fields = ["entity", "vendor", "status", "currency"]
    search_fields = ["reference", "bill_number", "description"]
    ordering_fields = ["invoice_date", "due_date", "total", "created_at"]

    def get_serializer_class(self):
        return BillSummarySerializer if self.action == "list" else BillDetailSerializer

    def list(self, request):
        qs = self.filter_queryset(self.get_queryset()).order_by("-invoice_date", "-id")
        page = self.paginate_queryset(qs)
        if page is not None:
            ser = BillSummarySerializer(page, many=True)
            return self.get_paginated_response(ser.data)
        ser = BillSummarySerializer(qs, many=True)
        return Response(ser.data)

    def retrieve(self, request, pk=None):
        bill = self.get_object()
        return Response(BillDetailSerializer(bill).data)

    def create(self, request):
        ser = BillCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data
        try:
            entity = Entity.objects.get(
                id=v["entity"], organization=request.organization,
            )
            vendor = Vendor.objects.get(
                id=v["vendor"], organization=request.organization,
            )
        except (Entity.DoesNotExist, Vendor.DoesNotExist):
            return Response({"detail": "entity or vendor not found"},
                            status=http.HTTP_404_NOT_FOUND)
        try:
            bill = BillService.create_draft(
                organization=request.organization,
                entity=entity, vendor=vendor,
                invoice_date=v["invoice_date"],
                due_date=v.get("due_date"),
                bill_number=v.get("bill_number", ""),
                currency=v.get("currency") or None,
                lines=v["lines"],
                tax_amount=v.get("tax_amount"),
                description=v.get("description", ""),
                user=request.user,
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(BillDetailSerializer(bill).data, status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["patch"])
    def lines(self, request, pk=None):
        bill = self.get_object()
        lines = request.data.get("lines")
        if not isinstance(lines, list):
            return Response({"detail": "lines must be a list"},
                            status=http.HTTP_400_BAD_REQUEST)
        try:
            BillService.replace_lines(bill, lines)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(BillDetailSerializer(bill).data)

    @action(detail=True, methods=["post"], url_path="submit-for-approval")
    def submit_for_approval(self, request, pk=None):
        bill = self.get_object()
        try:
            BillService.submit_for_approval(bill, user=request.user)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(BillDetailSerializer(bill).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        bill = self.get_object()
        try:
            BillService.approve(bill, user=request.user)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(BillDetailSerializer(bill).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        bill = self.get_object()
        ser = BillRejectSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            BillService.reject(bill, user=request.user,
                               reason=ser.validated_data["reason"])
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(BillDetailSerializer(bill).data)

    @action(detail=True, methods=["post"], url_path="return-to-draft")
    def return_to_draft(self, request, pk=None):
        bill = self.get_object()
        try:
            BillService.return_to_draft(bill, user=request.user)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(BillDetailSerializer(bill).data)

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        bill = self.get_object()
        ser = BillPaymentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data
        try:
            bank = Account.objects.get(
                id=v["bank_account"], organization=request.organization,
            )
        except Account.DoesNotExist:
            return Response({"detail": "bank account not found"},
                            status=http.HTTP_404_NOT_FOUND)
        try:
            BillService.mark_paid(
                bill, bank_account=bank,
                payment_date=v["payment_date"],
                user=request.user,
                reference=v.get("reference", ""),
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(BillDetailSerializer(bill).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        bill = self.get_object()
        try:
            BillService.cancel(bill, user=request.user)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(BillDetailSerializer(bill).data)


# ── Invoices (AR) ───────────────────────────────────────────────────────────

class InvoiceViewSet(OrganizationFilterMixin, GenericViewSet):
    """Invoices go through InvoiceService — never write status / lines directly.

    Routes:
        GET    /invoices/                     -> list
        POST   /invoices/                     -> create draft
        GET    /invoices/{pk}/                -> detail
        PATCH  /invoices/{pk}/lines/          -> replace lines (draft only)
        POST   /invoices/{pk}/submit-for-approval/
        POST   /invoices/{pk}/issue/          -> creates+posts AR JE
        POST   /invoices/{pk}/reject/
        POST   /invoices/{pk}/return-to-draft/
        POST   /invoices/{pk}/record-payment/ -> creates+posts receipt JE
        POST   /invoices/{pk}/cancel/
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = Invoice.objects.select_related(
        "entity", "customer", "issued_journal_entry", "payment_journal_entry",
        "payment_bank_account",
    ).prefetch_related("lines__revenue_account")
    filterset_fields = ["entity", "customer", "status", "currency"]
    search_fields = ["reference", "invoice_number", "description"]
    ordering_fields = ["invoice_date", "due_date", "total", "created_at"]

    def get_serializer_class(self):
        return InvoiceSummarySerializer if self.action == "list" else InvoiceDetailSerializer

    def list(self, request):
        qs = self.filter_queryset(self.get_queryset()).order_by("-invoice_date", "-id")
        page = self.paginate_queryset(qs)
        if page is not None:
            ser = InvoiceSummarySerializer(page, many=True)
            return self.get_paginated_response(ser.data)
        ser = InvoiceSummarySerializer(qs, many=True)
        return Response(ser.data)

    def retrieve(self, request, pk=None):
        invoice = self.get_object()
        return Response(InvoiceDetailSerializer(invoice).data)

    def create(self, request):
        ser = InvoiceCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data
        try:
            entity = Entity.objects.get(
                id=v["entity"], organization=request.organization,
            )
            customer = Customer.objects.get(
                id=v["customer"], organization=request.organization,
            )
        except (Entity.DoesNotExist, Customer.DoesNotExist):
            return Response({"detail": "entity or customer not found"},
                            status=http.HTTP_404_NOT_FOUND)
        try:
            invoice = InvoiceService.create_draft(
                organization=request.organization,
                entity=entity, customer=customer,
                invoice_date=v["invoice_date"],
                due_date=v.get("due_date"),
                invoice_number=v.get("invoice_number", ""),
                currency=v.get("currency") or None,
                lines=v["lines"],
                tax_amount=v.get("tax_amount"),
                description=v.get("description", ""),
                user=request.user,
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(InvoiceDetailSerializer(invoice).data, status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["patch"])
    def lines(self, request, pk=None):
        invoice = self.get_object()
        lines = request.data.get("lines")
        if not isinstance(lines, list):
            return Response({"detail": "lines must be a list"},
                            status=http.HTTP_400_BAD_REQUEST)
        try:
            InvoiceService.replace_lines(invoice, lines)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="submit-for-approval")
    def submit_for_approval(self, request, pk=None):
        invoice = self.get_object()
        try:
            InvoiceService.submit_for_approval(invoice, user=request.user)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"])
    def issue(self, request, pk=None):
        invoice = self.get_object()
        try:
            InvoiceService.issue(invoice, user=request.user)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        invoice = self.get_object()
        ser = InvoiceRejectSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            InvoiceService.reject(invoice, user=request.user,
                                  reason=ser.validated_data["reason"])
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="return-to-draft")
    def return_to_draft(self, request, pk=None):
        invoice = self.get_object()
        try:
            InvoiceService.return_to_draft(invoice, user=request.user)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="record-payment")
    def record_payment(self, request, pk=None):
        invoice = self.get_object()
        ser = InvoicePaymentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data
        try:
            bank = Account.objects.get(
                id=v["bank_account"], organization=request.organization,
            )
        except Account.DoesNotExist:
            return Response({"detail": "bank account not found"},
                            status=http.HTTP_404_NOT_FOUND)
        try:
            InvoiceService.record_payment(
                invoice, bank_account=bank,
                payment_date=v["payment_date"],
                user=request.user,
                reference=v.get("reference", ""),
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(InvoiceDetailSerializer(invoice).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        invoice = self.get_object()
        try:
            InvoiceService.cancel(invoice, user=request.user)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(InvoiceDetailSerializer(invoice).data)


# ── Intercompany groups ─────────────────────────────────────────────────────

class IntercompanyGroupViewSet(OrganizationFilterMixin, ModelViewSet):
    serializer_class = IntercompanyGroupSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = IntercompanyGroup.objects.all().prefetch_related(
        "journal_entries__entity",
    )
    search_fields = ["reference", "description"]

    def perform_create(self, serializer):
        serializer.save(
            organization=self.request.organization,
            created_by=self.request.user,
        )

    @action(detail=True, methods=["post"], url_path="check-balance")
    def check_balance(self, request, pk=None):
        """Run the intercompany net-to-zero validator. Returns
        ``{ok: true}`` if the group balances, otherwise the validator's
        error details ({per_entity, net, tolerance, ...}).
        """
        group = self.get_object()
        try:
            JournalService.assert_intercompany_balanced(group)
        except BeakonError as e:
            return Response(
                {"ok": False, "error": {
                    "code": e.code, "message": e.message, "details": e.details,
                }},
                status=http.HTTP_200_OK,  # not an HTTP error — this is the answer
            )
        return Response({"ok": True})


# ── FX revaluation ──────────────────────────────────────────────────────────

class FXRevaluationView(APIView):
    """POST /beakon/fx-revaluation/  body: {entity, as_of}

    Runs the period-end FX revaluation engine for one entity. Returns the
    draft JE id (or None when nothing needed revaluation).
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def post(self, request):
        entity_id = request.data.get("entity")
        as_of = request.data.get("as_of")
        if not entity_id or not as_of:
            return Response(
                {"detail": "entity and as_of are required"},
                status=http.HTTP_400_BAD_REQUEST,
            )
        try:
            entity = Entity.objects.get(
                id=entity_id, organization=request.organization,
            )
        except Entity.DoesNotExist:
            return Response({"detail": "entity not found"},
                            status=http.HTTP_404_NOT_FOUND)
        try:
            from datetime import date as dt_date
            as_of_date = dt_date.fromisoformat(as_of)
            entry = FXRevaluationService.revalue(
                entity=entity, as_of=as_of_date, user=request.user,
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        if entry is None:
            return Response({"created": False, "message": "Nothing to revalue."})
        return Response({
            "created": True,
            "entry_id": entry.id,
            "entry_number": entry.entry_number,
            "memo": entry.memo,
            "total_debit_functional": str(entry.total_debit_functional),
        })


# ── AI bill drafting (OCR → draft JE) ──────────────────────────────────────

from rest_framework.parsers import FormParser, MultiPartParser


class AIBillDraftView(APIView):
    """POST /beakon/ocr/draft-from-bill/  multipart

    Form fields:
        file          (required) the bill / receipt — PDF or image
        entity        (required) entity ID
        payment_via   (optional) "ap" (default) or "cash"
        bank_account  (optional) Account ID for the cash side when payment_via=cash

    Returns: draft JE summary + extraction details + warnings.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get("file")
        entity_id = request.data.get("entity")
        payment_via = request.data.get("payment_via", "ap")
        bank_account_id = request.data.get("bank_account") or None
        if not upload or not entity_id:
            return Response({"detail": "file and entity are required"},
                            status=http.HTTP_400_BAD_REQUEST)
        try:
            entity = Entity.objects.get(
                id=entity_id, organization=request.organization,
            )
        except Entity.DoesNotExist:
            return Response({"detail": "entity not found"},
                            status=http.HTTP_404_NOT_FOUND)
        try:
            result = AIBillDraftingService.draft_from_bill(
                entity=entity,
                file_bytes=upload.read(),
                filename=upload.name,
                content_type=upload.content_type or "application/octet-stream",
                user=request.user,
                payment_via=payment_via,
                bank_account_id=int(bank_account_id) if bank_account_id else None,
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        entry = result["entry"]
        return Response({
            "entry_id": entry.id,
            "entry_number": entry.entry_number,
            "extraction": {
                "vendor_name": result["extraction"]["vendor_name"],
                "invoice_number": result["extraction"]["invoice_number"],
                "invoice_date": result["extraction"]["invoice_date"],
                "total": str(result["extraction"]["total"]),
                "currency": result["extraction"]["currency"],
                "description": result["extraction"]["description"],
                "model_used": result["extraction"]["model_used"],
                "mode": result["extraction"]["mode"],
                "confidence": result["extraction"]["confidence"],
                "confidence_in_account": result["extraction"]["confidence_in_account"],
                "suggested_account_reasoning": result["extraction"]["suggested_account_reasoning"],
                "accounting_standard_reasoning": result["extraction"].get("accounting_standard_reasoning"),
                "entity_accounting_standard": entity.accounting_standard,
            },
            "warnings": result["warnings"],
        }, status=http.HTTP_201_CREATED)


# ── Streaming OCR (Server-Sent Events) ────────────────────────────────────
# Same flow as AIBillDraftView but pipes phase + token events to the client
# as the LLM works, so the UI progress bar reflects real backend state.

import json as _json  # noqa: E402

from django.http import StreamingHttpResponse  # noqa: E402

from beakon_core.services import OCRService  # noqa: E402


def _sse(payload: dict) -> bytes:
    """Format one Server-Sent Events frame."""
    return f"data: {_json.dumps(payload)}\n\n".encode("utf-8")


class AIBillDraftStreamView(APIView):
    """POST /beakon/ocr/draft-from-bill-stream/  multipart

    Same payload as ``AIBillDraftView``. Response is ``text/event-stream``
    with these event ``type`` values:

      * ``phase``  — major workflow step. ``{phase: str, pct: int}``
      * ``token``  — LLM emitted a chunk. ``{n: int}`` (cumulative count)
      * ``done``   — success. ``{entry_id, entry_number, extraction, warnings}``
      * ``error``  — terminal failure. ``{message: str}``

    The final event is always ``done`` or ``error``; the client should
    close the reader when it sees one of those.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get("file")
        entity_id = request.data.get("entity")
        payment_via = request.data.get("payment_via", "ap")
        bank_account_id = request.data.get("bank_account") or None
        if not upload or not entity_id:
            return Response({"detail": "file and entity are required"},
                            status=http.HTTP_400_BAD_REQUEST)
        try:
            entity = Entity.objects.get(
                id=entity_id, organization=request.organization,
            )
        except Entity.DoesNotExist:
            return Response({"detail": "entity not found"},
                            status=http.HTTP_404_NOT_FOUND)

        # Capture everything we need OUTSIDE the generator — the request
        # object's file handle won't survive into the streaming response.
        file_bytes = upload.read()
        filename = upload.name
        content_type = upload.content_type or "application/octet-stream"
        user = request.user
        organization = request.organization
        bank_account_id = int(bank_account_id) if bank_account_id else None

        def event_stream():
            yield _sse({"type": "phase", "phase": "Reading uploaded file…", "pct": 3})

            extracted = None
            try:
                for evt in OCRService.extract_invoice_streaming(
                    entity=entity,
                    file_bytes=file_bytes,
                    content_type=content_type,
                ):
                    if evt["type"] == "result":
                        extracted = evt["data"]
                    elif evt["type"] == "error":
                        yield _sse(evt)
                        return
                    else:
                        yield _sse(evt)
            except Exception as e:
                yield _sse({"type": "error", "message": f"OCR failed: {e}"})
                return

            if extracted is None:
                yield _sse({"type": "error",
                            "message": "OCR finished without a result."})
                return

            yield _sse({"type": "phase",
                        "phase": "Creating draft journal entry…", "pct": 95})
            try:
                result = AIBillDraftingService.draft_from_extraction(
                    entity=entity,
                    extracted=extracted,
                    file_bytes=file_bytes,
                    filename=filename,
                    content_type=content_type,
                    user=user,
                    payment_via=payment_via,
                    bank_account_id=bank_account_id,
                )
            except BeakonError as e:
                yield _sse({"type": "error",
                            "message": e.message,
                            "details": e.details, "code": e.code})
                return
            except Exception as e:
                yield _sse({"type": "error", "message": str(e)})
                return

            entry = result["entry"]
            yield _sse({
                "type": "done",
                "entry_id": entry.id,
                "entry_number": entry.entry_number,
                "extraction": {
                    "vendor_name": extracted.get("vendor_name"),
                    "total": str(extracted.get("total")),
                    "currency": extracted.get("currency"),
                    "model_used": extracted.get("model_used"),
                    "mode": extracted.get("mode"),
                    "suggested_account_reasoning": extracted.get("suggested_account_reasoning"),
                    "accounting_standard_reasoning": extracted.get("accounting_standard_reasoning"),
                    "entity_accounting_standard": entity.accounting_standard,
                },
                "warnings": result["warnings"],
            })

        response = StreamingHttpResponse(
            event_stream(), content_type="text/event-stream",
        )
        # Disable proxy buffering — without this, nginx/whitenoise/etc. may
        # hold the response until the generator finishes.
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


# ── Ask Beakon AI (chat over current ledger state) ────────────────────────

class AnomaliesView(APIView):
    """GET /beakon/anomalies/?as_of=YYYY-MM-DD

    Returns a flat list of anomalies for the current organization. Read-only
    and deterministic (no LLM in this v1).
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        from datetime import date as dt_date
        as_of = request.query_params.get("as_of")
        try:
            as_of_date = dt_date.fromisoformat(as_of) if as_of else dt_date.today()
        except ValueError:
            return Response({"detail": "as_of must be YYYY-MM-DD"},
                            status=http.HTTP_400_BAD_REQUEST)
        anomalies = AnomalyService.scan(request.organization, as_of=as_of_date)
        # Severity counts for header summary
        counts = {"high": 0, "medium": 0, "low": 0}
        for a in anomalies:
            counts[a.get("severity", "low")] = counts.get(a.get("severity", "low"), 0) + 1
        return Response({
            "as_of": as_of_date.isoformat(),
            "total": len(anomalies),
            "counts": counts,
            "anomalies": anomalies,
        })


class ReportNarrativeView(APIView):
    """POST /beakon/narrative/

    Body: {"report_type": "pnl"|"bs"|"cf"|"tb",
           "entity": int? (null = consolidated),
           "date_from": "YYYY-MM-DD"? (pnl/cf),
           "date_to":   "YYYY-MM-DD"? (pnl/cf),
           "as_of":     "YYYY-MM-DD"? (bs/tb),
           "reporting_currency": str? }

    Streams SSE events:
        {"type": "snapshot_built", "chars": int}
        {"type": "token", "text": str}
        {"type": "done", "full": str}
        {"type": "error", "message": str}
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def post(self, request):
        from audit.services import log_event
        from datetime import date as dt_date

        report_type = (request.data.get("report_type") or "").strip()
        if report_type not in {"pnl", "bs", "cf", "tb"}:
            return Response({"detail": "report_type must be pnl | bs | cf | tb"},
                            status=http.HTTP_400_BAD_REQUEST)

        entity = None
        entity_id = request.data.get("entity")
        if entity_id:
            entity = Entity.objects.filter(
                id=entity_id, organization=request.organization,
            ).first()

        # Normalise params to real date objects
        params = {}
        try:
            if report_type in ("pnl", "cf"):
                if not request.data.get("date_from") or not request.data.get("date_to"):
                    return Response({"detail": "date_from and date_to required"},
                                    status=http.HTTP_400_BAD_REQUEST)
                params["date_from"] = dt_date.fromisoformat(request.data["date_from"])
                params["date_to"] = dt_date.fromisoformat(request.data["date_to"])
            else:
                if not request.data.get("as_of"):
                    return Response({"detail": "as_of required"},
                                    status=http.HTTP_400_BAD_REQUEST)
                params["as_of"] = dt_date.fromisoformat(request.data["as_of"])
        except ValueError as e:
            return Response({"detail": f"bad date: {e}"},
                            status=http.HTTP_400_BAD_REQUEST)
        params["reporting_currency"] = request.data.get("reporting_currency") or None

        organization = request.organization
        user = request.user

        def event_stream():
            full = ""
            try:
                for evt in NarrativeService.stream_narrative(
                    organization=organization, entity=entity,
                    report_type=report_type, params=params,
                ):
                    if evt["type"] == "done":
                        full = evt.get("full", "")
                        yield _sse({"type": "done"})
                    elif evt["type"] == "error":
                        yield _sse(evt)
                        return
                    else:
                        yield _sse(evt)
            except Exception as e:
                yield _sse({"type": "error", "message": str(e)})
                return

            try:
                log_event(
                    organization=organization,
                    action="create",
                    object_type="ReportNarrative",
                    object_id=0,
                    object_repr=f"{report_type} narrative",
                    actor=user,
                    actor_type="ai",
                    metadata={
                        "kind": "report_narrative",
                        "report_type": report_type,
                        "entity_id": entity.id if entity else None,
                        "entity_code": entity.code if entity else None,
                        "params": {k: str(v) for k, v in params.items()},
                        "narrative_preview": full[:500],
                        "narrative_length": len(full),
                        "model": settings.OLLAMA_CHAT_MODEL,
                    },
                )
            except Exception:
                pass

        response = StreamingHttpResponse(
            event_stream(), content_type="text/event-stream",
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


class AskBeakonView(APIView):
    """POST /beakon/ask/

    Body: {"question": str, "history": [{role,content},...], "entity": int?}

    SSE response with event types:
        {"type": "context_built", "ctx_chars": int}
        {"type": "token", "text": str}     (zero or many)
        {"type": "done"}                   (terminal success)
        {"type": "error", "message": str}  (terminal failure)
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def post(self, request):
        from audit.services import log_event

        question = (request.data.get("question") or "").strip()
        history = request.data.get("history") or []
        entity_id = request.data.get("entity")
        if not question:
            return Response({"detail": "question is required"},
                            status=http.HTTP_400_BAD_REQUEST)

        entity = None
        if entity_id:
            entity = Entity.objects.filter(
                id=entity_id, organization=request.organization,
            ).first()

        # Capture before generator starts (request goes out of scope inside SSE)
        organization = request.organization
        user = request.user

        def event_stream():
            full_answer = ""
            try:
                for evt in AskBeakonService.stream_answer(
                    organization=organization, entity=entity,
                    question=question, history=history, user=user,
                ):
                    if evt["type"] == "done":
                        full_answer = evt.get("full", "")
                        yield _sse({"type": "done"})
                    elif evt["type"] == "error":
                        yield _sse(evt)
                        return
                    else:
                        yield _sse(evt)
            except Exception as e:
                yield _sse({"type": "error", "message": str(e)})
                return

            # Audit row — captures every AI Q&A for "what did the AI say" review.
            try:
                log_event(
                    organization=organization,
                    action="create",
                    object_type="AskBeakon",
                    object_id=0,
                    object_repr=question[:200],
                    actor=user,
                    actor_type="ai",
                    metadata={
                        "kind": "ask_beakon",
                        "question": question,
                        "answer_preview": full_answer[:600],
                        "answer_length": len(full_answer),
                        "entity_id": entity.id if entity else None,
                        "entity_code": entity.code if entity else None,
                        "model": settings.OLLAMA_TEXT_MODEL,
                    },
                )
            except Exception:
                pass

        response = StreamingHttpResponse(
            event_stream(), content_type="text/event-stream",
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


# ── Journal Entry ───────────────────────────────────────────────────────────

class JournalEntryViewSet(OrganizationFilterMixin, GenericViewSet):
    """Custom viewset — uses JournalService for every write path.

    Routes:
        GET    /journal-entries/               -> list (summary)
        POST   /journal-entries/               -> create draft
        GET    /journal-entries/{pk}/          -> detail
        PATCH  /journal-entries/{pk}/lines/    -> replace lines
        POST   /journal-entries/{pk}/submit-for-approval/
        POST   /journal-entries/{pk}/approve/
        POST   /journal-entries/{pk}/reject/
        POST   /journal-entries/{pk}/return-to-draft/
        POST   /journal-entries/{pk}/post/
        POST   /journal-entries/{pk}/reverse/
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = JournalEntry.objects.select_related(
        "entity", "period", "created_by", "approved_by", "posted_by",
        "reversal_of", "counterparty_entity",
    ).prefetch_related("lines__account", "approval_actions__actor")
    filterset_fields = ["entity", "status", "source_type"]
    search_fields = ["entry_number", "memo", "reference", "source_ref"]
    ordering_fields = ["date", "entry_number", "created_at"]

    def get_serializer_class(self):
        if self.action == "list":
            return JournalEntrySummarySerializer
        return JournalEntryDetailSerializer

    # ── List + detail ──────────────────────────────────────────────────────
    def list(self, request):
        qs = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(qs)
        ser = JournalEntrySummarySerializer(page or qs, many=True)
        return self.get_paginated_response(ser.data) if page is not None else Response(ser.data)

    def retrieve(self, request, pk=None):
        entry = self.get_object()
        return Response(JournalEntryDetailSerializer(entry).data)

    # ── Create draft ───────────────────────────────────────────────────────
    def create(self, request):
        serializer = JournalEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        v = serializer.validated_data

        try:
            entity = Entity.objects.get(
                id=v["entity_id"], organization=request.organization,
            )
        except Entity.DoesNotExist:
            return Response(status=http.HTTP_404_NOT_FOUND)

        intercompany_group = None
        if v.get("intercompany_group_id"):
            try:
                intercompany_group = IntercompanyGroup.objects.get(
                    id=v["intercompany_group_id"], organization=request.organization,
                )
            except IntercompanyGroup.DoesNotExist:
                return Response(status=http.HTTP_404_NOT_FOUND)

        counterparty = None
        if v.get("counterparty_entity_id"):
            try:
                counterparty = Entity.objects.get(
                    id=v["counterparty_entity_id"], organization=request.organization,
                )
            except Entity.DoesNotExist:
                return Response(status=http.HTTP_404_NOT_FOUND)

        try:
            entry = JournalService.create_draft(
                organization=request.organization,
                entity=entity,
                date=v["date"],
                memo=v.get("memo", ""),
                reference=v.get("reference", ""),
                currency=v.get("currency") or entity.functional_currency,
                lines=v["lines"],
                user=request.user,
                source_type=v.get("source_type") or bc.SOURCE_MANUAL,
                source_id=v.get("source_id"),
                source_ref=v.get("source_ref", ""),
                intercompany_group=intercompany_group,
                counterparty_entity=counterparty,
            )
        except BeakonError as e:
            return _beakon_error_response(e)

        return Response(
            JournalEntryDetailSerializer(entry).data,
            status=http.HTTP_201_CREATED,
        )

    # ── State transitions ──────────────────────────────────────────────────
    @action(detail=True, methods=["post"], url_path="submit-for-approval")
    def submit_for_approval(self, request, pk=None):
        entry = self.get_object()
        note = JournalEntryNoteSerializer(data=request.data).initial_data.get("note", "")
        try:
            JournalService.submit_for_approval(entry, user=request.user, note=note)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(JournalEntryDetailSerializer(entry).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        entry = self.get_object()
        note = JournalEntryNoteSerializer(data=request.data).initial_data.get("note", "")
        try:
            JournalService.approve(entry, user=request.user, note=note)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(JournalEntryDetailSerializer(entry).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        entry = self.get_object()
        serializer = JournalEntryRejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            JournalService.reject(
                entry, user=request.user,
                reason=serializer.validated_data["reason"],
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(JournalEntryDetailSerializer(entry).data)

    @action(detail=True, methods=["post"], url_path="return-to-draft")
    def return_to_draft(self, request, pk=None):
        entry = self.get_object()
        note = JournalEntryNoteSerializer(data=request.data).initial_data.get("note", "")
        try:
            JournalService.return_to_draft(entry, user=request.user, note=note)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(JournalEntryDetailSerializer(entry).data)

    @action(detail=True, methods=["post"])
    def post(self, request, pk=None):
        entry = self.get_object()
        note = JournalEntryNoteSerializer(data=request.data).initial_data.get("note", "")
        try:
            JournalService.post(entry, user=request.user, note=note)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(JournalEntryDetailSerializer(entry).data)

    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        entry = self.get_object()
        serializer = JournalEntryReverseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            reversal = JournalService.reverse(
                entry,
                reversal_date=serializer.validated_data["reversal_date"],
                user=request.user,
                memo=serializer.validated_data.get("memo", ""),
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(
            {
                "original": JournalEntryDetailSerializer(entry).data,
                "reversal": JournalEntryDetailSerializer(reversal).data,
            },
            status=http.HTTP_201_CREATED,
        )


# ── Approval actions (read-only, for audit drill-down) ──────────────────────

class ApprovalActionListView(generics.ListAPIView):
    """Flat list — filter by journal_entry to see one JE's history."""
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    serializer_class = ApprovalActionSerializer
    filterset_fields = ["journal_entry", "action"]
    ordering_fields = ["at"]

    def get_queryset(self):
        return ApprovalAction.objects.filter(
            journal_entry__organization=self.request.organization,
        ).select_related("actor", "journal_entry")
