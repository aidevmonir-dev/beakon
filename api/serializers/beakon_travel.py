"""DRF serializers for Travel & Expense."""
from decimal import Decimal

from rest_framework import serializers

from beakon_travel.models import TripClaim, TripExpense


class TripExpenseSerializer(serializers.ModelSerializer):
    category_label = serializers.SerializerMethodField()

    class Meta:
        model = TripExpense
        fields = (
            "id", "claim", "date", "category", "category_label",
            "description", "merchant",
            "amount", "currency", "fx_rate", "amount_in_claim_currency",
            "vat_amount", "receipt_url", "billable_to_client",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "category_label", "created_at", "updated_at")

    def get_category_label(self, obj):
        return obj.get_category_display()

    def validate(self, attrs):
        # Default `amount_in_claim_currency` to `amount` when same currency
        # and no fx_rate provided.  Avoids forcing the client to compute
        # a same-currency identity translation.
        amount = attrs.get("amount")
        translated = attrs.get("amount_in_claim_currency")
        fx = attrs.get("fx_rate")
        line_currency = attrs.get("currency")
        claim = attrs.get("claim") or getattr(self.instance, "claim", None)

        if translated is None and amount is not None:
            if claim and line_currency and line_currency == claim.currency:
                attrs["amount_in_claim_currency"] = amount
            elif fx is not None:
                attrs["amount_in_claim_currency"] = (Decimal(amount) * Decimal(fx)).quantize(
                    Decimal("0.01")
                )
            else:
                raise serializers.ValidationError(
                    {"amount_in_claim_currency": "Required when receipt currency differs from claim currency and no fx_rate is supplied."}
                )

        return attrs


class TripClaimListSerializer(serializers.ModelSerializer):
    """Slim payload for the list page — total computed, no nested lines."""

    status_label = serializers.SerializerMethodField()
    total_amount = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    expense_count = serializers.IntegerField(read_only=True)
    created_by_email = serializers.SerializerMethodField()
    employee_name = serializers.SerializerMethodField()
    entity_code = serializers.SerializerMethodField()

    class Meta:
        model = TripClaim
        fields = (
            "id", "title", "destination", "purpose",
            "entity", "entity_code",
            "currency", "total_amount", "expense_count",
            "status", "status_label",
            "start_date", "end_date",
            "created_by", "created_by_email",
            "employee", "employee_name",
            "submitted_at", "approved_at", "rejected_at", "reimbursed_at",
            "created_at", "updated_at",
        )
        read_only_fields = fields

    def get_status_label(self, obj):
        return obj.get_status_display()

    def get_created_by_email(self, obj):
        return getattr(obj.created_by, "email", "")

    def get_employee_name(self, obj):
        return obj.employee.full_name if obj.employee_id else ""

    def get_entity_code(self, obj):
        return obj.entity.code if obj.entity_id else ""


class TripClaimDetailSerializer(serializers.ModelSerializer):
    """Full payload — used for create/update/retrieve."""

    expenses = TripExpenseSerializer(many=True, read_only=True)
    status_label = serializers.SerializerMethodField()
    total_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True,
    )
    is_editable = serializers.BooleanField(read_only=True)
    created_by_email = serializers.SerializerMethodField()
    employee_name = serializers.SerializerMethodField()
    employee_title = serializers.SerializerMethodField()
    approver_email = serializers.SerializerMethodField()
    entity_code = serializers.SerializerMethodField()

    class Meta:
        model = TripClaim
        fields = (
            "id", "title", "purpose", "destination",
            "entity", "entity_code",
            "currency", "total_amount", "is_editable",
            "start_date", "end_date",
            "status", "status_label", "rejection_reason", "notes",
            "created_by", "created_by_email",
            "employee", "employee_name", "employee_title",
            "approver", "approver_email",
            "submitted_at", "approved_at", "rejected_at", "reimbursed_at",
            "created_at", "updated_at",
            "expenses",
        )
        read_only_fields = (
            "id", "status", "status_label", "total_amount", "is_editable",
            "created_by", "created_by_email",
            "employee", "employee_name", "employee_title",
            "approver", "approver_email",
            "entity_code",
            "submitted_at", "approved_at", "rejected_at", "reimbursed_at",
            "rejection_reason",
            "created_at", "updated_at", "expenses",
        )

    def get_status_label(self, obj):
        return obj.get_status_display()

    def get_created_by_email(self, obj):
        return getattr(obj.created_by, "email", "")

    def get_employee_name(self, obj):
        return obj.employee.full_name if obj.employee_id else ""

    def get_employee_title(self, obj):
        return obj.employee.title if obj.employee_id else ""

    def get_approver_email(self, obj):
        return getattr(obj.approver, "email", "") if obj.approver_id else ""

    def get_entity_code(self, obj):
        return obj.entity.code if obj.entity_id else ""
