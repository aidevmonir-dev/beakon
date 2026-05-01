"""Journal models — IntercompanyGroup, JournalEntry, JournalLine, ApprovalAction.

Design notes (tied to founder working paper 2026-04-17):

- **Status machine** (p.7 of the blueprint):
    draft → pending_approval → approved → rejected → posted → reversed
  Transitions are validated by the service layer against ``JE_TRANSITIONS``
  in constants.py. All state changes emit an ``ApprovalAction`` audit row.

- **Intercompany**: an intercompany transaction produces TWO (or more)
  JEs — one per involved entity — linked by the same
  ``IntercompanyGroup``. The service layer validates that the group nets
  to zero when viewed in a common reporting currency.

- **FX capture**: each line stores the transaction amount + exchange rate +
  the derived functional-currency amount. This preserves the audit trail
  ("what rate was used on the day this was posted?") even if the FXRate
  table is later updated.

- **Constraints** are enforced at THREE layers:
    1. DB CHECK constraints (non-negative, not both DR and CR, not both zero)
    2. Service-layer validation (balance, min lines, period open, etc.)
    3. State-machine guards (only editable in draft/rejected)
"""
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from organizations.models import Organization

from .. import constants as c


class IntercompanyGroup(models.Model):
    """Groups the JEs that together represent one intercompany transaction.

    When Entity A sends cash to Entity B, we post:
      - JE on Entity A: DR Due-from B / CR Bank
      - JE on Entity B: DR Bank / CR Due-to A
    Both JEs belong to the same IntercompanyGroup. Consolidation/elimination
    logic later keys off this grouping.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="intercompany_groups"
    )
    reference = models.CharField(
        max_length=100, blank=True,
        help_text="Optional external reference — invoice number, wire ID, etc.",
    )
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="created_intercompany_groups",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_intercompanygroup"
        ordering = ["-created_at"]

    def __str__(self):
        return f"IC {self.id} · {self.reference or '(no ref)'}"


class JournalEntry(models.Model):
    """A double-entry accounting transaction, scoped to ONE entity.

    Multi-entity transactions are modelled as multiple ``JournalEntry`` rows
    sharing an ``intercompany_group``. Each single-entity JE must balance on
    its own in the entity's functional currency.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_journal_entries"
    )
    entity = models.ForeignKey(
        "beakon_core.Entity", on_delete=models.PROTECT,
        related_name="journal_entries",
    )
    entry_number = models.CharField(
        max_length=50,
        help_text="Auto-assigned per-entity sequence (e.g. JE-000001).",
    )
    date = models.DateField()
    reference = models.CharField(max_length=255, blank=True)
    memo = models.TextField(blank=True)

    status = models.CharField(
        max_length=20, choices=c.JE_STATUS_CHOICES, default=c.JE_DRAFT
    )

    # Source tracking — traces back to the originating document/event.
    source_type = models.CharField(
        max_length=50, choices=c.SOURCE_TYPE_CHOICES, default=c.SOURCE_MANUAL
    )
    source_id = models.BigIntegerField(null=True, blank=True)
    source_ref = models.CharField(max_length=255, blank=True)  # human-readable

    # Intercompany grouping
    intercompany_group = models.ForeignKey(
        IntercompanyGroup, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="journal_entries",
    )
    # Counterparty entity — convenience denorm for single-entity-pair IC cases.
    counterparty_entity = models.ForeignKey(
        "beakon_core.Entity", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="counterparty_journal_entries",
    )

    # Reversal linkage
    reversal_of = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reversals",
    )

    # Period — set when the JE's date falls inside an existing period row.
    period = models.ForeignKey(
        "beakon_core.Period", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="journal_entries",
    )

    # Counterparty master linkages — optional, informational in v1 (AP/AR
    # aging will read from these when the bill/invoice lifecycles ship).
    vendor = models.ForeignKey(
        "beakon_core.Vendor", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="journal_entries",
    )
    customer = models.ForeignKey(
        "beakon_core.Customer", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="journal_entries",
    )

    # Currency at the JE level — all lines default to this but can override.
    currency = models.CharField(max_length=3, default="USD")

    # Cached totals (in entity's functional currency). Recomputed on line
    # save. Denormalized for fast trial-balance-style queries.
    total_debit_functional = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
    )
    total_credit_functional = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
    )

    # ── Actor / timestamp fields for each status transition ──
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name="beakon_created_journal_entries",
    )
    submitted_for_approval_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="beakon_submitted_journal_entries",
    )
    submitted_for_approval_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="beakon_approved_journal_entries",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="beakon_rejected_journal_entries",
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="beakon_posted_journal_entries",
    )
    posted_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_journalentry"
        unique_together = ("entity", "entry_number")
        ordering = ["-date", "-entry_number"]
        indexes = [
            models.Index(fields=["organization", "date"]),
            models.Index(fields=["entity", "date"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["source_type", "source_id"]),
            models.Index(fields=["intercompany_group"]),
        ]

    def __str__(self):
        return f"{self.entity.code} {self.entry_number} ({self.date}, {self.status})"

    @property
    def is_balanced_functional(self):
        """True when debits == credits in the entity's functional currency."""
        return self.total_debit_functional == self.total_credit_functional


class JournalLine(models.Model):
    """One side of a journal entry. Either debit or credit (never both, never
    both zero). Stored both in transaction currency and functional currency
    via a captured exchange rate.
    """

    journal_entry = models.ForeignKey(
        JournalEntry, on_delete=models.CASCADE, related_name="lines"
    )
    account = models.ForeignKey(
        "beakon_core.Account", on_delete=models.PROTECT,
        related_name="journal_lines",
    )
    description = models.CharField(max_length=500, blank=True)

    # Transaction-currency amounts
    debit = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    credit = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    currency = models.CharField(max_length=3)

    # FX to entity's functional currency
    exchange_rate = models.DecimalField(
        max_digits=20, decimal_places=10, default=Decimal("1"),
        help_text="Units of functional per unit of transaction currency.",
    )
    functional_debit = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
    )
    functional_credit = models.DecimalField(
        max_digits=19, decimal_places=4, default=Decimal("0"),
    )

    # Intercompany — when set, this line books to/from a counterparty entity
    # (e.g., for a Due-To / Due-From account line).
    counterparty_entity = models.ForeignKey(
        "beakon_core.Entity", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="counterparty_journal_lines",
    )

    # Rebillable flag — marks a cost line that should be passed through to a
    # client. Behaves as a flag, not a dimension axis. The optional FK points
    # at the client this is rebillable to (a DimensionValue under whichever
    # DimensionType the org uses for "client" — service layer validates the
    # type code, schema stays permissive so the categorizer can flip the
    # flag before the client is identified).
    is_rebillable = models.BooleanField(default=False)
    rebill_client_dimension_value = models.ForeignKey(
        "beakon_core.DimensionValue", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="rebillable_lines",
    )

    # Workbook-driven dimensional tags (Thomas's 2nd document). These are
    # stored as stable codes for now; later phases can replace or supplement
    # them with FKs into dedicated master tables and validation rules.
    dimension_bank_code = models.CharField(max_length=50, blank=True)
    dimension_custodian_code = models.CharField(max_length=50, blank=True)
    dimension_portfolio_code = models.CharField(max_length=50, blank=True)
    dimension_instrument_code = models.CharField(max_length=50, blank=True)
    dimension_strategy_code = models.CharField(max_length=50, blank=True)
    dimension_asset_class_code = models.CharField(max_length=50, blank=True)
    dimension_maturity_code = models.CharField(max_length=50, blank=True)

    line_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_journalline"
        ordering = ["line_order"]
        indexes = [
            models.Index(fields=["journal_entry"]),
            models.Index(fields=["account"]),
            models.Index(fields=["journal_entry", "dimension_bank_code"]),
            models.Index(fields=["journal_entry", "dimension_custodian_code"]),
            models.Index(fields=["journal_entry", "dimension_portfolio_code"]),
            models.Index(fields=["journal_entry", "dimension_instrument_code"]),
            models.Index(fields=["journal_entry", "is_rebillable"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(debit__gte=0),
                name="beakon_jl_debit_nonneg",
            ),
            models.CheckConstraint(
                condition=models.Q(credit__gte=0),
                name="beakon_jl_credit_nonneg",
            ),
            models.CheckConstraint(
                condition=~(models.Q(debit__gt=0) & models.Q(credit__gt=0)),
                name="beakon_jl_not_both_sides",
            ),
            models.CheckConstraint(
                condition=(models.Q(debit__gt=0) | models.Q(credit__gt=0)),
                name="beakon_jl_not_zero",
            ),
            models.CheckConstraint(
                condition=models.Q(exchange_rate__gt=0),
                name="beakon_jl_positive_rate",
            ),
        ]

    def __str__(self):
        if self.debit > 0:
            side = f"DR {self.debit} {self.currency}"
        else:
            side = f"CR {self.credit} {self.currency}"
        return f"{self.account.code} | {side}"


class ApprovalAction(models.Model):
    """Immutable audit row for every JE state transition.

    Blueprint p.7 Objective 4: 'audit trace of who did what and when'.
    The service layer writes one row per transition; callers can query
    this table to render a JE's approval history.
    """

    journal_entry = models.ForeignKey(
        JournalEntry, on_delete=models.CASCADE, related_name="approval_actions"
    )
    action = models.CharField(max_length=30, choices=c.APPROVAL_ACTION_CHOICES)
    from_status = models.CharField(max_length=20, choices=c.JE_STATUS_CHOICES)
    to_status = models.CharField(max_length=20, choices=c.JE_STATUS_CHOICES)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="approval_actions",
    )
    note = models.TextField(blank=True)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "beakon_approvalaction"
        ordering = ["at"]
        indexes = [
            models.Index(fields=["journal_entry", "at"]),
        ]

    def __str__(self):
        who = self.actor.email if self.actor_id else "system"
        return f"{self.journal_entry_id}: {self.from_status} → {self.to_status} by {who}"
