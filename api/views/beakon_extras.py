"""Views for Tax / Disbursement / Closing / Recognition / VAT — frontend-
catch-up endpoints for backend builds #1–#4.

Also hosts ``WorkbookImplementationView`` — a live "every workbook tab →
database table → row count" evidence endpoint used in meetings with
Thomas to confirm the spreadsheet structure is faithfully implemented.
"""
from rest_framework import generics, status as http
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from api.mixins import OrganizationFilterMixin
from api.permissions import IsOrganizationMember
from api.serializers.beakon_extras import (
    ClosePeriodSerializer,
    CommitmentSerializer,
    CreateDisbursementInvoiceSerializer,
    CreateRecognitionRuleSerializer,
    PendingRebillableLineSerializer,
    PensionSerializer,
    RecognitionRuleDetailSerializer,
    RecognitionRuleSummarySerializer,
    RunRecognitionSerializer,
    TaxCodeSerializer,
    VATReportRequestSerializer,
    WorkflowDiagramSerializer,
)
from api.serializers.beakon import InvoiceDetailSerializer
from beakon_core.exceptions import BeakonError
from beakon_core.models import (
    Account,
    BankAccountMaster,
    CoADefinition,
    CoAMapping,
    Commitment,
    ControlledListEntry,
    Counterparty,
    Custodian,
    Customer,
    DimensionType,
    DimensionValue,
    DimensionValidationRule,
    Entity,
    Instrument,
    Loan,
    Pension,
    Period,
    Policy,
    Portfolio,
    Property,
    RecognitionRule,
    RelatedParty,
    TaxCode,
    TaxLot,
    WorkflowDiagram,
)
from beakon_core.services import (
    AICoAImportService,
    ClosingEntriesService,
    DisbursementService,
    RecognitionService,
    VATReportService,
)


def _beakon_error_response(exc: BeakonError):
    return Response(
        {"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
        status=http.HTTP_422_UNPROCESSABLE_ENTITY,
    )


# ── TaxCode CRUD ─────────────────────────────────────────────────────

class TaxCodeViewSet(OrganizationFilterMixin, ModelViewSet):
    serializer_class = TaxCodeSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = TaxCode.objects.select_related(
        "output_account", "input_account",
    ).all()
    filterset_fields = ["country_code", "tax_type", "active_flag"]
    search_fields = ["code", "name", "country_code", "notes"]
    ordering_fields = ["code", "country_code", "rate"]

    def perform_create(self, serializer):
        serializer.save(organization=self.request.organization)


# ── Pension CRUD ─────────────────────────────────────────────────────

class PensionViewSet(OrganizationFilterMixin, ModelViewSet):
    serializer_class = PensionSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = Pension.objects.select_related(
        "holder_related_party", "provider_counterparty", "employer_counterparty",
        "linked_portfolio", "linked_bank_account",
    ).all()
    filterset_fields = ["pension_type", "status", "active_flag", "country_code"]
    search_fields = ["pension_id", "pension_name", "short_name",
                     "holder_related_party_id_code", "provider_counterparty_id_code"]
    ordering_fields = ["pension_id", "pension_type", "vested_balance"]

    def perform_create(self, serializer):
        serializer.save(organization=self.request.organization)


# ── Commitment CRUD ──────────────────────────────────────────────────

class CommitmentViewSet(OrganizationFilterMixin, ModelViewSet):
    serializer_class = CommitmentSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = Commitment.objects.select_related(
        "holder_related_party", "general_partner_counterparty",
        "vehicle_instrument", "linked_portfolio", "funding_bank_account",
    ).all()
    filterset_fields = ["commitment_type", "status", "active_flag", "vintage_year"]
    search_fields = ["commitment_id", "commitment_name", "short_name",
                     "holder_related_party_id_code",
                     "general_partner_counterparty_id_code"]
    ordering_fields = ["commitment_id", "vintage_year", "total_commitment_amount"]

    def perform_create(self, serializer):
        serializer.save(organization=self.request.organization)


# ── Disbursement ─────────────────────────────────────────────────────

class PendingRebillablesView(generics.ListAPIView):
    """Read-only list of rebillable journal lines pending a client invoice."""
    serializer_class = PendingRebillableLineSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    pagination_class = None

    def get_queryset(self):
        organization = self.request.organization
        entity_id = self.request.query_params.get("entity")
        client_id = self.request.query_params.get("client_dimension_value")
        currency = self.request.query_params.get("currency")

        kwargs = {"organization": organization}
        if entity_id:
            try:
                kwargs["entity"] = Entity.objects.get(
                    id=entity_id, organization=organization,
                )
            except Entity.DoesNotExist:
                return []
        if currency:
            kwargs["currency"] = currency
        # client_dimension_value param accepts an id; filter manually since service signature wants the model.
        qs = DisbursementService.pending_lines(**kwargs)
        if client_id:
            qs = qs.filter(rebill_client_dimension_value_id=client_id)
        return qs


class PendingRebillablesSummaryView(APIView):
    """Aggregate pending rebillable lines by (client, currency).

    Used by the Disbursements page to show a per-client roll-up:
    "ACME · 5 lines · 1,250 USD pending recovery".
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        organization = request.organization
        entity = None
        entity_id = request.query_params.get("entity")
        if entity_id:
            try:
                entity = Entity.objects.get(id=entity_id, organization=organization)
            except Entity.DoesNotExist:
                return Response([])
        rows = DisbursementService.summarize_pending(
            organization=organization, entity=entity,
        )
        payload = [{
            "client_dimension_value_id": r.client_dimension_value_id,
            "client_code": r.client_code,
            "client_name": r.client_name,
            "currency": r.currency,
            "total_amount": str(r.total_amount),
            "line_count": r.line_count,
        } for r in rows]
        return Response(payload)


class CreateDisbursementInvoiceView(APIView):
    """Bundle pending rebillable lines into a draft client invoice."""
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def post(self, request):
        ser = CreateDisbursementInvoiceSerializer(data=request.data)
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
        recovery_acct = None
        if v.get("recovery_account"):
            try:
                recovery_acct = Account.objects.get(
                    id=v["recovery_account"], organization=request.organization,
                )
            except Account.DoesNotExist:
                return Response({"detail": "recovery account not found"},
                                status=http.HTTP_404_NOT_FOUND)
        try:
            invoice = DisbursementService.create_invoice_from_rebillables(
                organization=request.organization,
                entity=entity,
                customer=customer,
                journal_line_ids=v["journal_line_ids"],
                invoice_date=v["invoice_date"],
                due_date=v.get("due_date"),
                recovery_account=recovery_acct,
                description=v.get("description", ""),
                user=request.user,
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(InvoiceDetailSerializer(invoice).data, status=http.HTTP_201_CREATED)


# ── Period close (closing entries) ───────────────────────────────────

class RunClosingEntriesView(APIView):
    """Generate the closing JE for a period.

    Distinct from ``PeriodViewSet.close`` (which only flips the status flag).
    This action posts the actual closing journal entry.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def post(self, request, pk):
        try:
            period = Period.objects.get(
                pk=pk, entity__organization=request.organization,
            )
        except Period.DoesNotExist:
            return Response({"detail": "period not found"},
                            status=http.HTTP_404_NOT_FOUND)
        ser = ClosePeriodSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data
        re_acct = None
        if v.get("retained_earnings_account"):
            try:
                re_acct = Account.objects.get(
                    id=v["retained_earnings_account"],
                    organization=request.organization,
                )
            except Account.DoesNotExist:
                return Response({"detail": "retained earnings account not found"},
                                status=http.HTTP_404_NOT_FOUND)
        try:
            result = ClosingEntriesService.close_period(
                period,
                retained_earnings_account=re_acct,
                user=request.user,
                memo=v.get("memo") or None,
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response({
            "period_id": result.period.id,
            "period_name": result.period.name,
            "journal_entry_id": result.journal_entry.id,
            "journal_entry_number": result.journal_entry.entry_number,
            "revenue_total": str(result.revenue_total),
            "expense_total": str(result.expense_total),
            "net_income": str(result.net_income),
            "line_count": result.line_count,
        }, status=http.HTTP_201_CREATED)


# ── Recognition rules ────────────────────────────────────────────────

class RecognitionRuleViewSet(OrganizationFilterMixin, ModelViewSet):
    """CRUD + lifecycle actions for recognition rules."""
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = (
        RecognitionRule.objects
        .select_related(
            "entity", "deferral_account", "recognition_account",
            "source_bill_line", "source_invoice_line", "source_journal_line",
        )
        .prefetch_related("schedule_periods", "schedule_periods__posted_journal_entry")
    )
    filterset_fields = ["status", "rule_type", "entity"]
    search_fields = ["code", "name", "notes"]
    ordering_fields = ["created_at", "start_date", "end_date", "code"]

    def get_serializer_class(self):
        if self.action in ("retrieve", "create"):
            return RecognitionRuleDetailSerializer
        return RecognitionRuleSummarySerializer

    def create(self, request, *args, **kwargs):
        ser = CreateRecognitionRuleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data
        try:
            entity = Entity.objects.get(
                id=v["entity"], organization=request.organization,
            )
            deferral = Account.objects.get(
                id=v["deferral_account"], organization=request.organization,
            )
            recognition = Account.objects.get(
                id=v["recognition_account"], organization=request.organization,
            )
        except (Entity.DoesNotExist, Account.DoesNotExist):
            return Response({"detail": "entity or account not found"},
                            status=http.HTTP_404_NOT_FOUND)
        try:
            rule = RecognitionService.create_rule(
                organization=request.organization,
                entity=entity,
                code=v["code"],
                name=v["name"],
                rule_type=v["rule_type"],
                total_amount=v["total_amount"],
                currency=v["currency"],
                start_date=v["start_date"],
                end_date=v["end_date"],
                deferral_account=deferral,
                recognition_account=recognition,
                period_type=v.get("period_type") or "MONTHLY",
                method=v.get("method") or "STRAIGHT_LINE_BY_PERIOD",
                notes=v.get("notes", ""),
                user=request.user,
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(RecognitionRuleDetailSerializer(rule).data,
                        status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def run(self, request, pk=None):
        rule = self.get_object()
        ser = RunRecognitionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            result = RecognitionService.recognize(
                rule, as_of=ser.validated_data["as_of"], user=request.user,
            )
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response({
            "rule_id": result.rule.id,
            "posted_count": len(result.posted),
            "posted_entry_numbers": [je.entry_number for je in result.posted],
            "skipped_already_posted": result.skipped_already_posted,
            "completed_now": result.completed_now,
            "rule": RecognitionRuleDetailSerializer(result.rule).data,
        })

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        rule = self.get_object()
        reason = request.data.get("reason", "")
        try:
            RecognitionService.cancel(rule, user=request.user, reason=reason)
        except BeakonError as e:
            return _beakon_error_response(e)
        return Response(RecognitionRuleDetailSerializer(rule).data)


# ── Workbook implementation evidence ──────────────────────────────────

class WorkbookImplementationView(APIView):
    """Live evidence that every tab in Thomas's CoA workbook is implemented
    as a Django model with the database row count to prove it.

    Returned shape:
        {
          "organization": "Beakon",
          "workbook": "2026 04 17-DRAFT-CoA-Wealth management v2.xlsx",
          "tabs": [
            {
              "tab": "01 CoA Definition",
              "model": "CoADefinition",
              "db_table": "beakon_coa_definition",
              "field_count": 19,
              "row_count": 1,
              "sample_ids": ["WM_CLIENT_V1"],
              "url": "/dashboard/coa-definitions",
              "type": "data" | "extension"
            },
            ...
          ]
        }
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        org = request.organization

        def field_count(model):
            return len([f for f in model._meta.get_fields()
                        if not f.is_relation or f.many_to_one or f.one_to_one])

        def sample_ids(qs, attr, n=3):
            return list(qs.values_list(attr, flat=True)[:n])

        # Workbook tabs (17 data tabs from the spreadsheet). Each url goes
        # to the generic data browser at /dashboard/blueprint/data/<slug>/
        # which reads workbook-resources.ts for column config and fetches
        # the matching API endpoint live.
        tabs = [
            ("01 CoA Definition",         CoADefinition,           "coa_id",
             "/dashboard/blueprint/data/coa-definitions"),
            ("02 CoA Master",             Account,                 "code",
             "/dashboard/blueprint/data/accounts"),
            ("03 CoA Mapping",            CoAMapping,              "mapping_id",
             "/dashboard/blueprint/data/coa-mappings"),
            ("04 Dimensions Reference",   DimensionType,           "code",
             "/dashboard/blueprint/data/dimension-types"),
            ("05 Dimension Values",       DimensionValue,          "code",
             "/dashboard/blueprint/data/dimension-values"),
            ("06 Controlled Lists",       ControlledListEntry,     "list_code",
             "/dashboard/blueprint/data/controlled-lists"),
            ("07 Loan Master",            Loan,                    "loan_id",
             "/dashboard/blueprint/data/loans"),
            ("08 Instrument Master",      Instrument,              "instrument_id",
             "/dashboard/blueprint/data/instruments"),
            ("09 Dimension Validation Rules", DimensionValidationRule, "rule_id",
             "/dashboard/blueprint/data/dimension-validation-rules"),
            ("10 Counterparty Master",    Counterparty,            "counterparty_id",
             "/dashboard/blueprint/data/counterparties"),
            ("11 Related Party Master",   RelatedParty,            "related_party_id",
             "/dashboard/blueprint/data/related-parties"),
            ("12 Bank Account Master",    BankAccountMaster,       "bank_account_id",
             "/dashboard/blueprint/data/bank-account-masters"),
            ("13 Custodian Master",       Custodian,               "custodian_id",
             "/dashboard/blueprint/data/custodians"),
            ("14 Portfolio Master",       Portfolio,               "portfolio_id",
             "/dashboard/blueprint/data/portfolios"),
            ("15 Property Master",        Property,                "property_id",
             "/dashboard/blueprint/data/properties"),
            ("16 Policy Master",          Policy,                  "policy_id",
             "/dashboard/blueprint/data/policies"),
            ("17 Tax Lot Master",         TaxLot,                  "tax_lot_id",
             "/dashboard/blueprint/data/tax-lots"),
        ]

        results = []
        for name, model, id_attr, url in tabs:
            qs = model.objects.filter(organization=org)
            results.append({
                "tab": name,
                "type": "data",
                "model": model.__name__,
                "db_table": model._meta.db_table,
                "field_count": field_count(model),
                "row_count": qs.count(),
                "sample_ids": [str(x) for x in sample_ids(qs, id_attr)],
                "url": url,
            })

        # Architecture-PDF / Notes-tab extensions we built ON TOP of the
        # workbook (Thomas's flagged TODOs + downstream engine pieces).
        # Each link goes to the same generic data-browser the workbook tabs
        # use — keeps the UX consistent.
        extensions = [
            ("Pension master (Notes-tab TODO)",     Pension,         "pension_id",
             "/dashboard/blueprint/data/pensions"),
            ("Commitment master (Master-tabs TODO)", Commitment,     "commitment_id",
             "/dashboard/blueprint/data/commitments"),
            ("Tax Code (VAT engine — build #2)",    TaxCode,         "code",
             "/dashboard/blueprint/data/tax-codes"),
            ("Recognition Rule (engine — build #4)", RecognitionRule, "code",
             "/dashboard/blueprint/data/recognition-rules"),
        ]
        for name, model, id_attr, url in extensions:
            qs = model.objects.filter(organization=org)
            results.append({
                "tab": name,
                "type": "extension",
                "model": model.__name__,
                "db_table": model._meta.db_table,
                "field_count": field_count(model),
                "row_count": qs.count(),
                "sample_ids": [str(x) for x in sample_ids(qs, id_attr)],
                "url": url,
            })

        return Response({
            "organization": org.name,
            "organization_id": org.id,
            "workbook": "2026 04 17-DRAFT-CoA-Wealth management v2.xlsx",
            "architecture_pdf": "2026 04 30-Beakon-Architecture.pdf",
            "tabs": results,
            "totals": {
                "tab_count": len(results),
                "data_tabs": sum(1 for r in results if r["type"] == "data"),
                "extension_tabs": sum(1 for r in results if r["type"] == "extension"),
                "total_rows": sum(r["row_count"] for r in results),
                "fully_loaded_count": sum(1 for r in results if r["row_count"] > 0),
            },
        })


# ── Workflow diagram (Mermaid editor) ────────────────────────────────

class WorkflowDiagramView(APIView):
    """GET + PATCH for an editable Mermaid workflow diagram.

    URL: /api/v1/beakon/workflow-diagrams/<code>/
    GET   → returns the diagram (auto-creates on first read)
    PATCH → updates ``mermaid_src`` (and optional ``name`` / ``description``)
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def _get_or_seed(self, request, code: str) -> WorkflowDiagram:
        org = request.organization
        obj, _created = WorkflowDiagram.objects.get_or_create(
            organization=org, code=code,
            defaults={
                "name": code.replace("_", " ").title(),
                "mermaid_src": "flowchart TD\n  A[Start] --> B[End]",
            },
        )
        return obj

    def get(self, request, code: str):
        obj = self._get_or_seed(request, code)
        return Response(WorkflowDiagramSerializer(obj).data)

    def patch(self, request, code: str):
        obj = self._get_or_seed(request, code)
        ser = WorkflowDiagramSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save(updated_by=request.user)
        return Response(WorkflowDiagramSerializer(obj).data)


# ── VAT report ───────────────────────────────────────────────────────

class VATReportView(APIView):
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def post(self, request):
        ser = VATReportRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data
        entity = None
        if v.get("entity"):
            try:
                entity = Entity.objects.get(
                    id=v["entity"], organization=request.organization,
                )
            except Entity.DoesNotExist:
                return Response({"detail": "entity not found"},
                                status=http.HTTP_404_NOT_FOUND)
        report = VATReportService.report(
            organization=request.organization,
            date_from=v["date_from"],
            date_to=v["date_to"],
            entity=entity,
        )
        return Response(report.as_dict())


# ── AI Chart-of-Accounts import ─────────────────────────────────────

class AICoAImportPreviewView(APIView):
    """Upload a CoA file (xlsx/csv); returns Claude's structured proposal.

    The preview is read-only — nothing lands in the DB. The frontend
    renders the rows in an editable table; the user clicks "Commit"
    which calls AICoAImportCommitView with the reviewed array.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        f = request.FILES.get("file")
        if not f:
            return Response(
                {"detail": "Upload a file under the 'file' field."},
                status=http.HTTP_400_BAD_REQUEST,
            )
        try:
            preview = AICoAImportService.preview(
                file_bytes=f.read(),
                content_type=getattr(f, "content_type", "") or "",
                filename=f.name,
            )
        except BeakonError as exc:
            return _beakon_error_response(exc)
        return Response(preview)


class AICoAImportCommitView(APIView):
    """Write reviewed CoA rows into the Account table.

    Body: ``{accounts: [...], entity_id: int|null}``
    Returns: ``{created, skipped, errors}`` from AICoAImportService.commit.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    parser_classes = [JSONParser]

    def post(self, request):
        rows = request.data.get("accounts") or []
        if not isinstance(rows, list) or not rows:
            return Response(
                {"detail": "Body must include a non-empty 'accounts' array."},
                status=http.HTTP_400_BAD_REQUEST,
            )
        entity_id = request.data.get("entity_id")
        entity = None
        if entity_id:
            try:
                entity = Entity.objects.get(
                    id=entity_id, organization=request.organization,
                )
            except Entity.DoesNotExist:
                return Response(
                    {"detail": f"Entity {entity_id} not found."},
                    status=http.HTTP_404_NOT_FOUND,
                )
        try:
            result = AICoAImportService.commit(
                organization=request.organization,
                entity=entity,
                rows=rows,
                user=request.user,
            )
        except BeakonError as exc:
            return _beakon_error_response(exc)
        return Response(result)
