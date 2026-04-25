from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from api.mixins import OrganizationFilterMixin
from api.permissions import IsOrganizationMember, require_permission
from api.serializers.audit import AuditEventSerializer
from audit.models import AuditEvent


class AuditEventListView(OrganizationFilterMixin, generics.ListAPIView):
    serializer_class = AuditEventSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember, require_permission("view_audit_log")]
    queryset = AuditEvent.objects.select_related("actor")
    filterset_fields = ["action", "object_type", "actor_type"]
    search_fields = ["object_repr", "actor__email"]
    ordering_fields = ["created_at"]
