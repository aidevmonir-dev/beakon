"""Beakon accounting kernel — enums, statuses, codes.

These are the values Thomas owns per the founder working paper
(2026-04-17). The defaults below match the blueprint verbatim; change them
here when Thomas's accounting spec diverges. Do not hardcode these strings
elsewhere — import from this module.
"""

# ── Entity types ──────────────────────────────────────────────────────────
# Family-office context requires more than just "company". Thomas's scope
# includes trusts and foundations explicitly.
ENTITY_COMPANY = "company"
ENTITY_HOLDING_COMPANY = "holding_company"
ENTITY_OPERATING_COMPANY = "operating_company"
ENTITY_TRUST = "trust"
ENTITY_FOUNDATION = "foundation"
ENTITY_PARTNERSHIP = "partnership"
ENTITY_INDIVIDUAL = "individual"
ENTITY_FAMILY = "family"
ENTITY_FUND = "fund"
ENTITY_BRANCH = "branch"
ENTITY_SPV = "spv"
ENTITY_OTHER = "other"

ENTITY_TYPE_CHOICES = [
    (ENTITY_COMPANY, "Company"),
    (ENTITY_HOLDING_COMPANY, "Holding Company"),
    (ENTITY_OPERATING_COMPANY, "Operating Company"),
    (ENTITY_TRUST, "Trust"),
    (ENTITY_FOUNDATION, "Foundation"),
    (ENTITY_PARTNERSHIP, "Partnership"),
    (ENTITY_INDIVIDUAL, "Individual"),
    (ENTITY_FAMILY, "Family"),
    (ENTITY_FUND, "Fund"),
    (ENTITY_BRANCH, "Branch"),
    (ENTITY_SPV, "SPV"),
    (ENTITY_OTHER, "Other"),
]


# ── Accounting standards ──────────────────────────────────────────────────
# Per Thomas's WhatsApp 2026-04-25: every entity declares which accounting
# framework its books follow. The AI proposal pipeline reads this to (a)
# tailor account suggestions to the standard's conventions and (b) include
# a teaching note so users learn the rule behind each booking.
#
# v1 deliberately keeps the list short. "OTHER" is an escape hatch for
# jurisdictions we don't have explicit support for yet (Swiss CO/Swiss
# GAAP FER, German HGB, Indian Ind-AS, etc.) — the AI then falls back to
# IFRS-equivalent treatment with a warning in the reasoning.
ACCT_STD_IFRS = "ifrs"
ACCT_STD_US_GAAP = "us_gaap"
ACCT_STD_UK_GAAP = "uk_gaap"
ACCT_STD_OTHER = "other"

ACCOUNTING_STANDARD_CHOICES = [
    (ACCT_STD_IFRS, "IFRS — International Financial Reporting Standards"),
    (ACCT_STD_US_GAAP, "US GAAP — United States Generally Accepted Accounting Principles"),
    (ACCT_STD_UK_GAAP, "UK GAAP — FRS 102 / FRS 105"),
    (ACCT_STD_OTHER, "Other / local standard (AI defaults to IFRS-equivalent)"),
]

# Display labels (short) used in pills, tables, and AI prompt text.
ACCOUNTING_STANDARD_SHORT = {
    ACCT_STD_IFRS:    "IFRS",
    ACCT_STD_US_GAAP: "US GAAP",
    ACCT_STD_UK_GAAP: "UK GAAP",
    ACCT_STD_OTHER:   "Other / local",
}


def default_accounting_standard_for_country(country_code: str) -> str:
    """Pick a sensible default standard from the entity's country.

    Conservative mapping — the user can always change it. We deliberately
    do NOT auto-pick US_GAAP for Canada or other jurisdictions where IFRS
    is at least equally valid.
    """
    cc = (country_code or "").upper().strip()
    if cc == "US":
        return ACCT_STD_US_GAAP
    if cc == "GB":
        return ACCT_STD_UK_GAAP
    return ACCT_STD_IFRS


# ── Account types (fundamental) ───────────────────────────────────────────
ACCOUNT_TYPE_ASSET = "asset"
ACCOUNT_TYPE_LIABILITY = "liability"
ACCOUNT_TYPE_EQUITY = "equity"
ACCOUNT_TYPE_REVENUE = "revenue"
ACCOUNT_TYPE_EXPENSE = "expense"

ACCOUNT_TYPE_CHOICES = [
    (ACCOUNT_TYPE_ASSET, "Asset"),
    (ACCOUNT_TYPE_LIABILITY, "Liability"),
    (ACCOUNT_TYPE_EQUITY, "Equity"),
    (ACCOUNT_TYPE_REVENUE, "Revenue"),
    (ACCOUNT_TYPE_EXPENSE, "Expense"),
]


# ── Account subtypes (family-office-aware, not final) ─────────────────────
# Placeholder list — Thomas to refine as part of Objective 1 "base chart of
# accounts logic". Includes structures for investment-holding and
# intercompany which Digits-style COAs don't expose.
ACCOUNT_SUBTYPE_CHOICES = [
    # Assets
    ("bank", "Bank"),
    ("cash", "Cash on Hand"),
    ("current_asset", "Current Asset"),
    ("accounts_receivable", "Accounts Receivable"),
    ("intercompany_receivable", "Intercompany Receivable (Due From)"),
    ("prepaid", "Prepaid Expenses"),
    ("inventory", "Inventory"),
    ("investment", "Investment"),
    ("loan_receivable", "Loan Receivable"),
    ("fixed_asset", "Fixed Asset"),
    ("accumulated_depreciation", "Accumulated Depreciation"),
    ("intangible_asset", "Intangible Asset"),
    ("other_asset", "Other Asset"),
    # Liabilities
    ("accounts_payable", "Accounts Payable"),
    ("intercompany_payable", "Intercompany Payable (Due To)"),
    ("accrued_liability", "Accrued Liability"),
    ("current_liability", "Current Liability"),
    ("loan_payable", "Loan Payable"),
    ("long_term_liability", "Long-Term Liability"),
    ("tax_payable", "Tax Payable"),
    ("vat_payable", "VAT Payable"),
    ("other_liability", "Other Liability"),
    # Equity
    ("capital", "Capital / Contributed"),
    ("retained_earnings", "Retained Earnings"),
    ("revaluation_reserve", "Revaluation Reserve"),
    ("fx_translation_reserve", "FX Translation Reserve"),
    ("distribution", "Distribution / Owner's Draw"),
    ("other_equity", "Other Equity"),
    # Revenue
    ("operating_revenue", "Operating Revenue"),
    ("investment_income", "Investment Income"),
    ("fx_gain", "FX Gain"),
    ("other_income", "Other Income"),
    # Expense
    ("cogs", "Cost of Goods Sold"),
    ("operating_expense", "Operating Expense"),
    ("professional_fees", "Professional Fees"),
    ("depreciation", "Depreciation"),
    ("fx_loss", "FX Loss"),
    ("tax_expense", "Tax Expense"),
    ("other_expense", "Other Expense"),
]


# ── Normal balance ────────────────────────────────────────────────────────
NORMAL_BALANCE_DEBIT = "debit"
NORMAL_BALANCE_CREDIT = "credit"
NORMAL_BALANCE_CHOICES = [
    (NORMAL_BALANCE_DEBIT, "Debit"),
    (NORMAL_BALANCE_CREDIT, "Credit"),
]

NORMAL_BALANCE_MAP = {
    ACCOUNT_TYPE_ASSET: NORMAL_BALANCE_DEBIT,
    ACCOUNT_TYPE_LIABILITY: NORMAL_BALANCE_CREDIT,
    ACCOUNT_TYPE_EQUITY: NORMAL_BALANCE_CREDIT,
    ACCOUNT_TYPE_REVENUE: NORMAL_BALANCE_CREDIT,
    ACCOUNT_TYPE_EXPENSE: NORMAL_BALANCE_DEBIT,
}


# ── Monetary account subtypes (subject to FX revaluation) ─────────────────
# Period-end FX revaluation re-translates the FUNCTIONAL value of these
# accounts to the closing rate when their underlying transaction currency
# differs from the entity's functional currency. Non-monetary balances
# (inventory, fixed assets, equity, P&L) carry at historical rate.
MONETARY_SUBTYPES = (
    "bank",
    "cash",
    "accounts_receivable",
    "intercompany_receivable",
    "loan_receivable",
    "accounts_payable",
    "intercompany_payable",
    "accrued_liability",
    "current_liability",
    "loan_payable",
    "long_term_liability",
    "tax_payable",
    "vat_payable",
)


# ── Journal entry status machine (per blueprint p.7) ──────────────────────
# Blueprint prescribes: draft → pending_approval → approved → rejected → posted
# Plus reversed for post-posting corrections.
JE_DRAFT = "draft"
JE_PENDING_APPROVAL = "pending_approval"
JE_APPROVED = "approved"
JE_REJECTED = "rejected"
JE_POSTED = "posted"
JE_REVERSED = "reversed"

JE_STATUS_CHOICES = [
    (JE_DRAFT, "Draft"),
    (JE_PENDING_APPROVAL, "Pending Approval"),
    (JE_APPROVED, "Approved"),
    (JE_REJECTED, "Rejected"),
    (JE_POSTED, "Posted"),
    (JE_REVERSED, "Reversed"),
]

# Allowed transitions. Enforced by the service layer.
JE_TRANSITIONS = {
    JE_DRAFT:           {JE_PENDING_APPROVAL, JE_DRAFT},
    JE_PENDING_APPROVAL: {JE_APPROVED, JE_REJECTED, JE_DRAFT},
    JE_APPROVED:        {JE_POSTED, JE_DRAFT},
    JE_REJECTED:        {JE_DRAFT},
    JE_POSTED:          {JE_REVERSED},
    JE_REVERSED:        set(),   # terminal
}

# Convenience buckets
JE_EDITABLE = {JE_DRAFT, JE_REJECTED}
# Posted entries impact ledger balances. Reversed entries also impact
# balances — the original stays on the books with status=reversed (audit
# marker), and the reversal mirror is a separate posted entry. The two
# net to zero. Excluding reversed entries from balance queries would
# leave the mirror's impact in place without the original to cancel it,
# producing a doubled erroneous swing.
JE_LEDGER_IMPACTING = {JE_POSTED, JE_REVERSED}


# ── Source types ──────────────────────────────────────────────────────────
SOURCE_MANUAL = "manual"
SOURCE_BILL = "bill"
SOURCE_BILL_PAYMENT = "bill_payment"
SOURCE_INVOICE = "invoice"
SOURCE_INVOICE_PAYMENT = "invoice_payment"
SOURCE_BANK_TRANSACTION = "bank_transaction"
SOURCE_INTERCOMPANY = "intercompany"
SOURCE_OPENING_BALANCE = "opening_balance"
SOURCE_ADJUSTMENT = "adjustment"
SOURCE_REVERSAL = "reversal"
SOURCE_FX_REVALUATION = "fx_revaluation"

SOURCE_TYPE_CHOICES = [
    (SOURCE_MANUAL, "Manual Entry"),
    (SOURCE_BILL, "Bill"),
    (SOURCE_BILL_PAYMENT, "Bill Payment"),
    (SOURCE_INVOICE, "Invoice"),
    (SOURCE_INVOICE_PAYMENT, "Invoice Payment"),
    (SOURCE_BANK_TRANSACTION, "Bank Transaction"),
    (SOURCE_INTERCOMPANY, "Intercompany"),
    (SOURCE_OPENING_BALANCE, "Opening Balance"),
    (SOURCE_ADJUSTMENT, "Adjustment"),
    (SOURCE_REVERSAL, "Reversal"),
    (SOURCE_FX_REVALUATION, "FX Revaluation"),
]


# ── Period status ─────────────────────────────────────────────────────────
# Blueprint requires period control. Three levels provide flexibility:
# open = accepts posting; soft_close = blocks new JEs but allows reversals
# for post-close adjustments; closed = fully locked.
PERIOD_OPEN = "open"
PERIOD_SOFT_CLOSE = "soft_close"
PERIOD_CLOSED = "closed"

PERIOD_STATUS_CHOICES = [
    (PERIOD_OPEN, "Open"),
    (PERIOD_SOFT_CLOSE, "Soft Close"),
    (PERIOD_CLOSED, "Closed"),
]

PERIOD_MONTH = "month"
PERIOD_QUARTER = "quarter"
PERIOD_YEAR = "year"

PERIOD_TYPE_CHOICES = [
    (PERIOD_MONTH, "Month"),
    (PERIOD_QUARTER, "Quarter"),
    (PERIOD_YEAR, "Year"),
]


# ── Approval action types (audit trail) ───────────────────────────────────
APPROVAL_SUBMITTED = "submitted"
APPROVAL_APPROVED = "approved"
APPROVAL_REJECTED = "rejected"
APPROVAL_RETURNED_TO_DRAFT = "returned_to_draft"
APPROVAL_POSTED = "posted"
APPROVAL_REVERSED = "reversed"

APPROVAL_ACTION_CHOICES = [
    (APPROVAL_SUBMITTED, "Submitted for approval"),
    (APPROVAL_APPROVED, "Approved"),
    (APPROVAL_REJECTED, "Rejected"),
    (APPROVAL_RETURNED_TO_DRAFT, "Returned to draft"),
    (APPROVAL_POSTED, "Posted"),
    (APPROVAL_REVERSED, "Reversed"),
]


# ── Error codes (prefixed BK for Beakon) ──────────────────────────────────
ERR_NOT_BALANCED = "BK001"
ERR_MIN_LINES = "BK002"
ERR_INACTIVE_ACCOUNT = "BK003"
ERR_PERIOD_CLOSED = "BK004"
ERR_MIXED_LINE = "BK005"
ERR_ZERO_LINE = "BK006"
ERR_FUTURE_DATE = "BK007"
ERR_POSTED_IMMUTABLE = "BK008"
ERR_ALREADY_REVERSED = "BK009"
ERR_INVALID_TRANSITION = "BK010"
ERR_ENTITY_MISMATCH = "BK011"
ERR_FX_RATE_MISSING = "BK012"
ERR_ACCOUNT_ENTITY_MISMATCH = "BK013"
ERR_INTERCOMPANY_UNBALANCED = "BK014"
ERR_CURRENCY_MISMATCH = "BK015"
ERR_SELF_APPROVAL = "BK016"
