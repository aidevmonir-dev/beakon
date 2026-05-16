"""DimensionRuleService — evaluate workbook dimension validation rules
against journal lines.

This is the **engine validates** leg of Thomas's three-way separation
(*"AI assists. Humans approve. Accounting engine validates."*). The 311
``DimensionValidationRule`` rows imported from workbook tab 09 sit in the
database; this service reads them at posting time and refuses to post a
journal entry whose lines don't carry the dimensions their accounts require.

Workflow:

  1. For each ``JournalLine`` in a ``JournalEntry``, look up active rules
     for its ``account.code`` whose ``trigger_event`` matches the current
     posting context (``ALL`` matches every event by default).
  2. For each rule, parse ``required_dimension_type_codes`` (a
     semicolon/space/comma-separated list of dimension codes like
     ``INST;CUST;PORT;CCY``).
  3. Check that the line carries each required dimension — either through
     a non-null ``ForeignKey`` (e.g. ``dimension_instrument``) or a
     non-blank code field (e.g. ``dimension_strategy_code``). ``CCY`` is
     mapped to ``line.currency``.
  4. Surface missing-dimension violations as ``ValidationError``\\s.

Workbook data hygiene: some imported rules have shifted columns
(``severity`` containing strings like ``STR``, ``master_driver`` containing
dimension codes). The service defends by treating only ``required_dimension_type_codes``
as authoritative and ignoring noise in advisory columns. Rules with empty
``required_dimension_type_codes`` are skipped (nothing to enforce).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from beakon_core import constants as c
from beakon_core.exceptions import ValidationError
from beakon_core.models import DimensionValidationRule, JournalEntry, JournalLine


# Map workbook dimension codes -> JournalLine attributes.
# Each entry is (FK attr, code attr) where either being non-empty satisfies
# the requirement. ``None`` for the FK side means "code-only dimension".
DIMENSION_FIELD_MAP: dict[str, tuple[str | None, str | None]] = {
    # Tier-1 (existing — code-only on JournalLine)
    "BANK": (None, "dimension_bank_code"),
    "CUST": (None, "dimension_custodian_code"),
    "PORT": (None, "dimension_portfolio_code"),
    "INST": (None, "dimension_instrument_code"),
    "STR":  (None, "dimension_strategy_code"),
    "ACL":  (None, "dimension_asset_class_code"),
    "MAT":  (None, "dimension_maturity_code"),
    # Tier-2 (FK-backed — added during the FK promotion pass)
    "TLOT": ("dimension_tax_lot_id", None),
    "LOAN": ("dimension_loan_id", None),
    "RP":   ("dimension_related_party_id", None),
    "CP":   ("dimension_counterparty_id", None),
    "PROP": ("dimension_property_id", None),
    "POL":  ("dimension_policy_id", None),
    "PEN":  ("dimension_pension_id", None),
    "FAM":  ("dimension_family_member_id", None),
    # Tier-2 (code-only — controlled-list values)
    "TRF":  (None, "dimension_transfer_type_code"),
    "JUR":  (None, "dimension_jurisdiction_code"),
    # COM is FK-promoted to the Commitment master; the legacy code field is
    # still accepted for backward compat (either satisfies the requirement).
    "COM":  ("dimension_commitment_id", "dimension_commitment_code"),
    "WAL":  (None, "dimension_wallet_code"),
    "RCAT": (None, "dimension_report_category_code"),
    "RST":  (None, "dimension_restriction_type_code"),
    # Currency: special-case to line.currency
    "CCY":  (None, "currency"),
}


@dataclass
class RuleViolation:
    """One dimension-rule failure on a journal line."""
    rule_id: str
    line_order: int
    account_code: str
    account_name: str
    missing_dimension: str
    rule_type: str
    trigger_event: str

    def as_error(self) -> ValidationError:
        return ValidationError(
            f"Account {self.account_code} requires dimension {self.missing_dimension} "
            f"(rule {self.rule_id})",
            code=c.ERR_DIMENSION_REQUIRED,
            details={
                "rule_id": self.rule_id,
                "line_order": self.line_order,
                "account": self.account_code,
                "account_name": self.account_name,
                "missing_dimension": self.missing_dimension,
                "rule_type": self.rule_type,
                "trigger_event": self.trigger_event,
            },
        )


class DimensionRuleService:
    """Public entry points for dimension-rule enforcement."""

    @classmethod
    def violations_for_entry(
        cls, entry: JournalEntry, *, trigger_event: str = "ALL",
    ) -> list[RuleViolation]:
        """Return all dimension-rule violations across an entry's lines.

        Two enforcement sources are checked, in order:
          1. ``Account.required_dimension_type_codes`` — the always-on
             baseline declared on the account itself (e.g. account
             ``130100`` always requires ``INST;CUST;PORT;CCY``).
          2. ``DimensionValidationRule`` rows whose ``trigger_event``
             matches the current event (defaults to ``ALL`` rules only).

        Posting accounts (``posting_allowed=True``) are evaluated; header
        and non-posting rows are skipped.

        Gating: ``CoADefinition.dimensions_enabled`` controls whether the
        dimension layer is active for a given chart. Lines whose account
        belongs to a CoA with ``dimensions_enabled=False`` are skipped
        entirely (no account-baseline check, no workbook-rule check).
        Accounts with no ``coa_definition`` default to enforced so existing
        rows imported before the gate was wired keep their previous
        always-on behaviour.
        """
        violations: list[RuleViolation] = []

        # One query for all event-driven rules touching any account in this entry.
        account_codes = list(
            entry.lines.values_list("account__code", flat=True).distinct()
        )
        if not account_codes:
            return violations

        rules_by_account: dict[str, list[DimensionValidationRule]] = {}
        for rule in DimensionValidationRule.objects.filter(
            organization=entry.organization,
            account_no__in=account_codes,
            active_flag=True,
        ):
            rules_by_account.setdefault(rule.account_no, []).append(rule)

        for line in entry.lines.select_related("account", "account__coa_definition").all():
            account = line.account
            if not account.posting_allowed:
                continue

            # CoA gate: dimensions_enabled=False on the account's CoA disables
            # all dimension enforcement for this line. Missing CoA → enforce.
            coa = account.coa_definition
            if coa is not None and not coa.dimensions_enabled:
                continue

            # ── Source 1: Account-level baseline ──
            for code in _parse_codes(account.required_dimension_type_codes):
                if cls._line_has_dimension(line, code):
                    continue
                violations.append(RuleViolation(
                    rule_id=f"ACCT_{account.code}",
                    line_order=line.line_order,
                    account_code=account.code,
                    account_name=account.name,
                    missing_dimension=code,
                    rule_type="ACCOUNT_REQUIRED",
                    trigger_event="ALL",
                ))

            # ── Source 2: DimensionValidationRule (event-driven) ──
            for rule in rules_by_account.get(account.code, []):
                if not _trigger_matches(rule.trigger_event, trigger_event):
                    continue
                for code in _parse_codes(rule.required_dimension_type_codes):
                    if cls._line_has_dimension(line, code):
                        continue
                    violations.append(RuleViolation(
                        rule_id=rule.rule_id,
                        line_order=line.line_order,
                        account_code=account.code,
                        account_name=account.name,
                        missing_dimension=code,
                        rule_type=rule.rule_type or "",
                        trigger_event=rule.trigger_event or "",
                    ))
        return violations

    @staticmethod
    def _line_has_dimension(line: JournalLine, code: str) -> bool:
        """Return True if the journal line carries the dimension named by `code`.

        Accepts both FK-backed dimensions (non-null ``<field>_id``) and
        code-string dimensions (non-blank string). Unknown codes are
        treated as satisfied so unfamiliar workbook entries don't block
        posting — operators see the rule and decide.
        """
        mapping = DIMENSION_FIELD_MAP.get(code)
        if mapping is None:
            return True  # unknown dimension code → don't block
        fk_attr, code_attr = mapping
        if fk_attr and getattr(line, fk_attr, None):
            return True
        if code_attr and (getattr(line, code_attr, "") or "").strip():
            return True
        return False


def _parse_codes(raw: str) -> Iterable[str]:
    """Split workbook dimension-code lists. Tolerates `;`, `,`, whitespace."""
    if not raw:
        return ()
    cleaned = raw.replace(",", ";").replace(" ", ";")
    return [code.strip().upper() for code in cleaned.split(";") if code.strip()]


def _trigger_matches(rule_trigger: str, current_event: str) -> bool:
    """Check whether a rule's `trigger_event` applies to the current event.

    Workbook conventions seen so far:
      - ``ALL`` — applies to every posting (most rules).
      - ``BUY|SELL|REVALUE`` — pipe-separated event list.
      - empty / blank — treated as ``ALL``.
    """
    raw = (rule_trigger or "").strip().upper()
    if not raw or raw == "ALL":
        return True
    events = {tok.strip() for tok in raw.replace(",", "|").split("|") if tok.strip()}
    return current_event.upper() in events or "ALL" in events
