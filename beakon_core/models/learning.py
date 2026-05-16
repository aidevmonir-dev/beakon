"""LearningRule — Beakon's rules registry, populated from user corrections.

Per Thomas's 2026-05-12 spec ([[project_teach_beakon_spec]]): when a user
fixes an AI-proposed JE and opts to "remember the rule for similar
invoices in future", a row lands here. At extraction time (Phase B5) the
OCR prompt fetches active rules for the vendor and injects them as
in-context guidance so Beakon stops repeating the same mistakes.

A rule is a *human-approved* statement about how Beakon should treat a
class of invoices. The rule itself is human-readable (`human_instruction`)
plus optional structured matching logic (`trigger_conditions`) and
accounting logic (`structured_accounting_logic`) that future versions can
make machine-readable.

Scope choices (Thomas §4): one-time / vendor / vendor + customer number /
entity / invoice pattern. One-time means the row exists for audit only —
never applied to future invoices.

Confidence policy (Thomas §7): auto-apply when reliable, suggest when
uncertain, require human review when material. New rules default to
require_review so the first application is supervised.

Feedback loop (Thomas §8): every application records success_count if
accepted and override_count if the reviewer rejects the rule's
suggestion. Persistent overrides reduce trust and eventually the rule
gets deactivated.
"""
from django.conf import settings
from django.db import models

from organizations.models import Organization


class LearningRule(models.Model):
    # ── Scope (Thomas §4) ────────────────────────────────────────────
    SCOPE_ONE_TIME = "one_time"
    SCOPE_VENDOR = "vendor"
    SCOPE_VENDOR_CUSTOMER = "vendor_customer_number"
    SCOPE_ENTITY = "entity"
    SCOPE_INVOICE_PATTERN = "invoice_pattern"
    SCOPE_CHOICES = [
        (SCOPE_ONE_TIME, "One-time"),
        (SCOPE_VENDOR, "Vendor-specific"),
        (SCOPE_VENDOR_CUSTOMER, "Vendor + customer number"),
        (SCOPE_ENTITY, "Entity-specific"),
        (SCOPE_INVOICE_PATTERN, "Invoice pattern"),
    ]

    # ── Confidence policy (Thomas §7) ───────────────────────────────
    POLICY_AUTO_APPLY = "auto_apply"
    POLICY_SUGGEST = "suggest_high_confidence"
    POLICY_REQUIRE_REVIEW = "require_review"
    POLICY_CHOICES = [
        (POLICY_AUTO_APPLY, "Auto-apply"),
        (POLICY_SUGGEST, "Suggest with high confidence"),
        (POLICY_REQUIRE_REVIEW, "Require review"),
    ]

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE,
        related_name="learning_rules",
    )

    # ── Scope targeting ─────────────────────────────────────────────
    vendor = models.ForeignKey(
        "beakon_core.Vendor", on_delete=models.PROTECT,
        related_name="learning_rules",
        help_text="Rule applies to this vendor's bills.",
    )
    customer_number = models.CharField(
        max_length=64, blank=True,
        help_text="Vendor-side customer identifier extracted from the "
                  "originating invoice (e.g. Sunrise 1000779477).",
    )
    entity = models.ForeignKey(
        "beakon_core.Entity", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="learning_rules",
        help_text="Restrict the rule to a single entity. Null = all "
                  "entities in this org.",
    )
    invoice_pattern = models.CharField(
        max_length=255, blank=True,
        help_text="Free-form description of the invoice pattern this rule "
                  "applies to (e.g. 'Monthly telecom invoice; Sunrise layout').",
    )
    trigger_conditions = models.JSONField(
        default=dict, blank=True,
        help_text="Structured matching conditions evaluated at extraction "
                  "time. Shape evolves; today the human_instruction is the "
                  "primary signal.",
    )

    # ── What the rule does ──────────────────────────────────────────
    correction_type = models.CharField(
        max_length=64, blank=True,
        help_text="Canonical category (duplicate_line, vat_treatment_wrong, "
                  "wrong_account, etc.) — usually derived from the "
                  "BillCorrection's error_types.",
    )
    human_instruction = models.TextField(
        help_text="Plain-English instruction approved by the user. This is "
                  "what Beakon shows in audit trails and what the AI sees "
                  "in its prompt when this rule applies.",
    )
    structured_accounting_logic = models.JSONField(
        default=dict, blank=True,
        help_text="Machine-readable mapping (target accounts, tax-code "
                  "overrides, line-merge directives). Populated by later "
                  "phases as patterns become reliably extractable.",
    )

    # ── Lifecycle ───────────────────────────────────────────────────
    scope = models.CharField(
        max_length=32, choices=SCOPE_CHOICES, default=SCOPE_VENDOR,
    )
    confidence_policy = models.CharField(
        max_length=32, choices=POLICY_CHOICES, default=POLICY_REQUIRE_REVIEW,
        help_text="Defaults to require_review so the first application is "
                  "supervised — policy graduates with override metrics.",
    )

    # ── Provenance + audit ──────────────────────────────────────────
    created_from_invoice = models.ForeignKey(
        "beakon_core.Bill", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="learning_rules_created",
        help_text="The bill whose correction produced this rule.",
    )
    created_from_correction = models.ForeignKey(
        "beakon_core.BillCorrection", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="promoted_rules",
        help_text="The specific correction this rule was promoted from.",
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="approved_learning_rules",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    # ── Feedback loop (Thomas §8) ───────────────────────────────────
    last_used = models.DateTimeField(null=True, blank=True)
    success_count = models.IntegerField(
        default=0,
        help_text="Times the reviewer accepted Beakon's output when this "
                  "rule was in context. ↑ confidence.",
    )
    override_count = models.IntegerField(
        default=0,
        help_text="Times the reviewer overrode Beakon's output when this "
                  "rule was in context. ↓ confidence; persistent overrides "
                  "should deactivate the rule.",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Inactive rules are skipped at extraction time but kept "
                  "for audit history.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_learningrule"
        ordering = ["-created_at"]
        indexes = [
            # B5 hot path: retrieve active rules for a vendor at extraction
            # time (one query per uploaded bill).
            models.Index(fields=["organization", "vendor", "is_active", "-created_at"]),
        ]

    def __str__(self):
        return (
            f"LearningRule #{self.pk} · {self.vendor.code if self.vendor_id else '—'} · "
            f"{self.get_scope_display()}"
        )
