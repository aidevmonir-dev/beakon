"""SourceDocument — original supporting documents attached to a Bill, an
Invoice, or a JournalEntry.

Blueprint p.2: "the original source should always be visible." A document
starts life on whatever object it supports — a vendor receipt is uploaded
to the Bill, an issued invoice scan is uploaded to the Invoice, an ad-hoc
contract is uploaded directly to a JournalEntry. When the parent object
posts (bill approved → JE; invoice issued → JE) the SAME row is updated
to also point at the resulting JournalEntry, so auditors clicking from
the JE see the original source without duplicating bytes on disk.

Design notes:
    - **Polymorphic-but-typed parent**: exactly one of ``journal_entry``,
      ``bill``, ``invoice`` must be set at creation. After post / issue
      both that original FK and ``journal_entry`` are populated.
    - **Per-parent dedup**: SHA-256 hash; uniqueness across
      ``(journal_entry, content_hash)``, ``(bill, content_hash)``,
      ``(invoice, content_hash)``. Re-uploading the same file returns the
      existing row.
    - **Soft delete only** for ledger-impacting JEs. Once a JE is posted
      or reversed, attachments cannot be removed — accountants must see
      what backed the posting forever after. Drafts and pending docs can
      be soft-deleted.
    - **No hard delete** in the service layer at all. Files stay on disk;
      ``is_deleted`` hides them from drill-down.
"""
from django.conf import settings
from django.db import models
from django.db.models import Q

from .journal import JournalEntry


def _upload_path(instance, filename):
    """Folder layout per parent — keeps an auditor's tree readable.

    JE-attached:   beakon/source_docs/org_<id>/<entity>/<year>/<entry_number>/<filename>
    Bill-attached: beakon/source_docs/org_<id>/<entity>/bills/<bill_ref>/<filename>
    Invoice:       beakon/source_docs/org_<id>/<entity>/invoices/<invoice_ref>/<filename>
    """
    if instance.journal_entry_id:
        je = instance.journal_entry
        return (
            f"beakon/source_docs/"
            f"org_{je.organization_id}/{je.entity.code}/"
            f"{je.date.year:04d}/{je.entry_number}/{filename}"
        )
    if instance.bill_id:
        bill = instance.bill
        return (
            f"beakon/source_docs/"
            f"org_{bill.organization_id}/{bill.entity.code}/bills/"
            f"{bill.reference}/{filename}"
        )
    if instance.invoice_id:
        inv = instance.invoice
        return (
            f"beakon/source_docs/"
            f"org_{inv.organization_id}/{inv.entity.code}/invoices/"
            f"{inv.reference}/{filename}"
        )
    # Should not happen — service guards against orphan docs.
    return f"beakon/source_docs/orphan/{filename}"


class SourceDocument(models.Model):
    # Exactly one of these must be set on create. After bill approval /
    # invoice issue, the service ALSO populates ``journal_entry`` so the
    # row links both to the source object and the resulting JE.
    journal_entry = models.ForeignKey(
        JournalEntry, on_delete=models.PROTECT,
        null=True, blank=True, related_name="documents",
    )
    bill = models.ForeignKey(
        "beakon_core.Bill", on_delete=models.PROTECT,
        null=True, blank=True, related_name="documents",
    )
    invoice = models.ForeignKey(
        "beakon_core.Invoice", on_delete=models.PROTECT,
        null=True, blank=True, related_name="documents",
    )

    file = models.FileField(upload_to=_upload_path, max_length=500)
    original_filename = models.CharField(max_length=255)
    content_hash = models.CharField(
        max_length=64,
        help_text="SHA-256 hex digest of the file bytes — used for dedup.",
    )
    content_type = models.CharField(
        max_length=100,
        help_text="MIME type validated by SourceDocumentService.attach().",
    )
    size_bytes = models.PositiveBigIntegerField()
    description = models.TextField(blank=True)

    # Audit — who uploaded
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="beakon_uploaded_documents",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    # Soft delete
    is_deleted = models.BooleanField(default=False)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="beakon_deleted_documents",
    )
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "beakon_sourcedocument"
        ordering = ["uploaded_at"]
        # One uniqueness constraint per parent type. NULL columns don't
        # collide on UniqueConstraint with `condition`, so docs attached
        # to a bill don't conflict with docs attached to a JE that share
        # the same hash.
        constraints = [
            models.UniqueConstraint(
                fields=["journal_entry", "content_hash"],
                condition=Q(journal_entry__isnull=False),
                name="sourcedoc_unique_je_hash",
            ),
            models.UniqueConstraint(
                fields=["bill", "content_hash"],
                condition=Q(bill__isnull=False),
                name="sourcedoc_unique_bill_hash",
            ),
            models.UniqueConstraint(
                fields=["invoice", "content_hash"],
                condition=Q(invoice__isnull=False),
                name="sourcedoc_unique_invoice_hash",
            ),
        ]
        indexes = [
            models.Index(fields=["journal_entry", "is_deleted"]),
            models.Index(fields=["bill", "is_deleted"]),
            models.Index(fields=["invoice", "is_deleted"]),
            models.Index(fields=["content_hash"]),
        ]

    def __str__(self):
        marker = " [deleted]" if self.is_deleted else ""
        if self.journal_entry_id:
            ref = self.journal_entry.entry_number
        elif self.bill_id:
            ref = f"bill {self.bill.reference}"
        elif self.invoice_id:
            ref = f"invoice {self.invoice.reference}"
        else:
            ref = "orphan"
        return f"{self.original_filename} on {ref}{marker}"
