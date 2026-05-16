# Commercial funnel demo runbook

**Goal**: show a prospect (or Thomas's investors / partners) the full
journey from "I see your ad" to "I'm using Beakon every day" — without
ever touching the back-office.

**Time budget**: 4–5 minutes live click-through.
**Audience**: anyone who needs to see Beakon as a sellable product, not
just a tool.

---

## Pre-flight (do this 10 minutes before)

```powershell
# 1. Servers up
python manage.py runserver 0.0.0.0:8000
# (other terminal)
cd frontend ; npm run dev

# 2. Plans seeded (idempotent)
python manage.py seed_plans

# 3. Use a fresh browser profile / incognito so you're logged out.
#    Open http://localhost:3000/ in that window.

# 4. Pick an email + password you'll use in the demo. Suggested:
#       email:    demo+monday@allina.ch
#       password: BeakonDemo2026!
```

If the same email has been used before, either pick a fresh one or wipe
the prior account:

```powershell
python manage.py shell -c "from accounts.models import User; User.objects.filter(email='demo+monday@allina.ch').delete()"
```

---

## The storyline (5 minutes)

### Beat 1 — landing & pricing (45 seconds)

Open `http://localhost:3000/` in a **fresh / incognito browser**.

> "This is what a prospect sees. They land on the marketing page,
> scroll a bit, and click **Pricing**."

Click **Pricing** in the nav.

> "Four tiers — Starter, Professional, Family Office, Enterprise.
> The pricing reflects the audience: CHF 79 for a single SME, CHF 490
> for a family office, custom for fiduciaries. Notice the CTAs differ —
> the first three are **Start 30-day trial**; Enterprise is **Book a
> call**, because at that price point we're not selling self-serve."

### Beat 2 — sign up (45 seconds)

Click **Start 30-day trial** on the **Family Office** card.

> "The pricing page hands the chosen plan into the registration page.
> Notice the badge — *Family Office plan, CHF 490 / mo* — so the user
> knows what they're committing to."

Fill in name, email, password. Click **Create account**.

> "No credit card. No 'enter billing now'. We don't need that — for
> the family-office market, payment happens via invoice once the
> contract is signed."

### Beat 3 — setup wizard (90 seconds)

The user lands on `/setup?plan=family`.

> "Now a four-step wizard. Step one: workspace basics."

Fill in:
- Workspace name: `Demo Family Office`
- Currency: CHF
- Country: Switzerland

Click **Continue**.

> "Step two: how is the business structured? This drives which modules
> the user sees. Single company is the simplest. Multi-entity adds
> intercompany. Custodian-fed adds the Custodian Statements module
> we built earlier."

Pick **Custodian-fed family office**. Click **Continue**.

> "Step three: would you like to explore with sample data? It's off
> by default — a real customer's books shouldn't have fake Roche
> shares in them. For the demo we'll turn it on."

Toggle **Yes, seed the sample family-office dataset**. Click **Continue**.

> "Step four: review and start. Plan, currency, country, structure,
> sample data toggle, and the trial terms — 30 days, no credit card,
> activate when ready."

Click **Start my 30-day trial**.

### Beat 4 — inside the product (60 seconds)

The user lands on `/dashboard`. The first thing they see is the
**trial banner** at the top of every page:

> *Family Office trial · 30 days left · Activate plan*

> "Persistent strip across every page. They always know what plan
> they're on, how much trial is left, and where to upgrade. No
> mystery, no nag-screens, no 'we'll surprise you with a bill in
> three weeks'."

Walk them through the dashboard quickly — Home, Approvals,
Financials. Then Custodian Statements:

> "And because they picked custodian-fed structure, the Custodian
> Statements module is right here under **Money** in the sidebar.
> Their daily SFTP feed lands here, posts to the ledger, and
> reconciles holdings against their books — exactly what we showed
> earlier in the dedicated demo."

(Optional: click into Custodian Statements briefly so they see it's
populated with sample data.)

### Beat 5 — the activation moment (60 seconds)

Click **Activate plan** in the trial banner.

A modal opens.

> "When the user is ready to convert, one click. Not 'enter your
> credit card and we'll auto-bill you forever'. They confirm their
> contact, leave a note about their billing entity if they have a
> special VAT setup, and submit."

Fill in:
- Contact name: `Thomas`
- Contact email: `thomas@allina.ch`
- Notes: `Please invoice Allina Family Office GmbH, VAT CHE-123.456.789`

Click **Send activation request**.

The banner switches to:

> *Activation requested — we'll be in touch.*

> "From here it's our process: I get an email, I send an invoice
> through our normal billing flow, the customer pays, and I flip
> the subscription to **active** in the back-office. The trial
> doesn't expire while the activation is in flight."

### Beat 6 — the back-office side (45 seconds)

Open Django admin in a separate tab: `http://localhost:8000/admin/beakon_core/activationrequest/`.

> "Here's what I see. Every activation request lands as a row, with
> the org, contact, plan, and notes. I mark it **Invoice sent** when
> I email the invoice, **Paid** when payment confirms — and Bulk
> action 'Mark selected as active' on the subscription flips the
> trial to active."

(If time, show the Plans admin too — to make the point that the
catalogue is editable: change pricing, add a new tier, deactivate
a tier without touching code.)

---

## What this demonstrates

Four things, in order of how a prospect / partner / investor will
score you:

1. **There's a real funnel.** Pricing → register → onboarding →
   product is a connected path, not a Frankenstein of links.
2. **The commercial model is clear.** Trial period stated, no hidden
   credit-card friction, plan badge visible everywhere.
3. **The product matches the pitch.** The structure question in the
   wizard maps directly to which modules show up — multi-entity gets
   intercompany, custodian-fed gets the SFTP feed.
4. **There's an operator on the other side.** Activation isn't a
   black box — Thomas's admin view shows requests landing,
   subscriptions to flip, plans to edit.

## What it does NOT yet demonstrate (be honest if asked)

- **Stripe / automatic billing.** Activation is manual today. That's
  a feature in this market, not a bug — but if pressed, say "we
  invoice through our existing billing stack; Stripe Invoices is on
  the roadmap when self-serve volume justifies it."
- **Per-plan feature gating.** A Starter org currently sees the same
  screens as a Family Office org. That's a deliberate v1 scope — we
  don't yet have a list of which features each plan locks. Coming
  after the founder team agrees on what's in each plan.
- **Trial expiry handling.** The model has the date, the banner
  counts down, but nothing currently *enforces* the expiry. The next
  build adds "trial expired — read-only mode" + auto-email.

## If something goes wrong on stage

| Symptom | Recovery |
|---|---|
| Pricing CTAs go nowhere | `python manage.py seed_plans` — Plan rows missing. |
| Setup wizard 500s on "Start trial" | Subscription start endpoint failed. The wizard logs it as a warning and continues; the user still lands in dashboard. The trial banner won't show but everything else works. |
| Trial banner doesn't appear | The org has no subscription. `OrganizationSubscription.objects.create(...)` from the shell, or just re-run the wizard with a fresh user. |
| Email already exists | Wipe with the shell command in pre-flight or pick a different demo email. |
| Activate modal 401s | The user isn't authenticated — log in via `/login`. |

## What NOT to claim

- **"It charges credit cards."** It doesn't, and you don't want it
  to (yet). Say "invoice-based activation".
- **"All plans are unlocked."** They are today, but say "the system
  is wired for plan-based gating; we're rolling out feature
  differences as we go". Honest.
- **"30 days is the standard trial."** It's the standard *Beakon*
  trial. Family-office customers will probably negotiate longer for
  their first contract; the model supports custom trial durations.
