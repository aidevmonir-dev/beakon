from rest_framework import serializers

from audit.models import AuditEvent


class AuditEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditEvent
        fields = (
            "id", "actor", "actor_name", "actor_type", "action",
            "object_type", "object_id", "object_repr",
            "changes", "metadata", "ip_address", "created_at",
        )

    def get_actor_name(self, obj):
        return obj.actor.full_name if obj.actor else obj.actor_type
