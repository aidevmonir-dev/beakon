"""WorkflowDiagram — a small, editable, organization-scoped Mermaid source.

Built so domain experts (e.g. Thomas) can correct the engine workflow
chart in-browser without involving an engineer. One row per logical
diagram per organization (today there's a single ``ENGINE_FLOW``).

The store is dumb on purpose: the source is one Mermaid string. Validation
happens client-side at render time — a malformed source produces a
visible parse error in the preview pane, not a database failure.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models

from organizations.models import Organization


class WorkflowDiagram(models.Model):
    """One named, editable Mermaid diagram per organization."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="workflow_diagrams",
    )
    code = models.CharField(
        max_length=40,
        help_text="Stable identifier — e.g. ENGINE_FLOW, BILL_LIFECYCLE.",
    )
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    mermaid_src = models.TextField(
        help_text="Mermaid source — see https://mermaid.js.org/syntax/flowchart.html",
    )

    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="workflow_diagrams_updated",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_workflow_diagram"
        unique_together = ("organization", "code")
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} · {self.name}"
