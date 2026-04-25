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
