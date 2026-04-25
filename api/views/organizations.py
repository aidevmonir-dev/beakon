from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import IsOrganizationMember, require_permission
from api.serializers.organizations import (
    InviteMemberSerializer,
    OrganizationMemberSerializer,
    OrganizationSerializer,
    RoleCreateSerializer,
    RoleSerializer,
    RoleUpdateSerializer,
    UpdateMemberRoleSerializer,
)
from audit.services import log_event
from organizations.models import Organization, OrganizationMember, Role
from organizations.services import OrganizationService


# ── Organizations ─────────────────────────────────────────────────────

class OrganizationListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """List all organizations the user belongs to."""
        orgs = OrganizationService.get_user_organizations(request.user)
        return Response(OrganizationSerializer(orgs, many=True).data)

    def post(self, request):
        """Create a new organization."""
        serializer = OrganizationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        org = OrganizationService.create_organization(
            user=request.user, **serializer.validated_data
        )
        from ledger.seed import seed_chart_of_accounts
        seed_chart_of_accounts(org)

        return Response(
            OrganizationSerializer(org).data,
            status=status.HTTP_201_CREATED,
        )


class OrganizationDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = OrganizationSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]
    queryset = Organization.objects.all()
    lookup_field = "pk"

    def perform_update(self, serializer):
        org = serializer.save()
        log_event(
            organization=org,
            action="update",
            object_type="organization",
            object_id=org.id,
            object_repr=org.name,
        )


# ── Members ───────────────────────────────────────────────────────────

class OrganizationMemberListView(generics.ListAPIView):
    serializer_class = OrganizationMemberSerializer
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get_queryset(self):
        return OrganizationMember.objects.filter(
            organization_id=self.kwargs["pk"], is_active=True
        ).select_related("user", "role")


class InviteMemberView(APIView):
    permission_classes = [IsAuthenticated, IsOrganizationMember, require_permission("manage_users")]

    def post(self, request, pk):
        org = Organization.objects.get(pk=pk)
        serializer = InviteMemberSerializer(data=request.data, context={"organization": org})
        serializer.is_valid(raise_exception=True)

        member, created = OrganizationService.invite_member(
            organization=org,
            email=serializer.validated_data["email"],
            role_slug=serializer.validated_data["role_slug"],
            invited_by=request.user,
        )

        if not created:
            return Response(
                {"error": {"message": "User is already a member"}},
                status=status.HTTP_409_CONFLICT,
            )

        log_event(
            organization=org,
            action="create",
            object_type="organization_member",
            object_id=member.id,
            object_repr=f"Invited {serializer.validated_data['email']}",
        )

        return Response(
            OrganizationMemberSerializer(member).data,
            status=status.HTTP_201_CREATED,
        )


class UpdateMemberView(APIView):
    permission_classes = [IsAuthenticated, IsOrganizationMember, require_permission("manage_users")]

    def patch(self, request, pk, member_id):
        """Change a member's role."""
        org = Organization.objects.get(pk=pk)
        try:
            member = OrganizationMember.objects.select_related("role", "user").get(
                id=member_id, organization=org, is_active=True
            )
        except OrganizationMember.DoesNotExist:
            return Response(
                {"error": {"message": "Member not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Cannot change the owner's role
        if member.role.slug == "owner" and member.user != request.user:
            return Response(
                {"error": {"message": "Cannot change the owner's role"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = UpdateMemberRoleSerializer(data=request.data, context={"organization": org})
        serializer.is_valid(raise_exception=True)

        old_role = member.role.name
        new_role = Role.objects.get(id=serializer.validated_data["role_id"], organization=org)
        member.role = new_role
        member.save(update_fields=["role"])

        log_event(
            organization=org,
            action="update",
            object_type="organization_member",
            object_id=member.id,
            object_repr=member.user.email,
            changes={"role": {"old": old_role, "new": new_role.name}},
        )

        return Response(OrganizationMemberSerializer(member).data)

    def delete(self, request, pk, member_id):
        """Remove (deactivate) a member."""
        org = Organization.objects.get(pk=pk)
        try:
            member = OrganizationMember.objects.select_related("role", "user").get(
                id=member_id, organization=org, is_active=True
            )
        except OrganizationMember.DoesNotExist:
            return Response(
                {"error": {"message": "Member not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Cannot remove yourself if you're the only owner
        if member.role.slug == "owner":
            owner_count = OrganizationMember.objects.filter(
                organization=org, role__slug="owner", is_active=True
            ).count()
            if owner_count <= 1:
                return Response(
                    {"error": {"message": "Cannot remove the last owner"}},
                    status=status.HTTP_403_FORBIDDEN,
                )

        member.is_active = False
        member.save(update_fields=["is_active"])

        log_event(
            organization=org,
            action="delete",
            object_type="organization_member",
            object_id=member.id,
            object_repr=f"Removed {member.user.email}",
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Roles ─────────────────────────────────────────────────────────────

class RoleListCreateView(APIView):
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request, pk):
        roles = Role.objects.filter(organization_id=pk).order_by("is_system_role", "name")
        return Response(RoleSerializer(roles, many=True).data)

    def post(self, request, pk):
        if not getattr(request, "org_member", None) or not request.org_member.has_permission("manage_roles"):
            return Response(
                {"error": {"message": "Permission denied"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        org = Organization.objects.get(pk=pk)
        serializer = RoleCreateSerializer(data=request.data, context={"organization": org})
        serializer.is_valid(raise_exception=True)
        role = serializer.save(organization=org, is_system_role=False)

        log_event(
            organization=org,
            action="create",
            object_type="role",
            object_id=role.id,
            object_repr=role.name,
        )

        return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)


class RoleDetailView(APIView):
    permission_classes = [IsAuthenticated, IsOrganizationMember]

    def get(self, request, pk, role_id):
        try:
            role = Role.objects.get(id=role_id, organization_id=pk)
        except Role.DoesNotExist:
            return Response({"error": {"message": "Role not found"}}, status=status.HTTP_404_NOT_FOUND)
        return Response(RoleSerializer(role).data)

    def patch(self, request, pk, role_id):
        if not getattr(request, "org_member", None) or not request.org_member.has_permission("manage_roles"):
            return Response({"error": {"message": "Permission denied"}}, status=status.HTTP_403_FORBIDDEN)

        try:
            role = Role.objects.get(id=role_id, organization_id=pk)
        except Role.DoesNotExist:
            return Response({"error": {"message": "Role not found"}}, status=status.HTTP_404_NOT_FOUND)

        if role.is_system_role:
            return Response(
                {"error": {"message": "System roles cannot be edited"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = RoleUpdateSerializer(role, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(RoleSerializer(role).data)

    def delete(self, request, pk, role_id):
        if not getattr(request, "org_member", None) or not request.org_member.has_permission("manage_roles"):
            return Response({"error": {"message": "Permission denied"}}, status=status.HTTP_403_FORBIDDEN)

        try:
            role = Role.objects.get(id=role_id, organization_id=pk)
        except Role.DoesNotExist:
            return Response({"error": {"message": "Role not found"}}, status=status.HTTP_404_NOT_FOUND)

        if role.is_system_role:
            return Response(
                {"error": {"message": "System roles cannot be deleted"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        if role.members.filter(is_active=True).exists():
            return Response(
                {"error": {"message": "Cannot delete role with active members. Reassign them first."}},
                status=status.HTTP_409_CONFLICT,
            )

        role.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
