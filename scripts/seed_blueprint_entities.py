"""Seed the legal entities from Thomas's CoA blueprint
(``2026 04 17-DRAFT-CoA-Wealth management v2.xlsx``, sheet
``11_Related_Party_Master``, rows where ``Party_Form == ENTITY``).

Idempotent: skips entities whose code already exists in the target
organization. Two-pass — pass 1 creates standalone + top-of-house entities,
pass 2 wires the parent FKs.

Run:  ./venv/Scripts/python.exe scripts/seed_blueprint_entities.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Allow `python scripts/seed_blueprint_entities.py` to find the project's
# ``digits_clone`` settings module regardless of the caller's cwd.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "digits_clone.settings")
django.setup()

from organizations.models import Organization  # noqa: E402
from beakon_core.models import Entity  # noqa: E402


ORG_NAME = "Beakon"  # the demo / dev organization

# (code, name, legal_name, entity_type, country, functional_ccy,
#  reporting_ccy, accounting_standard, parent_code, notes)
#
# Reporting currency is left blank when it equals functional. CHF is the
# family's group reporting currency per the blueprint's CCY_CHF definition.
ENTITIES: list[tuple] = [
    # Top-of-house
    ("HOLDCO-SA", "Client Holdco SA", "Client Holdco SA",
     "holding_company", "CH", "CHF", "", "ifrs", None,
     "Top-of-house consolidation root. Source: 11_Related_Party_Master / RP_HOLDCO_001."),

    # Standalone trusts & foundations (no parent — they're separate
    # legal structures, not subsidiaries of the holdco).
    ("BLUE-RIVER", "Blue River Trust", "Blue River Trust",
     "trust", "CH", "CHF", "", "ifrs", None,
     "Discretionary trust. Source: 11_Related_Party_Master / RP_TRUST_001."),
    ("SILVER-OAK", "Silver Oak Trust", "Silver Oak Trust",
     "trust", "CH", "CHF", "", "ifrs", None,
     "Fixed-interest trust. Source: 11_Related_Party_Master / RP_TRUST_002."),
    ("BEN-TRUST", "Family Beneficiary Trust", "Family Beneficiary Trust Account",
     "trust", "CH", "CHF", "", "ifrs", None,
     "Beneficiary account trust. Source: 11_Related_Party_Master / RP_BEN_001."),
    ("OAK-FOUND", "Oak Foundation", "Oak Foundation",
     "foundation", "CH", "CHF", "", "ifrs", None,
     "Private foundation. Source: 11_Related_Party_Master / RP_FOUND_001."),
    ("FAM-CHARITY", "Family Charitable Vehicle", "Family Charitable Vehicle",
     "foundation", "CH", "CHF", "", "ifrs", None,
     "Charitable foundation. Source: 11_Related_Party_Master / RP_CHAR_FAM_001."),

    # Children of HOLDCO-SA
    ("FAM-INV-LTD", "Family Investments Ltd", "Family Investments Ltd",
     "holding_company", "GB", "GBP", "CHF", "uk_gaap", "HOLDCO-SA",
     "Investment holdco — parent of the SPVs. Source: 11_Related_Party_Master / RP_HOLDCO_002."),
    ("OPCO-A-SA", "Operating Company A SA", "Operating Company A SA",
     "operating_company", "CH", "CHF", "", "ifrs", "HOLDCO-SA",
     "Operating company. Source: 11_Related_Party_Master / RP_OPCO_001."),
    ("FAM-LP", "Family Partnership LP", "Family Partnership LP",
     "partnership", "GB", "GBP", "CHF", "uk_gaap", "HOLDCO-SA",
     "Family limited partnership. Source: 11_Related_Party_Master / RP_PARTNER_001."),
    ("DORM-CO", "Dormant Family Company", "Dormant Family Company",
     "company", "CH", "CHF", "", "ifrs", "HOLDCO-SA",
     "Dormant — kept for legal continuity. Source: 11_Related_Party_Master / RP_DORM_001."),

    # Children of FAM-INV-LTD (SPV layer)
    ("RE-SPV-1", "Real Estate SPV 1 Sàrl", "Real Estate SPV 1 Sàrl",
     "spv", "LU", "EUR", "CHF", "ifrs", "FAM-INV-LTD",
     "Real-estate SPV. Source: 11_Related_Party_Master / RP_SPV_001."),
    ("CR-SPV-1", "Private Credit SPV 1 Ltd", "Private Credit SPV 1 Ltd",
     "spv", "GB", "GBP", "CHF", "uk_gaap", "FAM-INV-LTD",
     "Private credit SPV. Source: 11_Related_Party_Master / RP_SPV_002."),
]


def main() -> int:
    org = Organization.objects.filter(name=ORG_NAME).first()
    if org is None:
        print(f"ERROR: organization {ORG_NAME!r} not found.", file=sys.stderr)
        return 1

    existing_codes = set(
        Entity.objects.filter(organization=org).values_list("code", flat=True),
    )
    print(f"Target organization: id={org.id} name={org.name!r}")
    print(f"Existing entity codes: {sorted(existing_codes)}")
    print()

    created: dict[str, Entity] = {}
    skipped: list[str] = []

    # Pass 1: create rows without the parent FK.
    for (code, name, legal_name, etype, country, fccy, rccy, std,
         parent_code, notes) in ENTITIES:
        if code in existing_codes:
            skipped.append(code)
            continue
        ent = Entity.objects.create(
            organization=org,
            code=code,
            name=name,
            legal_name=legal_name,
            entity_type=etype,
            country=country,
            functional_currency=fccy,
            reporting_currency=rccy,
            accounting_standard=std,
            notes=notes,
            is_active=True,
        )
        created[code] = ent
        print(f"  + created {code:14s} {name:40s} [{etype:18s} {country} "
              f"{fccy}{f'/{rccy}' if rccy else ''} {std}]")

    # Pass 2: wire parents. Looks up entities by code each time so reruns
    # of an idempotent seed will still fix any parents that were skipped
    # the first time.
    for (code, _, _, _, _, _, _, _, parent_code, _) in ENTITIES:
        if parent_code is None:
            continue
        child = created.get(code) or Entity.objects.filter(
            organization=org, code=code,
        ).first()
        parent = created.get(parent_code) or Entity.objects.filter(
            organization=org, code=parent_code,
        ).first()
        if child is None or parent is None:
            print(f"  ! could not link {code} -> {parent_code} (missing row)")
            continue
        if child.parent_id == parent.id:
            continue  # already wired
        child.parent = parent
        child.save(update_fields=["parent", "updated_at"])
        print(f"  -> {code} parented to {parent_code}")

    print()
    print(f"Created: {len(created)}   Skipped (already exist): {len(skipped)}")
    if skipped:
        print(f"Skipped codes: {skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
