"""manage.py seed_ml_demo_data --entity THOMAS-HOLD

Creates synthetic matched bank transactions on the entity's primary bank
account so the ML categoriser has real labelled history to train on.
Useful for live demos where the bank-feed → categorise → post pipeline
hasn't run enough volume yet.

Each row gets:
    - A BankTransaction with realistic description / amount / date
    - A POSTED JournalEntry attached:
          deposit  (positive amt) -> DR Bank / CR offset_account
          withdrawal (negative)   -> DR offset_account / CR Bank
    - txn.status = "matched", txn.proposed_journal_entry = je

After seeding, the command auto-trains the entity's model and prints
3-fold cross-validation accuracy. ``--dry-run`` skips writes; ``--reset``
deletes the previously-seeded demo rows first.

For repeatability, every row carries an external_id prefix of "ML-DEMO-"
so the reset path is targeted (won't touch real categorised data).
"""
from __future__ import annotations

import hashlib
import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from beakon_core import constants as core_c
from beakon_core.models import Account, Entity, JournalEntry, JournalLine, Period
from beakon_banking import constants as bk_c
from beakon_banking.models import BankAccount, BankTransaction
from beakon_banking.services import MLBankCategorizer


SEED_PREFIX = "ML-DEMO-"


# (description template, amount range CHF, target offset account code, sign)
# Sign: +1 = deposit (money in), -1 = withdrawal (money out).
TEMPLATES: list[tuple[str, tuple[int, int], str, int]] = [
    # ── Service Revenue (4000) — deposits ────────────────────────
    ("MANAGEMENT FEE - OPCO-A SA",            (80_000, 150_000), "4000", +1),
    ("MGMT FEE Q1 - SUBSIDIARY 2",            (40_000, 90_000),  "4000", +1),
    ("MANAGEMENT FEE INVOICE 2026-{n}",       (50_000, 120_000), "4000", +1),
    ("ADVISORY FEE - FAM-INV-LTD",            (15_000, 35_000),  "4000", +1),
    ("MGMT FEE QUARTERLY",                    (45_000, 95_000),  "4000", +1),
    ("MGMT SERVICES INV-{n}",                 (60_000, 110_000), "4000", +1),
    ("ADVISORY FEE Q{q} 2026",                (20_000, 60_000),  "4000", +1),
    ("MANAGEMENT FEE BILLED",                 (35_000, 85_000),  "4000", +1),
    # ── Operating Expenses (6000) — withdrawals (services / utilities) ─
    ("PWC ZURICH - PROFESSIONAL FEES",        (5_000, 25_000),   "6000", -1),
    ("KPMG - AUDIT FEE Q{q}",                 (8_000, 22_000),   "6000", -1),
    ("EY ZURICH - TAX ADVISORY",              (3_000, 12_000),   "6000", -1),
    ("BAR & KARRER - LEGAL ADVICE",           (4_000, 18_000),   "6000", -1),
    ("RENT - BAHNHOFSTRASSE OFFICE",          (8_000, 12_000),   "6000", -1),
    ("OFFICE LEASE PAYMENT MAY",              (7_500, 11_000),   "6000", -1),
    ("UBS BANK CHARGES",                      (200, 800),        "6000", -1),
    ("ZKB ACCOUNT FEE",                       (150, 500),        "6000", -1),
    ("DIRECTOR PAYROLL APR 2026",             (15_000, 30_000),  "6000", -1),
    ("SALARY - DIRECTOR M.MUSTER",            (18_000, 28_000),  "6000", -1),
    ("EWZ ELECTRICITY - OFFICE",              (300, 900),        "6000", -1),
    ("SWISSCOM BUSINESS LINE",                (120, 350),        "6000", -1),
    # ── Accounts Payable (2010) — paying down approved bills ─────
    ("BILL PAYMENT - VENDOR INV-{n}",         (1_000, 8_000),    "2010", -1),
    ("AP SETTLEMENT - INVOICE-{n}",           (500, 5_000),      "2010", -1),
    ("WIRE TO VENDOR - INV{n}",               (2_000, 12_000),   "2010", -1),
    ("AP PAYMENT BATCH",                      (5_000, 25_000),   "2010", -1),
    ("VENDOR PAYMENT - SETTLED",              (1_500, 7_000),    "2010", -1),
    ("BILL{n} PAID",                          (800, 4_500),      "2010", -1),
    # ── Accounts Receivable (1200) — customer payments coming in ─
    ("CUSTOMER PAYMENT - INV-{n}",            (10_000, 50_000),  "1200", +1),
    ("AR COLLECTION - CUST-{n}",              (5_000, 30_000),   "1200", +1),
    ("INVOICE INV-{n} PAID",                  (8_000, 40_000),   "1200", +1),
    ("CLIENT REMITTANCE INV{n}",              (12_000, 45_000),  "1200", +1),
    ("PAYMENT FROM ACME LTD",                 (15_000, 60_000),  "1200", +1),
    ("FAM-INV-LTD INVOICE {n}",               (20_000, 70_000),  "1200", +1),
    # ── Capital (3000) — owner contributions ─────────────────────
    ("OWNER CAPITAL CONTRIBUTION",            (100_000, 500_000), "3000", +1),
    ("CAPITAL INJECTION - PARENT CO",         (250_000, 800_000), "3000", +1),
    ("EQUITY FUND TRANSFER",                  (50_000, 300_000), "3000", +1),
    ("SHAREHOLDER LOAN CONVERTED",            (75_000, 400_000), "3000", +1),
    ("CAPITAL CALL - SHAREHOLDER",            (150_000, 600_000), "3000", +1),
]


class Command(BaseCommand):
    help = "Seed labelled bank transactions for the ML categoriser demo, then train."

    def add_arguments(self, parser):
        parser.add_argument(
            "--entity", default="THOMAS-HOLD",
            help="Entity code to seed under. Default: THOMAS-HOLD.",
        )
        parser.add_argument("--reset", action="store_true",
                            help="Delete any previously-seeded ML-DEMO-* txns first.")
        parser.add_argument("--dry-run", action="store_true",
                            help="Show what would be created without writing.")
        parser.add_argument("--no-train", action="store_true",
                            help="Skip the auto-train step at the end.")

    def handle(self, *args, **opts):
        try:
            entity = Entity.objects.get(code=opts["entity"])
        except Entity.DoesNotExist:
            raise CommandError(f"No entity {opts['entity']!r} found.")
        bank = (
            BankAccount.objects
            .filter(entity=entity, is_active=True)
            .select_related("account")
            .first()
        )
        if not bank:
            raise CommandError(f"No active bank account on {entity.code}.")
        bank_acct = bank.account

        # Build a code -> Account lookup, error early if any template
        # account is missing on this entity.
        codes_needed = {t[2] for t in TEMPLATES}
        accounts = {
            a.code: a for a in
            Account.objects.filter(organization=entity.organization, entity=entity,
                                   code__in=codes_needed)
        }
        missing = codes_needed - set(accounts)
        if missing:
            raise CommandError(
                f"Entity {entity.code} is missing CoA accounts: {sorted(missing)}. "
                f"Run the entity seeder first."
            )

        if opts["reset"] and not opts["dry_run"]:
            n_deleted_je, _ = JournalEntry.objects.filter(
                organization=entity.organization, entity=entity,
                source_ref__startswith=SEED_PREFIX,
            ).delete()
            n_deleted_txn, _ = BankTransaction.objects.filter(
                bank_account=bank, external_id__startswith=SEED_PREFIX,
            ).delete()
            self.stdout.write(
                f"Reset: removed {n_deleted_je} JEs and {n_deleted_txn} txns.\n"
            )

        rng = random.Random(42)  # deterministic for repeatability
        # Spread over the past 60 days so day-of-month features have variety
        start = date.today() - timedelta(days=60)
        rows = []
        for i, (template, amt_range, code, sign) in enumerate(TEMPLATES):
            amt = Decimal(rng.randint(amt_range[0], amt_range[1]))
            description = template.format(
                n=str(1000 + i).rjust(4, "0"),
                q=rng.randint(1, 4),
            )
            d = start + timedelta(days=rng.randint(0, 59))
            signed = amt * sign
            rows.append({
                "description": description,
                "amount": signed,
                "date": d,
                "offset_account": accounts[code],
                "offset_code": code,
            })

        self.stdout.write(f"Will create {len(rows)} matched txns on "
                          f"{entity.code} ({bank.name}, {bank.currency}).\n")
        if opts["dry_run"]:
            for r in rows[:6]:
                self.stdout.write(f"  {r['date']}  {r['amount']:>12}  "
                                  f"-> {r['offset_code']}  {r['description']}")
            self.stdout.write(f"  …and {len(rows) - 6} more.")
            return

        with transaction.atomic():
            n_created = self._materialise(entity, bank, bank_acct, rows)
        self.stdout.write(self.style.SUCCESS(
            f"\nCreated {n_created} matched txns and JEs.\n"
        ))

        if opts["no_train"]:
            return

        self.stdout.write("Training MLBankCategorizer...\n")
        result = MLBankCategorizer.train(entity)
        self.stdout.write(
            f"  samples={result.samples} classes={result.classes} "
            f"cv_acc={result.cv_accuracy:.3f}" if result.cv_accuracy
            else f"  samples={result.samples} classes={result.classes} cv_acc=skipped"
        )
        if result.path:
            self.stdout.write(f"  model -> {result.path}")
        else:
            self.stdout.write(f"  {result.message}")

        # Quick sanity check: predict on a few held-out-style strings.
        self.stdout.write("\nSample predictions:")
        for desc, amt in [
            ("MANAGEMENT FEE - HOLDCO Q3", Decimal("85000")),
            ("PWC AUDIT FEE 2026", Decimal("-12000")),
            ("AR COLLECTION - INVOICE 1234", Decimal("28000")),
            ("UBS BANK FEES MAY",          Decimal("-450")),
        ]:
            t = BankTransaction(
                bank_account=bank, description=desc, amount=amt,
                date=date.today(), currency=bank.currency,
            )
            pred = MLBankCategorizer.suggest(t)
            if pred:
                self.stdout.write(
                    f"  {desc:<40} amt={amt:>10}  -> "
                    f"{pred['account_code']} {pred['account_name']:<25} "
                    f"({int(pred['confidence']*100)}%)"
                )
            else:
                self.stdout.write(f"  {desc:<40} -> no prediction")

    def _materialise(self, entity, bank, bank_acct, rows):
        """Create the BankTransaction + posted JE pair for every row."""
        period = Period.objects.filter(
            entity=entity, status="open",
        ).order_by("start_date").first()
        # If today's row falls outside the only open period, fall back to it
        # anyway — periods are an accounting concept, this is just demo data.

        n_seq = 1
        last_seq = (JournalEntry.objects
                    .filter(entity=entity)
                    .order_by("-id")
                    .values_list("entry_number", flat=True).first())
        if last_seq and last_seq.startswith("JE-"):
            try:
                n_seq = int(last_seq.split("-")[1]) + 1
            except (IndexError, ValueError):
                n_seq = 1

        n_created = 0
        for row in rows:
            entry_number = f"JE-{n_seq:06d}"
            n_seq += 1

            # JE: posted directly (this is seed/demo data — bypass the
            # 4-eyes service path so the seeder doesn't need user fixtures).
            je = JournalEntry.objects.create(
                organization=entity.organization,
                entity=entity,
                entry_number=entry_number,
                date=row["date"],
                memo=row["description"][:200],
                reference=row["description"][:50],
                status=core_c.JE_POSTED,
                source_type=core_c.SOURCE_BANK_TRANSACTION,
                source_ref=f"{SEED_PREFIX}{entry_number}",
                currency=bank.currency,
                period=period if period and period.start_date <= row["date"] <= period.end_date else None,
                posted_at=timezone.now(),
            )

            amt = abs(row["amount"])
            ccy = bank.currency
            if row["amount"] < 0:
                # Withdrawal: DR offset / CR bank
                JournalLine.objects.create(
                    journal_entry=je, account=row["offset_account"],
                    debit=amt, credit=Decimal("0"), currency=ccy,
                    functional_debit=amt, functional_credit=Decimal("0"),
                    description=row["description"][:300], line_order=0,
                )
                JournalLine.objects.create(
                    journal_entry=je, account=bank_acct,
                    debit=Decimal("0"), credit=amt, currency=ccy,
                    functional_debit=Decimal("0"), functional_credit=amt,
                    description=row["description"][:300], line_order=1,
                )
            else:
                # Deposit: DR bank / CR offset
                JournalLine.objects.create(
                    journal_entry=je, account=bank_acct,
                    debit=amt, credit=Decimal("0"), currency=ccy,
                    functional_debit=amt, functional_credit=Decimal("0"),
                    description=row["description"][:300], line_order=0,
                )
                JournalLine.objects.create(
                    journal_entry=je, account=row["offset_account"],
                    debit=Decimal("0"), credit=amt, currency=ccy,
                    functional_debit=Decimal("0"), functional_credit=amt,
                    description=row["description"][:300], line_order=1,
                )

            # JE totals — only functional totals are denormalised on the model.
            je.total_debit_functional = amt
            je.total_credit_functional = amt
            je.save(update_fields=[
                "total_debit_functional", "total_credit_functional",
            ])

            # BankTransaction stamped MATCHED, pointing at the posted JE.
            ext_id = SEED_PREFIX + hashlib.sha1(
                f"{bank.id}|{row['date']}|{row['amount']}|{row['description']}|{n_seq}"
                .encode("utf-8")
            ).hexdigest()[:24]
            BankTransaction.objects.create(
                bank_account=bank, external_id=ext_id,
                date=row["date"],
                description=row["description"],
                original_description=row["description"],
                amount=row["amount"],
                currency=ccy,
                status=bk_c.TXN_MATCHED,
                proposed_journal_entry=je,
                is_duplicate=False,
            )
            n_created += 1
        return n_created
