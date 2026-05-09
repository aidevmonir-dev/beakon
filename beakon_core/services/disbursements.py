"""DisbursementService — convert rebillable costs into a client invoice.

Architecture PDF (page 13) headline example:
    "A DHL invoice is uploaded. Beakon identifies the supplier, amount, VAT,
    shipment reference, client matter, and whether the cost is rebillable —
    before an accountant touches it.
    A DHL cost can be posted as an expense and rebilled as a client
    disbursement — in a single posting."

Workflow:

  1. A bill is posted with one or more ``JournalLine`` rows flagged
     ``is_rebillable=True`` and tagged with ``rebill_client_dimension_value``.
     (BillService / ai_drafting set these flags upstream.)
  2. Periodically, ``DisbursementService.pending_lines()`` lists every
     rebillable line that hasn't yet been recovered.
  3. The operator (or AI assistant) picks a bundle of lines to invoice to
     a particular ``Customer`` and calls ``create_invoice_from_rebillables``.
  4. The service builds an ``Invoice`` (one ``InvoiceLine`` per source
     ``JournalLine``), stamps each source line's ``rebilled_invoice_line``
     FK so it cannot be billed twice, and returns the draft invoice for
     normal AR review (``submit_for_approval`` → ``issue``).

Accounting treatment in v1 — **net method**:

  - ``InvoiceLine.revenue_account`` defaults to the source line's
    own account (the original expense). On issuance, ``InvoiceService.issue``
    posts ``DR AR / CR <expense>`` — the recovery nets the cost back to
    zero in the P&L.
  - To use the **gross method** (rebillable expense kept in P&L; recovery
    posted to a separate "Disbursement income" account), pass an explicit
    ``recovery_account`` — every InvoiceLine credits that account instead.

V1 explicitly does NOT implement markup. The pass-through model is what
Thomas's PDF describes; markup (gross method with a margin) is a future
enhancement that will require splitting the recovery line.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date as dt_date, timedelta
from decimal import Decimal
from typing import Iterable, Optional

from django.db import transaction
from django.db.models import QuerySet, Sum

from .. import constants as c
from ..exceptions import ValidationError
from ..models import (
    Account,
    Customer,
    DimensionValue,
    Entity,
    Invoice,
    InvoiceLine,
    JournalLine,
)
from .invoices import InvoiceService


@dataclass(frozen=True)
class DisbursementSummary:
    """One row of pending-disbursement totals, grouped by client + currency."""
    client_dimension_value_id: Optional[int]
    client_code: Optional[str]
    client_name: Optional[str]
    currency: str
    total_amount: Decimal
    line_count: int


class DisbursementService:
    """Pure service — no signals, no auto-posting. Caller drives the flow."""

    # ── Discovery ─────────────────────────────────────────────────────

    @staticmethod
    def pending_lines(
        *,
        organization,
        entity: Optional[Entity] = None,
        client_dimension_value: Optional[DimensionValue] = None,
        currency: Optional[str] = None,
    ) -> QuerySet[JournalLine]:
        """Rebillable journal lines that have not yet been billed to a client.

        Only POSTED journal entries are considered — drafts and pending-
        approval entries are still mutable, so billing them would create
        an audit gap.
        """
        qs = (
            JournalLine.objects
            .filter(
                journal_entry__organization=organization,
                journal_entry__status=c.JE_POSTED,
                is_rebillable=True,
                rebilled_invoice_line__isnull=True,
            )
            .select_related(
                "journal_entry",
                "account",
                "rebill_client_dimension_value",
            )
            .order_by("journal_entry__date", "id")
        )
        if entity is not None:
            qs = qs.filter(journal_entry__entity=entity)
        if client_dimension_value is not None:
            qs = qs.filter(rebill_client_dimension_value=client_dimension_value)
        if currency is not None:
            qs = qs.filter(currency=currency.upper())
        return qs

    @staticmethod
    def summarize_pending(
        *,
        organization,
        entity: Optional[Entity] = None,
    ) -> list[DisbursementSummary]:
        """Group pending rebillables by (client dim value, currency) for an
        operator overview ("who do we owe an invoice to, and how much").
        """
        from django.db.models import Count

        # NB: pending_lines() applies .order_by(journal_entry__date, id),
        # and Django will silently fold those columns into GROUP BY when
        # combined with .values()/.annotate() — splitting each client into
        # per-JE rows. Clear the ordering before aggregating.
        rows = (
            DisbursementService.pending_lines(organization=organization, entity=entity)
            .order_by()
            .values(
                "rebill_client_dimension_value_id",
                "rebill_client_dimension_value__code",
                "rebill_client_dimension_value__name",
                "currency",
            )
            .annotate(
                total_amount=Sum("debit"),
                line_count=Count("id"),
            )
            .order_by(
                "rebill_client_dimension_value__code", "currency",
            )
        )
        return [
            DisbursementSummary(
                client_dimension_value_id=r["rebill_client_dimension_value_id"],
                client_code=r["rebill_client_dimension_value__code"],
                client_name=r["rebill_client_dimension_value__name"],
                currency=r["currency"],
                total_amount=r["total_amount"] or Decimal("0"),
                line_count=r["line_count"],
            )
            for r in rows
        ]

    # ── Invoice creation ─────────────────────────────────────────────

    @staticmethod
    @transaction.atomic
    def create_invoice_from_rebillables(
        *,
        organization,
        entity: Entity,
        customer: Customer,
        journal_line_ids: Iterable[int],
        invoice_date: dt_date,
        due_date: Optional[dt_date] = None,
        recovery_account: Optional[Account] = None,
        description: str = "",
        user=None,
    ) -> Invoice:
        """Build a draft Invoice from the selected rebillable JournalLines.

        After this returns, the invoice still needs the normal AR review
        path: ``InvoiceService.submit_for_approval`` then ``.issue``. Each
        source line's ``rebilled_invoice_line`` FK is stamped immediately
        so concurrent calls don't double-bill.

        Validation:
          - Every line must be (a) in this organization, (b) posted,
            (c) ``is_rebillable=True``, (d) not already rebilled.
          - All lines must share the same currency.
          - At least one line must be selected.
          - If ``recovery_account`` is given, it must belong to this org.
        """
        line_ids = list(journal_line_ids)
        if not line_ids:
            raise ValidationError(
                "At least one rebillable line is required.", code="DSB001",
            )

        # Lock the rows so a parallel call can't race us.
        lines = list(
            JournalLine.objects
            .select_for_update()
            .filter(id__in=line_ids)
            .select_related("journal_entry", "account")
        )
        seen = {ln.id for ln in lines}
        missing = [lid for lid in line_ids if lid not in seen]
        if missing:
            raise ValidationError(
                f"JournalLine ids not found: {missing}", code="DSB002",
            )

        # ── Per-line validation ────────────────────────────────────
        currencies = set()
        for ln in lines:
            if ln.journal_entry.organization_id != organization.id:
                raise ValidationError(
                    f"JournalLine {ln.id} belongs to a different organization.",
                    code="DSB003",
                )
            if ln.journal_entry.status != c.JE_POSTED:
                raise ValidationError(
                    f"JournalLine {ln.id} is on a {ln.journal_entry.status} JE; "
                    "only posted lines can be rebilled.",
                    code="DSB004",
                )
            if not ln.is_rebillable:
                raise ValidationError(
                    f"JournalLine {ln.id} is not flagged as rebillable.",
                    code="DSB005",
                )
            if ln.rebilled_invoice_line_id is not None:
                raise ValidationError(
                    f"JournalLine {ln.id} has already been billed on InvoiceLine "
                    f"{ln.rebilled_invoice_line_id}.",
                    code="DSB006",
                )
            if ln.debit <= 0:
                raise ValidationError(
                    f"JournalLine {ln.id} has zero debit amount; nothing to bill.",
                    code="DSB007",
                )
            currencies.add(ln.currency)
        if len(currencies) > 1:
            raise ValidationError(
                f"All rebillable lines must share one currency, got {sorted(currencies)}.",
                code="DSB008",
            )
        currency = next(iter(currencies))

        if recovery_account is not None and recovery_account.organization_id != organization.id:
            raise ValidationError(
                "Recovery account does not belong to this organization.",
                code="DSB009",
            )

        # ── Build invoice line specs ──────────────────────────────
        if due_date is None:
            due_date = invoice_date + timedelta(
                days=customer.default_payment_terms_days
            )
        line_specs: list[dict] = []
        for idx, ln in enumerate(lines):
            line_specs.append({
                "revenue_account_id": (
                    recovery_account.id if recovery_account is not None
                    else ln.account_id
                ),
                "amount": ln.debit,
                "quantity": Decimal("1"),
                "unit_price": ln.debit,
                "description": (
                    f"Rebillable: {ln.account.code} {ln.account.name} · "
                    f"JE {ln.journal_entry.entry_number}"
                    + (f" · {ln.description}" if ln.description else "")
                )[:500],
                "line_order": idx,
            })

        invoice = InvoiceService.create_draft(
            organization=organization,
            entity=entity,
            customer=customer,
            invoice_date=invoice_date,
            due_date=due_date,
            currency=currency,
            lines=line_specs,
            description=description or (
                f"Disbursement recovery — {len(lines)} rebillable line"
                + ("s" if len(lines) != 1 else "")
            ),
            user=user,
        )

        # ── Stamp the source journal lines so they can't be re-billed ──
        invoice_lines = list(invoice.lines.order_by("line_order"))
        if len(invoice_lines) != len(lines):
            # Should be impossible — line_specs is 1:1 with lines.
            raise ValidationError(
                "Internal error: invoice line count mismatch.", code="DSB010",
            )
        for src_ln, inv_ln in zip(lines, invoice_lines):
            src_ln.rebilled_invoice_line = inv_ln
        JournalLine.objects.bulk_update(lines, ["rebilled_invoice_line"])

        return invoice
