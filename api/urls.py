"""Legacy non-beakon routes — auth + organizations + audit only.

Everything accounting-related now lives under /api/v1/beakon/
(see api/beakon_urls.py). The legacy domain apps (bills, invoices, banking,
reports, etc.) were unregistered on 2026-04-18 per the founder working paper
— their routes have been stripped here.
"""
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views.accounts import (
    CustomTokenObtainPairView,
    LoginHistoryView,
    LogoutView,
    CheckEmailView,
    MeView,
    PasswordChangeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PasswordResetValidateView,
    RegisterView,
    ResendVerificationView,
    VerifyEmailView,
)
from .views.audit import AuditEventListView
from .views.organizations import (
    InviteMemberView,
    OrganizationDetailView,
    OrganizationListCreateView,
    OrganizationMemberListView,
    RoleDetailView,
    RoleListCreateView,
    UpdateMemberView,
)


urlpatterns = [
    # ── Auth ──────────────────────────────────────────────────────────
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/check-email/", CheckEmailView.as_view(), name="check-email"),
    path("auth/login/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("auth/verify-email/", VerifyEmailView.as_view(), name="verify-email"),
    path("auth/resend-verification/", ResendVerificationView.as_view(), name="resend-verification"),
    path("auth/password/reset/", PasswordResetRequestView.as_view(), name="password-reset"),
    path("auth/password/reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    path("auth/password/reset/validate/", PasswordResetValidateView.as_view(), name="password-reset-validate"),
    path("auth/password/change/", PasswordChangeView.as_view(), name="password-change"),
    path("auth/login-history/", LoginHistoryView.as_view(), name="login-history"),

    # ── Organizations (tenant master) ─────────────────────────────────
    path("organizations/", OrganizationListCreateView.as_view(), name="org-list-create"),
    path("organizations/<int:pk>/", OrganizationDetailView.as_view(), name="org-detail"),
    path("organizations/<int:pk>/members/", OrganizationMemberListView.as_view(), name="org-members"),
    path("organizations/<int:pk>/members/invite/", InviteMemberView.as_view(), name="org-invite"),
    path("organizations/<int:pk>/members/<int:member_id>/", UpdateMemberView.as_view(), name="org-member-detail"),
    path("organizations/<int:pk>/roles/", RoleListCreateView.as_view(), name="org-roles"),
    path("organizations/<int:pk>/roles/<int:role_id>/", RoleDetailView.as_view(), name="org-role-detail"),

    # ── Audit ─────────────────────────────────────────────────────────
    path("audit/events/", AuditEventListView.as_view(), name="audit-events"),
]
