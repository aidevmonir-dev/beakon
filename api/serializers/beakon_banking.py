from rest_framework import serializers

from beakon_banking.models import BankAccount, BankTransaction, FeedImport


class BankAccountSerializer(serializers.ModelSerializer):
    entity_code = serializers.SerializerMethodField()
    entity_name = serializers.SerializerMethodField()
    entity_type = serializers.SerializerMethodField()
    account_code = serializers.SerializerMethodField()
    account_name = serializers.SerializerMethodField()
    gl_balance = serializers.SerializerMethodField()

    class Meta:
        model = BankAccount
        fields = (
            "id", "name", "bank_name", "account_number_last4",
            "entity", "entity_code", "entity_name", "entity_type",
            "account", "account_code", "account_name",
            "currency", "opening_balance", "gl_balance",
            "is_active", "notes",
            "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "entity_code", "entity_name", "entity_type",
            "account_code", "account_name", "gl_balance",
            "created_at", "updated_at",
        )

    def get_gl_balance(self, obj):
        # Annotated by BankAccountViewSet.get_queryset(); falls back to a
        # per-row aggregate when the queryset wasn't annotated (e.g. when
        # the serializer is reused for create/update where annotation is
        # discarded).
        from decimal import Decimal
        from django.db.models import Sum, F
        bal = getattr(obj, "gl_balance", None)
        if bal is not None:
            return str(bal)
        agg = obj.account.journal_lines.filter(
            journal_entry__status="posted",
        ).aggregate(
            d=Sum("debit"), c=Sum("credit"),
        )
        return str((agg["d"] or Decimal("0")) - (agg["c"] or Decimal("0")))

    def get_entity_code(self, obj):
        return obj.entity.code

    def get_entity_name(self, obj):
        return obj.entity.name

    def get_entity_type(self, obj):
        return obj.entity.entity_type

    def get_account_code(self, obj):
        return obj.account.code

    def get_account_name(self, obj):
        return obj.account.name


class BankTransactionSerializer(serializers.ModelSerializer):
    bank_account_name = serializers.SerializerMethodField()
    proposed_je_number = serializers.SerializerMethodField()
    proposed_je_status = serializers.SerializerMethodField()

    class Meta:
        model = BankTransaction
        fields = (
            "id", "bank_account", "bank_account_name",
            "feed_import", "external_id",
            "date", "description", "original_description",
            "amount", "balance_after", "currency",
            "status", "is_duplicate",
            "proposed_journal_entry", "proposed_je_number", "proposed_je_status",
            "notes", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "external_id", "original_description", "bank_account_name",
            "proposed_je_number", "proposed_je_status",
            "created_at", "updated_at",
        )

    def get_bank_account_name(self, obj):
        return obj.bank_account.name

    def get_proposed_je_number(self, obj):
        return obj.proposed_journal_entry.entry_number if obj.proposed_journal_entry_id else None

    def get_proposed_je_status(self, obj):
        return obj.proposed_journal_entry.status if obj.proposed_journal_entry_id else None


class FeedImportSerializer(serializers.ModelSerializer):
    bank_account_name = serializers.SerializerMethodField()

    class Meta:
        model = FeedImport
        fields = (
            "id", "bank_account", "bank_account_name", "source", "file_name",
            "total_rows", "imported_rows", "duplicate_rows", "error_rows",
            "status", "error_log", "started_at", "completed_at",
            "imported_by", "created_at",
        )
        read_only_fields = fields

    def get_bank_account_name(self, obj):
        return obj.bank_account.name


class ImportCSVSerializer(serializers.Serializer):
    file = serializers.FileField()
    date_format = serializers.CharField(default="%Y-%m-%d", max_length=40)
    has_header = serializers.BooleanField(default=True)
    column_mapping = serializers.DictField(
        child=serializers.IntegerField(min_value=0),
        help_text='{"date":0,"description":1,"amount":3,"balance":4}',
    )

    def validate_column_mapping(self, mapping):
        for required in ("date", "description", "amount"):
            if required not in mapping:
                raise serializers.ValidationError(f"missing key '{required}'")
        return mapping


class CategorizeRequestSerializer(serializers.Serializer):
    offset_account_id = serializers.IntegerField()
    memo = serializers.CharField(required=False, allow_blank=True, default="")


class IgnoreRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")
