"""Generate the live-demo runbook as a printable PDF.

End-to-end Beakon demo: one supplier invoice from creation to reports,
with check-off boxes alongside Thomas's §9 Definition of Done. Designed
to be printed and held while clicking through the dashboard.
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    Preformatted,
    KeepTogether,
)


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "blueprint" / "demo_runbook_supplier_invoice_e2e.pdf"


# ── Styles ─────────────────────────────────────────────────────────────
def _styles():
    base = getSampleStyleSheet()
    ink = colors.HexColor("#0E2A47")
    accent = colors.HexColor("#1F3A5F")
    muted = colors.HexColor("#5B6B7C")
    return {
        "title": ParagraphStyle(
            "Title", parent=base["Title"],
            fontName="Helvetica-Bold", fontSize=20,
            textColor=ink, alignment=TA_LEFT, spaceAfter=8,
        ),
        "subtitle": ParagraphStyle(
            "Sub", parent=base["BodyText"],
            fontName="Helvetica", fontSize=11,
            textColor=muted, leading=15, spaceAfter=14,
        ),
        "h1": ParagraphStyle(
            "H1", parent=base["Heading1"],
            fontName="Helvetica-Bold", fontSize=14,
            textColor=accent, spaceBefore=14, spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "H2", parent=base["Heading2"],
            fontName="Helvetica-Bold", fontSize=12,
            textColor=accent, spaceBefore=8, spaceAfter=4,
        ),
        "step_title": ParagraphStyle(
            "Step", parent=base["Heading2"],
            fontName="Helvetica-Bold", fontSize=12,
            textColor=ink, spaceBefore=12, spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "Body", parent=base["BodyText"],
            fontName="Helvetica", fontSize=10.5, leading=14,
            spaceAfter=4,
        ),
        "say": ParagraphStyle(
            "Say", parent=base["BodyText"],
            fontName="Helvetica-Oblique", fontSize=10.5, leading=14,
            textColor=ink, leftIndent=10, spaceAfter=6,
            borderPadding=4,
        ),
        "tick": ParagraphStyle(
            "Tick", parent=base["BodyText"],
            fontName="Helvetica-Bold", fontSize=10,
            textColor=colors.HexColor("#0F7B3F"), spaceAfter=8,
        ),
        "bullet": ParagraphStyle(
            "Bullet", parent=base["BodyText"],
            fontName="Helvetica", fontSize=10.5, leading=14,
            leftIndent=14, bulletIndent=2, spaceAfter=2,
        ),
        "mono": ParagraphStyle(
            "Mono", parent=base["BodyText"],
            fontName="Courier", fontSize=9, leading=12,
            spaceAfter=4,
        ),
        "cover_label": ParagraphStyle(
            "CoverLabel", parent=base["BodyText"],
            fontName="Helvetica", fontSize=10.5,
            textColor=muted, spaceAfter=2,
        ),
    }


def _checkbox(label: str, s) -> Paragraph:
    """Single line with a square checkbox in front."""
    return Paragraph(f"☐ &nbsp;&nbsp;{label}", s["bullet"])


def _step(story, S, *, num: int, title: str, time_est: str,
          do: list[str], say: str | None, ticks: str) -> None:
    story.append(Paragraph(
        f"Step {num} · {title} <font color='#5B6B7C' size='9'>"
        f"({time_est})</font>", S["step_title"]))
    if do:
        for line in do:
            story.append(Paragraph(line, S["bullet"]))
    if say:
        story.append(Spacer(1, 0.1 * cm))
        story.append(Paragraph(f"Say: <i>“{say}”</i>", S["say"]))
    story.append(Paragraph(f"✅ Ticks: {ticks}", S["tick"]))


# ── Document ───────────────────────────────────────────────────────────
def build():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUT), pagesize=A4,
        leftMargin=1.8 * cm, rightMargin=1.8 * cm,
        topMargin=1.8 * cm, bottomMargin=1.6 * cm,
        title="Beakon Demo Runbook — Supplier Invoice E2E",
        author="Monirul",
    )
    S = _styles()
    story = []

    # ── Cover ─────────────────────────────────────────────────────────
    story.append(Paragraph(
        "End-to-End Demo Runbook",
        S["title"],
    ))
    story.append(Paragraph(
        "One supplier invoice, soup to nuts — every §9 Definition-of-Done "
        "item demonstrated against Thomas's <b>Accounting Engine Developer "
        "Instructions</b>.",
        S["subtitle"],
    ))

    meta_table = Table(
        [
            [Paragraph("<b>Audience</b>", S["cover_label"]),
             Paragraph("Thomas (founder + accounting authority)", S["body"])],
            [Paragraph("<b>Presenter</b>", S["cover_label"]),
             Paragraph("Monirul", S["body"])],
            [Paragraph("<b>Duration</b>", S["cover_label"]),
             Paragraph("~10 minutes (excluding pre-flight)", S["body"])],
            [Paragraph("<b>Anchor doc</b>", S["cover_label"]),
             Paragraph("D:/Thomas/Accounting_Engine_Developer_Instructions.docx — bring a printed copy and tick §9 items as you go.",
                       S["body"])],
            [Paragraph("<b>Goal</b>", S["cover_label"]),
             Paragraph("Get Thomas's sign-off that the engine MVP is complete against his §9 list, before any UI / AI work scales.",
                       S["body"])],
        ],
        colWidths=[3.5 * cm, 13.5 * cm],
    )
    meta_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 0.6 * cm))

    # ── Pre-flight ─────────────────────────────────────────────────────
    story.append(Paragraph("Pre-flight (15 minutes before Thomas arrives)", S["h1"]))
    story.append(Paragraph(
        "Run through this checklist. If anything fails, fix it BEFORE the meeting.",
        S["body"],
    ))

    pf_servers = [
        "Django backend running:&nbsp; <font face='Courier'>venv\\Scripts\\python.exe manage.py runserver</font>",
        "Next.js frontend running:&nbsp; <font face='Courier'>cd frontend &amp;&amp; npm run dev</font>",
        "Two browser windows side-by-side: <b>Window 1 (Alice)</b> on Dashboard, <b>Window 2 (Bob)</b> on /dashboard/approvals",
    ]
    pf_data = [
        "Organization seeded; Entity <b>HOLDCO</b> active (USD functional)",
        "April 2026 period status = <b>Open</b>",
        "Accounts active: 1010 Bank, 1200 AR, 1210 Input VAT, 2010 AP, 2200 VAT Payable, 4000 Revenue, 6000 Expenses",
        "Vendor <b>STAPLES</b> exists",
        "Counterparty with <font face='Courier'>counterparty_id=\"STAPLES\"</font> exists (so CP dimension auto-derives)",
        "At least one of each — bill, invoice, JE — already in pending state, so the Approvals queue looks populated",
    ]
    pf_planb = [
        "Plan B terminal cued up:",
    ]

    story.append(Paragraph("<b>Servers &amp; browsers</b>", S["h2"]))
    for line in pf_servers:
        story.append(_checkbox(line, S))
    story.append(Spacer(1, 0.2 * cm))

    story.append(Paragraph("<b>Data primed</b>", S["h2"]))
    for line in pf_data:
        story.append(_checkbox(line, S))
    story.append(Spacer(1, 0.2 * cm))

    story.append(Paragraph("<b>Plan B — if UI breaks live</b>", S["h2"]))
    for line in pf_planb:
        story.append(_checkbox(line, S))
    story.append(Preformatted(
        '$env:PYTHONIOENCODING="utf-8"\n'
        'D:\\bookkeeper\\venv\\Scripts\\python.exe D:\\bookkeeper\\beakon_core\\smoketest.py',
        S["mono"],
    ))
    story.append(Paragraph(
        "<b>Print Thomas's Accounting Engine doc</b>. Bring a pen. "
        "Tick §9 items on his own paper as you demonstrate them — "
        "this is the single most persuasive habit.",
        S["body"],
    ))

    story.append(PageBreak())

    # ── The 8-step script ─────────────────────────────────────────────
    story.append(Paragraph("The 10-minute script", S["h1"]))
    story.append(Paragraph(
        "Project your screen. Open Thomas's Word doc on the side. Walk "
        "through the steps in order — you can read directly from this page.",
        S["body"],
    ))

    _step(
        story, S, num=0, title="Frame it",
        time_est="30 sec",
        do=[],
        say=("Thomas, this is your spec — §9 Definition of Done, ten items. "
             "I'll demonstrate each one with one bill, end to end. Stop me at any point."),
        ticks="(opens the conversation)",
    )

    _step(
        story, S, num=1, title="Alice creates the bill",
        time_est="90 sec",
        do=[
            "<b>Window 1 (Alice).</b> Sidebar → Operations → <b>Bills</b> → click <b>New Bill</b>.",
            "Vendor: <b>STAPLES</b>",
            "Date: today's demo date in April 2026",
            "Line: account <b>6000</b>, description \"April office supplies\", amount <b>125.00</b>",
            "Click <b>Save as Draft</b> → then <b>Submit for approval</b>.",
        ],
        say=("§9-1: a user enters a transaction. §9-2: the engine identified the right "
             "Chart of Accounts — vendor's default expense account 6000 and the "
             "entity's AP account 2010. §9-3: it has already drafted the debit and "
             "credit suggestion behind the scenes."),
        ticks="§9 items 1, 2, 3",
    )

    _step(
        story, S, num=2, title="Bob sees it in the unified queue",
        time_est="30 sec",
        do=[
            "<b>Window 2 (Bob).</b> Sidebar → Books → <b>Approvals</b>.",
            "Point at the row with the <b>Bill</b> type pill.",
            "Click on the bill reference (e.g. <font face='Courier'>BILL-000004</font>) — show the detail with suggested DR 6000 / CR 2010.",
        ],
        say=("This is your §3 step 4 — the bookkeeper review screen. Bills, "
             "invoices, and journal entries all flow into ONE inbox. Type pill, "
             "aging column, vendor, total. Bob doesn't need to look in three "
             "different places."),
        ticks="§9 item 4",
    )

    _step(
        story, S, num=3, title="Bob approves — engine validates and posts",
        time_est="60 sec",
        do=[
            "Back to Approvals. Click <b>Approve</b> on the bill row.",
            "Sidebar → Books → <b>Journal Entries</b>. Filter status = posted. Open the newest JE.",
            "Show: DR 6000 125.00 / CR 2010 125.00 — and the <b>CP: STAPLES</b> tag on every line.",
        ],
        say=("Three things just happened atomically. One — the engine ran every "
             "validation rule: debits = credits, accounts active, period open, "
             "dimensions present. Two — it auto-tagged the AP line with the "
             "Counterparty dimension because the vendor IS the counterparty. "
             "Three — it posted the accrual journal entry. Look — "
             "'CP: STAPLES' tagged on every line. That's "
             "09_Dimension_Validation_Rules from your workbook running live."),
        ticks="§9 items 5, 6, 7",
    )

    _step(
        story, S, num=4, title="Show validation refusing (most persuasive 90s)",
        time_est="90 sec",
        do=[
            "<b>(a) Closed period:</b> Sidebar → Books → <b>Period Close</b> → flip April to <b>Closed</b>. Try to create a new bill in April. Engine refuses: <font face='Courier'>BK004 Period April 2026 is closed</font>. Reopen.",
            "<b>(b) Inactive account:</b> Sidebar → Books → <b>Chart of Accounts</b> → temporarily deactivate <b>6000</b>. Try to use it. Refusal: <font face='Courier'>BK003 Account 6000 is inactive</font>. Reactivate.",
            "<b>(c) Unbalanced:</b> New JE → DR 100 / CR 90 → Submit. Refusal: <font face='Courier'>BK001 Journal entry does not balance</font>.",
            "<b>(d) Self-approval:</b> Have Alice submit a JE, then Alice tries to approve. Refusal: <font face='Courier'>BK016 The submitter cannot approve their own entry</font>.",
        ],
        say=("Every §4 hard rule — debits = credits, accounts active, account in "
             "CoA, period open, immutable after posting, separation of duties — "
             "refuses bad data at the engine level, not just in the UI. "
             "This is what makes it auditable."),
        ticks="§4 entire section",
    )

    _step(
        story, S, num=5, title="Pay the bill — chains to the next transaction type",
        time_est="45 sec",
        do=[
            "Back to Bills. The bill is now status = <b>approved</b>. Click <b>Mark Paid</b>.",
            "Bank: 1010 · Date: today · Reference: \"WIRE-1001\"",
            "Bill flips to paid. Open the new payment JE — DR 2010 / CR 1010 for 125.00.",
        ],
        say=("DR 2010 / CR 1010 — supplier payment is rule 3 of your §3 step 3 list. "
             "Same engine, different transaction type, posted automatically. "
             "Rule 1 was the bill we just approved. Rule 2 customer invoice, "
             "rule 4 customer receipt, rule 5 bank charge — all of them work the "
             "same way; we'll skip them in the interest of time."),
        ticks="§3 step 3 rules 1 + 3",
    )

    _step(
        story, S, num=6, title="The §6 test ladder",
        time_est="90 sec",
        do=[
            "Switch to Plan B terminal.",
            "Run: <font face='Courier'>$env:PYTHONIOENCODING=\"utf-8\"; D:\\bookkeeper\\venv\\Scripts\\python.exe D:\\bookkeeper\\beakon_core\\smoketest.py</font>",
            "38 scenarios scroll past in ~10 seconds, ending: <font face='Courier'>OK: kernel smoke test passed — rolling back.</font>",
        ],
        say=("Your §6 says first 5, then 10, then 15 transactions. Let me prove "
             "all three pass at once. That's 38 scenarios covering all 20 "
             "auto-drafted transaction types — bills, invoices, payments, "
             "receipts, bank charges, transfers, interest, capital, credit "
             "notes, VAT remittance, loans, capital calls, properties, "
             "insurance — plus FX revaluation, intercompany, period close, "
             "recognition, dimension validation. Every entry balanced, "
             "every audit trail recorded."),
        ticks="§6 testing approach · §9 items 8, 9",
    )

    _step(
        story, S, num=7, title="Audit trail and reports",
        time_est="60 sec",
        do=[
            "Sidebar → Books → <b>Audit Log</b>. Filter today.",
            "Show: every action with user, timestamp, from-status → to-status.",
            "Sidebar → Books → <b>Financials</b>. Show the trial balance — debits = credits.",
            "Click a number to drill back to the JE; click again to drill back to the source document.",
        ],
        say=("§8 audit trail. Every action — created, submitted, approved, "
             "posted, reversed — by user, by timestamp. §9-10: reports read "
             "approved ledger data only. The bill we just booked is here. "
             "Drill all the way back to the source document. End to end, fully "
             "auditable."),
        ticks="§8 · §9 item 10",
    )

    _step(
        story, S, num=8, title="Close the loop",
        time_est="15 sec",
        do=[
            "Pick up Thomas's printed Word doc. Hold it up. Point at §9.",
        ],
        say=("Ten items, ten ticks. The accounting engine works against your "
             "own definition of done. Before we move to dashboards or AI "
             "features, I want your sign-off on this gate."),
        ticks="(closes the conversation)",
    )

    story.append(PageBreak())

    # ── §9 ticklist as a printable scorecard ─────────────────────────
    story.append(Paragraph("§9 Definition of Done — live ticklist", S["h1"]))
    story.append(Paragraph(
        "Tick on this page as you demonstrate. Hand to Thomas at the end — "
        "the visible record of what you proved is half the persuasion.",
        S["body"],
    ))
    tick_data = [
        ["#", "Definition-of-Done item", "Demonstrated in step", "Ticked?"],
        ["1", "User can enter a transaction", "Step 1 — Bills page", "☐"],
        ["2", "System auto-suggests Dr/Cr", "Step 1 → Step 2", "☐"],
        ["3", "Correct CoA used", "Step 2 — detail screen", "☐"],
        ["4", "Bookkeeper can approve", "Step 3 — Approvals", "☐"],
        ["5", "Approved entry posted to ledger", "Step 3 — Journal Entries", "☐"],
        ["6", "Debit always equals credit", "Steps 3 + 4", "☐"],
        ["7", "Audit trail saved", "Step 7 — Audit Log", "☐"],
        ["8", "First 5 transaction tests pass", "Step 6 — smoketest", "☐"],
        ["9", "10 / 15 transaction tests also pass", "Step 6 — 38 scenarios", "☐"],
        ["10", "Reports read approved ledger only", "Step 7 — Trial Balance", "☐"],
    ]
    body_style = S["body"]
    wrapped = [[Paragraph(c, body_style) for c in row] for row in tick_data]
    tick_table = Table(
        wrapped,
        colWidths=[1.0 * cm, 7.5 * cm, 6.5 * cm, 2.0 * cm],
        repeatRows=1,
    )
    tick_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3A5F")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (3, 0), (3, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9AA8B7")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#F4F7FA")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tick_table)
    story.append(Spacer(1, 0.4 * cm))

    # ── §3 step 3 transaction-type ticklist ──────────────────────────
    story.append(Paragraph("§3 step 3 — five transaction types", S["h2"]))
    story.append(Paragraph(
        "Thomas named five types in §3 step 3. The demo lands two (1 + 3) by "
        "design; mention the others by name and offer to show any of them on "
        "request.",
        S["body"],
    ))
    txn_data = [
        ["#", "Transaction type", "DR / CR", "Demo'd?"],
        ["1", "Supplier invoice", "DR Expense / CR AP", "☐ (Step 1–3)"],
        ["2", "Customer invoice", "DR AR / CR Revenue", "☐ (offer on demand)"],
        ["3", "Supplier payment", "DR AP / CR Bank", "☐ (Step 5)"],
        ["4", "Customer receipt", "DR Bank / CR AR", "☐ (offer on demand)"],
        ["5", "Bank charge", "DR Bank Charges / CR Bank", "☐ (offer on demand)"],
    ]
    wrapped2 = [[Paragraph(c, body_style) for c in row] for row in txn_data]
    t2 = Table(
        wrapped2,
        colWidths=[1.0 * cm, 4.5 * cm, 6.0 * cm, 5.5 * cm],
        repeatRows=1,
    )
    t2.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3A5F")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9AA8B7")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#F4F7FA")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t2)

    story.append(PageBreak())

    # ── Q&A prep ─────────────────────────────────────────────────────
    story.append(Paragraph("Likely Thomas questions — prepared answers", S["h1"]))
    qa = [
        ("\"What if the vendor isn't a counterparty?\"",
         "The engine refuses — exactly what your <b>09_Dimension_Validation_Rules</b> "
         "says it should. We saw that earlier this week and I added auto-derivation: "
         "if the vendor code matches a Counterparty master row, the CP dimension "
         "is stamped automatically. If no match, the engine refuses to post until "
         "the master row is created. Strict by design."),
        ("\"Can two people approve and post — true 4-eyes?\"",
         "Yes, optional per entity. There's a <font face='Courier'>"
         "four_eyes_posting_required</font> flag on Entity. When on, the post step "
         "is blocked if the same person approved. Default off — tell me which "
         "entities you want it on."),
        ("\"What about VAT?\"",
         "Demo'd in scenario 21 of the smoketest — Swiss 8.1%, accrual JE has "
         "Input VAT correctly split, VAT report aggregates by tax code, then "
         "<font face='Courier'>VATRemittanceService</font> settles it to the bank "
         "when paid. Three transaction types, fully wired."),
        ("\"Multi-currency? Intercompany?\"",
         "Both are in scenarios 1 and 10–11 of the smoketest. EUR receipt into a "
         "USD entity converts at the FX rate on the JE date and balances in "
         "functional currency. Intercompany groups must net to zero in a common "
         "reporting currency before any leg can post — that's an engine refusal "
         "if amounts don't reconcile."),
        ("\"What's missing?\"",
         "Three subledger modules need your sign-off before I build them — "
         "Fixed Assets, Payroll, and Portfolio trading with FIFO/LIFO. Each "
         "needs you to add a master tab to the workbook first, or confirm a "
         "policy choice. They're in the workflow-request doc I sent you. The "
         "day-to-day operating cycle is done — 20 transaction types auto-drafted."),
        ("\"Did the architecture or workbook change?\"",
         "Zero. Everything fits inside Layer 4 (Accounting Engine) using the "
         "dimensions and masters you already designed. No new tabs, no new "
         "layers, no new dimension types."),
    ]
    for q, a in qa:
        story.append(Paragraph(f"<b>{q}</b>", S["h2"]))
        story.append(Paragraph(a, S["body"]))

    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph("If something breaks live", S["h1"]))
    for line in [
        "<b>UI breaks</b> → run the smoketest. 38 green scenarios is a stronger argument than any UI demo.",
        "<b>Data missing</b> → don't apologise more than once. Run smoketest, point at green output: <i>“The engine works. The seed data is incomplete; I'll have it fixed by tomorrow.”</i>",
        "<b>Network / auth issue</b> → run the smoketest.",
    ]:
        story.append(Paragraph("• " + line, S["bullet"]))
    story.append(Paragraph(
        "<b>The smoketest is your floor.</b> Whatever happens above it, the "
        "engine is provably correct underneath.",
        S["body"],
    ))

    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph("Practice run — 30 minutes today", S["h1"]))
    for line in [
        "Alice and Bob credentials work in two browsers",
        "Bills page → Submit button doesn't error (most common live failure)",
        "Approvals page shows a Bill row when one is pending",
        "Mark Paid button works on an approved bill",
        "Smoketest exits clean",
    ]:
        story.append(_checkbox(line, S))
    story.append(Paragraph(
        "Anything that fails on the practice run, fix it BEFORE Thomas arrives — not during.",
        S["body"],
    ))

    doc.build(story)
    print(f"Wrote: {OUT}")


if __name__ == "__main__":
    build()
