# Beakon install updates

Each time a new feature, integration, or significant change ships into
Beakon, we drop a short document here describing **what installed, why,
and what the admin/user has to do** to start using it.

These are not release notes for a marketplace — they are operational
documents. The audience is two people:

- **The operator** (Monirul / future ops) — needs to know the migration,
  cron, env vars, and verification steps.
- **The principal** (Thomas) — needs the one-paragraph "what is this and
  why does it exist" so he can sign off and tell the story.

## How to add one

1. Copy `_TEMPLATE.md` to a new file named
   `YYYY-MM-DD-<slug>.md` (date = the day the change becomes available
   in the running system, slug = short kebab-case feature name).
2. Fill every section. If a section doesn't apply, write "n/a — <one
   sentence why>" rather than deleting it. Empty sections are a smell.
3. Add a line to the **Index** below.
4. Commit alongside the code change so the doc lands in the same PR.

## Index

| Date       | Component | Title                                      | Doc |
|------------|-----------|--------------------------------------------|-----|
| 2026-05-10 | FX        | ECB foreign-exchange reference-rate sync   | [2026-05-10-ecb-fx-rates.md](2026-05-10-ecb-fx-rates.md) |
| 2026-05-10 | Banking   | Custodian feed pilot — Avaloq SFTP zip ingest | [2026-05-10-custodian-feed-pilot.md](2026-05-10-custodian-feed-pilot.md) (+ [demo runbook](2026-05-10-custodian-feed-DEMO-RUNBOOK.md)) |
| 2026-05-10 | Commercial | Commercial funnel — pricing → register → setup → trial → activate | [demo runbook](2026-05-10-commercial-funnel-DEMO-RUNBOOK.md) |
| 2026-05-15 | Banking   | Avaloq SFTP feed — operations runbook (live cutover) | [2026-05-15-avaloq-operations.md](2026-05-15-avaloq-operations.md) |
