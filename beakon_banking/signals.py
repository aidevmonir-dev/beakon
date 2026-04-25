"""Keep BankTransaction status in sync with its proposed JournalEntry.

When the kernel posts a JE that a bank transaction proposed, flip the
txn to ``matched``. When a matched JE gets reversed, flip back to
``proposed`` (the reversal creates a fresh JE; the original txn once
again has an un-posted counterpart).
"""
from django.db.models.signals import post_save
from django.dispatch import receiver

from beakon_core import constants as core_c
from beakon_core.models import JournalEntry

from . import constants as c
from .models import BankTransaction


@receiver(post_save, sender=JournalEntry)
def sync_bank_transaction_status(sender, instance: JournalEntry, **kwargs):
    """React to kernel JE state changes for any bank txn that proposed it."""
    related = BankTransaction.objects.filter(proposed_journal_entry=instance)
    if not related.exists():
        return

    for txn in related:
        desired = None
        if instance.status == core_c.JE_POSTED and txn.status != c.TXN_MATCHED:
            desired = c.TXN_MATCHED
        elif instance.status == core_c.JE_REVERSED and txn.status == c.TXN_MATCHED:
            desired = c.TXN_PROPOSED
        # Drafts / pending / approved / rejected stay as 'proposed' —
        # they're all pre-ledger states and should not alter the bank txn.
        if desired and desired != txn.status:
            txn.status = desired
            txn.save(update_fields=["status", "updated_at"])
