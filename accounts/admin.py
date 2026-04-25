from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import EmailVerificationToken, LoginSession, PasswordResetToken, User, UserProfile


class UserProfileInline(admin.StackedInline):
    model = UserProfile
    can_delete = False


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("email", "first_name", "last_name", "is_active", "is_email_verified", "is_staff", "date_joined")
    list_filter = ("is_active", "is_staff", "is_email_verified")
    search_fields = ("email", "first_name", "last_name")
    ordering = ("-date_joined",)
    inlines = [UserProfileInline]

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "is_email_verified", "groups", "user_permissions")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),
    )


@admin.register(LoginSession)
class LoginSessionAdmin(admin.ModelAdmin):
    list_display = ("user", "ip_address", "is_active", "logged_in_at", "logged_out_at")
    list_filter = ("is_active",)
    readonly_fields = ("user", "ip_address", "user_agent", "session_key", "logged_in_at", "logged_out_at")


@admin.register(EmailVerificationToken)
class EmailVerificationTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "token", "created_at", "expires_at", "used_at")
    readonly_fields = ("user", "token", "created_at", "expires_at", "used_at")


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "token", "created_at", "expires_at", "used_at")
    readonly_fields = ("user", "token", "created_at", "expires_at", "used_at")
