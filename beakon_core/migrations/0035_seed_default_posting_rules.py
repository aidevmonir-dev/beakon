"""Seed the 5 default PostingRule rows per Thomas's
`Accounting_Engine_Developer_Instructions.docx` §3 step 3.

Idempotent — uses get_or_create per (organization, transaction_type) so
re-running the migration is safe and existing organizations get the
seed automatically when the migration is applied.
"""
from django.db import migrations


_SEED = [
    {
        "transaction_type": "supplier_invoice",
        "name": "Supplier invoice (AP accrual)",
        "debit_role": "expense",
        "credit_role": "accounts_payable",
        "description": (
            "When a supplier invoice is entered, debit Expense or Cost of "
            "Sales and credit Accounts Payable."
        ),
    },
    {
        "transaction_type": "customer_invoice",
        "name": "Customer invoice (AR issuance)",
        "debit_role": "accounts_receivable",
        "credit_role": "revenue",
        "description": (
            "When a customer invoice is entered, debit Accounts Receivable "
            "and credit Sales Revenue."
        ),
    },
    {
        "transaction_type": "supplier_payment",
        "name": "Supplier payment",
        "debit_role": "accounts_payable",
        "credit_role": "bank",
        "description": (
            "When the supplier is paid, debit Accounts Payable and credit "
            "the Bank account."
        ),
    },
    {
        "transaction_type": "customer_receipt",
        "name": "Customer receipt",
        "debit_role": "bank",
        "credit_role": "accounts_receivable",
        "description": (
            "When the customer pays, debit the Bank account and credit "
            "Accounts Receivable."
        ),
    },
    {
        "transaction_type": "bank_charge",
        "name": "Bank charge",
        "debit_role": "bank_charge_expense",
        "credit_role": "bank",
        "description": (
            "When a bank charge is entered, debit Bank Charges Expense "
            "and credit the Bank account."
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
    PostingRule.objects.filter(is_system=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("beakon_core", "0034_entity_four_eyes_posting_required_postingrule"),
    ]

    operations = [
        migrations.RunPython(_seed, _unseed),
    ]
