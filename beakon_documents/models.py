"""Documents — general-purpose document store.

Per the UI philosophy doc (2026-05-10):
    "Documents — Contracts, statements and supporting evidence."

This app owns the *horizontal* document concept — contracts,
statements, certificates, policies, anything not tied to a specific
accounting parent. Documents bound to a specific Bill / Invoice /
JournalEntry continue to live on `beakon_core.SourceDocument`, which
has stricter constraints (uniqueness per parent, soft-delete blocked
once posting is final). Two stores, one per use case — keeps each
honest about its invariants.

Documents here may be linked (optionally) to a master row from another
module — an Entity, an Employee — so the doc shows up alongside that
row's other artefacts. But the row is OWNED here; modules reference
it, not duplicate it.
"""
import hashlib

from django.conf import settings
from django.db import models

from beakon_core.models.core import Entity
from organizations.models import Organization


CATEGORY_CONTRACT = "contract"
CATEGORY_STATEMENT = "statement"
CATEGORY_POLICY = "policy"
CATEGORY_CERTIFICATE = "certificate"
CATEGORY_TAX = "tax"
CATEGORY_LEGAL = "legal"
CATEGORY_HR = "hr"
CATEGORY_OTHER = "other"

CATEGORY_CHOICES = [
    (CATEGORY_CONTRACT, "Contract"),
    (CATEGORY_STATEMENT, "Statement"),
    (CATEGORY_POLICY, "Policy"),
    (CATEGORY_CERTIFICATE, "Certificate"),
    (CATEGORY_TAX, "Tax document"),
    (CATEGORY_LEGAL, "Legal"),
    (CATEGORY_HR, "HR / Employment"),
    (CATEGORY_OTHER, "Other"),
]


def _upload_path(instance, filename):
    """Folder layout — keeps an auditor's tree readable.

    beakon/documents/org_<id>/<category>/<YYYY>/<filename>
    """
    from django.utils import timezone
    year = timezone.now().year
    return (
        f"beakon/documents/"
        f"org_{instance.organization_id}/"
        f"{instance.category}/{year:04d}/{filename}"
    )


class Document(models.Model):
    """A general-purpose document.

    Either `file` or `external_url` must be present (validated at the
    serializer layer — Django's NOT NULL only enforces both columns
    individually). Hash + size are filled from the uploaded file.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="documents",
    )

    title = models.CharField(
        max_length=255,
        help_text="Human-readable name. Defaults to the original filename "
                  "if not supplied.",
    )
    description = models.TextField(blank=True)
    category = models.CharField(
        max_length=30, choices=CATEGORY_CHOICES, default=CATEGORY_OTHER,
    )

    file = models.FileField(
        upload_to=_upload_path, max_length=500,
        null=True, blank=True,
        help_text="Uploaded file. Either this or external_url must be set.",
    )
    external_url = models.URLField(
        max_length=500, blank=True,
        help_text="Link to the document in an external store (cloud drive, "
                  "DMS). Use when the file lives outside Beakon — for example "
                  "a signed contract in DocuSign.",
    )
    original_filename = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=100, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    content_hash = models.CharField(
        max_length=64, blank=True,
        help_text="SHA-256 hex digest of the file bytes. Blank for "
                  "external_url-only documents.",
    )

    # Optional cross-module references — the document is OWNED by this
    # app; these FKs let other modules surface it without duplicating
    # the row.
    entity = models.ForeignKey(
        Entity, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="documents",
    )
    employee = models.ForeignKey(
        "beakon_employment.Employee", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="documents",
    )

    document_date = models.DateField(
        null=True, blank=True,
        help_text="Date on the document itself (signature date, statement "
                  "as-of, certificate issue date). Distinct from upload date.",
    )

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="beakon_uploaded_general_documents",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    is_deleted = models.BooleanField(default=False)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="beakon_deleted_general_documents",
    )
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "beakon_document"
        ordering = ["-uploaded_at"]
        indexes = [
            models.Index(fields=["organization", "category"]),
            models.Index(fields=["organization", "is_deleted"]),
            models.Index(fields=["entity"]),
            models.Index(fields=["employee"]),
            models.Index(fields=["content_hash"]),
        ]

    def __str__(self):
        return self.title or self.original_filename or f"Document #{self.pk}"

    def compute_hash_and_size(self):
        """Stream the uploaded file to compute SHA-256 + size.

        Called by the service layer before save; not auto-run on save()
        to keep tests / fixtures cheap.
        """
        if not self.file:
            return
        h = hashlib.sha256()
        size = 0
        for chunk in self.file.chunks():
            h.update(chunk)
            size += len(chunk)
        self.content_hash = h.hexdigest()
        self.size_bytes = size
