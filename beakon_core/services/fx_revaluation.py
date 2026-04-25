"""FX revaluation engine.

At period end (or any chosen ``as_of`` date), monetary balances held in a
non-functional currency must be re-translated to the entity's functional
currency at the **closing rate**. The difference between the historical
functional balance (already on the books) and the target functional
balance is an unrealized FX gain or loss.

Scope (blueprint p.2: "multi-entity / cross-border groups"):
    - Monetary accounts only — see ``MONETARY_SUBTYPES`` in constants.py.
    - Non-monetary items (inventory, fixed assets, equity, P&L) carry at
      historical rate and are excluded.
    - Per (account, transaction-currency) pair: many accounts can carry
      balances in multiple foreign currencies (e.g. one bank account that
      holds both EUR and CHF).

Output:
    - ONE draft ``JournalEntry`` per run, with ``source_type=fx_revaluation``,
      dated ``as_of``, attached to the period containing ``as_of``.
    - One adjustment line per (account, currency) pair whose computed
      adjustment exceeds tolerance (currently 0.01 functional units).
    - Adjustment lines are booked in the FUNCTIONAL currency (rate=1) — the
      foreign-currency balance does NOT change, only the functional view of
      it. Querying the account by ``currency='EUR'`` later still returns the
      original EUR balance; querying by ``functional_*`` reflects the
      revalued total.
    - Offset lines: gross FX gain → CR ``fx_gain``; gross FX loss →
      DR ``fx_loss``. The two offsets keep the JE balanced.

Approval flow:
    The service creates a DRAFT and returns it. Caller decides whether to
    fast-track (submit/approve/post programmatically) or send through normal
    human approval. Drafts do not affect ledger balances.

Idempotency:
    For a given (entity, as_of) tuple, an existing DRAFT revaluation JE is
    deleted and rebuilt. An existing POSTED revaluation JE blocks the run —
    the caller must reverse it first.
"""
from datetime import date as dt_date
from decimal import Decimal
from typing import Optional

from django.db import models as db_models
from django.db import transaction

from .. import constants as c
from ..exceptions import ValidationError
from ..models import Account, Entity, JournalEntry, JournalLine
from .entity import EntityService
from .fx import FXService
from .journal import JournalService


ZERO = Decimal("0")
# Adjustments below this threshold (in functional currency) are skipped.
# Matches the per-JE balance tolerance.
REVAL_TOLERANCE = Decimal("0.01")


class FXRevaluationService:
    @staticmethod
    @transaction.atomic
    def revalue(
        *,
        entity: Entity,
        as_of: dt_date,
        user=None,
        memo: str = "",
    ) -> Optional[JournalEntry]:
        """Compute and book FX revaluation adjustments for ``entity`` as of
        the given date. Returns the draft JournalEntry, or ``None`` if no
        adjustments were needed.

        Raises:
            ValidationError: a posted revaluation already exists for this
                entity/date, OR a required fx_gain/fx_loss account is missing.
        """
        functional_ccy = entity.functional_currency

        # ── Idempotency: handle prior revaluation JEs at this date ──────
        prior = JournalEntry.objects.filter(
            entity=entity,
            source_type=c.SOURCE_FX_REVALUATION,
            date=as_of,
        )
        posted_prior = prior.filter(status__in=[c.JE_POSTED, c.JE_REVERSED]).first()
        if posted_prior:
            raise ValidationError(
                f"A {posted_prior.status} FX revaluation entry already exists "
                f"for {entity.code} on {as_of} ({posted_prior.entry_number}). "
                "Reverse it before rerunning revaluation.",
                code=c.ERR_POSTED_IMMUTABLE,
                details={
                    "entity": entity.code,
                    "as_of": str(as_of),
                    "existing_entry": posted_prior.entry_number,
                    "existing_status": posted_prior.status,
                },
            )
        # Drop any existing draft so we can rebuild cleanly.
        prior.filter(status=c.JE_DRAFT).delete()

        # ── Find balances needing revaluation ───────────────────────────
        # Group POSTED lines on this entity, on monetary accounts, in a
        # non-functional currency, dated on or before as_of, by (account, ccy).
        balances = (
            JournalLine.objects
            .filter(
                journal_entry__entity=entity,
                journal_entry__status__in=c.JE_LEDGER_IMPACTING,
                journal_entry__date__lte=as_of,
                account__account_subtype__in=c.MONETARY_SUBTYPES,
            )
            .exclude(currency=functional_ccy)
            .values("account_id", "currency")
            .annotate(
                txn_dr=db_models.Sum("debit", default=ZERO),
                txn_cr=db_models.Sum("credit", default=ZERO),
                func_dr=db_models.Sum("functional_debit", default=ZERO),
                func_cr=db_models.Sum("functional_credit", default=ZERO),
            )
        )

        # ── Compute adjustments ─────────────────────────────────────────
        adjustment_lines = []
        gross_gain = ZERO  # sum of positive adjustments (account got revalued UP)
        gross_loss = ZERO  # sum of |negative adjustments| (account got revalued DOWN)

        for row in balances:
            account_id = row["account_id"]
            txn_ccy = row["currency"]
            txn_balance = (row["txn_dr"] or ZERO) - (row["txn_cr"] or ZERO)
            current_func = (row["func_dr"] or ZERO) - (row["func_cr"] or ZERO)

            if txn_balance == ZERO:
                # Foreign currency balance is zero — nothing to revalue,
                # even if there's residual functional balance from rounding.
                continue

            closing_rate = FXService.rate(
                from_currency=txn_ccy,
                to_currency=functional_ccy,
                as_of=as_of,
            )
            target_func = (txn_balance * closing_rate).quantize(Decimal("0.0001"))
            adjustment = (target_func - current_func).quantize(Decimal("0.0001"))

            if abs(adjustment) < REVAL_TOLERANCE:
                continue

            account = Account.objects.get(pk=account_id)
            if adjustment > 0:
                # DR the account by adjustment (functional value increases)
                debit, credit = adjustment, ZERO
                gross_gain += adjustment
            else:
                # CR the account by |adjustment| (functional value decreases)
                debit, credit = ZERO, abs(adjustment)
                gross_loss += abs(adjustment)

            adjustment_lines.append({
                "account_id": account_id,
                "description": (
                    f"FX reval {txn_ccy}→{functional_ccy} at "
                    f"{closing_rate.quantize(Decimal('0.000001'))} "
                    f"(was {current_func.quantize(Decimal('0.01'))}, "
                    f"now {target_func.quantize(Decimal('0.01'))})"
                ),
                "debit": debit,
                "credit": credit,
                "currency": functional_ccy,
                "exchange_rate": Decimal("1"),
                # Capture which foreign currency this revaluation came from,
                # in metadata-style: we don't have a dedicated field, so
                # encode in description above for the audit trail.
            })

        if not adjustment_lines:
            return None  # nothing to do

        # ── Look up offset accounts ─────────────────────────────────────
        # Required for whichever direction(s) we have balances in.
        fx_gain_account = _find_pl_account(entity, "fx_gain") if gross_gain > 0 else None
        fx_loss_account = _find_pl_account(entity, "fx_loss") if gross_loss > 0 else None

        if gross_gain > 0 and fx_gain_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no fx_gain account but revaluation "
                f"produced gross FX gains of {gross_gain.quantize(Decimal('0.01'))} "
                f"{functional_ccy}. Create an account with subtype='fx_gain' first.",
                code=c.ERR_INACTIVE_ACCOUNT,
                details={"entity": entity.code, "missing_subtype": "fx_gain"},
            )
        if gross_loss > 0 and fx_loss_account is None:
            raise ValidationError(
                f"Entity {entity.code} has no fx_loss account but revaluation "
                f"produced gross FX losses of {gross_loss.quantize(Decimal('0.01'))} "
                f"{functional_ccy}. Create an account with subtype='fx_loss' first.",
                code=c.ERR_INACTIVE_ACCOUNT,
                details={"entity": entity.code, "missing_subtype": "fx_loss"},
            )

        # Add offset lines (gross — keeps gains and losses visible separately)
        if gross_gain > 0:
            adjustment_lines.append({
                "account_id": fx_gain_account.id,
                "description": f"Unrealized FX gain — period revaluation as of {as_of}",
                "debit": ZERO,
                "credit": gross_gain.quantize(Decimal("0.0001")),
                "currency": functional_ccy,
                "exchange_rate": Decimal("1"),
            })
        if gross_loss > 0:
            adjustment_lines.append({
                "account_id": fx_loss_account.id,
                "description": f"Unrealized FX loss — period revaluation as of {as_of}",
                "debit": gross_loss.quantize(Decimal("0.0001")),
                "credit": ZERO,
                "currency": functional_ccy,
                "exchange_rate": Decimal("1"),
            })

        # ── Create the draft JE via JournalService ──────────────────────
        # Going through the service preserves entry numbering, period attach,
        # FX recapture logic, and writes an ApprovalAction "draft created" row.
        memo = memo or (
            f"FX revaluation as of {as_of} — "
            f"{len(adjustment_lines) - (1 if gross_gain else 0) - (1 if gross_loss else 0)} "
            f"account adjustment(s); "
            f"gross gain {gross_gain.quantize(Decimal('0.01'))}, "
            f"gross loss {gross_loss.quantize(Decimal('0.01'))} {functional_ccy}"
        )
        entry = JournalService.create_draft(
            organization=entity.organization,
            entity=entity,
            date=as_of,
            lines=adjustment_lines,
            user=user,
            memo=memo,
            source_type=c.SOURCE_FX_REVALUATION,
            source_ref=f"REVAL-{entity.code}-{as_of.isoformat()}",
            currency=functional_ccy,
        )
        return entry


# ── Helpers ──────────────────────────────────────────────────────────────

def _find_pl_account(entity: Entity, subtype: str) -> Optional[Account]:
    """Find an active P&L account on this entity (or shared) with the given
    subtype. If multiple match, prefer entity-scoped over shared."""
    qs = Account.objects.filter(
        organization=entity.organization,
        account_subtype=subtype,
        is_active=True,
    ).filter(
        db_models.Q(entity=entity) | db_models.Q(entity__isnull=True)
    )
    # Entity-scoped first
    return qs.order_by(db_models.F("entity").desc(nulls_last=True)).first()
