from django.utils import timezone

from .models import Organization, OrganizationMember, Role


class OrganizationService:
    @staticmethod
    def create_organization(name, user, **kwargs):
        """Create an organization and assign the creator as Owner."""
        org = Organization.objects.create(name=name, **kwargs)

        # Create system roles
        for slug, permissions in Role.SYSTEM_ROLES.items():
            Role.objects.create(
                organization=org,
                name=slug.replace("_", " ").title(),
                slug=slug,
                is_system_role=True,
                permissions=permissions,
            )

        # Assign creator as owner
        owner_role = org.roles.get(slug="owner")
        OrganizationMember.objects.create(
            organization=org,
            user=user,
            role=owner_role,
            is_active=True,
            accepted_at=timezone.now(),
        )

        return org

    @staticmethod
    def invite_member(organization, email, role_slug, invited_by):
        """Invite a user to an organization."""
        from accounts.models import User

        user, created = User.objects.get_or_create(
            email=email, defaults={"is_active": True}
        )
        role = organization.roles.get(slug=role_slug)

        member, was_created = OrganizationMember.objects.get_or_create(
            organization=organization,
            user=user,
            defaults={
                "role": role,
                "invited_by": invited_by,
                "invited_at": timezone.now(),
            },
        )
        return member, was_created

    @staticmethod
    def get_user_organizations(user):
        return Organization.objects.filter(
            members__user=user, members__is_active=True
        )

    @staticmethod
    def get_member(organization, user):
        return OrganizationMember.objects.select_related("role").get(
            organization=organization, user=user, is_active=True
        )
