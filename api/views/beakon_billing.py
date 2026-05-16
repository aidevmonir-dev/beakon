"""Commercial-layer API — pricing catalogue + per-org subscription state.

Endpoints under /api/v1/beakon/billing/ :

    GET   plans/                 (public)  — pricing catalogue
    GET   subscription/          (auth)    — current org's subscription
    POST  subscription/start/    (auth)    — set plan + start trial
    POST  subscription/activate/ (auth)    — file an activation request
    GET   subscription/requests/ (auth)    — list activation requests
"""
from __future__ import annotations

from rest_framework import generics, serializers, status as http
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import IsOrganizationMember
from beakon_core.models import (
    ActivationRequest,
    OrganizationSubscription,
    Plan,
)


# ── Serializers ─────────────────────────────────────────────────────


class PlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = Plan
        fields = [
            "slug", "name", "audience",
            "price", "currency", "billing_cadence",
            "max_entities", "features",
            "is_self_serve", "sort_order",
        ]
        read_only_fields = fields


class SubscriptionSerializer(serializers.ModelSerializer):
    plan = PlanSerializer(read_only=True)
    days_left = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationSubscription
        fields = [
            "id", "plan", "status",
            "started_at", "trial_ends_at", "activated_at", "cancelled_at",
            "days_left", "notes",
        ]
        read_only_fields = fields

    def get_days_left(self, obj):
        return obj.days_left()


class ActivationRequestSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ActivationRequest
        fields = [
            "id", "subscription", "requested_at",
            "requested_by", "requested_by_name",
            "contact_email", "contact_name", "notes",
            "status", "invoice_ref", "handled_at",
        ]
        read_only_fields = [
            "id", "subscription", "requested_at",
            "requested_by", "requested_by_name",
            "status", "invoice_ref", "handled_at",
        ]

    def get_requested_by_name(self, obj):
        u = obj.requested_by
        if not u:
            return ""
        return (
            f"{u.first_name} {u.last_name}".strip()
            or getattr(u, "email", "") or u.username
        )


# ── Views ───────────────────────────────────────────────────────────


class PlanListView(generics.ListAPIView):
    """Public pricing catalogue. Used by /pricing and /register."""
    serializer_class = PlanSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        return Plan.objects.filter(is_active=True).order_by("sort_order", "id")


class CurrentSubscriptionView(APIView):
    """GET /billing/subscription/ — current org's subscription state.

    Returns ``200 {"status": "none", "plan": null, ...}`` when the org has
    no subscription yet (pre-trial state) rather than 404, so callers like
    the dashboard TrialBanner don't pollute the browser console with an
    expected error on every page load.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request):
        sub = (
            OrganizationSubscription.objects
            .filter(organization=request.organization)
            .select_related("plan")
            .first()
        )
        if sub is None:
            return Response({
                "id": None,
                "plan": None,
                "status": "none",
                "started_at": None,
                "trial_ends_at": None,
                "activated_at": None,
                "cancelled_at": None,
                "days_left": None,
                "notes": "",
            })
        return Response(SubscriptionSerializer(sub).data)


class StartSubscriptionView(APIView):
    """POST /billing/subscription/start/

    Body: ``{"plan": "family"}``. Idempotent — if a subscription
    already exists for this org, returns it unchanged. Used by the
    setup wizard once the user has confirmed.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def post(self, request):
        slug = (request.data.get("plan") or "").strip().lower()
        plan = Plan.objects.filter(slug=slug, is_active=True).first()
        if plan is None:
            return Response(
                {"error": "Unknown plan"},
                status=http.HTTP_400_BAD_REQUEST,
            )
        if not plan.is_self_serve:
            return Response(
                {"error": "This plan is sales-led — please contact us."},
                status=http.HTTP_400_BAD_REQUEST,
            )
        sub = OrganizationSubscription.start_trial(
            organization=request.organization, plan=plan,
        )
        return Response(SubscriptionSerializer(sub).data,
                        status=http.HTTP_201_CREATED)


class RequestActivationView(APIView):
    """POST /billing/subscription/activate/

    Files an ActivationRequest row. Thomas processes it out-of-band
    (sends an invoice, signs a contract). When paid, he flips the
    subscription to ``active`` from the admin.
    """
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def post(self, request):
        sub = OrganizationSubscription.objects.filter(
            organization=request.organization,
        ).first()
        if sub is None:
            return Response(
                {"error": "No subscription to activate."},
                status=http.HTTP_400_BAD_REQUEST,
            )

        ar = ActivationRequest.objects.create(
            subscription=sub,
            requested_by=request.user,
            contact_email=request.data.get("contact_email") or request.user.email,
            contact_name=request.data.get("contact_name") or
                f"{request.user.first_name} {request.user.last_name}".strip(),
            notes=request.data.get("notes") or "",
        )
        return Response(ActivationRequestSerializer(ar).data,
                        status=http.HTTP_201_CREATED)


class ActivationRequestListView(generics.ListAPIView):
    serializer_class = ActivationRequestSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get_queryset(self):
        return ActivationRequest.objects.filter(
            subscription__organization=self.request.organization,
        ).order_by("-requested_at")
