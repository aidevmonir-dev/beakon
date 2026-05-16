# Monday demo runbook — Custodian Statements (Avaloq SFTP pilot, v2)

> **v2 update**: page redesigned to a daily reconciliation control room.
> Now has an environment strip, SLA + coverage strip, action queue,
> 14-day arrival heatmap, filter rail, categorised reconciliation
> differences (timing / FX / missing trade / corp action / true error /
> unknown), and a tabbed statement drawer with Provenance, Audit, and
> Re-process. The two-step walkthrough card is now a *first-run* card —
> it disappears the moment you have a posted statement.

**Audience:** Thomas (and anyone else in the meeting).
**Time budget:** 5 minutes live click-through. Read the storyline below
once before the meeting; then drive it from the dashboard.

---

## Pre-flight (do this 10 minutes before)

```powershell
# 1. Make sure both servers are up
python manage.py runserver 0.0.0.0:8000
# (in another terminal)
cd frontend ; npm run dev

# 2. Reset to a clean demo state — wipes any prior statements so the
#    counts on screen start at zero.
python manage.py shell -c "from beakon_banking.models import AvaloqFeedDrop; AvaloqFeedDrop.objects.all().delete()"

# 3. Make sure seed data is in place (idempotent)
python manage.py seed_avaloq_demo

# 4. Open the page so it's already loaded
#    http://localhost:3000/dashboard/bank-feed/
```

If you also want CLI evidence beside the browser, keep a Python
shell open at:

```python
from beakon_banking.models import AvaloqFeedDrop, ReconciliationBreak
```

---

## The storyline (5 minutes)

### Beat 1 — set the stage (30 seconds)

> "Thomas, you sent me the screenshot last week from the Geneva bank
> on Avaloq. They send us a daily statement package — five sections:
> cash movements, trade confirmations, holdings, performance, and
> pending orders. I want to show you the whole flow working — receive
> the statement, post it to the ledger, reconcile holdings — against
> mock data we generate ourselves. When the real samples arrive after
> your IT call, the only thing that changes is how each section is
> read; the rest of what you'll see tonight is what production looks
> like."

Open `/dashboard/bank-feed/` (Custodian Statements). The two-step
walkthrough card is visible.

### Beat 2 — receive the statement (30 seconds)

Click **Receive sample statement**.

> "In production this is the bank's overnight SFTP push. Here we
> bring it in locally — but the receiving folder, the file naming,
> the contents, all match what the bank will send."

Banner: *"Sample statement received — Portfolio BEAKON-DEMO-001 ·
business date 2026-05-10 · 1.9 KB."*

### Beat 3 — post to the ledger (60 seconds)

Click **Post statement**.

Wait ~1 second. Banner switches to:

> *"Posted 1 statement to the ledger — Cash movements: 10 · Trade
> confirmations: 4 · Pending orders: 3 · Holdings: 5 · Performance: 4
> — 2 reconciliation differences"*

Stats strip updates: **1 statement posted**, **26 line items posted**,
**2 open differences**, last posting "Posted".

> "All five sections of the statement are read in one transaction.
> The cash movements land in our bank-feed table through the same
> dedup logic the manual statement upload uses, so re-posting the
> same day's statement writes nothing twice. The trade confirmations,
> holdings, performance, and pending orders each land in their own
> portfolio-side records."

### Beat 4 — open the statement (60 seconds)

Click the row in the **Statements** table.

The statement drawer slides in with seven tabs:
**Overview · Cash · Trades · Holdings · Performance · Orders · Audit**.

> "The Overview tab gives me everything I need at a glance:
> per-section line counts, *Provenance* showing the source IP — green
> dot, allowlisted; the SHA-256 hash of the file so we can prove
> integrity; the schema version we detected. Differences scoped to
> this statement at the bottom. The other tabs let me browse the
> actual data."

Click each tab briefly. Land on **Audit** last:

> "Every step is timestamped — received at 08:47 CET, posting started,
> posted to ledger, reconciliation completed. This is the audit
> trail FINMA will ask for."

Close the drawer.

### Beat 5 — the reconciliation story (90 seconds)

Scroll to **Reconciliation differences**.

> "Here's the real value. The bank's holdings statement is
> authoritative. We reconcile it against the ledger line-by-line.
> The system found two differences today — and it told me *why*."

Point at the **category chips** at the top:

> "Two differences, two categories. **True error** is one — that's
> a real discrepancy that needs a human. **Missing trade** is one —
> we never booked a position the bank says we own."

Point at the first difference (True error · Roche):

> **CH0012032048 — Quantity mismatch (True error).**
> *"Per custodian: 0 shares. Per ledger: 100 shares. Suggested next
> step: 'Recent trade history exists for this ISIN but does not
> mathematically explain the difference — investigate.'"*

> "The engine looked at our trade history, saw a buy, did the math,
> and said: this doesn't add up. So it's flagging it for me to
> investigate rather than letting me believe it'll self-resolve."

Point at the second difference (Missing trade · Nestlé):

> **CH0038863350 — Unrecognised security (Missing trade).**
> *"Per custodian: 80 shares. Per ledger: 0. Suggested next step:
> 'No trade on file for CH0038863350. Either book the missing buy
> or ask the custodian why this position appears on the statement.'"*

> "Same idea, opposite direction. The bank says we own Nestlé; the
> ledger has no record. Engine recognises this as a *missing trade*,
> not a corporate action, because there's no recent trade history
> for this ISIN at all."

### Beat 6 — what's next (60 seconds)

Close the drawer.

> "Three things to flag for your IT call with the bank:
>
> 1. **Statement format.** What we built today assumes a structured
>    layout with the columns I made up. We need their actual sample
>    statements. Once we have them, the readers swap one-for-one.
> 2. **SFTP hosting.** This is running off a local folder. Real
>    SFTP needs a Swiss server, three IP allowlists, and SSH key
>    auth — that's the spec doc I sent you Saturday.
> 3. **Per-portfolio prefix.** The statement file name starts with
>    a portfolio code. We need to confirm with them what that code
>    actually represents and that it stays stable per relationship."

> "Once we have samples, I estimate three weeks of work to swap the
> readers, stand up the SFTP receiver, schedule the daily posting,
> and pilot it on one client. End-to-end the rest is already done
> — what you're seeing today."

---

## If something goes wrong on stage

| Symptom | Recovery |
|---------|----------|
| Page blank / 401 | You're not logged in. Log in at `/login`. |
| "Receive sample statement" returns 500 | The receiving folder wasn't created. Run `python manage.py drop_mock_avaloq` from the CLI once — it creates the folder. |
| "Post statement" returns "No statements pending" | Click "Receive sample statement" first, *then* "Post statement". |
| Counts are off (not 10/4/3/5/4) | Wipe and re-seed: `AvaloqFeedDrop.objects.all().delete()` then re-run the demo. |
| Differences aren't 2 | The seed data drifted — `python manage.py seed_avaloq_demo` will not delete TaxLots that already exist with different qty. Run the wipe + seed in pre-flight. |
| Detail drawer empty | The statement hasn't been posted yet. Click "Post statement" first. |

## What NOT to claim during the demo

- **"This is talking to the real bank."** It is not. Say "sample
  statement" or "demo statement" each time.
- **"This is production-grade."** It's not — we have no SFTP
  receiver, no monitoring, no alerting, no per-bank user accounts.
- **"The format matches Avaloq."** We don't know what Avaloq's
  format looks like yet. Ours is plausible but invented.
- **"Auto-posts to journal entries."** Cash movements land in the
  bank-feed table; they need a human to categorise + approve before
  a journal entry posts. This is by design (Thomas's "no auto-post
  until the readers are reliable for one full month").

---

## Closing line

> "When you have the call with their IT next week, ping me — I'll
> sit in. The questions in section 4 of the spec doc are designed
> so we walk out with everything we need."
