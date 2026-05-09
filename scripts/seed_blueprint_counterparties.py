"""Seed Vendor + Customer rows from the blueprint
(``2026 04 17-DRAFT-CoA-Wealth management v2.xlsx``, sheet
``10_Counterparty_Master``).

Routing rule per blueprint flags:

    AP_Eligible_Flag == "Yes"  -> create a Vendor   (we pay them)
    AR_Eligible_Flag == "Yes"  -> create a Customer (they pay us)
    Both yes                   -> create both       (broker-style two-way)

Demo vendors/customers (STAPLES, AWS, CONED, LEGAL, LANDLORD, ACME,
WIDGETS, BIGCORP) are hard-deleted up front since the demo journal
entries that referenced them were already purged.

Blueprint columns the lean Vendor/Customer model can't carry
(Counterparty_Subtype, Status, KYC/AML/sanctions flags, eligibility
matrix, related-party / intercompany flags, settlement method,
risk rating, etc.) are packed into the ``notes`` field as a labelled
block so nothing is lost. A schema extension can lift them later.

Idempotent: skips rows where a vendor/customer with the same code
already exists.

Run:  ./venv/Scripts/python.exe scripts/seed_blueprint_counterparties.py
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "digits_clone.settings")
django.setup()

from organizations.models import Organization  # noqa: E402
from beakon_core.models import Vendor, Customer  # noqa: E402


XLSX = Path("D:/Thomas/2026 04 17-DRAFT-CoA-Wealth management v2.xlsx")
ORG_NAME = "Beakon"

DEMO_VENDOR_CODES = ["STAPLES", "AWS", "CONED", "LEGAL", "LANDLORD"]
DEMO_CUSTOMER_CODES = ["ACME", "WIDGETS", "BIGCORP"]


def yes(v) -> bool:
    return str(v or "").strip().lower() == "yes"


def parse_payment_terms_days(v) -> int:
    """Pull a day count out of strings like 'NET30', '30 days', '30', '14'.
    Falls back to the model default of 30 when nothing parseable is found."""
    if v is None:
        return 30
    if isinstance(v, (int, float)):
        return max(0, int(v))
    m = re.search(r"\d+", str(v))
    return int(m.group(0)) if m else 30


def build_notes(row: dict) -> str:
    """Pack blueprint-only fields into a notes block. Keep labels stable so
    the future schema migration can grep these into proper columns."""
    lines = [f"Source: 10_Counterparty_Master / {row['Counterparty_ID']}"]
    keep = [
        ("Counterparty type", "Counterparty_Type"),
        ("Counterparty subtype", "Counterparty_Subtype"),
        ("Status", "Status"),
        ("External reference", "External_Reference"),
        ("Registration no.", "Registration_No"),
        ("Country", "Country_Code"),
        ("Jurisdiction", "Jurisdiction_Code"),
        ("Base currency", "Base_Currency"),
        ("Default payment currency", "Default_Payment_Currency"),
        ("Language", "Language_Code"),
        ("Settlement method", "Settlement_Method"),
        ("Default bank reference", "Default_Bank_Reference"),
        ("Risk rating", "Risk_Rating"),
        ("KYC status", "KYC_Status"),
        ("AML risk level", "AML_Risk_Level"),
        ("Sanctions check", "Sanctions_Check_Flag"),
        ("Related party", "Related_Party_Flag"),
        ("Intercompany", "Intercompany_Flag"),
        ("AP eligible", "AP_Eligible_Flag"),
        ("AR eligible", "AR_Eligible_Flag"),
        ("Loan eligible", "Loan_Eligible_Flag"),
        ("Tax eligible", "Tax_Eligible_Flag"),
        ("Insurance eligible", "Insurance_Eligible_Flag"),
        ("Education eligible", "Education_Eligible_Flag"),
        ("Professional fees eligible", "Professional_Fees_Eligible_Flag"),
    ]
    for label, key in keep:
        v = row.get(key)
        if v not in (None, "", "—"):
            lines.append(f"{label}: {v}")
    extra = row.get("Notes")
    if extra:
        lines.append(f"Notes: {extra}")
    return "\n".join(lines)


def party_kwargs(row: dict, code: str) -> dict:
    """Common Party fields used for both Vendor + Customer creation."""
    return dict(
        code=code,
        name=row.get("Counterparty_Name") or code,
        legal_name=row.get("Counterparty_Name") or "",
        tax_id=row.get("Tax_ID") or row.get("Registration_No") or "",
        country=(row.get("Country_Code") or "")[:2].upper(),
        default_currency=(row.get("Default_Payment_Currency")
                          or row.get("Base_Currency") or "")[:3].upper(),
        default_payment_terms_days=parse_payment_terms_days(row.get("Payment_Terms")),
        is_active=yes(row.get("Active_Flag")) and (
            str(row.get("Status") or "").upper() != "INACTIVE"
        ),
        notes=build_notes(row),
    )


def main() -> int:
    org = Organization.objects.filter(name=ORG_NAME).first()
    if org is None:
        print(f"ERROR: organization {ORG_NAME!r} not found.", file=sys.stderr)
        return 1

    # ── Step 0: clean demo parties ────────────────────────────────────
    print("Step 0: clean demo vendors / customers")
    v_del, _ = Vendor.objects.filter(
        organization=org, code__in=DEMO_VENDOR_CODES,
    ).delete()
    c_del, _ = Customer.objects.filter(
        organization=org, code__in=DEMO_CUSTOMER_CODES,
    ).delete()
    print(f"  removed: vendors={v_del} customers={c_del}\n")

    # ── Step 1: read sheet ────────────────────────────────────────────
    print("Step 1: load 10_Counterparty_Master")
    wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
    ws = wb["10_Counterparty_Master"]
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    field_idx = {h: i for i, h in enumerate(header) if h is not None}

    real_rows: list[dict] = []
    for r in rows[1:]:
        cid = r[field_idx["Counterparty_ID"]] if field_idx.get("Counterparty_ID") is not None else None
        if not isinstance(cid, str) or not cid.startswith("CP_"):
            continue
        real_rows.append({h: r[i] for h, i in field_idx.items()})
    print(f"  {len(real_rows)} counterparties found\n")

    # ── Step 2: create vendors / customers ────────────────────────────
    print("Step 2: create vendors & customers")
    v_created = c_created = v_skipped = c_skipped = 0

    for row in real_rows:
        code = row["Counterparty_ID"]
        is_ap = yes(row.get("AP_Eligible_Flag"))
        is_ar = yes(row.get("AR_Eligible_Flag"))

        if is_ap:
            if Vendor.objects.filter(organization=org, code=code).exists():
                v_skipped += 1
            else:
                Vendor.objects.create(organization=org, **party_kwargs(row, code))
                v_created += 1
                print(f"  + Vendor   {code:<22} {row.get('Counterparty_Name')}")

        if is_ar:
            if Customer.objects.filter(organization=org, code=code).exists():
                c_skipped += 1
            else:
                Customer.objects.create(organization=org, **party_kwargs(row, code))
                c_created += 1
                print(f"  + Customer {code:<22} {row.get('Counterparty_Name')}")

    print()
    print(f"Summary:")
    print(f"  Vendors:   created={v_created}  already existed={v_skipped}")
    print(f"  Customers: created={c_created}  already existed={c_skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
