# Digits Clone - Module List
# Version: 1.0
# Last Updated: 2026-04-13

---

## Phase 1: Foundation (Weeks 1-6)

### Module 1: accounts
- **Purpose**: Authentication, sessions, user profiles
- **Priority**: Critical
- **Dependencies**: None
- **Features**:
  - Signup / Login / Logout
  - Email verification
  - Password reset
  - Invite users to organization
  - Profile management
  - Login history tracking
  - MFA (deferred to Phase 2)

### Module 2: organizations
- **Purpose**: Multi-tenant workspace isolation
- **Priority**: Critical
- **Dependencies**: accounts
- **Features**:
  - Organization creation
  - Company profile (name, legal info, address)
  - Timezone and currency settings
  - Fiscal year configuration
  - Organization member management
  - Role assignment

### Module 3: permissions
- **Purpose**: Role-based access control for finance operations
- **Priority**: Critical
- **Dependencies**: accounts, organizations
- **Roles**:
  - Owner
  - Admin
  - Accountant
  - Finance Manager
  - AP Clerk
  - AR Clerk
  - Viewer
- **Permission Areas**:
  - view_ledger
  - create_journal
  - approve_journal
  - create_bill
  - approve_bill
  - pay_bill
  - create_invoice
  - edit_reports
  - close_period
  - manage_users
  - manage_settings
  - view_audit_log

### Module 4: ledger
- **Purpose**: Double-entry accounting engine (THE CORE)
- **Priority**: Critical
- **Dependencies**: organizations, permissions
- **Features**:
  - Chart of accounts (COA) with hierarchy
  - Account types: Asset, Liability, Equity, Revenue, Expense, Contra
  - Account groups and subgroups
  - Journal entries with balanced debit/credit lines
  - Posting engine (draft -> posted)
  - Period locks (prevent edits to closed months)
  - Reversals and adjustments
  - Source object linkage (every entry traces to its origin)
  - Trial balance computation
  - Accounting policy settings

### Module 5: audit
- **Purpose**: Full traceability for all financial actions
- **Priority**: Critical
- **Dependencies**: accounts, organizations
- **Features**:
  - Who changed what and when
  - Old value / new value tracking
  - AI suggestion logs
  - Approval action logs
  - Posting event logs
  - Authentication event logs
  - Export audit trail

### Module 6: api (base structure)
- **Purpose**: REST API foundation
- **Priority**: Critical
- **Dependencies**: All Phase 1 modules
- **Features**:
  - DRF router setup
  - Authentication (JWT / Session)
  - Pagination
  - Filtering
  - Error handling standards
  - API versioning (v1/)

---

## Phase 2: Operational Accounting MVP (Weeks 7-14)

### Module 7: banking
- **Purpose**: Bank account and transaction management
- **Priority**: High
- **Dependencies**: ledger, organizations
- **Features**:
  - Bank account registration
  - CSV statement upload and parsing
  - Statement file upload
  - Transaction feed normalization
  - Duplicate detection
  - Transaction status tracking (new, categorized, reconciled)
  - Raw + normalized data storage

### Module 8: reconciliation
- **Purpose**: Match bank transactions to ledger entries
- **Priority**: High
- **Dependencies**: banking, ledger
- **Features**:
  - Auto-match suggestions (amount, date, reference)
  - Manual matching interface
  - Match types: 1-to-1, many-to-1, 1-to-many
  - Exception queue for unmatched items
  - Duplicate flagging
  - Statement balance verification
  - Reconciliation session tracking
  - Reconciliation reports

### Module 9: vendors
- **Purpose**: Supplier management
- **Priority**: High
- **Dependencies**: organizations
- **Features**:
  - Vendor profile (name, tax ID, address)
  - Contact persons
  - Bank/remittance details
  - Default expense category mapping
  - Transaction history view
  - Document attachments

### Module 10: customers
- **Purpose**: Invoice recipients and AR relationships
- **Priority**: High
- **Dependencies**: organizations
- **Features**:
  - Customer profile
  - Billing address and payment terms
  - Contact persons
  - Invoice history view
  - Receivable summary

### Module 11: documents
- **Purpose**: Secure file storage vault
- **Priority**: High
- **Dependencies**: organizations
- **Features**:
  - File upload (receipts, bills, contracts, statements)
  - Tagging system
  - Document preview
  - Link to vendor/customer/bill/invoice/journal/transaction
  - Version tracking
  - S3 storage backend

### Module 12: reports
- **Purpose**: Financial statement generation
- **Priority**: High
- **Dependencies**: ledger
- **Features**:
  - Profit & Loss (Income Statement)
  - Balance Sheet
  - Cash Flow Statement
  - Trial Balance
  - General Ledger Report
  - Account Ledger (per-account detail)
  - Vendor Spend Report
  - Customer Revenue Report
  - Comparative period reports
  - Date range and entity filters
  - CSV and PDF export
  - Drill-down to source documents

### Module 13: dashboards
- **Purpose**: Home view with KPIs and summaries
- **Priority**: High
- **Dependencies**: reports, banking
- **Features**:
  - Cash position widget
  - Expense trend chart
  - Revenue trend chart
  - Profit summary
  - Receivables / Payables summary
  - Recent activity feed
  - Task/alert widgets

### Module 14: notifications
- **Purpose**: Operational event alerts
- **Priority**: Medium
- **Dependencies**: organizations
- **Features**:
  - Bill due reminders
  - Invoice overdue alerts
  - Reconciliation exception alerts
  - Close checklist alerts
  - AI-generated alerts
  - In-app + email delivery
  - User notification preferences

---

## Phase 3: AP / AR / AI (Weeks 15-24)

### Module 15: ap (Accounts Payable / Bills)
- **Purpose**: Bill receipt, approval, and payment workflow
- **Priority**: High
- **Dependencies**: vendors, ledger, documents
- **Status Flow**: Draft -> Extracted -> Needs Review -> Approved -> Scheduled -> Paid -> Cancelled
- **Features**:
  - Bill upload
  - OCR data extraction
  - Line item capture
  - Due date tracking
  - Multi-step approval workflow
  - Payment scheduling
  - AP aging report
- **Ledger Impact**:
  - On approval: DR Expense/Asset, CR Accounts Payable
  - On payment: DR Accounts Payable, CR Bank/Cash

### Module 16: ar (Accounts Receivable / Invoices)
- **Purpose**: Invoice creation and collection tracking
- **Priority**: High
- **Dependencies**: customers, ledger
- **Status Flow**: Draft -> Sent -> Viewed -> Overdue -> Partially Paid -> Paid -> Cancelled
- **Features**:
  - Invoice creation with templates
  - Line items with tax support
  - Due date and payment terms
  - Email reminders
  - Payment recording
  - Credit notes
  - Recurring invoices
  - AR aging report
- **Ledger Impact**:
  - On issue: DR Accounts Receivable, CR Revenue
  - On payment: DR Bank/Cash, CR Accounts Receivable

### Module 17: ai
- **Purpose**: Intelligence layer across all finance data
- **Priority**: High
- **Dependencies**: ledger, banking, documents
- **Sub-features**:
  - **A) Transaction Categorization**: Suggest COA account, vendor, tax handling with confidence scores
  - **B) Ask Finance Assistant**: Natural language queries over ledger data (RAG-based)
  - **C) Document OCR/Extraction**: Extract structured data from uploaded bills/invoices
  - **D) Anomaly Detection**: Flag unusual spend, duplicate bills, missing recurring payments
  - **E) Narrative Summaries**: Auto-generate expense increase warnings, cash flow alerts
- **Rule**: AI suggests only. Never silently posts critical accounting actions.

### Module 18: tasks
- **Purpose**: Finance operations and month-end close management
- **Priority**: Medium
- **Dependencies**: organizations
- **Features**:
  - To-do items
  - Close checklist templates
  - Assigned owners and due dates
  - Recurring tasks
  - Completion tracking
  - Comments/notes

---

## Phase 4: Integrations & Product Maturity (Weeks 25-32+)

### Module 19: subscriptions
- **Purpose**: SaaS plan management and billing
- **Priority**: Medium
- **Dependencies**: organizations
- **Features**:
  - Plan definitions
  - Trial management
  - Feature gating
  - Usage limits
  - Stripe billing integration

### Module 20: integrations
- **Purpose**: External system connections
- **Priority**: Medium
- **Dependencies**: banking, ledger
- **Build Order**:
  1. CSV import/export (Phase 2)
  2. Email bill intake
  3. Stripe payment sync
  4. Live bank feeds (Plaid)
  5. Payroll system
  6. Webhook engine
- **Features**:
  - Integration account management
  - Sync job tracking
  - Webhook event processing
  - Import mapping configuration
  - Export task scheduling

### Module 21: public_api
- **Purpose**: Third-party developer access
- **Priority**: Low
- **Dependencies**: All core modules
- **Features**:
  - API key management
  - OAuth support (later)
  - Rate limiting
  - Idempotency keys
  - Webhooks for external consumers
  - Object-level permissions
- **Exposed Objects**:
  - Accounts
  - Transactions
  - Vendors / Customers
  - Bills / Invoices
  - Journal entries
  - Reports

---

## Phase 5: Enterprise (Future)

### Planned Modules
- **multi_entity**: Multi-entity and consolidated reporting
- **multi_currency**: Foreign currency transactions and revaluation
- **intercompany**: Intercompany transactions and eliminations
- **accountant_workspace**: Dedicated CPA/firm tools
- **mobile**: Mobile app (React Native)

---

## Module Dependency Graph

```
accounts
  -> organizations
       -> permissions
       -> ledger (CORE)
            -> banking -> reconciliation
            -> vendors -> ap (bills)
            -> customers -> ar (invoices)
            -> reports -> dashboards
       -> documents
       -> audit
       -> notifications
       -> ai (depends on ledger, banking, documents)
       -> tasks
       -> subscriptions
       -> integrations
       -> public_api
```

---

## Summary Table

| #  | Module          | Phase | Priority | Status  |
|----|-----------------|-------|----------|---------|
| 1  | accounts        | 1     | Critical | Pending |
| 2  | organizations   | 1     | Critical | Pending |
| 3  | permissions     | 1     | Critical | Pending |
| 4  | ledger          | 1     | Critical | Pending |
| 5  | audit           | 1     | Critical | Pending |
| 6  | api             | 1     | Critical | Pending |
| 7  | banking         | 2     | High     | Pending |
| 8  | reconciliation  | 2     | High     | Pending |
| 9  | vendors         | 2     | High     | Pending |
| 10 | customers       | 2     | High     | Pending |
| 11 | documents       | 2     | High     | Pending |
| 12 | reports         | 2     | High     | Pending |
| 13 | dashboards      | 2     | High     | Pending |
| 14 | notifications   | 2     | Medium   | Pending |
| 15 | ap              | 3     | High     | Pending |
| 16 | ar              | 3     | High     | Pending |
| 17 | ai              | 3     | High     | Pending |
| 18 | tasks           | 3     | Medium   | Pending |
| 19 | subscriptions   | 4     | Medium   | Pending |
| 20 | integrations    | 4     | Medium   | Pending |
| 21 | public_api      | 4     | Low      | Pending |
