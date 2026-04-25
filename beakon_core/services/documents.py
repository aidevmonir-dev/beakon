"""SourceDocumentService — upload, list, and soft-delete supporting files.

Blueprint p.2: "the original source should always be visible." This service
is the one-and-only write path for ``SourceDocument``. Callers (API views,
ingestion pipelines, AI attachment flows) go through here; the model itself
is never created directly.

Rules enforced:
    1. MIME whitelist (``ALLOWED_MIME_TYPES``). Rejects anything else so the
       vault doesn't become an executable dump.
    2. Dedup by SHA-256 hash — re-uploading the same bytes to the same JE
       returns the existing record instead of creating a duplicate.
    3. Soft-delete blocked once the JE is in ``JE_LEDGER_IMPACTING`` (posted
       or reversed). The audit trail must preserve what backed the posting.
    4. No hard delete from the service — ``is_deleted`` flag only.
"""
import hashlib

from django.db import transaction
from django.utils import timezone

from .. import constants as c
from ..exceptions import ValidationError
from ..models import SourceDocument


# MIME types permitted for upload. Everything else is rejected. Keep the
# list conservative; extend when a concrete accountant workflow needs it.
ALLOWED_MIME_TYPES = frozenset({
    # PDFs — most bills/receipts/bank statements
    "application/pdf",
    # Images — scanned receipts, mobile uploads
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic",
    # Office docs — vendor bills, contracts
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    # Plain text / CSV — bank exports, memos
    "text/plain",
    "text/csv",
    # Email — forwarded invoices
    "message/rfc822",
})

# Upper bound on a single attachment. 25 MB covers typical scanned PDFs
# without leaving room for someone to upload a multi-hundred-MB video.
MAX_SIZE_BYTES = 25 * 1024 * 1024


class SourceDocumentService:
    @staticmethod
    @transaction.atomic
    def attach(
        *,
        journal_entry,
        file,
        filename: str,
        content_type: str,
        user=None,
        description: str = "",
    ) -> SourceDocument:
        """Attach ``file`` (a file-like object with ``.read()``) to
        ``journal_entry``. Returns the resulting SourceDocument.

        If an identical file (same SHA-256) is already attached to this
        JE and not soft-deleted, the existing record is returned instead
        of creating a duplicate.
        """
        if content_type not in ALLOWED_MIME_TYPES:
            raise ValidationError(
                f"MIME type {content_type!r} is not permitted for upload.",
                code=c.ERR_INACTIVE_ACCOUNT,  # reusing generic validation code
                details={"content_type": content_type,
                         "allowed": sorted(ALLOWED_MIME_TYPES)},
            )

        # Read the bytes once; compute hash + size; keep bytes for storage.
        if hasattr(file, "seek"):
            file.seek(0)
        raw = file.read()
        size = len(raw)
        if size == 0:
            raise ValidationError(
                "Uploaded file is empty.",
                code=c.ERR_INACTIVE_ACCOUNT,
                details={"filename": filename},
            )
        if size > MAX_SIZE_BYTES:
            raise ValidationError(
                f"File exceeds the {MAX_SIZE_BYTES // (1024*1024)} MB limit.",
                code=c.ERR_INACTIVE_ACCOUNT,
                details={"size_bytes": size, "max_bytes": MAX_SIZE_BYTES},
            )
        content_hash = hashlib.sha256(raw).hexdigest()

        # Dedup at the JE level: same content already here → return it.
        existing = SourceDocument.objects.filter(
            journal_entry=journal_entry,
            content_hash=content_hash,
            is_deleted=False,
        ).first()
        if existing:
            return existing

        # Write a new record. Need to pass bytes into FileField → wrap as
        # ContentFile so Django's default storage writes it.
        from django.core.files.base import ContentFile

        doc = SourceDocument(
            journal_entry=journal_entry,
            original_filename=filename,
            content_hash=content_hash,
            content_type=content_type,
            size_bytes=size,
            uploaded_by=user,
            description=description,
        )
        doc.file.save(filename, ContentFile(raw), save=False)
        doc.save()
        return doc

    @staticmethod
    @transaction.atomic
    def soft_delete(doc: SourceDocument, user=None) -> SourceDocument:
        """Mark a document as deleted. Blocked once the JE is in a
        ledger-impacting status (posted/reversed) — the audit trail
        must preserve what backed the posting.
        """
        if doc.is_deleted:
            return doc
        if doc.journal_entry.status in c.JE_LEDGER_IMPACTING:
            raise ValidationError(
                f"Cannot remove attachment from a {doc.journal_entry.status} "
                f"entry ({doc.journal_entry.entry_number}). "
                "The source document must remain visible for audit.",
                code=c.ERR_POSTED_IMMUTABLE,
                details={
                    "entry_number": doc.journal_entry.entry_number,
                    "entry_status": doc.journal_entry.status,
                },
            )
        doc.is_deleted = True
        doc.deleted_by = user
        doc.deleted_at = timezone.now()
        doc.save(update_fields=["is_deleted", "deleted_by", "deleted_at"])
        return doc

    @staticmethod
    def list_for_entry(journal_entry, *, include_deleted: bool = False):
        """Return an ordered queryset of attachments for a JE."""
        qs = journal_entry.documents.select_related("uploaded_by", "deleted_by")
        if not include_deleted:
            qs = qs.filter(is_deleted=False)
        return qs.order_by("uploaded_at")
