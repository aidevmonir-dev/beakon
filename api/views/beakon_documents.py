"""Documents API.

  /api/v1/beakon/documents/         — list, create (multipart), filter
  /api/v1/beakon/documents/<id>/    — retrieve, update, soft-delete
"""
from django.utils import timezone
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.mixins import OrganizationFilterMixin
from api.permissions import IsOrganizationMember
from api.serializers.beakon_documents import DocumentSerializer
from beakon_documents.models import Document


class DocumentViewSet(OrganizationFilterMixin, ModelViewSet):
    """Standard CRUD plus a soft-delete on destroy.

    Multipart parsers up front so file uploads work; JSON parser kept
    for metadata-only updates.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    serializer_class = DocumentSerializer
    queryset = (
        Document.objects
        .filter(is_deleted=False)
        .select_related("entity", "employee", "uploaded_by")
    )
    filterset_fields = ["category", "entity", "employee"]
    search_fields = ["title", "description", "original_filename"]
    ordering_fields = ["uploaded_at", "document_date", "title"]

    def perform_create(self, serializer):
        instance = serializer.save(
            organization=self.request.organization,
            uploaded_by=self.request.user,
        )
        # Capture filename + content type + content hash from the
        # uploaded file. Title falls back to the original filename.
        f = self.request.FILES.get("file")
        if f:
            instance.original_filename = f.name
            instance.content_type = getattr(f, "content_type", "") or ""
            if not instance.title:
                instance.title = f.name
            instance.compute_hash_and_size()
            instance.save(update_fields=[
                "original_filename", "content_type", "title",
                "content_hash", "size_bytes",
            ])

    def destroy(self, request, *args, **kwargs):
        # Soft-delete — keeps file on disk but hides from drill-down,
        # consistent with the SourceDocument soft-delete pattern.
        instance = self.get_object()
        instance.is_deleted = True
        instance.deleted_by = request.user
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_deleted", "deleted_by", "deleted_at"])
        return Response(status=204)
