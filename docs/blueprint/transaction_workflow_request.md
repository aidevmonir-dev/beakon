# Request: End-to-End Transaction Workflow Specification

**To:** Thomas
**From:** Monirul
**Date:** 2026-05-05
**Re:** Defining the user-facing data entry workflow for each transaction type

---

## 1. Why I need this

The existing blueprint defines the **rules** a transaction must satisfy and the **layers** it passes through. To build the entry screens, AI proposal logic, and approval flows, I also need the **step-by-step user journey** per transaction type — what the preparer sees, what AI is allowed to propose, what is mandatory, who approves at what threshold, what happens on edge cases.

Without that, I will guess — and a guess on workflow becomes a guess on accounting control, which I do not want to ship under your name.

## 2. What is already documented (so I don't ask twice)

| Source | What it covers | What it does **not** cover |
|---|---|---|
| `2026 04 17-DRAFT-CoA-Wealth management v2.xlsx` | 3-layer model (Accounts / Masters / Posting rules); `09_Dimension_Validation_Rules` gate; 3 canonical posting examples (school fees, equity buy, mortgage interest); per-account dimension requirements; controlled lists | The user journey to create those postings; approval routing; AI proposal scope; reversal / period rules; subledger workflow |
| `2026 04 30-Beakon-Architecture.pdf` | 16-layer model; AI-assists / humans-approve / engine-validates separation; the high-level "Upload → Classify → Extract → Suggest → …" flow for one supplier invoice | Per-transaction-type flow; thresholds; mandatory fields beyond the CoA gate; UX |
| `2026 04 17-Beakon Founder Working Paper.pdf` | Phase-1 build priorities, decision rules, "must not be built yet" list | Workflow at all |
| `thomas.ogg / thomas2.ogg / thomas3.ogg / thomas 4.ogg` | Voice memos on prior topics | If any of the questions below are already answered in these, please point me to the file — I will re-read before re-asking |

## 3. What I still need from you

A filled-in answer per transaction type, using the template in §5.

### 3.1 Transaction types — please confirm which are in Phase 1 scope

Tick / cross / "later":

1. [ ] General journal entry (manual)
2. [ ] AP — supplier bill / receipt
3. [ ] AR — client invoice / disbursement
4. [ ] Bank / credit-card transaction + reconciliation
5. [ ] Portfolio trade (buy / sell / corporate action)
6. [ ] Loan transaction (drawdown, interest, repayment)
7. [ ] Fixed asset (acquisition, depreciation, disposal)
8. [ ] Payroll posting
9. [ ] Period-end adjustments (accruals, prepayments, FX revaluation, IC elimination)
10. [ ] Period close & lock
11. [ ] Anything I am missing? ____________________

If a type is "later", I will not build the entry screen yet — but I will still need to know whether the data model must accommodate it from day one.

## 4. Cross-cutting questions (answer once, applies to all flows)

1. **Default approval threshold** — at what amount / account class does a second approver kick in? Same threshold across entities, or entity-specific?
2. **Roles in scope for Phase 1** — which of {client user, accounting team, controller, senior reviewer, auditor (read-only), family-office manager, admin} can prepare? approve? override? I will use this to wire RBAC.
3. **AI citation policy** — when AI proposes a treatment, must it cite (a) a prior similar posting, (b) the accounting standard + principle (per the per-entity standard rule), (c) the engine rule it is following, or all three?
4. **AI never-do list** — what must AI never auto-propose under any flow? (e.g. prior-period postings, cross-entity / IC entries, anything touching tax lots, anything in a closed period.)
5. **Period rules** — once a period is locked, are corrections done via (a) reopen + edit, (b) prior-period adjustment in current period, or (c) both, depending on materiality?
6. **FX rate source** — single source per entity (e.g. ECB end-of-day), or per-transaction-type? Tolerance for manual override?
7. **Source-document mandatory?** — is a linked document required to post, or only required to *approve*? Different per transaction type?
8. **Reversal pattern** — full reversing entry vs. edit-with-audit-trail vs. void? Single rule or per-type?

## 5. Template — please fill once per transaction type

> Copy-paste this block once per type and fill in. Short answers fine.

```
Transaction type: ______________________________

A. Trigger / source document
   - What event starts the flow? (upload, bank feed, manual, scheduled, …)
   - Are source documents mandatory before posting? Before approving?
   - Where do the documents come from? (email, portal upload, integration)

B. Roles
   - Initiator role(s):
   - First-level approver:
   - Second-level approver (and the threshold that triggers it):
   - Override / exception authority:

C. Mandatory fields beyond the CoA workbook rules
   - The workbook already enforces per-account dimensions. List anything additional this transaction type needs, e.g.:
       AP → supplier ID, due date, payment method, VAT code
       Trade → trade date, settlement date, custodian, tax-lot method (FIFO/LIFO/avg)
   - Field-level defaults the system should pre-fill:

D. AI proposal scope
   - What MAY AI propose automatically?
   - What MUST AI never propose for this type?
   - What MUST every AI proposal cite? (prior entry / accounting standard / engine rule)

E. Engine validation (beyond debits=credits + dimension completeness)
   - Examples: 3-way match for AP, tax-lot availability for sell, open-period check, FX-rate-within-tolerance, loan-balance-not-negative.

F. Posting outcomes
   - Subledgers touched: AP / AR / Bank / FA / Tax Lots / Loan / Inventory / …
   - Reversal / cancel path:
   - Source-document linking — automatic or manual?

G. Edge cases that need explicit handling
   - Multi-currency / FX rate override
   - Multi-entity / intercompany side-effects
   - Rebillable flag → what additional posting fires?
   - Partial payments / partial matches
   - Missing-document state — queue, alert, or block?
   - Anything else specific to this type:

H. UX preferences (optional — I will choose if you have no preference)
   - Single-screen vs. wizard
   - AI proposal as pre-filled fields vs. side-by-side proposal/final view
   - Save-draft vs. submit-for-approval — separate states?
```

## 6. One worked example I would like first (if you only have time for one)

The **AP supplier invoice** flow — the same example used in the architecture PDF ("From One Supplier Invoice to Reviewed Financial Reporting"). If you walk me through that one end-to-end with concrete numbers, dimensions, approval thresholds, and edge cases, I can extrapolate the others and bring them back to you for sign-off rather than starting from a blank page each time.

A 30-minute live walkthrough or a single voice memo would be ideal.

## 7. How to deliver — whatever is fastest for you

- Annotate this document directly (Word / PDF / handwritten — any of those work)
- Voice memo per transaction type (same format as `thomas.ogg`); I will transcribe and structure
- One live walkthrough on AP, then I draft the rest and you review

## 8. What I will produce from your answer

- `docs/blueprint/transaction_workflows.md` — companion to `instructions_dump.md`, one section per transaction type, in the same verbatim-blueprint style
- A small per-flow diagram (preparer → AI proposal → engine validation → approver → post → reporting) for each type, for sign-off before I implement
- A mapping from each flow to the 16 layers, so we can confirm no layer boundary is being crossed

I will not start UI implementation on any transaction type until the workflow for it is signed off.

---

**One ask:** if the answer to any question is "I have not decided yet", please mark it that way explicitly. That is more useful to me than a tentative answer I might lock into the schema and have to undo later.
