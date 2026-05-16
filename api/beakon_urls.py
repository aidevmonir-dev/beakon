"""URL routes for the Beakon kernel — mounted at /api/v1/beakon/.

Kept in a separate module so the legacy ``api/urls.py`` stays readable.
"""
from django.urls import path
from rest_framework.routers import DefaultRouter

from api.views.platform_admin import (
    CustomerListView as PlatformCustomerListView,
    CustomerDetailView as PlatformCustomerDetailView,
    TrafficView as PlatformTrafficView,
)
from api.views.beakon import (
    AccountGroupViewSet,
    AccountSubtypeCatalogView,
    AccountSubtypeDeleteView,
    EntityTypeCatalogView,
    EntityTypeDeleteView,
    CoADefinitionViewSet,
    AccountViewSet,
    CoAMappingViewSet,
    ControlledListEntryViewSet,
    DimensionTypeViewSet,
    DimensionValueViewSet,
    DimensionValidationRuleViewSet,
    LearningRuleViewSet,
    BankAccountMasterViewSet,
    CounterpartyViewSet,
    CustodianViewSet,
    InstrumentViewSet,
    LoanViewSet,
    PolicyViewSet,
    PortfolioViewSet,
    PropertyViewSet,
    RelatedPartyViewSet,
    TaxLotViewSet,
    AIBillDraftStreamView,
    AIBillDraftView,
    OCRExtractStreamView,
    OCRExtractInvoiceStreamView,
    ApprovalActionListView,
    AnomaliesView,
    AskBeakonView,
    BillViewSet,
    ReportNarrativeView,
    CurrencyListView,
    CustomerViewSet,
    EntityViewSet,
    FXRateListCreateView,
    FXRateSyncECBView,
    FXRevaluationView,
    IntercompanyGroupViewSet,
    BillDocumentListView,
    InvoiceDocumentListView,
    InvoiceViewSet,
    JournalEntryDocumentListView,
    JournalEntryViewSet,
    PeriodViewSet,
    SourceDocumentDetailView,
    VendorViewSet,
)
from api.views.beakon_reports import (
    AccountLedgerView,
    AccountSummaryView,
    APAgingView,
    ARAgingView,
    BalanceSheetView,
    CashFlowView,
    EntryDetailView,
    JournalListingView,
    LinesListingView,
    ProfitLossView,
    TrialBalanceView,
)
from api.views.beakon_banking import (
    BankAccountViewSet,
    BankTransactionViewSet,
    FeedImportDetailView,
    FeedImportListView,
    MLBankCategorizerStatusView,
    MLBankCategorizerTrainView,
)
from api.views.beakon_dashboard import CashTrendView
from api.views.beakon_wealth import (
    WealthPerformanceTrendView, WealthSummaryView,
)
from api.views.beakon_bank_feed import (
    AvaloqBreakListView,
    AvaloqCoverageView,
    AvaloqDropDetailView,
    AvaloqDropListView,
    AvaloqIngestView,
    AvaloqReprocessView,
    AvaloqSimulatePushView,
)
from api.views.beakon_billing import (
    ActivationRequestListView,
    CurrentSubscriptionView,
    PlanListView,
    RequestActivationView,
    StartSubscriptionView,
)
from api.views.beakon_travel import (
    TripClaimViewSet,
    TripExpenseViewSet,
)
from api.views.beakon_employment import EmployeeViewSet
from api.views.beakon_documents import DocumentViewSet
from api.views.beakon_extras import (
    AICoAImportCommitView,
    AICoAImportPreviewView,
    CommitmentViewSet,
    CreateDisbursementInvoiceView,
    PendingRebillablesSummaryView,
    PendingRebillablesView,
    PensionViewSet,
    RecognitionRuleViewSet,
    RunClosingEntriesView,
    TaxCodeViewSet,
    VATReportView,
    WorkbookImplementationView,
    WorkflowDiagramView,
)


router = DefaultRouter()
router.register(r"entities", EntityViewSet, basename="beakon-entity")
router.register(r"account-groups", AccountGroupViewSet, basename="beakon-account-group")
router.register(r"coa-definitions", CoADefinitionViewSet, basename="beakon-coa-definition")
router.register(r"accounts", AccountViewSet, basename="beakon-account")
router.register(r"coa-mappings", CoAMappingViewSet, basename="beakon-coa-mapping")
router.register(r"dimension-types", DimensionTypeViewSet, basename="beakon-dimension-type")
router.register(r"dimension-values", DimensionValueViewSet, basename="beakon-dimension-value")
router.register(r"controlled-lists", ControlledListEntryViewSet, basename="beakon-controlled-list")
router.register(r"dimension-validation-rules", DimensionValidationRuleViewSet, basename="beakon-dimension-rule")
router.register(r"learning-rules", LearningRuleViewSet, basename="beakon-learning-rule")
router.register(r"periods", PeriodViewSet, basename="beakon-period")
router.register(r"intercompany-groups", IntercompanyGroupViewSet, basename="beakon-ic-group")
router.register(r"vendors", VendorViewSet, basename="beakon-vendor")
router.register(r"customers", CustomerViewSet, basename="beakon-customer")
router.register(r"bills", BillViewSet, basename="beakon-bill")
router.register(r"invoices", InvoiceViewSet, basename="beakon-invoice")
router.register(r"journal-entries", JournalEntryViewSet, basename="beakon-je")
router.register(r"bank-accounts", BankAccountViewSet, basename="beakon-bank-account")
router.register(r"bank-transactions", BankTransactionViewSet, basename="beakon-bank-txn")
router.register(r"tax-lots", TaxLotViewSet, basename="beakon-tax-lot")
router.register(r"loans", LoanViewSet, basename="beakon-loan")
router.register(r"instruments", InstrumentViewSet, basename="beakon-instrument")
router.register(r"portfolios", PortfolioViewSet, basename="beakon-portfolio")
router.register(r"custodians", CustodianViewSet, basename="beakon-custodian")
router.register(r"related-parties", RelatedPartyViewSet, basename="beakon-related-party")
router.register(r"counterparties", CounterpartyViewSet, basename="beakon-counterparty")
router.register(r"bank-account-masters", BankAccountMasterViewSet, basename="beakon-bank-account-master")
router.register(r"properties", PropertyViewSet, basename="beakon-property")
router.register(r"policies", PolicyViewSet, basename="beakon-policy")
router.register(r"tax-codes", TaxCodeViewSet, basename="beakon-tax-code")
router.register(r"recognition-rules", RecognitionRuleViewSet,
                basename="beakon-recognition-rule")
router.register(r"pensions", PensionViewSet, basename="beakon-pension")
router.register(r"commitments", CommitmentViewSet, basename="beakon-commitment")
router.register(r"trip-claims", TripClaimViewSet, basename="beakon-trip-claim")
router.register(r"trip-expenses", TripExpenseViewSet, basename="beakon-trip-expense")
router.register(r"employees", EmployeeViewSet, basename="beakon-employee")
router.register(r"documents", DocumentViewSet, basename="beakon-document")


urlpatterns = [
    # Reference data
    path("currencies/", CurrencyListView.as_view(), name="beakon-currencies"),
    path("fx-rates/", FXRateListCreateView.as_view(), name="beakon-fx-rates"),
    path("fx-rates/sync-ecb/", FXRateSyncECBView.as_view(), name="beakon-fx-rates-sync-ecb"),
    path("fx-revaluation/", FXRevaluationView.as_view(), name="beakon-fx-revaluation"),
    # AI / OCR
    path("ocr/draft-from-bill/", AIBillDraftView.as_view(), name="beakon-ocr-draft-bill"),
    path("ocr/draft-from-bill-stream/", AIBillDraftStreamView.as_view(),
         name="beakon-ocr-draft-bill-stream"),
    path("ocr/extract-stream/", OCRExtractStreamView.as_view(),
         name="beakon-ocr-extract-stream"),
    path("ocr/extract-invoice-stream/", OCRExtractInvoiceStreamView.as_view(),
         name="beakon-ocr-extract-invoice-stream"),
    path("ai/coa-import/preview/", AICoAImportPreviewView.as_view(),
         name="beakon-ai-coa-import-preview"),
    path("ai/coa-import/commit/", AICoAImportCommitView.as_view(),
         name="beakon-ai-coa-import-commit"),
    path("ask/", AskBeakonView.as_view(), name="beakon-ask"),
    path("narrative/", ReportNarrativeView.as_view(), name="beakon-narrative"),
    path("anomalies/", AnomaliesView.as_view(), name="beakon-anomalies"),
    # Approval audit
    path("approval-actions/", ApprovalActionListView.as_view(),
         name="beakon-approval-actions"),
    # Source-document attachments — same row can be parented on a Bill,
    # an Invoice, or a JournalEntry. Download/delete go through the
    # shared SourceDocumentDetailView regardless of parent type.
    path("journal-entries/<int:pk>/documents/",
         JournalEntryDocumentListView.as_view(),
         name="beakon-je-documents"),
    path("bills/<int:pk>/documents/",
         BillDocumentListView.as_view(),
         name="beakon-bill-documents"),
    path("invoices/<int:pk>/documents/",
         InvoiceDocumentListView.as_view(),
         name="beakon-invoice-documents"),
    path("documents/<int:pk>/", SourceDocumentDetailView.as_view(),
         name="beakon-document-detail"),
    # Reports
    path("reports/trial-balance/", TrialBalanceView.as_view(),
         name="beakon-report-tb"),
    path("reports/profit-loss/", ProfitLossView.as_view(),
         name="beakon-report-pnl"),
    path("reports/balance-sheet/", BalanceSheetView.as_view(),
         name="beakon-report-bs"),
    path("reports/cash-flow/", CashFlowView.as_view(), name="beakon-report-cf"),
    path("reports/cash-trend/", CashTrendView.as_view(), name="beakon-report-cash-trend"),
    path("reports/journal-listing/", JournalListingView.as_view(),
         name="beakon-report-journal-listing"),
    path("reports/lines-listing/", LinesListingView.as_view(),
         name="beakon-report-lines-listing"),
    path("reports/ap-aging/", APAgingView.as_view(), name="beakon-report-ap-aging"),
    path("reports/ar-aging/", ARAgingView.as_view(), name="beakon-report-ar-aging"),
    path("reports/account-ledger/", AccountLedgerView.as_view(),
         name="beakon-report-account-ledger"),
    path("accounts/summary/", AccountSummaryView.as_view(),
         name="beakon-accounts-summary"),
    path("account-subtypes/", AccountSubtypeCatalogView.as_view(),
         name="beakon-account-subtypes"),
    path("account-subtypes/<int:pk>/", AccountSubtypeDeleteView.as_view(),
         name="beakon-account-subtype-delete"),
    path("entity-types/", EntityTypeCatalogView.as_view(),
         name="beakon-entity-types"),
    path("entity-types/<int:pk>/", EntityTypeDeleteView.as_view(),
         name="beakon-entity-type-delete"),
    path("reports/entry-detail/", EntryDetailView.as_view(),
         name="beakon-report-entry-detail"),
    # Banking feeder
    path("feed-imports/", FeedImportListView.as_view(), name="beakon-feed-imports"),
    path("feed-imports/<int:pk>/", FeedImportDetailView.as_view(), name="beakon-feed-import-detail"),
    # Avaloq SFTP bank feed (one zip → 5 files → ingest pipeline)
    path("bank-feed/simulate-push/", AvaloqSimulatePushView.as_view(),
         name="beakon-bankfeed-simulate"),
    path("bank-feed/ingest/", AvaloqIngestView.as_view(),
         name="beakon-bankfeed-ingest"),
    path("bank-feed/drops/", AvaloqDropListView.as_view(),
         name="beakon-bankfeed-drops"),
    path("bank-feed/drops/<int:pk>/", AvaloqDropDetailView.as_view(),
         name="beakon-bankfeed-drop-detail"),
    path("bank-feed/breaks/", AvaloqBreakListView.as_view(),
         name="beakon-bankfeed-breaks"),
    path("bank-feed/coverage/", AvaloqCoverageView.as_view(),
         name="beakon-bankfeed-coverage"),
    path("bank-feed/drops/<int:pk>/reprocess/", AvaloqReprocessView.as_view(),
         name="beakon-bankfeed-reprocess"),
    # Commercial layer — pricing catalogue + per-org subscription state
    path("billing/plans/", PlanListView.as_view(), name="beakon-billing-plans"),
    path("billing/subscription/", CurrentSubscriptionView.as_view(),
         name="beakon-billing-subscription"),
    path("billing/subscription/start/", StartSubscriptionView.as_view(),
         name="beakon-billing-start"),
    path("billing/subscription/activate/", RequestActivationView.as_view(),
         name="beakon-billing-activate"),
    path("billing/subscription/requests/", ActivationRequestListView.as_view(),
         name="beakon-billing-requests"),
    # On-device ML bank categoriser (replaces LLM for confident picks)
    path("ml/bank-categorizer/train/", MLBankCategorizerTrainView.as_view(),
         name="beakon-ml-bank-categorizer-train"),
    path("ml/bank-categorizer/status/", MLBankCategorizerStatusView.as_view(),
         name="beakon-ml-bank-categorizer-status"),
    # Disbursements / rebillables
    path("disbursements/pending/", PendingRebillablesView.as_view(),
         name="beakon-disbursement-pending"),
    path("disbursements/summary/", PendingRebillablesSummaryView.as_view(),
         name="beakon-disbursement-summary"),
    path("disbursements/create-invoice/", CreateDisbursementInvoiceView.as_view(),
         name="beakon-disbursement-create-invoice"),
    # Period closing entries
    path("periods/<int:pk>/run-closing-entries/", RunClosingEntriesView.as_view(),
         name="beakon-period-run-closing-entries"),
    # VAT report
    path("reports/vat/", VATReportView.as_view(), name="beakon-vat-report"),
    # Wealth-management aggregations (Wealth dashboard)
    path("wealth/summary/", WealthSummaryView.as_view(),
         name="beakon-wealth-summary"),
    path("wealth/performance-trend/", WealthPerformanceTrendView.as_view(),
         name="beakon-wealth-perf-trend"),
    # Workbook → DB implementation evidence
    path("workbook-implementation/", WorkbookImplementationView.as_view(),
         name="beakon-workbook-implementation"),
    # Editable Mermaid workflow diagrams
    path("workflow-diagrams/<str:code>/", WorkflowDiagramView.as_view(),
         name="beakon-workflow-diagram"),
    # Platform admin — cross-tenant cockpit for Beakon staff (Thomas).
    # All endpoints are gated by IsAdminUser inside the view classes.
    path("admin/customers/",            PlatformCustomerListView.as_view(),
         name="beakon-admin-customers"),
    path("admin/customers/<slug:slug>/", PlatformCustomerDetailView.as_view(),
         name="beakon-admin-customer-detail"),
    path("admin/traffic/",              PlatformTrafficView.as_view(),
         name="beakon-admin-traffic"),
]

urlpatterns += router.urls
