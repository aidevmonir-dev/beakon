"""PostingRule — registry of transaction-type → debit/credit account roles.

Per Thomas's `Accounting_Engine_Developer_Instructions.docx` §3 step 3,
the engine maps each transaction type to a fixed Dr/Cr pattern:

    Supplier invoice  → DR Expense/COGS         CR Accounts Payable
    Customer invoice  → DR Accounts Receivable  CR Sales Revenue
    Supplier payment  → DR Accounts Payable     CR Bank
    Customer receipt  → DR Bank                 CR Accounts Receivable
    Bank charge       → DR Bank Charges Expense CR Bank

Today these rules live inside the service layer (BillService, InvoiceService,
BankChargeService). This registry codifies them as data so:

  1. New transaction types (payroll, fixed-asset, portfolio-trade, loan,
     period-end accruals) can be added without code changes — just rows.
  2. The AI proposal pipeline can read the registry to decide which roles
     to fill and surface a teaching note ("DR expense / CR AP because this
     is a supplier-invoice transaction").
  3. Auditors / Thomas can review the active rule set in one place.

The model is intentionally additive — existing services keep working. The
registry is the source of truth for *which* accounts a transaction type
needs; the service layer still composes the JE.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models

from organizations.models import Organization


# ── Built-in transaction types ─────────────────────────────────────────────
# Phase 1: Thomas's §3 list (5 types). Tier 1 expansion adds 6 more covering
# the remaining day-to-day operating cycle.
TXN_SUPPLIER_INVOICE = "supplier_invoice"
TXN_CUSTOMER_INVOICE = "customer_invoice"
TXN_SUPPLIER_PAYMENT = "supplier_payment"
TXN_CUSTOMER_RECEIPT = "customer_receipt"
TXN_BANK_CHARGE = "bank_charge"
# Tier 1 (cash movement + adjustments)
TXN_BANK_TRANSFER = "bank_transfer"
TXN_BANK_INTEREST = "bank_interest"
TXN_OWNER_CONTRIBUTION = "owner_contribution"
TXN_VENDOR_CREDIT_NOTE = "vendor_credit_note"
TXN_CUSTOMER_CREDIT_NOTE = "customer_credit_note"
TXN_VAT_REMITTANCE = "vat_remittance"
# Tier 2 (master-driven flows — Loan / Commitment / Property / Policy)
TXN_LOAN_DRAWDOWN = "loan_drawdown"
TXN_LOAN_REPAYMENT = "loan_repayment"
TXN_LOAN_INTEREST_ACCRUAL = "loan_interest_accrual"
TXN_CAPITAL_CALL = "capital_call"
TXN_DISTRIBUTION = "distribution"
TXN_RENTAL_INCOME = "rental_income"
TXN_PROPERTY_EXPENSE = "property_expense"
TXN_INSURANCE_PREMIUM = "insurance_premium"
TXN_INSURANCE_CLAIM = "insurance_claim"

TRANSACTION_TYPE_CHOICES = [
    (TXN_SUPPLIER_INVOICE, "Supplier invoice"),
    (TXN_CUSTOMER_INVOICE, "Customer invoice"),
    (TXN_SUPPLIER_PAYMENT, "Supplier payment"),
    (TXN_CUSTOMER_RECEIPT, "Customer receipt"),
    (TXN_BANK_CHARGE, "Bank charge"),
    (TXN_BANK_TRANSFER, "Bank transfer"),
    (TXN_BANK_INTEREST, "Bank interest received"),
    (TXN_OWNER_CONTRIBUTION, "Owner capital contribution"),
    (TXN_VENDOR_CREDIT_NOTE, "Vendor credit note"),
    (TXN_CUSTOMER_CREDIT_NOTE, "Customer credit note"),
    (TXN_VAT_REMITTANCE, "VAT remittance"),
    (TXN_LOAN_DRAWDOWN, "Loan drawdown"),
    (TXN_LOAN_REPAYMENT, "Loan repayment"),
    (TXN_LOAN_INTEREST_ACCRUAL, "Loan interest accrual"),
    (TXN_CAPITAL_CALL, "Capital call (PE commitment drawdown)"),
    (TXN_DISTRIBUTION, "Distribution received (PE)"),
    (TXN_RENTAL_INCOME, "Rental income"),
    (TXN_PROPERTY_EXPENSE, "Property expense"),
    (TXN_INSURANCE_PREMIUM, "Insurance premium paid"),
    (TXN_INSURANCE_CLAIM, "Insurance claim received"),
]


# ── Account-role tokens ──────────────────────────────────────────────────
# A "role" describes the slot — the engine resolves the actual Account at
# posting time by either:
#   * looking up Account.account_subtype that matches (e.g. "accounts_payable")
#   * a per-line account_id provided by the caller (e.g. expense_account)
#
# Roles map 1:1 to the values used today inside the services. Anything
# new ships with a constant here so callers never use a free-text string.
ROLE_AP = "accounts_payable"           # subtype lookup
ROLE_AR = "accounts_receivable"        # subtype lookup
ROLE_BANK = "bank"                     # caller-provided
ROLE_EXPENSE = "expense"               # caller-provided per BillLine
ROLE_REVENUE = "revenue"               # caller-provided per InvoiceLine
ROLE_BANK_CHARGE_EXPENSE = "bank_charge_expense"  # auto-resolve or caller-provided
# Tier 1 additions
ROLE_INTEREST_INCOME = "interest_income"     # auto-resolve revenue, prefers /interest/i
ROLE_CAPITAL = "capital"                     # subtype lookup
ROLE_VAT_PAYABLE = "vat_payable"             # subtype lookup
ROLE_BANK_TARGET = "bank_target"             # destination side of a transfer
ROLE_BANK_SOURCE = "bank_source"             # source side of a transfer
# Tier 2 additions (master-driven flows)
ROLE_LOAN_PAYABLE = "loan_payable"           # subtype lookup
ROLE_LOAN_RECEIVABLE = "loan_receivable"     # subtype lookup
ROLE_INTEREST_EXPENSE = "interest_expense"   # auto-resolve, prefers /interest/i
ROLE_INVESTMENT = "investment"               # caller-provided (PE basis account)
ROLE_INVESTMENT_GAIN = "investment_gain"     # caller-provided (gain on distribution)
ROLE_RENTAL_INCOME = "rental_income"         # caller-provided
ROLE_PROPERTY_EXPENSE = "property_expense"   # caller-provided
ROLE_INSURANCE_EXPENSE = "insurance_expense" # caller-provided
ROLE_INSURANCE_RECOVERY = "insurance_recovery"  # caller-provided

ACCOUNT_ROLE_CHOICES = [
    (ROLE_AP, "Accounts Payable (subtype-resolved)"),
    (ROLE_AR, "Accounts Receivable (subtype-resolved)"),
    (ROLE_BANK, "Bank account (caller-provided)"),
    (ROLE_EXPENSE, "Expense account (caller-provided per line)"),
    (ROLE_REVENUE, "Revenue account (caller-provided per line)"),
    (ROLE_BANK_CHARGE_EXPENSE, "Bank-charge expense (auto or caller-provided)"),
    (ROLE_INTEREST_INCOME, "Interest income (auto-resolve / caller-provided)"),
    (ROLE_CAPITAL, "Capital — equity (subtype-resolved)"),
    (ROLE_VAT_PAYABLE, "VAT Payable (subtype-resolved)"),
    (ROLE_BANK_TARGET, "Target bank account (caller-provided)"),
    (ROLE_BANK_SOURCE, "Source bank account (caller-provided)"),
    (ROLE_LOAN_PAYABLE, "Loan Payable (subtype-resolved)"),
    (ROLE_LOAN_RECEIVABLE, "Loan Receivable (subtype-resolved)"),
    (ROLE_INTEREST_EXPENSE, "Interest expense (auto-resolve / caller-provided)"),
    (ROLE_INVESTMENT, "Investment (caller-provided)"),
    (ROLE_INVESTMENT_GAIN, "Investment gain — revenue (caller-provided)"),
    (ROLE_RENTAL_INCOME, "Rental income (caller-provided)"),
    (ROLE_PROPERTY_EXPENSE, "Property expense (caller-provided)"),
    (ROLE_INSURANCE_EXPENSE, "Insurance expense (caller-provided)"),
    (ROLE_INSURANCE_RECOVERY, "Insurance recovery — revenue (caller-provided)"),
]


class PostingRule(models.Model):
    """One row = one transaction type's debit/credit pattern.

    Active rules form the engine's posting-rule registry. Inactive rows
    are kept for history but ignored at posting time.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE,
        related_name="posting_rules",
    )
    transaction_type = models.CharField(
        max_length=40,
        choices=TRANSACTION_TYPE_CHOICES,
        help_text="Which transaction type this rule covers.",
    )
    name = models.CharField(
        max_length=120,
        help_text="Human-readable description, e.g. 'Supplier invoice (AP accrual)'.",
    )
    debit_role = models.CharField(
        max_length=40,
        choices=ACCOUNT_ROLE_CHOICES,
        help_text="Role of the account on the debit side.",
    )
    credit_role = models.CharField(
        max_length=40,
        choices=ACCOUNT_ROLE_CHOICES,
        help_text="Role of the account on the credit side.",
    )
    description = models.TextField(
        blank=True,
        help_text="Optional teaching note shown next to AI proposals.",
    )
    is_active = models.BooleanField(default=True)
    is_system = models.BooleanField(
        default=False,
        help_text="Seeded by Beakon — block deletion in admin.",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="created_posting_rules",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_posting_rule"
        unique_together = ("organization", "transaction_type")
        ordering = ["transaction_type"]

    def __str__(self):
        return f"{self.transaction_type}: DR {self.debit_role} / CR {self.credit_role}"


# ── Convenience: the default seed (Thomas's 5 types, verbatim) ───────────
# Used by the data-migration seeder and by tests.
DEFAULT_RULES = [
    {
        "transaction_type": TXN_SUPPLIER_INVOICE,
        "name": "Supplier invoice (AP accrual)",
        "debit_role": ROLE_EXPENSE,
        "credit_role": ROLE_AP,
        "description": (
            "When a supplier invoice is entered, debit Expense or Cost of "
            "Sales and credit Accounts Payable."
        ),
    },
    {
        "transaction_type": TXN_CUSTOMER_INVOICE,
        "name": "Customer invoice (AR issuance)",
        "debit_role": ROLE_AR,
        "credit_role": ROLE_REVENUE,
        "description": (
            "When a customer invoice is entered, debit Accounts Receivable "
            "and credit Sales Revenue."
        ),
    },
    {
        "transaction_type": TXN_SUPPLIER_PAYMENT,
        "name": "Supplier payment",
        "debit_role": ROLE_AP,
        "credit_role": ROLE_BANK,
        "description": (
            "When the supplier is paid, debit Accounts Payable and credit "
            "the Bank account."
        ),
    },
    {
        "transaction_type": TXN_CUSTOMER_RECEIPT,
        "name": "Customer receipt",
        "debit_role": ROLE_BANK,
        "credit_role": ROLE_AR,
        "description": (
            "When the customer pays, debit the Bank account and credit "
            "Accounts Receivable."
        ),
    },
    {
        "transaction_type": TXN_BANK_CHARGE,
        "name": "Bank charge",
        "debit_role": ROLE_BANK_CHARGE_EXPENSE,
        "credit_role": ROLE_BANK,
        "description": (
            "When a bank charge is entered, debit Bank Charges Expense "
            "and credit the Bank account."
        ),
    },
    # ── Tier 1 expansion ─────────────────────────────────────────────────
    {
        "transaction_type": TXN_BANK_TRANSFER,
        "name": "Bank transfer (own accounts)",
        "debit_role": ROLE_BANK_TARGET,
        "credit_role": ROLE_BANK_SOURCE,
        "description": (
            "Move cash between two bank/cash accounts on the same entity: "
            "debit the destination account and credit the source account. "
            "Same currency only — cross-currency transfers are an "
            "FX-conversion transaction with FX gain/loss treatment."
        ),
    },
    {
        "transaction_type": TXN_BANK_INTEREST,
        "name": "Bank interest received",
        "debit_role": ROLE_BANK,
        "credit_role": ROLE_INTEREST_INCOME,
        "description": (
            "When the bank credits interest, debit the Bank account and "
            "credit Interest Income."
        ),
    },
    {
        "transaction_type": TXN_OWNER_CONTRIBUTION,
        "name": "Owner capital contribution",
        "debit_role": ROLE_BANK,
        "credit_role": ROLE_CAPITAL,
        "description": (
            "When the owner injects funds into the entity, debit the "
            "Bank account and credit Capital (equity)."
        ),
    },
    {
        "transaction_type": TXN_VENDOR_CREDIT_NOTE,
        "name": "Vendor credit note (refund / adjustment)",
        "debit_role": ROLE_AP,
        "credit_role": ROLE_EXPENSE,
        "description": (
            "When a vendor issues a credit note, debit Accounts Payable "
            "(reduce what we owe) and credit the original Expense (reverse "
            "the cost). Counterparty dimension auto-derived from the vendor."
        ),
    },
    {
        "transaction_type": TXN_CUSTOMER_CREDIT_NOTE,
        "name": "Customer credit note (refund / adjustment)",
        "debit_role": ROLE_REVENUE,
        "credit_role": ROLE_AR,
        "description": (
            "When we issue a credit note to a customer, debit Revenue "
            "(reduce recognised revenue) and credit Accounts Receivable "
            "(reduce what they owe). Counterparty dimension auto-derived "
            "from the customer."
        ),
    },
    {
        "transaction_type": TXN_VAT_REMITTANCE,
        "name": "VAT remittance to authority",
        "debit_role": ROLE_VAT_PAYABLE,
        "credit_role": ROLE_BANK,
        "description": (
            "When net output VAT is paid to the tax authority, debit VAT "
            "Payable (clear the liability) and credit the Bank account. "
            "Compute the net amount with VATReportService.report() then "
            "post the settlement here."
        ),
    },
    # ── Tier 2 expansion (master-driven flows) ───────────────────────────
    {
        "transaction_type": TXN_LOAN_DRAWDOWN,
        "name": "Loan drawdown",
        "debit_role": ROLE_BANK,                # liability side
        "credit_role": ROLE_LOAN_PAYABLE,
        "description": (
            "Cash hits the bank when a loan is drawn (we are the borrower); "
            "DR Bank / CR Loan Payable. On the asset side (we are the lender) "
            "the entry is reversed. Tagged with LOAN dimension."
        ),
    },
    {
        "transaction_type": TXN_LOAN_REPAYMENT,
        "name": "Loan repayment (principal + interest)",
        "debit_role": ROLE_LOAN_PAYABLE,        # principal side
        "credit_role": ROLE_BANK,
        "description": (
            "Repayment splits between principal (DR Loan Payable) and "
            "interest (DR Interest Expense). Both lines credit Bank for "
            "the total. Tagged with LOAN dimension."
        ),
    },
    {
        "transaction_type": TXN_LOAN_INTEREST_ACCRUAL,
        "name": "Loan interest accrual (period-end)",
        "debit_role": ROLE_INTEREST_EXPENSE,
        "credit_role": ROLE_LOAN_PAYABLE,
        "description": (
            "Period-end recognition of interest expense before cash "
            "payment: DR Interest Expense / CR Loan Payable. Tagged with "
            "LOAN dimension."
        ),
    },
    {
        "transaction_type": TXN_CAPITAL_CALL,
        "name": "Capital call (PE commitment funded)",
        "debit_role": ROLE_INVESTMENT,
        "credit_role": ROLE_BANK,
        "description": (
            "When a private-market commitment calls capital, debit the "
            "investment account (basis) and credit Bank. Tagged with COM "
            "dimension."
        ),
    },
    {
        "transaction_type": TXN_DISTRIBUTION,
        "name": "Distribution received (PE)",
        "debit_role": ROLE_BANK,
        "credit_role": ROLE_INVESTMENT,
        "description": (
            "Distribution from a PE commitment splits between return-of-"
            "capital (CR Investment, basis reduction) and gain (CR "
            "Investment Income). Caller declares the split — Beakon does "
            "not derive it. Tagged with COM dimension."
        ),
    },
    {
        "transaction_type": TXN_RENTAL_INCOME,
        "name": "Rental income",
        "debit_role": ROLE_BANK,
        "credit_role": ROLE_RENTAL_INCOME,
        "description": (
            "Rent received: DR Bank / CR Rental Income. Tagged with PROP "
            "dimension so per-property reporting rolls up correctly."
        ),
    },
    {
        "transaction_type": TXN_PROPERTY_EXPENSE,
        "name": "Property expense",
        "debit_role": ROLE_PROPERTY_EXPENSE,
        "credit_role": ROLE_BANK,
        "description": (
            "Maintenance / utility / management fee paid for a property: "
            "DR Property Expense / CR Bank. Tagged with PROP dimension."
        ),
    },
    {
        "transaction_type": TXN_INSURANCE_PREMIUM,
        "name": "Insurance premium paid",
        "debit_role": ROLE_INSURANCE_EXPENSE,
        "credit_role": ROLE_BANK,
        "description": (
            "Premium settled out of bank: DR Insurance Expense / CR Bank. "
            "Tagged with POL dimension."
        ),
    },
    {
        "transaction_type": TXN_INSURANCE_CLAIM,
        "name": "Insurance claim received",
        "debit_role": ROLE_BANK,
        "credit_role": ROLE_INSURANCE_RECOVERY,
        "description": (
            "Claim payout received: DR Bank / CR Insurance Recovery. "
            "Tagged with POL dimension."
        ),
    },
]
