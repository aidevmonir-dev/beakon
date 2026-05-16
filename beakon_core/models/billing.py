"""Commercial layer — Plans + per-organisation subscription state.

Beakon's sales motion is **assisted self-serve**:

  - Public pricing page lists four plans (Starter / Professional /
    Family Office / Enterprise).
  - Starter / Professional / Family Office prospects can self-register
    and receive an automatic 30-day trial.
  - Enterprise prospects are routed to the contact form — Thomas
    provisions them manually.

Activation is not Stripe-checkout. After the trial the user clicks
'Activate plan'; that fires an ``ActivationRequest`` row that Thomas
acts on out-of-band (invoice, contract). When the contract is signed
he flips the ``OrganizationSubscription`` to ``active``.

This module deliberately does not enforce feature gating — every
trial / active org sees every screen. Gating is a separate decision
that should happen *after* the founder team agrees on what each plan
actually contains.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from organizations.models import Organization


# ── Plan ────────────────────────────────────────────────────────────


class Plan(models.Model):
    """One row per pricing tier shown on /pricing.

    Plans are app-level config — managed by Beakon staff, not by
    organisations. Seed via ``manage.py seed_plans`` (idempotent).
    """

    BILLING_MONTHLY = "monthly"
    BILLING_YEARLY = "yearly"
    BILLING_CUSTOM = "custom"
    BILLING_CHOICES = [
        (BILLING_MONTHLY, "Monthly"),
        (BILLING_YEARLY, "Yearly"),
        (BILLING_CUSTOM, "Custom (sales-led)"),
    ]

    slug = models.SlugField(max_length=40, unique=True)
    name = models.CharField(max_length=80)
    audience = models.CharField(
        max_length=200, blank=True,
        help_text="One-line description of the target customer.",
    )

    price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="Null for Enterprise (custom-priced).",
    )
    currency = models.CharField(max_length=3, default="CHF")
    billing_cadence = models.CharField(
        max_length=10, choices=BILLING_CHOICES, default=BILLING_MONTHLY,
    )

    max_entities = models.PositiveIntegerField(
        default=1,
        help_text="Soft limit. UI surfaces this; enforcement is per-plan policy.",
    )
    features = models.JSONField(
        default=list, blank=True,
        help_text="List of bullet strings shown on the pricing page.",
    )

    is_active = models.BooleanField(default=True)
    is_self_serve = models.BooleanField(
        default=True,
        help_text="Self-serve plans accept register-time signups. "
                  "Sales-led plans (Enterprise) route to /contact.",
    )
    sort_order = models.PositiveSmallIntegerField(default=100)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_plan"
        ordering = ["sort_order", "id"]

    def __str__(self):
        return f"{self.name} ({self.slug})"


# ── OrganizationSubscription ───────────────────────────────────────


class OrganizationSubscription(models.Model):
    """One row per organisation tracking which plan they're on and
    where they are in the trial → active → expired lifecycle.

    Created when the operator (or the setup wizard) attaches a plan
    to a freshly-registered organisation. ``status`` flows:

        trial → active        (Thomas confirms invoice paid)
        trial → expired       (trial_ends_at passed without activation)
        active → cancelled    (customer leaves)
    """

    STATUS_TRIAL = "trial"
    STATUS_ACTIVE = "active"
    STATUS_EXPIRED = "expired"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_TRIAL, "Trial"),
        (STATUS_ACTIVE, "Active"),
        (STATUS_EXPIRED, "Trial expired"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    DEFAULT_TRIAL_DAYS = 30

    organization = models.OneToOneField(
        Organization, on_delete=models.CASCADE,
        related_name="subscription",
    )
    plan = models.ForeignKey(
        Plan, on_delete=models.PROTECT, related_name="subscriptions",
    )
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_TRIAL,
    )

    started_at = models.DateTimeField(auto_now_add=True)
    trial_ends_at = models.DateTimeField(
        null=True, blank=True,
        help_text="When the trial expires. Null after activation.",
    )
    activated_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_org_subscription"

    def __str__(self):
        return f"{self.organization.name} · {self.plan.name} · {self.status}"

    # ── helpers ────────────────────────────────────────────────────

    @classmethod
    def start_trial(cls, *, organization: Organization, plan: Plan,
                    trial_days: int | None = None):
        """Idempotent. If a subscription already exists, return it
        unchanged (the wizard may rerun in dev). If not, create one
        with status=trial and trial_ends_at = now + trial_days."""
        existing = cls.objects.filter(organization=organization).first()
        if existing:
            return existing
        days = trial_days or cls.DEFAULT_TRIAL_DAYS
        return cls.objects.create(
            organization=organization,
            plan=plan,
            status=cls.STATUS_TRIAL,
            trial_ends_at=timezone.now() + timedelta(days=days),
        )

    def days_left(self) -> int | None:
        if not self.trial_ends_at or self.status != self.STATUS_TRIAL:
            return None
        delta = self.trial_ends_at - timezone.now()
        return max(0, delta.days)

    def activate(self, *, notes: str = ""):
        self.status = self.STATUS_ACTIVE
        self.activated_at = timezone.now()
        self.trial_ends_at = None
        if notes:
            self.notes = (self.notes + "\n\n" + notes).strip()
        self.save(update_fields=["status", "activated_at", "trial_ends_at",
                                 "notes", "updated_at"])


# ── ActivationRequest ──────────────────────────────────────────────


class ActivationRequest(models.Model):
    """When a user clicks 'Activate plan' in the dashboard, this row
    is created. Thomas processes it out-of-band (sends an invoice,
    handles the contract, then flips the subscription to ``active``).

    Kept separate from ``OrganizationSubscription`` so the request log
    is an audit trail in its own right.
    """

    STATUS_PENDING = "pending"
    STATUS_INVOICED = "invoiced"
    STATUS_PAID = "paid"
    STATUS_REJECTED = "rejected"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending — awaiting invoice"),
        (STATUS_INVOICED, "Invoice sent"),
        (STATUS_PAID, "Paid — subscription activated"),
        (STATUS_REJECTED, "Rejected"),
    ]

    subscription = models.ForeignKey(
        OrganizationSubscription, on_delete=models.CASCADE,
        related_name="activation_requests",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="beakon_activation_requests",
    )
    requested_at = models.DateTimeField(auto_now_add=True)

    contact_email = models.EmailField(blank=True)
    contact_name = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)

    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING,
    )
    invoice_ref = models.CharField(max_length=80, blank=True)
    handled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="beakon_activation_requests_handled",
    )
    handled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "beakon_activation_request"
        ordering = ["-requested_at"]

    def __str__(self):
        return f"{self.subscription.organization.name} · {self.status} · {self.requested_at:%Y-%m-%d}"
