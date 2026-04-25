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
    AIBillDraftStreamView,
    AIBillDraftView,
    ApprovalActionListView,
    AnomaliesView,
    AskBeakonView,
    BillViewSet,
    ReportNarrativeView,
    CurrencyListView,
    CustomerViewSet,
    EntityViewSet,
    FXRateListCreateView,
    FXRevaluationView,
    IntercompanyGroupViewSet,
    InvoiceViewSet,
    JournalEntryViewSet,
    PeriodViewSet,
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
)


router = DefaultRouter()
router.register(r"entities", EntityViewSet, basename="beakon-entity")
router.register(r"account-groups", AccountGroupViewSet, basename="beakon-account-group")
router.register(r"coa-definitions", CoADefinitionViewSet, basename="beakon-coa-definition")
router.register(r"accounts", AccountViewSet, basename="beakon-account")
router.register(r"periods", PeriodViewSet, basename="beakon-period")
router.register(r"intercompany-groups", IntercompanyGroupViewSet, basename="beakon-ic-group")
router.register(r"vendors", VendorViewSet, basename="beakon-vendor")
router.register(r"customers", CustomerViewSet, basename="beakon-customer")
router.register(r"bills", BillViewSet, basename="beakon-bill")
router.register(r"invoices", InvoiceViewSet, basename="beakon-invoice")
router.register(r"journal-entries", JournalEntryViewSet, basename="beakon-je")
router.register(r"bank-accounts", BankAccountViewSet, basename="beakon-bank-account")
router.register(r"bank-transactions", BankTransactionViewSet, basename="beakon-bank-txn")


urlpatterns = [
    # Reference data
    path("currencies/", CurrencyListView.as_view(), name="beakon-currencies"),
    path("fx-rates/", FXRateListCreateView.as_view(), name="beakon-fx-rates"),
    path("fx-revaluation/", FXRevaluationView.as_view(), name="beakon-fx-revaluation"),
    # AI / OCR
    path("ocr/draft-from-bill/", AIBillDraftView.as_view(), name="beakon-ocr-draft-bill"),
    path("ocr/draft-from-bill-stream/", AIBillDraftStreamView.as_view(),
         name="beakon-ocr-draft-bill-stream"),
    path("ask/", AskBeakonView.as_view(), name="beakon-ask"),
    path("narrative/", ReportNarrativeView.as_view(), name="beakon-narrative"),
    path("anomalies/", AnomaliesView.as_view(), name="beakon-anomalies"),
    # Approval audit
    path("approval-actions/", ApprovalActionListView.as_view(),
         name="beakon-approval-actions"),
    # Reports
    path("reports/trial-balance/", TrialBalanceView.as_view(),
         name="beakon-report-tb"),
    path("reports/profit-loss/", ProfitLossView.as_view(),
         name="beakon-report-pnl"),
    path("reports/balance-sheet/", BalanceSheetView.as_view(),
         name="beakon-report-bs"),
    path("reports/cash-flow/", CashFlowView.as_view(), name="beakon-report-cf"),
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
]

urlpatterns += router.urls
