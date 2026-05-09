"""Bank reconciliation report.

Read-only computation comparing the bank statement (BankTransaction rows)
against the general ledger (JournalLine rows on the bank's CoA account).

  ┌────────────────┐     ┌────────────────┐
  │ Bank statement │     │  General Ledger │
  │  (real money)  │     │ (what books say) │
  └────────────────┘     └────────────────┘
          │                       │
          └────── matched ────────┘
                  via BankTransaction.proposed_journal_entry
                  (status TXN_MATCHED, JE status JE_POSTED)

Reconciling items:

* "Outstanding bank" = txns on the statement with status NEW/PROPOSED.
  These have hit the bank but the GL doesn't know about them yet
  (e.g. bank fee, interest credit, automatic charge).

* "Outstanding GL" = JL rows on the bank account whose JE isn't linked
  by any matched BankTransaction. These are in the books but haven't
  cleared the bank yet (deposits in transit, outstanding checks).

The report also auto-suggests matches between unmatched bank txns and
unmatched GL lines where amount + date (±5 days) line up — so the user
can confirm them in one click. Suggestions are advisory only; nothing
gets persisted from this endpoint.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as dt_date
from decimal import Decimal
from typing import Any

from django.db.models import Sum

from beakon_banking import constants as c
from beakon_banking.models import BankAccount, BankTransaction
from beakon_core import constants as core_c
from beakon_core.models import JournalLine

ZERO = Decimal("0")
MATCH_DATE_TOLERANCE_DAYS = 5


@dataclass
class ReconReport:
    bank_account_id: int
    bank_account_name: str
    bank_account_currency: str
    entity_code: str
    as_of: str
    bank_balance: str
    gl_balance: str
    difference: str
    matched_count: int
    matched: list[dict[str, Any]] = field(default_factory=list)
    outstanding_bank: list[dict[str, Any]] = field(default_factory=list)
    outstanding_gl: list[dict[str, Any]] = field(default_factory=list)
    suggestions: list[dict[str, Any]] = field(default_factory=list)
    summary: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "bank_account_id": self.bank_account_id,
            "bank_account_name": self.bank_account_name,
            "bank_account_currency": self.bank_account_currency,
            "entity_code": self.entity_code,
            "as_of": self.as_of,
            "bank_balance": self.bank_balance,
            "gl_balance": self.gl_balance,
            "difference": self.difference,
            "matched_count": self.matched_count,
            "matched": self.matched,
            "outstanding_bank": self.outstanding_bank,
            "outstanding_gl": self.outstanding_gl,
            "suggestions": self.suggestions,
            "summary": self.summary,
        }


class BankReconciliationService:
    """Compute the reconciliation report for one bank account, as of a date."""

    @staticmethod
    def report(*, bank_account: BankAccount, as_of: dt_date) -> ReconReport:
        # ── Bank balance per statement ────────────────────────────────
        latest_txn = (
            BankTransaction.objects
            .filter(bank_account=bank_account, date__lte=as_of)
            .order_by("-date", "-id")
            .first()
        )
        if latest_txn and latest_txn.balance_after is not None:
            bank_balance = Decimal(latest_txn.balance_after)
        else:
            agg = (
                BankTransaction.objects
                .filter(bank_account=bank_account, date__lte=as_of)
                .exclude(status=c.TXN_IGNORED)
                .aggregate(s=Sum("amount"))
            )
            bank_balance = Decimal(agg["s"] or 0)

        # ── GL balance on the linked CoA account ──────────────────────
        gl_qs = (
            JournalLine.objects
            .filter(
                account=bank_account.account,
                journal_entry__status=core_c.JE_POSTED,
                journal_entry__date__lte=as_of,
            )
            .select_related("journal_entry")
            .order_by("journal_entry__date", "id")
        )
        gl_agg = gl_qs.aggregate(d=Sum("debit"), c=Sum("credit"))
        gl_balance = (
            Decimal(gl_agg["d"] or 0) - Decimal(gl_agg["c"] or 0)
        )

        # ── Matched txns (bank ↔ posted JE) ───────────────────────────
        matched_qs = (
            BankTransaction.objects
            .filter(
                bank_account=bank_account,
                date__lte=as_of,
                status=c.TXN_MATCHED,
            )
            .select_related("proposed_journal_entry")
            .order_by("date", "id")
        )
        matched_je_ids: set[int] = set()
        matched: list[dict[str, Any]] = []
        for t in matched_qs:
            je = t.proposed_journal_entry
            if je is None:
                continue
            matched_je_ids.add(je.id)
            matched.append({
                "txn_id": t.id,
                "date": t.date.isoformat(),
                "description": t.description or "",
                "amount": str(t.amount),
                "currency": t.currency,
                "je_id": je.id,
                "je_number": je.entry_number,
                "je_date": je.date.isoformat(),
            })

        # ── Outstanding bank txns (in bank, not in books) ─────────────
        outstanding_bank: list[dict[str, Any]] = []
        out_bank_qs = (
            BankTransaction.objects
            .filter(bank_account=bank_account, date__lte=as_of)
            .exclude(status__in=[c.TXN_MATCHED, c.TXN_IGNORED])
            .order_by("date", "id")
        )
        for t in out_bank_qs:
            outstanding_bank.append({
                "txn_id": t.id,
                "date": t.date.isoformat(),
                "description": t.description or "",
                "amount": str(t.amount),
                "currency": t.currency,
                "status": t.status,
            })

        # ── Outstanding GL lines (in books, not in bank) ──────────────
        outstanding_gl: list[dict[str, Any]] = []
        for jl in gl_qs.exclude(journal_entry_id__in=matched_je_ids):
            signed = Decimal(jl.debit) - Decimal(jl.credit)
            outstanding_gl.append({
                "line_id": jl.id,
                "date": jl.journal_entry.date.isoformat(),
                "description": jl.description or jl.journal_entry.memo or "",
                "debit": str(jl.debit),
                "credit": str(jl.credit),
                "amount_signed": str(signed),
                "je_id": jl.journal_entry_id,
                "je_number": jl.journal_entry.entry_number,
            })

        # ── Suggestions: same amount, date within ±5 days ─────────────
        suggestions: list[dict[str, Any]] = []
        used_lines: set[int] = set()
        for ob in outstanding_bank:
            try:
                ob_amt = Decimal(ob["amount"])
            except Exception:
                continue
            ob_date = dt_date.fromisoformat(ob["date"])
            for og in outstanding_gl:
                if og["line_id"] in used_lines:
                    continue
                if Decimal(og["amount_signed"]) != ob_amt:
                    continue
                og_date = dt_date.fromisoformat(og["date"])
                delta = abs((ob_date - og_date).days)
                if delta <= MATCH_DATE_TOLERANCE_DAYS:
                    suggestions.append({
                        "txn_id": ob["txn_id"],
                        "line_id": og["line_id"],
                        "amount": ob["amount"],
                        "date_delta_days": delta,
                        "txn_description": ob["description"],
                        "je_number": og["je_number"],
                    })
                    used_lines.add(og["line_id"])
                    break

        # ── Reconciling-items breakdown ───────────────────────────────
        ob_pos = sum(
            (Decimal(x["amount"]) for x in outstanding_bank if Decimal(x["amount"]) > 0),
            ZERO,
        )
        ob_neg = sum(
            (Decimal(x["amount"]) for x in outstanding_bank if Decimal(x["amount"]) < 0),
            ZERO,
        )
        og_pos = sum(
            (Decimal(x["amount_signed"]) for x in outstanding_gl if Decimal(x["amount_signed"]) > 0),
            ZERO,
        )
        og_neg = sum(
            (Decimal(x["amount_signed"]) for x in outstanding_gl if Decimal(x["amount_signed"]) < 0),
            ZERO,
        )

        # Adjusted bank balance: + GL deposits not yet on bank
        #                        - GL withdrawals not yet on bank
        adj_bank = bank_balance + og_pos + og_neg
        # Adjusted GL balance: + bank credits not yet in books
        #                      - bank debits not yet in books
        adj_gl = gl_balance + ob_pos + ob_neg
        difference = adj_bank - adj_gl

        summary = {
            "bank_balance": str(bank_balance),
            "gl_deposits_not_in_bank": str(og_pos),
            "gl_withdrawals_not_in_bank": str(og_neg),
            "adjusted_bank_balance": str(adj_bank),
            "gl_balance": str(gl_balance),
            "bank_credits_not_in_books": str(ob_pos),
            "bank_debits_not_in_books": str(ob_neg),
            "adjusted_gl_balance": str(adj_gl),
            "difference": str(difference),
        }

        return ReconReport(
            bank_account_id=bank_account.id,
            bank_account_name=bank_account.name,
            bank_account_currency=bank_account.currency,
            entity_code=bank_account.entity.code,
            as_of=as_of.isoformat(),
            bank_balance=str(bank_balance),
            gl_balance=str(gl_balance),
            difference=str(difference),
            matched_count=len(matched),
            matched=matched,
            outstanding_bank=outstanding_bank,
            outstanding_gl=outstanding_gl,
            suggestions=suggestions,
            summary=summary,
        )
