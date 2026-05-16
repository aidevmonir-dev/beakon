"""Beakon banking models — first feeder into the kernel.

Design:

- ``BankAccount`` links one beakon_core.Entity to one beakon_core.Account
  (the cash COA row). Transactions imported here eventually generate draft
  JournalEntries that debit/credit this account.

- ``BankTransaction`` is the feed line. Its status tracks progress through
  the kernel approval pipeline:

      new ─────────(user picks offset)─────────▶ proposed
      proposed ───(JE posts)──────────────────▶ matched
      proposed ───(JE reversed)───────────────▶ proposed
      new ────────(user clicks 'ignore')──────▶ ignored

  The status transitions to ``matched`` are driven by a Django signal on
  ``JournalEntry.save`` — the banking layer doesn't hard-code JE lifecycle
  knowledge, it just listens for terminal states.

- ``FeedImport`` is the record of one CSV upload, including any parsing errors.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models

from organizations.models import Organization

from . import constants as c


class BankAccount(models.Model):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE,
        related_name="beakon_bank_accounts",
    )
    entity = models.ForeignKey(
        "beakon_core.Entity", on_delete=models.PROTECT,
        related_name="bank_accounts",
    )
    account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.PROTECT,
        related_name="bank_accounts",
        help_text="The cash COA row this bank feeds into. Must belong to the entity.",
    )

    name = models.CharField(max_length=255)
    bank_name = models.CharField(max_length=255, blank=True)
    account_number_last4 = models.CharField(max_length=4, blank=True)
    currency = models.CharField(max_length=3, default="USD")
    is_active = models.BooleanField(default=True)
    opening_balance = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
    )
    notes = models.TextField(blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="beakon_created_bank_accounts",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_bankaccount"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["organization", "is_active"]),
            models.Index(fields=["entity"]),
        ]

    def __str__(self):
        return f"{self.entity.code} · {self.name}"


class FeedImport(models.Model):
    bank_account = models.ForeignKey(
        BankAccount, on_delete=models.CASCADE, related_name="feed_imports"
    )
    source = models.CharField(
        max_length=20, choices=c.SOURCE_CHOICES, default=c.SOURCE_CSV,
    )
    file_name = models.CharField(max_length=255, blank=True)
    total_rows = models.IntegerField(default=0)
    imported_rows = models.IntegerField(default=0)
    duplicate_rows = models.IntegerField(default=0)
    error_rows = models.IntegerField(default=0)
    status = models.CharField(
        max_length=20, choices=c.FEED_STATUS_CHOICES, default=c.FEED_PENDING,
    )
    error_log = models.JSONField(default=list, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    imported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="beakon_feed_imports",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_feedimport"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.source} import · {self.bank_account.name} · {self.status}"


class BankTransaction(models.Model):
    bank_account = models.ForeignKey(
        BankAccount, on_delete=models.CASCADE, related_name="transactions"
    )
    feed_import = models.ForeignKey(
        FeedImport, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="transactions",
    )

    external_id = models.CharField(
        max_length=128,
        help_text="SHA1-based dedup key: (bank_account, date, amount, normalized desc).",
    )
    date = models.DateField()
    description = models.TextField()
    original_description = models.TextField(blank=True)
    amount = models.DecimalField(
        max_digits=19, decimal_places=4,
        help_text="Signed: positive = deposit/credit from bank POV; negative = withdrawal.",
    )
    balance_after = models.DecimalField(
        max_digits=19, decimal_places=4, null=True, blank=True,
    )
    currency = models.CharField(max_length=3)

    status = models.CharField(
        max_length=20, choices=c.TXN_STATUS_CHOICES, default=c.TXN_NEW,
    )
    # When the user categorizes a txn we create a draft JE in beakon_core.
    # The signal watches this JE's status to flip us to ``matched`` on post.
    proposed_journal_entry = models.ForeignKey(
        "beakon_core.JournalEntry", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="proposed_bank_transactions",
    )

    is_duplicate = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_banktransaction"
        ordering = ["-date", "-id"]
        unique_together = ("bank_account", "external_id")
        indexes = [
            models.Index(fields=["bank_account", "date"]),
            models.Index(fields=["bank_account", "status"]),
            models.Index(fields=["proposed_journal_entry"]),
        ]

    def __str__(self):
        return f"{self.date} {self.description[:40]} {self.amount}"


# ─────────────────────────── Avaloq SFTP feed ─────────────────────────── #


class AvaloqFeedDrop(models.Model):
    """One zip received from a custodian's daily SFTP push.

    Avaloq custodians publish a daily zip containing five files (cash,
    securities, orderbook, positions, perf). One ``AvaloqFeedDrop`` row
    represents one such zip — its arrival, ingestion attempt, per-file
    counts, and any errors.

    The cash file maps to ``BankTransaction`` via ``FeedImport`` (see
    related_name ``feed_imports`` below). The other four files write
    rows in ``beakon_core`` (``PortfolioTrade``, ``PositionSnapshot``,
    ``PerformanceSnapshot``, ``OpenOrder``).

    Idempotency: re-receiving the same zip (identified by sha256 +
    business_date) is a no-op write.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE,
        related_name="beakon_avaloq_drops",
    )
    custodian = models.ForeignKey(
        "beakon_core.Custodian", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="avaloq_drops",
        help_text="Bank / custodian that pushed this zip. May be null until "
                  "we've onboarded the custodian master.",
    )
    file_name = models.CharField(
        max_length=255,
        help_text="Original zip filename, e.g. 'ABC123_2026-05-09.zip'.",
    )
    sha256 = models.CharField(max_length=64, db_index=True)
    business_date = models.DateField(
        help_text="The bank's stated reporting date (T-1 from delivery).",
    )
    received_at = models.DateTimeField(auto_now_add=True)
    ingest_started_at = models.DateTimeField(null=True, blank=True)
    ingest_completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=16, choices=c.DROP_STATUS_CHOICES, default=c.DROP_RECEIVED,
    )
    file_counts = models.JSONField(
        default=dict, blank=True,
        help_text="Per-file row counts after ingest, e.g. "
                  "{'cash': 47, 'securities': 12, 'positions': 23, ...}.",
    )
    error_log = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True)

    # Provenance — surfaced in the statement drawer's integrity panel.
    source_ip = models.CharField(
        max_length=45, blank=True,
        help_text="Connecting IP. In production set by the SFTP daemon; "
                  "in demo the API view fakes it from a configured allowlist.",
    )
    schema_version = models.CharField(
        max_length=20, blank=True,
        help_text="Detected statement schema version (e.g. 'avaloq-v1'). "
                  "A change here without prior coordination is itself a break.",
    )
    file_size_bytes = models.PositiveIntegerField(default=0)

    # Cash-file FeedImport row (so the existing dedup pipeline still works).
    cash_feed_import = models.ForeignKey(
        FeedImport, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="avaloq_drops_for_cash",
    )

    # Prior drop for the same (portfolio, custodian) — used for the
    # vs-T-2 delta view. Resolved at ingest time, not at query time, so
    # the chain is stable even if intermediate drops are deleted.
    prior_drop = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="next_drops",
    )

    # When non-null, this drop was created by re-processing the linked
    # one. The original is retained (status changes to 'superseded'),
    # so the audit chain is preserved.
    reprocessed_from = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reprocessed_attempts",
    )

    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="beakon_avaloq_drops_received",
    )

    # Where the source zip ended up after ingest: archive/<date>/<file> on
    # success, quarantine/<file> on parse failure. Empty when the caller did
    # not request file lifecycle (mock ingest, unit tests, one-off re-runs).
    archive_path = models.CharField(max_length=512, blank=True, default="")

    class Meta:
        db_table = "beakon_avaloq_drop"
        ordering = ["-received_at"]
        unique_together = ("organization", "sha256", "business_date")
        indexes = [
            models.Index(fields=["organization", "business_date"]),
            models.Index(fields=["organization", "status"]),
        ]

    def __str__(self):
        return f"{self.file_name} · {self.business_date} · {self.status}"


class ReconciliationBreak(models.Model):
    """A discrepancy between bank-feed truth and Beakon's running ledger.

    Read-only — Beakon never auto-corrects. The user reviews the break
    and either fixes Beakon (post a missing trade, correct a TaxLot) or
    flags the bank file for re-broadcast.
    """

    drop = models.ForeignKey(
        AvaloqFeedDrop, on_delete=models.CASCADE,
        related_name="breaks",
    )
    portfolio = models.ForeignKey(
        "beakon_core.Portfolio", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="reconciliation_breaks",
    )
    break_type = models.CharField(max_length=40, choices=c.BREAK_TYPE_CHOICES)
    category = models.CharField(
        max_length=20, choices=c.BREAK_CATEGORY_CHOICES,
        default=c.BREAK_CAT_UNKNOWN,
        help_text="Auto-classified reason. Drives UI grouping + suggested resolution.",
    )
    isin = models.CharField(max_length=24, blank=True)
    bank_value = models.CharField(
        max_length=120, blank=True,
        help_text="What the bank reported (free-form string, e.g. '95' or 'USD 12,450').",
    )
    beakon_value = models.CharField(max_length=120, blank=True)
    detail = models.TextField(blank=True)
    suggested_resolution = models.TextField(
        blank=True,
        help_text="Engine-generated next-step suggestion shown to the operator.",
    )

    resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="beakon_breaks_resolved",
    )
    resolution_notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "beakon_recon_break"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["drop", "resolved"]),
            models.Index(fields=["portfolio", "resolved"]),
            models.Index(fields=["break_type"]),
        ]

    def __str__(self):
        return f"{self.break_type} · {self.isin or 'n/a'} · "\
               f"{'resolved' if self.resolved else 'open'}"
