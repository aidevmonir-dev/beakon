"""Travel & Expense API.

Endpoints under /api/v1/beakon/:
  /trip-claims/                  — list, create
  /trip-claims/<id>/             — retrieve, update, delete
  /trip-claims/<id>/submit/      — draft → submitted
  /trip-claims/<id>/approve/     — submitted → approved (different user required)
  /trip-claims/<id>/reject/      — submitted → rejected (with reason)
  /trip-claims/<id>/reimburse/   — approved → reimbursed
  /trip-expenses/                — list, create
  /trip-expenses/<id>/           — retrieve, update, delete

Status transitions are guarded — clients must call the dedicated action
rather than PATCH `status` directly. This keeps timestamps consistent
and ensures audit-relevant transitions go through the same code path.
"""
from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.mixins import OrganizationFilterMixin
from api.permissions import IsOrganizationMember
from api.serializers.beakon_travel import (
    TripClaimDetailSerializer,
    TripClaimListSerializer,
    TripExpenseSerializer,
)
from beakon_travel.models import (
    STATUS_APPROVED,
    STATUS_DRAFT,
    STATUS_REIMBURSED,
    STATUS_REJECTED,
    STATUS_SUBMITTED,
    TripClaim,
    TripExpense,
)


class TripClaimViewSet(OrganizationFilterMixin, ModelViewSet):
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = (
        TripClaim.objects
        .select_related("entity", "created_by", "approver")
        .annotate(
            expense_count=Count("expenses"),
            total_amount=Sum("expenses__amount_in_claim_currency"),
        )
    )
    filterset_fields = ["status", "entity", "created_by", "currency"]
    search_fields = ["title", "purpose", "destination"]
    ordering_fields = ["created_at", "updated_at", "submitted_at", "approved_at"]

    def get_serializer_class(self):
        if self.action == "list":
            return TripClaimListSerializer
        return TripClaimDetailSerializer

    def perform_create(self, serializer):
        # Auto-link to the creator's Employee row when one exists.
        # Per the data-architecture principle "data lives once" — Travel
        # references the canonical Employee record rather than carrying
        # its own copy of identity fields.
        employee = getattr(self.request.user, "employee_profile", None)
        # Only attach the Employee if it lives in the same organization,
        # otherwise leave null and fall back to the User identity.
        if employee and employee.organization_id != self.request.organization.id:
            employee = None
        serializer.save(
            organization=self.request.organization,
            created_by=self.request.user,
            employee=employee,
        )

    # ── Status transitions ─────────────────────────────────────────

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        claim = self.get_object()
        if claim.status not in (STATUS_DRAFT, STATUS_REJECTED):
            return Response(
                {"detail": f"Cannot submit a claim in status '{claim.status}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not claim.expenses.exists():
            return Response(
                {"detail": "Add at least one expense line before submitting."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        claim.status = STATUS_SUBMITTED
        claim.submitted_at = timezone.now()
        claim.rejection_reason = ""
        claim.rejected_at = None
        claim.save(update_fields=["status", "submitted_at", "rejection_reason", "rejected_at"])
        return Response(TripClaimDetailSerializer(claim).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        claim = self.get_object()
        if claim.status != STATUS_SUBMITTED:
            return Response(
                {"detail": f"Only submitted claims can be approved (current: '{claim.status}')."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if claim.created_by_id == request.user.id:
            return Response(
                {"detail": "You cannot approve your own claim — a different user must approve."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        claim.status = STATUS_APPROVED
        claim.approver = request.user
        claim.approved_at = timezone.now()
        claim.save(update_fields=["status", "approver", "approved_at"])
        return Response(TripClaimDetailSerializer(claim).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        claim = self.get_object()
        if claim.status != STATUS_SUBMITTED:
            return Response(
                {"detail": f"Only submitted claims can be rejected (current: '{claim.status}')."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response(
                {"detail": "A reason is required when rejecting a claim."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        claim.status = STATUS_REJECTED
        claim.rejection_reason = reason
        claim.rejected_at = timezone.now()
        claim.save(update_fields=["status", "rejection_reason", "rejected_at"])
        return Response(TripClaimDetailSerializer(claim).data)

    @action(detail=True, methods=["post"])
    def reimburse(self, request, pk=None):
        """Mark an approved claim as reimbursed.

        v1: status flag only. AP/journal posting will hook in once the
        engine has a clean reimbursement path.
        """
        claim = self.get_object()
        if claim.status != STATUS_APPROVED:
            return Response(
                {"detail": f"Only approved claims can be reimbursed (current: '{claim.status}')."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        claim.status = STATUS_REIMBURSED
        claim.reimbursed_at = timezone.now()
        claim.save(update_fields=["status", "reimbursed_at"])
        return Response(TripClaimDetailSerializer(claim).data)


class TripExpenseViewSet(ModelViewSet):
    """Lines on a TripClaim. Filtered by claim's org indirectly — the
    claim FK is what the client supplies, and we verify the parent claim
    belongs to the request's org.
    """
    serializer_class = TripExpenseSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    filterset_fields = ["claim", "category", "currency", "billable_to_client"]

    def get_queryset(self):
        return TripExpense.objects.filter(
            claim__organization=self.request.organization,
        ).select_related("claim")

    def _ensure_editable_parent(self, claim):
        if not claim.is_editable:
            return Response(
                {"detail": "Cannot edit lines on a claim that is not draft / rejected."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if claim.organization_id != self.request.organization.id:
            return Response(
                {"detail": "Claim does not belong to this organization."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    def create(self, request, *args, **kwargs):
        claim_id = request.data.get("claim")
        try:
            claim = TripClaim.objects.get(id=claim_id)
        except TripClaim.DoesNotExist:
            return Response({"detail": "Claim not found."}, status=status.HTTP_404_NOT_FOUND)
        guard = self._ensure_editable_parent(claim)
        if guard:
            return guard
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        guard = self._ensure_editable_parent(instance.claim)
        if guard:
            return guard
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        guard = self._ensure_editable_parent(instance.claim)
        if guard:
            return guard
        return super().destroy(request, *args, **kwargs)
