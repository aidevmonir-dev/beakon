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
    Currency,
    Customer,
    Entity,
    FXRate,
    IntercompanyGroup,
    Invoice,
    JournalEntry,
    Period,
    Vendor,
)
from beakon_core.services import (  # noqa: E402
    BillService,
    FXRevaluationService,
    InvoiceService,
    JournalService,
    ReportsService,
    SourceDocumentService,
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
        vendor = Vendor.objects.create(
            organization=org, code="STAPLES",
            name="Staples Business Advantage",
            tax_id="12-3456789",
            default_currency="USD",
            default_payment_terms_days=30,
            default_expense_account=A["6000"],
            created_by=alice,
        )
        customer = Customer.objects.create(
            organization=org, code="ACME",
            name="Acme Industries",
            default_currency="USD",
            default_payment_terms_days=45,
            credit_limit=Decimal("50000.00"),
            created_by=alice,
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

        print("OK: kernel smoke test passed — rolling back.")
        transaction.savepoint_rollback(sid)


if __name__ == "__main__":
    main()
