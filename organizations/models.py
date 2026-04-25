from django.conf import settings
from django.db import models
from django.utils.text import slugify


class Organization(models.Model):
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, unique=True)
    legal_name = models.CharField(max_length=255, blank=True)
    tax_id = models.CharField(max_length=100, blank=True)

    # Address
    address_line1 = models.CharField(max_length=255, blank=True)
    address_line2 = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=2, default="US")
    postal_code = models.CharField(max_length=20, blank=True)

    phone = models.CharField(max_length=20, blank=True)
    website = models.URLField(max_length=255, blank=True)
    currency = models.CharField(max_length=3, default="USD")
    timezone = models.CharField(max_length=50, default="UTC")
    fiscal_year_start = models.PositiveSmallIntegerField(
        default=1, help_text="Month number (1=January)"
    )
    logo_url = models.URLField(max_length=500, blank=True)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "organizations_organization"
        ordering = ["name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
            # Ensure uniqueness
            base_slug = self.slug
            counter = 1
            while Organization.objects.filter(slug=self.slug).exclude(pk=self.pk).exists():
                self.slug = f"{base_slug}-{counter}"
                counter += 1
        super().save(*args, **kwargs)


class Role(models.Model):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="roles"
    )
    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=100)
    is_system_role = models.BooleanField(default=False)
    permissions = models.JSONField(default=dict, blank=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    SYSTEM_ROLES = {
        "owner": {
            "view_ledger": True, "create_journal": True, "approve_journal": True,
            "post_journal": True, "create_bill": True, "approve_bill": True,
            "pay_bill": True, "create_invoice": True, "edit_reports": True,
            "close_period": True, "reopen_period": True, "manage_users": True,
            "manage_settings": True, "view_audit_log": True, "manage_roles": True,
        },
        "admin": {
            "view_ledger": True, "create_journal": True, "approve_journal": True,
            "post_journal": True, "create_bill": True, "approve_bill": True,
            "pay_bill": True, "create_invoice": True, "edit_reports": True,
            "close_period": True, "reopen_period": False, "manage_users": True,
            "manage_settings": True, "view_audit_log": True, "manage_roles": False,
        },
        "accountant": {
            "view_ledger": True, "create_journal": True, "approve_journal": True,
            "post_journal": True, "create_bill": True, "approve_bill": False,
            "pay_bill": False, "create_invoice": True, "edit_reports": True,
            "close_period": True, "reopen_period": False, "manage_users": False,
            "manage_settings": False, "view_audit_log": True, "manage_roles": False,
        },
        "finance_manager": {
            "view_ledger": True, "create_journal": True, "approve_journal": False,
            "post_journal": False, "create_bill": True, "approve_bill": True,
            "pay_bill": True, "create_invoice": True, "edit_reports": True,
            "close_period": False, "reopen_period": False, "manage_users": False,
            "manage_settings": False, "view_audit_log": True, "manage_roles": False,
        },
        "ap_clerk": {
            "view_ledger": True, "create_journal": False, "approve_journal": False,
            "post_journal": False, "create_bill": True, "approve_bill": False,
            "pay_bill": False, "create_invoice": False, "edit_reports": False,
            "close_period": False, "reopen_period": False, "manage_users": False,
            "manage_settings": False, "view_audit_log": False, "manage_roles": False,
        },
        "ar_clerk": {
            "view_ledger": True, "create_journal": False, "approve_journal": False,
            "post_journal": False, "create_bill": False, "approve_bill": False,
            "pay_bill": False, "create_invoice": True, "edit_reports": False,
            "close_period": False, "reopen_period": False, "manage_users": False,
            "manage_settings": False, "view_audit_log": False, "manage_roles": False,
        },
        "viewer": {
            "view_ledger": True, "create_journal": False, "approve_journal": False,
            "post_journal": False, "create_bill": False, "approve_bill": False,
            "pay_bill": False, "create_invoice": False, "edit_reports": False,
            "close_period": False, "reopen_period": False, "manage_users": False,
            "manage_settings": False, "view_audit_log": False, "manage_roles": False,
        },
    }

    class Meta:
        db_table = "organizations_role"
        unique_together = ("organization", "slug")

    def __str__(self):
        return f"{self.name} ({self.organization.name})"

    def has_permission(self, perm):
        return self.permissions.get(perm, False)


class OrganizationMember(models.Model):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="members"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="members")
    is_active = models.BooleanField(default=True)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invitations_sent",
    )
    invited_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "organizations_organizationmember"
        unique_together = ("organization", "user")

    def __str__(self):
        return f"{self.user.email} in {self.organization.name}"

    def has_permission(self, perm):
        return self.role.has_permission(perm)
