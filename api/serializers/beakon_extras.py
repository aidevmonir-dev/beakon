"""Serializers for Tax / Disbursement / Closing / Recognition / VAT — the
frontend-catch-up bundle for backend builds #1–#4.
"""
from rest_framework import serializers

from beakon_core.models import (
    Account,
    Commitment,
    JournalLine,
    Pension,
    RecognitionRule,
    RecognitionSchedule,
    TaxCode,
    WorkflowDiagram,
)


# ── TaxCode ─────────────────────────────────────────────────────────

class TaxCodeSerializer(serializers.ModelSerializer):
    output_account_code = serializers.SerializerMethodField()
    input_account_code = serializers.SerializerMethodField()

    class Meta:
        model = TaxCode
        fields = (
            "id", "code", "name", "country_code", "tax_type", "rate",
            "output_account", "output_account_code",
            "input_account", "input_account_code",
            "is_reverse_charge", "effective_from", "effective_to",
            "active_flag", "notes",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "output_account_code", "input_account_code",
                            "created_at", "updated_at")

    def get_output_account_code(self, obj):
        return _account_label(obj.output_account)

    def get_input_account_code(self, obj):
        return _account_label(obj.input_account)


def _account_label(account):
    if account is None:
        return None
    return f"{account.code} · {account.name}"


# ── Disbursement ────────────────────────────────────────────────────

class PendingRebillableLineSerializer(serializers.ModelSerializer):
    """Read-only view of a rebillable JournalLine waiting to be invoiced."""

    journal_entry_number = serializers.SerializerMethodField()
    journal_entry_date = serializers.SerializerMethodField()
    journal_entry_id = serializers.IntegerField(source="journal_entry.id", read_only=True)
    account_code = serializers.SerializerMethodField()
    account_name = serializers.SerializerMethodField()
    client_code = serializers.SerializerMethodField()
    client_name = serializers.SerializerMethodField()
    entity_id = serializers.IntegerField(source="journal_entry.entity_id", read_only=True)
    entity_code = serializers.SerializerMethodField()

    class Meta:
        model = JournalLine
        fields = (
            "id",
            "journal_entry", "journal_entry_id", "journal_entry_number",
            "journal_entry_date",
            "entity_id", "entity_code",
            "account", "account_code", "account_name",
            "description",
            "debit", "credit", "currency",
            "rebill_client_dimension_value", "client_code", "client_name",
        )
        read_only_fields = fields

    def get_journal_entry_number(self, obj):
        return obj.journal_entry.entry_number

    def get_journal_entry_date(self, obj):
        return obj.journal_entry.date.isoformat() if obj.journal_entry.date else None

    def get_account_code(self, obj):
        return obj.account.code

    def get_account_name(self, obj):
        return obj.account.name

    def get_client_code(self, obj):
        return obj.rebill_client_dimension_value.code if obj.rebill_client_dimension_value_id else None

    def get_client_name(self, obj):
        return obj.rebill_client_dimension_value.name if obj.rebill_client_dimension_value_id else None

    def get_entity_code(self, obj):
        return obj.journal_entry.entity.code


class CreateDisbursementInvoiceSerializer(serializers.Serializer):
    entity = serializers.IntegerField()
    customer = serializers.IntegerField()
    journal_line_ids = serializers.ListField(
        child=serializers.IntegerField(), allow_empty=False,
    )
    invoice_date = serializers.DateField()
    due_date = serializers.DateField(required=False, allow_null=True)
    recovery_account = serializers.IntegerField(
        required=False, allow_null=True,
        help_text="Optional GL account for gross-method recovery; default = source line's expense account.",
    )
    description = serializers.CharField(required=False, allow_blank=True, max_length=2000)


# ── Closing ─────────────────────────────────────────────────────────

class ClosePeriodSerializer(serializers.Serializer):
    retained_earnings_account = serializers.IntegerField(
        required=False, allow_null=True,
        help_text="Optional override; default = first active retained_earnings account on the entity.",
    )
    memo = serializers.CharField(required=False, allow_blank=True, max_length=2000)


# ── Recognition ─────────────────────────────────────────────────────

class RecognitionScheduleSerializer(serializers.ModelSerializer):
    posted_journal_entry_number = serializers.SerializerMethodField()
    is_posted = serializers.BooleanField(read_only=True)

    class Meta:
        model = RecognitionSchedule
        fields = (
            "id", "rule", "sequence",
            "period_start", "period_end", "amount",
            "posted_journal_entry", "posted_journal_entry_number",
            "posted_at", "posted_by",
            "is_posted",
        )
        read_only_fields = fields

    def get_posted_journal_entry_number(self, obj):
        return obj.posted_journal_entry.entry_number if obj.posted_journal_entry_id else None


class RecognitionRuleSummarySerializer(serializers.ModelSerializer):
    entity_code = serializers.SerializerMethodField()
    deferral_account_code = serializers.SerializerMethodField()
    recognition_account_code = serializers.SerializerMethodField()
    remaining_amount = serializers.DecimalField(
        max_digits=19, decimal_places=4, read_only=True,
    )

    class Meta:
        model = RecognitionRule
        fields = (
            "id", "code", "name",
            "entity", "entity_code",
            "rule_type", "currency",
            "total_amount", "recognized_to_date", "remaining_amount",
            "start_date", "end_date", "period_type", "method",
            "deferral_account", "deferral_account_code",
            "recognition_account", "recognition_account_code",
            "status",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "entity_code", "deferral_account_code",
                            "recognition_account_code", "recognized_to_date",
                            "remaining_amount", "created_at", "updated_at")

    def get_entity_code(self, obj):
        return obj.entity.code

    def get_deferral_account_code(self, obj):
        return _account_label(obj.deferral_account)

    def get_recognition_account_code(self, obj):
        return _account_label(obj.recognition_account)


class RecognitionRuleDetailSerializer(RecognitionRuleSummarySerializer):
    schedule = RecognitionScheduleSerializer(
        many=True, read_only=True, source="schedule_periods",
    )

    class Meta(RecognitionRuleSummarySerializer.Meta):
        fields = RecognitionRuleSummarySerializer.Meta.fields + (
            "source_bill_line", "source_invoice_line", "source_journal_line",
            "notes", "schedule",
            "cancelled_by", "cancelled_at",
            "created_by",
        )
        read_only_fields = fields


class CreateRecognitionRuleSerializer(serializers.Serializer):
    entity = serializers.IntegerField()
    code = serializers.CharField(max_length=80)
    name = serializers.CharField(max_length=255)
    rule_type = serializers.CharField(max_length=20)
    total_amount = serializers.DecimalField(max_digits=19, decimal_places=4)
    currency = serializers.CharField(max_length=3)
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    period_type = serializers.CharField(max_length=12, required=False)
    method = serializers.CharField(max_length=32, required=False)
    deferral_account = serializers.IntegerField()
    recognition_account = serializers.IntegerField()
    source_bill_line = serializers.IntegerField(required=False, allow_null=True)
    source_invoice_line = serializers.IntegerField(required=False, allow_null=True)
    source_journal_line = serializers.IntegerField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class RunRecognitionSerializer(serializers.Serializer):
    as_of = serializers.DateField()


# ── VAT report ───────────────────────────────────────────────────────

class VATReportRequestSerializer(serializers.Serializer):
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    entity = serializers.IntegerField(required=False, allow_null=True)


# ── Pension ─────────────────────────────────────────────────────────

class PensionSerializer(serializers.ModelSerializer):
    holder_related_party_label = serializers.SerializerMethodField()
    provider_counterparty_label = serializers.SerializerMethodField()
    employer_counterparty_label = serializers.SerializerMethodField()
    linked_portfolio_label = serializers.SerializerMethodField()
    linked_bank_account_label = serializers.SerializerMethodField()

    class Meta:
        model = Pension
        fields = (
            "id", "pension_id", "pension_name", "short_name",
            "pension_type", "pension_subtype",
            "holder_related_party_id_code", "holder_related_party",
            "holder_related_party_label",
            "provider_counterparty_id_code", "provider_counterparty",
            "provider_counterparty_label",
            "employer_counterparty_id_code", "employer_counterparty",
            "employer_counterparty_label",
            "plan_number_masked",
            "contribution_basis", "vesting_status",
            "country_code", "jurisdiction_code",
            "pension_currency", "reporting_currency",
            "enrollment_date", "earliest_withdrawal_date",
            "expected_retirement_date", "payout_start_date", "closure_date",
            "contributions_to_date", "vested_balance", "projected_benefit",
            "employer_contribution_rate", "employee_contribution_rate",
            "linked_portfolio_id_code", "linked_portfolio", "linked_portfolio_label",
            "linked_bank_account_id_code", "linked_bank_account", "linked_bank_account_label",
            "tax_privileged_flag", "employer_sponsored_flag",
            "net_worth_inclusion_flag",
            "status", "active_flag", "posting_allowed_flag",
            "approval_required_flag", "source_document_required_flag",
            "notes", "workbook_metadata",
            "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "holder_related_party_label", "provider_counterparty_label",
            "employer_counterparty_label", "linked_portfolio_label",
            "linked_bank_account_label", "created_at", "updated_at",
        )

    def get_holder_related_party_label(self, obj):
        return obj.holder_related_party.related_party_name if obj.holder_related_party_id else None

    def get_provider_counterparty_label(self, obj):
        return obj.provider_counterparty.counterparty_name if obj.provider_counterparty_id else None

    def get_employer_counterparty_label(self, obj):
        return obj.employer_counterparty.counterparty_name if obj.employer_counterparty_id else None

    def get_linked_portfolio_label(self, obj):
        return obj.linked_portfolio.portfolio_name if obj.linked_portfolio_id else None

    def get_linked_bank_account_label(self, obj):
        return obj.linked_bank_account.bank_account_name if obj.linked_bank_account_id else None


# ── Commitment ──────────────────────────────────────────────────────

class CommitmentSerializer(serializers.ModelSerializer):
    holder_related_party_label = serializers.SerializerMethodField()
    general_partner_counterparty_label = serializers.SerializerMethodField()
    vehicle_instrument_label = serializers.SerializerMethodField()
    linked_portfolio_label = serializers.SerializerMethodField()
    funding_bank_account_label = serializers.SerializerMethodField()

    class Meta:
        model = Commitment
        fields = (
            "id", "commitment_id", "commitment_name", "short_name",
            "commitment_type", "commitment_subtype",
            "holder_related_party_id_code", "holder_related_party",
            "holder_related_party_label",
            "general_partner_counterparty_id_code", "general_partner_counterparty",
            "general_partner_counterparty_label",
            "vehicle_instrument_id_code", "vehicle_instrument",
            "vehicle_instrument_label",
            "country_code", "jurisdiction_code",
            "commitment_currency", "reporting_currency",
            "vintage_year", "inception_date", "final_close_date",
            "investment_period_end_date", "expected_term_years",
            "expiry_date", "closure_date",
            "total_commitment_amount", "called_to_date",
            "distributions_to_date", "unfunded_balance",
            "nav", "nav_date",
            "management_fee_rate", "carried_interest_rate", "hurdle_rate",
            "linked_portfolio_id_code", "linked_portfolio", "linked_portfolio_label",
            "funding_bank_account_id_code", "funding_bank_account",
            "funding_bank_account_label",
            "recallable_distributions_flag", "net_worth_inclusion_flag",
            "status", "active_flag", "posting_allowed_flag",
            "approval_required_flag", "source_document_required_flag",
            "notes", "workbook_metadata",
            "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "holder_related_party_label", "general_partner_counterparty_label",
            "vehicle_instrument_label", "linked_portfolio_label",
            "funding_bank_account_label", "created_at", "updated_at",
        )

    def get_holder_related_party_label(self, obj):
        return obj.holder_related_party.related_party_name if obj.holder_related_party_id else None

    def get_general_partner_counterparty_label(self, obj):
        return obj.general_partner_counterparty.counterparty_name if obj.general_partner_counterparty_id else None

    def get_vehicle_instrument_label(self, obj):
        return obj.vehicle_instrument.instrument_name if obj.vehicle_instrument_id else None

    def get_linked_portfolio_label(self, obj):
        return obj.linked_portfolio.portfolio_name if obj.linked_portfolio_id else None

    def get_funding_bank_account_label(self, obj):
        return obj.funding_bank_account.bank_account_name if obj.funding_bank_account_id else None


# ── Workflow diagram (editable Mermaid) ─────────────────────────────

class WorkflowDiagramSerializer(serializers.ModelSerializer):
    updated_by_email = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowDiagram
        fields = (
            "id", "code", "name", "description", "mermaid_src",
            "updated_by", "updated_by_email", "updated_at", "created_at",
        )
        read_only_fields = ("id", "code", "updated_by", "updated_by_email",
                            "updated_at", "created_at")

    def get_updated_by_email(self, obj):
        return obj.updated_by.email if obj.updated_by_id else None
