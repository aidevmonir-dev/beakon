from django.contrib.auth import get_user_model
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from accounts.services import (
    EmailVerificationService,
    LoginSessionService,
    PasswordResetService,
)
from api.serializers.accounts import (
    EmailVerifySerializer,
    LoginSessionSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    UserSerializer,
    UserUpdateSerializer,
)

User = get_user_model()


# ── Registration ──────────────────────────────────────────────────────

class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        # Send verification email
        try:
            EmailVerificationService.send_verification_email(user)
        except Exception:
            pass  # Don't block registration if email fails

        return Response(
            UserSerializer(user).data,
            status=status.HTTP_201_CREATED,
        )


# ── Login (with session tracking) ────────────────────────────────────

class CustomTokenObtainPairView(TokenObtainPairView):
    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)

        if response.status_code == 200:
            # Record login session
            email = request.data.get("email", "")
            try:
                user = User.objects.get(email=email)
                LoginSessionService.record_login(user, request)
            except User.DoesNotExist:
                pass

        return response


# ── Logout ────────────────────────────────────────────────────────────

class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh_token = request.data.get("refresh")
        if not refresh_token:
            return Response(
                {"error": {"message": "Refresh token is required"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            token = RefreshToken(refresh_token)
            token.blacklist()
        except Exception:
            pass  # Token may already be blacklisted or invalid

        LoginSessionService.record_logout(request.user)

        return Response({"message": "Logged out successfully"})


# ── Profile ───────────────────────────────────────────────────────────

class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = UserSerializer(request.user)
        data = serializer.data

        from organizations.models import OrganizationMember
        memberships = OrganizationMember.objects.filter(
            user=request.user, is_active=True
        ).select_related("organization", "role")

        data["organizations"] = [
            {
                "id": m.organization.id,
                "name": m.organization.name,
                "slug": m.organization.slug,
                "role": m.role.name,
            }
            for m in memberships
        ]
        return Response(data)

    def patch(self, request):
        serializer = UserUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(request.user).data)


# ── Email Verification ────────────────────────────────────────────────

class VerifyEmailView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = EmailVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        success, message = EmailVerificationService.verify_email(
            serializer.validated_data["token"]
        )

        if success:
            return Response({"message": message})
        return Response(
            {"error": {"message": message}},
            status=status.HTTP_400_BAD_REQUEST,
        )


class ResendVerificationView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ResendVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            user = User.objects.get(
                email=serializer.validated_data["email"],
                is_email_verified=False,
            )
            EmailVerificationService.send_verification_email(user)
        except User.DoesNotExist:
            pass  # Don't reveal whether email exists

        return Response({"message": "If the email exists and is unverified, a verification link has been sent."})


# ── Password Reset ────────────────────────────────────────────────────

class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        PasswordResetService.send_reset_email(serializer.validated_data["email"])

        return Response({"message": "If an account with that email exists, a password reset link has been sent."})


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        success, message = PasswordResetService.reset_password(
            token_str=serializer.validated_data["token"],
            new_password=serializer.validated_data["new_password"],
        )

        if success:
            return Response({"message": message})
        return Response(
            {"error": {"message": message}},
            status=status.HTTP_400_BAD_REQUEST,
        )


class PasswordResetValidateView(APIView):
    """Check if a reset token is valid (for frontend to show/hide the form)."""
    permission_classes = [AllowAny]

    def get(self, request):
        token_str = request.query_params.get("token")
        if not token_str:
            return Response(
                {"valid": False, "error": "Token is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        token, error = PasswordResetService.validate_token(token_str)
        if token:
            return Response({"valid": True})
        return Response({"valid": False, "error": error})


# ── Password Change ───────────────────────────────────────────────────

class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PasswordChangeSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)

        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save()

        return Response({"message": "Password changed successfully."})


# ── Login History ─────────────────────────────────────────────────────

class LoginHistoryView(generics.ListAPIView):
    serializer_class = LoginSessionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return self.request.user.login_sessions.order_by("-logged_in_at")[:20]
