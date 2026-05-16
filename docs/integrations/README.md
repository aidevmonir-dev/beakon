# Beakon integrations

Specifications and planning documents for **external data integrations**
— banks, custodians, government feeds (ECB, FX), tax authorities,
document providers, etc.

This folder is distinct from `docs/install_updates/`:

- **integrations/** — *forward-looking* specs. Written before or during
  the design of an integration. Captures what the counterparty offers,
  what Beakon needs to build, what we still need to learn, and the
  questions for the kick-off meeting. Status moves from *Spec → Pilot →
  Production*.
- **install_updates/** — *backward-looking* operational records. Written
  the day a feature ships. Documents what was installed, the migration,
  the cron, the rollback path. One document per release moment.

A typical integration produces **one** spec doc here, then **one or
more** install-update docs in the sibling folder as the integration
goes live in stages.

## Index

| Date       | Counterparty / source     | Status | Doc |
|------------|---------------------------|--------|-----|
| 2026-05-10 | Geneva private bank — Avaloq daily SFTP feed | Spec — awaiting kick-off | [2026-05-10-geneva-bank-avaloq-sftp.md](2026-05-10-geneva-bank-avaloq-sftp.md) |
| 2026-05-15 | Geneva private bank — pre-call agenda     | Mailable | [2026-05-15-avaloq-bank-call-agenda.md](2026-05-15-avaloq-bank-call-agenda.md) |
