"""JournalService — the state machine the blueprint mandates.

Workflow (Objective 4):
    draft → pending_approval → approved → posted
                            → rejected  → (back to draft after edit)
    posted → reversed

Every transition:
  1. Checks ``JE_TRANSITIONS`` to confirm the move is legal from current status
  2. Writes an ``ApprovalAction`` audit row
  3. Stamps the actor + timestamp on the JE row

Balance checks (debit == credit in functional currency) run on SUBMIT, not
DRAFT — drafts are allowed to be out-of-balance while the user is typing.
"""
from decimal import Decimal

from django.db import models as db_models
from django.db import transaction
from django.utils import timezone

from .. import constants as c
from ..exceptions import (
    EntityMismatch,
    IntercompanyUnbalanced,
    InvalidTransition,
    PeriodClosed,
    PostedImmutable,
    SelfApproval,
    ValidationError,
)
from ..models import ApprovalAction, IntercompanyGroup, JournalEntry, JournalLine, Period
from .entity import EntityService
from .fx import FXService


ZERO = Decimal("0")
BALANCE_TOLERANCE = Decimal("0.0001")
# Cross-entity sums accumulate small rounding differences from FX conversion;
# 0.01 (one cent in the reporting currency) is a defensible v1 cutoff.
INTERCOMPANY_TOLERANCE = Decimal("0.01")

# Account subtypes whose lines are considered "intercompany" for netting.
# A line also counts as intercompany if its ``counterparty_entity`` is set,
# regardless of the account's subtype.
INTERCOMPANY_SUBTYPES = ("intercompany_receivable", "intercompany_payable")


# ── Validation primitives ──────────────────────────────────────────────────

class _Validator:
    """Runs all validation rules on an entry. Accumulates errors."""

    def __init__(self, entry: JournalEntry):
        self.entry = entry
        self.errors = []

    def balance(self):
        total = self.entry.lines.aggregate(
            dr=db_models.Sum("functional_debit", default=ZERO),
            cr=db_models.Sum("functional_credit", default=ZERO),
        )
        dr = total["dr"] or ZERO
        cr = total["cr"] or ZERO
        if abs(dr - cr) > BALANCE_TOLERANCE:
            self.errors.append(ValidationError(
                "Journal entry does not balance in functional currency",
                code=c.ERR_NOT_BALANCED,
                details={"debit": str(dr), "credit": str(cr), "diff": str(dr - cr)},
            ))

    def min_lines(self):
        if self.entry.lines.count() < 2:
            self.errors.append(ValidationError(
                "A journal entry needs at least 2 lines",
                code=c.ERR_MIN_LINES,
            ))

    def accounts_active(self):
        inactive = self.entry.lines.filter(account__is_active=False).select_related("account")
        for line in inactive:
            self.errors.append(ValidationError(
                f"Account {line.account.code} is inactive",
                code=c.ERR_INACTIVE_ACCOUNT,
                details={"account": line.account.code},
            ))

    def accounts_belong_to_entity(self):
        """An entity-scoped account must match the JE's entity; shared
        accounts (entity=NULL) are fine."""
        mismatched = (
            self.entry.lines
            .filter(account__entity__isnull=False)
            .exclude(account__entity=self.entry.entity)
            .select_related("account")
        )
        for line in mismatched:
            self.errors.append(EntityMismatch(
                f"Account {line.account.code} belongs to a different entity",
                code=c.ERR_ACCOUNT_ENTITY_MISMATCH,
                details={"account": line.account.code, "expected_entity": self.entry.entity.code},
            ))

    def period_allows_posting(self):
        period = self.entry.period or EntityService.period_for_date(
            self.entry.entity, self.entry.date,
        )
        if period and period.status == c.PERIOD_CLOSED:
            self.errors.append(PeriodClosed(
                f"Period {period.name} is closed",
                code=c.ERR_PERIOD_CLOSED,
                details={"period": period.name},
            ))

    def run_all(self):
        self.errors = []
        self.min_lines()
        self.accounts_active()
        self.accounts_belong_to_entity()
        self.balance()
        self.period_allows_posting()
        return self.errors


# ── State machine guard ───────────────────────────────────────────────────

def _require_transition(from_status, to_status):
    if to_status not in c.JE_TRANSITIONS.get(from_status, set()):
        raise InvalidTransition(
            f"Cannot transition from '{from_status}' to '{to_status}'",
            code=c.ERR_INVALID_TRANSITION,
            details={"from": from_status, "to": to_status},
        )


def _log(entry: JournalEntry, action: str, from_status: str, to_status: str,
         actor=None, note: str = ""):
    ApprovalAction.objects.create(
        journal_entry=entry, action=action,
        from_status=from_status, to_status=to_status,
        actor=actor, note=note,
    )


# ── The public service ────────────────────────────────────────────────────

class JournalService:

    # ── Creation / line building ─────────────────────────────────────────
    @staticmethod
    @transaction.atomic
    def create_draft(
        *, organization, entity, date, lines,
        user=None, memo="", reference="",
        source_type=c.SOURCE_MANUAL, source_id=None, source_ref="",
        currency=None, intercompany_group=None, counterparty_entity=None,
    ):
        """Create a new draft JE with its lines.

        ``lines`` is a list of dicts:
            {"account_id", "debit", "credit", "currency"?, "exchange_rate"?,
             "description"?, "counterparty_entity_id"?}

        If ``currency`` / ``exchange_rate`` are omitted per-line, we fall
        back to the JE-level currency and resolve the rate via FXService.
        """
        currency = currency or entity.functional_currency
        entry = JournalEntry.objects.create(
            organization=organization,
            entity=entity,
            entry_number=EntityService.next_entry_number(entity),
            date=date,
            memo=memo,
            reference=reference,
            status=c.JE_DRAFT,
            source_type=source_type,
            source_id=source_id,
            source_ref=source_ref,
            currency=currency,
            period=EntityService.period_for_date(entity, date),
            intercompany_group=intercompany_group,
            counterparty_entity=counterparty_entity,
            created_by=user,
        )

        for i, line in enumerate(lines):
            _create_line(entry, line, default_currency=currency, idx=i)

        _recalc_totals(entry)
        _log(entry, c.APPROVAL_SUBMITTED, "", c.JE_DRAFT, actor=user,
             note="Draft created")
        return entry

    @staticmethod
    @transaction.atomic
    def replace_lines(entry: JournalEntry, lines, user=None):
        """Replace all lines on a draft/rejected JE. Disallowed once
        the entry has moved beyond editable states."""
        if entry.status not in c.JE_EDITABLE:
            raise PostedImmutable(
                f"Cannot edit lines on a {entry.status} entry",
                code=c.ERR_POSTED_IMMUTABLE,
            )
        entry.lines.all().delete()
        for i, line in enumerate(lines):
            _create_line(entry, line, default_currency=entry.currency, idx=i)
        _recalc_totals(entry)
        return entry

    # ── Approval flow ─────────────────────────────────────────────────────
    @staticmethod
    @transaction.atomic
    def submit_for_approval(entry: JournalEntry, user=None, note=""):
        _require_transition(entry.status, c.JE_PENDING_APPROVAL)
        # Run validation so the submitter gets errors immediately.
        errors = _Validator(entry).run_all()
        if errors:
            raise errors[0]
        prev, entry.status = entry.status, c.JE_PENDING_APPROVAL
        entry.submitted_for_approval_by = user
        entry.submitted_for_approval_at = timezone.now()
        entry.save(update_fields=[
            "status", "submitted_for_approval_by",
            "submitted_for_approval_at", "updated_at",
        ])
        _log(entry, c.APPROVAL_SUBMITTED, prev, c.JE_PENDING_APPROVAL, actor=user, note=note)
        return entry

    @staticmethod
    @transaction.atomic
    def approve(entry: JournalEntry, user=None, note=""):
        _require_transition(entry.status, c.JE_APPROVED)
        # Blueprint: "AI may draft … humans control". Block self-approval
        # when submitter or creator is the same user.
        if user and entry.submitted_for_approval_by_id == user.id:
            raise SelfApproval(
                "The submitter cannot approve their own entry",
                code=c.ERR_SELF_APPROVAL,
            )
        if user and entry.created_by_id == user.id and not entry.submitted_for_approval_by_id:
            raise SelfApproval(
                "The creator cannot approve their own entry",
                code=c.ERR_SELF_APPROVAL,
            )
        # Re-validate in case something changed between submit and approve.
        errors = _Validator(entry).run_all()
        if errors:
            raise errors[0]
        prev, entry.status = entry.status, c.JE_APPROVED
        entry.approved_by = user
        entry.approved_at = timezone.now()
        entry.save(update_fields=[
            "status", "approved_by", "approved_at", "updated_at",
        ])
        _log(entry, c.APPROVAL_APPROVED, prev, c.JE_APPROVED, actor=user, note=note)
        return entry

    @staticmethod
    @transaction.atomic
    def reject(entry: JournalEntry, user=None, reason=""):
        _require_transition(entry.status, c.JE_REJECTED)
        prev, entry.status = entry.status, c.JE_REJECTED
        entry.rejected_by = user
        entry.rejected_at = timezone.now()
        entry.rejection_reason = reason
        entry.save(update_fields=[
            "status", "rejected_by", "rejected_at", "rejection_reason", "updated_at",
        ])
        _log(entry, c.APPROVAL_REJECTED, prev, c.JE_REJECTED, actor=user, note=reason)
        return entry

    @staticmethod
    @transaction.atomic
    def return_to_draft(entry: JournalEntry, user=None, note=""):
        """Pull an entry back from pending_approval/approved/rejected into
        draft so the creator can edit it again."""
        _require_transition(entry.status, c.JE_DRAFT)
        prev, entry.status = entry.status, c.JE_DRAFT
        entry.save(update_fields=["status", "updated_at"])
        _log(entry, c.APPROVAL_RETURNED_TO_DRAFT, prev, c.JE_DRAFT, actor=user, note=note)
        return entry

    @staticmethod
    @transaction.atomic
    def post(entry: JournalEntry, user=None, note=""):
        """Final step — flip to posted and impact the ledger. Only
        approved entries can be posted.

        If the entry belongs to an ``IntercompanyGroup``, the whole group
        must net to zero in a common reporting currency before the leg
        can be posted (see ``assert_intercompany_balanced``).
        """
        _require_transition(entry.status, c.JE_POSTED)
        errors = _Validator(entry).run_all()
        if errors:
            raise errors[0]
        if entry.intercompany_group_id:
            JournalService.assert_intercompany_balanced(entry.intercompany_group)
        prev, entry.status = entry.status, c.JE_POSTED
        entry.posted_by = user
        entry.posted_at = timezone.now()
        # Attach period if not yet attached.
        if not entry.period_id:
            entry.period = EntityService.period_for_date(entry.entity, entry.date)
        entry.save(update_fields=["status", "posted_by", "posted_at", "period", "updated_at"])
        _log(entry, c.APPROVAL_POSTED, prev, c.JE_POSTED, actor=user, note=note)
        return entry

    # ── Intercompany balance check ────────────────────────────────────────
    @staticmethod
    def assert_intercompany_balanced(
        group: IntercompanyGroup,
        *,
        reporting_currency: str = None,
        tolerance: Decimal = INTERCOMPANY_TOLERANCE,
    ):
        """Verify that intercompany lines across all JEs in ``group`` net
        to zero in a common reporting currency.

        **Definition of "intercompany line"** (union of two signals):
          1. The line's account has subtype ``intercompany_receivable`` or
             ``intercompany_payable`` (COA-driven discipline), OR
          2. The line has a ``counterparty_entity`` set (explicit tag).

        **Translation**: each line's ``functional_debit/credit`` (already in
        the entity's functional currency) is converted to ``reporting_currency``
        using the FX rate at the JE date. The signed net (DR − CR) of all
        intercompany lines across the group must be within ``tolerance``.

        **Status scope**: includes every JE in the group EXCEPT those in
        ``rejected`` status. Drafts are included so that an accountant must
        have the *entire* intercompany transaction drafted before any leg
        can be posted; this prevents one-sided postings.

        **Reporting currency default**: the first non-rejected entry's
        entity's ``reporting_currency`` (or its ``functional_currency``).
        """
        entries = list(
            JournalEntry.objects
            .filter(intercompany_group=group)
            .exclude(status=c.JE_REJECTED)
            .select_related("entity")
        )
        if not entries:
            return  # nothing to check — empty or fully-rejected group

        if reporting_currency is None:
            first = entries[0].entity
            reporting_currency = first.reporting_currency or first.functional_currency

        total = ZERO
        per_entity = {}  # for error details — net per entity
        for entry in entries:
            entity_fc = entry.entity.functional_currency
            ic_lines = entry.lines.filter(
                db_models.Q(account__account_subtype__in=INTERCOMPANY_SUBTYPES)
                | db_models.Q(counterparty_entity__isnull=False)
            ).select_related("account")

            entity_net = ZERO
            for ln in ic_lines:
                net_func = (ln.functional_debit or ZERO) - (ln.functional_credit or ZERO)
                if entity_fc == reporting_currency:
                    net_rc = net_func
                else:
                    rate = FXService.rate(
                        from_currency=entity_fc,
                        to_currency=reporting_currency,
                        as_of=entry.date,
                    )
                    net_rc = (net_func * rate).quantize(Decimal("0.0001"))
                entity_net += net_rc
            per_entity[entry.entity.code] = str(entity_net.quantize(Decimal("0.01")))
            total += entity_net

        if abs(total) > tolerance:
            raise IntercompanyUnbalanced(
                f"Intercompany group {group.id} does not net to zero "
                f"in {reporting_currency} (net={total.quantize(Decimal('0.01'))})",
                code=c.ERR_INTERCOMPANY_UNBALANCED,
                details={
                    "group_id": group.id,
                    "reporting_currency": reporting_currency,
                    "net": str(total.quantize(Decimal("0.01"))),
                    "tolerance": str(tolerance),
                    "per_entity": per_entity,
                },
            )

    @staticmethod
    @transaction.atomic
    def reverse(entry: JournalEntry, reversal_date, user=None, memo=""):
        """Create a mirror JE that zeroes out the original and post it.
        The original is flipped to ``reversed`` state."""
        _require_transition(entry.status, c.JE_REVERSED)

        # Build mirrored lines (swap DR and CR).
        mirror_lines = []
        for line in entry.lines.all().select_related("account"):
            mirror_lines.append({
                "account_id": line.account_id,
                "description": f"Reversal: {line.description}",
                "debit": line.credit,
                "credit": line.debit,
                "currency": line.currency,
                "exchange_rate": line.exchange_rate,
                "counterparty_entity_id": line.counterparty_entity_id,
                "dimension_bank_code": line.dimension_bank_code,
                "dimension_custodian_code": line.dimension_custodian_code,
                "dimension_portfolio_code": line.dimension_portfolio_code,
                "dimension_instrument_code": line.dimension_instrument_code,
                "dimension_strategy_code": line.dimension_strategy_code,
                "dimension_asset_class_code": line.dimension_asset_class_code,
                "dimension_maturity_code": line.dimension_maturity_code,
            })

        reversal = JournalService.create_draft(
            organization=entry.organization,
            entity=entry.entity,
            date=reversal_date,
            lines=mirror_lines,
            user=user,
            memo=memo or f"Reversal of {entry.entry_number}",
            reference=entry.reference,
            source_type=c.SOURCE_REVERSAL,
            source_id=entry.id,
            source_ref=entry.entry_number,
            currency=entry.currency,
            intercompany_group=entry.intercompany_group,
            counterparty_entity=entry.counterparty_entity,
        )
        reversal.reversal_of = entry
        reversal.save(update_fields=["reversal_of"])

        # Fast-track the reversal through approval (system posts it).
        JournalService.submit_for_approval(reversal, user=user, note="Auto-submit reversal")
        reversal.submitted_for_approval_by = user
        JournalService.approve(reversal, user=None, note="System reversal — auto-approved")
        JournalService.post(reversal, user=user, note="Auto-posted reversal")

        prev, entry.status = entry.status, c.JE_REVERSED
        entry.save(update_fields=["status", "updated_at"])
        _log(entry, c.APPROVAL_REVERSED, prev, c.JE_REVERSED, actor=user,
             note=f"Reversed by {reversal.entry_number}")
        return reversal


# ── Internals ──────────────────────────────────────────────────────────────

def _create_line(entry, line_data, default_currency, idx):
    """Create a JournalLine from a dict spec.

    Fills in FX rate + functional amounts if the caller omitted them."""
    debit = Decimal(str(line_data.get("debit", "0") or 0))
    credit = Decimal(str(line_data.get("credit", "0") or 0))
    line_currency = line_data.get("currency") or default_currency
    rate = line_data.get("exchange_rate")
    if rate is None:
        rate = FXService.rate(
            from_currency=line_currency,
            to_currency=entry.entity.functional_currency,
            as_of=entry.date,
        )
    else:
        rate = Decimal(str(rate))

    functional_debit = (debit * rate).quantize(Decimal("0.0001"))
    functional_credit = (credit * rate).quantize(Decimal("0.0001"))

    return JournalLine.objects.create(
        journal_entry=entry,
        account_id=line_data["account_id"],
        description=line_data.get("description", ""),
        debit=debit,
        credit=credit,
        currency=line_currency,
        exchange_rate=rate,
        functional_debit=functional_debit,
        functional_credit=functional_credit,
        counterparty_entity_id=line_data.get("counterparty_entity_id"),
        dimension_bank_code=(line_data.get("dimension_bank_code") or "").strip(),
        dimension_custodian_code=(line_data.get("dimension_custodian_code") or "").strip(),
        dimension_portfolio_code=(line_data.get("dimension_portfolio_code") or "").strip(),
        dimension_instrument_code=(line_data.get("dimension_instrument_code") or "").strip(),
        dimension_strategy_code=(line_data.get("dimension_strategy_code") or "").strip(),
        dimension_asset_class_code=(line_data.get("dimension_asset_class_code") or "").strip(),
        dimension_maturity_code=(line_data.get("dimension_maturity_code") or "").strip(),
        line_order=line_data.get("line_order", idx),
    )


def _recalc_totals(entry):
    """Refresh the cached totals on the JE row."""
    agg = entry.lines.aggregate(
        dr=db_models.Sum("functional_debit", default=ZERO),
        cr=db_models.Sum("functional_credit", default=ZERO),
    )
    entry.total_debit_functional = agg["dr"] or ZERO
    entry.total_credit_functional = agg["cr"] or ZERO
    entry.save(update_fields=[
        "total_debit_functional", "total_credit_functional", "updated_at",
    ])
