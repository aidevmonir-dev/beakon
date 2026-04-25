"""Categorize a BankTransaction → draft JournalEntry in beakon_core.

Booking convention (single-entity, amount expressed in the bank account's
currency, which must match the linked COA account's currency or the
entity's functional currency):

  amount < 0  (money out / withdrawal):
      DR  <offset account>   |  CR  <bank's COA row>

  amount > 0  (money in / deposit):
      DR  <bank's COA row>   |  CR  <offset account>

The draft JE enters the standard approval pipeline — it must be
submitted, approved (by a different user), and posted before the bank
transaction flips to ``matched``. That final status sync happens via a
``post_save`` signal on JournalEntry.
"""
from decimal import Decimal

from django.db import transaction

from beakon_core import constants as core_c
from beakon_core.services import JournalService

from .. import constants as c
from ..exceptions import AlreadyMatched
from ..models import BankTransaction


class Categorizer:
    @staticmethod
    @transaction.atomic
    def categorize(*, txn: BankTransaction, offset_account, user, memo: str = ""):
        """Create a draft JE that posts the txn against the offset account.

        Args:
            txn: The bank transaction.
            offset_account: The beakon_core.Account that receives the other
                side of the posting (e.g. '6100 Office Supplies' for a
                Staples expense, '4000 Service Revenue' for a customer
                deposit).
            user: The user requesting the categorization. Goes on the JE
                as ``created_by``.
            memo: Optional override for the JE memo.

        Returns: (txn, journal_entry) tuple. The JE is in ``draft`` state.
        """
        if txn.status == c.TXN_MATCHED:
            raise AlreadyMatched(
                "Transaction is already matched to a posted journal entry",
                code=c.ERR_ALREADY_MATCHED,
            )

        ba = txn.bank_account
        bank_coa = ba.account
        magnitude = abs(txn.amount)

        if txn.amount < 0:
            lines = [
                {"account_id": offset_account.id,
                 "description": memo or txn.description,
                 "debit": magnitude, "credit": Decimal("0"),
                 "currency": ba.currency},
                {"account_id": bank_coa.id,
                 "description": txn.description,
                 "debit": Decimal("0"), "credit": magnitude,
                 "currency": ba.currency},
            ]
        else:
            lines = [
                {"account_id": bank_coa.id,
                 "description": txn.description,
                 "debit": magnitude, "credit": Decimal("0"),
                 "currency": ba.currency},
                {"account_id": offset_account.id,
                 "description": memo or txn.description,
                 "debit": Decimal("0"), "credit": magnitude,
                 "currency": ba.currency},
            ]

        je = JournalService.create_draft(
            organization=ba.organization,
            entity=ba.entity,
            date=txn.date,
            memo=memo or f"Bank: {txn.description[:200]}",
            reference=(txn.external_id[:32] if txn.external_id else ""),
            currency=ba.currency,
            lines=lines,
            user=user,
            source_type=core_c.SOURCE_BANK_TRANSACTION,
            source_id=txn.id,
            source_ref=txn.description[:200],
        )

        txn.proposed_journal_entry = je
        txn.status = c.TXN_PROPOSED
        if memo:
            txn.notes = memo
        txn.save(update_fields=[
            "proposed_journal_entry", "status", "notes", "updated_at",
        ])
        return txn, je

    @staticmethod
    @transaction.atomic
    def ignore(*, txn: BankTransaction, user=None, reason: str = ""):
        """Skip a bank txn without creating any JE."""
        if txn.status == c.TXN_MATCHED:
            raise AlreadyMatched(
                "Cannot ignore an already-matched transaction",
                code=c.ERR_ALREADY_MATCHED,
            )
        txn.status = c.TXN_IGNORED
        txn.notes = reason or txn.notes
        txn.save(update_fields=["status", "notes", "updated_at"])
        return txn

    @staticmethod
    @transaction.atomic
    def undo(*, txn: BankTransaction, user=None):
        """Return a proposed/ignored transaction back to 'new' so it can
        be re-categorized. Fails if the linked JE is already posted."""
        if txn.status == c.TXN_MATCHED:
            raise AlreadyMatched(
                "Cannot undo a matched transaction (reverse the JE instead)",
                code=c.ERR_ALREADY_MATCHED,
            )
        # If there's a draft JE still attached, pull it back to draft + delete.
        if txn.proposed_journal_entry_id:
            je = txn.proposed_journal_entry
            if je.status in (core_c.JE_PENDING_APPROVAL, core_c.JE_APPROVED, core_c.JE_REJECTED):
                JournalService.return_to_draft(je, user=user, note="Bank txn un-categorized")
            # Only delete if still in draft (never mutate posted data).
            je.refresh_from_db()
            if je.status == core_c.JE_DRAFT:
                je.delete()
        txn.proposed_journal_entry = None
        txn.status = c.TXN_NEW
        txn.save(update_fields=[
            "proposed_journal_entry", "status", "updated_at",
        ])
        return txn
