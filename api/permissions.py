from rest_framework.permissions import BasePermission

from organizations.models import OrganizationMember


class IsOrganizationMember(BasePermission):
    """Verify the user belongs to the organization specified in the request."""
    message = "Organization context required. Send X-Organization-ID header."

    def has_permission(self, request, view):
        org_id = (
            request.headers.get("X-Organization-ID")
            or request.query_params.get("organization_id")
        )
        if not org_id:
            # Auto-resolve: if user has exactly one org, use it
            memberships = OrganizationMember.objects.filter(
                user=request.user, is_active=True
            ).select_related("organization")
            if memberships.count() == 1:
                member = memberships.first()
                request.org_member = member
                request.organization = member.organization
                return True
            return False

        try:
            member = OrganizationMember.objects.select_related("organization", "role").get(
                organization_id=org_id, user=request.user, is_active=True
            )
            request.org_member = member
            request.organization = member.organization
            return True
        except OrganizationMember.DoesNotExist:
            return False


class HasPermission(BasePermission):
    """Check a specific permission on the organization member's role."""

    def __init__(self, perm):
        self.perm = perm

    def has_permission(self, request, view):
        member = getattr(request, "org_member", None)
        if not member:
            return False
        return member.has_permission(self.perm)


def require_permission(perm):
    """Factory to create a permission class for a specific permission."""

    class _Perm(BasePermission):
        def has_permission(self, request, view):
            member = getattr(request, "org_member", None)
            if not member:
                return False
            return member.has_permission(perm)

    _Perm.__name__ = f"Requires_{perm}"
    return _Perm
