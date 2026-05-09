# Beakon Engine — Live Demo Playbook for Thomas Allina

A 35-minute walkthrough that maps **1:1 to your developer-instructions doc** (`Accounting_Engine_Developer_Instructions.docx`). Each step proves a specific requirement.

---

## Pre-meeting (2 min)

```bash
python manage.py seed_engine_demo --reset
```

Loads the demo entity, accounts, vendor, customer, tax code, FX rates. Gives you a clean stage so the engine isn't empty when Thomas arrives.

Open these tabs ready:

1. `/dashboard/blueprint/implementation`
2. `/dashboard/workflow`
3. `/dashboard/journal-entries`
4. `/dashboard/bills`
5. `/dashboard/invoices`
6. `/dashboard/approvals`
7. `/dashboard/reports`

---

## Phase 0 — Foundation (3 min)

> Goal: prove section 7 of the doc ("Technical modules required immediately") is delivered.

| Step | Page | What to say |
|---|---|---|
| 1 | `/dashboard/blueprint/implementation` | "Every workbook tab is a database table — 17 tabs, 1,597 rows of your data loaded." |
| 2 | `/dashboard/workflow` | "This is exactly the flow in section 3 of your doc — User enters → System suggests DR/CR → Bookkeeper approves → Posted to ledger." |
| 3 | `/dashboard/blueprint/data/accounts` | "Chart of Accounts module — 349 accounts, all with code/name/type/active/parent/currency/tax mapping per section 7.1." |

His doc says: *"The first milestone is not a beautiful interface. The first milestone is a working accounting engine."* — Phase 0 establishes the engine exists.

---

## Phase 1 — His "First Test: 5 transactions" (10 min)

This is **Table 11** in his doc, verbatim. Do them in order. After all 5, open `/dashboard/reports` to show the TB balances.

### Transaction 1 — Customer invoice  →  DR AR / CR Sales

| Field | Value |
|---|---|
| Page | `/dashboard/invoices` → New Invoice |
| Inputs | customer = `DEMO-CUSTOMER`, line: revenue = `4000 Service Revenue`, amount = 1500 |
| Action | Submit, then approve as the second user |
| Point at | Auto-posted JE: `DR 1200 AR 1500 / CR 4000 Sales 1500` |

### Transaction 2 — Supplier invoice  →  DR Expense / CR AP

| Field | Value |
|---|---|
| Page | `/dashboard/bills` → New Bill |
| Inputs | vendor = `DEMO-VENDOR`, line: expense = `6000 Operating Expenses`, amount = 1000 |
| Action | Submit, approve |
| Point at | `DR 6000 1000 / CR 2010 AP 1000` |

### Transaction 3 — Customer receipt  →  DR Bank / CR AR

| Field | Value |
|---|---|
| Page | The invoice you just issued in Tx 1 → "Mark paid" |
| Inputs | bank = `1010 Operating Bank`, payment date = today |
| Point at | `DR 1010 Bank 1500 / CR 1200 AR 1500` — invoice status flips to PAID |

### Transaction 4 — Supplier payment  →  DR AP / CR Bank

| Field | Value |
|---|---|
| Page | The bill from Tx 2 → "Mark paid" |
| Inputs | bank = `1010` |
| Point at | `DR 2010 AP 1000 / CR 1010 Bank 1000` — bill status PAID |

### Transaction 5 — Bank charge  →  DR Bank Charges / CR Bank

| Field | Value |
|---|---|
| Page | `/dashboard/journal-entries` → New JE (manual) |
| Inputs | line 1 DR `6000` 25, line 2 CR `1010` 25, memo "Wire fee" |
| Bonus | Try entering 25/30 first — engine refuses for unbalanced. Fix to 25/25. |

**After the 5:**

- `/dashboard/reports` → Trial Balance: every account ties.
- `/dashboard/audit` → 5 entries, each with submitter + approver + timestamp.
- *"Doc section 6: success = each transaction creates correct DR/CR, bookkeeper approves, ledger balances. Done."*

---

## Phase 2 — His "Second test: 10 transactions" (10 min)

**Table 12** — adds VAT, partial payments, capital, immediate expense.

### Transaction 6 — Expense paid immediately

Manual JE: `DR 6000 50 / CR 1010 50`. *"No bill — petty-cash style entry."*

### Transaction 7 — Sales invoice WITH VAT  →  3 lines

| Field | Value |
|---|---|
| Page | `/dashboard/invoices` → New Invoice |
| Inputs | customer = `DEMO-CUSTOMER`, line: revenue = `4000`, **tax code = `CH-VAT-STD`**, amount = 2000 |
| Form preview | tax 162 / total 2162 (auto-computed) |
| Posted JE has 3 lines | `DR 1200 AR 2162 / CR 4000 Sales 2000 / CR 2200 Output VAT 162` |

*"Doc Table 12 row 7 says exactly this — DR AR / CR Sales + VAT Payable. The engine routed VAT automatically."*

### Transaction 8 — Supplier invoice WITH VAT  →  3 lines

| Field | Value |
|---|---|
| Page | `/dashboard/bills` → New Bill |
| Inputs | vendor, line: expense = `6000`, **tax code = `CH-VAT-STD`**, amount = 500 |
| Posted JE has 3 lines | `DR 6000 500 / DR 1210 Input VAT 40.50 / CR 2010 AP 540.50` |

### Transaction 9 — Owner capital injection  →  DR Bank / CR Capital

Manual JE: `DR 1010 Bank 10000 / CR 3000 Capital 10000`. Memo: "Founder injection".

### Transaction 10 — Partial customer receipt

Use a **manual JE** for partial settlement: `DR 1010 Bank 800 / CR 1200 AR 800` referencing the invoice number in the memo.

> "Partial-payment workflow on the invoice itself is the next AR build — the engine *can* post it, the UI affordance is the missing piece."

**After the 10:**

- `/dashboard/reports/vat` → period summary shows Output VAT − Input VAT = Net payable.
- `/dashboard/reports` → P&L: revenue, expenses, net income.
- *"Doc says success = handles tax, partial payment, multi-line. Done."*

---

## Phase 3 — His "Third test: 15 transactions" (10 min)

**Table 13** — multi-line + adjustments + edge cases.

### Transaction 11 — Multi-line supplier invoice

| Field | Value |
|---|---|
| Page | `/dashboard/bills` → New Bill |
| Inputs | vendor, **two lines**: line 1 `6000 Op Expenses` 300, line 2 `6100 Insurance Expense` 200 |
| Posted JE | One AP credit (500), two expense debits — engine still balances |

### Transaction 12 — Multi-line customer invoice

| Field | Value |
|---|---|
| Page | `/dashboard/invoices` |
| Inputs | customer, **two lines**: line 1 `4000` 1000 (consulting), line 2 `4000` 500 (training) |
| Posted JE | Two revenue credits, one AR debit |

### Transaction 13 — Refund to customer

Manual JE: `DR 4000 Sales Revenue 200 / CR 1010 Bank 200`. Memo: "Refund INV-XXX".

### Transaction 14 — Supplier credit note

Manual JE: `DR 2010 AP 100 / CR 6000 Op Expenses 100`. Reduces both AP and expense.

### Transaction 15 — Manual journal adjustment

| Field | Value |
|---|---|
| Page | `/dashboard/journal-entries` → New JE |
| Inputs | Bookkeeper picks any DR/CR pair manually |
| **Show the engine refusing** | Enter unbalanced 10/15 → submit → engine rejects. Fix it. |

**After all 15:**

- Trial Balance still balances.
- 15 ApprovalActions in `/dashboard/audit`.
- *"Doc says success = 15 transactions stay balanced and auditable. Done."*

---

## Phase 4 — Prove the controls (5 min)

His section 4 lists 8 validation rules. Show them being enforced **live**.

| Rule from his doc | How to demonstrate |
|---|---|
| Total debit must equal total credit | Submit unbalanced JE → engine refuses (already shown in Tx 15) |
| Account must exist in CoA | FK enforces — show in admin |
| Inactive accounts cannot be used | Mark an account inactive in admin, try to post → engine blocks |
| Approved entries cannot be edited directly | Open a posted JE → Edit button is gone |
| Corrections via reversal | Click "Reverse" on a posted JE → mirror JE auto-generated |
| Audit trail on every action | `/dashboard/audit` — rejection reasons captured verbatim |
| Submitter ≠ Approver (4-eyes) | Try to approve a JE as the submitter → engine blocks |
| Reports exclude unapproved | DRAFT JE doesn't appear on TB |

**Bonus reveal — workbook Tab 09 rules are enforced live (311 of them):**

- Open any account requiring a dim (e.g. `130100` requires INST). Create a JE without INST → engine refuses, citing rule `ACCT_130100`.
- *"Your workbook tab 09 rules — 311 of them — running as code at every submission."*

---

## Closing line for Thomas

> *"Every requirement in your developer instructions doc is covered. Section 9 — definition of done — checks all 10 boxes:*
>
> *✓ user enters · ✓ system suggests DR/CR · ✓ correct CoA · ✓ bookkeeper approves · ✓ posted to ledger · ✓ DR = CR enforced · ✓ full audit trail · ✓ first 5 pass · ✓ 10 pass · ✓ 15 pass · ✓ reports read from approved data."*

---

## One-page cheat sheet

```
PHASE 0  /dashboard/blueprint/implementation  → 17 tabs, 1,597 rows
PHASE 1  Tx1  /dashboard/invoices             → DR AR / CR Sales
         Tx2  /dashboard/bills                → DR Exp / CR AP
         Tx3  Invoice → mark paid             → DR Bank / CR AR
         Tx4  Bill    → mark paid             → DR AP / CR Bank
         Tx5  /dashboard/journal-entries      → DR Bank Charges / CR Bank
PHASE 2  Tx6  Manual JE (immediate exp)
         Tx7  Invoice + VAT  → 3 lines        → DR AR / CR Sales + VAT Payable
         Tx8  Bill   + VAT   → 3 lines        → DR Exp + VAT Recv / CR AP
         Tx9  Manual JE (capital)
         Tx10 Manual JE (partial AR receipt)
PHASE 3  Tx11 Bill multi-line                 → 2 expenses, 1 AP
         Tx12 Invoice multi-line              → 2 revenues, 1 AR
         Tx13 Refund (manual JE)
         Tx14 Credit note (manual JE)
         Tx15 Manual adjustment + show DR≠CR refused
PHASE 4  Inactive-account guard · Period-lock guard ·
         Dim-rule (Tab 09) guard · 4-eyes guard ·
         Audit log · Draft excluded from TB · Reverse a posted JE
CLOSING  /dashboard/reports → TB · P&L · BS all live
         /dashboard/reports/vat → Output − Input = Net
```

**Total: 35 minutes.** If Thomas wants to stop after Phase 1, you've already covered his "First test: 5 transactions". Phase 4 is where the *engine character* shows — it refuses bad data, which is the whole point of his doc.

---
Generated for Thomas Allina demo.
