from django.conf import settings
from django.db import models

from organizations.models import Organization


class AuditEvent(models.Model):
    ACTION_CHOICES = [
        ("create", "Create"),
        ("update", "Update"),
        ("delete", "Delete"),
        ("post", "Post"),
        ("reverse", "Reverse"),
        ("approve", "Approve"),
        ("reject", "Reject"),
        ("login", "Login"),
        ("logout", "Logout"),
        ("close_period", "Close Period"),
        ("reopen_period", "Reopen Period"),
        ("reconcile", "Reconcile"),
        ("import", "Import"),
        ("export", "Export"),
    ]

    ACTOR_TYPE_CHOICES = [
        ("user", "User"),
        ("system", "System"),
        ("ai", "AI"),
    ]

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="audit_events"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    actor_type = models.CharField(max_length=20, choices=ACTOR_TYPE_CHOICES, default="user")
    action = models.CharField(max_length=50, choices=ACTION_CHOICES)

    # What was affected
    object_type = models.CharField(max_length=50)
    object_id = models.BigIntegerField()
    object_repr = models.CharField(max_length=255, blank=True)

    # Change details
    changes = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    # Request context
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "audit_auditevent"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["organization", "created_at"]),
            models.Index(fields=["organization", "object_type", "object_id"]),
            models.Index(fields=["actor"]),
        ]

    def __str__(self):
        actor = self.actor.email if self.actor else self.actor_type
        return f"{actor} {self.action} {self.object_type} {self.object_repr}"
