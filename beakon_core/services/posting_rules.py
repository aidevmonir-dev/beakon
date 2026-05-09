"""PostingRuleService — read-side helper over the PostingRule registry.

Exposes a small API for callers (services, AI, admin) to look up the
debit/credit roles for a transaction type. The actual JE composition still
happens in the per-flow services (BillService etc.); this service just
hands back the canonical rule the engine is following.
"""
from __future__ import annotations

from typing import Optional

from ..exceptions import ValidationError
from ..models import PostingRule
from ..models.posting_rules import DEFAULT_RULES


class PostingRuleService:

    @staticmethod
    def get(*, organization, transaction_type: str) -> PostingRule:
        """Return the active rule for ``transaction_type`` in the given org.
        Raises ValidationError if not configured."""
        rule = (
            PostingRule.objects
            .filter(
                organization=organization,
                transaction_type=transaction_type,
                is_active=True,
            )
            .first()
        )
        if rule is None:
            raise ValidationError(
                f"No active posting rule for transaction type "
                f"'{transaction_type}'. Seed the rule registry or pass "
                f"the rule explicitly.",
                code="PR001",
            )
        return rule

    @staticmethod
    def list_active(*, organization) -> list[PostingRule]:
        return list(
            PostingRule.objects
            .filter(organization=organization, is_active=True)
            .order_by("transaction_type")
        )

    @staticmethod
    def ensure_seeded(*, organization, user=None) -> int:
        """Idempotently seed the 5 default rules from Thomas's spec.

        Returns the number of rules created (0 if everything was already
        present)."""
        created = 0
        for spec in DEFAULT_RULES:
            _, was_created = PostingRule.objects.get_or_create(
                organization=organization,
                transaction_type=spec["transaction_type"],
                defaults={
                    "name": spec["name"],
                    "debit_role": spec["debit_role"],
                    "credit_role": spec["credit_role"],
                    "description": spec["description"],
                    "is_system": True,
                    "is_active": True,
                    "created_by": user,
                },
            )
            if was_created:
                created += 1
        return created
