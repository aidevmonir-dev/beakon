"""Shared helpers for master-tab import commands.

Each ``import_*.py`` for a master tab uses the same row-walking, type
coercion, and metadata round-trip logic. This module hosts the common parts
so per-tab commands stay focused on their column-to-field mapping and the
specific FK resolutions they need.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from django.core.management.base import CommandError

from organizations.models import Organization


def resolve_organization(organization_id: int | None) -> Organization:
    if organization_id:
        try:
            return Organization.objects.get(id=organization_id)
        except Organization.DoesNotExist as exc:
            raise CommandError(f"Organization id {organization_id} does not exist.") from exc

    orgs = list(Organization.objects.all()[:2])
    if not orgs:
        raise CommandError("No Organization exists. Pass --organization-id.")
    if len(orgs) > 1:
        raise CommandError("Multiple organizations exist. Re-run with --organization-id.")
    return orgs[0]


def rows_by_header(ws) -> list[dict[str, Any]]:
    headers = [text(ws.cell(1, col).value) for col in range(1, ws.max_column + 1)]
    rows: list[dict[str, Any]] = []
    for row_no in range(2, ws.max_row + 1):
        row: dict[str, Any] = {"_row": row_no}
        has_value = False
        for idx, header in enumerate(headers, start=1):
            v = value(ws.cell(row_no, idx).value)
            if v not in ("", None):
                has_value = True
            if header:
                row[header] = v
        if has_value:
            rows.append(row)
    return rows


def value(v: Any) -> Any:
    if isinstance(v, str):
        return v.strip()
    return v


def text(v: Any) -> str:
    v = value(v)
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, Decimal):
        return str(v)
    return str(v).strip()


def boolean(v: Any, *, default: bool = False) -> bool:
    s = text(v).lower()
    if not s:
        return default
    if s in {"yes", "y", "true", "1", "active"}:
        return True
    if s in {"no", "n", "false", "0", "inactive"}:
        return False
    return default


def decimal_or_none(v: Any):
    if v in ("", None):
        return None
    try:
        return Decimal(str(v))
    except Exception:
        return None


def date_or_none(v: Any):
    if v in ("", None):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return datetime.strptime(text(v), "%Y-%m-%d").date()
    except ValueError:
        return None


def json_safe(v: Any) -> Any:
    if isinstance(v, dict):
        return {str(k): json_safe(x) for k, x in v.items() if not str(k).startswith("_")}
    if isinstance(v, list):
        return [json_safe(x) for x in v]
    if isinstance(v, tuple):
        return [json_safe(x) for x in v]
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    return v


def clip_short_codes(defaults: dict, *, country_max: int = 4,
                     currency_fields: tuple[str, ...] = (),
                     ) -> None:
    """Silently clip workbook overflow in short-code columns.

    Workbook explanation rows sometimes spill text into shorter columns
    (e.g. a date in `Reporting_Currency`, a jurisdiction code in
    `Country_Code`). Rather than crash the import, clip and let the model
    persist the trimmed value.
    """
    if "country_code" in defaults and defaults["country_code"]:
        defaults["country_code"] = defaults["country_code"][:country_max]
    if "tax_residence_country" in defaults and defaults["tax_residence_country"]:
        defaults["tax_residence_country"] = defaults["tax_residence_country"][:country_max]
    for fld in currency_fields:
        if defaults.get(fld) and len(defaults[fld]) > 3:
            # If it's clearly not a 3-letter ISO code (date, garbage), drop it.
            v = defaults[fld].upper()
            defaults[fld] = v[:3] if v.isalpha() else ""


def is_explanation_row(rid: str, *, prefix: str, name: str = "", type_: str = "") -> bool:
    """A row is treated as an explanation/header if its ID lacks the workbook
    prefix, contains whitespace or '=' (free text), or has no name/type at all."""
    if not rid.startswith(prefix):
        return True
    if " " in rid or "=" in rid:
        return True
    if not name and not type_:
        return True
    return False


def map_row(row: dict[str, Any], column_map: dict[str, str],
            *, date_fields: set[str], decimal_fields: set[str],
            bool_fields: set[str]) -> tuple[dict, dict]:
    """Walk a workbook row using a column→field map and return (defaults, metadata).

    Anything not in ``column_map`` is preserved into ``metadata`` for round-trip.
    """
    defaults: dict[str, Any] = {}
    metadata: dict[str, Any] = {}

    for column, v in row.items():
        if column == "_row":
            continue
        if column in column_map:
            field = column_map[column]
            if field in date_fields:
                defaults[field] = date_or_none(v)
            elif field in decimal_fields:
                defaults[field] = decimal_or_none(v)
            elif field in bool_fields:
                defaults[field] = boolean(v, default=False)
            else:
                defaults[field] = text(v)
        else:
            if v not in (None, ""):
                metadata[column] = json_safe(v)
    return defaults, metadata
