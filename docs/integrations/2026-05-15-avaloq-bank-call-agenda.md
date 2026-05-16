# Pre-call agenda — Avaloq SFTP feed kick-off

| Field | Value |
|-------|-------|
| Date | 2026-05-15 (drafted) |
| Audience | Geneva private bank — Avaloq integration / IT team |
| Sender | Thomas Allina, Beakon |
| Format | Email Thomas can send 24–48 h before the kick-off call |

This document is **mailable as-is**. Section 1 is the email body; the
table in section 2 is the agenda Thomas reads from during the call.

---

## 1. Email body

> Subject: **Avaloq SFTP feed — agenda + open questions ahead of our kick-off**
>
> Dear [Contact],
>
> Thank you for offering the daily Avaloq SFTP feed. We're keen to be
> ready on the call so you don't have to chase us for answers later.
>
> Below is the agenda we'd like to cover. To make the meeting efficient,
> please feel free to forward this to whoever on your side owns the
> file schema and the SFTP setup — they may want to bring sample data.
>
> **From our side we will bring to the call:**
>
> 1. The hostname of our SFTP endpoint — an AWS Transfer Family
>    server hosted in AWS Zurich (`eu-central-2`), IP-allowlisted at
>    the Security Group level to the three source IPs you provided.
>    Format: `s-<id>.server.transfer.eu-central-2.amazonaws.com`
>    (or a CNAME under `beakon.ch` if preferred).
> 2. A request that **you** generate the SSH key pair on your side
>    and send us the public key — we install it directly on the
>    Transfer Family user, no key material leaves your environment.
> 3. Confirmation that we have allowlisted `194.38.173.1`, `.2`, and
>    `.3` in our Security Group (the only way through to the SFTP
>    endpoint — defense in depth at the AWS network layer).
> 4. A test schedule — we'd like one or two pilot zips before we
>    cut over to the production address.
>
> **What we'd like to understand on the call** is in the table below.
> Each question blocks a piece of code on our side, so please be candid
> about anything you don't know yet — "we'll have to check" is a useful
> answer.
>
> Best regards,
> Thomas Allina

---

## 2. Agenda — what we need from the bank

### A. File format and schema (highest priority — blocks every parser)

| # | Question | Why it matters |
|---|----------|----------------|
| 1 | What format are the five files inside the zip — CSV, fixed-width, XML, JSON, Avaloq native? | Picks the parser library on our side. |
| 2 | Could you share a **sample zip** (anonymised is fine) before or at the call? | We can develop against real bytes immediately. |
| 3 | Is there a published schema / column definition for each file, or is it generated per-bank? | Tells us whether the parser is reusable across other Avaloq banks. |
| 4 | File encoding — UTF-8, Latin-1, Windows-1252? | One wrong assumption corrupts every French/German character. |
| 5 | Decimal separator (comma or dot) and date format (DD.MM.YYYY, YYYY-MM-DD)? | Swiss banks commonly use comma + DD.MM.YYYY; need to confirm. |

### B. Identifiers

| # | Question | Why it matters |
|---|----------|----------------|
| 6 | What does the `XXX` prefix represent — bank-side client number, container ID, or a code we choose? Is it stable per portfolio for the lifetime of the relationship? | We key the ingest on this. If it changes, history breaks. |
| 7 | How are securities identified — ISIN, Telekurs Valoren, both? | Drives our instrument-master mapping. |
| 8 | Do containers map 1:1 to portfolios, or can a container hold sub-portfolios? | Affects how we slot positions into our portfolio hierarchy. |

### C. Semantics

| # | Question | Why it matters |
|---|----------|----------------|
| 9 | Is the positions file a **full snapshot** every day, or **deltas**? | Determines reconciliation strategy. |
| 10 | What time periods does the performance file cover daily — MTD, YTD, inception, custom? | Sets up our reporting joins. |
| 11 | Are FX trades reported as one row, or as a debit + credit pair? | Avoids double-counting in cash. |
| 12 | Are corrections / re-broadcasts emitted as a *replacement* file, or as an additional row with a reversal sign? | Decides whether we delete + re-ingest or accumulate. |
| 13 | How are bank holidays handled — empty file, no file at all, or file with prior business-day data? | Tells our SLA monitor when to alert vs. when to stay quiet. |
| 14 | Time zone of timestamps inside the file (CET assumed — please confirm)? | Affects daylight-savings boundary handling. |

### D. Operations

| # | Question | Why it matters |
|---|----------|----------------|
| 15 | Maximum expected file size and growth profile? | Capacity planning for the SFTP host. |
| 16 | One feed per portfolio, or one consolidated feed per relationship? | Affects per-bank credential scoping. |
| 17 | Is there an SLA on file delivery — escalation path if late? | Sets our internal SLA alert threshold. |
| 18 | If Avaloq ships a schema change on their side, how is that communicated to you (and to us)? | Need a change-management contact. |
| 19 | Can you accept SSH key authentication (your brief hints yes — please confirm)? | Strongly preferred — passwords for daily feeds are a long-term liability. |
| 20 | Is there a non-prod / UAT endpoint we can test against before going live? | We want to validate without touching client data. |

---

## 3. Decisions Thomas brings *into* the call

These are the calls only Thomas can make. Worth being settled before
the call so the conversation isn't blocked on us:

| Decision | Recommended position |
|----------|----------------------|
| Where do we host the SFTP endpoint? | **AWS Transfer Family, region eu-central-2 (Zurich)** — Thomas decision 2026-05-15. Data sits on AWS infrastructure in Zurich; subject to the US Cloud Act despite Swiss soil. Trade-off accepted for operational simplicity. |
| Who pays for the infra? | Beakon, recovered in client fees. |
| Pilot scope — one container or all? | One container, one full month, then broaden. |
| Auto-post vs. propose-and-approve for posted journal entries? | Propose-and-approve until the parser has been clean for one full month. |
| Onboarding playbook ownership — who maintains the per-container prefix mapping? | Beakon Ops in v1; client takes over once the workflow stabilises. |

---

## 4. After the call — what we expect to walk away with

- [ ] A sample zip (anonymised) for each of the five files.
- [ ] Schema / column docs for each file, or a commitment + date.
- [ ] Confirmation that SSH-key auth is acceptable.
- [ ] A UAT endpoint to test against.
- [ ] A point of contact for schema-change announcements.
- [ ] An agreed go-live date.

If we walk out without items 1, 2, and 3, the technical work on our
side stays paused — we'll spend the gap finalising the Swiss VPS host
and the hardening kit, not writing speculative parsers.
