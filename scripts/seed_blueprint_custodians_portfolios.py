"""Enrich CUST + PORT DimensionValues from the blueprint masters
(``2026 04 17-DRAFT-CoA-Wealth management v2.xlsx``, sheets
``13_Custodian_Master`` and ``14_Portfolio_Master``).

Today both Custodian and Portfolio live as DimensionValue rows under
their respective DimensionTypes (CUST, PORT). Earlier seeding from
``05 Dimension Values`` populated the basics — code + name + parent +
active. The master sheets carry much richer columns (linked
counterparty, booking center, supports-flags, asset-allocation profile,
owner, etc.) that we want to retain.

Strategy: ``update_or_create`` per code so existing utility rows
(CUST_INT_BOOK / CUST_OTHER / etc. that don't appear in the master)
stay untouched, while any code that appears in a master either gets
created fresh or has its name/description/parent/dates updated and
the full row stored in ``workbook_metadata`` JSON for queryability.

Idempotent. Safe to re-run as the master sheet evolves.

Run:  ./venv/Scripts/python.exe scripts/seed_blueprint_custodians_portfolios.py
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "digits_clone.settings")
django.setup()

from organizations.models import Organization  # noqa: E402
from beakon_core.models import DimensionType, DimensionValue  # noqa: E402


XLSX = Path("D:/Thomas/2026 04 17-DRAFT-CoA-Wealth management v2.xlsx")
ORG_NAME = "Beakon"


def yes(v) -> bool:
    return str(v or "").strip().lower() == "yes"


def to_date(v) -> date | None:
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def jsonable(row: dict) -> dict:
    """Make sure every value in the row is JSON-serializable. openpyxl
    can hand us datetime objects from date cells — those need ISO
    formatting before they hit a JSONField."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        if v is None or v == "":
            continue
        if isinstance(v, datetime):
            out[k] = v.date().isoformat()
        elif isinstance(v, date):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def load_real_rows(ws, id_field: str, prefix: str) -> list[dict]:
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    field_idx = {h: i for i, h in enumerate(header) if h is not None}
    out: list[dict] = []
    for r in rows[1:]:
        rid = r[field_idx[id_field]] if field_idx.get(id_field) is not None else None
        if not isinstance(rid, str) or not rid.startswith(prefix):
            continue
        out.append({h: r[i] for h, i in field_idx.items()})
    return out


def upsert(
    *,
    org: Organization,
    dim_type: DimensionType,
    code: str,
    name: str,
    description: str,
    parent_value_code: str,
    active_flag: bool,
    effective_from: date | None,
    effective_to: date | None,
    external_reference: str,
    notes: str,
    workbook_metadata: dict,
) -> tuple[DimensionValue, bool]:
    return DimensionValue.objects.update_or_create(
        organization=org,
        dimension_type=dim_type,
        code=code,
        defaults=dict(
            name=name or code,
            description=description or "",
            parent_value_code=parent_value_code or "",
            active_flag=active_flag,
            effective_from=effective_from,
            effective_to=effective_to,
            external_reference=external_reference or "",
            notes=notes or "",
            workbook_metadata=workbook_metadata,
        ),
    )


def main() -> int:
    org = Organization.objects.filter(name=ORG_NAME).first()
    if org is None:
        print(f"ERROR: organization {ORG_NAME!r} not found.", file=sys.stderr)
        return 1

    wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)

    # ── Custodians (CUST) ─────────────────────────────────────────────
    print("Step 1: 13_Custodian_Master -> DimensionValues for CUST")
    cust_dt = DimensionType.objects.get(organization=org, code="CUST")
    cust_rows = load_real_rows(wb["13_Custodian_Master"], "Custodian_ID", "CUST_")
    print(f"  {len(cust_rows)} master rows")

    cust_created = cust_updated = 0
    for row in cust_rows:
        _, created = upsert(
            org=org, dim_type=cust_dt,
            code=row["Custodian_ID"],
            name=row.get("Custodian_Name") or row["Custodian_ID"],
            description=(row.get("Short_Name") or "") + (
                f" — {row['Booking_Center']}" if row.get("Booking_Center") else ""
            ),
            parent_value_code="",
            active_flag=yes(row.get("Active_Flag")) and (
                str(row.get("Status") or "").upper() != "INACTIVE"
            ),
            effective_from=to_date(row.get("Relationship_Start_Date")),
            effective_to=to_date(row.get("Relationship_End_Date")),
            external_reference=row.get("Linked_Counterparty_ID") or "",
            notes=row.get("Notes") or "",
            workbook_metadata=jsonable(row),
        )
        if created:
            cust_created += 1
            print(f"  + CUST {row['Custodian_ID']:<22} {row.get('Custodian_Name')}")
        else:
            cust_updated += 1
            print(f"  ~ CUST {row['Custodian_ID']:<22} updated")

    # ── Portfolios (PORT) ─────────────────────────────────────────────
    print()
    print("Step 2: 14_Portfolio_Master -> DimensionValues for PORT")
    port_dt = DimensionType.objects.get(organization=org, code="PORT")
    port_rows = load_real_rows(wb["14_Portfolio_Master"], "Portfolio_ID", "PORT_")
    print(f"  {len(port_rows)} master rows")

    port_created = port_updated = 0
    for row in port_rows:
        _, created = upsert(
            org=org, dim_type=port_dt,
            code=row["Portfolio_ID"],
            name=row.get("Portfolio_Name") or row["Portfolio_ID"],
            description=(row.get("Short_Name") or "") + (
                f" — {row.get('Asset_Allocation_Profile')}"
                if row.get("Asset_Allocation_Profile") else ""
            ),
            parent_value_code=row.get("Parent_Portfolio_ID") or "",
            active_flag=yes(row.get("Active_Flag")) and (
                str(row.get("Status") or "").upper() != "INACTIVE"
            ),
            effective_from=to_date(row.get("Open_Date")),
            effective_to=to_date(row.get("Close_Date")),
            external_reference=row.get("Linked_Custodian_ID") or "",
            notes=row.get("Notes") or "",
            workbook_metadata=jsonable(row),
        )
        if created:
            port_created += 1
            print(f"  + PORT {row['Portfolio_ID']:<22} {row.get('Portfolio_Name')}")
        else:
            port_updated += 1
            print(f"  ~ PORT {row['Portfolio_ID']:<22} updated")

    # ── Summary ───────────────────────────────────────────────────────
    print()
    print(f"Custodians: created={cust_created}  updated={cust_updated}  "
          f"total CUST values now: "
          f"{DimensionValue.objects.filter(organization=org, dimension_type=cust_dt).count()}")
    print(f"Portfolios: created={port_created}  updated={port_updated}  "
          f"total PORT values now: "
          f"{DimensionValue.objects.filter(organization=org, dimension_type=port_dt).count()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
