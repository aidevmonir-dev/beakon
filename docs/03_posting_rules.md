# Digits Clone - Posting Rules Document
# Version: 1.0
# Last Updated: 2026-04-13

---

## 1. Fundamental Accounting Rules

### Rule 1: Double-Entry Principle
Every financial transaction must be recorded with at least two entries:
- Total Debits MUST EQUAL Total Credits
- A journal entry that does not balance MUST be rejected at the database level
- No exceptions. No overrides. No admin bypass.

### Rule 2: Immutability of Posted Entries
Once a journal entry status is `posted`:
- It CANNOT be edited directly
- It CANNOT be deleted
- Corrections MUST be made by creating a **reversal entry** followed by a **new corrected entry**
- Draft entries CAN be edited freely before posting

### Rule 3: Source Traceability
Every journal entry MUST have:
- `source_type`: identifies what created this entry (bill, invoice, bank_transaction, manual, adjustment, reversal)
- `source_id`: the ID of the originating record
- `created_by_id`: the user who created it
- `posted_by_id`: the user who posted it (may differ from creator)
- Manual entries have source_type = 'manual'

### Rule 4: Period Lock Enforcement
- When a fiscal period `is_closed = TRUE`, no journal entries with dates in that period can be created, posted, or reversed
- Period closure requires explicit action by an authorized user
- Period reopening requires Owner/Admin role and creates an audit log entry

### Rule 5: AI Suggestions Are Non-Authoritative
- AI can SUGGEST categorization, matching, or corrections
- AI CANNOT directly create posted journal entries
- All AI suggestions must be reviewed and approved by a human
- Every AI action is logged in `ai_promptlog` and `ai_aiinference`

---

## 2. Account Type Rules

### Normal Balance Reference

| Account Type | Normal Balance | Debit Increases | Credit Increases |
|-------------|---------------|-----------------|------------------|
| Asset       | Debit         | Yes             | No               |
| Liability   | Credit        | No              | Yes              |
| Equity      | Credit        | No              | Yes              |
| Revenue     | Credit        | No              | Yes              |
| Expense     | Debit         | Yes             | No               |
| Contra Asset     | Credit   | No              | Yes              |
| Contra Liability | Debit    | Yes             | No               |
| Contra Revenue   | Debit    | Yes             | No               |
| Contra Expense   | Credit   | No              | Yes              |

### Account Hierarchy Rules
- An account can have a `parent_id` pointing to another account
- Parent and child must have the same `account_type`
- Posting should happen to leaf accounts only (no posting to parent/summary accounts)
- Reports roll up child balances into parent accounts

---

## 3. Journal Entry Lifecycle

### Status Flow

```
draft -> pending_review -> posted
                             |
                             v
                          reversed (creates new reversal entry)
```

### Status Definitions

| Status         | Meaning                                    | Editable | Counts in Reports |
|---------------|-------------------------------------------|----------|-------------------|
| draft          | Work in progress, not yet submitted        | Yes      | No                |
| pending_review | Submitted for approval (if approval required) | No    | No                |
| posted         | Finalized and locked                       | No       | Yes               |
| reversed       | Was posted, now reversed by another entry  | No       | Yes (net zero)    |

### Posting Validation Checklist
Before a journal entry can move to `posted`:

1. Total debits == total credits (REQUIRED)
2. At least 2 journal lines exist (REQUIRED)
3. All referenced accounts are `is_active = TRUE` (REQUIRED)
4. Entry date falls within an OPEN fiscal period (REQUIRED)
5. No journal line has both debit > 0 AND credit > 0 (REQUIRED)
6. No journal line has debit == 0 AND credit == 0 (REQUIRED)
7. If accounting policy `require_approval = TRUE`, entry must have `reviewed_by_id` (CONDITIONAL)
8. If accounting policy `allow_future_dates = FALSE`, date <= today (CONDITIONAL)
9. `posted_by_id` and `posted_at` are set (REQUIRED)

---

## 4. Transaction Posting Rules by Source

### 4.1 Manual Journal Entry
- Source type: `manual`
- Created by user directly
- Must pass all posting validations
- No auto-generation of entries

### 4.2 Bill Posting (Accounts Payable)

#### When bill status changes to `approved`:
```
DR  Expense Account (or Asset)    [per bill line amounts]
    CR  Accounts Payable              [bill total]
```

- One journal entry per bill
- Each bill line creates a debit journal line to its specified account
- The total is credited to the organization's default AP account
- `source_type = 'bill'`, `source_id = bill.id`

#### When bill is paid:
```
DR  Accounts Payable               [payment amount]
    CR  Bank/Cash Account               [payment amount]
```

- Separate journal entry for the payment
- `source_type = 'bill_payment'`, `source_id = bill.id`
- Bill status updates to `paid` when `balance_due = 0`

#### Partial Payment:
- Same structure as full payment but with partial amount
- Bill status remains `approved` until fully paid
- Each partial payment creates its own journal entry

### 4.3 Invoice Posting (Accounts Receivable)

#### When invoice status changes to `sent`:
```
DR  Accounts Receivable            [invoice total]
    CR  Revenue Account                 [per invoice line amounts]
```

- One journal entry per invoice
- Each invoice line creates a credit journal line to its specified revenue account
- The total is debited to the organization's default AR account
- `source_type = 'invoice'`, `source_id = invoice.id`

#### When payment is received:
```
DR  Bank/Cash Account              [payment amount]
    CR  Accounts Receivable             [payment amount]
```

- `source_type = 'invoice_payment'`, `source_id = invoice.id`
- Invoice status updates to `paid` when `balance_due = 0`

#### Partial Payment:
- Creates journal entry for partial amount
- Invoice status changes to `partially_paid`
- Each partial payment creates its own journal entry

### 4.4 Credit Note Posting

#### When credit note is issued:
```
DR  Revenue Account                [credit amount]
    CR  Accounts Receivable             [credit amount]
```

- Reduces the customer's outstanding balance
- `source_type = 'credit_note'`, `source_id = credit_note.id`

### 4.5 Bank Transaction Categorization

#### When a bank transaction is categorized:
```
For incoming (positive amount):
DR  Bank Account                   [amount]
    CR  Categorized Account             [amount]

For outgoing (negative amount):
DR  Categorized Account            [abs(amount)]
    CR  Bank Account                    [abs(amount)]
```

- `source_type = 'bank_transaction'`, `source_id = bank_transaction.id`
- Created as `draft` initially
- User reviews and posts
- If linked to a bill or invoice, the categorized account is AP or AR

### 4.6 Reversal Entry

#### When reversing a posted entry:
```
Original entry lines are recreated with debits and credits swapped
```

- New journal entry with `source_type = 'reversal'`
- `reversal_of_id` points to the original entry
- Original entry status changes to `reversed`
- Both entries remain in the ledger (net effect = zero)
- Reversal date can be same day or different (e.g., first day of next period)

### 4.7 Adjusting Entry

#### For period-end adjustments:
```
Specific to adjustment type:

Accrued expense:
DR  Expense Account                [amount]
    CR  Accrued Liabilities             [amount]

Prepaid expense:
DR  Expense Account                [amount]
    CR  Prepaid Expense (Asset)         [amount]

Unearned revenue:
DR  Unearned Revenue (Liability)   [amount]
    CR  Revenue Account                 [amount]

Depreciation:
DR  Depreciation Expense           [amount]
    CR  Accumulated Depreciation        [amount]
```

- `source_type = 'adjustment'`
- Created manually or from templates
- Must be within open fiscal period

---

## 5. Reconciliation Posting Rules

### Auto-Match Criteria
Transactions are suggested as matches when:

| Criterion           | Weight | Description                                |
|--------------------|--------|--------------------------------------------|
| Amount exact match  | High   | Bank amount == ledger amount               |
| Date proximity      | Medium | Within 3 business days                     |
| Reference match     | High   | Check number, reference ID matches         |
| Description match   | Low    | Fuzzy match on description/memo            |
| Vendor/payee match  | Medium | Known vendor name in description           |

### Match Types

| Type        | Description                                          | Example                                |
|-------------|------------------------------------------------------|----------------------------------------|
| 1-to-1      | One bank txn matches one ledger entry                | Single bill payment                    |
| Many-to-1   | Multiple bank txns match one ledger entry            | Split payment received in parts        |
| 1-to-many   | One bank txn matches multiple ledger entries         | Batch payment for multiple bills       |

### Reconciliation Session Rules
1. A session covers a specific date range for one bank account
2. Opening balance must match prior session's closing balance (if exists)
3. Session is `completed` only when:
   - All bank transactions are matched or explicitly excluded
   - Statement balance matches ledger balance
   - All exceptions are resolved or acknowledged
4. Completed reconciliation sessions should not be reopened casually

---

## 6. Report Generation Rules

### Profit & Loss (Income Statement)
```
Revenue (all credit balances in revenue accounts)
- Cost of Goods Sold (if applicable)
= Gross Profit
- Operating Expenses (all debit balances in expense accounts)
= Operating Income
+/- Other Income/Expenses
= Net Income
```

- Only includes POSTED journal entries
- Filtered by date range
- Revenue accounts show credit balances as positive
- Expense accounts show debit balances as positive

### Balance Sheet
```
Assets (all debit balances in asset accounts)
= Liabilities (all credit balances in liability accounts)
+ Equity (all credit balances in equity accounts + retained earnings)
```

- Point-in-time report (as of a specific date)
- Includes all POSTED entries up to that date
- Must balance: Assets = Liabilities + Equity
- Retained earnings = accumulated net income from all prior periods

### Cash Flow Statement
```
Operating Activities:
  Net Income
  + Adjustments for non-cash items
  + Changes in working capital (AR, AP, inventory)

Investing Activities:
  - Capital expenditures
  + Asset sales

Financing Activities:
  + Loans received
  - Loan repayments
  + Equity raised
  - Dividends paid

= Net Change in Cash
+ Opening Cash Balance
= Closing Cash Balance
```

### Trial Balance
```
For each account:
  Sum of all debit journal lines (posted entries only)
  Sum of all credit journal lines (posted entries only)
  Net balance

Total debits MUST equal total credits
```

- If trial balance does not balance, there is a system error
- This is a data integrity check as well as a report

---

## 7. Fiscal Period Rules

### Period Types
- **Monthly**: Jan 2026, Feb 2026, etc.
- **Quarterly**: Q1 2026, Q2 2026, etc.
- **Yearly**: FY2026

### Period Close Process
1. Run trial balance — must balance
2. Review all unposted draft entries in the period
3. Post or discard all pending entries
4. Complete reconciliation for all bank accounts
5. Review and resolve all exceptions
6. Generate period-end reports (P&L, BS)
7. Mark period as closed
8. Create audit log entry for closure

### Period Close Enforcement
- `is_closed = TRUE` prevents:
  - Creating new journal entries dated in this period
  - Posting draft entries dated in this period
  - Reversing entries dated in this period (reversal must be dated in an open period)
- Reopening a period requires:
  - Owner or Admin role
  - Explicit reason (logged in audit)
  - All subsequent period reports may need regeneration

---

## 8. Currency Rules (Phase 5)

### Basic Rules (Single Currency - Phase 1-4)
- All amounts stored in organization's base currency
- `currency` field on accounts and entries for future compatibility
- `exchange_rate` defaults to 1.0

### Multi-Currency Rules (Phase 5)
- Each transaction records: amount, currency, exchange_rate
- Base currency equivalent = amount * exchange_rate
- Unrealized gains/losses calculated at period end
- Realized gains/losses recorded on settlement
- Exchange rate source must be auditable

---

## 9. Number Sequence Rules

### Auto-Numbering Format

| Object        | Format          | Example      |
|--------------|-----------------|--------------|
| Journal Entry | JE-{NNNNNN}    | JE-000001    |
| Bill          | BILL-{NNNNNN}  | BILL-000001  |
| Invoice       | INV-{NNNNNN}   | INV-000001   |
| Credit Note   | CN-{NNNNNN}    | CN-000001    |

### Rules
- Sequences are per-organization
- Numbers are sequential with no gaps (for audit purposes)
- Format can be customized per organization (future)
- Once assigned, a number cannot be reused even if the entry is deleted/reversed

---

## 10. Service Layer Responsibilities

### LedgerPostingService
```python
class LedgerPostingService:
    def validate_entry(entry) -> ValidationResult
    def post_entry(entry, posted_by) -> JournalEntry
    def reverse_entry(entry, reversal_date, reversed_by) -> JournalEntry
    def check_period_open(date, organization) -> bool
    def get_account_balance(account, as_of_date) -> Decimal
    def get_trial_balance(organization, date_range) -> TrialBalanceData
```

### JournalValidationService
```python
class JournalValidationService:
    def validate_balance(entry) -> bool  # debits == credits
    def validate_accounts_active(entry) -> bool
    def validate_period_open(entry) -> bool
    def validate_no_zero_lines(entry) -> bool
    def validate_no_mixed_lines(entry) -> bool  # no line with both debit and credit
    def validate_minimum_lines(entry) -> bool  # at least 2
    def validate_future_date(entry, policy) -> bool
    def run_all_validations(entry) -> list[ValidationError]
```

### BillProcessingService
```python
class BillProcessingService:
    def create_bill(data, created_by) -> Bill
    def approve_bill(bill, approved_by) -> Bill  # creates AP journal entry
    def record_payment(bill, amount, bank_account, paid_by) -> Bill
    def cancel_bill(bill, cancelled_by) -> Bill
    def get_ap_aging(organization, as_of_date) -> AgingReport
```

### InvoicePostingService
```python
class InvoicePostingService:
    def create_invoice(data, created_by) -> Invoice
    def send_invoice(invoice) -> Invoice  # creates AR journal entry
    def record_payment(invoice, amount, bank_account) -> Invoice
    def issue_credit_note(invoice, amount, reason) -> CreditNote
    def cancel_invoice(invoice, cancelled_by) -> Invoice
    def get_ar_aging(organization, as_of_date) -> AgingReport
```

### ReconciliationService
```python
class ReconciliationService:
    def start_session(bank_account, date_range) -> ReconciliationSession
    def suggest_matches(session) -> list[MatchSuggestion]
    def confirm_match(bank_txn, journal_line, matched_by) -> ReconciliationMatch
    def flag_exception(bank_txn, exception_type) -> ReconciliationException
    def complete_session(session, completed_by) -> ReconciliationSession
    def get_unmatched_transactions(session) -> list[BankTransaction]
```

### TransactionCategorizationService
```python
class TransactionCategorizationService:
    def categorize(transaction) -> CategorizationSuggestion
    def apply_categorization(transaction, account, vendor, applied_by) -> BankTransaction
    def create_journal_from_transaction(transaction, created_by) -> JournalEntry
    def bulk_categorize(transactions) -> list[CategorizationSuggestion]
```

---

## 11. Validation Error Codes

| Code    | Message                                          | Severity |
|---------|--------------------------------------------------|----------|
| LED001  | Journal entry does not balance                   | Error    |
| LED002  | Minimum 2 journal lines required                 | Error    |
| LED003  | Account is inactive                              | Error    |
| LED004  | Fiscal period is closed                          | Error    |
| LED005  | Journal line has both debit and credit            | Error    |
| LED006  | Journal line has zero amount                     | Error    |
| LED007  | Entry date is in the future (policy violation)   | Error    |
| LED008  | Approval required but not provided               | Error    |
| LED009  | Posted entry cannot be modified                  | Error    |
| LED010  | Reversed entry cannot be reversed again          | Error    |
| REC001  | Statement balance mismatch                       | Warning  |
| REC002  | Duplicate transaction detected                   | Warning  |
| REC003  | Unmatched transactions remain                    | Warning  |
| AP001   | Bill total does not match line items              | Error    |
| AP002   | Payment exceeds balance due                       | Error    |
| AP003   | Bill already cancelled                           | Error    |
| AR001   | Invoice total does not match line items           | Error    |
| AR002   | Payment exceeds balance due                       | Error    |
| AR003   | Credit note exceeds invoice balance               | Error    |
