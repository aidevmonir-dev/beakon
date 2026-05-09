"""Smoke test for the Beakon accounting kernel (blueprint Objectives 1–2).

Exercises:
  1. Entity + currencies + FX rates + accounts + period.
  2. Create draft JE in EUR for a USD-functional entity — FX resolves.
  3. State machine:  draft ->pending_approval ->approved ->posted.
  4. Self-approval guard (same user cannot submit + approve).
  5. Rejection path:  pending_approval ->rejected ->draft (reopened).
  6. Balance guard — unbalanced entry refuses to submit.
  7. Period lock — closed period refuses posting.
  8. Reversal — posted JE can be reversed.
  9. Drill-down data: approval history readable.

Run from the project root (after migrations):
  venv\\Scripts\\python.exe beakon_core\\smoketest.py

Rolls back at the end.
"""
import os
import sys
from datetime import date, timedelta
from decimal import Decimal

import django

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "digits_clone.settings")
django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.db import transaction  # noqa: E402
from django.db.models import Q, Sum  # noqa: E402
from dateutil.relativedelta import relativedelta  # noqa: E402

from beakon_core import constants as bc  # noqa: E402
from beakon_core.exceptions import (  # noqa: E402
    IntercompanyUnbalanced,
    InvalidTransition,
    PeriodClosed,
    SelfApproval,
    ValidationError,
)
from beakon_core.models import (  # noqa: E402
    Account,
    ApprovalAction,
    Bill,
    Commitment,
    Currency,
    Customer,
    Entity,
    FXRate,
    IntercompanyGroup,
    Invoice,
    JournalEntry,
    JournalLine,
    Loan,
    Period,
    Policy,
    Property,
    Vendor,
)
from beakon_core.services import (  # noqa: E402
    BankChargeService,
    BankInterestService,
    BankTransferService,
    BillService,
    ClosingEntriesService,
    CommitmentService,
    CustomerCreditNoteService,
    DisbursementService,
    FXRevaluationService,
    InsuranceService,
    InvoiceService,
    JournalService,
    LoanService,
    OwnerContributionService,
    PostingRuleService,
    PropertyService,
    RecognitionService,
    ReportsService,
    SourceDocumentService,
    VATRemittanceService,
    VATReportService,
    VendorCreditNoteService,
)
from organizations.models import Organization  # noqa: E402


TODAY = date(2026, 4, 17)
User = get_user_model()


def setup_world(org):
    """Seed a USD entity + a GBP entity + accounts + FX + period."""
    # Currencies
    for code, name, sym in [("USD", "US Dollar", "$"), ("EUR", "Euro", "€"), ("GBP", "Pound Sterling", "£")]:
        Currency.objects.update_or_create(
            code=code, defaults={"name": name, "symbol": sym},
        )

    # Two entities
    holdco, _ = Entity.objects.update_or_create(
        organization=org, code="HOLDCO",
        defaults={
            "name": "Beakon HoldCo",
            "entity_type": bc.ENTITY_COMPANY,
            "functional_currency": "USD",
            "country": "US",
        },
    )
    opco, _ = Entity.objects.update_or_create(
        organization=org, code="OPCO-UK",
        defaults={
            "name": "Beakon OpCo UK",
            "entity_type": bc.ENTITY_COMPANY,
            "functional_currency": "GBP",
            "country": "GB",
            "parent": holdco,
        },
    )

    # FX — cover EUR→USD and GBP→USD for April 2026
    FXRate.objects.update_or_create(
        from_currency="EUR", to_currency="USD", as_of=date(2026, 4, 1),
        defaults={"rate": Decimal("1.1000"), "source": "smoketest"},
    )
    FXRate.objects.update_or_create(
        from_currency="GBP", to_currency="USD", as_of=date(2026, 4, 1),
        defaults={"rate": Decimal("1.2500"), "source": "smoketest"},
    )
    # Closing rate for end-of-month FX revaluation (scenario 12)
    FXRate.objects.update_or_create(
        from_currency="EUR", to_currency="USD", as_of=date(2026, 4, 30),
        defaults={"rate": Decimal("1.1500"), "source": "smoketest"},
    )

    # COA — accounts scoped to holdco
    accounts = {}
    for code, name, atype, subtype in [
        ("1010", "Cash — HoldCo Bank", bc.ACCOUNT_TYPE_ASSET, "bank"),
        ("1011", "Cash — HoldCo EUR Bank", bc.ACCOUNT_TYPE_ASSET, "bank"),
        ("4000", "Revenue", bc.ACCOUNT_TYPE_REVENUE, "operating_revenue"),
        ("6000", "Operating Expenses", bc.ACCOUNT_TYPE_EXPENSE, "operating_expense"),
        ("1500", "Due From OpCo-UK", bc.ACCOUNT_TYPE_ASSET, "intercompany_receivable"),
        ("7100", "FX Gain", bc.ACCOUNT_TYPE_REVENUE, "fx_gain"),
        ("8100", "FX Loss", bc.ACCOUNT_TYPE_EXPENSE, "fx_loss"),
        ("2010", "Accounts Payable", bc.ACCOUNT_TYPE_LIABILITY, "accounts_payable"),
        ("1200", "Accounts Receivable", bc.ACCOUNT_TYPE_ASSET, "accounts_receivable"),
    ]:
        obj, _ = Account.objects.update_or_create(
            organization=org, entity=holdco, code=code,
            defaults={
                "name": name, "account_type": atype, "account_subtype": subtype,
            },
        )
        accounts[code] = obj

    # COA — accounts scoped to opco (for the intercompany scenario)
    opco_accounts = {}
    for code, name, atype, subtype in [
        ("1010", "Cash — OpCo Bank", bc.ACCOUNT_TYPE_ASSET, "bank"),
        ("2500", "Due To HoldCo", bc.ACCOUNT_TYPE_LIABILITY, "intercompany_payable"),
    ]:
        obj, _ = Account.objects.update_or_create(
            organization=org, entity=opco, code=code,
            defaults={
                "name": name, "account_type": atype, "account_subtype": subtype,
            },
        )
        opco_accounts[code] = obj

    # Periods — April 2026, open, one per entity
    period, _ = Period.objects.update_or_create(
        entity=holdco,
        start_date=date(2026, 4, 1), end_date=date(2026, 4, 30),
        defaults={
            "name": "April 2026", "period_type": bc.PERIOD_MONTH,
            "status": bc.PERIOD_OPEN,
        },
    )
    opco_period, _ = Period.objects.update_or_create(
        entity=opco,
        start_date=date(2026, 4, 1), end_date=date(2026, 4, 30),
        defaults={
            "name": "April 2026", "period_type": bc.PERIOD_MONTH,
            "status": bc.PERIOD_OPEN,
        },
    )

    return {
        "holdco": holdco, "opco": opco,
        "period": period, "opco_period": opco_period,
        "accounts": accounts, "opco_accounts": opco_accounts,
    }


def main():
    org = Organization.objects.first()
    if not org:
        print("FAIL: no Organization — create one via admin first")
        sys.exit(1)

    # Make sure we have two users for the self-approval test.
    alice, _ = User.objects.get_or_create(
        email="alice@beakon-smoketest.local",
        defaults={"first_name": "Alice", "last_name": "Tester"},
    )
    bob, _ = User.objects.get_or_create(
        email="bob@beakon-smoketest.local",
        defaults={"first_name": "Bob", "last_name": "Approver"},
    )

    with transaction.atomic():
        sid = transaction.savepoint()
        world = setup_world(org)
        holdco = world["holdco"]
        period = world["period"]
        A = world["accounts"]

        # ── 1. Create a draft JE in EUR (entity functional = USD) ────
        print("-- scenario 1: create draft with FX")
        entry = JournalService.create_draft(
            organization=org, entity=holdco,
            date=date(2026, 4, 10),
            memo="Consulting fee from EU client",
            lines=[
                {"account_id": A["1010"].id, "debit": Decimal("1000"),
                 "credit": Decimal("0"), "currency": "EUR"},
                {"account_id": A["4000"].id, "debit": Decimal("0"),
                 "credit": Decimal("1000"), "currency": "EUR"},
            ],
            user=alice, currency="EUR",
        )
        entry.refresh_from_db()
        print(f"  {entry.entry_number} status={entry.status}")
        print(f"  total DR={entry.total_debit_functional} CR={entry.total_credit_functional}")
        # 1000 EUR × 1.10 = 1100 USD functional
        assert entry.total_debit_functional == Decimal("1100.0000"), entry.total_debit_functional
        assert entry.total_credit_functional == Decimal("1100.0000")
        assert entry.status == bc.JE_DRAFT
        print("  OK FX converted at 1.10; JE balanced in functional currency")

        # ── 2. Full happy path ──────────────────────────────────────
        print("-- scenario 2: submit ->approve ->post (different users)")
        JournalService.submit_for_approval(entry, user=alice)
        entry.refresh_from_db()
        assert entry.status == bc.JE_PENDING_APPROVAL
        JournalService.approve(entry, user=bob)
        entry.refresh_from_db()
        assert entry.status == bc.JE_APPROVED
        JournalService.post(entry, user=bob)
        entry.refresh_from_db()
        assert entry.status == bc.JE_POSTED
        assert entry.posted_at is not None
        assert entry.period_id == period.id
        print(f"  posted. period={entry.period.name}")

        # ── 3. Self-approval guard ──────────────────────────────────
        print("-- scenario 3: self-approval blocked")
        je2 = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 11),
            memo="Self-approval test",
            lines=[
                {"account_id": A["6000"].id, "debit": Decimal("50")},
                {"account_id": A["1010"].id, "credit": Decimal("50")},
            ],
            user=alice,
        )
        JournalService.submit_for_approval(je2, user=alice)
        try:
            JournalService.approve(je2, user=alice)  # same user
            print("  FAIL: self-approval allowed")
            sys.exit(1)
        except SelfApproval as e:
            print(f"  OK blocked: {e.message}")
        # Approve with bob to continue
        JournalService.approve(je2, user=bob)
        JournalService.post(je2, user=bob)

        # ── 4. Rejection ->back to draft ->resubmit ─────────────────
        print("-- scenario 4: reject ->return to draft ->resubmit")
        je3 = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 12),
            memo="Rejection test",
            lines=[
                {"account_id": A["6000"].id, "debit": Decimal("25")},
                {"account_id": A["1010"].id, "credit": Decimal("25")},
            ],
            user=alice,
        )
        JournalService.submit_for_approval(je3, user=alice)
        JournalService.reject(je3, user=bob, reason="Missing receipt")
        je3.refresh_from_db()
        assert je3.status == bc.JE_REJECTED
        assert je3.rejection_reason == "Missing receipt"
        JournalService.return_to_draft(je3, user=alice)
        je3.refresh_from_db()
        assert je3.status == bc.JE_DRAFT
        JournalService.submit_for_approval(je3, user=alice)
        JournalService.approve(je3, user=bob)
        JournalService.post(je3, user=bob)
        print("  OK reject ->draft ->resubmit ->post")

        # ── 5. Invalid transition guard ─────────────────────────────
        print("-- scenario 5: invalid transition (draft ->approved) blocked")
        je4 = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 12),
            memo="Invalid transition test",
            lines=[
                {"account_id": A["6000"].id, "debit": Decimal("10")},
                {"account_id": A["1010"].id, "credit": Decimal("10")},
            ],
            user=alice,
        )
        try:
            JournalService.approve(je4, user=bob)  # not pending
            print("  FAIL: draft ->approved allowed")
            sys.exit(1)
        except InvalidTransition as e:
            print(f"  OK blocked: {e.message}")

        # ── 6. Balance guard ────────────────────────────────────────
        print("-- scenario 6: unbalanced submit blocked")
        je5 = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 13),
            memo="Unbalanced",
            lines=[
                {"account_id": A["6000"].id, "debit": Decimal("100")},
                {"account_id": A["1010"].id, "credit": Decimal("90")},  # off by 10
            ],
            user=alice,
        )
        try:
            JournalService.submit_for_approval(je5, user=alice)
            print("  FAIL: unbalanced entry submitted")
            sys.exit(1)
        except ValidationError as e:
            print(f"  OK blocked: {e.message} ({e.details.get('diff')})")

        # ── 7. Period lock ─────────────────────────────────────────
        print("-- scenario 7: closed period refuses posting")
        period.status = bc.PERIOD_CLOSED
        period.save(update_fields=["status"])
        je6 = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 14),
            memo="Should be blocked by closed period",
            lines=[
                {"account_id": A["6000"].id, "debit": Decimal("15")},
                {"account_id": A["1010"].id, "credit": Decimal("15")},
            ],
            user=alice,
        )
        try:
            JournalService.submit_for_approval(je6, user=alice)
            print("  FAIL: submit allowed in closed period")
            sys.exit(1)
        except PeriodClosed as e:
            print(f"  OK blocked: {e.message}")
        # Reopen for the reversal test below.
        period.status = bc.PERIOD_OPEN
        period.save(update_fields=["status"])

        # ── 8. Reversal ─────────────────────────────────────────────
        print("-- scenario 8: reverse a posted JE")
        reversal = JournalService.reverse(
            entry, reversal_date=date(2026, 4, 15), user=bob,
            memo="Correcting entry",
        )
        entry.refresh_from_db()
        assert entry.status == bc.JE_REVERSED
        assert reversal.status == bc.JE_POSTED
        assert reversal.reversal_of_id == entry.id
        print(f"  original={entry.status}, reversal={reversal.entry_number} status={reversal.status}")

        # ── 9. Audit trail is complete ──────────────────────────────
        print("-- scenario 9: audit trail")
        actions = list(
            ApprovalAction.objects.filter(journal_entry=entry).order_by("at")
            .values_list("action", "from_status", "to_status")
        )
        print(f"  actions on {entry.entry_number}: {actions}")
        assert any(a[2] == bc.JE_POSTED for a in actions)
        assert any(a[2] == bc.JE_REVERSED for a in actions)

        # ── 10. Intercompany — balanced group posts cleanly ─────────
        # HoldCo lends OpCo cash. HoldCo books in USD, OpCo in GBP.
        #   HoldCo: DR Due From OpCo $100 / CR Cash $100
        #   OpCo:   DR Cash £80          / CR Due To HoldCo £80
        # GBP→USD = 1.25, so £80 = $100 → group nets to zero in USD.
        print("-- scenario 10: intercompany balanced group posts")
        opco = world["opco"]
        OA = world["opco_accounts"]
        ic_group = IntercompanyGroup.objects.create(
            organization=org, reference="LOAN-2026-04",
            description="HoldCo→OpCo working capital advance",
            created_by=alice,
        )
        je_hold = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 16),
            memo="Advance to OpCo-UK",
            lines=[
                {"account_id": A["1500"].id, "debit": Decimal("100"),
                 "currency": "USD", "counterparty_entity_id": opco.id},
                {"account_id": A["1010"].id, "credit": Decimal("100"),
                 "currency": "USD"},
            ],
            user=alice, currency="USD",
            intercompany_group=ic_group, counterparty_entity=opco,
        )
        je_op = JournalService.create_draft(
            organization=org, entity=opco, date=date(2026, 4, 16),
            memo="Advance from HoldCo",
            lines=[
                {"account_id": OA["1010"].id, "debit": Decimal("80"),
                 "currency": "GBP"},
                {"account_id": OA["2500"].id, "credit": Decimal("80"),
                 "currency": "GBP", "counterparty_entity_id": holdco.id},
            ],
            user=alice, currency="GBP",
            intercompany_group=ic_group, counterparty_entity=holdco,
        )
        # Both legs through approval
        JournalService.submit_for_approval(je_hold, user=alice)
        JournalService.submit_for_approval(je_op, user=alice)
        JournalService.approve(je_hold, user=bob)
        JournalService.approve(je_op, user=bob)
        # Post first leg — IC validator runs across BOTH legs (incl. drafts/approved)
        JournalService.post(je_hold, user=bob)
        JournalService.post(je_op, user=bob)
        je_hold.refresh_from_db(); je_op.refresh_from_db()
        assert je_hold.status == bc.JE_POSTED
        assert je_op.status == bc.JE_POSTED
        print(f"  OK both legs posted; group {ic_group.id} nets to $0")

        # ── 11. Intercompany — unbalanced group blocks at post ──────
        # Same structure but OpCo books only £70 (= $87.50) instead of £80.
        # Net = +$100 (HoldCo) + −$87.50 (OpCo) = +$12.50 → blocked.
        print("-- scenario 11: intercompany unbalanced group blocks at post")
        bad_group = IntercompanyGroup.objects.create(
            organization=org, reference="LOAN-BAD",
            description="Mismatched amounts",
            created_by=alice,
        )
        je_hold_bad = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 17),
            memo="Advance to OpCo (bad)",
            lines=[
                {"account_id": A["1500"].id, "debit": Decimal("100"),
                 "currency": "USD", "counterparty_entity_id": opco.id},
                {"account_id": A["1010"].id, "credit": Decimal("100"),
                 "currency": "USD"},
            ],
            user=alice, currency="USD",
            intercompany_group=bad_group, counterparty_entity=opco,
        )
        je_op_bad = JournalService.create_draft(
            organization=org, entity=opco, date=date(2026, 4, 17),
            memo="Advance from HoldCo (bad)",
            lines=[
                {"account_id": OA["1010"].id, "debit": Decimal("70"),
                 "currency": "GBP"},
                {"account_id": OA["2500"].id, "credit": Decimal("70"),
                 "currency": "GBP", "counterparty_entity_id": holdco.id},
            ],
            user=alice, currency="GBP",
            intercompany_group=bad_group, counterparty_entity=holdco,
        )
        JournalService.submit_for_approval(je_hold_bad, user=alice)
        JournalService.submit_for_approval(je_op_bad, user=alice)
        JournalService.approve(je_hold_bad, user=bob)
        JournalService.approve(je_op_bad, user=bob)
        try:
            JournalService.post(je_hold_bad, user=bob)
            print("  FAIL: unbalanced IC group posted")
            sys.exit(1)
        except IntercompanyUnbalanced as e:
            print(f"  OK blocked: {e.message}")
            print(f"     details: {e.details}")
            assert "per_entity" in e.details

        # ── 12. FX revaluation — gain on EUR bank balance ───────────
        # HoldCo (USD functional) receives 1000 EUR on 2026-04-20 at the
        # historical rate 1.10 → $1100 functional. By 2026-04-30 the closing
        # rate is 1.15, so the EUR cash should now be worth $1150 functional —
        # a $50 unrealized FX gain.
        print("-- scenario 12: FX revaluation produces unrealized gain")
        eur_receipt = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 20),
            memo="EUR consulting receipt",
            lines=[
                {"account_id": A["1011"].id, "debit": Decimal("1000"),
                 "currency": "EUR"},
                {"account_id": A["4000"].id, "credit": Decimal("1000"),
                 "currency": "EUR"},
            ],
            user=alice, currency="EUR",
        )
        JournalService.submit_for_approval(eur_receipt, user=alice)
        JournalService.approve(eur_receipt, user=bob)
        JournalService.post(eur_receipt, user=bob)
        # Sanity: 1000 EUR × 1.10 = $1100 functional
        eur_receipt.refresh_from_db()
        assert eur_receipt.total_debit_functional == Decimal("1100.0000")

        reval = FXRevaluationService.revalue(
            entity=holdco, as_of=date(2026, 4, 30), user=alice,
        )
        assert reval is not None, "expected a revaluation JE"
        reval.refresh_from_db()
        print(f"  draft {reval.entry_number}; memo: {reval.memo}")
        for ln in reval.lines.all().order_by("line_order"):
            print(f"    {ln.account.code} {ln.account.name} "
                  f"({ln.account.account_subtype}): "
                  f"DR {ln.functional_debit} / CR {ln.functional_credit}")
        # Core check: the 1011 EUR cash account holds 1000 EUR. Closing rate
        # 1.15 vs historical 1.10 gives $50 unrealized gain → DR 1011 $50.
        cash_eur_line = reval.lines.filter(account=A["1011"]).first()
        assert cash_eur_line is not None, "expected reval line on 1011"
        assert cash_eur_line.functional_debit == Decimal("50.0000"), cash_eur_line.functional_debit
        assert cash_eur_line.currency == holdco.functional_currency, cash_eur_line.currency
        # An fx_gain offset must exist (subtype-based — entity may have
        # multiple fx_gain accounts seeded).
        gain_lines = reval.lines.filter(account__account_subtype="fx_gain")
        total_gain = sum((ln.functional_credit for ln in gain_lines), Decimal("0"))
        assert total_gain >= Decimal("50.0000"), total_gain
        # JE must balance in functional currency.
        assert reval.total_debit_functional == reval.total_credit_functional, (
            f"reval JE unbalanced: dr={reval.total_debit_functional} "
            f"cr={reval.total_credit_functional}"
        )
        assert reval.status == bc.JE_DRAFT
        assert reval.source_type == bc.SOURCE_FX_REVALUATION
        print(f"  OK $50 unrealized gain on 1000 EUR at 1.10->1.15 "
              f"(JE balances at ${reval.total_debit_functional})")

        # ── 13. Re-run revaluation — existing draft is replaced ─────
        print("-- scenario 13: re-run replaces existing draft")
        prior_id = reval.id
        reval2 = FXRevaluationService.revalue(
            entity=holdco, as_of=date(2026, 4, 30), user=alice,
        )
        assert reval2 is not None
        assert reval2.id != prior_id, "expected new JE id (old draft deleted)"
        assert not JournalEntry.objects.filter(id=prior_id).exists()
        print(f"  OK old draft id={prior_id} deleted, new draft id={reval2.id}")

        # Now post the second one and verify re-run errors out.
        JournalService.submit_for_approval(reval2, user=alice)
        JournalService.approve(reval2, user=bob)
        JournalService.post(reval2, user=bob)
        try:
            FXRevaluationService.revalue(
                entity=holdco, as_of=date(2026, 4, 30), user=alice,
            )
            print("  FAIL: re-run after post was allowed")
            sys.exit(1)
        except ValidationError as e:
            print(f"  OK blocked re-run after post: {e.message}")

        # ── 14. No-adjustments case returns None ────────────────────
        # OpCo's only foreign-currency exposure is its own functional GBP →
        # nothing to revalue. Service returns None.
        print("-- scenario 14: no foreign balances -> None")
        none_result = FXRevaluationService.revalue(
            entity=opco, as_of=date(2026, 4, 30), user=alice,
        )
        assert none_result is None
        print("  OK no draft created when nothing needs revaluation")

        # ── 15. Source documents — upload, dedup, drill-down, post-lock ──
        from io import BytesIO  # noqa: E402

        print("-- scenario 15: source documents")
        je_doc = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 22),
            memo="Office supplies — receipt attached",
            lines=[
                {"account_id": A["6000"].id, "debit": Decimal("42.50")},
                {"account_id": A["1010"].id, "credit": Decimal("42.50")},
            ],
            user=alice,
        )

        # Upload a "PDF" (just bytes that look like one)
        pdf_bytes = b"%PDF-1.4\n%test receipt content\n%%EOF"
        doc1 = SourceDocumentService.attach(
            journal_entry=je_doc,
            file=BytesIO(pdf_bytes),
            filename="staples-receipt.pdf",
            content_type="application/pdf",
            user=alice,
            description="Receipt for $42.50 office supplies",
        )
        assert doc1.size_bytes == len(pdf_bytes)
        assert len(doc1.content_hash) == 64
        print(f"  uploaded #{doc1.id}: {doc1.original_filename} "
              f"({doc1.size_bytes} bytes, hash {doc1.content_hash[:12]}...)")

        # Re-upload same content → must dedup
        doc1b = SourceDocumentService.attach(
            journal_entry=je_doc,
            file=BytesIO(pdf_bytes),
            filename="receipt-copy.pdf",  # different filename
            content_type="application/pdf",
            user=alice,
        )
        assert doc1b.id == doc1.id, "dedup failed — got new record for same bytes"
        print(f"  OK dedup: re-upload returned same record id={doc1b.id}")

        # Different content → new record
        doc2 = SourceDocumentService.attach(
            journal_entry=je_doc,
            file=BytesIO(b"vendor invoice email"),
            filename="vendor-email.eml",
            content_type="message/rfc822",
            user=alice,
        )
        assert doc2.id != doc1.id
        print(f"  uploaded #{doc2.id}: different content -> new record")

        # MIME whitelist rejection
        try:
            SourceDocumentService.attach(
                journal_entry=je_doc,
                file=BytesIO(b"#!/bin/sh\necho oops"),
                filename="script.sh",
                content_type="application/x-sh",
                user=alice,
            )
            print("  FAIL: shell script accepted")
            sys.exit(1)
        except ValidationError as e:
            print(f"  OK MIME whitelist blocked: {e.message}")

        # Drill-down: entry_detail must include attachments
        detail = ReportsService.entry_detail(entry=je_doc)
        attached = detail["attachments"]
        assert len(attached) == 2, f"expected 2 attachments, got {len(attached)}"
        assert all(a["uploaded_by"] == alice.email for a in attached)
        print(f"  OK entry_detail returns {len(attached)} attachments with metadata")

        # Soft-delete on a draft → allowed
        SourceDocumentService.soft_delete(doc2, user=alice)
        doc2.refresh_from_db()
        assert doc2.is_deleted
        print("  OK soft-delete on draft allowed")

        # Post the JE, then attempt to soft-delete remaining attachment → blocked
        JournalService.submit_for_approval(je_doc, user=alice)
        JournalService.approve(je_doc, user=bob)
        JournalService.post(je_doc, user=bob)
        try:
            SourceDocumentService.soft_delete(doc1, user=alice)
            print("  FAIL: soft-delete on posted entry allowed")
            sys.exit(1)
        except ValidationError as e:
            print(f"  OK post-lock blocked deletion: {e.message}")

        # ── 16. Vendors / Customers ─────────────────────────────────
        print("-- scenario 16: vendor + customer masters + JE linkage")
        vendor, _ = Vendor.objects.update_or_create(
            organization=org, code="STAPLES",
            defaults={
                "name": "Staples Business Advantage",
                "tax_id": "12-3456789",
                "default_currency": "USD",
                "default_payment_terms_days": 30,
                "default_expense_account": A["6000"],
                "created_by": alice,
            },
        )
        customer, _ = Customer.objects.update_or_create(
            organization=org, code="ACME",
            defaults={
                "name": "Acme Industries",
                "default_currency": "USD",
                "default_payment_terms_days": 45,
                "credit_limit": Decimal("50000.00"),
                "created_by": alice,
            },
        )
        je_bill = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 22),
            memo="Office supplies bill",
            lines=[
                {"account_id": A["6000"].id, "debit": Decimal("125.50")},
                {"account_id": A["1010"].id, "credit": Decimal("125.50")},
            ],
            user=alice,
        )
        # Link vendor post-create (service doesn't yet take it as a param)
        je_bill.vendor = vendor
        je_bill.save(update_fields=["vendor", "updated_at"])
        je_bill.refresh_from_db()
        assert je_bill.vendor_id == vendor.id
        assert je_bill.vendor.code == "STAPLES"
        print(f"  OK vendor {vendor.code} linked to {je_bill.entry_number}")

        # Drill-down includes vendor
        from beakon_core.services import ReportsService as _R
        detail = _R.entry_detail(entry=je_bill)
        # entry_detail doesn't include vendor yet — that's ok, serializer handles it at API layer.
        # Just verify the FK roundtrips.
        from beakon_core.models import JournalEntry as _JE
        refetched = _JE.objects.get(pk=je_bill.pk)
        assert refetched.vendor_id == vendor.id
        assert refetched.customer_id is None
        print(f"  OK customer {customer.code} (credit limit {customer.credit_limit}) created")

        # ── 17. Bill (AP) workflow ──────────────────────────────────
        print("-- scenario 17: bill draft -> approve -> pay (auto-JEs)")
        # Reuse vendor STAPLES from scenario 16
        vendor = Vendor.objects.get(organization=org, code="STAPLES")
        bill = BillService.create_draft(
            organization=org, entity=holdco, vendor=vendor,
            invoice_date=date(2026, 4, 23),
            bill_number="STP-2026-0042",
            currency="USD",
            lines=[
                {"expense_account_id": A["6000"].id,
                 "description": "April office supplies",
                 "amount": Decimal("180.00")},
                {"expense_account_id": A["6000"].id,
                 "description": "Toner cartridges",
                 "amount": Decimal("70.50")},
            ],
            tax_amount=Decimal("0"),
            user=alice,
        )
        assert bill.status == "draft"
        assert bill.total == Decimal("250.5000")
        assert bill.lines.count() == 2
        print(f"  draft {bill.reference} created · total {bill.total} {bill.currency}")

        BillService.submit_for_approval(bill, user=alice)
        bill.refresh_from_db()
        assert bill.status == "pending_approval"

        BillService.approve(bill, user=bob)
        bill.refresh_from_db()
        assert bill.status == "approved"
        assert bill.accrual_journal_entry_id is not None
        je_acc = bill.accrual_journal_entry
        je_acc.refresh_from_db()
        assert je_acc.status == "posted"
        assert je_acc.vendor_id == vendor.id
        # Verify JE posts: DR expense (250.50) / CR AP (250.50). The AP
        # account is whichever active account on this entity has subtype
        # accounts_payable — could be the one we seeded OR a pre-existing
        # one. Check by subtype, not code.
        ap_lines = je_acc.lines.filter(account__account_subtype="accounts_payable")
        exp_lines = je_acc.lines.filter(account__account_type="expense")
        assert ap_lines.count() == 1, f"expected 1 AP line, got {ap_lines.count()}"
        assert sum(l.credit for l in ap_lines) == Decimal("250.5000"), [l.credit for l in ap_lines]
        assert sum(l.debit for l in exp_lines) == Decimal("250.5000"), [l.debit for l in exp_lines]
        ap_acc = ap_lines.first().account
        print(f"  approved · accrual JE {je_acc.entry_number} posted "
              f"(DR expense 250.50 / CR {ap_acc.code} 250.50)")

        # Pay the bill
        BillService.mark_paid(
            bill,
            bank_account=A["1010"],
            payment_date=date(2026, 4, 25),
            user=bob,
            reference="WIRE-12345",
        )
        bill.refresh_from_db()
        assert bill.status == "paid"
        assert bill.payment_journal_entry_id is not None
        je_pay = bill.payment_journal_entry
        je_pay.refresh_from_db()
        assert je_pay.status == "posted"
        # DR AP (250.50) / CR 1010 (250.50)
        ap_pay = je_pay.lines.filter(account__account_subtype="accounts_payable")
        bank_pay = je_pay.lines.get(account__code="1010")
        assert ap_pay.count() == 1
        assert ap_pay.first().debit == Decimal("250.5000")
        assert bank_pay.credit == Decimal("250.5000")
        print(f"  paid · payment JE {je_pay.entry_number} posted "
              f"(DR {ap_pay.first().account.code} 250.50 / CR 1010 250.50)")

        # Net effect on the books: AP cleared, expense recognized, cash down.
        # Trial balance still balanced.
        from beakon_core.services import ReportsService as _R
        tb = _R.trial_balance(entity=holdco, as_of=date(2026, 4, 30))
        assert tb["totals"]["is_balanced"], tb["totals"]
        print(f"  TB still balanced after bill cycle: "
              f"DR {tb['totals']['total_debits']} / CR {tb['totals']['total_credits']}")

        # Invalid transition guard
        try:
            BillService.approve(bill, user=bob)  # already paid
            print("  FAIL: re-approve allowed")
            sys.exit(1)
        except Exception as e:
            print(f"  OK invalid transition blocked: {type(e).__name__}")

        # ── 18. Invoice (AR) workflow ───────────────────────────────
        print("-- scenario 18: invoice draft -> issue -> receive payment (auto-JEs)")
        customer = Customer.objects.get(organization=org, code="ACME")
        invoice = InvoiceService.create_draft(
            organization=org, entity=holdco, customer=customer,
            invoice_date=date(2026, 4, 24),
            invoice_number="INV-EXT-001",
            currency="USD",
            lines=[
                {"revenue_account_id": A["4000"].id,
                 "description": "Consulting services — April",
                 "amount": Decimal("3500.00")},
                {"revenue_account_id": A["4000"].id,
                 "description": "Onboarding setup",
                 "amount": Decimal("750.00")},
            ],
            tax_amount=Decimal("0"),
            user=alice,
        )
        assert invoice.status == "draft"
        assert invoice.total == Decimal("4250.0000")
        assert invoice.lines.count() == 2
        print(f"  draft {invoice.reference} created · total {invoice.total} {invoice.currency}")

        InvoiceService.submit_for_approval(invoice, user=alice)
        invoice.refresh_from_db()
        assert invoice.status == "pending_approval"

        InvoiceService.issue(invoice, user=bob)
        invoice.refresh_from_db()
        assert invoice.status == "issued"
        assert invoice.issued_journal_entry_id is not None
        je_iss = invoice.issued_journal_entry
        je_iss.refresh_from_db()
        assert je_iss.status == "posted"
        assert je_iss.customer_id == customer.id
        # Verify: DR AR (4250) / CR Revenue (4250)
        ar_lines = je_iss.lines.filter(account__account_subtype="accounts_receivable")
        rev_lines = je_iss.lines.filter(account__account_type="revenue")
        assert ar_lines.count() == 1
        assert ar_lines.first().debit == Decimal("4250.0000")
        assert sum(l.credit for l in rev_lines) == Decimal("4250.0000")
        ar_acc = ar_lines.first().account
        print(f"  issued · issuance JE {je_iss.entry_number} posted "
              f"(DR {ar_acc.code} 4250.00 / CR revenue 4250.00)")

        # Receive payment
        InvoiceService.record_payment(
            invoice,
            bank_account=A["1010"],
            payment_date=date(2026, 4, 28),
            user=bob,
            reference="ACH-987",
        )
        invoice.refresh_from_db()
        assert invoice.status == "paid"
        assert invoice.payment_journal_entry_id is not None
        je_rcv = invoice.payment_journal_entry
        je_rcv.refresh_from_db()
        assert je_rcv.status == "posted"
        # DR Bank (1010) / CR AR
        bank_rcv = je_rcv.lines.get(account__code="1010")
        ar_rcv = je_rcv.lines.filter(account__account_subtype="accounts_receivable")
        assert bank_rcv.debit == Decimal("4250.0000")
        assert ar_rcv.first().credit == Decimal("4250.0000")
        print(f"  paid · receipt JE {je_rcv.entry_number} posted "
              f"(DR 1010 4250.00 / CR {ar_rcv.first().account.code} 4250.00)")

        # TB still balanced
        tb2 = ReportsService.trial_balance(entity=holdco, as_of=date(2026, 4, 30))
        assert tb2["totals"]["is_balanced"], tb2["totals"]
        print(f"  TB still balanced after AR cycle")

        # ── 19. Cash Flow Statement reconciles to BS ─────────────────
        print("-- scenario 19: cash flow statement reconciles to balance sheet")
        cf = ReportsService.cash_flow_statement(
            entity=holdco,
            date_from=date(2026, 4, 1),
            date_to=date(2026, 4, 30),
        )
        print(f"  opening cash: {cf['opening_cash']}")
        print(f"  operating net: {cf['operating_activities']['net']} "
              f"({len(cf['operating_activities']['items'])} items)")
        print(f"  investing net: {cf['investing_activities']['net']} "
              f"({len(cf['investing_activities']['items'])} items)")
        print(f"  financing net: {cf['financing_activities']['net']} "
              f"({len(cf['financing_activities']['items'])} items)")
        print(f"  net change: {cf['net_change']}")
        print(f"  closing cash: {cf['closing_cash']}")
        print(f"  verification: {cf['verification']}")
        assert cf["verification"]["matches"], cf["verification"]
        print(f"  OK CF reconciles to BS")

        # ── 20. Disbursement / rebillable cost → client invoice ───────
        print("-- scenario 20: rebillable cost recovered as a client disbursement invoice")
        # Post a rebillable expense (DR 6000 / CR 1010) for the architecture
        # PDF's DHL example: cost is incurred by HoldCo but actually for a client.
        je_dhl = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 22),
            currency="USD", memo="DHL shipment for Acme matter",
            lines=[
                {"account_id": A["6000"].id, "debit": Decimal("180.00"),
                 "currency": "USD", "description": "DHL shipment 12345"},
                {"account_id": A["1010"].id, "credit": Decimal("180.00"),
                 "currency": "USD", "description": "DHL shipment 12345"},
            ],
            user=alice,
        )
        # Mark the expense line rebillable to ACME
        from beakon_core.models import DimensionType, DimensionValue
        client_dt, _ = DimensionType.objects.get_or_create(
            organization=org, code="CLIENT_RB",
            defaults={"name": "Client (rebill)", "active_flag": True},
        )
        client_dv, _ = DimensionValue.objects.get_or_create(
            organization=org, dimension_type=client_dt, code="ACME",
            defaults={"name": "ACME", "active_flag": True},
        )
        eline = je_dhl.lines.get(account=A["6000"])
        eline.is_rebillable = True
        eline.rebill_client_dimension_value = client_dv
        eline.save(update_fields=["is_rebillable", "rebill_client_dimension_value"])
        JournalService.submit_for_approval(je_dhl, user=alice)
        JournalService.approve(je_dhl, user=bob)
        JournalService.post(je_dhl, user=bob)
        print(f"  DHL expense JE {je_dhl.entry_number} posted (DR 6000 180 / CR 1010 180)")

        # Pending list includes this line
        pending = list(DisbursementService.pending_lines(organization=org))
        assert eline.id in {p.id for p in pending}, "rebillable line should be pending"
        print(f"  pending rebillables: {len(pending)}")

        # Issue a disbursement invoice from the rebillable
        disb_inv = DisbursementService.create_invoice_from_rebillables(
            organization=org, entity=holdco, customer=customer,
            journal_line_ids=[eline.id],
            invoice_date=date(2026, 4, 28),
            description="DHL passthrough",
            user=alice,
        )
        assert disb_inv.lines.count() == 1
        assert disb_inv.total == Decimal("180.0000")
        eline.refresh_from_db()
        assert eline.rebilled_invoice_line_id == disb_inv.lines.first().id, \
            "source line should be stamped"
        print(f"  draft disbursement invoice {disb_inv.reference} total=180 USD "
              f"linked back to JE-line {eline.id}")

        # Pending list now excludes it
        pending2 = list(DisbursementService.pending_lines(organization=org))
        assert eline.id not in {p.id for p in pending2}, "should not double-list"
        print(f"  pending after billing: {len(pending2)}")

        # Double-bill is rejected
        try:
            DisbursementService.create_invoice_from_rebillables(
                organization=org, entity=holdco, customer=customer,
                journal_line_ids=[eline.id],
                invoice_date=date(2026, 4, 28), user=alice,
            )
            raise AssertionError("double-bill should have raised")
        except ValidationError as e:
            print(f"  OK double-bill refused: {e.code}")

        # Issue the disbursement invoice through normal AR flow
        InvoiceService.submit_for_approval(disb_inv, user=alice)
        InvoiceService.issue(disb_inv, user=bob)
        disb_inv.refresh_from_db()
        assert disb_inv.status == "issued"
        assert disb_inv.issued_journal_entry_id is not None

        # Net method check: 6000 should now be DR 180 (DHL) + CR 180 (recovery) = 0
        net_6000 = (
            JournalEntry.objects
            .filter(organization=org, status="posted",
                    id__in=[je_dhl.id, disb_inv.issued_journal_entry_id])
            .aggregate(
                d=Sum("lines__debit", filter=Q(lines__account=A["6000"])),
                c=Sum("lines__credit", filter=Q(lines__account=A["6000"])),
            )
        )
        net = (net_6000["d"] or Decimal("0")) - (net_6000["c"] or Decimal("0"))
        assert net == Decimal("0"), f"net P&L on 6000 should be 0, got {net}"
        print(f"  issued {disb_inv.reference} status=issued; "
              f"net P&L on 6000 after recovery = {net} (net method OK)")

        # TB still balanced
        tb3 = ReportsService.trial_balance(entity=holdco, as_of=date(2026, 4, 30))
        assert tb3["totals"]["is_balanced"], tb3["totals"]
        print("  TB still balanced after disbursement cycle")

        # ── 21. VAT engine — Swiss 8.1% standard rate, full round trip ──
        print("-- scenario 21: VAT engine — Swiss 8.1% standard rate")
        from beakon_core.models import TaxCode

        # System accounts for VAT
        vat_payable = Account.objects.update_or_create(
            organization=org, entity=holdco, code="2200",
            defaults={
                "name": "VAT payable (Swiss 8.1%)",
                "account_type": bc.ACCOUNT_TYPE_LIABILITY,
                "account_subtype": "vat_payable",
                "is_system": True,
            },
        )[0]
        vat_receivable = Account.objects.update_or_create(
            organization=org, entity=holdco, code="1210",
            defaults={
                "name": "Input VAT recoverable (Swiss 8.1%)",
                "account_type": bc.ACCOUNT_TYPE_ASSET,
                "account_subtype": "vat_receivable",
                "is_system": True,
            },
        )[0]

        # The TaxCode itself
        ch_std, _ = TaxCode.objects.update_or_create(
            organization=org, code="CH-VAT-STD",
            defaults={
                "name": "Swiss Standard VAT 8.1%",
                "country_code": "CH",
                "tax_type": "STANDARD",
                "rate": Decimal("8.10"),
                "output_account": vat_payable,
                "input_account": vat_receivable,
                "active_flag": True,
            },
        )
        print(f"  TaxCode {ch_std.code} {ch_std.rate}% → output={vat_payable.code} "
              f"input={vat_receivable.code}")

        # ── (a) Bill with tax: 100 + 8.10 = 108.10 ─────────────────
        vat_bill = BillService.create_draft(
            organization=org, entity=holdco, vendor=vendor,
            invoice_date=date(2026, 4, 25),
            currency="USD",
            lines=[{
                "expense_account_id": A["6000"].id,
                "description": "Consulting fee",
                "amount": Decimal("100.00"),
                "tax_code_id": ch_std.id,
            }],
            user=alice,
        )
        assert vat_bill.subtotal == Decimal("100.00")
        assert vat_bill.tax_amount == Decimal("8.10")
        assert vat_bill.total == Decimal("108.10")
        print(f"  draft bill {vat_bill.reference}: subtotal={vat_bill.subtotal} "
              f"tax={vat_bill.tax_amount} total={vat_bill.total}")
        BillService.submit_for_approval(vat_bill, user=alice)
        BillService.approve(vat_bill, user=bob)
        vat_bill.refresh_from_db()
        je_acc = vat_bill.accrual_journal_entry
        # Verify: DR 6000 100 + DR 1210 8.10 + CR 2010 (AP) 108.10
        rows = {l.account.code: (l.debit, l.credit) for l in je_acc.lines.all()}
        assert rows["6000"] == (Decimal("100.0000"), Decimal("0")), rows
        assert rows["1210"] == (Decimal("8.1000"), Decimal("0")), rows
        assert rows["2010"] == (Decimal("0"), Decimal("108.1000")), rows
        print(f"  accrual JE {je_acc.entry_number} OK: "
              f"DR 6000 100 / DR 1210 8.10 (input VAT) / CR 2010 108.10")

        # ── (b) Invoice with tax: 1000 + 81.00 = 1081.00 ──────────
        vat_inv = InvoiceService.create_draft(
            organization=org, entity=holdco, customer=customer,
            invoice_date=date(2026, 4, 26),
            currency="USD",
            lines=[{
                "revenue_account_id": A["4000"].id,
                "description": "Advisory services",
                "amount": Decimal("1000.00"),
                "tax_code_id": ch_std.id,
            }],
            user=alice,
        )
        assert vat_inv.subtotal == Decimal("1000.00")
        assert vat_inv.tax_amount == Decimal("81.00")
        assert vat_inv.total == Decimal("1081.00")
        print(f"  draft inv {vat_inv.reference}: subtotal={vat_inv.subtotal} "
              f"tax={vat_inv.tax_amount} total={vat_inv.total}")
        InvoiceService.submit_for_approval(vat_inv, user=alice)
        InvoiceService.issue(vat_inv, user=bob)
        vat_inv.refresh_from_db()
        je_iss2 = vat_inv.issued_journal_entry
        # Verify: DR 1200 (AR) 1081 + CR 4000 (revenue) 1000 + CR 2200 (output VAT) 81
        rows2 = {l.account.code: (l.debit, l.credit) for l in je_iss2.lines.all()}
        ar_code = next(c for c, _ in rows2.items() if c.startswith("1200"))
        assert rows2[ar_code] == (Decimal("1081.0000"), Decimal("0")), rows2
        assert rows2["4000"] == (Decimal("0"), Decimal("1000.0000")), rows2
        assert rows2["2200"] == (Decimal("0"), Decimal("81.0000")), rows2
        print(f"  issuance JE {je_iss2.entry_number} OK: "
              f"DR {ar_code} 1081 / CR 4000 1000 / CR 2200 81 (output VAT)")

        # ── (c) VAT report ─────────────────────────────────────────
        report = VATReportService.report(
            organization=org, entity=holdco,
            date_from=date(2026, 4, 1), date_to=date(2026, 4, 30),
        )
        d = report.as_dict()
        print(f"  VAT report rows={len(d['rows'])} "
              f"output={d['total_output_vat']} input={d['total_input_vat']} "
              f"net={d['net_vat_payable']}")
        assert report.total_output_vat == Decimal("81.0000")
        assert report.total_input_vat == Decimal("8.1000")
        assert report.net_vat_payable == Decimal("72.9000")

        # TB still balanced
        tb4 = ReportsService.trial_balance(entity=holdco, as_of=date(2026, 4, 30))
        assert tb4["totals"]["is_balanced"], tb4["totals"]
        print("  TB still balanced after VAT cycle")

        # ── 22. Period close — revenue + expense → Retained Earnings ─
        print("-- scenario 22: period close — close revenue + expense to RE")
        # Need a retained earnings account on holdco
        re_account = Account.objects.update_or_create(
            organization=org, entity=holdco, code="3100",
            defaults={
                "name": "Retained Earnings",
                "account_type": bc.ACCOUNT_TYPE_EQUITY,
                "account_subtype": "retained_earnings",
                "is_system": True,
            },
        )[0]

        # Compute pre-close totals so we can verify post-close zeroing
        pl_before = ReportsService.profit_loss(
            entity=holdco,
            date_from=date(2026, 4, 1), date_to=date(2026, 4, 30),
        )
        rev_before = pl_before["revenue"]["total"]
        exp_before = pl_before["operating_expenses"]["total"]
        print(f"  pre-close: revenue={rev_before} expenses={exp_before} "
              f"net={pl_before['net_income']}")

        result = ClosingEntriesService.close_period(period, user=bob)
        print(f"  closing JE {result.journal_entry.entry_number} posted "
              f"({result.line_count} P&L lines + RE offset)")
        print(f"  revenue_total={result.revenue_total} "
              f"expense_total={result.expense_total} "
              f"net_income={result.net_income}")
        assert result.journal_entry.status == "posted"
        assert result.journal_entry.source_type == "period_close"

        # Re-running close should be refused
        try:
            ClosingEntriesService.close_period(period, user=bob)
            raise AssertionError("re-close should have raised")
        except ValidationError as e:
            print(f"  OK re-close refused: {e.code}")

        # Verify the closing JE itself balances and posts correctly:
        # debits + credits per side must match in functional currency.
        agg = result.journal_entry.lines.aggregate(
            d=Sum("functional_debit"), c=Sum("functional_credit"),
        )
        assert agg["d"] == agg["c"], f"closing JE not balanced: {agg}"
        print(f"  closing JE balanced in functional ccy: {agg['d']} = {agg['c']}")

        # Verify the offset to RE matches net_income
        re_lines = result.journal_entry.lines.filter(account=re_account)
        assert re_lines.count() == 1, f"expected 1 RE line, got {re_lines.count()}"
        re_line = re_lines.first()
        if result.net_income > 0:
            assert re_line.credit == result.net_income, \
                f"RE should be credited net_income {result.net_income}, got {re_line.credit}"
        elif result.net_income < 0:
            assert re_line.debit == -result.net_income, \
                f"RE should be debited |net_loss|, got {re_line.debit}"
        print(f"  RE offset on {re_account.code}: "
              f"DR={re_line.debit} CR={re_line.credit} (net_income={result.net_income})")

        # TB still balanced
        tb5 = ReportsService.trial_balance(entity=holdco, as_of=date(2026, 4, 30))
        assert tb5["totals"]["is_balanced"], tb5["totals"]
        print("  TB still balanced after period close")

        # ── 23. Recognition rule — Thomas's Nov–Apr $1,000 example ───
        print("-- scenario 23: recognition / prepaid expense across 6 periods")
        # Need a Prepaid Expense balance-sheet account to deferral against.
        # Recognise into operating_expense (6000).
        prepaid = Account.objects.update_or_create(
            organization=org, entity=holdco, code="1130",
            defaults={
                "name": "Prepaid Expenses",
                "account_type": bc.ACCOUNT_TYPE_ASSET,
                "account_subtype": "prepaid",
                "is_system": False,
            },
        )[0]
        # Need monthly periods Nov 2025 – Apr 2026 to host the recognition JEs.
        for ystart in (date(2025, 11, 1), date(2025, 12, 1),
                       date(2026, 1, 1), date(2026, 2, 1),
                       date(2026, 3, 1)):
            yend = (ystart + relativedelta(months=1) - relativedelta(days=1))
            Period.objects.update_or_create(
                entity=holdco, start_date=ystart, end_date=yend,
                defaults={
                    "name": ystart.strftime("%B %Y"),
                    "period_type": bc.PERIOD_MONTH,
                    "status": bc.PERIOD_OPEN,
                },
            )
        # April 2026 already exists from earlier scenarios; leave it.

        # Step 1: Park the prepayment — DR Prepaid 1000 / CR Bank 1000 on Nov 1.
        prepay_je = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2025, 11, 1),
            currency="USD", memo="Insurance prepayment Nov–Apr",
            lines=[
                {"account_id": prepaid.id, "debit": Decimal("1000.00"), "currency": "USD"},
                {"account_id": A["1010"].id, "credit": Decimal("1000.00"), "currency": "USD"},
            ],
            user=alice,
        )
        JournalService.submit_for_approval(prepay_je, user=alice)
        JournalService.approve(prepay_je, user=bob)
        JournalService.post(prepay_je, user=bob)
        print(f"  prepayment JE {prepay_je.entry_number}: DR 1130 1000 / CR 1010 1000")

        # Step 2: Create the recognition rule
        rule = RecognitionService.create_rule(
            organization=org, entity=holdco,
            code="PREPAID-INS-NOV2025",
            name="Insurance amortisation Nov 2025 – Apr 2026",
            rule_type="PREPAID_EXPENSE",
            total_amount=Decimal("1000.00"),
            currency="USD",
            start_date=date(2025, 11, 1),
            end_date=date(2026, 4, 30),
            deferral_account=prepaid,
            recognition_account=A["6000"],
            user=alice,
        )
        sched = RecognitionService.schedule(rule)
        print(f"  rule {rule.code} created with {len(sched)} periods:")
        for s in sched:
            print(f"    seq={s['sequence']:>2} {s['period_start']} → {s['period_end']} "
                  f"amount={s['amount']}")
        assert len(sched) == 6, f"expected 6 periods, got {len(sched)}"
        # Total reconciles exactly (last period gets rounding remainder)
        total = sum(Decimal(s["amount"]) for s in sched)
        assert total == Decimal("1000.00"), f"schedule sums to {total}"

        # Step 3: Recognise through Feb 2026 (4 of 6 periods due)
        result = RecognitionService.recognize(
            rule, as_of=date(2026, 2, 28), user=bob,
        )
        print(f"  ran recognition through Feb 28: posted {len(result.posted)} JEs, "
              f"completed_now={result.completed_now}")
        assert len(result.posted) == 4, f"expected 4 JEs, got {len(result.posted)}"
        rule.refresh_from_db()
        assert rule.recognized_to_date == Decimal("666.6800"), \
            f"recognized_to_date={rule.recognized_to_date}"
        print(f"  recognized_to_date={rule.recognized_to_date}, "
              f"remaining={rule.remaining_amount}")

        # Step 4: Idempotency — re-running through the same date posts 0 more
        result2 = RecognitionService.recognize(
            rule, as_of=date(2026, 2, 28), user=bob,
        )
        assert len(result2.posted) == 0, f"idempotency broken: posted {len(result2.posted)}"
        assert result2.skipped_already_posted == 4
        print(f"  re-run idempotent: posted 0, skipped {result2.skipped_already_posted}")

        # Step 5: Recognise final 2 periods (Mar + Apr)
        result3 = RecognitionService.recognize(
            rule, as_of=date(2026, 4, 30), user=bob,
        )
        print(f"  ran through Apr 30: posted {len(result3.posted)} more JEs, "
              f"completed_now={result3.completed_now}")
        assert len(result3.posted) == 2
        assert result3.completed_now is True
        rule.refresh_from_db()
        assert rule.status == "COMPLETED"
        assert rule.recognized_to_date == Decimal("1000.00")

        # Verify the prepaid account ends at 0 (Nov 1: +1000; six recognitions: -1000)
        prepaid_balance = (
            JournalLine.objects
            .filter(
                journal_entry__organization=org,
                journal_entry__status="posted",
                account=prepaid,
            )
            .aggregate(d=Sum("functional_debit"), c=Sum("functional_credit"))
        )
        prepaid_net = (prepaid_balance["d"] or Decimal("0")) - (prepaid_balance["c"] or Decimal("0"))
        assert prepaid_net == Decimal("0"), f"prepaid should net to 0, got {prepaid_net}"
        print(f"  prepaid 1130 balance after full recognition = {prepaid_net} (OK)")

        # ── 24. Bank charge — 5th transaction type (Thomas §3 step 3) ──
        print("-- scenario 24: bank charge auto-drafts DR 6000 / CR 1010")
        bc_je = BankChargeService.create_draft(
            organization=org, entity=holdco,
            bank_account=A["1010"],
            amount=Decimal("12.50"),
            charge_date=date(2026, 4, 27),
            expense_account=A["6000"],
            description="Wire transfer fee",
            user=alice,
        )
        bc_je.refresh_from_db()
        assert bc_je.status == bc.JE_DRAFT
        rows = {ln.account.code: (ln.debit, ln.credit) for ln in bc_je.lines.all()}
        assert rows["6000"] == (Decimal("12.5000"), Decimal("0")), rows
        assert rows["1010"] == (Decimal("0"), Decimal("12.5000")), rows
        assert bc_je.source_type == bc.SOURCE_BANK_TRANSACTION
        # Goes through the standard approval flow
        JournalService.submit_for_approval(bc_je, user=alice)
        JournalService.approve(bc_je, user=bob)
        JournalService.post(bc_je, user=bob)
        bc_je.refresh_from_db()
        assert bc_je.status == bc.JE_POSTED
        print(f"  OK bank-charge {bc_je.entry_number} posted "
              f"(DR 6000 12.50 / CR 1010 12.50)")

        # Validation guards
        try:
            BankChargeService.create_draft(
                organization=org, entity=holdco,
                bank_account=A["1010"],
                amount=Decimal("-1"),  # negative
                charge_date=date(2026, 4, 27),
                expense_account=A["6000"],
                user=alice,
            )
            print("  FAIL: negative amount accepted")
            sys.exit(1)
        except ValidationError as e:
            assert e.code == "BC001", e.code
            print(f"  OK blocked negative amount: {e.message}")
        try:
            BankChargeService.create_draft(
                organization=org, entity=holdco,
                bank_account=A["6000"],  # not a bank/cash subtype
                amount=Decimal("5"),
                charge_date=date(2026, 4, 27),
                expense_account=A["6000"],
                user=alice,
            )
            print("  FAIL: non-bank account accepted")
            sys.exit(1)
        except ValidationError as e:
            assert e.code == "BC003", e.code
            print(f"  OK blocked non-bank account: {e.message}")

        # ── 25. 4-eyes posting — entity flag enforces approver != poster ──
        print("-- scenario 25: 4-eyes posting blocks self-post when required")
        holdco.four_eyes_posting_required = True
        holdco.save(update_fields=["four_eyes_posting_required"])

        je_4eyes = JournalService.create_draft(
            organization=org, entity=holdco, date=date(2026, 4, 28),
            currency="USD", memo="4-eyes test",
            lines=[
                {"account_id": A["6000"].id, "debit": Decimal("20")},
                {"account_id": A["1010"].id, "credit": Decimal("20")},
            ],
            user=alice,
        )
        JournalService.submit_for_approval(je_4eyes, user=alice)
        JournalService.approve(je_4eyes, user=bob)
        # Bob (the approver) must NOT be allowed to post when 4-eyes is on.
        try:
            JournalService.post(je_4eyes, user=bob)
            print("  FAIL: approver allowed to self-post under 4-eyes")
            sys.exit(1)
        except SelfApproval as e:
            print(f"  OK blocked: {e.message[:80]}...")
        # A different user (alice) can post — she didn't approve this one.
        JournalService.post(je_4eyes, user=alice)
        je_4eyes.refresh_from_db()
        assert je_4eyes.status == bc.JE_POSTED
        print(f"  OK {je_4eyes.entry_number} posted by separate user under 4-eyes")
        # Reset for any later scenarios
        holdco.four_eyes_posting_required = False
        holdco.save(update_fields=["four_eyes_posting_required"])

        # ── 26. PostingRule registry — Thomas's 5 default rules seeded ──
        print("-- scenario 26: posting-rule registry covers the 5 txn types")
        # Seeder runs in migration; ensure_seeded is idempotent.
        created = PostingRuleService.ensure_seeded(organization=org)
        rules = PostingRuleService.list_active(organization=org)
        codes = sorted(r.transaction_type for r in rules)
        expected = sorted([
            "supplier_invoice", "customer_invoice",
            "supplier_payment", "customer_receipt", "bank_charge",
        ])
        assert set(expected).issubset(set(codes)), (
            f"missing rules: {set(expected) - set(codes)}"
        )
        print(f"  registry has {len(rules)} active rules "
              f"(seeded={created} this run)")
        # Sample rule lookups
        sup_inv = PostingRuleService.get(
            organization=org, transaction_type="supplier_invoice",
        )
        assert sup_inv.debit_role == "expense"
        assert sup_inv.credit_role == "accounts_payable"
        bc_rule = PostingRuleService.get(
            organization=org, transaction_type="bank_charge",
        )
        assert bc_rule.debit_role == "bank_charge_expense"
        assert bc_rule.credit_role == "bank"
        print(f"  OK supplier_invoice → DR {sup_inv.debit_role} / CR {sup_inv.credit_role}")
        print(f"  OK bank_charge      → DR {bc_rule.debit_role} / CR {bc_rule.credit_role}")
        # Unknown type → ValidationError
        try:
            PostingRuleService.get(organization=org, transaction_type="nonexistent")
            print("  FAIL: unknown txn type returned a rule")
            sys.exit(1)
        except ValidationError as e:
            assert e.code == "PR001", e.code
            print(f"  OK unknown txn type rejected: {e.code}")

        # ── 27. Tier 1: bank-to-bank transfer (same currency) ──────────
        print("-- scenario 27: bank transfer DR 1012 / CR 1010 (USD same-ccy)")
        # Need a second USD bank to transfer between — 1011 is EUR, so add 1012.
        bank2 = Account.objects.update_or_create(
            organization=org, entity=holdco, code="1012",
            defaults={
                "name": "Cash — HoldCo Secondary USD Bank",
                "account_type": bc.ACCOUNT_TYPE_ASSET,
                "account_subtype": "bank",
                "currency": "USD",
            },
        )[0]
        # Explicitly mark 1011 as EUR so the cross-currency check fires below.
        # (setup_world doesn't set Account.currency; lines pass it per-line.)
        A["1010"].currency = "USD"; A["1010"].save(update_fields=["currency"])
        A["1011"].currency = "EUR"; A["1011"].save(update_fields=["currency"])
        xfer_je = BankTransferService.transfer(
            organization=org, entity=holdco,
            source_account=A["1010"], target_account=bank2,
            amount=Decimal("500"),
            transfer_date=date(2026, 4, 28),
            description="Sweep to secondary",
            user=alice,
        )
        xfer_rows = {ln.account.code: (ln.debit, ln.credit) for ln in xfer_je.lines.all()}
        assert xfer_rows["1012"] == (Decimal("500.0000"), Decimal("0")), xfer_rows
        assert xfer_rows["1010"] == (Decimal("0"), Decimal("500.0000")), xfer_rows
        # Cross-currency must raise
        try:
            BankTransferService.transfer(
                organization=org, entity=holdco,
                source_account=A["1010"], target_account=A["1011"],  # USD→EUR
                amount=Decimal("100"),
                transfer_date=date(2026, 4, 28),
                user=alice,
            )
            print("  FAIL: cross-currency transfer accepted")
            sys.exit(1)
        except ValidationError as e:
            assert e.code == "BT005", e.code
            print(f"  OK cross-currency blocked: {e.code}")
        print(f"  OK transfer JE {xfer_je.entry_number}: DR 1012 500 / CR 1010 500")

        # ── 28. Tier 1: bank interest received ──────────────────────────
        print("-- scenario 28: bank interest DR 1010 / CR Interest Income")
        # Seed an interest-income revenue account so auto-resolve picks it.
        interest_inc = Account.objects.update_or_create(
            organization=org, entity=holdco, code="4100",
            defaults={
                "name": "Bank Interest Income",
                "account_type": bc.ACCOUNT_TYPE_REVENUE,
                "account_subtype": "other_income",
            },
        )[0]
        int_je = BankInterestService.record(
            organization=org, entity=holdco,
            bank_account=A["1010"], amount=Decimal("3.45"),
            date=date(2026, 4, 30),
            description="Q1 interest",
            user=alice,
        )
        int_rows = {ln.account.code: (ln.debit, ln.credit) for ln in int_je.lines.all()}
        assert int_rows["1010"] == (Decimal("3.4500"), Decimal("0")), int_rows
        assert int_rows["4100"] == (Decimal("0"), Decimal("3.4500")), int_rows
        print(f"  OK interest JE {int_je.entry_number}: DR 1010 3.45 / CR 4100 3.45")

        # ── 29. Tier 1: owner capital contribution ──────────────────────
        print("-- scenario 29: owner contribution DR 1010 / CR Capital")
        capital = Account.objects.update_or_create(
            organization=org, entity=holdco, code="3010",
            defaults={
                "name": "Owner Capital",
                "account_type": bc.ACCOUNT_TYPE_EQUITY,
                "account_subtype": "capital",
            },
        )[0]
        cap_je = OwnerContributionService.record(
            organization=org, entity=holdco,
            bank_account=A["1010"], amount=Decimal("10000"),
            date=date(2026, 4, 5),
            description="Initial capital",
            user=alice,
        )
        cap_rows = {ln.account.code: (ln.debit, ln.credit) for ln in cap_je.lines.all()}
        assert cap_rows["1010"] == (Decimal("10000.0000"), Decimal("0")), cap_rows
        assert cap_rows["3010"] == (Decimal("0"), Decimal("10000.0000")), cap_rows
        print(f"  OK contribution JE {cap_je.entry_number}: DR 1010 10000 / CR 3010 10000")

        # ── 30. Tier 1: vendor credit note ─────────────────────────────
        print("-- scenario 30: vendor credit note DR AP / CR Expense")
        vendor = Vendor.objects.get(organization=org, code="STAPLES")
        vcn_je = VendorCreditNoteService.create_draft(
            organization=org, entity=holdco, vendor=vendor,
            amount=Decimal("25.00"),
            credit_note_date=date(2026, 4, 26),
            expense_account=A["6000"],
            description="Staples refund — wrong item",
            user=alice,
        )
        vcn_rows = {ln.account.code: (ln.debit, ln.credit) for ln in vcn_je.lines.all()}
        # AP code may differ depending on what the entity has seeded.
        ap_lines = [c for c, dc in vcn_rows.items() if dc[0] > 0 and c != "6000"]
        assert len(ap_lines) == 1, vcn_rows
        ap_code = ap_lines[0]
        assert vcn_rows[ap_code] == (Decimal("25.0000"), Decimal("0")), vcn_rows
        assert vcn_rows["6000"] == (Decimal("0"), Decimal("25.0000")), vcn_rows
        JournalService.submit_for_approval(vcn_je, user=alice)
        JournalService.approve(vcn_je, user=bob)
        JournalService.post(vcn_je, user=bob)
        vcn_je.refresh_from_db()
        assert vcn_je.status == bc.JE_POSTED
        print(f"  OK vendor CN {vcn_je.entry_number}: DR {ap_code} 25 / CR 6000 25")

        # ── 31. Tier 1: customer credit note ───────────────────────────
        print("-- scenario 31: customer credit note DR Revenue / CR AR")
        customer = Customer.objects.get(organization=org, code="ACME")
        ccn_je = CustomerCreditNoteService.create_draft(
            organization=org, entity=holdco, customer=customer,
            amount=Decimal("100.00"),
            credit_note_date=date(2026, 4, 27),
            revenue_account=A["4000"],
            description="ACME service credit",
            user=alice,
        )
        ccn_rows = {ln.account.code: (ln.debit, ln.credit) for ln in ccn_je.lines.all()}
        assert ccn_rows["4000"] == (Decimal("100.0000"), Decimal("0")), ccn_rows
        ar_lines = [c for c, dc in ccn_rows.items() if dc[1] > 0 and c != "4000"]
        assert len(ar_lines) == 1, ccn_rows
        ar_code = ar_lines[0]
        assert ccn_rows[ar_code] == (Decimal("0"), Decimal("100.0000")), ccn_rows
        JournalService.submit_for_approval(ccn_je, user=alice)
        JournalService.approve(ccn_je, user=bob)
        JournalService.post(ccn_je, user=bob)
        ccn_je.refresh_from_db()
        assert ccn_je.status == bc.JE_POSTED
        print(f"  OK customer CN {ccn_je.entry_number}: DR 4000 100 / CR {ar_code} 100")

        # ── 32. Tier 1: VAT remittance ─────────────────────────────────
        print("-- scenario 32: VAT remittance DR 2200 / CR 1010")
        vat_je = VATRemittanceService.record(
            organization=org, entity=holdco,
            bank_account=A["1010"], amount=Decimal("72.90"),
            date=date(2026, 4, 30),
            description="Q1 net VAT remittance",
            user=alice,
        )
        vat_rows = {ln.account.code: (ln.debit, ln.credit) for ln in vat_je.lines.all()}
        assert vat_rows["2200"] == (Decimal("72.9000"), Decimal("0")), vat_rows
        assert vat_rows["1010"] == (Decimal("0"), Decimal("72.9000")), vat_rows
        # Validation: amount must be positive
        try:
            VATRemittanceService.record(
                organization=org, entity=holdco,
                bank_account=A["1010"], amount=Decimal("0"),
                date=date(2026, 4, 30),
                user=alice,
            )
            print("  FAIL: zero amount accepted")
            sys.exit(1)
        except ValidationError as e:
            assert e.code == "VR001", e.code
            print(f"  OK zero amount blocked: {e.code}")
        print(f"  OK VAT remit JE {vat_je.entry_number}: DR 2200 72.90 / CR 1010 72.90")

        # ── 33. Posting-rule registry now covers 11 transaction types ──
        print("-- scenario 33: registry includes Tier 1 expansion")
        rules = PostingRuleService.list_active(organization=org)
        codes = {r.transaction_type for r in rules}
        tier1_expected = {
            "bank_transfer", "bank_interest", "owner_contribution",
            "vendor_credit_note", "customer_credit_note", "vat_remittance",
        }
        assert tier1_expected.issubset(codes), f"missing: {tier1_expected - codes}"
        assert len(codes) >= 11, f"expected >= 11 active rules, got {len(codes)}"
        print(f"  OK registry has {len(codes)} active rules incl. all Tier 1")

        # ── 34. Tier 2: Loan drawdown + repayment + accrual ────────────
        print("-- scenario 34: loan drawdown / repayment / accrual (LIABILITY)")
        # Need: a Loan master row, a loan_payable account, an interest_expense account.
        loan_payable = Account.objects.update_or_create(
            organization=org, entity=holdco, code="2300",
            defaults={
                "name": "Mortgage Payable",
                "account_type": bc.ACCOUNT_TYPE_LIABILITY,
                "account_subtype": "loan_payable",
            },
        )[0]
        interest_exp = Account.objects.update_or_create(
            organization=org, entity=holdco, code="6300",
            defaults={
                "name": "Mortgage Interest Expense",
                "account_type": bc.ACCOUNT_TYPE_EXPENSE,
                "account_subtype": "operating_expense",
            },
        )[0]
        the_loan, _ = Loan.objects.update_or_create(
            organization=org, loan_id="LN_MORTGAGE_001",
            defaults={
                "loan_name": "Mortgage Loan 001",
                "loan_type": Loan.LOAN_TYPE_MORTGAGE,
                "loan_side": Loan.LOAN_SIDE_LIABILITY,
                "status": Loan.STATUS_ACTIVE,
            },
        )
        # Drawdown
        drw = LoanService.drawdown(
            organization=org, entity=holdco, loan=the_loan,
            bank_account=A["1010"], amount=Decimal("100000"),
            date=date(2026, 4, 5), description="Mortgage drawdown",
            user=alice,
        )
        drw_rows = {ln.account.code: (ln.debit, ln.credit) for ln in drw.lines.all()}
        assert drw_rows["1010"] == (Decimal("100000.0000"), Decimal("0")), drw_rows
        # Loan payable account auto-resolved by subtype — could be 2300 (just
        # created) or another loan_payable on the entity. Verify by subtype.
        liab_lines = [ln for ln in drw.lines.all()
                      if ln.account.account_subtype == "loan_payable"]
        assert len(liab_lines) == 1
        assert liab_lines[0].credit == Decimal("100000.0000")
        liab_code = liab_lines[0].account.code
        # Confirm dimension_loan_id stamped on every line
        assert all(ln.dimension_loan_id == the_loan.id for ln in drw.lines.all())
        print(f"  OK drawdown {drw.entry_number}: DR 1010 100000 / CR 2300 100000 [LOAN tag]")

        # Repayment with split
        rep = LoanService.repayment(
            organization=org, entity=holdco, loan=the_loan,
            bank_account=A["1010"],
            principal=Decimal("500"), interest=Decimal("250"),
            date=date(2026, 4, 30), description="Monthly mortgage payment",
            user=alice,
        )
        rep_rows = {ln.account.code: (ln.debit, ln.credit) for ln in rep.lines.all()}
        assert rep_rows[liab_code] == (Decimal("500.0000"), Decimal("0")), rep_rows
        # Interest expense auto-resolved by name match — find it by subtype.
        int_lines = [ln for ln in rep.lines.all()
                     if ln.account.account_type == "expense" and "interest" in (ln.account.name or "").lower()]
        assert len(int_lines) == 1, [ln.account.code for ln in rep.lines.all()]
        assert int_lines[0].debit == Decimal("250.0000")
        int_code = int_lines[0].account.code
        assert rep_rows["1010"] == (Decimal("0"), Decimal("750.0000")), rep_rows
        print(f"  OK repayment {rep.entry_number}: DR {liab_code} 500 + DR {int_code} 250 / CR 1010 750")

        # Accrue interest
        acc = LoanService.accrue_interest(
            organization=org, entity=holdco, loan=the_loan,
            amount=Decimal("83.33"), date=date(2026, 4, 30),
            description="April interest accrual", user=alice,
        )
        acc_rows = {ln.account.code: (ln.debit, ln.credit) for ln in acc.lines.all()}
        assert acc_rows[int_code] == (Decimal("83.3300"), Decimal("0")), acc_rows
        assert acc_rows[liab_code] == (Decimal("0"), Decimal("83.3300")), acc_rows
        print(f"  OK accrual {acc.entry_number}: DR {int_code} 83.33 / CR {liab_code} 83.33")

        # ── 35. Tier 2: Capital call + distribution ────────────────────
        print("-- scenario 35: PE capital call + distribution (return + gain)")
        investment_acct = Account.objects.update_or_create(
            organization=org, entity=holdco, code="1450",
            defaults={
                "name": "PE Investments",
                "account_type": bc.ACCOUNT_TYPE_ASSET,
                "account_subtype": "investment",
            },
        )[0]
        investment_gain = Account.objects.update_or_create(
            organization=org, entity=holdco, code="4200",
            defaults={
                "name": "PE Realised Gain",
                "account_type": bc.ACCOUNT_TYPE_REVENUE,
                "account_subtype": "investment_income",
            },
        )[0]
        the_com, _ = Commitment.objects.update_or_create(
            organization=org, commitment_id="COM_PE_001",
            defaults={
                "commitment_name": "PE Fund I",
                "commitment_type": "LP_FUND",
                "status": Commitment.STATUS_ACTIVE,
                "active_flag": True,
            },
        )
        cc_je = CommitmentService.capital_call(
            organization=org, entity=holdco, commitment=the_com,
            bank_account=A["1010"], investment_account=investment_acct,
            amount=Decimal("25000"), date=date(2026, 4, 10),
            description="Q2 capital call", user=alice,
        )
        cc_rows = {ln.account.code: (ln.debit, ln.credit) for ln in cc_je.lines.all()}
        assert cc_rows["1450"] == (Decimal("25000.0000"), Decimal("0")), cc_rows
        assert cc_rows["1010"] == (Decimal("0"), Decimal("25000.0000")), cc_rows
        assert all(ln.dimension_commitment_id == the_com.id for ln in cc_je.lines.all())
        print(f"  OK capital call {cc_je.entry_number}: DR 1450 25000 / CR 1010 25000 [COM tag]")

        # Distribution: 10000 return of capital + 3000 gain = 13000 total
        dist = CommitmentService.distribution(
            organization=org, entity=holdco, commitment=the_com,
            bank_account=A["1010"], investment_account=investment_acct,
            gain_account=investment_gain,
            return_of_capital=Decimal("10000"),
            gain=Decimal("3000"),
            date=date(2026, 4, 28),
            description="Distribution received", user=alice,
        )
        d_rows = {ln.account.code: (ln.debit, ln.credit) for ln in dist.lines.all()}
        assert d_rows["1010"] == (Decimal("13000.0000"), Decimal("0")), d_rows
        assert d_rows["1450"] == (Decimal("0"), Decimal("10000.0000")), d_rows
        assert d_rows["4200"] == (Decimal("0"), Decimal("3000.0000")), d_rows
        print(f"  OK distribution {dist.entry_number}: DR 1010 13000 / CR 1450 10000 + CR 4200 3000")

        # ── 36. Tier 2: Property — rental income + expense ─────────────
        print("-- scenario 36: rental income + property expense")
        rental_inc = Account.objects.update_or_create(
            organization=org, entity=holdco, code="4300",
            defaults={
                "name": "Rental Income",
                "account_type": bc.ACCOUNT_TYPE_REVENUE,
                "account_subtype": "operating_revenue",
            },
        )[0]
        property_exp = Account.objects.update_or_create(
            organization=org, entity=holdco, code="6400",
            defaults={
                "name": "Property Maintenance",
                "account_type": bc.ACCOUNT_TYPE_EXPENSE,
                "account_subtype": "operating_expense",
            },
        )[0]
        the_prop, _ = Property.objects.update_or_create(
            organization=org, property_id="PROP_RES_001",
            defaults={
                "property_name": "Zurich Residence",
                "property_type": "RESIDENTIAL",
                "status": Property.STATUS_ACTIVE,
                "active_flag": True,
            },
        )
        rent_je = PropertyService.rental_income(
            organization=org, entity=holdco, property=the_prop,
            bank_account=A["1010"], income_account=rental_inc,
            amount=Decimal("4000"), date=date(2026, 4, 1),
            description="April rent", user=alice,
        )
        rent_rows = {ln.account.code: (ln.debit, ln.credit) for ln in rent_je.lines.all()}
        assert rent_rows["1010"] == (Decimal("4000.0000"), Decimal("0")), rent_rows
        assert rent_rows["4300"] == (Decimal("0"), Decimal("4000.0000")), rent_rows
        assert all(ln.dimension_property_id == the_prop.id for ln in rent_je.lines.all())
        print(f"  OK rental {rent_je.entry_number}: DR 1010 4000 / CR 4300 4000 [PROP tag]")

        prop_exp_je = PropertyService.property_expense(
            organization=org, entity=holdco, property=the_prop,
            bank_account=A["1010"], expense_account=property_exp,
            amount=Decimal("350"), date=date(2026, 4, 15),
            description="Plumbing repair", user=alice,
        )
        pe_rows = {ln.account.code: (ln.debit, ln.credit) for ln in prop_exp_je.lines.all()}
        assert pe_rows["6400"] == (Decimal("350.0000"), Decimal("0")), pe_rows
        assert pe_rows["1010"] == (Decimal("0"), Decimal("350.0000")), pe_rows
        print(f"  OK prop expense {prop_exp_je.entry_number}: DR 6400 350 / CR 1010 350 [PROP tag]")

        # ── 37. Tier 2: Insurance — premium + claim ────────────────────
        print("-- scenario 37: insurance premium + claim received")
        ins_exp = Account.objects.update_or_create(
            organization=org, entity=holdco, code="6500",
            defaults={
                "name": "Insurance Expense",
                "account_type": bc.ACCOUNT_TYPE_EXPENSE,
                "account_subtype": "operating_expense",
            },
        )[0]
        ins_recovery = Account.objects.update_or_create(
            organization=org, entity=holdco, code="4400",
            defaults={
                "name": "Insurance Recovery",
                "account_type": bc.ACCOUNT_TYPE_REVENUE,
                "account_subtype": "other_income",
            },
        )[0]
        the_pol, _ = Policy.objects.update_or_create(
            organization=org, policy_id="POL_HOME_001",
            defaults={
                "policy_name": "Home Insurance",
                "policy_type": "HOME",
                "status": Policy.STATUS_ACTIVE,
                "active_flag": True,
            },
        )
        prem_je = InsuranceService.premium_paid(
            organization=org, entity=holdco, policy=the_pol,
            bank_account=A["1010"], expense_account=ins_exp,
            amount=Decimal("1200"), date=date(2026, 4, 1),
            description="Annual home insurance", user=alice,
        )
        prem_rows = {ln.account.code: (ln.debit, ln.credit) for ln in prem_je.lines.all()}
        assert prem_rows["6500"] == (Decimal("1200.0000"), Decimal("0")), prem_rows
        assert prem_rows["1010"] == (Decimal("0"), Decimal("1200.0000")), prem_rows
        assert all(ln.dimension_policy_id == the_pol.id for ln in prem_je.lines.all())
        print(f"  OK premium {prem_je.entry_number}: DR 6500 1200 / CR 1010 1200 [POL tag]")

        claim_je = InsuranceService.claim_received(
            organization=org, entity=holdco, policy=the_pol,
            bank_account=A["1010"], recovery_account=ins_recovery,
            amount=Decimal("800"), date=date(2026, 4, 20),
            description="Storm damage claim", user=alice,
        )
        claim_rows = {ln.account.code: (ln.debit, ln.credit) for ln in claim_je.lines.all()}
        assert claim_rows["1010"] == (Decimal("800.0000"), Decimal("0")), claim_rows
        assert claim_rows["4400"] == (Decimal("0"), Decimal("800.0000")), claim_rows
        print(f"  OK claim {claim_je.entry_number}: DR 1010 800 / CR 4400 800 [POL tag]")

        # ── 38. Posting-rule registry now covers 20 transaction types ──
        print("-- scenario 38: registry includes Tier 2 expansion")
        rules2 = PostingRuleService.list_active(organization=org)
        codes2 = {r.transaction_type for r in rules2}
        tier2_expected = {
            "loan_drawdown", "loan_repayment", "loan_interest_accrual",
            "capital_call", "distribution",
            "rental_income", "property_expense",
            "insurance_premium", "insurance_claim",
        }
        assert tier2_expected.issubset(codes2), f"missing: {tier2_expected - codes2}"
        assert len(codes2) >= 20, f"expected >= 20 active rules, got {len(codes2)}"
        print(f"  OK registry has {len(codes2)} active rules incl. all Tier 2")

        print("OK: kernel smoke test passed — rolling back.")
        transaction.savepoint_rollback(sid)


if __name__ == "__main__":
    main()
