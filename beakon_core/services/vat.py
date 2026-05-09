"""VATReportService — period summary of VAT activity by tax code.

Aggregates ``BillLine`` (Input VAT — purchases) and ``InvoiceLine``
(Output VAT — sales) over a period and returns:

  - per-tax-code totals (rate, output collected, input paid, net)
  - grand totals (output, input, net VAT due/refundable)

Filing-format specifics (Swiss eMWST / Form 0750, EU VAT returns) are out
of scope here — that's build #12 in the architecture queue. This service
gives the operator the right numbers; #12 wraps them in the country-
specific output.

V1 = accrual basis: VAT is recognised at bill approval / invoice issue.
A future cash-basis service will defer until payment.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as dt_date
from decimal import Decimal
from typing import Optional

from django.db.models import Q, Sum

from .. import constants as c
from ..models import BillLine, Entity, InvoiceLine, TaxCode


ZERO = Decimal("0")


@dataclass
class TaxCodeRow:
    tax_code_id: Optional[int]
    code: str
    name: str
    rate: Decimal
    sales_base: Decimal = ZERO          # pre-tax sales (sum of InvoiceLine.amount)
    output_vat: Decimal = ZERO          # VAT collected from customers
    purchases_base: Decimal = ZERO      # pre-tax purchases (sum of BillLine.amount)
    input_vat: Decimal = ZERO           # VAT paid to suppliers (recoverable portion)

    @property
    def net(self) -> Decimal:
        """Output - Input. Positive = payable to tax authority."""
        return self.output_vat - self.input_vat


@dataclass
class VATReport:
    organization_id: int
    entity_id: Optional[int]
    date_from: dt_date
    date_to: dt_date
    rows: list[TaxCodeRow] = field(default_factory=list)

    @property
    def total_output_vat(self) -> Decimal:
        return sum((r.output_vat for r in self.rows), ZERO)

    @property
    def total_input_vat(self) -> Decimal:
        return sum((r.input_vat for r in self.rows), ZERO)

    @property
    def net_vat_payable(self) -> Decimal:
        return self.total_output_vat - self.total_input_vat

    def as_dict(self) -> dict:
        return {
            "organization_id": self.organization_id,
            "entity_id": self.entity_id,
            "date_from": self.date_from.isoformat(),
            "date_to": self.date_to.isoformat(),
            "rows": [
                {
                    "tax_code_id": r.tax_code_id,
                    "code": r.code,
                    "name": r.name,
                    "rate": str(r.rate),
                    "sales_base": str(r.sales_base),
                    "output_vat": str(r.output_vat),
                    "purchases_base": str(r.purchases_base),
                    "input_vat": str(r.input_vat),
                    "net": str(r.net),
                }
                for r in self.rows
            ],
            "total_output_vat": str(self.total_output_vat),
            "total_input_vat": str(self.total_input_vat),
            "net_vat_payable": str(self.net_vat_payable),
        }


class VATReportService:
    """Build a VAT report for an organization (optionally narrowed to one entity)."""

    @staticmethod
    def report(
        *,
        organization,
        date_from: dt_date,
        date_to: dt_date,
        entity: Optional[Entity] = None,
    ) -> VATReport:
        # ── Output VAT — issued or paid invoices in the date range ──
        invoice_filter = Q(
            invoice__organization=organization,
            invoice__status__in=("issued", "paid"),
            invoice__invoice_date__gte=date_from,
            invoice__invoice_date__lte=date_to,
        )
        if entity is not None:
            invoice_filter &= Q(invoice__entity=entity)

        sales_rows = (
            InvoiceLine.objects
            .filter(invoice_filter)
            .values("tax_code_id")
            .annotate(
                sales_base=Sum("amount"),
                output_vat=Sum("tax_amount"),
            )
        )

        # ── Input VAT — approved or paid bills in the date range ──
        bill_filter = Q(
            bill__organization=organization,
            bill__status__in=("approved", "paid"),
            bill__invoice_date__gte=date_from,
            bill__invoice_date__lte=date_to,
        )
        if entity is not None:
            bill_filter &= Q(bill__entity=entity)

        purchase_rows = (
            BillLine.objects
            .filter(bill_filter)
            .filter(tax_code__isnull=False, tax_code__input_account__isnull=False)
            .values("tax_code_id")
            .annotate(
                purchases_base=Sum("amount"),
                input_vat=Sum("tax_amount"),
            )
        )

        # ── Merge by tax_code ──
        by_code: dict[Optional[int], TaxCodeRow] = {}
        codes_seen = {r["tax_code_id"] for r in sales_rows} | {r["tax_code_id"] for r in purchase_rows}
        tc_lookup = {
            tc.id: tc for tc in
            TaxCode.objects.filter(organization=organization, id__in=[c for c in codes_seen if c])
        }
        for tcid in codes_seen:
            tc = tc_lookup.get(tcid) if tcid else None
            by_code[tcid] = TaxCodeRow(
                tax_code_id=tcid,
                code=tc.code if tc else "(no code)",
                name=tc.name if tc else "(untagged)",
                rate=tc.rate if tc else ZERO,
            )

        for r in sales_rows:
            row = by_code[r["tax_code_id"]]
            row.sales_base = r["sales_base"] or ZERO
            row.output_vat = r["output_vat"] or ZERO
        for r in purchase_rows:
            row = by_code[r["tax_code_id"]]
            row.purchases_base = r["purchases_base"] or ZERO
            row.input_vat = r["input_vat"] or ZERO

        return VATReport(
            organization_id=organization.id,
            entity_id=entity.id if entity else None,
            date_from=date_from,
            date_to=date_to,
            rows=sorted(by_code.values(), key=lambda r: r.code),
        )
