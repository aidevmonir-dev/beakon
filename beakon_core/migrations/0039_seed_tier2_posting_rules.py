"""Seed the 9 Tier-2 posting rules — master-driven flows.

Adds rows for: loan_drawdown, loan_repayment, loan_interest_accrual,
capital_call, distribution, rental_income, property_expense,
insurance_premium, insurance_claim.

Idempotent — get_or_create per (organization, transaction_type).
"""
from django.db import migrations


_SEED = [
    {
        "transaction_type": "loan_drawdown",
        "name": "Loan drawdown",
        "debit_role": "bank",
        "credit_role": "loan_payable",
        "description": (
            "Cash hits the bank when a loan is drawn (we are the borrower); "
            "DR Bank / CR Loan Payable. Asset-side (we are the lender) "
            "reverses. Tagged with LOAN dimension."
        ),
    },
    {
        "transaction_type": "loan_repayment",
        "name": "Loan repayment (principal + interest)",
        "debit_role": "loan_payable",
        "credit_role": "bank",
        "description": (
            "Repayment splits principal (DR Loan Payable) and interest "
            "(DR Interest Expense), both crediting Bank. Tagged with LOAN."
        ),
    },
    {
        "transaction_type": "loan_interest_accrual",
        "name": "Loan interest accrual (period-end)",
        "debit_role": "interest_expense",
        "credit_role": "loan_payable",
        "description": (
            "Period-end interest recognition before cash payment: "
            "DR Interest Expense / CR Loan Payable."
        ),
    },
    {
        "transaction_type": "capital_call",
        "name": "Capital call (PE commitment funded)",
        "debit_role": "investment",
        "credit_role": "bank",
        "description": (
            "Capital called from a private-market commitment: "
            "DR Investment / CR Bank. Tagged with COM dimension."
        ),
    },
    {
        "transaction_type": "distribution",
        "name": "Distribution received (PE)",
        "debit_role": "bank",
        "credit_role": "investment",
        "description": (
            "PE distribution splits between return-of-capital (CR "
            "Investment) and gain (CR Investment Income). Caller declares "
            "the split. Tagged with COM dimension."
        ),
    },
    {
        "transaction_type": "rental_income",
        "name": "Rental income",
        "debit_role": "bank",
        "credit_role": "rental_income",
        "description": (
            "Rent received: DR Bank / CR Rental Income. Tagged with PROP."
        ),
    },
    {
        "transaction_type": "property_expense",
        "name": "Property expense",
        "debit_role": "property_expense",
        "credit_role": "bank",
        "description": (
            "Property cost paid: DR Property Expense / CR Bank. Tagged with "
            "PROP dimension."
        ),
    },
    {
        "transaction_type": "insurance_premium",
        "name": "Insurance premium paid",
        "debit_role": "insurance_expense",
        "credit_role": "bank",
        "description": (
            "Premium settled: DR Insurance Expense / CR Bank. Tagged with "
            "POL dimension."
        ),
    },
    {
        "transaction_type": "insurance_claim",
        "name": "Insurance claim received",
        "debit_role": "bank",
        "credit_role": "insurance_recovery",
        "description": (
            "Claim payout received: DR Bank / CR Insurance Recovery. "
            "Tagged with POL dimension."
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
        ("beakon_core", "0038_alter_postingrule_credit_role_and_more"),
    ]

    operations = [
        migrations.RunPython(_seed, _unseed),
    ]
