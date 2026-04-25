"""SourceDocument — original supporting documents attached to a JournalEntry.

Blueprint p.2: "the original source should always be visible." The entry's
``source_type``/``source_id`` fields say *what* the source was (a bill, a
bank transaction, a manual upload); this model holds the actual file.

Design notes:
    - **Per-JE dedup**: a SHA-256 hash of file bytes; uniqueness on
      ``(journal_entry, content_hash)`` means re-uploading the same file to
      the same JE returns the existing record (the service handles this).
    - **Soft delete only** for ledger-impacting JEs. Once a JE is posted or
      reversed, attachments cannot be removed — accountants must see what
      backed the posting forever after. Drafts may have attachments soft-
      deleted (someone uploaded the wrong file).
    - **No hard delete** in the service layer at all. Files stay on disk;
      ``is_deleted`` hides them from drill-down.
    - Concrete FK to JournalEntry, not GenericForeignKey. When BankTransaction
      and Bill need their own attachments later, give them their own model
      or add a nullable second FK column here. GFK adds query overhead and
      breaks select_related — not worth it for v1.
"""
from django.conf import settings
from django.db import models

from .journal import JournalEntry


def _upload_path(instance, filename):
    """beakon/source_docs/org_<id>/<entity_code>/<year>/<entry_number>/<filename>"""
    je = instance.journal_entry
    return (
        f"beakon/source_docs/"
        f"org_{je.organization_id}/{je.entity.code}/"
        f"{je.date.year:04d}/{je.entry_number}/{filename}"
    )


class SourceDocument(models.Model):
    journal_entry = models.ForeignKey(
        JournalEntry, on_delete=models.PROTECT, related_name="documents"
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
        unique_together = ("journal_entry", "content_hash")
        indexes = [
            models.Index(fields=["journal_entry", "is_deleted"]),
            models.Index(fields=["content_hash"]),
        ]

    def __str__(self):
        marker = " [deleted]" if self.is_deleted else ""
        return f"{self.original_filename} on {self.journal_entry.entry_number}{marker}"
