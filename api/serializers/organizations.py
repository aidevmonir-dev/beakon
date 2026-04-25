from rest_framework import serializers

from organizations.models import Organization, OrganizationMember, Role


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ("id", "name", "slug", "is_system_role", "permissions", "description")
        read_only_fields = ("id", "is_system_role")


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = (
            "id", "name", "slug", "legal_name", "tax_id",
            "address_line1", "address_line2", "city", "state", "country", "postal_code",
            "phone", "website", "currency", "timezone", "fiscal_year_start",
            "logo_url", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("id", "slug", "created_at", "updated_at")


class OrganizationMemberSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    role = RoleSerializer(read_only=True)

    class Meta:
        model = OrganizationMember
        fields = ("id", "user", "role", "is_active", "invited_at", "accepted_at")

    def get_user(self, obj):
        return {
            "id": obj.user.id,
            "email": obj.user.email,
            "first_name": obj.user.first_name,
            "last_name": obj.user.last_name,
        }


class InviteMemberSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role_slug = serializers.CharField(max_length=100)

    def validate_role_slug(self, value):
        organization = self.context.get("organization")
        if organization and not organization.roles.filter(slug=value).exists():
            raise serializers.ValidationError(f"Role '{value}' does not exist.")
        return value


class UpdateMemberRoleSerializer(serializers.Serializer):
    role_id = serializers.IntegerField()

    def validate_role_id(self, value):
        organization = self.context.get("organization")
        if organization and not organization.roles.filter(id=value).exists():
            raise serializers.ValidationError("Role does not exist.")
        return value


class RoleCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ("name", "slug", "permissions", "description")

    def validate_slug(self, value):
        organization = self.context.get("organization")
        if organization and organization.roles.filter(slug=value).exists():
            raise serializers.ValidationError(f"Role with slug '{value}' already exists.")
        return value


class RoleUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ("name", "permissions", "description")
