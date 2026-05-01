"""Core kernel models — Entity, Currency, FXRate, CoA definitions,
AccountGroup, Account, Period.

Design notes (tied to founder working paper 2026-04-17):

- **Organization vs Entity**: ``Organization`` (from the ``organizations`` app)
  is the tenant — the firm using Beakon. ``Entity`` is a legal/reporting
  unit within that tenant. Multi-entity consolidation = multiple entities
  under one organization. Family-office users typically have one Organization
  and N Entities (holding company, trusts, foundations, funds, personal
  accounts).

- **COA scope**: ``Account`` rows live at the Organization level so a
  consolidated CoA is possible. An optional ``entity`` FK restricts a given
  account to a single entity when the user wants entity-specific sub-accounts
  (e.g. "HoldCo Revenue" vs "OpCo Revenue"). Account codes are unique per
  ``(organization, entity)`` pair.

- **FX**: Every entity has a ``functional_currency``. Journal lines are
  captured in a ``transaction_currency`` and a stored ``exchange_rate``
  converts to ``functional_``. FX rates live in a reusable table so the
  same day+pair can be referenced by multiple JEs.

- **Periods are entity-scoped**, not organization-scoped: one entity can be
  closed for April while another is still open.
"""
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from organizations.models import Organization

from .. import constants as c


class Currency(models.Model):
    """ISO 4217 currency registry. Rarely changes. Seeded separately."""

    code = models.CharField(max_length=3, unique=True, help_text="ISO 4217 code, e.g. USD, EUR.")
    name = models.CharField(max_length=100)
    symbol = models.CharField(max_length=10, blank=True)
    decimal_places = models.IntegerField(default=2)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "beakon_currency"
        ordering = ["code"]

    def __str__(self):
        return self.code


class Entity(models.Model):
    """A legal / reporting unit inside a tenant.

    Beakon's multi-entity story hangs off this. Parent links support
    hierarchies (group → sub-group → subsidiary). All journal entries,
    accounts (optionally), and periods tie to one Entity.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="entities"
    )
    code = models.CharField(
        max_length=20,
        help_text="Short code (unique within the organization). E.g. HOLDCO, TRUST-01.",
    )
    name = models.CharField(max_length=255)
    legal_name = models.CharField(max_length=255, blank=True)
    entity_type = models.CharField(
        max_length=50, default=c.ENTITY_COMPANY,
        help_text="Built-in entity type or an org-defined CustomEntityType value.",
    )
    parent = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="children",
    )

    functional_currency = models.CharField(
        max_length=3, default="USD",
        help_text="Currency in which this entity's books are kept and reported.",
    )
    reporting_currency = models.CharField(
        max_length=3, blank=True,
        help_text="Optional presentation currency for consolidated reporting. "
                  "Blank = same as functional_currency.",
    )
    country = models.CharField(max_length=2, default="US")
    accounting_standard = models.CharField(
        max_length=20,
        choices=c.ACCOUNTING_STANDARD_CHOICES,
        default=c.ACCT_STD_IFRS,
        help_text=(
            "Reporting framework this entity's books follow. Drives both how "
            "the AI proposes journal entries (booking conventions) and the "
            "teaching note shown alongside each proposal."
        ),
    )
    fiscal_year_start_month = models.IntegerField(
        default=1,
        help_text="Month (1–12) in which the fiscal year starts.",
    )
    tax_id = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="created_entities",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_entity"
        unique_together = ("organization", "code")
        ordering = ["code"]
        indexes = [
            models.Index(fields=["organization", "is_active"]),
        ]

    def __str__(self):
        return f"{self.code} · {self.name}"


class FXRate(models.Model):
    """Time-series FX rates. Lookup is (from, to, as_of_date).

    Service layer picks the most recent rate on or before the JE date when
    converting transaction amounts to functional currency.
    """

    from_currency = models.CharField(max_length=3)
    to_currency = models.CharField(max_length=3)
    rate = models.DecimalField(
        max_digits=20, decimal_places=10,
        validators=[MinValueValidator(Decimal("0"))],
        help_text="How many units of to_currency = 1 unit of from_currency.",
    )
    as_of = models.DateField()
    source = models.CharField(
        max_length=50, blank=True,
        help_text="Where this rate came from: manual / ecb / openexchange / etc.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "beakon_fxrate"
        unique_together = ("from_currency", "to_currency", "as_of")
        ordering = ["-as_of"]
        indexes = [
            models.Index(fields=["from_currency", "to_currency", "-as_of"]),
        ]

    def __str__(self):
        return f"1 {self.from_currency} = {self.rate} {self.to_currency} on {self.as_of}"


class AccountGroup(models.Model):
    """Hierarchical grouping of accounts for reporting rollups."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_account_groups"
    )
    code = models.CharField(max_length=20, blank=True)
    name = models.CharField(max_length=255)
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="children"
    )
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_accountgroup"
        ordering = ["sort_order", "code"]

    def __str__(self):
        return f"{self.code} · {self.name}" if self.code else self.name


class CoADefinition(models.Model):
    """Versioned chart-of-accounts registry.

    Maps to Thomas's workbook tab `01 CoA Definition`. This is the chart
    identity layer that sits above the actual account rows. Later tabs such
    as dimension rules and mappings should point back to this record.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_coa_definitions"
    )
    coa_id = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    coa_type = models.CharField(max_length=50)
    version_no = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=30, default="Active")
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)
    base_currency = models.CharField(max_length=3, default="USD")
    default_reporting_currency = models.CharField(max_length=3, blank=True)
    additional_reporting_currencies = models.CharField(
        max_length=255, blank=True,
        help_text="Comma-separated ISO currency codes, e.g. USD,EUR",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_coa_definition"
        ordering = ["coa_type", "version_no", "coa_id"]
        unique_together = (
            ("organization", "coa_id"),
            ("organization", "coa_type", "version_no"),
        )
        indexes = [
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "coa_type"]),
        ]

    def __str__(self):
        return f"{self.coa_id} · v{self.version_no}"


class Account(models.Model):
    """Chart-of-Accounts entry.

    ``entity`` is optional: NULL means the account is shared across all
    entities (e.g. a master revenue bucket used on every entity). A non-null
    entity restricts usage to that entity. Code uniqueness is scoped to
    ``(organization, entity_id)`` so every entity can have its own "4000
    Revenue" row if desired.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_accounts"
    )
    coa_definition = models.ForeignKey(
        CoADefinition, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="accounts",
        help_text="Optional versioned CoA this account belongs to.",
    )
    entity = models.ForeignKey(
        Entity, on_delete=models.CASCADE, null=True, blank=True,
        related_name="accounts",
        help_text="Optional. NULL = shared across every entity in the organization.",
    )
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="children"
    )
    group = models.ForeignKey(
        AccountGroup, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="accounts",
    )
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=255)
    short_name = models.CharField(
        max_length=120, blank=True,
        help_text="Workbook Short_Name from 02 CoA Master, when imported.",
    )
    source_account_type = models.CharField(
        max_length=30, blank=True,
        help_text="Raw workbook Account_Type, e.g. HEADER, ASSET, INCOME, MEMO.",
    )
    account_type = models.CharField(max_length=20, choices=c.ACCOUNT_TYPE_CHOICES)
    account_subtype = models.CharField(
        max_length=50, blank=True,
        help_text="Built-in subtype (see constants.ACCOUNT_SUBTYPE_CHOICES) "
                  "or an org-defined CustomAccountSubtype value.",
    )
    normal_balance = models.CharField(
        max_length=6, choices=c.NORMAL_BALANCE_CHOICES, default=c.NORMAL_BALANCE_DEBIT
    )
    currency = models.CharField(
        max_length=3, blank=True,
        help_text="Blank = multi-currency account. A fixed currency restricts "
                  "journal lines against this account to that currency.",
    )
    level_no = models.PositiveIntegerField(null=True, blank=True)
    posting_allowed = models.BooleanField(default=True)
    header_flag = models.BooleanField(default=False)
    mandatory_flag = models.BooleanField(default=False)
    scope = models.CharField(max_length=30, blank=True)
    report_group = models.CharField(max_length=120, blank=True)
    cashflow_category = models.CharField(max_length=120, blank=True)
    required_dimension_type_codes = models.CharField(max_length=255, blank=True)
    optional_dimension_type_codes = models.CharField(max_length=255, blank=True)
    dimension_validation_rule = models.CharField(max_length=255, blank=True)
    universal_map_required = models.BooleanField(default=False)
    default_universal_coa_code = models.CharField(max_length=120, blank=True)
    mapping_method = models.CharField(max_length=120, blank=True)
    fx_revalue_flag = models.BooleanField(default=False)
    tax_relevant_flag = models.BooleanField(default=False)
    monetary_flag = models.BooleanField(default=False)
    workbook_metadata = models.JSONField(
        default=dict, blank=True,
        help_text="Additional workbook columns preserved for later phases.",
    )
    is_active = models.BooleanField(default=True)
    is_system = models.BooleanField(
        default=False,
        help_text="System accounts (AP, AR, retained earnings, FX gain/loss) "
                  "cannot be deleted and usually cannot be posted to directly.",
    )
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_account"
        unique_together = ("organization", "entity", "code")
        ordering = ["code"]
        indexes = [
            models.Index(fields=["organization", "account_type"]),
            models.Index(fields=["organization", "entity", "is_active"]),
            models.Index(fields=["organization", "coa_definition"]),
        ]

    def __str__(self):
        scope = self.entity.code if self.entity_id else "shared"
        return f"[{scope}] {self.code} · {self.name}"

    def save(self, *args, **kwargs):
        # Default normal_balance from account_type when not set.
        if (
            not self.normal_balance
            or (
                self._state.adding
                and self.normal_balance == c.NORMAL_BALANCE_DEBIT
                and c.NORMAL_BALANCE_MAP.get(self.account_type) == c.NORMAL_BALANCE_CREDIT
            )
        ):
            self.normal_balance = c.NORMAL_BALANCE_MAP.get(
                self.account_type, c.NORMAL_BALANCE_DEBIT
            )
        super().save(*args, **kwargs)


class CoAMapping(models.Model):
    """Maps workbook source accounts to universal reporting codes.

    Phase 1 imports Thomas's `03 CoA Mapping` tab here. The mapping is kept
    separate from Account so the operational CoA can stay stable while the
    universal layer evolves.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_coa_mappings"
    )
    coa_definition = models.ForeignKey(
        CoADefinition, on_delete=models.CASCADE, related_name="mappings",
    )
    account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="universal_mappings",
    )
    mapping_id = models.CharField(max_length=80)
    source_account_no = models.CharField(max_length=20)
    source_account_name = models.CharField(max_length=255, blank=True)
    universal_coa_code = models.CharField(max_length=80)
    universal_coa_name = models.CharField(max_length=255, blank=True)
    mapping_type = models.CharField(max_length=30, blank=True)
    mapping_percent = models.DecimalField(
        max_digits=7, decimal_places=4, default=Decimal("100"),
    )
    condition_rule = models.CharField(max_length=255, blank=True)
    required_dimension = models.CharField(max_length=255, blank=True)
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)
    review_status = models.CharField(max_length=30, blank=True)
    approved_by = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_coa_mapping"
        unique_together = ("organization", "mapping_id")
        ordering = ["source_account_no", "mapping_id"]
        indexes = [
            models.Index(fields=["organization", "coa_definition"]),
            models.Index(fields=["organization", "universal_coa_code"]),
        ]

    def __str__(self):
        return f"{self.source_account_no} -> {self.universal_coa_code}"


class DimensionType(models.Model):
    """Reference catalog for dimension codes such as CCY, BANK, CUST, PORT."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_dimension_types"
    )
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    applies_to = models.CharField(max_length=255, blank=True)
    mandatory_flag = models.BooleanField(default=False)
    multi_select_allowed = models.BooleanField(default=False)
    master_data_owner = models.CharField(max_length=120, blank=True)
    hierarchy_allowed = models.BooleanField(default=False)
    active_flag = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_dimension_type"
        unique_together = ("organization", "code")
        ordering = ["code"]
        indexes = [
            models.Index(fields=["organization", "active_flag"]),
        ]

    def __str__(self):
        return f"{self.code} · {self.name}"


class DimensionValue(models.Model):
    """Allowed values for a DimensionType.

    Examples: CCY=CHF, BANK=BANK_CH_MAIN_001, PORT=PORT_MAIN.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_dimension_values"
    )
    dimension_type = models.ForeignKey(
        DimensionType, on_delete=models.CASCADE, related_name="values",
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=255)
    parent_value_code = models.CharField(max_length=80, blank=True)
    description = models.TextField(blank=True)
    active_flag = models.BooleanField(default=True)
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)
    external_reference = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_dimension_value"
        unique_together = ("organization", "dimension_type", "code")
        ordering = ["dimension_type__code", "code"]
        indexes = [
            models.Index(fields=["organization", "active_flag"]),
            models.Index(fields=["organization", "code"]),
        ]

    def __str__(self):
        return f"{self.dimension_type.code}:{self.code}"


class ControlledListEntry(models.Model):
    """Reusable workbook dropdown values from `06 Controlled Lists`."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_controlled_list_entries"
    )
    list_name = models.CharField(max_length=100)
    list_code = models.CharField(max_length=80)
    list_value = models.CharField(max_length=255)
    display_order = models.IntegerField(default=0)
    active_flag = models.BooleanField(default=True)
    description = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_controlled_list_entry"
        unique_together = ("organization", "list_name", "list_code")
        ordering = ["list_name", "display_order", "list_value"]
        indexes = [
            models.Index(fields=["organization", "list_name", "active_flag"]),
        ]

    def __str__(self):
        return f"{self.list_name}:{self.list_code}"


class DimensionValidationRule(models.Model):
    """Posting-time dimension requirements imported from workbook tab 09."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE,
        related_name="beakon_dimension_validation_rules",
    )
    coa_definition = models.ForeignKey(
        CoADefinition, on_delete=models.CASCADE, related_name="dimension_rules",
    )
    account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="dimension_validation_rules",
    )
    rule_id = models.CharField(max_length=80)
    account_no = models.CharField(max_length=20)
    account_name = models.CharField(max_length=255, blank=True)
    rule_type = models.CharField(max_length=80, blank=True)
    trigger_event = models.CharField(max_length=80, blank=True)
    required_dimension_type_codes = models.CharField(max_length=255, blank=True)
    optional_dimension_type_codes = models.CharField(max_length=255, blank=True)
    conditional_dimension_type_codes = models.CharField(max_length=255, blank=True)
    condition_expression = models.TextField(blank=True)
    validation_error_message = models.TextField(blank=True)
    severity = models.CharField(max_length=120, blank=True)
    master_driver = models.CharField(max_length=120, blank=True)
    active_flag = models.BooleanField(default=True)
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    workbook_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_dimension_validation_rule"
        unique_together = ("organization", "rule_id")
        ordering = ["account_no", "rule_id"]
        indexes = [
            models.Index(fields=["organization", "coa_definition"]),
            models.Index(fields=["organization", "account"]),
            models.Index(fields=["organization", "active_flag"]),
        ]

    def __str__(self):
        return f"{self.rule_id} · {self.account_no}"


class CustomAccountSubtype(models.Model):
    """Organization-defined account subtype.

    The five account *types* are an accounting invariant and stay hardcoded.
    Subtypes, by contrast, are a classification layer — each org can add
    their own (e.g. "crypto", "vendor_deposit") without touching code.

    ``value`` is the slug stored in ``Account.account_subtype``; ``label``
    is the human-readable string shown in UIs. Built-in subtypes from
    ``constants.ACCOUNT_SUBTYPE_CHOICES`` take precedence when they collide.
    """
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="custom_account_subtypes"
    )
    account_type = models.CharField(max_length=20, choices=c.ACCOUNT_TYPE_CHOICES)
    value = models.SlugField(max_length=50)
    label = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "beakon_custom_account_subtype"
        unique_together = ("organization", "value")
        ordering = ["account_type", "label"]

    def __str__(self):
        return f"{self.account_type}:{self.value} ({self.label})"


class CustomEntityType(models.Model):
    """Organization-defined entity type.

    Mirrors the custom account subtype pattern so firms can extend the
    built-in family-office vocabulary without a code deployment.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="custom_entity_types"
    )
    value = models.SlugField(max_length=50)
    label = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "beakon_custom_entity_type"
        unique_together = ("organization", "value")
        ordering = ["label"]

    def __str__(self):
        return self.label


class Period(models.Model):
    """Accounting period, scoped to one entity.

    Period status controls what can happen:
      open        — accepts new JEs; lines can post
      soft_close  — blocks new JE creation; reversals of already-posted
                    entries still allowed (for late corrections)
      closed      — fully locked; no writes of any kind
    """

    entity = models.ForeignKey(
        Entity, on_delete=models.CASCADE, related_name="periods"
    )
    name = models.CharField(max_length=100, help_text="Human label, e.g. 'April 2026'.")
    period_type = models.CharField(
        max_length=20, choices=c.PERIOD_TYPE_CHOICES, default=c.PERIOD_MONTH
    )
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(
        max_length=20, choices=c.PERIOD_STATUS_CHOICES, default=c.PERIOD_OPEN
    )
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="beakon_closed_periods",
    )
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beakon_period"
        unique_together = ("entity", "start_date", "end_date")
        ordering = ["-start_date"]
        indexes = [
            models.Index(fields=["entity", "status"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F("start_date")),
                name="beakon_period_dates_ordered",
            ),
        ]

    def __str__(self):
        return f"{self.entity.code} · {self.name} ({self.status})"

    def contains(self, d):
        return self.start_date <= d <= self.end_date
