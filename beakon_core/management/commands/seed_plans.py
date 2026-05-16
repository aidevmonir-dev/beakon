"""manage.py seed_plans

Idempotent. Seeds the four pricing tiers shown on /pricing — Starter,
Professional, Family Office, Enterprise. Slugs are stable so the
register page's ``?plan=`` query param continues to resolve.
"""
from __future__ import annotations

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from beakon_core.models import Plan


PLANS = [
    {
        "slug": "starter",
        "name": "Starter",
        "audience": "Single company / simple setup",
        "price": Decimal("79"),
        "currency": "CHF",
        "billing_cadence": Plan.BILLING_MONTHLY,
        "max_entities": 1,
        "is_self_serve": True,
        "sort_order": 10,
        "features": [
            "1 entity",
            "AI transaction classification",
            "Bank reconciliation",
            "Swiss VAT-ready setup",
            "Receipt scanning",
            "ELM-ready payroll data prep",
            "P&L + balance sheet reports",
        ],
    },
    {
        "slug": "professional",
        "name": "Professional",
        "audience": "SMEs / growing structures",
        "price": Decimal("199"),
        "currency": "CHF",
        "billing_cadence": Plan.BILLING_MONTHLY,
        "max_entities": 3,
        "is_self_serve": True,
        "sort_order": 20,
        "features": [
            "Up to 3 entities",
            "Everything in Starter",
            "Multi-currency posting",
            "Custom dimensions",
            "Approval workflow (4-eyes)",
            "Custodian feed (1 custodian)",
            "Standard reports + drill-down",
        ],
    },
    {
        "slug": "family",
        "name": "Family Office",
        "audience": "Complex / multi-entity / family-office structures",
        "price": Decimal("490"),
        "currency": "CHF",
        "billing_cadence": Plan.BILLING_MONTHLY,
        "max_entities": 25,
        "is_self_serve": True,
        "sort_order": 30,
        "features": [
            "Up to 25 entities",
            "Everything in Professional",
            "Intercompany + consolidation",
            "Custodian feeds (multiple banks)",
            "Tax-lot tracking + realised gains",
            "Performance reporting at portfolio level",
            "FX revaluation (ECB rates)",
            "Priority Swiss support",
        ],
    },
    {
        "slug": "enterprise",
        "name": "Enterprise / Fiduciary",
        "audience": "Larger firms, fiduciaries, multi-client platforms",
        "price": None,
        "currency": "CHF",
        "billing_cadence": Plan.BILLING_CUSTOM,
        "max_entities": 999,
        "is_self_serve": False,
        "sort_order": 40,
        "features": [
            "Unlimited entities",
            "Everything in Family Office",
            "White-label client portals",
            "SSO + per-tenant access controls",
            "Dedicated infrastructure tier",
            "On-prem deployment option",
            "Named customer-success contact",
        ],
    },
]


class Command(BaseCommand):
    help = "Seed the four pricing-page plans (idempotent)."

    @transaction.atomic
    def handle(self, *args, **opts):
        for spec in PLANS:
            obj, created = Plan.objects.update_or_create(
                slug=spec["slug"], defaults=spec,
            )
            verb = "created" if created else "updated"
            self.stdout.write(self.style.SUCCESS(
                f"  [{verb}] {obj.name} ({obj.slug})"
            ))
        self.stdout.write(self.style.SUCCESS(
            f"\n{Plan.objects.count()} plans active in the catalogue."
        ))
