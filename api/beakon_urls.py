"""URL routes for the Beakon kernel — mounted at /api/v1/beakon/.

Kept in a separate module so the legacy ``api/urls.py`` stays readable.
"""
from django.urls import path
from rest_framework.routers import DefaultRouter

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
    # Workbook → DB implementation evidence
    path("workbook-implementation/", WorkbookImplementationView.as_view(),
         name="beakon-workbook-implementation"),
    # Editable Mermaid workflow diagrams
    path("workflow-diagrams/<str:code>/", WorkflowDiagramView.as_view(),
         name="beakon-workflow-diagram"),
]

urlpatterns += router.urls
