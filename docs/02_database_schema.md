# Digits Clone - Database Schema
# Version: 1.0
# Last Updated: 2026-04-13
# Database: PostgreSQL

---

## Naming Conventions

- Table names: lowercase, snake_case, plural (Django default: app_model)
- Primary keys: `id` (UUID or BigAutoField)
- Foreign keys: `<related_model>_id`
- Timestamps: `created_at`, `updated_at`
- Soft delete: `is_deleted`, `deleted_at` (where needed)
- All money fields: `DecimalField(max_digits=19, decimal_places=4)`
- All tables include: `created_at`, `updated_at`

---

## Layer A: Identity & Tenancy

### accounts_user
```sql
id                  BIGSERIAL PRIMARY KEY
email               VARCHAR(255) UNIQUE NOT NULL
password            VARCHAR(255) NOT NULL
first_name          VARCHAR(100)
last_name           VARCHAR(100)
is_active           BOOLEAN DEFAULT TRUE
is_staff            BOOLEAN DEFAULT FALSE
is_email_verified   BOOLEAN DEFAULT FALSE
last_login          TIMESTAMP
date_joined         TIMESTAMP DEFAULT NOW()
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### accounts_userprofile
```sql
id                  BIGSERIAL PRIMARY KEY
user_id             BIGINT UNIQUE REFERENCES accounts_user(id)
phone               VARCHAR(20)
avatar_url          VARCHAR(500)
timezone            VARCHAR(50) DEFAULT 'UTC'
locale              VARCHAR(10) DEFAULT 'en'
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### accounts_loginsession
```sql
id                  BIGSERIAL PRIMARY KEY
user_id             BIGINT REFERENCES accounts_user(id)
ip_address          INET
user_agent          TEXT
session_key         VARCHAR(255)
is_active           BOOLEAN DEFAULT TRUE
logged_in_at        TIMESTAMP DEFAULT NOW()
logged_out_at       TIMESTAMP
```

### organizations_organization
```sql
id                  BIGSERIAL PRIMARY KEY
name                VARCHAR(255) NOT NULL
slug                VARCHAR(255) UNIQUE NOT NULL
legal_name          VARCHAR(255)
tax_id              VARCHAR(100)
address_line1       VARCHAR(255)
address_line2       VARCHAR(255)
city                VARCHAR(100)
state               VARCHAR(100)
country             VARCHAR(2)
postal_code         VARCHAR(20)
phone               VARCHAR(20)
website             VARCHAR(255)
currency            VARCHAR(3) DEFAULT 'USD'
timezone            VARCHAR(50) DEFAULT 'UTC'
fiscal_year_start   INTEGER DEFAULT 1  -- month number (1=Jan)
logo_url            VARCHAR(500)
is_active           BOOLEAN DEFAULT TRUE
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### organizations_organizationmember
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
user_id             BIGINT REFERENCES accounts_user(id)
role_id             BIGINT REFERENCES organizations_role(id)
is_active           BOOLEAN DEFAULT TRUE
invited_by_id       BIGINT REFERENCES accounts_user(id)
invited_at          TIMESTAMP
accepted_at         TIMESTAMP
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

UNIQUE(organization_id, user_id)
```

### organizations_role
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
name                VARCHAR(100) NOT NULL
slug                VARCHAR(100) NOT NULL
is_system_role      BOOLEAN DEFAULT FALSE  -- owner, admin, etc.
permissions         JSONB DEFAULT '{}'
description         TEXT
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

UNIQUE(organization_id, slug)
```

### subscriptions_plan
```sql
id                  BIGSERIAL PRIMARY KEY
name                VARCHAR(100) NOT NULL
slug                VARCHAR(100) UNIQUE NOT NULL
price_monthly       DECIMAL(10,2)
price_yearly        DECIMAL(10,2)
max_users           INTEGER
max_transactions    INTEGER
features            JSONB DEFAULT '{}'
is_active           BOOLEAN DEFAULT TRUE
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### subscriptions_subscription
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT UNIQUE REFERENCES organizations_organization(id)
plan_id             BIGINT REFERENCES subscriptions_plan(id)
status              VARCHAR(20) DEFAULT 'trial'
    -- trial, active, past_due, cancelled, expired
trial_ends_at       TIMESTAMP
current_period_start TIMESTAMP
current_period_end  TIMESTAMP
stripe_customer_id  VARCHAR(255)
stripe_subscription_id VARCHAR(255)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

---

## Layer B: Accounting Core (Ledger)

### ledger_account
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
parent_id           BIGINT REFERENCES ledger_account(id) NULL
code                VARCHAR(20) NOT NULL
name                VARCHAR(255) NOT NULL
account_type        VARCHAR(20) NOT NULL
    -- asset, liability, equity, revenue, expense
account_subtype     VARCHAR(50)
    -- current_asset, fixed_asset, current_liability, long_term_liability,
    -- retained_earnings, operating_revenue, cogs, operating_expense, etc.
is_active           BOOLEAN DEFAULT TRUE
is_system           BOOLEAN DEFAULT FALSE  -- system-created accounts
description         TEXT
normal_balance      VARCHAR(6) DEFAULT 'debit'  -- debit or credit
currency            VARCHAR(3) DEFAULT 'USD'
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

UNIQUE(organization_id, code)
INDEX(organization_id, account_type)
```

### ledger_accountgroup
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
name                VARCHAR(255) NOT NULL
code                VARCHAR(20)
parent_id           BIGINT REFERENCES ledger_accountgroup(id) NULL
sort_order          INTEGER DEFAULT 0
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### ledger_fiscalperiod
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
name                VARCHAR(100) NOT NULL  -- "January 2026", "Q1 2026", "FY2026"
period_type         VARCHAR(20) DEFAULT 'month'  -- month, quarter, year
start_date          DATE NOT NULL
end_date            DATE NOT NULL
is_closed           BOOLEAN DEFAULT FALSE
closed_by_id        BIGINT REFERENCES accounts_user(id) NULL
closed_at           TIMESTAMP
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

UNIQUE(organization_id, start_date, end_date)
INDEX(organization_id, is_closed)
```

### ledger_journalentry
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
entry_number        VARCHAR(50) NOT NULL  -- auto-generated: JE-000001
date                DATE NOT NULL
reference           VARCHAR(255)  -- external reference number
memo                TEXT
status              VARCHAR(20) DEFAULT 'draft'
    -- draft, pending_review, posted, reversed
source_type         VARCHAR(50)  -- bill, invoice, bank_transaction, manual, adjustment, reversal
source_id           BIGINT       -- polymorphic reference to source object
reversal_of_id      BIGINT REFERENCES ledger_journalentry(id) NULL
fiscal_period_id    BIGINT REFERENCES ledger_fiscalperiod(id) NULL
total_amount        DECIMAL(19,4) DEFAULT 0  -- total debits (= total credits)
currency            VARCHAR(3) DEFAULT 'USD'
created_by_id       BIGINT REFERENCES accounts_user(id)
reviewed_by_id      BIGINT REFERENCES accounts_user(id) NULL
posted_by_id        BIGINT REFERENCES accounts_user(id) NULL
posted_at           TIMESTAMP
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

UNIQUE(organization_id, entry_number)
INDEX(organization_id, date)
INDEX(organization_id, status)
INDEX(source_type, source_id)
```

### ledger_journalline
```sql
id                  BIGSERIAL PRIMARY KEY
journal_entry_id    BIGINT REFERENCES ledger_journalentry(id)
account_id          BIGINT REFERENCES ledger_account(id)
description         VARCHAR(500)
debit               DECIMAL(19,4) DEFAULT 0
credit              DECIMAL(19,4) DEFAULT 0
currency            VARCHAR(3) DEFAULT 'USD'
exchange_rate       DECIMAL(12,6) DEFAULT 1
vendor_id           BIGINT REFERENCES vendors_vendor(id) NULL
customer_id         BIGINT REFERENCES customers_customer(id) NULL
department          VARCHAR(100)  -- dimension for future use
project             VARCHAR(100)  -- dimension for future use
line_order          INTEGER DEFAULT 0
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

INDEX(journal_entry_id)
INDEX(account_id)
CHECK(debit >= 0 AND credit >= 0)
CHECK(NOT (debit > 0 AND credit > 0))  -- a line is either debit or credit
```

### ledger_accountingpolicy
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT UNIQUE REFERENCES organizations_organization(id)
default_currency    VARCHAR(3) DEFAULT 'USD'
auto_numbering      BOOLEAN DEFAULT TRUE
require_approval    BOOLEAN DEFAULT FALSE
allow_future_dates  BOOLEAN DEFAULT TRUE
max_future_days     INTEGER DEFAULT 30
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

---

## Layer C: Banking

### banking_bankaccount
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
ledger_account_id   BIGINT REFERENCES ledger_account(id) NULL  -- linked COA account
name                VARCHAR(255) NOT NULL
bank_name           VARCHAR(255)
account_number_last4 VARCHAR(4)
account_type        VARCHAR(20)  -- checking, savings, credit_card, loan
currency            VARCHAR(3) DEFAULT 'USD'
current_balance     DECIMAL(19,4) DEFAULT 0
is_active           BOOLEAN DEFAULT TRUE
plaid_account_id    VARCHAR(255)  -- for future Plaid integration
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### banking_statement
```sql
id                  BIGSERIAL PRIMARY KEY
bank_account_id     BIGINT REFERENCES banking_bankaccount(id)
file_name           VARCHAR(255)
file_url            VARCHAR(500)
statement_date      DATE
start_date          DATE
end_date            DATE
opening_balance     DECIMAL(19,4)
closing_balance     DECIMAL(19,4)
transaction_count   INTEGER DEFAULT 0
import_status       VARCHAR(20) DEFAULT 'pending'
    -- pending, processing, completed, failed
imported_by_id      BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### banking_banktransaction
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
bank_account_id     BIGINT REFERENCES banking_bankaccount(id)
statement_id        BIGINT REFERENCES banking_statement(id) NULL
external_id         VARCHAR(255)  -- bank's transaction ID
date                DATE NOT NULL
description         TEXT NOT NULL
original_description TEXT  -- raw bank description
amount              DECIMAL(19,4) NOT NULL  -- positive=credit, negative=debit
running_balance     DECIMAL(19,4)
transaction_type    VARCHAR(20)
    -- debit, credit, transfer, fee, interest, atm, check, payment
category            VARCHAR(100)  -- AI-suggested or user-assigned
vendor_id           BIGINT REFERENCES vendors_vendor(id) NULL
customer_id         BIGINT REFERENCES customers_customer(id) NULL
ledger_account_id   BIGINT REFERENCES ledger_account(id) NULL  -- categorized to
journal_entry_id    BIGINT REFERENCES ledger_journalentry(id) NULL
status              VARCHAR(20) DEFAULT 'new'
    -- new, categorized, reconciled, excluded
is_duplicate        BOOLEAN DEFAULT FALSE
duplicate_of_id     BIGINT REFERENCES banking_banktransaction(id) NULL
notes               TEXT
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

INDEX(organization_id, date)
INDEX(bank_account_id, date)
INDEX(organization_id, status)
INDEX(external_id)
```

### banking_feedimport
```sql
id                  BIGSERIAL PRIMARY KEY
bank_account_id     BIGINT REFERENCES banking_bankaccount(id)
source              VARCHAR(20)  -- csv, plaid, manual
file_name           VARCHAR(255)
file_url            VARCHAR(500)
total_rows          INTEGER DEFAULT 0
imported_rows       INTEGER DEFAULT 0
duplicate_rows      INTEGER DEFAULT 0
error_rows          INTEGER DEFAULT 0
status              VARCHAR(20) DEFAULT 'pending'
    -- pending, processing, completed, failed
error_log           JSONB
started_at          TIMESTAMP
completed_at        TIMESTAMP
imported_by_id      BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

---

## Layer C: Reconciliation

### reconciliation_session
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
bank_account_id     BIGINT REFERENCES banking_bankaccount(id)
period_start        DATE NOT NULL
period_end          DATE NOT NULL
statement_balance   DECIMAL(19,4)
ledger_balance      DECIMAL(19,4)
difference          DECIMAL(19,4)
status              VARCHAR(20) DEFAULT 'in_progress'
    -- in_progress, completed, abandoned
matched_count       INTEGER DEFAULT 0
unmatched_count     INTEGER DEFAULT 0
completed_by_id     BIGINT REFERENCES accounts_user(id) NULL
completed_at        TIMESTAMP
created_by_id       BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### reconciliation_match
```sql
id                  BIGSERIAL PRIMARY KEY
session_id          BIGINT REFERENCES reconciliation_session(id)
match_type          VARCHAR(20) NOT NULL
    -- auto, manual, rule_based
bank_transaction_id BIGINT REFERENCES banking_banktransaction(id)
journal_entry_id    BIGINT REFERENCES ledger_journalentry(id) NULL
journal_line_id     BIGINT REFERENCES ledger_journalline(id) NULL
confidence_score    DECIMAL(5,2)  -- for auto-matches
matched_by_id       BIGINT REFERENCES accounts_user(id) NULL
matched_at          TIMESTAMP DEFAULT NOW()
created_at          TIMESTAMP DEFAULT NOW()
```

### reconciliation_exception
```sql
id                  BIGSERIAL PRIMARY KEY
session_id          BIGINT REFERENCES reconciliation_session(id)
bank_transaction_id BIGINT REFERENCES banking_banktransaction(id) NULL
journal_line_id     BIGINT REFERENCES ledger_journalline(id) NULL
exception_type      VARCHAR(30)
    -- unmatched_bank, unmatched_ledger, amount_mismatch,
    -- date_mismatch, duplicate, timing_difference
notes               TEXT
status              VARCHAR(20) DEFAULT 'open'
    -- open, resolved, ignored
resolved_by_id      BIGINT REFERENCES accounts_user(id) NULL
resolved_at         TIMESTAMP
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

---

## Layer C: Vendors & Customers

### vendors_vendor
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
name                VARCHAR(255) NOT NULL
display_name        VARCHAR(255)
email               VARCHAR(255)
phone               VARCHAR(20)
tax_id              VARCHAR(100)
address_line1       VARCHAR(255)
address_line2       VARCHAR(255)
city                VARCHAR(100)
state               VARCHAR(100)
country             VARCHAR(2)
postal_code         VARCHAR(20)
website             VARCHAR(255)
default_expense_account_id BIGINT REFERENCES ledger_account(id) NULL
payment_terms       INTEGER DEFAULT 30  -- days
notes               TEXT
is_active           BOOLEAN DEFAULT TRUE
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

UNIQUE(organization_id, name)
```

### vendors_vendorcontact
```sql
id                  BIGSERIAL PRIMARY KEY
vendor_id           BIGINT REFERENCES vendors_vendor(id)
name                VARCHAR(255) NOT NULL
email               VARCHAR(255)
phone               VARCHAR(20)
role                VARCHAR(100)
is_primary          BOOLEAN DEFAULT FALSE
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### vendors_vendorbankdetail
```sql
id                  BIGSERIAL PRIMARY KEY
vendor_id           BIGINT REFERENCES vendors_vendor(id)
bank_name           VARCHAR(255)
account_name        VARCHAR(255)
account_number_last4 VARCHAR(4)
routing_number_last4 VARCHAR(4)
payment_method      VARCHAR(20)  -- ach, wire, check
is_primary          BOOLEAN DEFAULT FALSE
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### customers_customer
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
name                VARCHAR(255) NOT NULL
display_name        VARCHAR(255)
email               VARCHAR(255)
phone               VARCHAR(20)
tax_id              VARCHAR(100)
billing_address_line1 VARCHAR(255)
billing_address_line2 VARCHAR(255)
billing_city        VARCHAR(100)
billing_state       VARCHAR(100)
billing_country     VARCHAR(2)
billing_postal_code VARCHAR(20)
shipping_address_line1 VARCHAR(255)
shipping_address_line2 VARCHAR(255)
shipping_city       VARCHAR(100)
shipping_state      VARCHAR(100)
shipping_country    VARCHAR(2)
shipping_postal_code VARCHAR(20)
default_revenue_account_id BIGINT REFERENCES ledger_account(id) NULL
payment_terms       INTEGER DEFAULT 30
notes               TEXT
is_active           BOOLEAN DEFAULT TRUE
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

UNIQUE(organization_id, name)
```

### customers_customercontact
```sql
id                  BIGSERIAL PRIMARY KEY
customer_id         BIGINT REFERENCES customers_customer(id)
name                VARCHAR(255) NOT NULL
email               VARCHAR(255)
phone               VARCHAR(20)
role                VARCHAR(100)
is_primary          BOOLEAN DEFAULT FALSE
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

---

## Layer C: Accounts Payable (Bills)

### ap_bill
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
vendor_id           BIGINT REFERENCES vendors_vendor(id)
bill_number         VARCHAR(100)  -- vendor's invoice number
internal_number     VARCHAR(50) NOT NULL  -- auto: BILL-000001
date                DATE NOT NULL
due_date            DATE NOT NULL
currency            VARCHAR(3) DEFAULT 'USD'
subtotal            DECIMAL(19,4) DEFAULT 0
tax_amount          DECIMAL(19,4) DEFAULT 0
total_amount        DECIMAL(19,4) DEFAULT 0
amount_paid         DECIMAL(19,4) DEFAULT 0
balance_due         DECIMAL(19,4) DEFAULT 0
status              VARCHAR(20) DEFAULT 'draft'
    -- draft, extracted, needs_review, approved, scheduled, paid, cancelled
payment_terms       INTEGER  -- days
memo                TEXT
journal_entry_id    BIGINT REFERENCES ledger_journalentry(id) NULL
payment_journal_id  BIGINT REFERENCES ledger_journalentry(id) NULL
approved_by_id      BIGINT REFERENCES accounts_user(id) NULL
approved_at         TIMESTAMP
created_by_id       BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

UNIQUE(organization_id, internal_number)
INDEX(organization_id, status)
INDEX(organization_id, due_date)
INDEX(vendor_id)
```

### ap_billline
```sql
id                  BIGSERIAL PRIMARY KEY
bill_id             BIGINT REFERENCES ap_bill(id)
account_id          BIGINT REFERENCES ledger_account(id)
description         VARCHAR(500)
quantity            DECIMAL(12,4) DEFAULT 1
unit_price          DECIMAL(19,4)
amount              DECIMAL(19,4) NOT NULL
tax_rate            DECIMAL(5,2) DEFAULT 0
tax_amount          DECIMAL(19,4) DEFAULT 0
line_order          INTEGER DEFAULT 0
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### ap_billattachment
```sql
id                  BIGSERIAL PRIMARY KEY
bill_id             BIGINT REFERENCES ap_bill(id)
document_id         BIGINT REFERENCES documents_document(id)
created_at          TIMESTAMP DEFAULT NOW()
```

### ap_billapproval
```sql
id                  BIGSERIAL PRIMARY KEY
bill_id             BIGINT REFERENCES ap_bill(id)
approver_id         BIGINT REFERENCES accounts_user(id)
status              VARCHAR(20)  -- pending, approved, rejected
notes               TEXT
decided_at          TIMESTAMP
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

---

## Layer C: Accounts Receivable (Invoices)

### ar_invoice
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
customer_id         BIGINT REFERENCES customers_customer(id)
invoice_number      VARCHAR(50) NOT NULL  -- auto: INV-000001
date                DATE NOT NULL
due_date            DATE NOT NULL
currency            VARCHAR(3) DEFAULT 'USD'
subtotal            DECIMAL(19,4) DEFAULT 0
tax_amount          DECIMAL(19,4) DEFAULT 0
total_amount        DECIMAL(19,4) DEFAULT 0
amount_paid         DECIMAL(19,4) DEFAULT 0
balance_due         DECIMAL(19,4) DEFAULT 0
status              VARCHAR(20) DEFAULT 'draft'
    -- draft, sent, viewed, overdue, partially_paid, paid, cancelled
payment_terms       INTEGER
memo                TEXT
notes_to_customer   TEXT
journal_entry_id    BIGINT REFERENCES ledger_journalentry(id) NULL
recurring_id        BIGINT REFERENCES ar_recurringinvoice(id) NULL
sent_at             TIMESTAMP
viewed_at           TIMESTAMP
last_reminder_at    TIMESTAMP
created_by_id       BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

UNIQUE(organization_id, invoice_number)
INDEX(organization_id, status)
INDEX(organization_id, due_date)
INDEX(customer_id)
```

### ar_invoiceline
```sql
id                  BIGSERIAL PRIMARY KEY
invoice_id          BIGINT REFERENCES ar_invoice(id)
account_id          BIGINT REFERENCES ledger_account(id)
description         VARCHAR(500) NOT NULL
quantity            DECIMAL(12,4) DEFAULT 1
unit_price          DECIMAL(19,4) NOT NULL
amount              DECIMAL(19,4) NOT NULL
tax_rate            DECIMAL(5,2) DEFAULT 0
tax_amount          DECIMAL(19,4) DEFAULT 0
line_order          INTEGER DEFAULT 0
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### ar_invoicepayment
```sql
id                  BIGSERIAL PRIMARY KEY
invoice_id          BIGINT REFERENCES ar_invoice(id)
amount              DECIMAL(19,4) NOT NULL
payment_date        DATE NOT NULL
payment_method      VARCHAR(20)  -- bank_transfer, check, card, cash, stripe
reference           VARCHAR(255)
journal_entry_id    BIGINT REFERENCES ledger_journalentry(id) NULL
bank_transaction_id BIGINT REFERENCES banking_banktransaction(id) NULL
notes               TEXT
created_by_id       BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### ar_creditnote
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
customer_id         BIGINT REFERENCES customers_customer(id)
invoice_id          BIGINT REFERENCES ar_invoice(id) NULL
credit_note_number  VARCHAR(50) NOT NULL
date                DATE NOT NULL
amount              DECIMAL(19,4) NOT NULL
reason              TEXT
status              VARCHAR(20) DEFAULT 'draft'  -- draft, issued, applied
journal_entry_id    BIGINT REFERENCES ledger_journalentry(id) NULL
created_by_id       BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### ar_recurringinvoice
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
customer_id         BIGINT REFERENCES customers_customer(id)
frequency           VARCHAR(20)  -- weekly, monthly, quarterly, yearly
next_date           DATE
end_date            DATE
template_data       JSONB  -- line items, amounts, etc.
is_active           BOOLEAN DEFAULT TRUE
last_generated_at   TIMESTAMP
created_by_id       BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

---

## Layer C: Documents

### documents_document
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
file_name           VARCHAR(255) NOT NULL
file_url            VARCHAR(500) NOT NULL
file_size           BIGINT
file_type           VARCHAR(50)  -- pdf, jpg, png, csv, xlsx
mime_type           VARCHAR(100)
description         TEXT
uploaded_by_id      BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### documents_documenttag
```sql
id                  BIGSERIAL PRIMARY KEY
document_id         BIGINT REFERENCES documents_document(id)
tag                 VARCHAR(100) NOT NULL
created_at          TIMESTAMP DEFAULT NOW()

INDEX(tag)
```

### documents_documentlink
```sql
id                  BIGSERIAL PRIMARY KEY
document_id         BIGINT REFERENCES documents_document(id)
linked_type         VARCHAR(50) NOT NULL
    -- bill, invoice, vendor, customer, journal_entry, bank_transaction
linked_id           BIGINT NOT NULL
created_at          TIMESTAMP DEFAULT NOW()

INDEX(linked_type, linked_id)
```

### documents_ocrresult
```sql
id                  BIGSERIAL PRIMARY KEY
document_id         BIGINT REFERENCES documents_document(id)
raw_text            TEXT
extracted_data      JSONB  -- structured extraction result
    -- { vendor_name, date, amount, line_items, tax, etc. }
confidence_score    DECIMAL(5,2)
provider            VARCHAR(50)  -- tesseract, textract, claude
processing_time_ms  INTEGER
status              VARCHAR(20) DEFAULT 'pending'
    -- pending, processing, completed, failed
error_message       TEXT
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

---

## Layer D: Reports & Dashboards

### reports_reportdefinition
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
name                VARCHAR(255) NOT NULL
report_type         VARCHAR(50) NOT NULL
    -- profit_loss, balance_sheet, cash_flow, trial_balance,
    -- general_ledger, account_ledger, vendor_spend, customer_revenue, ar_aging, ap_aging
config              JSONB  -- filters, grouping, columns, date range
is_default          BOOLEAN DEFAULT FALSE
created_by_id       BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### reports_reportsnapshot
```sql
id                  BIGSERIAL PRIMARY KEY
report_definition_id BIGINT REFERENCES reports_reportdefinition(id)
generated_at        TIMESTAMP DEFAULT NOW()
parameters          JSONB  -- date range, filters used
data                JSONB  -- the actual report data
file_url            VARCHAR(500)  -- exported PDF/CSV
generated_by_id     BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
```

### dashboards_dashboard
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
name                VARCHAR(255) DEFAULT 'Main Dashboard'
is_default          BOOLEAN DEFAULT TRUE
layout              JSONB  -- widget positions and sizes
created_by_id       BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### dashboards_dashboardwidget
```sql
id                  BIGSERIAL PRIMARY KEY
dashboard_id        BIGINT REFERENCES dashboards_dashboard(id)
widget_type         VARCHAR(50) NOT NULL
    -- cash_position, expense_trend, revenue_trend, profit_summary,
    -- ar_summary, ap_summary, recent_activity, task_alerts, kpi_card
title               VARCHAR(255)
config              JSONB  -- date range, accounts, display options
position_x          INTEGER DEFAULT 0
position_y          INTEGER DEFAULT 0
width               INTEGER DEFAULT 1
height              INTEGER DEFAULT 1
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

---

## Layer E: AI

### ai_aijob
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
job_type            VARCHAR(50) NOT NULL
    -- categorize_transaction, extract_document, ask_finance,
    -- detect_anomaly, generate_summary, suggest_match
status              VARCHAR(20) DEFAULT 'pending'
    -- pending, processing, completed, failed
input_data          JSONB
source_type         VARCHAR(50)  -- bank_transaction, document, user_query
source_id           BIGINT
started_at          TIMESTAMP
completed_at        TIMESTAMP
processing_time_ms  INTEGER
error_message       TEXT
created_by_id       BIGINT REFERENCES accounts_user(id) NULL
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### ai_aiinference
```sql
id                  BIGSERIAL PRIMARY KEY
job_id              BIGINT REFERENCES ai_aijob(id)
result_data         JSONB
    -- { suggested_account, suggested_vendor, confidence, explanation }
confidence_score    DECIMAL(5,2)
model_used          VARCHAR(100)
prompt_tokens       INTEGER
completion_tokens   INTEGER
was_accepted        BOOLEAN  -- user accepted or rejected
accepted_by_id      BIGINT REFERENCES accounts_user(id) NULL
accepted_at         TIMESTAMP
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### ai_aifeedback
```sql
id                  BIGSERIAL PRIMARY KEY
inference_id        BIGINT REFERENCES ai_aiinference(id)
user_id             BIGINT REFERENCES accounts_user(id)
feedback_type       VARCHAR(20)  -- accepted, rejected, corrected
correction_data     JSONB  -- what the user changed it to
notes               TEXT
created_at          TIMESTAMP DEFAULT NOW()
```

### ai_promptlog
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
job_id              BIGINT REFERENCES ai_aijob(id) NULL
prompt_type         VARCHAR(50)
prompt_text         TEXT
response_text       TEXT
model_used          VARCHAR(100)
prompt_tokens       INTEGER
completion_tokens   INTEGER
latency_ms          INTEGER
created_at          TIMESTAMP DEFAULT NOW()
```

---

## Layer: Audit

### audit_auditevent
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
actor_id            BIGINT REFERENCES accounts_user(id) NULL
actor_type          VARCHAR(20) DEFAULT 'user'  -- user, system, ai
action              VARCHAR(50) NOT NULL
    -- create, update, delete, post, approve, reject, login, logout,
    -- close_period, reconcile, import, export
object_type         VARCHAR(50) NOT NULL
    -- journal_entry, account, bill, invoice, bank_transaction, vendor,
    -- customer, document, user, organization, role
object_id           BIGINT NOT NULL
object_repr         VARCHAR(255)  -- human-readable: "JE-000042"
changes             JSONB  -- { field: { old: x, new: y } }
ip_address          INET
user_agent          TEXT
metadata            JSONB  -- extra context
created_at          TIMESTAMP DEFAULT NOW()

INDEX(organization_id, created_at)
INDEX(organization_id, object_type, object_id)
INDEX(actor_id)
```

---

## Layer: Tasks

### tasks_task
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
title               VARCHAR(500) NOT NULL
description         TEXT
task_type           VARCHAR(20) DEFAULT 'general'
    -- general, close_checklist, review, follow_up
status              VARCHAR(20) DEFAULT 'pending'
    -- pending, in_progress, completed, cancelled
priority            VARCHAR(10) DEFAULT 'medium'  -- low, medium, high, urgent
due_date            DATE
assigned_to_id      BIGINT REFERENCES accounts_user(id) NULL
checklist_id        BIGINT REFERENCES tasks_checklist(id) NULL
linked_type         VARCHAR(50)  -- bill, invoice, reconciliation, period
linked_id           BIGINT
completed_at        TIMESTAMP
created_by_id       BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### tasks_checklist
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
name                VARCHAR(255) NOT NULL
checklist_type      VARCHAR(20) DEFAULT 'month_end'
    -- month_end, quarter_end, year_end, custom
fiscal_period_id    BIGINT REFERENCES ledger_fiscalperiod(id) NULL
status              VARCHAR(20) DEFAULT 'not_started'
    -- not_started, in_progress, completed
created_by_id       BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### tasks_taskcomment
```sql
id                  BIGSERIAL PRIMARY KEY
task_id             BIGINT REFERENCES tasks_task(id)
user_id             BIGINT REFERENCES accounts_user(id)
comment             TEXT NOT NULL
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

---

## Layer: Notifications

### notifications_notification
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
recipient_id        BIGINT REFERENCES accounts_user(id)
notification_type   VARCHAR(50) NOT NULL
    -- bill_due, invoice_overdue, reconciliation_exception,
    -- task_assigned, close_reminder, ai_alert, system
title               VARCHAR(255) NOT NULL
message             TEXT
linked_type         VARCHAR(50)
linked_id           BIGINT
is_read             BOOLEAN DEFAULT FALSE
read_at             TIMESTAMP
channel             VARCHAR(20) DEFAULT 'in_app'  -- in_app, email, both
email_sent          BOOLEAN DEFAULT FALSE
email_sent_at       TIMESTAMP
created_at          TIMESTAMP DEFAULT NOW()

INDEX(recipient_id, is_read)
INDEX(organization_id, created_at)
```

### notifications_notificationpreference
```sql
id                  BIGSERIAL PRIMARY KEY
user_id             BIGINT REFERENCES accounts_user(id)
organization_id     BIGINT REFERENCES organizations_organization(id)
notification_type   VARCHAR(50) NOT NULL
in_app_enabled      BOOLEAN DEFAULT TRUE
email_enabled       BOOLEAN DEFAULT TRUE
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()

UNIQUE(user_id, organization_id, notification_type)
```

---

## Layer: Integrations

### integrations_integration
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
provider            VARCHAR(50) NOT NULL
    -- plaid, stripe, csv_import, email_inbox, payroll
name                VARCHAR(255)
config              JSONB  -- encrypted connection details
status              VARCHAR(20) DEFAULT 'active'  -- active, paused, error, disconnected
last_sync_at        TIMESTAMP
error_message       TEXT
created_by_id       BIGINT REFERENCES accounts_user(id)
created_at          TIMESTAMP DEFAULT NOW()
updated_at          TIMESTAMP DEFAULT NOW()
```

### integrations_syncjob
```sql
id                  BIGSERIAL PRIMARY KEY
integration_id      BIGINT REFERENCES integrations_integration(id)
job_type            VARCHAR(50)  -- pull_transactions, sync_payments, import_data
status              VARCHAR(20) DEFAULT 'pending'
    -- pending, running, completed, failed
records_processed   INTEGER DEFAULT 0
records_created     INTEGER DEFAULT 0
records_updated     INTEGER DEFAULT 0
records_failed      INTEGER DEFAULT 0
error_log           JSONB
started_at          TIMESTAMP
completed_at        TIMESTAMP
created_at          TIMESTAMP DEFAULT NOW()
```

### integrations_webhookevent
```sql
id                  BIGSERIAL PRIMARY KEY
organization_id     BIGINT REFERENCES organizations_organization(id)
provider            VARCHAR(50) NOT NULL
event_type          VARCHAR(100) NOT NULL
payload             JSONB NOT NULL
status              VARCHAR(20) DEFAULT 'received'
    -- received, processing, processed, failed
processed_at        TIMESTAMP
error_message       TEXT
created_at          TIMESTAMP DEFAULT NOW()

INDEX(organization_id, provider, event_type)
```
