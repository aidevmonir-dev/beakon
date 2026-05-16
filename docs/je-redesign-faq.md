# Journal Entry page redesign — FAQ for Thomas

**Subject:** Sunrise / Revised journal entry mock (2026-06-02 draft)
**From:** Monirul
**Date:** 2026-05-16
**Purpose:** Confirm the design decisions baked into the mock so we can build with confidence and not loop. Each question has options; pick one or write yours. Where I have a recommendation, it's marked.

---

## 0. What we believe the mock is saying

Before the questions, here's our reading of the design — please correct anything wrong:

- The JE detail page is reorganised into **four panels**: header (source-doc facts), status (3 cards), lines + dimensions table, and a right rail with 4 tabs (AI reasoning · Prior postings · Correct/Teach · Audit trail).
- **Dimensions move from chips to real table columns.** Each line gets Cost centre, Project/Mandate, Recharge/Allocation visible inline.
- **A dimension-policy engine** decides per account which dimensions are Required / Recommended / Optional / Conditionally-required, and shows the result as colour-coded badges. The policy text is human-readable and quotable in the right rail.
- **Posting checks** (balanced, invoice total, VAT, dimensions) are surfaced as a card — these become RSM workpaper-ready evidence.
- **LearningRule is now versioned** ("Sunrise monthly telecom rule v2.1") and shown explicitly under "Rule applied".
- **AI confidence becomes per-line**, not just overall.
- **Correct/Teach** is a tab in the right rail, not a separate modal, and the action splits into "Apply to this JE only" vs "Apply & teach Beakon".

If any of the above is wrong, the rest of this doc is wrong too — please flag.

---

## A. Dimension policy engine

This is the biggest backend addition. Without it, the badge colours and conditional rules in the mock can't work.

### A.1 — Policy scope: per account or per account class?

How granular is the policy?

- **Option 1 — Per individual account.** Account 6220 has its own rule; 6221 has its own. Most flexible, most rows.
- **Option 2 — Per account class / category.** All telecom-expense accounts share one rule, all rent accounts share another. Easier to maintain, less granular.
- **Option 3 — Per account class, with per-account override.** Class-level default, individual accounts can override. *Recommended.*

### A.2 — Policy fields per dimension

For each (account, dimension) pair the policy needs to say:

- Status: `Required` · `Recommended` · `Optional` · `Not applicable`
- Conditional trigger (e.g. "Required if Recharge/Allocation is set")
- Default value (optional)
- Explanation text shown on hover

Is this the full set, or are we missing a field?

### A.3 — Conditional rules

The mock shows: "Recharge entity required because allocation = Review split". This implies a small rule language.

- **Option 1 — Hardcoded conditions** (a fixed list: "if allocation set", "if intercompany", "if VAT recoverable"). Cheap, limited.
- **Option 2 — Expression-based** (e.g. JSON like `{"if": {"recharge_allocation": "any"}, "then": "required"}`). Flexible, more UI work.
- **Option 3 — Start hardcoded; promote to expression-based when we hit the 5th condition.** *Recommended.*

### A.4 — Who edits the policy?

- Beakon admin only?
- Per-entity, the entity's controller can edit?
- Read-only and the policy ships with the CoA template?

This matters for the association CoA when it arrives.

---

## B. Per-line AI confidence and dimension status

### B.1 — Where does per-line confidence come from?

The mock shows different confidence per line (78 / 90 / 95 / 95). Options:

- **From the OCR/extraction model** — we ask the AI to return confidence per line.
- **Computed by us** — based on how many policy fields are filled, account match quality, vendor history match.
- **Hybrid** — AI returns extraction confidence; we adjust based on policy completion. *Recommended.*

### B.2 — "Dim. status" column values

The mock shows: `Complete` · `Missing required` · `Not required`. Should we also have `Missing recommended` (yellow), or fold it into `Complete`?

### B.3 — "Review split" yellow state

When does a line enter "Review split"? Our reading:

- AI detected the line might span multiple recharge allocations and isn't sure how to split.
- Different from "Missing required" — the field has a *proposed* value but needs user sign-off.

Confirm or correct?

---

## C. LearningRule, RuleApplied, prior postings

### C.1 — Rule versioning

"Sunrise monthly telecom rule v2.1" implies versioned rules.

- **Option 1 — Edit mints a new version, old versions retained.** Audit-friendly. *Recommended given RSM.*
- **Option 2 — In-place update, no history.** Simpler.
- **Option 3 — Edits create new versions; minor / cosmetic edits don't.** Hybrid.

### C.2 — What gets logged when a rule is applied to a JE?

Today we have `LearningRule`. The mock implies a `RuleApplied` log: rule id, version, JE id, applied at, applied by (AI/user), confidence. Confirm the shape.

### C.3 — Prior postings — similarity definition

"Prior postings (11 similar invoices)" — what makes them similar?

- Same vendor?
- Same vendor + similar amount band?
- Same vendor + same invoice pattern (line structure)?
- Same vendor + same recurring schedule?

This affects retrieval quality. *Recommended: vendor + invoice-pattern match, ordered by recency.*

### C.4 — Suggested changes — where do they come from?

"2 suggestions" in the right rail — are they:

- Differences between AI draft and current state of the rule?
- Differences between this JE and prior postings for the same rule?
- Both, deduplicated?

---

## D. Audit trail and approval

### D.1 — Per-line approver vs per-JE approver

The mock shows "Approval owner: Thomas Meyer" inside the dimension panel for a single line. Is this:

- A per-line approver (more granular state machine)?
- A per-JE approver, surfaced in the dimension panel for context only?
- A per-account-policy approver routing (this account always requires Thomas)?

*Recommended: per-JE approver field, displayed inside dimensions for visibility; per-line approval is too much for v1.*

### D.2 — "Created by Beakon AI" vs "Created by Alex AI"

The header says "Created by Beakon AI"; the footer says "Created by Alex AI". Two questions:

- Are we tracking which AI agent (Beakon vs Alex) authored the draft?
- Or is one "system" and the other "the specific run"?

Need a glossary for the audit log.

### D.3 — Audit trail tab — content

What goes on the Audit trail tab?

- Every state transition (draft → pending → approved → posted)?
- Every line edit (before/after values)?
- Every dimension edit?
- Every rule application?
- All of the above?

*Recommended: all of the above, filtered by category.*

---

## E. UI / information architecture

### E.1 — Mixed / summary VAT code

Lines 1 and 2 show VAT code "Mixed / summary". Is this:

- A real `tax_code` value used when sublines have different VAT?
- A *displayed* label when the line is a roll-up of sub-VAT-amounts?
- A signal that the user needs to split the line?

### E.2 — "Apply same to similar lines" vs "Apply & teach Beakon"

Two buttons that sound similar:

- "Apply same to similar lines" — apply this dimension set to other lines in *this* JE.
- "Apply & teach Beakon" — save the rule so it applies to *future* JEs.

Confirm scope of each.

### E.3 — Re-analyze button

What does Re-analyze do?

- Re-run OCR on the source file?
- Re-run AI proposal using the current rule set?
- Both?

### E.4 — Source evidence card — page-level deep links

"Invoice summary page · VAT declaration page · Product / services page" — each links to a specific page of the source PDF. We don't extract these today.

- Should the OCR pipeline mark page roles (summary / VAT / line items / appendix)?
- Or do we just split the PDF into pages and let the user pick?

*Recommended: OCR labels pages as a side-output; we render the labels we got.*

---

## F. Build order and sequencing

The redesign is roughly a 3–4 week build. We want to ship in slices that each give RSM something to look at.

### F.1 — Proposed slice order

1. **Week 1 — Backbone:** Dimension policy model + per-line dimension columns + posting checks card. Visible RSM artefact: posting checks show every JE balances and reconciles.
2. **Week 2 — Right rail tabs:** AI reasoning · Prior postings · Correct/Teach refactor · Audit trail. Visible RSM artefact: audit trail.
3. **Week 3 — Intelligence:** Per-line confidence, rule versioning, "Apply same to similar lines" / "Apply & teach Beakon" split, suggested changes.
4. **Week 4 — Polish + page-level evidence:** Source-evidence card with page-role labels, Re-analyze, dim-status badges with conditional reasons.

Is this the right order? Anything you'd front-load or defer?

### F.2 — What's the hard deadline?

Is this gated by:

- The association client go-live?
- The RSM audit kick-off?
- A demo date?
- No hard date — ship when ready?

---

## G. Out of scope check

Things in the mock we are *not* planning to build yet — please confirm:

- Multi-AI-agent attribution ("Beakon AI" vs "Alex AI") beyond a single `created_by_agent` string field.
- Real-time collaborative editing (two users on the same JE).
- AI auto-posting (right now everything stops at "Post journal entry" being a human click).
- Cross-entity recharge auto-mirror (intercompany legs auto-created in the counterparty entity) — this is in the Transaction Types roadmap, not this redesign.

If any of these *should* be in scope, please flag.

---

## How to respond

You can mark up this doc inline, send a voice note answering by section letter (A.1, A.2…), or just write the section letters with one-line answers. Whatever's fastest.

Once we have A through F locked, I'll send back: data-model diff, API surface, and slice 1 PR plan.
