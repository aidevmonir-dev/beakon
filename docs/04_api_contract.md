# Digits Clone - API Contract
# Version: 1.0
# Last Updated: 2026-04-13
# Base URL: /api/v1/
# Authentication: JWT (Bearer Token)
# Content-Type: application/json

---

## General Conventions

### Authentication
- All endpoints require `Authorization: Bearer <token>` unless marked PUBLIC
- Token obtained via `/api/v1/auth/login/`
- Token refresh via `/api/v1/auth/token/refresh/`

### Pagination
```json
{
  "count": 150,
  "page": 1,
  "page_size": 25,
  "total_pages": 6,
  "next": "/api/v1/accounts/?page=2",
  "previous": null,
  "results": [...]
}
```
- Default page size: 25
- Max page size: 100
- Query params: `?page=1&page_size=25`

### Filtering
- Query params: `?status=posted&date_from=2026-01-01&date_to=2026-03-31`
- Search: `?search=office supplies`
- Ordering: `?ordering=-date` (prefix `-` for descending)

### Error Response Format
```json
{
  "error": {
    "code": "LED001",
    "message": "Journal entry does not balance",
    "details": {
      "total_debits": "5000.00",
      "total_credits": "4500.00",
      "difference": "500.00"
    }
  }
}
```

### Standard HTTP Status Codes
| Code | Usage                              |
|------|------------------------------------|
| 200  | Success (GET, PUT, PATCH)          |
| 201  | Created (POST)                     |
| 204  | No Content (DELETE)                |
| 400  | Validation error                   |
| 401  | Not authenticated                  |
| 403  | Permission denied                  |
| 404  | Not found                          |
| 409  | Conflict (duplicate, period closed)|
| 422  | Unprocessable (business rule violation) |
| 429  | Rate limited                       |
| 500  | Server error                       |

### Organization Scope
- All endpoints (except auth) are scoped to the current organization
- Organization is determined by the `X-Organization-ID` header or from the user's default organization

---

## 1. Authentication & Users

### POST /api/v1/auth/register/ [PUBLIC]
Register a new user account.
```json
// Request
{
  "email": "user@example.com",
  "password": "securepassword123",
  "first_name": "John",
  "last_name": "Doe"
}

// Response 201
{
  "id": 1,
  "email": "user@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "is_email_verified": false,
  "date_joined": "2026-04-13T10:00:00Z"
}
```

### POST /api/v1/auth/login/ [PUBLIC]
```json
// Request
{
  "email": "user@example.com",
  "password": "securepassword123"
}

// Response 200
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe"
  }
}
```

### POST /api/v1/auth/token/refresh/
```json
// Request
{ "refresh": "eyJ0eXAi..." }

// Response 200
{ "access": "eyJ0eXAi..." }
```

### POST /api/v1/auth/password/reset/ [PUBLIC]
```json
// Request
{ "email": "user@example.com" }

// Response 200
{ "message": "Password reset email sent" }
```

### POST /api/v1/auth/password/reset/confirm/ [PUBLIC]
```json
// Request
{
  "token": "abc123",
  "new_password": "newsecurepassword123"
}

// Response 200
{ "message": "Password updated successfully" }
```

### GET /api/v1/auth/me/
```json
// Response 200
{
  "id": 1,
  "email": "user@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "profile": {
    "phone": "+1234567890",
    "timezone": "America/New_York",
    "avatar_url": null
  },
  "organizations": [
    {
      "id": 1,
      "name": "Acme Corp",
      "slug": "acme-corp",
      "role": "owner"
    }
  ]
}
```

### PATCH /api/v1/auth/me/
```json
// Request
{
  "first_name": "John",
  "profile": {
    "phone": "+1234567890",
    "timezone": "America/New_York"
  }
}
```

---

## 2. Organizations

### POST /api/v1/organizations/
```json
// Request
{
  "name": "Acme Corp",
  "legal_name": "Acme Corporation Inc.",
  "currency": "USD",
  "timezone": "America/New_York",
  "fiscal_year_start": 1,
  "country": "US",
  "tax_id": "12-3456789"
}

// Response 201
{
  "id": 1,
  "name": "Acme Corp",
  "slug": "acme-corp",
  "legal_name": "Acme Corporation Inc.",
  "currency": "USD",
  "timezone": "America/New_York",
  "fiscal_year_start": 1,
  "country": "US",
  "created_at": "2026-04-13T10:00:00Z"
}
```

### GET /api/v1/organizations/{id}/
### PATCH /api/v1/organizations/{id}/

### GET /api/v1/organizations/{id}/members/
```json
// Response 200
{
  "results": [
    {
      "id": 1,
      "user": {
        "id": 1,
        "email": "owner@example.com",
        "first_name": "John",
        "last_name": "Doe"
      },
      "role": {
        "id": 1,
        "name": "Owner",
        "slug": "owner"
      },
      "is_active": true,
      "accepted_at": "2026-04-13T10:00:00Z"
    }
  ]
}
```

### POST /api/v1/organizations/{id}/members/invite/
```json
// Request
{
  "email": "accountant@example.com",
  "role_id": 3
}

// Response 201
{
  "id": 2,
  "email": "accountant@example.com",
  "role": "Accountant",
  "invited_at": "2026-04-13T10:00:00Z",
  "status": "pending"
}
```

### DELETE /api/v1/organizations/{id}/members/{member_id}/

### GET /api/v1/organizations/{id}/roles/
### POST /api/v1/organizations/{id}/roles/
```json
// Request
{
  "name": "AP Manager",
  "permissions": {
    "view_ledger": true,
    "create_bill": true,
    "approve_bill": true,
    "pay_bill": true,
    "create_journal": false,
    "close_period": false
  }
}
```

---

## 3. Chart of Accounts

### GET /api/v1/accounts/
```json
// Query params: ?type=expense&is_active=true&search=office
// Response 200
{
  "results": [
    {
      "id": 1,
      "code": "1000",
      "name": "Cash",
      "account_type": "asset",
      "account_subtype": "current_asset",
      "normal_balance": "debit",
      "is_active": true,
      "is_system": true,
      "parent_id": null,
      "balance": "45230.50",
      "currency": "USD"
    }
  ]
}
```

### POST /api/v1/accounts/
```json
// Request
{
  "code": "6100",
  "name": "Office Supplies",
  "account_type": "expense",
  "account_subtype": "operating_expense",
  "parent_id": 15,
  "description": "General office supplies and materials"
}

// Response 201
{
  "id": 42,
  "code": "6100",
  "name": "Office Supplies",
  "account_type": "expense",
  "account_subtype": "operating_expense",
  "normal_balance": "debit",
  "is_active": true,
  "is_system": false,
  "parent_id": 15,
  "balance": "0.00",
  "currency": "USD",
  "created_at": "2026-04-13T10:00:00Z"
}
```

### GET /api/v1/accounts/{id}/
### PATCH /api/v1/accounts/{id}/
### GET /api/v1/accounts/{id}/ledger/
```json
// Query params: ?date_from=2026-01-01&date_to=2026-03-31
// Response 200 — all journal lines for this account
{
  "account": {
    "id": 42,
    "code": "6100",
    "name": "Office Supplies"
  },
  "opening_balance": "0.00",
  "closing_balance": "3420.75",
  "entries": [
    {
      "date": "2026-01-15",
      "journal_entry_id": 101,
      "entry_number": "JE-000101",
      "description": "January office supplies",
      "debit": "1250.00",
      "credit": "0.00",
      "running_balance": "1250.00",
      "source_type": "bill",
      "source_id": 5
    }
  ]
}
```

### GET /api/v1/accounts/tree/
```json
// Response 200 — hierarchical account structure
{
  "assets": [
    {
      "id": 1,
      "code": "1000",
      "name": "Current Assets",
      "children": [
        { "id": 2, "code": "1010", "name": "Cash", "balance": "45230.50" },
        { "id": 3, "code": "1020", "name": "Accounts Receivable", "balance": "12500.00" }
      ]
    }
  ],
  "liabilities": [...],
  "equity": [...],
  "revenue": [...],
  "expenses": [...]
}
```

---

## 4. Journal Entries

### GET /api/v1/journal-entries/
```json
// Query params: ?status=posted&date_from=2026-01-01&source_type=bill&ordering=-date
// Response 200
{
  "results": [
    {
      "id": 101,
      "entry_number": "JE-000101",
      "date": "2026-01-15",
      "memo": "Office supplies purchase from Staples",
      "status": "posted",
      "source_type": "bill",
      "source_id": 5,
      "total_amount": "1250.00",
      "lines_count": 2,
      "created_by": "John Doe",
      "posted_at": "2026-01-15T14:30:00Z"
    }
  ]
}
```

### POST /api/v1/journal-entries/
```json
// Request
{
  "date": "2026-04-13",
  "memo": "Monthly rent payment",
  "lines": [
    {
      "account_id": 42,
      "description": "April office rent",
      "debit": "3500.00",
      "credit": "0.00"
    },
    {
      "account_id": 2,
      "description": "April office rent",
      "debit": "0.00",
      "credit": "3500.00"
    }
  ]
}

// Response 201
{
  "id": 150,
  "entry_number": "JE-000150",
  "date": "2026-04-13",
  "memo": "Monthly rent payment",
  "status": "draft",
  "source_type": "manual",
  "total_amount": "3500.00",
  "lines": [
    {
      "id": 301,
      "account": { "id": 42, "code": "6200", "name": "Rent Expense" },
      "description": "April office rent",
      "debit": "3500.00",
      "credit": "0.00"
    },
    {
      "id": 302,
      "account": { "id": 2, "code": "1010", "name": "Cash" },
      "description": "April office rent",
      "debit": "0.00",
      "credit": "3500.00"
    }
  ],
  "created_by": "John Doe",
  "created_at": "2026-04-13T10:00:00Z"
}
```

### GET /api/v1/journal-entries/{id}/
### PATCH /api/v1/journal-entries/{id}/ (only if status=draft)

### POST /api/v1/journal-entries/{id}/post/
```json
// Response 200
{
  "id": 150,
  "entry_number": "JE-000150",
  "status": "posted",
  "posted_by": "John Doe",
  "posted_at": "2026-04-13T10:05:00Z"
}

// Error 422 (validation failure)
{
  "error": {
    "code": "LED001",
    "message": "Journal entry does not balance",
    "details": { "total_debits": "3500.00", "total_credits": "3000.00" }
  }
}

// Error 409 (period closed)
{
  "error": {
    "code": "LED004",
    "message": "Fiscal period is closed",
    "details": { "period": "March 2026", "closed_at": "2026-04-05T10:00:00Z" }
  }
}
```

### POST /api/v1/journal-entries/{id}/reverse/
```json
// Request
{
  "reversal_date": "2026-04-13",
  "memo": "Reversal of JE-000150 — incorrect amount"
}

// Response 201 — returns the NEW reversal entry
{
  "id": 151,
  "entry_number": "JE-000151",
  "date": "2026-04-13",
  "status": "posted",
  "source_type": "reversal",
  "reversal_of_id": 150,
  "memo": "Reversal of JE-000150 — incorrect amount"
}
```

---

## 5. Banking

### GET /api/v1/bank-accounts/
### POST /api/v1/bank-accounts/
```json
// Request
{
  "name": "Business Checking",
  "bank_name": "Chase",
  "account_type": "checking",
  "account_number_last4": "4567",
  "ledger_account_id": 2,
  "currency": "USD"
}
```

### GET /api/v1/bank-accounts/{id}/
### PATCH /api/v1/bank-accounts/{id}/

### GET /api/v1/bank-accounts/{id}/transactions/
```json
// Query params: ?status=new&date_from=2026-01-01&ordering=-date
// Response 200
{
  "results": [
    {
      "id": 501,
      "date": "2026-04-10",
      "description": "AMAZON.COM AMZN.COM/BILL",
      "original_description": "AMAZON.COM AMZN.COM/BILL WA",
      "amount": "-89.99",
      "transaction_type": "debit",
      "status": "new",
      "category": null,
      "vendor": null,
      "is_duplicate": false,
      "ai_suggestion": {
        "account": { "id": 42, "code": "6100", "name": "Office Supplies" },
        "vendor": { "id": 10, "name": "Amazon" },
        "confidence": 0.92
      }
    }
  ]
}
```

### POST /api/v1/bank-accounts/{id}/import/
```json
// Request (multipart/form-data)
{
  "file": "<CSV or OFX file>",
  "date_format": "MM/DD/YYYY",
  "column_mapping": {
    "date": 0,
    "description": 1,
    "amount": 3,
    "balance": 4
  }
}

// Response 201
{
  "import_id": 25,
  "status": "processing",
  "total_rows": 150,
  "message": "Import started. You will be notified when complete."
}
```

### GET /api/v1/bank-imports/{id}/
```json
// Response 200
{
  "id": 25,
  "bank_account": "Business Checking",
  "source": "csv",
  "file_name": "chase_april_2026.csv",
  "status": "completed",
  "total_rows": 150,
  "imported_rows": 142,
  "duplicate_rows": 8,
  "error_rows": 0,
  "completed_at": "2026-04-13T10:02:00Z"
}
```

### POST /api/v1/bank-transactions/{id}/categorize/
```json
// Request
{
  "account_id": 42,
  "vendor_id": 10,
  "memo": "Office supplies"
}

// Response 200
{
  "id": 501,
  "status": "categorized",
  "category": "Office Supplies",
  "vendor": { "id": 10, "name": "Amazon" },
  "journal_entry": {
    "id": 155,
    "entry_number": "JE-000155",
    "status": "draft"
  }
}
```

### POST /api/v1/bank-transactions/bulk-categorize/
```json
// Request
{
  "transactions": [
    { "id": 501, "account_id": 42, "vendor_id": 10 },
    { "id": 502, "account_id": 35, "vendor_id": null },
    { "id": 503, "account_id": 42, "vendor_id": 10 }
  ]
}

// Response 200
{
  "categorized": 3,
  "failed": 0,
  "results": [...]
}
```

---

## 6. Reconciliation

### POST /api/v1/reconciliation/sessions/
```json
// Request
{
  "bank_account_id": 1,
  "period_start": "2026-03-01",
  "period_end": "2026-03-31",
  "statement_balance": "45230.50"
}

// Response 201
{
  "id": 10,
  "bank_account": "Business Checking",
  "period_start": "2026-03-01",
  "period_end": "2026-03-31",
  "statement_balance": "45230.50",
  "ledger_balance": "44980.50",
  "difference": "250.00",
  "status": "in_progress",
  "matched_count": 0,
  "unmatched_count": 87
}
```

### GET /api/v1/reconciliation/sessions/{id}/
### GET /api/v1/reconciliation/sessions/{id}/suggestions/
```json
// Response 200
{
  "results": [
    {
      "bank_transaction": {
        "id": 501,
        "date": "2026-03-15",
        "description": "STAPLES STORE #123",
        "amount": "-85.50"
      },
      "suggested_match": {
        "journal_line_id": 302,
        "journal_entry_number": "JE-000101",
        "date": "2026-03-15",
        "description": "Office supplies - Staples",
        "amount": "85.50"
      },
      "confidence_score": 0.95,
      "match_reasons": ["exact_amount", "same_date", "vendor_match"]
    }
  ]
}
```

### POST /api/v1/reconciliation/sessions/{id}/match/
```json
// Request
{
  "bank_transaction_id": 501,
  "journal_line_id": 302
}

// Response 201
{
  "id": 50,
  "match_type": "manual",
  "bank_transaction_id": 501,
  "journal_line_id": 302,
  "matched_at": "2026-04-13T10:00:00Z"
}
```

### POST /api/v1/reconciliation/sessions/{id}/complete/
```json
// Response 200
{
  "id": 10,
  "status": "completed",
  "matched_count": 85,
  "unmatched_count": 2,
  "difference": "0.00",
  "completed_at": "2026-04-13T11:00:00Z"
}

// Error 422
{
  "error": {
    "code": "REC001",
    "message": "Statement balance does not match ledger balance",
    "details": { "difference": "250.00" }
  }
}
```

---

## 7. Vendors

### GET /api/v1/vendors/
```json
// Query params: ?search=staples&is_active=true
```

### POST /api/v1/vendors/
```json
// Request
{
  "name": "Staples Inc",
  "email": "billing@staples.com",
  "tax_id": "12-3456789",
  "default_expense_account_id": 42,
  "payment_terms": 30,
  "address_line1": "500 Staples Drive",
  "city": "Framingham",
  "state": "MA",
  "country": "US",
  "postal_code": "01702"
}
```

### GET /api/v1/vendors/{id}/
### PATCH /api/v1/vendors/{id}/
### GET /api/v1/vendors/{id}/bills/
### GET /api/v1/vendors/{id}/transactions/

---

## 8. Customers

### GET /api/v1/customers/
### POST /api/v1/customers/
```json
// Request
{
  "name": "Widget Corp",
  "email": "ap@widgetcorp.com",
  "default_revenue_account_id": 30,
  "payment_terms": 30,
  "billing_address_line1": "123 Main St",
  "billing_city": "New York",
  "billing_state": "NY",
  "billing_country": "US"
}
```

### GET /api/v1/customers/{id}/
### PATCH /api/v1/customers/{id}/
### GET /api/v1/customers/{id}/invoices/
### GET /api/v1/customers/{id}/payments/

---

## 9. Bills (Accounts Payable)

### GET /api/v1/bills/
```json
// Query params: ?status=approved&vendor_id=5&due_date_to=2026-04-30&ordering=due_date
```

### POST /api/v1/bills/
```json
// Request
{
  "vendor_id": 5,
  "bill_number": "INV-2026-0042",
  "date": "2026-04-01",
  "due_date": "2026-05-01",
  "memo": "April office supplies",
  "lines": [
    {
      "account_id": 42,
      "description": "Printer paper (10 boxes)",
      "quantity": 10,
      "unit_price": "25.00",
      "amount": "250.00"
    },
    {
      "account_id": 42,
      "description": "Toner cartridges",
      "quantity": 4,
      "unit_price": "75.00",
      "amount": "300.00"
    }
  ]
}

// Response 201
{
  "id": 20,
  "internal_number": "BILL-000020",
  "vendor": { "id": 5, "name": "Staples Inc" },
  "bill_number": "INV-2026-0042",
  "date": "2026-04-01",
  "due_date": "2026-05-01",
  "subtotal": "550.00",
  "tax_amount": "0.00",
  "total_amount": "550.00",
  "balance_due": "550.00",
  "status": "draft",
  "lines": [...]
}
```

### GET /api/v1/bills/{id}/
### PATCH /api/v1/bills/{id}/ (only if draft)

### POST /api/v1/bills/{id}/approve/
```json
// Response 200
{
  "id": 20,
  "status": "approved",
  "approved_by": "John Doe",
  "approved_at": "2026-04-13T10:00:00Z",
  "journal_entry": {
    "id": 160,
    "entry_number": "JE-000160",
    "status": "posted"
  }
}
```

### POST /api/v1/bills/{id}/pay/
```json
// Request
{
  "amount": "550.00",
  "bank_account_id": 1,
  "payment_date": "2026-04-13",
  "reference": "CHK-1042"
}

// Response 200
{
  "id": 20,
  "status": "paid",
  "amount_paid": "550.00",
  "balance_due": "0.00",
  "payment_journal_entry": {
    "id": 161,
    "entry_number": "JE-000161",
    "status": "posted"
  }
}
```

### POST /api/v1/bills/{id}/cancel/

### GET /api/v1/bills/aging/
```json
// Response 200
{
  "as_of_date": "2026-04-13",
  "total_outstanding": "12500.00",
  "buckets": {
    "current": "5000.00",
    "1_30_days": "3500.00",
    "31_60_days": "2500.00",
    "61_90_days": "1000.00",
    "over_90_days": "500.00"
  },
  "vendors": [
    {
      "vendor": { "id": 5, "name": "Staples Inc" },
      "total": "550.00",
      "current": "550.00",
      "1_30_days": "0.00",
      "31_60_days": "0.00",
      "61_90_days": "0.00",
      "over_90_days": "0.00"
    }
  ]
}
```

---

## 10. Invoices (Accounts Receivable)

### GET /api/v1/invoices/
### POST /api/v1/invoices/
```json
// Request
{
  "customer_id": 3,
  "date": "2026-04-13",
  "due_date": "2026-05-13",
  "payment_terms": 30,
  "notes_to_customer": "Thank you for your business!",
  "lines": [
    {
      "account_id": 30,
      "description": "Consulting services - April 2026",
      "quantity": 40,
      "unit_price": "150.00",
      "amount": "6000.00"
    }
  ]
}

// Response 201
{
  "id": 15,
  "invoice_number": "INV-000015",
  "customer": { "id": 3, "name": "Widget Corp" },
  "date": "2026-04-13",
  "due_date": "2026-05-13",
  "subtotal": "6000.00",
  "tax_amount": "0.00",
  "total_amount": "6000.00",
  "balance_due": "6000.00",
  "status": "draft",
  "lines": [...]
}
```

### GET /api/v1/invoices/{id}/
### PATCH /api/v1/invoices/{id}/ (only if draft)

### POST /api/v1/invoices/{id}/send/
```json
// Request
{
  "to_email": "ap@widgetcorp.com",
  "cc_email": "john@acme.com",
  "message": "Please find attached invoice INV-000015."
}

// Response 200
{
  "id": 15,
  "status": "sent",
  "sent_at": "2026-04-13T10:00:00Z",
  "journal_entry": {
    "id": 165,
    "entry_number": "JE-000165",
    "status": "posted"
  }
}
```

### POST /api/v1/invoices/{id}/record-payment/
```json
// Request
{
  "amount": "3000.00",
  "payment_date": "2026-04-20",
  "payment_method": "bank_transfer",
  "reference": "Wire #12345",
  "bank_account_id": 1
}

// Response 200
{
  "id": 15,
  "status": "partially_paid",
  "amount_paid": "3000.00",
  "balance_due": "3000.00",
  "payment": {
    "id": 8,
    "amount": "3000.00",
    "journal_entry_id": 170
  }
}
```

### POST /api/v1/invoices/{id}/send-reminder/
### POST /api/v1/invoices/{id}/cancel/

### GET /api/v1/invoices/aging/
```json
// Same structure as bills aging but for customers/receivables
```

### POST /api/v1/invoices/{id}/credit-note/
```json
// Request
{
  "amount": "500.00",
  "reason": "Discount for early payment"
}
```

---

## 11. Documents

### GET /api/v1/documents/
### POST /api/v1/documents/upload/ (multipart/form-data)
```json
// Request
{
  "file": "<binary file>",
  "description": "Staples invoice April 2026",
  "tags": ["invoice", "staples", "2026-04"],
  "linked_type": "bill",
  "linked_id": 20
}

// Response 201
{
  "id": 50,
  "file_name": "staples_invoice_april.pdf",
  "file_url": "/media/documents/org_1/staples_invoice_april.pdf",
  "file_size": 245760,
  "file_type": "pdf",
  "tags": ["invoice", "staples", "2026-04"],
  "links": [
    { "linked_type": "bill", "linked_id": 20 }
  ],
  "ocr_status": "pending",
  "uploaded_by": "John Doe",
  "created_at": "2026-04-13T10:00:00Z"
}
```

### GET /api/v1/documents/{id}/
### DELETE /api/v1/documents/{id}/

### GET /api/v1/documents/{id}/ocr/
```json
// Response 200
{
  "id": 30,
  "document_id": 50,
  "status": "completed",
  "confidence_score": 0.94,
  "extracted_data": {
    "vendor_name": "Staples Inc",
    "invoice_number": "INV-2026-0042",
    "date": "2026-04-01",
    "due_date": "2026-05-01",
    "total": "550.00",
    "tax": "0.00",
    "line_items": [
      { "description": "Printer paper (10 boxes)", "quantity": 10, "unit_price": "25.00", "amount": "250.00" },
      { "description": "Toner cartridges", "quantity": 4, "unit_price": "75.00", "amount": "300.00" }
    ]
  },
  "raw_text": "Staples Inc\n500 Staples Drive\nFramingham, MA 01702\n..."
}
```

### POST /api/v1/documents/{id}/ocr/process/
Trigger OCR processing (or re-processing).

---

## 12. Reports

### GET /api/v1/reports/profit-loss/
```json
// Query params: ?date_from=2026-01-01&date_to=2026-03-31&compare_prior=true
// Response 200
{
  "report_type": "profit_loss",
  "period": { "from": "2026-01-01", "to": "2026-03-31" },
  "currency": "USD",
  "sections": [
    {
      "name": "Revenue",
      "total": "85000.00",
      "prior_total": "72000.00",
      "change_pct": 18.06,
      "accounts": [
        {
          "id": 30, "code": "4000", "name": "Service Revenue",
          "amount": "75000.00", "prior_amount": "65000.00"
        },
        {
          "id": 31, "code": "4100", "name": "Product Revenue",
          "amount": "10000.00", "prior_amount": "7000.00"
        }
      ]
    },
    {
      "name": "Operating Expenses",
      "total": "52000.00",
      "prior_total": "48000.00",
      "change_pct": 8.33,
      "accounts": [...]
    }
  ],
  "summary": {
    "total_revenue": "85000.00",
    "total_expenses": "52000.00",
    "net_income": "33000.00",
    "prior_net_income": "24000.00",
    "change_pct": 37.5
  }
}
```

### GET /api/v1/reports/balance-sheet/
```json
// Query params: ?as_of=2026-03-31
// Response 200
{
  "report_type": "balance_sheet",
  "as_of_date": "2026-03-31",
  "currency": "USD",
  "assets": {
    "total": "250000.00",
    "sections": [
      {
        "name": "Current Assets",
        "total": "95000.00",
        "accounts": [
          { "id": 2, "code": "1010", "name": "Cash", "balance": "45230.50" },
          { "id": 3, "code": "1020", "name": "Accounts Receivable", "balance": "32500.00" },
          { "id": 4, "code": "1030", "name": "Prepaid Expenses", "balance": "17269.50" }
        ]
      },
      {
        "name": "Fixed Assets",
        "total": "155000.00",
        "accounts": [...]
      }
    ]
  },
  "liabilities": {
    "total": "80000.00",
    "sections": [...]
  },
  "equity": {
    "total": "170000.00",
    "sections": [...]
  },
  "is_balanced": true
}
```

### GET /api/v1/reports/cash-flow/
```json
// Query params: ?date_from=2026-01-01&date_to=2026-03-31
```

### GET /api/v1/reports/trial-balance/
```json
// Query params: ?as_of=2026-03-31
// Response 200
{
  "report_type": "trial_balance",
  "as_of_date": "2026-03-31",
  "accounts": [
    { "code": "1010", "name": "Cash", "debit": "45230.50", "credit": "0.00" },
    { "code": "1020", "name": "AR", "debit": "32500.00", "credit": "0.00" },
    { "code": "2000", "name": "AP", "debit": "0.00", "credit": "12500.00" }
  ],
  "totals": {
    "total_debits": "350000.00",
    "total_credits": "350000.00",
    "is_balanced": true
  }
}
```

### POST /api/v1/reports/export/
```json
// Request
{
  "report_type": "profit_loss",
  "format": "pdf",
  "parameters": {
    "date_from": "2026-01-01",
    "date_to": "2026-03-31"
  }
}

// Response 200
{
  "download_url": "/api/v1/reports/download/abc123/",
  "expires_at": "2026-04-13T11:00:00Z"
}
```

---

## 13. Dashboards

### GET /api/v1/dashboards/
### GET /api/v1/dashboards/{id}/

### GET /api/v1/dashboards/home/
```json
// Response 200 — aggregated home dashboard data
{
  "cash_position": {
    "total": "45230.50",
    "accounts": [
      { "name": "Business Checking", "balance": "42000.00" },
      { "name": "Savings", "balance": "3230.50" }
    ]
  },
  "receivables": {
    "total_outstanding": "32500.00",
    "overdue": "5200.00",
    "due_this_week": "8500.00"
  },
  "payables": {
    "total_outstanding": "12500.00",
    "overdue": "1500.00",
    "due_this_week": "3200.00"
  },
  "profit_summary": {
    "current_month": {
      "revenue": "28000.00",
      "expenses": "17000.00",
      "net_income": "11000.00"
    },
    "prior_month": {
      "revenue": "25000.00",
      "expenses": "16500.00",
      "net_income": "8500.00"
    }
  },
  "expense_trend": {
    "labels": ["Jan", "Feb", "Mar", "Apr"],
    "data": [16000, 16500, 17200, 17000]
  },
  "revenue_trend": {
    "labels": ["Jan", "Feb", "Mar", "Apr"],
    "data": [24000, 27000, 25000, 28000]
  },
  "recent_activity": [
    {
      "type": "bill_paid",
      "description": "Paid BILL-000018 to AWS",
      "amount": "-2450.00",
      "timestamp": "2026-04-12T15:30:00Z"
    },
    {
      "type": "invoice_sent",
      "description": "Sent INV-000014 to Widget Corp",
      "amount": "6000.00",
      "timestamp": "2026-04-12T10:00:00Z"
    }
  ],
  "tasks_due": [
    {
      "id": 5,
      "title": "Review March bank reconciliation",
      "due_date": "2026-04-15",
      "assigned_to": "Jane Smith"
    }
  ]
}
```

---

## 14. AI Assistant

### POST /api/v1/ai/ask/
```json
// Request
{
  "question": "How much did we spend on office supplies last quarter?"
}

// Response 200
{
  "answer": "You spent $4,850.75 on office supplies (account 6100) in Q1 2026. This is a 12% increase compared to Q4 2025 ($4,330.20). The top vendors were Staples ($2,100.00), Amazon ($1,650.75), and Office Depot ($1,100.00).",
  "data": {
    "total": "4850.75",
    "period": "Q1 2026",
    "breakdown": [
      { "vendor": "Staples", "amount": "2100.00" },
      { "vendor": "Amazon", "amount": "1650.75" },
      { "vendor": "Office Depot", "amount": "1100.00" }
    ]
  },
  "sources": [
    { "type": "account_ledger", "account_code": "6100", "period": "2026-01-01 to 2026-03-31" }
  ],
  "job_id": 100
}
```

### POST /api/v1/ai/categorize/
```json
// Request
{
  "transaction_ids": [501, 502, 503]
}

// Response 200
{
  "suggestions": [
    {
      "transaction_id": 501,
      "suggested_account": { "id": 42, "code": "6100", "name": "Office Supplies" },
      "suggested_vendor": { "id": 10, "name": "Amazon" },
      "confidence": 0.92,
      "reasoning": "Merchant 'AMAZON.COM' matched to vendor Amazon. Similar transactions categorized to Office Supplies 15 times."
    },
    {
      "transaction_id": 502,
      "suggested_account": { "id": 43, "code": "6200", "name": "Rent Expense" },
      "suggested_vendor": null,
      "confidence": 0.98,
      "reasoning": "Description contains 'MONTHLY RENT'. Recurring pattern detected."
    }
  ],
  "job_id": 101
}
```

### POST /api/v1/ai/extract-document/
```json
// Request
{
  "document_id": 50
}

// Response 200
{
  "job_id": 102,
  "status": "completed",
  "extracted_data": {
    "document_type": "bill",
    "vendor_name": "Staples Inc",
    "invoice_number": "INV-2026-0042",
    "date": "2026-04-01",
    "due_date": "2026-05-01",
    "total": "550.00",
    "line_items": [...]
  },
  "confidence": 0.94,
  "suggested_action": {
    "type": "create_bill",
    "pre_filled_data": {
      "vendor_id": 5,
      "bill_number": "INV-2026-0042",
      "date": "2026-04-01",
      "due_date": "2026-05-01",
      "lines": [...]
    }
  }
}
```

### GET /api/v1/ai/anomalies/
```json
// Response 200
{
  "anomalies": [
    {
      "id": 1,
      "type": "unusual_spend",
      "severity": "medium",
      "description": "AWS charges increased 45% this month ($3,500 vs $2,400 average)",
      "related_transactions": [505, 510, 515],
      "detected_at": "2026-04-13T08:00:00Z"
    },
    {
      "id": 2,
      "type": "duplicate_bill",
      "severity": "high",
      "description": "BILL-000019 and BILL-000020 appear to be duplicates (same vendor, amount, date)",
      "related_objects": [
        { "type": "bill", "id": 19 },
        { "type": "bill", "id": 20 }
      ],
      "detected_at": "2026-04-13T08:00:00Z"
    }
  ]
}
```

---

## 15. Fiscal Periods

### GET /api/v1/fiscal-periods/
```json
// Response 200
{
  "results": [
    {
      "id": 1,
      "name": "January 2026",
      "period_type": "month",
      "start_date": "2026-01-01",
      "end_date": "2026-01-31",
      "is_closed": true,
      "closed_by": "John Doe",
      "closed_at": "2026-02-05T10:00:00Z"
    },
    {
      "id": 4,
      "name": "April 2026",
      "period_type": "month",
      "start_date": "2026-04-01",
      "end_date": "2026-04-30",
      "is_closed": false,
      "closed_by": null,
      "closed_at": null
    }
  ]
}
```

### POST /api/v1/fiscal-periods/{id}/close/
```json
// Response 200
{
  "id": 3,
  "name": "March 2026",
  "is_closed": true,
  "closed_by": "John Doe",
  "closed_at": "2026-04-13T10:00:00Z",
  "pre_close_checks": {
    "trial_balance_balanced": true,
    "unposted_entries": 0,
    "unreconciled_accounts": 0,
    "all_checks_passed": true
  }
}

// Error 422
{
  "error": {
    "code": "LED004",
    "message": "Cannot close period. Pre-close checks failed.",
    "details": {
      "unposted_entries": 3,
      "unreconciled_accounts": 1
    }
  }
}
```

### POST /api/v1/fiscal-periods/{id}/reopen/
Requires Owner/Admin role. Creates audit log entry.

---

## 16. Audit Log

### GET /api/v1/audit/events/
```json
// Query params: ?object_type=journal_entry&action=post&date_from=2026-04-01
// Response 200
{
  "results": [
    {
      "id": 500,
      "actor": { "id": 1, "name": "John Doe", "type": "user" },
      "action": "post",
      "object_type": "journal_entry",
      "object_id": 150,
      "object_repr": "JE-000150",
      "changes": {
        "status": { "old": "draft", "new": "posted" }
      },
      "ip_address": "192.168.1.100",
      "created_at": "2026-04-13T10:05:00Z"
    }
  ]
}
```

---

## 17. Tasks

### GET /api/v1/tasks/
### POST /api/v1/tasks/
```json
// Request
{
  "title": "Review March bank reconciliation",
  "description": "Complete reconciliation for Chase checking account",
  "task_type": "close_checklist",
  "priority": "high",
  "due_date": "2026-04-15",
  "assigned_to_id": 2,
  "linked_type": "reconciliation",
  "linked_id": 10
}
```

### PATCH /api/v1/tasks/{id}/
### POST /api/v1/tasks/{id}/complete/

### GET /api/v1/tasks/checklists/
### POST /api/v1/tasks/checklists/
```json
// Request — create a month-end close checklist
{
  "name": "March 2026 Month-End Close",
  "checklist_type": "month_end",
  "fiscal_period_id": 3,
  "items": [
    { "title": "Reconcile all bank accounts", "assigned_to_id": 2 },
    { "title": "Review and post all pending journal entries", "assigned_to_id": 1 },
    { "title": "Review AP aging report", "assigned_to_id": 2 },
    { "title": "Review AR aging report", "assigned_to_id": 1 },
    { "title": "Generate P&L and Balance Sheet", "assigned_to_id": 1 },
    { "title": "Close fiscal period", "assigned_to_id": 1 }
  ]
}
```

---

## 18. Notifications

### GET /api/v1/notifications/
```json
// Query params: ?is_read=false
// Response 200
{
  "unread_count": 5,
  "results": [
    {
      "id": 100,
      "notification_type": "bill_due",
      "title": "Bill due tomorrow",
      "message": "BILL-000020 from Staples Inc ($550.00) is due on 2026-04-14",
      "linked_type": "bill",
      "linked_id": 20,
      "is_read": false,
      "created_at": "2026-04-13T08:00:00Z"
    }
  ]
}
```

### POST /api/v1/notifications/mark-read/
```json
// Request
{ "notification_ids": [100, 101, 102] }
```

### GET /api/v1/notifications/preferences/
### PATCH /api/v1/notifications/preferences/

---

## 19. Integrations (Phase 4)

### GET /api/v1/integrations/
### POST /api/v1/integrations/
### GET /api/v1/integrations/{id}/sync-history/
### POST /api/v1/integrations/{id}/sync/

---

## Rate Limiting

| Endpoint Type          | Limit              |
|-----------------------|---------------------|
| Authentication        | 10 requests/minute   |
| Standard CRUD         | 100 requests/minute  |
| Report generation     | 20 requests/minute   |
| AI endpoints          | 30 requests/minute   |
| Bulk operations       | 10 requests/minute   |
| File uploads          | 20 requests/minute   |

Rate limit headers included in all responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1681401600
```
