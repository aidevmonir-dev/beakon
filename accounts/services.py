from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils import timezone

from .models import EmailVerificationToken, LoginSession, PasswordResetToken, User


class EmailVerificationService:
    @staticmethod
    def send_verification_email(user):
        """Create token and send verification email."""
        # Invalidate old tokens
        user.verification_tokens.filter(used_at__isnull=True).update(
            expires_at=timezone.now()
        )

        token = EmailVerificationToken.objects.create(
            user=user,
            expires_at=timezone.now() + timezone.timedelta(hours=24),
        )

        verify_url = f"{settings.FRONTEND_URL}/verify-email?token={token.token}"

        send_mail(
            subject="Verify your email — Digits",
            message=f"Hi {user.first_name or 'there'},\n\nVerify your email by visiting:\n{verify_url}\n\nThis link expires in 24 hours.",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )

        return token

    @staticmethod
    def verify_email(token_str):
        """Verify email using token. Returns (success, message)."""
        try:
            token = EmailVerificationToken.objects.select_related("user").get(
                token=token_str
            )
        except EmailVerificationToken.DoesNotExist:
            return False, "Invalid verification token."

        if token.is_used:
            return False, "Token has already been used."

        if token.is_expired:
            return False, "Token has expired. Please request a new one."

        token.used_at = timezone.now()
        token.save(update_fields=["used_at"])

        token.user.is_email_verified = True
        token.user.save(update_fields=["is_email_verified"])

        return True, "Email verified successfully."


class PasswordResetService:
    @staticmethod
    def send_reset_email(email):
        """Send password reset email. Always returns success to prevent email enumeration."""
        try:
            user = User.objects.get(email=email, is_active=True)
        except User.DoesNotExist:
            return  # Silent — don't reveal whether email exists

        # Invalidate old tokens
        user.password_reset_tokens.filter(used_at__isnull=True).update(
            expires_at=timezone.now()
        )

        token = PasswordResetToken.objects.create(
            user=user,
            expires_at=timezone.now() + timezone.timedelta(hours=1),
        )

        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token.token}"

        send_mail(
            subject="Reset your password — Digits",
            message=f"Hi {user.first_name or 'there'},\n\nReset your password by visiting:\n{reset_url}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, ignore this email.",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )

    @staticmethod
    def validate_token(token_str):
        """Check if reset token is valid. Returns (token_obj, error_message)."""
        try:
            token = PasswordResetToken.objects.select_related("user").get(
                token=token_str
            )
        except PasswordResetToken.DoesNotExist:
            return None, "Invalid reset token."

        if token.is_used:
            return None, "Token has already been used."

        if token.is_expired:
            return None, "Token has expired. Please request a new one."

        return token, None

    @staticmethod
    def reset_password(token_str, new_password):
        """Reset password using token. Returns (success, message)."""
        token, error = PasswordResetService.validate_token(token_str)
        if not token:
            return False, error

        token.user.set_password(new_password)
        token.user.save()

        token.used_at = timezone.now()
        token.save(update_fields=["used_at"])

        return True, "Password reset successfully."


class LoginSessionService:
    @staticmethod
    def record_login(user, request):
        """Record a login session from the request."""
        ip = LoginSessionService._get_ip(request)
        user_agent = request.META.get("HTTP_USER_AGENT", "")

        return LoginSession.objects.create(
            user=user,
            ip_address=ip,
            user_agent=user_agent,
            is_active=True,
        )

    @staticmethod
    def record_logout(user):
        """Mark the most recent active session as logged out."""
        session = (
            LoginSession.objects.filter(user=user, is_active=True)
            .order_by("-logged_in_at")
            .first()
        )
        if session:
            session.is_active = False
            session.logged_out_at = timezone.now()
            session.save(update_fields=["is_active", "logged_out_at"])

    @staticmethod
    def _get_ip(request):
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            return xff.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")
