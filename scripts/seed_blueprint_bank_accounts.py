"""Seed bank accounts from Thomas's CoA blueprint
(``2026 04 17-DRAFT-CoA-Wealth management v2.xlsx``, sheet
``12_Bank_Account_Master``).

Side-quest: also adds 3 ``individual``-type entities (Client, Spouse,
Child B) because they own bank accounts in the blueprint but weren't
part of the legal-entity seed (which only loaded ``Party_Form == ENTITY``
rows from 11_Related_Party_Master).

Mapping decisions:

* Bank-account COA row picked by country + subtype:
    - ``ESCROW`` subtype          → 110800 (Restricted cash)
    - ``Country_Code == 'CH'``    → 110200 (Domestic current accounts)
    - other                       → 110300 (Foreign current accounts)
  This is a coarse rollup-level mapping. Per-bank-account sub-accounts
  are an obvious future refinement once the COA grows entity-scoped
  cash sub-rows.

* The ``BankAccount`` model in ``beakon_banking`` is currently lean
  (8 fields). The blueprint carries 33 columns including IBAN, SWIFT,
  booking center, account subtype, purpose, KYC status, etc. We pack
  those into the ``notes`` field as a labelled multi-line block so no
  data is lost — extending the model is a separate change.

Idempotent: skips bank accounts whose blueprint ID already appears in
an existing notes block.

Run:  ./venv/Scripts/python.exe scripts/seed_blueprint_bank_accounts.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "digits_clone.settings")
django.setup()

from organizations.models import Organization  # noqa: E402
from beakon_core.models import Account, Entity  # noqa: E402
from beakon_banking.models import BankAccount  # noqa: E402


XLSX = Path("D:/Thomas/2026 04 17-DRAFT-CoA-Wealth management v2.xlsx")
ORG_NAME = "Beakon"

# --- Persons we need to seed (referenced as Account_Holder_ID in the bank
#     accounts sheet but absent from the legal-entity seed).
PERSONS_TO_ADD: list[tuple[str, str, str, str, str, str, str, str]] = [
    # (code, name, legal_name, country, ccy, std, notes, holder_id)
    ("CLIENT",  "Client Principal", "Client Principal",
     "CH", "CHF", "ifrs",
     "Primary wealth owner. Source: 11_Related_Party_Master / RP_CLIENT_001.",
     "RP_CLIENT_001"),
    ("SPOUSE",  "Spouse of Client", "Spouse of Client",
     "CH", "CHF", "ifrs",
     "Spouse of principal. Source: 11_Related_Party_Master / RP_SPOUSE_001.",
     "RP_SPOUSE_001"),
    ("CHILD-B", "Child B",          "Child B",
     "GB", "GBP", "uk_gaap",
     "UK-resident child (per the GBP/London bank account). "
     "Source: 11_Related_Party_Master / RP_CHILD_002.",
     "RP_CHILD_002"),
]

# Map blueprint Related-Party IDs → our Entity.code.
HOLDER_ID_TO_ENTITY_CODE: dict[str, str] = {
    "RP_CLIENT_001":    "CLIENT",
    "RP_SPOUSE_001":    "SPOUSE",
    "RP_CHILD_002":     "CHILD-B",
    "RP_TRUST_001":     "BLUE-RIVER",
    "RP_TRUST_002":     "SILVER-OAK",
    "RP_BEN_001":       "BEN-TRUST",
    "RP_FOUND_001":     "OAK-FOUND",
    "RP_CHAR_FAM_001":  "FAM-CHARITY",
    "RP_HOLDCO_001":    "HOLDCO-SA",
    "RP_HOLDCO_002":    "FAM-INV-LTD",
    "RP_OPCO_001":      "OPCO-A-SA",
    "RP_PARTNER_001":   "FAM-LP",
    "RP_SPV_001":       "RE-SPV-1",
    "RP_SPV_002":       "CR-SPV-1",
    "RP_DORM_001":      "DORM-CO",
}


def add_persons(org: Organization) -> dict[str, Entity]:
    """Create / look up the 3 individual entities. Returns code → Entity."""
    out: dict[str, Entity] = {}
    for (code, name, legal_name, country, ccy, std, notes, _holder_id
         ) in PERSONS_TO_ADD:
        ent, created = Entity.objects.get_or_create(
            organization=org, code=code,
            defaults=dict(
                name=name, legal_name=legal_name, entity_type="individual",
                country=country, functional_currency=ccy,
                accounting_standard=std, notes=notes, is_active=True,
            ),
        )
        out[code] = ent
        flag = "+" if created else " "
        print(f"  {flag} entity {code:<10} {name:<25} ({country}/{ccy}/{std})"
              + ("" if created else "   [already existed]"))
    return out


def pick_coa_account(org: Organization, country: str, subtype: str) -> Account:
    """Resolve the COA cash row this bank account should post to."""
    if (subtype or "").upper() == "ESCROW":
        code = "110800"  # Restricted cash
    elif (country or "").upper() == "CH":
        code = "110200"  # Domestic current accounts
    else:
        code = "110300"  # Foreign current accounts
    return Account.objects.get(organization=org, code=code)


def build_notes_block(row: dict) -> str:
    """Pack blueprint-only fields into the BankAccount.notes blob so no
    information is lost. Future schema extension can lift these into
    proper columns."""
    lines = [f"Source: 12_Bank_Account_Master / {row['Bank_Account_ID']}"]
    keep = [
        ("Bank", "Bank_Name"),
        ("Booking center", "Booking_Center"),
        ("IBAN (masked)", "IBAN_or_Account_No_Masked"),
        ("SWIFT/BIC", "SWIFT_BIC"),
        ("Country", "Country_Code"),
        ("Jurisdiction", "Jurisdiction_Code"),
        ("Account type", "Account_Type"),
        ("Account subtype", "Account_Subtype"),
        ("Purpose", "Account_Purpose"),
        ("Status", "Status"),
        ("Posting allowed", "Posting_Allowed_Flag"),
        ("Restricted", "Restricted_Flag"),
        ("Interest bearing", "Interest_Bearing_Flag"),
        ("Overdraft allowed", "Overdraft_Allowed_Flag"),
        ("Default portfolio", "Default_Portfolio_Code"),
        ("KYC status", "KYC_Status"),
        ("Approval required", "Approval_Required_Flag"),
        ("Source-doc required", "Source_Document_Required_Flag"),
    ]
    for label, key in keep:
        v = row.get(key)
        if v not in (None, "", "—"):
            lines.append(f"{label}: {v}")
    extra = row.get("Notes")
    if extra:
        lines.append(f"Notes: {extra}")
    return "\n".join(lines)


def main() -> int:
    org = Organization.objects.filter(name=ORG_NAME).first()
    if org is None:
        print(f"ERROR: organization {ORG_NAME!r} not found.", file=sys.stderr)
        return 1

    # ── Step 1: persons ───────────────────────────────────────────────
    print("Step 1: ensure individual entities exist")
    add_persons(org)
    print()

    # ── Step 2: read blueprint sheet ──────────────────────────────────
    print("Step 2: load 12_Bank_Account_Master")
    wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
    ws = wb["12_Bank_Account_Master"]
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    field_idx = {h: i for i, h in enumerate(header) if h is not None}

    real_rows: list[dict] = []
    for r in rows[1:]:
        bid = r[field_idx["Bank_Account_ID"]] if field_idx.get("Bank_Account_ID") is not None else None
        if not isinstance(bid, str) or not bid.startswith("BANK_"):
            continue
        d = {h: r[i] for h, i in field_idx.items()}
        real_rows.append(d)
    print(f"  found {len(real_rows)} bank-account rows in the sheet\n")

    # ── Step 3: create BankAccount rows ───────────────────────────────
    print("Step 3: seed BankAccount rows")
    created_n = 0
    skipped_n = 0
    skipped_unmapped: list[tuple[str, str]] = []

    for row in real_rows:
        bid = row["Bank_Account_ID"]
        holder_id = row.get("Account_Holder_ID") or ""
        ent_code = HOLDER_ID_TO_ENTITY_CODE.get(holder_id)
        if not ent_code:
            skipped_unmapped.append((bid, holder_id))
            continue

        entity = Entity.objects.filter(organization=org, code=ent_code).first()
        if entity is None:
            skipped_unmapped.append((bid, f"{holder_id} → entity {ent_code} missing"))
            continue

        # Idempotent guard — match by source ID embedded in notes
        if BankAccount.objects.filter(
            organization=org, entity=entity, notes__contains=f"/ {bid}",
        ).exists():
            skipped_n += 1
            continue

        coa = pick_coa_account(
            org=org,
            country=row.get("Country_Code") or "",
            subtype=row.get("Account_Subtype") or "",
        )
        active = (str(row.get("Active_Flag") or "").strip().lower() == "yes"
                  and str(row.get("Status") or "").upper() != "INACTIVE")
        ba = BankAccount.objects.create(
            organization=org,
            entity=entity,
            account=coa,
            name=row.get("Bank_Account_Name") or bid,
            bank_name=(row.get("Bank_Name") or "")[:255],
            account_number_last4="",  # not in source; IBAN goes into notes
            currency=(row.get("Account_Currency") or "USD")[:3].upper(),
            is_active=active,
            notes=build_notes_block(row),
        )
        created_n += 1
        print(f"  + {bid:<24} -> {ent_code:<11} COA={coa.code} {ba.currency} "
              f"{'active' if active else 'inactive'}  ({ba.name})")

    # ── Summary ───────────────────────────────────────────────────────
    print()
    print(f"Summary: created={created_n}  skipped (already loaded)={skipped_n}  "
          f"skipped (unmapped holder)={len(skipped_unmapped)}")
    if skipped_unmapped:
        print("Unmapped holder IDs (no entity exists for these):")
        for bid, info in skipped_unmapped:
            print(f"  - {bid}: {info}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
