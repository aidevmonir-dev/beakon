"""Generate the Thomas family-office demo runbook PDF.

End-to-end live demo for Thomas — proving the accounting engine works
for HIS five family entities, with a workflow diagram, the data model,
benefits framing, and step-by-step click-through script.
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
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
OUT = ROOT / "docs" / "blueprint" / "thomas_family_demo_runbook.pdf"


# ── Style palette ───────────────────────────────────────────────────────
NAVY = colors.HexColor("#0E2A47")
ACCENT = colors.HexColor("#1F3A5F")
MUTED = colors.HexColor("#5B6B7C")
SOFT = colors.HexColor("#F4F7FA")
GREEN = colors.HexColor("#0F7B3F")
AMBER = colors.HexColor("#A66C00")
RED = colors.HexColor("#9B1C1C")
SKY = colors.HexColor("#075985")


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "T", parent=base["Title"], fontName="Helvetica-Bold",
            fontSize=22, textColor=NAVY, alignment=TA_LEFT, spaceAfter=4,
        ),
        "subtitle": ParagraphStyle(
            "ST", parent=base["BodyText"], fontName="Helvetica",
            fontSize=12, textColor=MUTED, leading=16, spaceAfter=14,
        ),
        "h1": ParagraphStyle(
            "H1", parent=base["Heading1"], fontName="Helvetica-Bold",
            fontSize=15, textColor=ACCENT, spaceBefore=14, spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "H2", parent=base["Heading2"], fontName="Helvetica-Bold",
            fontSize=12, textColor=ACCENT, spaceBefore=8, spaceAfter=4,
        ),
        "h3": ParagraphStyle(
            "H3", parent=base["Heading3"], fontName="Helvetica-Bold",
            fontSize=11, textColor=NAVY, spaceBefore=6, spaceAfter=3,
        ),
        "step": ParagraphStyle(
            "Step", parent=base["Heading2"], fontName="Helvetica-Bold",
            fontSize=12, textColor=NAVY, spaceBefore=10, spaceAfter=3,
        ),
        "body": ParagraphStyle(
            "Body", parent=base["BodyText"], fontName="Helvetica",
            fontSize=10.5, leading=14, spaceAfter=4,
        ),
        "say": ParagraphStyle(
            "Say", parent=base["BodyText"], fontName="Helvetica-Oblique",
            fontSize=10.5, leading=14, textColor=NAVY,
            leftIndent=10, spaceAfter=6, borderPadding=4,
        ),
        "tick": ParagraphStyle(
            "Tick", parent=base["BodyText"], fontName="Helvetica-Bold",
            fontSize=10, textColor=GREEN, spaceAfter=8,
        ),
        "bullet": ParagraphStyle(
            "B", parent=base["BodyText"], fontName="Helvetica",
            fontSize=10.5, leading=14, leftIndent=14, bulletIndent=2,
            spaceAfter=2,
        ),
        "mono": ParagraphStyle(
            "M", parent=base["BodyText"], fontName="Courier",
            fontSize=9, leading=12, spaceAfter=4,
        ),
        "label": ParagraphStyle(
            "L", parent=base["BodyText"], fontName="Helvetica",
            fontSize=10, textColor=MUTED, spaceAfter=2,
        ),
        "box_title": ParagraphStyle(
            "BT", parent=base["BodyText"], fontName="Helvetica-Bold",
            fontSize=10, textColor=NAVY, alignment=TA_CENTER, leading=13,
        ),
        "box_body": ParagraphStyle(
            "BB", parent=base["BodyText"], fontName="Helvetica",
            fontSize=8.5, textColor=MUTED, alignment=TA_CENTER, leading=11,
        ),
        "arrow": ParagraphStyle(
            "Ar", parent=base["BodyText"], fontName="Helvetica-Bold",
            fontSize=14, textColor=ACCENT, alignment=TA_CENTER,
            leading=14, spaceAfter=2, spaceBefore=2,
        ),
    }


def _check(label: str, S) -> Paragraph:
    return Paragraph(f"☐ &nbsp;&nbsp;{label}", S["bullet"])


def _flow_box(title: str, body: str, fill: str, S) -> Table:
    """One horizontal row of the workflow chart."""
    inner = Table(
        [[Paragraph(f"<b>{title}</b>", S["box_title"])],
         [Paragraph(body, S["box_body"])]],
        colWidths=[10 * cm],
    )
    inner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(fill)),
        ("BOX", (0, 0), (-1, -1), 0.6, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return inner


def _arrow(S) -> Paragraph:
    return Paragraph("↓", S["arrow"])


def _step(story, S, *, num: int, title: str, time_est: str,
          do: list[str], say: str | None, ticks: str) -> None:
    story.append(Paragraph(
        f"Step {num} · {title} <font color='#5B6B7C' size='9'>"
        f"({time_est})</font>", S["step"]))
    for line in do:
        story.append(Paragraph(line, S["bullet"]))
    if say:
        story.append(Spacer(1, 0.1 * cm))
        story.append(Paragraph(f"Say: <i>“{say}”</i>", S["say"]))
    story.append(Paragraph(f"✅ Ticks: {ticks}", S["tick"]))


# ─────────────────────────────────────────────────────────────────────────
def build():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUT), pagesize=A4,
        leftMargin=1.8 * cm, rightMargin=1.8 * cm,
        topMargin=1.6 * cm, bottomMargin=1.5 * cm,
        title="Beakon · Thomas Family-Office Demo Runbook",
        author="Monirul",
    )
    S = _styles()
    story = []

    # ════════════════════════════════════════════════════════════════════
    # PAGE 1 — Cover
    # ════════════════════════════════════════════════════════════════════
    story.append(Paragraph("Beakon · End-to-End Live Demo", S["title"]))
    story.append(Paragraph(
        "Proving the accounting engine works for the Thomas family office "
        "— five entities, one platform, every §9 Definition-of-Done item "
        "demonstrated live.",
        S["subtitle"],
    ))

    cover = Table(
        [
            [Paragraph("<b>Audience</b>", S["label"]),
             Paragraph("Thomas — founder, accounting authority, family-office head", S["body"])],
            [Paragraph("<b>Presenter</b>", S["label"]),
             Paragraph("Monirul (technical executor)", S["body"])],
            [Paragraph("<b>Duration</b>", S["label"]),
             Paragraph("~10 minutes (excluding pre-flight)", S["body"])],
            [Paragraph("<b>Goal</b>", S["label"]),
             Paragraph("Get sign-off that the engine MVP is complete against "
                       "Thomas's §9 Definition of Done — before any "
                       "dashboards, AI, or reporting work scales.",
                       S["body"])],
            [Paragraph("<b>Anchor docs</b>", S["label"]),
             Paragraph(
                 "<font face='Courier'>D:/Thomas/Accounting_Engine_Developer_Instructions.docx</font><br/>"
                 "<font face='Courier'>D:/Thomas/2026 04 17-Beakon Founder Working Paper.pdf</font><br/>"
                 "<font face='Courier'>D:/Thomas/2026 04 30-Beakon-Architecture.pdf</font><br/>"
                 "<font face='Courier'>D:/Thomas/2026 04 17-DRAFT-CoA-Wealth management v2.xlsx</font>",
                 S["body"])],
            [Paragraph("<b>Demo scope</b>", S["label"]),
             Paragraph("One supplier bill, soup to nuts: created → approved "
                       "→ posted → paid → reported. All five Thomas-family "
                       "entities exist in the system; the demo posts to one "
                       "of them and shows how the others would behave the "
                       "same way.",
                       S["body"])],
        ],
        colWidths=[3.2 * cm, 13.8 * cm],
    )
    cover.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(cover)

    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph(
        "<b>How to use this document:</b> read top-to-bottom, click-by-click. "
        "Print and bring a pen — tick each ☐ as you complete it. Hand the §9 "
        "ticklist page to Thomas at the end with all 10 boxes checked.",
        S["body"],
    ))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════
    # PAGE 2 — Why Beakon for the Thomas Family
    # ════════════════════════════════════════════════════════════════════
    story.append(Paragraph("1. Why Beakon for the Thomas family", S["h1"]))
    story.append(Paragraph(
        "The Thomas family office runs five legal units. Today each typically "
        "lives in its own spreadsheet or accounting tool — meaning manual "
        "reconciliation, duplicated vendors, no consolidated view, and no "
        "audit trail across the family. Beakon collapses all five into a "
        "single platform without losing entity-level integrity.",
        S["body"],
    ))

    benefits = [
        ("One source of truth",
         "All 5 entities — Holdings, Trust, Mr Personal, Mrs Personal, "
         "Foundation — kept in one platform. No more reconciling between 5 "
         "Excel files at year-end."),
        ("Shared masters, separate books",
         "One Swisscom record bills any of the 5 entities. The Trust and Mr "
         "Personal can both pay UBS without duplicating the vendor or the "
         "counterparty record."),
        ("Multi-entity reporting",
         "Trial balance and P&amp;L per entity, AND consolidated across the "
         "family. \"How much did the family spend on Swisscom across all 5 "
         "entities last quarter?\" — one query."),
        ("Inter-entity transactions auto-balance",
         "When the Trust loans Mr Thomas cash, both legs post automatically "
         "and the engine refuses to commit unless they net to zero in a "
         "common reporting currency."),
        ("Dimension tracking — beyond just GL",
         "Every posting carries multi-dimensional tags: which family member, "
         "which property, which portfolio, which counterparty. Enables "
         "questions like \"how much did Mr Thomas spend on Property A this "
         "year?\" with no extra bookkeeping work."),
        ("Per-entity period close",
         "Close April for the Trust while leaving May open for Mr Personal. "
         "Each entity controls its own period state — no global lockout."),
        ("Multi-currency, native",
         "Mrs Personal holds USD, the Foundation holds CHF, the Trust holds "
         "EUR — Beakon converts all of them to a common reporting currency "
         "using FX rates on the JE date. Period-end revaluation is automatic."),
        ("Controlled — not a black-box AI",
         "AI proposes; humans approve; the engine validates. Nothing posts "
         "without passing every rule and a human approval. Auditable from "
         "day one."),
        ("Designed for what comes next",
         "Payroll, fixed-asset registers, portfolio trading, and IC "
         "eliminations are scoped for Phase 2 — they slot into the same "
         "engine without re-architecting."),
    ]
    rows = [
        [Paragraph(f"<b>{title}</b>", S["body"]),
         Paragraph(body, S["body"])]
        for title, body in benefits
    ]
    bt = Table(rows, colWidths=[4.5 * cm, 12.5 * cm])
    bt.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#D5DCE4")),
    ]))
    story.append(bt)

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════
    # PAGE 3 — The 5-entity structure
    # ════════════════════════════════════════════════════════════════════
    story.append(Paragraph("2. The Thomas family-office structure", S["h1"]))
    story.append(Paragraph(
        "Five legal units, all owned by the family. Holdings is the parent; "
        "the other four are children of Holdings. Each entity has its own "
        "books, its own currency, its own period control.",
        S["body"],
    ))

    # Tree diagram in monospace
    tree = (
        "THOMAS-HOLD       Thomas Holdings Ltd      (root — holding company)\n"
        "│\n"
        "├── THOMAS-TRUST  Thomas Family Trust      (trust)\n"
        "├── THOMAS-MR     Mr. Thomas Personal      (individual)\n"
        "├── THOMAS-MRS    Mrs. Thomas Personal     (individual)\n"
        "└── THOMAS-FOUND  Thomas Foundation        (foundation)"
    )
    story.append(Preformatted(tree, S["mono"]))

    story.append(Spacer(1, 0.3 * cm))
    ent_data = [
        ["Entity", "Type", "What it does", "Currency"],
        ["THOMAS-HOLD", "Holding co.",
         "Owns the operating businesses, holds family wealth, files corporate taxes.", "USD"],
        ["THOMAS-TRUST", "Trust",
         "Holds long-term assets — real estate, dynasty trust assets, family heirlooms.", "USD"],
        ["THOMAS-MR", "Individual",
         "Mr Thomas's personal balance sheet — salary, bank accounts, allocated family expenses.", "USD"],
        ["THOMAS-MRS", "Individual",
         "Mrs Thomas's personal balance sheet — same shape on the spouse side.", "USD"],
        ["THOMAS-FOUND", "Foundation",
         "Charitable arm — donations received, grants made, board governance.", "USD"],
    ]
    wrapped = [[Paragraph(c, S["body"]) for c in row] for row in ent_data]
    et = Table(wrapped, colWidths=[3.0 * cm, 2.5 * cm, 9.0 * cm, 2.5 * cm], repeatRows=1)
    et.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9AA8B7")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(et)

    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph(
        "<b>Each entity has its own May 2026 period open in the system.</b> "
        "Posting to one entity does not touch the other four. Consolidation "
        "happens at reporting time, not at transaction time.",
        S["body"],
    ))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════
    # PAGE 4 — Data model: Entity vs Vendor vs Customer
    # ════════════════════════════════════════════════════════════════════
    story.append(Paragraph(
        "3. Data model — Entity, Vendor, Customer, Counterparty", S["h1"]))
    story.append(Paragraph(
        "<b>Entity = \"us\"</b> (one of our own books). "
        "<b>Vendor / Customer = \"them\"</b> (an external party). "
        "Every transaction binds an Entity to a Vendor (AP) or Customer (AR).",
        S["body"],
    ))

    tree2 = (
        "                        Beakon Organization\n"
        "                                │\n"
        "        ┌───────────────────────┼────────────────────────┐\n"
        "        │                       │                        │\n"
        "    Entities                 Vendors                  Customers\n"
        "    (our books)             (we buy)                 (we sell)\n"
        "        │                       │                        │\n"
        "  THOMAS-HOLD               Swisscom                  Globex\n"
        "  THOMAS-TRUST              ACME Supplies             Interactive Brokers\n"
        "  THOMAS-MR                 …                         …\n"
        "  THOMAS-MRS\n"
        "  THOMAS-FOUND\n"
        "        │                       │                        │\n"
        "        └─────── Bill ──────────┘                        │\n"
        "        │                                                │\n"
        "        └─────── Invoice ───────────────────────────────┘"
    )
    story.append(Preformatted(tree2, S["mono"]))

    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(
        "<b>Counterparty</b> is the workbook tab-10 governed master record — "
        "the canonical \"who\" of every external party. The CP dimension on "
        "every JE points to a Counterparty. Vendor and Customer are simpler "
        "AP/AR-tracking records; the engine auto-derives the Counterparty FK "
        "by matching <font face='Courier'>vendor.code = counterparty.counterparty_id</font>.",
        S["body"],
    ))

    story.append(Spacer(1, 0.2 * cm))
    story.append(Paragraph("Worked example with the Thomas family", S["h2"]))
    story.append(Paragraph(
        "Mr Thomas (THOMAS-MR) receives a Swisscom telecom bill for USD 125. "
        "What gets recorded:",
        S["body"],
    ))
    ex_data = [
        ["Field", "Value", "Why"],
        ["Entity", "THOMAS-MR", "Whose books this hits — Mr Thomas's personal balance sheet"],
        ["Vendor", "CP_VENDOR_001 · Swisscom AG", "Who we owe (AP side)"],
        ["Counterparty (auto)", "CP_VENDOR_001 · Swisscom AG", "CP dimension — same code, auto-derived"],
        ["DR", "6000 Operating Expenses · 125.00 USD", "Where the cost lives"],
        ["CR", "2010 Accounts Payable · 125.00 USD", "Liability we now owe"],
        ["Period", "May 2026 (open)", "When the cost is recognised"],
        ["Status", "draft → pending → approved → posted", "State machine — every step audited"],
    ]
    wrapped = [[Paragraph(c, S["body"]) for c in row] for row in ex_data]
    ext = Table(wrapped, colWidths=[3.2 * cm, 6.5 * cm, 7.3 * cm], repeatRows=1)
    ext.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9AA8B7")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(ext)

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════
    # PAGE 5 — Engine workflow diagram
    # ════════════════════════════════════════════════════════════════════
    story.append(Paragraph("4. The engine workflow — bill to ledger", S["h1"]))
    story.append(Paragraph(
        "How a single supplier bill flows through Beakon's 16-layer "
        "architecture. Every step is automatic except the two human gates "
        "(create, approve). The engine validates at every transition and "
        "refuses to post anything that violates a rule.",
        S["body"],
    ))

    flow = [
        ("Layer 2 · Data Intake",
         "Source document arrives — invoice PDF, vendor email, bank feed",
         "#E5E7EB"),
        ("Layer 3 · Document Intelligence",
         "OCR + classify (vendor, amount, VAT, currency, due date)",
         "#DBEAFE"),
        ("Layer 8 · AI Assistance",
         "Engine drafts suggested DR Expense / CR AP using vendor defaults",
         "#FEF3C7"),
        ("Bill — DRAFT",
         "Alice (preparer) sees the proposal, can edit lines, save as draft",
         "#FEF3C7"),
        ("Bill — PENDING APPROVAL",
         "Alice clicks Submit; bill enters Bob's approval queue",
         "#FEF3C7"),
        ("Layer 9 · Workflow + Approval",
         "Bob reviews suggested Dr/Cr. Self-approval blocked. 4-eyes optional.",
         "#FCE7F3"),
        ("Layer 4 · Engine validation",
         "Balance · accounts active · period open · dimensions present · CP auto-derived",
         "#DCFCE7"),
        ("JE auto-created, auto-posted",
         "DR Expense 125 / CR AP 125. CP dimension stamped on every line.",
         "#DCFCE7"),
        ("Bill — APPROVED · accrual JE POSTED",
         "Approval action logged. JE locked from edit. Reversible only.",
         "#DCFCE7"),
        ("Mark Paid (when cash leaves)",
         "Pick bank account + date → DR AP / CR Bank → second JE auto-posts",
         "#DCFCE7"),
        ("Layer 10 · Reporting",
         "Trial balance · P&L · drill-down to source document · audit trail",
         "#E0F2FE"),
    ]
    for title, body, fill in flow:
        story.append(_flow_box(title, body, fill, S))
        if (title, body, fill) is not flow[-1]:
            story.append(_arrow(S))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════
    # PAGE 6 — Pre-flight
    # ════════════════════════════════════════════════════════════════════
    story.append(Paragraph("5. Pre-flight (15 minutes before Thomas)", S["h1"]))
    story.append(Paragraph(
        "Run every checkbox below. If anything fails, fix it BEFORE the "
        "meeting — not during.",
        S["body"],
    ))

    story.append(Paragraph("Servers running", S["h2"]))
    story.append(_check(
        "Django backend running:&nbsp; "
        "<font face='Courier'>venv\\Scripts\\python.exe manage.py runserver</font>",
        S))
    story.append(_check(
        "Next.js frontend running:&nbsp; "
        "<font face='Courier'>cd frontend &amp;&amp; npm run dev</font>",
        S))
    story.append(_check(
        "Two browser windows side-by-side: "
        "<b>Window 1 (Alice — preparer)</b>, "
        "<b>Window 2 (Bob — approver)</b> on /dashboard/approvals",
        S))

    story.append(Paragraph("Data primed (all should already be set)", S["h2"]))
    for line in [
        "Organization seeded; <b>5 Thomas-family entities</b> all active",
        "<b>May 2026 period</b> open on every entity",
        "<b>2 vendors</b> active: <i>CP_VENDOR_001 Swisscom · DEMO-VENDOR ACME</i>",
        "<b>2 customers</b> active: <i>DEMO-CUSTOMER Globex · CP_BROKER_001 Interactive Brokers</i>",
        "Bills, invoices, and journal entries: <b>0</b> (clean slate from earlier wipe)",
        "Vendor <font face='Courier'>default_expense_account</font> backfilled to <b>6000 Operating Expenses</b> on all 28 vendors",
        "Counterparty rows match Vendor codes (so CP dimension auto-derives)",
    ]:
        story.append(_check(line, S))

    story.append(Paragraph("Plan B (if UI breaks live)", S["h2"]))
    story.append(_check("Plan B terminal cued up:", S))
    story.append(Preformatted(
        '$env:PYTHONIOENCODING="utf-8"\n'
        'D:\\bookkeeper\\venv\\Scripts\\python.exe D:\\bookkeeper\\beakon_core\\smoketest.py',
        S["mono"],
    ))
    story.append(Paragraph(
        "<b>The smoketest is your floor.</b> 38 scenarios covering 20 "
        "transaction types prove the engine works regardless of UI state. "
        "If anything fails live, switch to this terminal — Thomas trusts "
        "code more than browsers anyway.",
        S["body"],
    ))

    story.append(Paragraph("On the table", S["h2"]))
    for line in [
        "Printed copy of <b>Accounting_Engine_Developer_Instructions.docx</b> + a pen — tick §9 items as you demonstrate",
        "Printed copy of this runbook — read along, click along",
        "Glass of water (it's a 10-minute talk, you'll thank yourself)",
    ]:
        story.append(_check(line, S))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════
    # PAGES 7-8 — The 10-minute script
    # ════════════════════════════════════════════════════════════════════
    story.append(Paragraph("6. The 10-minute demo script", S["h1"]))
    story.append(Paragraph(
        "Read top-to-bottom. Each step has the click sequence and the "
        "verbatim line to deliver. Tick the §9 items as you go.",
        S["body"],
    ))

    _step(
        story, S, num=0, title="Frame the conversation",
        time_est="30 sec",
        do=["Project Window 1 (Alice). Open Thomas's printed Word doc beside you."],
        say=("Thomas, this is your spec — §9 Definition of Done, ten items. "
             "I'll demonstrate each one with one bill flowing through one of "
             "your five family entities, end to end. Stop me at any point."),
        ticks="(opens the conversation)",
    )

    _step(
        story, S, num=1, title="Alice creates the bill",
        time_est="90 sec",
        do=[
            "<b>Window 1 (Alice).</b> Sidebar → Operations → <b>Bills</b> → click <b>+ New Bill</b>.",
            "Entity: <b>THOMAS-HOLD · Thomas Holdings Ltd</b>",
            "Vendor: <b>CP_VENDOR_001 · Swisscom AG</b> &nbsp;<i>(currency + expense account auto-fill)</i>",
            "Date: today (defaults to today)",
            "Line amount: <b>125.00</b>; description: \"May office telecom\"",
            "Click <b>Create draft</b>, then on the row click <b>Submit for approval</b>.",
        ],
        say=("§9-1: a user enters a transaction — Mr Alice in the bookkeeping "
             "team. §9-2: the engine identified the right Chart of Accounts — "
             "vendor's default expense account 6000, the entity's AP account, "
             "currency from the vendor master. §9-3: the suggested debit and "
             "credit are already in place. Note this flowed into THOMAS-HOLD; "
             "the same bill could have been routed to Mr Personal or the "
             "Trust by changing one dropdown."),
        ticks="§9 items 1, 2, 3",
    )

    _step(
        story, S, num=2, title="Bob sees it in the unified queue",
        time_est="30 sec",
        do=[
            "<b>Window 2 (Bob).</b> Sidebar → Books → <b>Approvals</b>.",
            "Point at the row with the <b>Bill</b> type pill on it.",
            "Note: aging column, type pill, vendor name, total. Three types in one inbox.",
            "Click the bill reference (e.g. BILL-000001) — show suggested DR 6000 / CR AP.",
        ],
        say=("This is your §3 step 4 — the bookkeeper review screen. Bills, "
             "customer invoices, and journal entries all flow into ONE inbox. "
             "Bob doesn't need to open three different modules."),
        ticks="§9 item 4",
    )

    _step(
        story, S, num=3, title="Bob approves — engine validates and posts",
        time_est="60 sec",
        do=[
            "Back to Approvals. Click <b>Approve</b> on the bill row.",
            "Sidebar → Books → <b>Journal Entries</b>. Filter status = posted. Open the newest JE.",
            "Show: DR 6000 125 / CR AP 125. Hover any line — the CP dimension shows <i>CP_VENDOR_001 · Swisscom AG</i>.",
        ],
        say=("Three things happened atomically. One — the engine ran every "
             "validation: debits = credits, accounts active, period open, "
             "dimensions present. Two — it auto-tagged the AP line with the "
             "Counterparty dimension because the vendor IS the counterparty. "
             "Three — it posted the accrual JE to the ledger. That's "
             "09_Dimension_Validation_Rules from your workbook running live."),
        ticks="§9 items 5, 6, 7",
    )

    _step(
        story, S, num=4, title="Show validation refusing — most persuasive 90 seconds",
        time_est="90 sec",
        do=[
            "<b>(a) Closed period:</b> Sidebar → Period Close → flip THOMAS-HOLD May to <b>Closed</b>. "
            "Try a new bill in May. Refusal: <font face='Courier'>BK004 Period May 2026 is closed</font>. Reopen.",
            "<b>(b) Inactive account:</b> Sidebar → Chart of Accounts → temporarily deactivate <b>6000</b>. "
            "Try to use it. Refusal: <font face='Courier'>BK003 Account 6000 is inactive</font>. Reactivate.",
            "<b>(c) Unbalanced:</b> New JE → DR 100 / CR 90 → Submit. "
            "Refusal: <font face='Courier'>BK001 does not balance</font>.",
            "<b>(d) Self-approval:</b> Alice submits a JE, then Alice tries to approve it. "
            "Refusal: <font face='Courier'>BK016 The submitter cannot approve their own entry</font>.",
        ],
        say=("Every §4 hard rule — debits equal credits, accounts active, in "
             "CoA, period open, immutable after posting, separation of duties "
             "— refuses bad data at the engine level, not just in the UI. "
             "This is what makes the engine auditable for your fiduciary clients."),
        ticks="§4 entire section",
    )

    _step(
        story, S, num=5, title="Pay the bill — chains to the next transaction type",
        time_est="45 sec",
        do=[
            "Back to Bills. The bill is now status = <b>approved</b>. Click <b>Mark Paid</b>.",
            "Bank: 1010 Bank · Date: today · Reference: \"WIRE-1001\"",
            "Bill flips to <b>paid</b>. Open the new payment JE: DR AP / CR 1010 · 125.00.",
        ],
        say=("DR AP / CR Bank — supplier payment, rule 3 of your §3 step 3 "
             "list. Same engine, different transaction type, posted "
             "automatically because the bill was already approved. Rules 2 "
             "(customer invoice) and 4 (customer receipt) work the same way; "
             "I'll skip them in the interest of time but happy to demo on demand."),
        ticks="§3 step 3 rules 1 + 3",
    )

    story.append(PageBreak())

    # Steps 6-8
    _step(
        story, S, num=6, title="The §6 test ladder — 38 scenarios in 10 seconds",
        time_est="90 sec",
        do=[
            "Switch to the Plan B terminal.",
            "Run: <font face='Courier'>$env:PYTHONIOENCODING=\"utf-8\"; "
            "D:\\bookkeeper\\venv\\Scripts\\python.exe D:\\bookkeeper\\beakon_core\\smoketest.py</font>",
            "38 scenarios scroll past, ending: <font face='Courier'>OK: kernel smoke test passed — rolling back.</font>",
        ],
        say=("Your §6 says first 5, then 10, then 15 transactions. Let me "
             "prove all three pass at once. 38 scenarios cover all 20 "
             "auto-drafted transaction types — bills, invoices, payments, "
             "receipts, bank charges, transfers, interest, capital, credit "
             "notes, VAT remittance, loans, capital calls, properties, "
             "insurance — plus FX revaluation, intercompany, period close, "
             "recognition, dimension validation. Every entry balanced, "
             "every audit trail recorded, all in one transaction the engine "
             "rolls back when done."),
        ticks="§6 testing approach · §9 items 8, 9",
    )

    _step(
        story, S, num=7, title="Audit trail and reports",
        time_est="60 sec",
        do=[
            "Sidebar → Books → <b>Audit Log</b>. Filter today.",
            "Show every action — created, submitted, approved, posted — by user, by timestamp.",
            "Sidebar → Books → <b>Financials</b>. Trial balance for THOMAS-HOLD — debits = credits.",
            "Click any number → drill back to the JE → drill back to the source document.",
        ],
        say=("§8 audit trail. Every action by user and timestamp. §9-10: "
             "reports read approved ledger data only. The bill we just booked "
             "is here. Drill from any number all the way back to the source. "
             "End to end, fully auditable. And critically — when you switch "
             "the entity filter to THOMAS-MR or THOMAS-FOUND, you see those "
             "entities' books separately. When you remove the filter, you "
             "see the consolidated view across all five."),
        ticks="§8 · §9 item 10",
    )

    _step(
        story, S, num=8, title="Close the loop",
        time_est="15 sec",
        do=[
            "Pick up Thomas's printed Word doc. Hold it up. Point at the §9 ticklist with all 10 ticks.",
            "Hand the printed §9 page to Thomas (next page in this runbook).",
        ],
        say=("Ten items, ten ticks. The accounting engine works against your "
             "own definition of done — across the five family entities, with "
             "every dimension your workbook requires. Before we move to "
             "dashboards or AI features, I want your sign-off on this gate."),
        ticks="(closes the conversation)",
    )

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════
    # PAGE 9 — §9 ticklist
    # ════════════════════════════════════════════════════════════════════
    story.append(Paragraph("7. §9 Definition of Done — live ticklist", S["h1"]))
    story.append(Paragraph(
        "Tick on this page as you demonstrate. Hand to Thomas at the end — "
        "the visible record of what you proved is half the persuasion.",
        S["body"],
    ))
    tick_data = [
        ["#", "Definition-of-Done item", "Demonstrated in step", "Ticked?"],
        ["1", "User can enter a transaction", "Step 1 — Bills page", "☐"],
        ["2", "System auto-suggests Dr/Cr", "Step 1 → Step 2", "☐"],
        ["3", "Correct CoA used", "Step 2 — bill detail", "☐"],
        ["4", "Bookkeeper can approve", "Step 3 — Approvals", "☐"],
        ["5", "Approved entry posted to ledger", "Step 3 — Journal Entries", "☐"],
        ["6", "Debit always equals credit", "Steps 3 + 4", "☐"],
        ["7", "Audit trail saved", "Step 7 — Audit Log", "☐"],
        ["8", "First 5 transaction tests pass", "Step 6 — smoketest", "☐"],
        ["9", "10 / 15 transaction tests also pass", "Step 6 — 38 scenarios", "☐"],
        ["10", "Reports read approved ledger only", "Step 7 — Trial Balance", "☐"],
    ]
    wrapped = [[Paragraph(c, S["body"]) for c in row] for row in tick_data]
    tt = Table(wrapped, colWidths=[1.0 * cm, 7.5 * cm, 6.5 * cm, 2.0 * cm], repeatRows=1)
    tt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (3, 0), (3, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9AA8B7")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tt)

    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph(
        "§3 step 3 — five transaction types Thomas listed", S["h2"]))
    txn_data = [
        ["#", "Transaction type", "DR / CR", "Demo'd?"],
        ["1", "Supplier invoice", "DR Expense / CR AP", "☐ (Step 1–3)"],
        ["2", "Customer invoice", "DR AR / CR Revenue", "☐ (offer on demand)"],
        ["3", "Supplier payment", "DR AP / CR Bank", "☐ (Step 5)"],
        ["4", "Customer receipt", "DR Bank / CR AR", "☐ (offer on demand)"],
        ["5", "Bank charge", "DR Bank Charges / CR Bank", "☐ (offer on demand)"],
    ]
    wrapped = [[Paragraph(c, S["body"]) for c in row] for row in txn_data]
    tt2 = Table(wrapped, colWidths=[1.0 * cm, 4.5 * cm, 6.0 * cm, 5.5 * cm], repeatRows=1)
    tt2.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9AA8B7")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tt2)

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════
    # PAGE 10 — Q&A + Plan B
    # ════════════════════════════════════════════════════════════════════
    story.append(Paragraph("8. Likely Thomas questions — prepared answers", S["h1"]))
    qa = [
        ("\"What if the same vendor bills two of my entities?\"",
         "Same vendor record, different bill. Swisscom can bill THOMAS-HOLD "
         "for the head-office line and THOMAS-MR for his home line. The "
         "vendor record is shared at the family-office level; each bill "
         "carries its own entity FK."),
        ("\"What if THOMAS-TRUST loans Mr Thomas money?\"",
         "Two JEs in one Intercompany Group. The Trust's leg credits cash, "
         "Mr's leg debits cash. The engine refuses to post either leg until "
         "the whole group nets to zero in the reporting currency. Demo'd in "
         "scenario 10 of the smoketest."),
        ("\"Can each child's school fees be tracked separately?\"",
         "Yes. Use the FAM dimension on the JE line — FAM_CHILD_A vs "
         "FAM_CHILD_B. The CoA workbook's 09_Dimension_Validation_Rules "
         "already requires FAM on personal-education accounts so the bookkeeper "
         "can't post school fees without it."),
        ("\"Can the Foundation's books stay separate from the family's?\"",
         "Yes. The Foundation is its own entity with its own period control, "
         "its own approvals, its own audit trail. Reports filter by entity. "
         "Consolidated reporting across all five is opt-in, not default."),
        ("\"What about VAT?\"",
         "Demo'd in scenario 21 of the smoketest — Swiss 8.1% standard rate, "
         "accrual JE has Input VAT correctly split, VAT report aggregates by "
         "tax code, then VATRemittanceService settles it to the bank when "
         "paid. Three transaction types, fully wired."),
        ("\"Multi-currency?\"",
         "Scenario 1 of the smoketest. EUR receipt into a USD entity converts "
         "at the FX rate on the JE date. Period-end revaluation is automatic "
         "for monetary balances (scenario 12)."),
        ("\"What's missing — what won't I see today?\"",
         "Three subledger modules need your sign-off before I build them — "
         "Fixed Asset register with depreciation, Payroll, and Portfolio "
         "trading with FIFO/LIFO. Each needs a workbook tab from you first. "
         "They're in the Workflow Request doc I sent you. The day-to-day "
         "operating cycle is done — 20 transaction types auto-drafted."),
        ("\"Did your architecture or my workbook change?\"",
         "Zero changes to either. Everything sits inside Layer 4 (Accounting "
         "Engine) using the dimensions and masters you already designed. No "
         "new tabs, no new layers, no new dimension types."),
    ]
    for q, a in qa:
        story.append(Paragraph(f"<b>{q}</b>", S["h3"]))
        story.append(Paragraph(a, S["body"]))

    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph("If something breaks live", S["h1"]))
    for line in [
        "<b>UI breaks</b> → run the smoketest. 38 green scenarios is a stronger argument than any UI demo.",
        "<b>Data missing</b> → don't apologise more than once. Run smoketest, point at green output.",
        "<b>Network / auth issue</b> → run the smoketest.",
    ]:
        story.append(Paragraph("• " + line, S["bullet"]))

    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph("Practice run — 30 minutes today", S["h1"]))
    for line in [
        "Alice and Bob credentials work in two browsers",
        "Bills page → vendor dropdown shows 2 vendors, expense account auto-fills on vendor select",
        "Submit-for-approval works on a draft bill",
        "Approvals page shows the Bill row with the type pill",
        "Mark Paid works on an approved bill",
        "Smoketest exits clean (38 scenarios, OK at the end)",
    ]:
        story.append(_check(line, S))

    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(
        "<b>Anything that fails on the practice run, fix it BEFORE Thomas "
        "arrives — not during.</b>",
        S["body"],
    ))

    doc.build(story)
    print(f"Wrote: {OUT}")


if __name__ == "__main__":
    build()
