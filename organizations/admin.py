from django.contrib import admin

from .models import Organization, OrganizationMember, Role


class OrganizationMemberInline(admin.TabularInline):
    model = OrganizationMember
    extra = 0
    raw_id_fields = ("user", "invited_by")


class RoleInline(admin.TabularInline):
    model = Role
    extra = 0


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "currency", "is_active", "created_at")
    list_filter = ("is_active", "currency")
    search_fields = ("name", "slug", "legal_name")
    prepopulated_fields = {"slug": ("name",)}
    inlines = [RoleInline, OrganizationMemberInline]


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("name", "organization", "is_system_role")
    list_filter = ("is_system_role",)


@admin.register(OrganizationMember)
class OrganizationMemberAdmin(admin.ModelAdmin):
    list_display = ("user", "organization", "role", "is_active", "accepted_at")
    list_filter = ("is_active",)
    raw_id_fields = ("user", "invited_by")
