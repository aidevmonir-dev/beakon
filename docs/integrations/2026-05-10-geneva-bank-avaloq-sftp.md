# Geneva private bank — Avaloq daily SFTP feed

| Field         | Value |
|---------------|-------|
| Date          | 2026-05-10 |
| Counterparty  | Geneva-based private bank (Avaloq-hosted) |
| Status        | **Spec** — awaiting kick-off with bank IT |
| Owner         | Monirul (technical) / Thomas (relationship) |
| Target pilot  | First Beakon private clients with investments at this bank |

> **2026-05-15 update — infrastructure direction has changed.** Section
> 3.1 below recommended a Swiss self-hosted VPS. Thomas's
> 2026-05-15 directive routes the entire Beakon deployment, including
> the Avaloq SFTP receiver, to **AWS Transfer Family in
> `eu-central-2` (Zurich)**. See
> [`ops/avaloq/aws-setup.md`](../../ops/avaloq/aws-setup.md) for the
> AWS provisioning steps and
> [`docs/install_updates/2026-05-15-avaloq-operations.md`](../install_updates/2026-05-15-avaloq-operations.md)
> for the updated operational runbook. Section 3.1 is preserved
> below as the *split-deployment fallback* (still viable if a future
> bank refuses to push to AWS infra); sections 3.2, 3.3, and 4
> onwards remain authoritative for the AWS path as well.

---

## 1. What the bank is offering

The bank runs on **Avaloq** (the Swiss banking platform). It can
deliver a **daily SFTP push** of five files in a single zip archive
to a server we provide.

### The five files (per zip, daily)

| File              | French label                                  | English meaning                              |
|-------------------|-----------------------------------------------|----------------------------------------------|
| `XXX_cash`        | Mouvements cash de la veille                  | Yesterday's cash movements                   |
| `XXX_securities`  | Mouvements titre de la veille                 | Yesterday's securities (trade) movements     |
| `XXX_orderbook`   | Ordres en cours                               | Open orders                                  |
| `XXX_positions`   | Détail des positions (niveau container)       | Position snapshot at container level         |
| `XXX_perf`        | Détail des performances (niveau container)    | Performance snapshot at container level      |

`XXX` is a per-client / per-portfolio prefix — to be confirmed with
the bank. "Container" appears to be Avaloq terminology for a
portfolio / custody account.

### Delivery characteristics

- **Direction:** **bank → us** (push). They drop, we receive. No
  outbound API calls from Beakon.
- **Protocol:** **SFTP only**. *FTPS is explicitly not accepted.*
- **Cadence:** daily, files arrive **before 07:00 CET**. They warn
  some specific days the file generation may be delayed (likely
  bank holidays / system maintenance).
- **Source IPs they will connect from** (firewall allowlist on our
  side):
  - VIP: `194.38.173.2`
  - Physical 1: `194.38.173.1`
  - Physical 2: `194.38.173.3`

## 2. What we have to provide them

The screenshot includes a table the bank wants us to fill in. They
expect us to host (or commission) the SFTP server.

| Field they need        | Our value (TBD) | Notes |
|------------------------|-----------------|-------|
| Adresse IP ou nom DNS  | _to decide_     | Public DNS preferred over a bare IP for portability |
| Adresse IP back-up (optional) | _to decide_ | If we run HA or a fallback host |
| User                   | _to decide_     | Suggest `avaloq-<bank-code>` so per-bank accounts are obvious |
| Mot de passe           | _separate channel_ | Bank explicitly says transmit separately. **Strongly prefer SSH key auth — they offer this as an option.** |
| Répertoire (directory) | _to decide_     | Suggest `/incoming/` chrooted to the user's home |
| Port                   | `22` (default)  | Confirm if their egress allows non-standard ports |

## 3. What Beakon needs to do

Three layers — infra, application, operations.

### 3.1 Infrastructure

We need a **publicly reachable SFTP endpoint** locked down to the
three bank IPs. Choices:

1. **Self-hosted on the production server** (Swiss VPS — Hetzner,
   Infomaniak, Exoscale). Cheapest. We own the firewall, key
   rotation, audit logs.
2. **Managed SFTP service** (AWS Transfer Family, Azure Blob SFTP).
   Faster to stand up, but data leaves Switzerland — conflicts with
   the Swiss-hosted mandate in the architecture document. **Not
   recommended.**
3. **Dedicated bastion** in front of Beakon's app server. The drop
   directory is on the bastion; Beakon reads it over an internal
   network mount.

**Recommendation: option 1**, self-hosted on a small Swiss VPS, with
a hardened SSH/SFTP daemon, chrooted per-bank user, IP allowlist,
SSH key auth (no passwords), and fail2ban on the public port.

Operational requirements regardless of host:

- **IP allowlist:** only the three bank IPs reach port 22.
- **Per-bank user account** with chrooted home and write-only
  permission on `/incoming/`, read-only elsewhere. Compromise of
  one bank's credentials cannot leak another's.
- **SSH key auth** preferred. The bank screenshot mentions this is
  acceptable to them. Generate a dedicated keypair per bank, hand
  the public key to their IT.
- **Storage:** at least 30 days of raw zips retained for audit and
  re-ingest. Daily file size unknown — assume 1–10 MB until we see
  real samples.
- **Monitoring:** an alert if no zip arrives by 08:00 CET on a
  business day. Late or missing files are a relationship issue
  worth catching same-day.
- **Backup:** zips are accounting source documents — back them up
  to encrypted offsite storage with the same Swiss-residency
  guarantees.

### 3.2 Application (Beakon code)

Today Beakon already has:

- `FeedImport` model (`beakon_banking/models.py`) — audit row per
  ingestion of a bank feed. Already used by manual statement uploads.
- `BankTransaction` — cash movement rows. Natural target for the
  `XXX_cash` file.
- `TaxLot` — lot-level holdings.
- `Portfolio`, `Custodian` master tables (added in commit `111de0f`).
- `AIBankStatementImportService` — Claude-driven extractor for ad-hoc
  uploads. Useful for ad-hoc PDFs but **not** the right path for a
  structured daily feed where we own the schema.

**What we need to build:**

| Piece | Description |
|-------|-------------|
| **SFTP watcher** | Scheduled job (every 15 min during business hours) that polls `/incoming/` for new zips, claims a lock per file, verifies size is stable, and enqueues an ingest task. |
| **Ingest task** | Unzip into a temp directory; map each of the 5 files to the right parser; record one `FeedImport` row per zip with status `received → parsed → reconciled / failed`. |
| **Cash parser** | `XXX_cash` → `BankTransaction` rows via the existing dedup pipeline (`_dedup_key`). Already 80% in place. |
| **Securities-trade parser** | `XXX_securities` → portfolio trade rows. *New* — we may need a `PortfolioTrade` model (or extend an existing one) keyed on (portfolio, trade date, ISIN, side). |
| **Positions parser** | `XXX_positions` → snapshot table. Use it to **reconcile** Beakon's running TaxLot balance vs. the bank's truth. Disagreements raise a break for review. |
| **Performance parser** | `XXX_perf` → performance snapshot table. *New* model — daily P&L per container, basis for portfolio reports. |
| **Orderbook parser** | `XXX_orderbook` → open-orders table. *New* model. Lower priority — orderbook is informational, not bookkeeping. |
| **Idempotency key** | `(bank_code, business_date, file_type, sha256(payload))`. Re-ingesting the same file is a no-op. |
| **UI surface** | Bank-feed status page: last zip received, per-file row counts, parse errors, reconciliation breaks per portfolio. |

**Format question — biggest unknown.** The screenshot does not say
whether the files are CSV, fixed-width, XML, or one of Avaloq's
proprietary formats (`.adv` / `.txt` per Avaloq spec). We **must**
get sample files before writing parsers. Avaloq feeds tend to be
delimited text with bank-specific column sets, so each bank we
onboard needs its own column mapping even if they all run Avaloq.

### 3.3 Operations

- A runbook for "what to do when the file is late" — escalation
  contact at the bank, retention of the previous day's data, and how
  Beakon behaves when a day is missing (no auto-fill, mark the day
  as un-reconciled).
- A re-ingest CLI: `manage.py ingest_avaloq_zip <file>` for
  same-day re-runs after a bug fix, gated on the idempotency key.
- A second pair of eyes (four-eyes flag is already in the engine)
  before any ingested cash movement posts a journal entry. The
  feed is **proposal**, not auto-posting, until pilot data proves
  parser reliability.

## 4. Open questions for the bank's IT call

Bring these to the kick-off meeting. Each one blocks a parser.

### File format and schema

1. What format are the five files inside the zip — CSV, fixed-width,
   XML, JSON, Avaloq native?
2. Can they share a **sample zip** (with anonymised data is fine) so
   we can develop against real bytes?
3. Schema / column definitions for each file. Is there a published
   spec, or do they generate per-bank?
4. Encoding (UTF-8, Latin-1, Windows-1252)?
5. Decimal separator (comma or dot)? Date format (DD.MM.YYYY,
   YYYY-MM-DD)?

### Identifiers

6. What does the `XXX` prefix represent — bank-side client number,
   container ID, or our entity code? Will it be stable per portfolio
   for the lifetime of the relationship?
7. How are securities identified — ISIN, Telekurs Valoren, both?
8. Do containers map 1:1 to portfolios, or can a container hold
   sub-portfolios?

### Semantics

9. Is `XXX_positions` a **full snapshot** every day, or **deltas**?
10. Performance — what time period(s) are reported daily? MTD, YTD,
    inception, custom benchmark?
11. Cash movements — are FX trades reported as one row or as a
    debit + credit pair?
12. Are corrections / re-broadcasts emitted as a *replacement* file
    or as an additional row with a reversal sign?
13. How are bank holidays handled — empty file, no file at all, or
    file with prior business-day data?
14. Time zone of timestamps inside the file (CET assumed, confirm).

### Operations

15. Maximum expected file size and growth profile (capacity
    planning)?
16. Will we get one feed per portfolio or one consolidated feed per
    relationship?
17. SLA on file delivery — are they on the hook for being late?
18. What's the change-management process if Avaloq ships a schema
    change on their side?
19. Can they accept SSH key auth (their note hints yes — confirm)?
20. Do they have a non-prod / UAT endpoint we can test against
    before going live?

## 5. Decisions for Thomas

These are the calls only you can make:

- **Where do we host the SFTP endpoint?** (Recommend Swiss self-host.)
- **Who pays for it?** Bank fees vs. Beakon-borne infrastructure.
- **Pilot scope** — one client / one portfolio first, or all at
  once? Recommend one container, one full month, before broadening.
- **Auto-post vs. propose-and-approve** — the engine supports both.
  Recommend propose-and-approve until the parser has been clean for
  one full month.
- **Onboarding playbook** — every new client at this bank requires
  a per-container `XXX` prefix to be wired in. Who maintains that
  mapping (Beakon ops or the client)?

## 6. Rough sequencing

Phase ordering is dictated by what unblocks the most value with the
least guesswork.

1. **Stand up SFTP infrastructure** (Swiss VPS, hardened, IP
   allowlisted). Independent of any schema work.
2. **Receive sample files** from the bank. *Everything below is
   blocked until this happens.*
3. **Cash parser** — leverages existing `BankTransaction` /
   `FeedImport` plumbing. Smallest delta.
4. **Positions parser** — second priority because it's the
   reconciliation anchor. Even before securities trades are parsed,
   a daily position snapshot lets us catch drift.
5. **Securities-trade parser** — needed before we can fully
   automate portfolio bookkeeping.
6. **Performance parser** — feeds the reporting layer; not on the
   bookkeeping critical path.
7. **Orderbook parser** — last; informational only.

Each phase produces an entry in `docs/install_updates/` when it
ships.

## 7. Next steps

- [ ] **This week:** approve hosting choice (Swiss self-host
      recommended) and provision the VPS.
- [ ] **Before the bank IT call:** circulate the open-questions
      list (section 4) so the meeting is efficient.
- [ ] **At the bank IT call:** request sample files, get schema
      docs, confirm SSH-key auth, agree on test/UAT endpoint.
- [ ] **After the call:** convert this Spec into the first
      install-update doc once cash parser is live.

## 8. References

- Source screenshot from Thomas: Avaloq SFTP setup brief from a
  Geneva private bank (2026-05-10).
- Beakon Architecture (2026-04-30), layer 3: ingestion / external
  data; layer 5: multi-dimensional posting.
- `beakon_banking/models.py::FeedImport` — existing audit primitive.
- `beakon_banking/services/ai_statement_import.py` — ad-hoc
  statement importer (different shape; useful as reference, not the
  path we'll use here).
- `beakon_core/models/masters.py::Portfolio`, `Custodian`, `TaxLot`
  — masters this feed will populate / reconcile against.
