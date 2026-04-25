"""DRF serializers for the Beakon accounting kernel.

Rule: all write paths go through ``beakon_core.services``. These serializers
expose shape only — they never bypass the JournalService state machine.
"""
from decimal import Decimal

from rest_framework import serializers

from beakon_core import constants as bc
from beakon_core.models import (
    Account,
    AccountGroup,
    ApprovalAction,
    Bill,
    BillLine,
    Currency,
    CoADefinition,
    CustomAccountSubtype,
    CustomEntityType,
    Customer,
    Entity,
    FXRate,
    IntercompanyGroup,
    Invoice,
    InvoiceLine,
    JournalEntry,
    JournalLine,
    Period,
    Vendor,
)


# ── Reference data ──────────────────────────────────────────────────────────

class CurrencySerializer(serializers.ModelSerializer):
    class Meta:
        model = Currency
        fields = ("code", "name", "symbol", "decimal_places", "is_active")


class FXRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = FXRate
        fields = ("id", "from_currency", "to_currency", "rate", "as_of", "source", "created_at")
        read_only_fields = ("id", "created_at")


# ── Entity ──────────────────────────────────────────────────────────────────

class EntitySerializer(serializers.ModelSerializer):
    parent_code = serializers.SerializerMethodField()

    class Meta:
        model = Entity
        fields = (
            "id", "code", "name", "legal_name", "entity_type",
            "parent", "parent_code",
            "functional_currency", "reporting_currency",
            "country", "accounting_standard",
            "fiscal_year_start_month", "tax_id", "notes",
            "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("id", "parent_code", "created_at", "updated_at")

    def validate_accounting_standard(self, v: str) -> str:
        # Empty / missing → fall back to a country-aware default. Done in the
        # serializer (not the model default) so the AI proposal flow always
        # has a usable value even if old API clients omit it.
        value = (v or "").strip().lower() or bc.ACCT_STD_IFRS
        valid = {code for code, _ in bc.ACCOUNTING_STANDARD_CHOICES}
        if value not in valid:
            raise serializers.ValidationError(
                f"Unknown accounting standard '{v}'. "
                f"Choose one of: {sorted(valid)}."
            )
        return value

    def get_parent_code(self, obj):
        return obj.parent.code if obj.parent_id else None

    def validate_entity_type(self, v: str) -> str:
        value = (v or "").strip().lower()
        if not value:
            raise serializers.ValidationError("Entity type is required.")
        builtins = {code for code, _ in bc.ENTITY_TYPE_CHOICES}
        if value in builtins:
            return value

        request = self.context.get("request")
        org = getattr(request, "organization", None)
        if org and CustomEntityType.objects.filter(organization=org, value=value).exists():
            return value
        raise serializers.ValidationError("Unknown entity type for this organization.")


# ── Chart of Accounts ───────────────────────────────────────────────────────

class AccountGroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountGroup
        fields = ("id", "code", "name", "parent", "sort_order", "created_at")
        read_only_fields = ("id", "created_at")


class CoADefinitionSerializer(serializers.ModelSerializer):
    account_count = serializers.SerializerMethodField()

    class Meta:
        model = CoADefinition
        fields = (
            "id", "coa_id", "name", "coa_type", "version_no", "status",
            "effective_from", "effective_to",
            "base_currency", "default_reporting_currency",
            "additional_reporting_currencies", "notes",
            "account_count", "created_at", "updated_at",
        )
        read_only_fields = ("id", "account_count", "created_at", "updated_at")

    def get_account_count(self, obj):
        return obj.accounts.count()


class AccountSerializer(serializers.ModelSerializer):
    entity_code = serializers.SerializerMethodField()
    coa_definition_code = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = (
            "id", "code", "name", "entity", "entity_code",
            "coa_definition", "coa_definition_code",
            "account_type", "account_subtype", "normal_balance",
            "currency", "parent", "group",
            "is_active", "is_system", "description",
            "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "entity_code", "coa_definition_code", "is_system",
            "created_at", "updated_at",
        )

    def get_entity_code(self, obj):
        return obj.entity.code if obj.entity_id else None

    def get_coa_definition_code(self, obj):
        if not obj.coa_definition_id:
            return None
        return obj.coa_definition.coa_id


class CustomAccountSubtypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomAccountSubtype
        fields = ("id", "account_type", "value", "label", "created_at")
        read_only_fields = ("id", "created_at")

    def validate_value(self, v: str) -> str:
        # Slug the value to protect against collisions + keep URLs clean.
        import re
        v = re.sub(r"[^a-z0-9]+", "_", v.strip().lower()).strip("_")
        if not v:
            raise serializers.ValidationError("Value must contain letters or digits.")
        return v


class CustomEntityTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomEntityType
        fields = ("id", "value", "label", "created_at")
        read_only_fields = ("id", "created_at")

    def validate_value(self, v: str) -> str:
        import re
        v = re.sub(r"[^a-z0-9]+", "_", v.strip().lower()).strip("_")
        if not v:
            raise serializers.ValidationError("Value must contain letters or digits.")
        return v


# ── Period ──────────────────────────────────────────────────────────────────

class PeriodSerializer(serializers.ModelSerializer):
    entity_code = serializers.SerializerMethodField()

    class Meta:
        model = Period
        fields = (
            "id", "entity", "entity_code", "name", "period_type",
            "start_date", "end_date", "status",
            "closed_by", "closed_at", "created_at", "updated_at",
        )
        read_only_fields = ("id", "entity_code", "status", "closed_by",
                            "closed_at", "created_at", "updated_at")

    def get_entity_code(self, obj):
        return obj.entity.code


# ── Intercompany group ──────────────────────────────────────────────────────

class VendorSerializer(serializers.ModelSerializer):
    default_expense_account_code = serializers.SerializerMethodField()

    class Meta:
        model = Vendor
        fields = (
            "id", "code", "name", "legal_name", "tax_id",
            "email", "phone", "website",
            "address_line1", "address_line2", "city", "state", "postal_code", "country",
            "default_currency", "default_payment_terms_days",
            "default_expense_account", "default_expense_account_code",
            "bank_details", "is_active", "notes",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at", "default_expense_account_code")

    def get_default_expense_account_code(self, obj):
        if obj.default_expense_account_id:
            return f"{obj.default_expense_account.code} · {obj.default_expense_account.name}"
        return None


class CustomerSerializer(serializers.ModelSerializer):
    default_revenue_account_code = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = (
            "id", "code", "name", "legal_name", "tax_id",
            "email", "phone", "website",
            "address_line1", "address_line2", "city", "state", "postal_code", "country",
            "default_currency", "default_payment_terms_days",
            "default_revenue_account", "default_revenue_account_code",
            "credit_limit", "is_active", "notes",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at", "default_revenue_account_code")

    def get_default_revenue_account_code(self, obj):
        if obj.default_revenue_account_id:
            return f"{obj.default_revenue_account.code} · {obj.default_revenue_account.name}"
        return None


# ── Bills (AP) ──────────────────────────────────────────────────────────────

class BillLineSerializer(serializers.ModelSerializer):
    expense_account_code = serializers.SerializerMethodField()
    expense_account_name = serializers.SerializerMethodField()

    class Meta:
        model = BillLine
        fields = ("id", "expense_account", "expense_account_code", "expense_account_name",
                  "description", "quantity", "unit_price", "amount", "line_order")
        read_only_fields = ("id", "expense_account_code", "expense_account_name")

    def get_expense_account_code(self, obj):
        return obj.expense_account.code

    def get_expense_account_name(self, obj):
        return obj.expense_account.name


class BillSummarySerializer(serializers.ModelSerializer):
    entity_code = serializers.SerializerMethodField()
    vendor_code = serializers.SerializerMethodField()
    vendor_name = serializers.SerializerMethodField()

    class Meta:
        model = Bill
        fields = (
            "id", "reference", "bill_number", "entity", "entity_code",
            "vendor", "vendor_code", "vendor_name",
            "invoice_date", "due_date", "currency",
            "subtotal", "tax_amount", "total",
            "status",
            "accrual_journal_entry", "payment_journal_entry",
            "payment_date",
            "created_at", "updated_at",
        )
        read_only_fields = fields

    def get_entity_code(self, obj):
        return obj.entity.code

    def get_vendor_code(self, obj):
        return obj.vendor.code

    def get_vendor_name(self, obj):
        return obj.vendor.name


class BillDetailSerializer(BillSummarySerializer):
    lines = BillLineSerializer(many=True, read_only=True)
    accrual_journal_entry_number = serializers.SerializerMethodField()
    payment_journal_entry_number = serializers.SerializerMethodField()
    payment_bank_account_code = serializers.SerializerMethodField()

    class Meta(BillSummarySerializer.Meta):
        fields = BillSummarySerializer.Meta.fields + (
            "description", "notes", "lines",
            "accrual_journal_entry_number", "payment_journal_entry_number",
            "payment_bank_account", "payment_bank_account_code", "payment_reference",
            "submitted_by", "submitted_at",
            "approved_by", "approved_at",
            "rejected_by", "rejected_at", "rejection_reason",
            "paid_by", "paid_at",
            "cancelled_by", "cancelled_at",
            "created_by",
        )
        read_only_fields = fields

    def get_accrual_journal_entry_number(self, obj):
        return obj.accrual_journal_entry.entry_number if obj.accrual_journal_entry_id else None

    def get_payment_journal_entry_number(self, obj):
        return obj.payment_journal_entry.entry_number if obj.payment_journal_entry_id else None

    def get_payment_bank_account_code(self, obj):
        return f"{obj.payment_bank_account.code} · {obj.payment_bank_account.name}" \
            if obj.payment_bank_account_id else None


class BillCreateSerializer(serializers.Serializer):
    entity = serializers.IntegerField()
    vendor = serializers.IntegerField()
    invoice_date = serializers.DateField()
    due_date = serializers.DateField(required=False, allow_null=True)
    bill_number = serializers.CharField(required=False, allow_blank=True, max_length=100)
    currency = serializers.CharField(required=False, allow_blank=True, max_length=3)
    description = serializers.CharField(required=False, allow_blank=True)
    tax_amount = serializers.DecimalField(max_digits=19, decimal_places=4, required=False)
    lines = serializers.ListField(child=serializers.DictField(), allow_empty=False)


class BillPaymentSerializer(serializers.Serializer):
    payment_date = serializers.DateField()
    bank_account = serializers.IntegerField()
    reference = serializers.CharField(required=False, allow_blank=True, max_length=255)


class BillRejectSerializer(serializers.Serializer):
    reason = serializers.CharField(allow_blank=True, max_length=2000)


# ── Invoices (AR) ───────────────────────────────────────────────────────────

class InvoiceLineSerializer(serializers.ModelSerializer):
    revenue_account_code = serializers.SerializerMethodField()
    revenue_account_name = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceLine
        fields = ("id", "revenue_account", "revenue_account_code", "revenue_account_name",
                  "description", "quantity", "unit_price", "amount", "line_order")
        read_only_fields = ("id", "revenue_account_code", "revenue_account_name")

    def get_revenue_account_code(self, obj):
        return obj.revenue_account.code

    def get_revenue_account_name(self, obj):
        return obj.revenue_account.name


class InvoiceSummarySerializer(serializers.ModelSerializer):
    entity_code = serializers.SerializerMethodField()
    customer_code = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = (
            "id", "reference", "invoice_number", "entity", "entity_code",
            "customer", "customer_code", "customer_name",
            "invoice_date", "due_date", "currency",
            "subtotal", "tax_amount", "total",
            "status",
            "issued_journal_entry", "payment_journal_entry",
            "payment_date",
            "created_at", "updated_at",
        )
        read_only_fields = fields

    def get_entity_code(self, obj):
        return obj.entity.code

    def get_customer_code(self, obj):
        return obj.customer.code

    def get_customer_name(self, obj):
        return obj.customer.name


class InvoiceDetailSerializer(InvoiceSummarySerializer):
    lines = InvoiceLineSerializer(many=True, read_only=True)
    issued_journal_entry_number = serializers.SerializerMethodField()
    payment_journal_entry_number = serializers.SerializerMethodField()
    payment_bank_account_code = serializers.SerializerMethodField()

    class Meta(InvoiceSummarySerializer.Meta):
        fields = InvoiceSummarySerializer.Meta.fields + (
            "description", "notes", "lines",
            "issued_journal_entry_number", "payment_journal_entry_number",
            "payment_bank_account", "payment_bank_account_code", "payment_reference",
            "submitted_by", "submitted_at",
            "issued_by", "issued_at",
            "rejected_by", "rejected_at", "rejection_reason",
            "paid_by", "paid_at",
            "cancelled_by", "cancelled_at",
            "created_by",
        )
        read_only_fields = fields

    def get_issued_journal_entry_number(self, obj):
        return obj.issued_journal_entry.entry_number if obj.issued_journal_entry_id else None

    def get_payment_journal_entry_number(self, obj):
        return obj.payment_journal_entry.entry_number if obj.payment_journal_entry_id else None

    def get_payment_bank_account_code(self, obj):
        return f"{obj.payment_bank_account.code} · {obj.payment_bank_account.name}" \
            if obj.payment_bank_account_id else None


class InvoiceCreateSerializer(serializers.Serializer):
    entity = serializers.IntegerField()
    customer = serializers.IntegerField()
    invoice_date = serializers.DateField()
    due_date = serializers.DateField(required=False, allow_null=True)
    invoice_number = serializers.CharField(required=False, allow_blank=True, max_length=100)
    currency = serializers.CharField(required=False, allow_blank=True, max_length=3)
    description = serializers.CharField(required=False, allow_blank=True)
    tax_amount = serializers.DecimalField(max_digits=19, decimal_places=4, required=False)
    lines = serializers.ListField(child=serializers.DictField(), allow_empty=False)


class InvoicePaymentSerializer(serializers.Serializer):
    payment_date = serializers.DateField()
    bank_account = serializers.IntegerField()
    reference = serializers.CharField(required=False, allow_blank=True, max_length=255)


class InvoiceRejectSerializer(serializers.Serializer):
    reason = serializers.CharField(allow_blank=True, max_length=2000)


class IntercompanyGroupSerializer(serializers.ModelSerializer):
    member_entries = serializers.SerializerMethodField()
    entry_count = serializers.SerializerMethodField()

    class Meta:
        model = IntercompanyGroup
        fields = ("id", "reference", "description",
                  "created_by", "created_at", "updated_at",
                  "entry_count", "member_entries")
        read_only_fields = ("id", "created_by", "created_at", "updated_at",
                            "entry_count", "member_entries")

    def get_entry_count(self, obj):
        return obj.journal_entries.count()

    def get_member_entries(self, obj):
        return [
            {
                "id": je.id,
                "entry_number": je.entry_number,
                "entity_code": je.entity.code,
                "date": str(je.date),
                "status": je.status,
                "currency": je.currency,
                "total": str(je.total_debit_functional),
            }
            for je in obj.journal_entries.select_related("entity").order_by("date", "entry_number")
        ]


# ── Journal Entry ───────────────────────────────────────────────────────────

class JournalLineSerializer(serializers.ModelSerializer):
    account_code = serializers.SerializerMethodField()
    account_name = serializers.SerializerMethodField()
    counterparty_entity_code = serializers.SerializerMethodField()

    class Meta:
        model = JournalLine
        fields = (
            "id", "account", "account_code", "account_name",
            "description", "debit", "credit", "currency",
            "exchange_rate", "functional_debit", "functional_credit",
            "counterparty_entity", "counterparty_entity_code",
            "dimension_bank_code", "dimension_custodian_code",
            "dimension_portfolio_code", "dimension_instrument_code",
            "dimension_strategy_code", "dimension_asset_class_code",
            "dimension_maturity_code",
            "line_order",
        )
        read_only_fields = (
            "id", "account_code", "account_name", "counterparty_entity_code",
            "functional_debit", "functional_credit",
        )

    def get_account_code(self, obj):
        return obj.account.code

    def get_account_name(self, obj):
        return obj.account.name

    def get_counterparty_entity_code(self, obj):
        return obj.counterparty_entity.code if obj.counterparty_entity_id else None


class JournalLineInputSerializer(serializers.Serializer):
    """Shape accepted by JournalService.create_draft() / replace_lines()."""
    account_id = serializers.IntegerField()
    description = serializers.CharField(required=False, allow_blank=True, default="")
    debit = serializers.DecimalField(max_digits=19, decimal_places=4, default=Decimal("0"))
    credit = serializers.DecimalField(max_digits=19, decimal_places=4, default=Decimal("0"))
    currency = serializers.CharField(required=False, max_length=3)
    exchange_rate = serializers.DecimalField(
        max_digits=20, decimal_places=10, required=False,
    )
    counterparty_entity_id = serializers.IntegerField(required=False, allow_null=True)
    dimension_bank_code = serializers.CharField(required=False, allow_blank=True, max_length=50)
    dimension_custodian_code = serializers.CharField(required=False, allow_blank=True, max_length=50)
    dimension_portfolio_code = serializers.CharField(required=False, allow_blank=True, max_length=50)
    dimension_instrument_code = serializers.CharField(required=False, allow_blank=True, max_length=50)
    dimension_strategy_code = serializers.CharField(required=False, allow_blank=True, max_length=50)
    dimension_asset_class_code = serializers.CharField(required=False, allow_blank=True, max_length=50)
    dimension_maturity_code = serializers.CharField(required=False, allow_blank=True, max_length=50)
    line_order = serializers.IntegerField(required=False)


class JournalEntrySummarySerializer(serializers.ModelSerializer):
    """Light shape for list views."""

    entity_code = serializers.SerializerMethodField()
    period_name = serializers.SerializerMethodField()
    vendor_code = serializers.SerializerMethodField()
    vendor_name = serializers.SerializerMethodField()
    customer_code = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()

    class Meta:
        model = JournalEntry
        fields = (
            "id", "entry_number", "entity", "entity_code", "date",
            "status", "source_type", "source_ref", "memo",
            "currency", "total_debit_functional", "total_credit_functional",
            "period", "period_name",
            "vendor", "vendor_code", "vendor_name",
            "customer", "customer_code", "customer_name",
            "created_by", "approved_by", "posted_by",
            "created_at", "updated_at",
        )
        read_only_fields = fields

    def get_entity_code(self, obj):
        return obj.entity.code

    def get_period_name(self, obj):
        return obj.period.name if obj.period_id else None

    def get_vendor_code(self, obj):
        return obj.vendor.code if obj.vendor_id else None

    def get_vendor_name(self, obj):
        return obj.vendor.name if obj.vendor_id else None

    def get_customer_code(self, obj):
        return obj.customer.code if obj.customer_id else None

    def get_customer_name(self, obj):
        return obj.customer.name if obj.customer_id else None


class ApprovalActionSerializer(serializers.ModelSerializer):
    actor_email = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalAction
        fields = ("id", "journal_entry", "action", "from_status", "to_status",
                  "actor", "actor_email", "note", "at")
        read_only_fields = fields

    def get_actor_email(self, obj):
        return obj.actor.email if obj.actor_id else None


class JournalEntryDetailSerializer(JournalEntrySummarySerializer):
    """Full detail — for retrieve and drill-down."""
    lines = JournalLineSerializer(many=True, read_only=True)
    approval_history = serializers.SerializerMethodField()
    reversal_of_number = serializers.SerializerMethodField()
    ai_metadata = serializers.SerializerMethodField()

    class Meta(JournalEntrySummarySerializer.Meta):
        fields = JournalEntrySummarySerializer.Meta.fields + (
            "reference", "reversal_of", "reversal_of_number",
            "intercompany_group", "counterparty_entity",
            "submitted_for_approval_by", "submitted_for_approval_at",
            "approved_at", "rejected_by", "rejected_at", "rejection_reason",
            "posted_at",
            "lines", "approval_history", "ai_metadata",
        )
        read_only_fields = fields

    def get_approval_history(self, obj):
        qs = obj.approval_actions.select_related("actor").order_by("at")
        return ApprovalActionSerializer(qs, many=True).data

    def get_ai_metadata(self, obj):
        """Surface the AI extraction's reasoning so the JE detail page can
        show the standards-based teaching note. Reads from the audit event
        the drafting service writes — keeps JournalEntry's schema clean
        (no JSON blob field) while still making the data available.
        """
        from audit.models import AuditEvent
        evt = (
            AuditEvent.objects
            .filter(
                organization=obj.organization_id,
                object_type="JournalEntry",
                object_id=obj.id,
                actor_type="ai",
            )
            .order_by("-created_at")
            .first()
        )
        if not evt:
            return None
        md = evt.metadata or {}
        return {
            "source": md.get("source"),
            "model": md.get("model"),
            "mode": md.get("mode"),
            "confidence": md.get("confidence"),
            "confidence_in_account": md.get("confidence_in_account"),
            "suggested_account_reasoning": md.get("suggested_account_reasoning"),
            "accounting_standard_reasoning": md.get("accounting_standard_reasoning"),
            "entity_accounting_standard": md.get("entity_accounting_standard"),
            "warnings": md.get("warnings") or [],
        }

    def get_reversal_of_number(self, obj):
        return obj.reversal_of.entry_number if obj.reversal_of_id else None


class JournalEntryCreateSerializer(serializers.Serializer):
    """Body shape for POST /journal-entries/."""
    entity_id = serializers.IntegerField()
    date = serializers.DateField()
    memo = serializers.CharField(required=False, allow_blank=True, default="")
    reference = serializers.CharField(required=False, allow_blank=True, default="")
    currency = serializers.CharField(required=False, max_length=3, default=None, allow_null=True)
    source_type = serializers.CharField(required=False, allow_blank=True)
    source_ref = serializers.CharField(required=False, allow_blank=True)
    source_id = serializers.IntegerField(required=False, allow_null=True)
    intercompany_group_id = serializers.IntegerField(required=False, allow_null=True)
    counterparty_entity_id = serializers.IntegerField(required=False, allow_null=True)
    lines = JournalLineInputSerializer(many=True, min_length=2)


class JournalEntryReverseSerializer(serializers.Serializer):
    reversal_date = serializers.DateField()
    memo = serializers.CharField(required=False, allow_blank=True, default="")


class JournalEntryNoteSerializer(serializers.Serializer):
    """Shared shape for submit/approve/return_to_draft/post where an optional
    note is all the caller passes. Reject uses ``reason`` instead."""
    note = serializers.CharField(required=False, allow_blank=True, default="")


class JournalEntryRejectSerializer(serializers.Serializer):
    reason = serializers.CharField()


class PeriodCloseSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["soft_close", "closed"], default="closed")
    note = serializers.CharField(required=False, allow_blank=True, default="")
