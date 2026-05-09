"""Seed the 6 Tier-1 posting rules to complete the operating cycle.

Adds rows for: bank_transfer, bank_interest, owner_contribution,
vendor_credit_note, customer_credit_note, vat_remittance.

Idempotent — get_or_create per (organization, transaction_type).
"""
from django.db import migrations


_SEED = [
    {
        "transaction_type": "bank_transfer",
        "name": "Bank transfer (own accounts)",
        "debit_role": "bank_target",
        "credit_role": "bank_source",
        "description": (
            "Move cash between two bank/cash accounts on the same entity: "
            "debit the destination account and credit the source account. "
            "Same currency only — cross-currency transfers are an "
            "FX-conversion transaction with FX gain/loss treatment."
        ),
    },
    {
        "transaction_type": "bank_interest",
        "name": "Bank interest received",
        "debit_role": "bank",
        "credit_role": "interest_income",
        "description": (
            "When the bank credits interest, debit the Bank account and "
            "credit Interest Income."
        ),
    },
    {
        "transaction_type": "owner_contribution",
        "name": "Owner capital contribution",
        "debit_role": "bank",
        "credit_role": "capital",
        "description": (
            "When the owner injects funds into the entity, debit the "
            "Bank account and credit Capital (equity)."
        ),
    },
    {
        "transaction_type": "vendor_credit_note",
        "name": "Vendor credit note (refund / adjustment)",
        "debit_role": "accounts_payable",
        "credit_role": "expense",
        "description": (
            "When a vendor issues a credit note, debit Accounts Payable "
            "(reduce what we owe) and credit the original Expense (reverse "
            "the cost). Counterparty dimension auto-derived from the vendor."
        ),
    },
    {
        "transaction_type": "customer_credit_note",
        "name": "Customer credit note (refund / adjustment)",
        "debit_role": "revenue",
        "credit_role": "accounts_receivable",
        "description": (
            "When we issue a credit note to a customer, debit Revenue "
            "(reduce recognised revenue) and credit Accounts Receivable "
            "(reduce what they owe). Counterparty dimension auto-derived "
            "from the customer."
        ),
    },
    {
        "transaction_type": "vat_remittance",
        "name": "VAT remittance to authority",
        "debit_role": "vat_payable",
        "credit_role": "bank",
        "description": (
            "When net output VAT is paid to the tax authority, debit VAT "
            "Payable (clear the liability) and credit the Bank account."
        ),
    },
]


def _seed(apps, schema_editor):
    Organization = apps.get_model("organizations", "Organization")
    PostingRule = apps.get_model("beakon_core", "PostingRule")
    for org in Organization.objects.all():
        for spec in _SEED:
            PostingRule.objects.get_or_create(
                organization=org,
                transaction_type=spec["transaction_type"],
                defaults={
                    "name": spec["name"],
                    "debit_role": spec["debit_role"],
                    "credit_role": spec["credit_role"],
                    "description": spec["description"],
                    "is_system": True,
                    "is_active": True,
                },
            )


def _unseed(apps, schema_editor):
    PostingRule = apps.get_model("beakon_core", "PostingRule")
    PostingRule.objects.filter(
        is_system=True,
        transaction_type__in=[s["transaction_type"] for s in _SEED],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("beakon_core", "0036_alter_postingrule_credit_role_and_more"),
    ]

    operations = [
        migrations.RunPython(_seed, _unseed),
    ]
