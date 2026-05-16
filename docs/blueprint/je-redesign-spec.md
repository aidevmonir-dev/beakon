# Beakon: Revised Journal Entry Review Screen — Spec

**Source:** Thomas, 2026-05-16. Requirements note for Monirul.
**Status:** Authoritative. Supersedes the speculative `docs/je-redesign-faq.md`.

> Verbatim copy of Thomas's note follows. Section numbering preserved.

---

## Purpose of the revised screen

- Move Beakon from a simple bill-entry form to a true accounting review and posting screen.
- Expose the missing accounting dimensions, posting controls, reconciliation checks, approval flow, and AI learning workflow.
- Make the screen suitable for real accounting operations: not just account + description + amount + VAT, but account + dimensions + period + allocation + auditability.

## 1. Product principle

The critical design principle is: Beakon should not only ask **which account**. It should ask **which account, which dimension, which entity, which period, which allocation, and whether the rule should be remembered.**

## 2. Current issue with the existing JE screen

- The current JE screen is helpful as an AI extraction review screen, but it is too light for accounting posting.
- It captures supplier, date, description, line amount and VAT, but it does not visibly capture cost centres, projects, mandates, recharge allocations, approval owner, posting period, service period, prior-rule reasoning, or final debit/credit preview.
- For recurring invoices such as Sunrise, Swisscom, telecom, property, family-office and intercompany costs, these missing dimensions are often as important as the GL account itself.

## 3. Proposed screen name and structure

**Screen title:** Journal Entry Review
**Subtitle:** AI draft — review, correct, and approve before posting

| Area | Purpose |
|---|---|
| Top header | Document identity, totals, status, confidence and reconciliation status. |
| AI review summary | What Beakon detected, what it is confident about, and what requires review. |
| Document details | Invoice description, service period, payment terms, posting period, approval owner and vendor rule. |
| Journal entry lines | Editable accounting lines with GL accounts, VAT, dimensions, period, allocation and confidence. |
| Right-side panel | AI reasoning, prior postings, Teach Beakon and audit trail. |
| Posting preview | Final debit/credit entry before posting, including balance and reconciliation checks. |
| Footer actions | Save draft, submit for approval, cancel, approve and post. |

## 4. Top header — document identity and posting status

The header should make the financial control position visible immediately. It should separate **invoice total** from **JE total** and show any difference as a **blocking control** if not zero.

| Field | Example |
|---|---|
| Entity | BEAKON-DEMO — Beakon Demo Client |
| Vendor | SUNRISE — Sunrise LLC |
| Invoice number | 1618828187 |
| Invoice date | 06.05.2026 |
| Due date | 06.06.2026 |
| Currency | CHF |
| Invoice total | CHF 201.80 |
| JE total | CHF 201.80 |
| Difference | CHF 0.00, green if reconciled, red if not reconciled |
| Confidence | Needs review / Matched / New pattern |

## 5. AI review summary

Suggested AI Review Summary:

- Recurring Sunrise telecom invoice detected.
- VAT declaration found: net CHF 191.32, VAT CHF 10.48, gross CHF 201.80.
- Possible duplicate line detected: device instalment appears included in mobile total.
- Dimensions incomplete on 1 line.

Two clear actions: **Teach Beakon** and **View source invoice**.

## 6. Document details section

| Field | Example / Purpose |
|---|---|
| Description | Mobile and fixed network telecommunications services for May 2026. |
| Service period | 01.05.2026 – 31.05.2026; important for accruals and cut-off. |
| Payment terms | 30 days. |
| Posting period | May 2026; controls GL period. |
| Approval owner | Thomas; responsible approver. |
| Vendor rule applied | Sunrise monthly telecom rule; indicates if a prior approved rule was used. |

## 7. Journal entry lines — required columns

The JE line table is the core of the redesigned screen. Dimensions should be **first-class fields**, not hidden in advanced settings.

| Column | Purpose |
|---|---|
| Dr/Cr | Shows whether the line is a debit or credit. |
| Account | GL account. |
| Description | Line-level description extracted or entered by user. |
| Net amount | Amount excluding VAT. |
| VAT code | VAT treatment, such as CH input VAT 8.1% or mixed. |
| VAT amount | Input/output VAT. |
| Gross amount | Total including VAT. |
| Cost centre | Department, team, office or operating area. |
| Project / mandate | Client, mandate, project, property, trust or family-office activity. |
| Recharge / allocation | Whether the cost should be recharged, split or absorbed. |
| Period | Service period / posting period / accrual period. |
| Confidence | AI confidence per line. |
| Status | Matched, needs review, duplicate, do not post, dimension missing. |
| Actions | Edit, split, remove, explain, view source. |

## 8. Example JE lines for the Sunrise invoice

| Dr/Cr | Account | Description | Net | VAT code | VAT | Gross | Cost centre | Project | Recharge | Period | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Dr | Telecom expense | Mobile services (two accounts) | 127.38 | Mixed / summary | 10.32 | 137.70 | Admin | General operations | Review split | May 2026 | Needs review |
| Dr | Internet & fixed line expense | Fixed network and Internet | 59.30 | CH input VAT 8.1% | 4.80 | 64.10 | Office | General operations | None | May 2026 | Matched |
| Dr | Device instalment | Duplicate detected — included in mobile total | 41.90 | n/a | 0.00 | 41.90 | — | — | Absorbed | May 2026 | Duplicate / do not post |

**Important control:** the duplicate line should remain visible for transparency, but it should be marked as **absorbed / do not post** and **excluded from the posting preview**.

## 9. Dimensions that Beakon should support

| Dimension | Why it matters |
|---|---|
| Entity | AFO, G2, Villa Vermont, trust, foundation or other paying/owning entity. |
| Cost centre | Admin, office, investment, legal, family office, property, operations. |
| Project / mandate | Specific client, mandate, property, family-office activity or project. |
| Recharge entity | Identifies whether a cost should be passed to G2, Villa Vermont, another entity or a beneficiary. |
| Recharge percentage / allocation | Allows 100%, partial or split allocation. |
| Property | Useful for property-specific costs such as Villa Vermont or hotel projects. |
| Beneficiary / family member | Useful where personal or family costs need attribution. |
| VAT recoverability | Some costs may be fully, partially or non-recoverable. |
| Service period | Needed for accruals, prepayments and monthly close. |
| Approval owner | Who is responsible for approving the JE. |
| Intercompany counterparty | Needed if the entry creates a recharge or intercompany balance. |
| Vendor rule | Tracks whether a prior approved rule was applied. |

## 10. Right-side contextual panel

Tabbed:

| Tab | Purpose |
|---|---|
| AI reasoning | Explains why Beakon selected the accounts, VAT treatment, period and dimensions. |
| Prior postings | Shows similar invoices and how they were posted previously. |
| Teach Beakon | Allows the user to correct the draft and store a reusable accounting rule. |
| Audit trail | Shows extraction, edits, approvals, posting and rule creation history. |

## 11. Teach Beakon workflow

| Part | Recommended content |
|---|---|
| What needs attention | Duplicate line detected; VAT treatment verified; recharge allocation missing; cost centre confirmed. |
| Dimension details | Cost centre, project / mandate, recharge entity, property / beneficiary, approval owner. |
| Future rule | For Sunrise invoices, use the VAT declaration to split net expense and input VAT. Do not post device instalments separately when already included in the mobile total. Require review if recharge allocation is missing. |
| Apply future rule checkbox | Apply rule to future Sunrise invoices. |
| Scope | Customer number 1000779477, vendor Sunrise LLC, recurring telecom invoices. |

## 12. Posting preview and reconciliation controls

Before the user posts or submits for approval, the screen should show the actual debit/credit accounting entry. **This is the final control layer.**

| Account | Debit CHF | Credit CHF |
|---|---:|---:|
| Telecom / internet expense | 191.32 | — |
| Input VAT | 10.48 | — |
| Accounts payable — Sunrise | — | 201.80 |
| **Total** | **201.80** | **201.80** |

- Balanced
- Invoice reconciled
- VAT reconciled
- 1 dimension needs review

## 13. Footer actions

| Button | Purpose |
|---|---|
| Save draft | Save without approval or posting. |
| Submit for approval | Send to the approval owner or workflow. |
| Cancel | Exit without saving changes. |
| Approve & post | Post only if required checks pass or if override permission exists. |

## 14. Recommended status pills and warnings

| Status label | Meaning |
|---|---|
| Matched | Vendor, account, VAT or dimension matched confidently. |
| Needs review | AI is uncertain or a required dimension is incomplete. |
| Duplicate detected | Potential duplicate or absorbed line found. |
| Do not post | Line is shown for transparency but excluded from the JE. |
| Rule applied | Beakon applied a prior approved rule. |
| New pattern | No prior example found. |
| Dimension missing | Cost centre, project, recharge or other required dimension is missing. |
| Balanced | Debit total equals credit total. |
| Reconciled | JE total equals invoice total and VAT total reconciles. |

## 15. Implementation notes for Monirul

- Treat dimensions as **structured fields** on each JE line, not as free-text comments.
- Make required dimensions **configurable by client, entity, account and vendor.**
- **Block posting** or require override when JE total ≠ invoice total, debits ≠ credits, or required dimensions missing.
- Store Teach Beakon corrections as **structured rules** with scope: vendor, customer number, invoice pattern, GL mapping, VAT treatment, dimensions, recharge logic and approval status.
- Distinguish between **one-time corrections** and **reusable rules**. Users should be able to choose "Fix this draft only" or "Apply rule to future invoices".
- Keep duplicate / absorbed lines **visible for auditability** but **excluded from the posting preview** and payable total.
- Use prior postings as evidence. The user should be able to see how similar invoices were handled before approving a draft.
- Maintain a **full audit trail**: original AI extraction, user edits, rule applied, approval owner, approval timestamp and posting timestamp.

## 16. Suggested MVP scope

| MVP item | Priority |
|---|---|
| Header totals: invoice total, JE total, difference | **Must have** |
| Line-level dimensions: cost centre, project / mandate, recharge / allocation, period | **Must have** |
| Posting preview with debit/credit totals | **Must have** |
| Validation checks: balanced, invoice reconciled, VAT reconciled, dimensions complete | **Must have** |
| Teach Beakon structured correction panel | **Must have** |
| Prior postings tab | Should have |
| Audit trail tab | Should have |
| Configurable client-specific required dimensions | **Must have** |
| Rule scope by vendor / customer number / invoice pattern | **Must have** |

## 17. Summary

The revised JE screen should turn Beakon into a true accounting review cockpit. The user should be able to validate the invoice, review AI reasoning, correct the JE, complete dimensions, confirm recharges, see the final debit/credit posting, approve or submit the entry, and teach Beakon how to handle similar invoices in future. This is the difference between a document extraction tool and an accounting automation system.

---

# Monirul's reading — what's answered, what's new, what's still open

## Answered from earlier FAQ

| FAQ Q | Resolution in this spec |
|---|---|
| A.1 policy scope | §15 — configurable by **client + entity + account + vendor**. Four-axis scope, not class-only. |
| A.2 policy fields | §9 dimension list + §14 status pills define the surface. |
| A.4 who edits | §15 "client-specific" → per-client config (client controller, not Beakon admin only). |
| B.2 dim-status values | §14 — taxonomy expands to Matched / Needs review / Duplicate / Do not post / Rule applied / New pattern / Dimension missing / Balanced / Reconciled. |
| B.3 "Review split" | §8 confirmed — yellow state for AI-uncertain split. |
| C.3 prior-postings similarity | §11 — **vendor + customer number + invoice pattern**. |
| D.1 approver scope | §6 / §13 — per-JE approval owner; per-line approval is not in scope. |
| D.3 audit trail content | §15 — extraction, edits, rule applied, approval owner + timestamp, posting timestamp. |
| E.1 Mixed/summary VAT | §8 — real VAT label when sublines have different rates; VAT amount still computed. |
| E.2 "Apply once vs teach" | §15 — explicit "Fix this draft only" / "Apply rule to future invoices". |
| F.1 build order | §16 MVP table — Must Have / Should Have, decided. |

## New requirements I missed in the FAQ

1. **Duplicate-line state (§8, §15).** Lines can be flagged "Duplicate / do not post" — kept visible for audit, excluded from posting preview and payable total. This needs a per-line `posting_excluded` flag and a separate "posting preview" computation that filters them out.
2. **Posting preview as a dedicated panel (§12).** Distinct from the editable lines table. Shows the actual DR/CR that will hit GL.
3. **Net / VAT / Gross as three columns (§7).** Today we have one `amount` per line. The model needs to expose net, VAT, gross separately on each line.
4. **Hard blocking controls (§15).** Block posting (or require override) when JE ≠ invoice, DR ≠ CR, required dimensions missing. "Override permission" is a new role / permission concept.
5. **Service period vs Posting period (§6).** Two date concepts on the JE header — service period drives accruals; posting period drives GL period. Today we conflate them.
6. **Four-button footer (§13).** Save draft / Submit for approval / Cancel / Approve & post. The state machine endpoints map cleanly but the buttons + permissions need wiring.
7. **Confidence at the header (§4).** "Needs review / Matched / New pattern" as a high-level invoice-level state, on top of per-line confidence.
8. **Rule scope expanded (§11).** Vendor + customer number + invoice pattern — not vendor alone.
9. **AI Review Summary block (§5).** Free-text findings list distinct from per-line status. Today we don't have this surface.
10. **Recharge percentage / allocation as a structured dimension (§9).** Not just a free-text "Review split" label — splits, percentages, "absorbed" all need to be modelled.

## Still open (didn't see an answer)

| Q | Why it matters |
|---|---|
| A.3 — Conditional rule language (hardcoded list vs JSON expression) | Affects how flexible "Required if recharge_allocation = …" can be. |
| B.1 — Per-line AI confidence source (AI-returned vs computed vs hybrid) | OCR prompt change vs backend logic. |
| C.1 — Rule versioning (mint new version vs in-place update) | Audit-trail implication for RSM. |
| C.4 — Suggested changes provenance | What populates the "2 suggestions" item. |
| D.2 — "Beakon AI" vs "Alex AI" attribution | Single field or multi-agent log. |
| E.3 — Re-analyze button behavior | OCR-only / proposal-only / both. |
| E.4 — Source-doc page-role labels (Invoice summary / VAT / Products) | OCR side-output vs user-driven. |
| F.2 — Hard deadline | Association go-live? RSM kick-off? Demo date? |

---

# Build sequencing — proposed based on §16 MVP priorities

| Slice | Scope | Why first |
|---|---|---|
| **1 — Data model + posting controls** | Per-line net/VAT/gross columns; `posting_excluded` flag; service-period vs posting-period split; reconciliation engine (JE ≠ invoice, DR ≠ CR); Posting preview panel; blocking controls on Submit / Approve & post | All Must-Haves that don't need UI redesign first; turns the engine into a real posting cockpit |
| **2 — Dimensions as columns** | Cost centre / Project / Recharge / Allocation as table columns; client-configurable required dimensions; per-line dim-status pill | Visible to user, requires (1) |
| **3 — Teach Beakon structured panel + rule scope** | Structured correction panel; rule scope = vendor + customer number + invoice pattern; "Fix this draft only" vs "Apply to future invoices" | Closes the RSM loop on rule traceability |
| **4 — Right-rail tabs** | AI reasoning · Prior postings · Audit trail · Teach Beakon refactored into the tabbed rail | Should-haves per §16; lifts (3) into the new shape |
| **5 — AI review summary + header confidence pill** | Findings list (§5); invoice-level Matched / Needs review / New pattern | Polish, depends on confidence model |

Slice 1 is the load-bearing one. Until net/VAT/gross are separate columns and the posting preview is real, we can't block on reconciliation honestly.
