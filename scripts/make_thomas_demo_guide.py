"""Generate a printable demo guide for showing Beakon to Thomas.

Outputs:
    test_data/thomas_demo_guide.pdf — step-by-step demo script with
        narration, what to click, and what Thomas will see at each step.

Run:
    venv\\Scripts\\python.exe scripts\\make_thomas_demo_guide.py

The PDF is structured as:
    1. Cover + summary of what's been built
    2. Pre-demo sanity check (run before showing Thomas)
    3. Eight demo sections — Trial Balance, Balance Sheet, P&L, Cash Flow,
       AP/AR Aging, Drill-down traceability, Approvals queue, Audit log
    4. FAQ — what Thomas will likely ask
    5. Recovery — what to do if something looks off mid-demo
"""
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    ListFlowable, ListItem, KeepTogether,
)


OUT_DIR = Path(__file__).resolve().parent.parent / "test_data"
OUT_DIR.mkdir(exist_ok=True)
PDF_PATH = OUT_DIR / "thomas_demo_guide.pdf"


# ── Brand-ish palette (matches frontend brand color) ─────────────────────
BRAND = HexColor("#1A4F4A")       # deep teal — matches dashboard accent
BRAND_LIGHT = HexColor("#E8F0EE") # tint for backgrounds
ACCENT = HexColor("#B8814A")      # amber accent for callouts
GRAY_900 = HexColor("#111827")
GRAY_700 = HexColor("#374151")
GRAY_500 = HexColor("#6B7280")
GRAY_300 = HexColor("#D1D5DB")
GRAY_100 = HexColor("#F3F4F6")
GREEN = HexColor("#047857")


def styles():
    s = getSampleStyleSheet()
    s.add(ParagraphStyle(
        name="DemoTitle", fontName="Helvetica-Bold", fontSize=28,
        textColor=BRAND, spaceAfter=8, leading=32,
    ))
    s.add(ParagraphStyle(
        name="DemoSubtitle", fontName="Helvetica", fontSize=12,
        textColor=GRAY_500, spaceAfter=24, leading=16,
    ))
    s.add(ParagraphStyle(
        name="SectionHeader", fontName="Helvetica-Bold", fontSize=15,
        textColor=BRAND, spaceBefore=18, spaceAfter=8, leading=20,
    ))
    s.add(ParagraphStyle(
        name="SubHeader", fontName="Helvetica-Bold", fontSize=11,
        textColor=GRAY_900, spaceBefore=8, spaceAfter=4, leading=14,
    ))
    s.add(ParagraphStyle(
        name="BodyTight", fontName="Helvetica", fontSize=10,
        textColor=GRAY_700, leading=14, spaceAfter=4,
    ))
    s.add(ParagraphStyle(
        name="Mono", fontName="Courier", fontSize=9,
        textColor=GRAY_900, leading=12, leftIndent=8, spaceAfter=4,
    ))
    s.add(ParagraphStyle(
        name="Narration", fontName="Helvetica-Oblique", fontSize=10,
        textColor=BRAND, leading=14, leftIndent=10, spaceAfter=4,
        borderPadding=(4, 6, 4, 6),
    ))
    s.add(ParagraphStyle(
        name="Callout", fontName="Helvetica", fontSize=9,
        textColor=GRAY_700, leading=12, leftIndent=8, spaceAfter=4,
    ))
    s.add(ParagraphStyle(
        name="Footer", fontName="Helvetica", fontSize=8,
        textColor=GRAY_500, alignment=TA_CENTER,
    ))
    return s


def callout_box(text, st, color=BRAND_LIGHT, border_color=BRAND):
    """A boxed paragraph for important callouts."""
    p = Paragraph(text, st["BodyTight"])
    t = Table([[p]], colWidths=[6.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), color),
        ("BOX", (0, 0), (-1, -1), 0.5, border_color),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def step_table(rows, st):
    """Render a 'You do / Thomas sees' table for a demo step."""
    data = [["You do", "Thomas sees"]]
    for action, sees in rows:
        data.append([
            Paragraph(action, st["BodyTight"]),
            Paragraph(sees, st["BodyTight"]),
        ])
    t = Table(data, colWidths=[3.1 * inch, 3.4 * inch])
    t.setStyle(TableStyle([
        # Header row
        ("BACKGROUND", (0, 0), (-1, 0), BRAND),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        # Body
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.25, GRAY_300),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 1), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, GRAY_100]),
    ]))
    return t


def section(title, intro, steps, narration, st, callout=None):
    """Build a complete demo section."""
    parts = [
        Paragraph(title, st["SectionHeader"]),
        Paragraph(intro, st["BodyTight"]),
        Spacer(1, 6),
        step_table(steps, st),
        Spacer(1, 6),
    ]
    if narration:
        parts.append(Paragraph(
            f'<b>Narration to Thomas:</b> &ldquo;{narration}&rdquo;',
            st["Narration"],
        ))
    if callout:
        parts.append(Spacer(1, 4))
        parts.append(callout_box(callout, st))
    return KeepTogether(parts)


def build():
    doc = SimpleDocTemplate(
        str(PDF_PATH), pagesize=letter,
        leftMargin=0.85 * inch, rightMargin=0.85 * inch,
        topMargin=0.85 * inch, bottomMargin=0.85 * inch,
        title="Beakon — Demo Guide for Thomas",
        author="Beakon",
    )
    st = styles()
    story = []

    # ── Cover ──────────────────────────────────────────────────────
    story += [
        Paragraph("Beakon — Demo Guide", st["DemoTitle"]),
        Paragraph(
            "Step-by-step script for showing Thomas the engine working "
            "end-to-end across Bills, Invoices, Bank feed, and Reports.",
            st["DemoSubtitle"],
        ),
        callout_box(
            "<b>What this guide does.</b> Walks you through eight demonstrations "
            "that prove the accounting engine works: same numbers reconciling "
            "across multiple reports, full traceability from a number on the "
            "trial balance back to its source document and AI extraction, "
            "and the segregation-of-duties controls Thomas's blueprint requires.",
            st, color=BRAND_LIGHT, border_color=BRAND,
        ),
        Spacer(1, 18),
        Paragraph("What's been built", st["SectionHeader"]),
        Paragraph(
            "Three input flows feed the same ledger:",
            st["BodyTight"],
        ),
        ListFlowable([
            ListItem(Paragraph(
                "<b>Bills (AP)</b> — vendor receipts uploaded as PDF or "
                "image. Claude Haiku 4.5 extracts vendor, dates, totals, "
                "line items, and suggests an expense account. Human reviews "
                "and approves. Approval auto-posts the accrual JE.",
                st["BodyTight"],
            )),
            ListItem(Paragraph(
                "<b>Invoices (AR)</b> — customer invoices we issued, imported "
                "the same way. AI suggests a revenue account. Same review-and-"
                "approve flow.",
                st["BodyTight"],
            )),
            ListItem(Paragraph(
                "<b>Bank feed</b> — CSV bank statement. Each transaction can "
                "be categorized in one click; AI suggests the offset account "
                "from the entity's chart. JE auto-submits to the approval "
                "queue.",
                st["BodyTight"],
            )),
        ], bulletType="bullet", leftIndent=20),
        Spacer(1, 8),
        Paragraph(
            "All three converge into balanced double-entry journal entries. "
            "Every JE flows through the approval state machine "
            "(<i>draft → pending → approved → posted</i>). Nothing posts to the "
            "ledger without human approval. Different humans must submit "
            "and approve (segregation of duties).",
            st["BodyTight"],
        ),
        PageBreak(),
    ]

    # ── Pre-demo sanity check ──────────────────────────────────────
    story += [
        Paragraph("Pre-Demo Sanity Check (5 minutes before)", st["SectionHeader"]),
        Paragraph(
            "Run these checks before Thomas walks in. If anything fails, "
            "fix it before starting — never debug live.",
            st["BodyTight"],
        ),
        Spacer(1, 6),
        ListFlowable([
            ListItem(Paragraph(
                "Open <b>Reports → Trial Balance</b>. Verify the green "
                "<b>Balanced</b> badge. If red, the engine is in a bad "
                "state — find the off-balance JE before demoing.",
                st["BodyTight"],
            )),
            ListItem(Paragraph(
                "Open <b>Reports → Balance Sheet</b>. Verify <b>Balanced</b> badge.",
                st["BodyTight"],
            )),
            ListItem(Paragraph(
                "Open <b>Reports → Cash Flow</b>. Verify <b>Reconciles to balance "
                "sheet</b> badge.",
                st["BodyTight"],
            )),
            ListItem(Paragraph(
                "Verify Django is running on port 8000. Verify Next.js is on "
                "port 3000. Open <i>http://localhost:3000/dashboard</i> and "
                "ensure you can navigate without errors.",
                st["BodyTight"],
            )),
            ListItem(Paragraph(
                "If demonstrating the segregation-of-duties control: have an "
                "incognito window already open and signed in as <i>approver@beakon.local</i> "
                "/ <i>approve-me</i>. (Run <font name='Courier'>python manage.py "
                "create_demo_approver</font> if needed.)",
                st["BodyTight"],
            )),
            ListItem(Paragraph(
                "Verify Ollama is running (or Claude API key is set, depending "
                "on <font name='Courier'>OCR_BACKEND</font> in your .env).",
                st["BodyTight"],
            )),
        ], bulletType="bullet", leftIndent=20),
        Spacer(1, 12),
        callout_box(
            "<b>If a badge is red.</b> Open the relevant report's verification "
            "block — it shows derived vs. expected and the difference. "
            "Most common cause: a JE created with a missing FX rate. "
            "Fix in <b>Reference Data → FX Rates</b>, or delete the bad JE "
            "via the wipe_test_bills command.",
            st, color=HexColor("#FEF3C7"), border_color=HexColor("#D97706"),
        ),
        PageBreak(),
    ]

    # ── Eight demo sections ────────────────────────────────────────
    story.append(Paragraph("The Eight Demonstrations", st["SectionHeader"]))
    story.append(Paragraph(
        "Run these in order. Total time: ~10 minutes. Each one proves a "
        "different property of the engine; together they prove the whole "
        "system is internally consistent.",
        st["BodyTight"],
    ))
    story.append(Spacer(1, 12))

    story.append(section(
        "1. Trial Balance — the fundamental proof  (1 min)",
        "The most basic test in accounting: do total debits equal total "
        "credits? If yes, every JE in the system is a balanced double-entry. "
        "If no, the engine is broken.",
        [
            ("Open <b>Dashboard → Reports → Trial Balance</b>",
             "Table of every account with debits and credits. Green "
             "<b>Balanced</b> badge in the top right."),
            ("Click the <b>YTD</b> quick-period chip",
             "Date range expands to year-to-date so all activity shows."),
            ("Click <b>Export CSV</b>",
             "Trial balance downloads as <i>trial-balance_YYYY-MM-DD.csv</i> — "
             "Thomas can open in Excel."),
        ],
        "Every transaction in the system — bills, invoices, bank feed — "
        "produced balanced double-entry JEs. The trial balance proves "
        "the math is intact across the whole engine.",
        st,
        callout="<b>If Thomas asks:</b> 'What if a JE goes off-balance?' — "
                "answer: the engine refuses to save unbalanced JEs at the "
                "service layer. The only way to land here red is a posted "
                "FX revaluation that's stale; we'd see the JE flagged in "
                "the audit log.",
    ))

    story.append(Spacer(1, 12))
    story.append(section(
        "2. Balance Sheet — the accounting equation  (1 min)",
        "Assets = Liabilities + Equity. The fundamental equation must hold "
        "at any point in time, on any reporting date.",
        [
            ("Open <b>Reports → Balance Sheet</b>",
             "Three sections: Assets, Liabilities, Equity. Green "
             "<b>Balanced</b> badge."),
            ("Click <b>End of last month</b> chip",
             "Snapshot rolls back to the prior month-end. Balanced still."),
            ("Click <b>Export CSV</b>",
             "Balance sheet downloads with all sections + totals."),
        ],
        "Same engine, different lens. The balance sheet equation holds "
        "at every reporting date because every JE moves both sides equally.",
        st,
    ))

    story.append(section(
        "3. Profit &amp; Loss — operations flowing through  (1 min)",
        "Bills become expenses, invoices become revenue, bank fees become "
        "expenses. The P&amp;L should reflect all of them.",
        [
            ("Open <b>Reports → Profit &amp; Loss</b>",
             "Revenue / COGS / Operating Expenses / Net Income. Each "
             "section shows account-level detail."),
            ("Point at the Revenue line for the consulting invoice",
             "Sterling Wealth Partners invoice posted as $7,250 revenue "
             "(or equivalent in your demo data)."),
            ("Point at Operating Expenses",
             "BlueSpruce Office Supplies bill posted as ~232 CHF expense, "
             "plus any bank-fee transactions you categorized as expenses."),
        ],
        "Every approved bill flows here as expense. Every approved invoice "
        "flows here as revenue. Net Income computes from the actual ledger, "
        "not a separate aggregator.",
        st,
    ))
    story.append(PageBreak())

    story.append(section(
        "4. Cash Flow Statement — the closer  (1 min)",
        "The hardest report to fake. It's reconstructed from JEs and must "
        "reconcile to the balance sheet's cash position. The reconciliation "
        "badge is the proof that all the engine's parts agree with each other.",
        [
            ("Open <b>Reports → Cash Flow</b>",
             "Direct method: Operating, Investing, Financing sections. "
             "Green <b>Reconciles to balance sheet</b> badge."),
            ("Point at the verification line",
             "<b>Derived closing</b> equals <b>Balance sheet closing</b>. "
             "Difference = 0."),
            ("Walk through the Operating section",
             "Bank-categorized inflows and outflows show up here, "
             "labeled by counterparty."),
        ],
        "This is the hardest report to fake. The cash flow statement is "
        "reconstructed from JEs and must reconcile to the balance sheet's "
        "cash position. The 'Reconciles' badge means the engine maintains "
        "internal consistency across every transaction type.",
        st,
        callout="<b>This is the showstopper.</b> If Thomas only has time "
                "for one report, show this. The reconciliation badge "
                "proves the four other reports (TB, BS, P&amp;L, Cash Flow) "
                "agree with each other.",
    ))

    story.append(Spacer(1, 12))
    story.append(section(
        "5. AP / AR Aging — open positions  (1 min)",
        "Daily working-capital view. Who owes us, who we owe, and how old "
        "the debts are. Color-coded by bucket.",
        [
            ("Open <b>Reports → AP Aging</b>",
             "List of unpaid bills grouped by vendor, with bucket columns "
             "(current / 1-30 / 31-60 / 61-90 / 90+). Color-coded by severity."),
            ("Click a vendor row",
             "Drills down to the individual bills with reference number, "
             "due date, days overdue, native amount + reporting amount."),
            ("Switch to <b>Reports → AR Aging</b>",
             "Same view from the customer side."),
            ("Click <b>Export CSV</b>",
             "Both line-item and party-level summary tables in one CSV."),
        ],
        "Working-capital snapshot. Aging buckets surface anything past due "
        "so the bookkeeper can chase or pay accordingly.",
        st,
    ))

    story.append(PageBreak())

    story.append(section(
        "6. Drill-down traceability — the killer feature  (2 min)",
        "Every cent on the trial balance can be traced back to a journal "
        "entry, that JE back to its source document, and the source "
        "document back to the AI extraction with the model that drafted "
        "it. Nothing is opaque.",
        [
            ("Open <b>Reports → Trial Balance</b>",
             "Locate the Operating Expenses row. Click the account name."),
            ("Account Ledger drills in",
             "Every JE that touched this account, with date, source type, "
             "memo, debit/credit."),
            ("Click a JE row",
             "JE detail page opens. DR/CR lines visible. Status timeline "
             "shows draft → submitted → approved → posted."),
            ("Scroll to the AI Reasoning panel",
             "Model used (e.g. <i>claude-haiku-4-5</i>), confidence score, "
             "accounting standard reasoning (IFRS / matching principle), "
             "service period if multi-month."),
            ("Click the linked source document",
             "Original bill / bank line / invoice opens in a new tab."),
        ],
        "Every cent on the trial balance can be traced back to a journal "
        "entry, that JE back to its source document, and the source "
        "document back to the AI extraction with the model that drafted "
        "it, the confidence score, and the accounting-standard reasoning. "
        "Nothing is opaque.",
        st,
        callout="<b>If Thomas asks 'how do I audit this?'</b> — the answer "
                "is: drill from the report down to the source document. "
                "Every step is recorded. Auditors and regulators get the "
                "same view; no separate audit prep needed.",
    ))

    story.append(Spacer(1, 12))
    story.append(section(
        "7. Approvals queue — the control surface  (30 sec)",
        "The bookkeeper's daily review screen. One unified inbox for "
        "everything pending sign-off — JEs, Bills, Invoices.",
        [
            ("Open <b>Dashboard → Approvals</b>",
             "List grouped by document type, with submitter, age, amount, "
             "and inline approve / reject buttons."),
            ("Filter by entity",
             "Multi-entity controllers see only their slice."),
            ("Click <b>Approve</b> on a row",
             "Status flips to approved. Linked JE auto-posts to the ledger."),
        ],
        "One screen for everything pending sign-off. Color-coded by age "
        "so nothing falls through the cracks.",
        st,
    ))

    story.append(PageBreak())

    story.append(section(
        "8. Audit log — every action recorded  (30 sec)",
        "Immutable append-only log of every action in the system. "
        "Regulator-ready. Even AI drafting events are recorded with the "
        "model used and the user who approved.",
        [
            ("Open <b>Dashboard → Audit</b>",
             "Stream of events: who did what, when. Filter by actor, "
             "object type, action."),
            ("Find an AI-drafted JE event",
             "Tagged <font name='Courier'>actor_type=ai</font> with the "
             "model name, confidence, mode, accounting-standard reasoning."),
            ("Find an approval event",
             "Submitter and approver are different users. Bypass events "
             "tagged with <font name='Courier'>[SoD bypassed: superuser "
             "override]</font> if any."),
        ],
        "Immutable log. Regulator-ready. AI-drafting events are recorded "
        "with the model that produced the draft. Segregation-of-duties "
        "violations would be visible here — none on a clean run.",
        st,
    ))

    story.append(Spacer(1, 16))
    story.append(callout_box(
        "<b>That's the engine proving itself eight different ways.</b> "
        "If all eight tell a consistent story, the engine works. If any "
        "one disagrees, you have a bug — and the framework is exactly "
        "designed to surface that disagreement loudly.",
        st, color=BRAND_LIGHT, border_color=BRAND,
    ))

    # ── FAQ ────────────────────────────────────────────────────────
    story += [
        PageBreak(),
        Paragraph("FAQ — likely questions from Thomas", st["SectionHeader"]),
        Paragraph(
            "Anticipating these saves on-the-spot fumbling.",
            st["BodyTight"],
        ),
        Spacer(1, 8),
    ]

    faq = [
        ("How does the AI know which expense account to suggest?",
         "It reads the entity's filtered chart of accounts (expense accounts "
         "for bills, revenue for invoices) plus the document text or image. "
         "It must pick from that list — IDs are validated server-side. "
         "Currently using Claude Haiku 4.5 via the Anthropic API; can switch "
         "to local Ollama by changing one env var."),
        ("Where does AI data leave the machine?",
         "On bills/invoices/bank feed when OCR_BACKEND=claude, files go to "
         "api.anthropic.com. Set OCR_BACKEND=ollama and everything stays "
         "local. The choice is per-org, configurable."),
        ("How do you prevent the AI from posting bad data?",
         "AI never posts. Every AI-drafted JE goes through "
         "draft → submitted → approved → posted, with two different humans "
         "required (submitter ≠ approver). The approval is the gate."),
        ("What if the AI gets it wrong?",
         "The reviewer sees the AI's confidence score (red &lt; 40%, "
         "yellow 40-70%, green &gt; 70%) plus the reasoning. They can "
         "edit any field before approval. Audit log records both the AI's "
         "original suggestion AND the human's final decision."),
        ("Can I see what the AI thought?",
         "Yes — every JE has an AI Reasoning panel showing model, "
         "confidence, suggested account reasoning, and accounting-standard "
         "reasoning (e.g. 'Under IFRS, the matching principle requires…'). "
         "Visible on the JE detail page."),
        ("How does multi-currency work?",
         "JEs post in the entity's functional currency. FX rates are "
         "stored as a time series (date-stamped). The engine picks the "
         "most recent rate on or before the JE date. Reports render in "
         "either functional or reporting currency."),
        ("How do approvals scale with multiple entities?",
         "Each user's role on each entity determines what they can approve. "
         "Owners and Admins approve everything on their org; Accountants "
         "approve JEs but not bills; Bookkeepers can create but not "
         "approve. All configurable in the Members + Roles page."),
        ("What happens at month-end close?",
         "Period-close locks: once a period is closed, no new JEs land "
         "in it. Reopen requires the reopen_period permission "
         "(Owner only). The close action triggers automatic FX "
         "revaluation and any recurring recognition entries."),
        ("Where's the data hosted?",
         "Currently local; production target is Swiss-hosted per your "
         "blueprint. Database, file storage, and AI inference can all be "
         "configured to stay in CH."),
    ]
    for q, a in faq:
        story.append(Paragraph(f"<b>Q.</b> {q}", st["SubHeader"]))
        story.append(Paragraph(f"<b>A.</b> {a}", st["BodyTight"]))
        story.append(Spacer(1, 6))

    # ── Recovery ───────────────────────────────────────────────────
    story += [
        PageBreak(),
        Paragraph("If Something Looks Off Mid-Demo", st["SectionHeader"]),
        Paragraph(
            "Common issues and the 30-second fix:",
            st["BodyTight"],
        ),
        Spacer(1, 8),
    ]

    recovery = [
        ("Trial Balance shows red OUT OF BALANCE",
         "Don't try to debug live. Tell Thomas you'll come back to it. "
         "After the demo: check Reports → Trial Balance → look for any "
         "account with debits ≠ credits at the line level. Most likely "
         "cause: a JE with mismatched currency lines."),
        ("P&amp;L is empty",
         "Quick-period probably narrower than your data. Click the YTD chip "
         "(below the date inputs)."),
        ("Cash Flow shows DIFF X",
         "A JE has cash + non-cash lines in different functional currencies, "
         "or a cash-to-cash transfer was misclassified. Skip this report; "
         "show it on a different date or come back to it."),
        ("AI suggestion takes too long",
         "First call after Django restart loads the model — 30-60s on "
         "Ollama, 2-5s on Claude. Pre-load by clicking AI on any one bill "
         "before Thomas walks in."),
        ("Approve button blocked with 'submitter cannot approve'",
         "You're trying to approve a JE you submitted. Either: (a) approve "
         "from the incognito window with the approver account; (b) approve "
         "as Django superuser (works because you have is_superuser=True), "
         "audit log shows the bypass."),
    ]
    for issue, fix in recovery:
        story.append(Paragraph(f"<b>{issue}</b>", st["SubHeader"]))
        story.append(Paragraph(fix, st["BodyTight"]))
        story.append(Spacer(1, 6))

    # ── Final ──────────────────────────────────────────────────────
    story += [
        Spacer(1, 24),
        callout_box(
            "<b>Demo length budget:</b> ~10 minutes total. Trial Balance + "
            "Balance Sheet + P&amp;L + Cash Flow are the four 'engine works' "
            "proofs (4 minutes). Drill-down traceability is the 'engine is "
            "auditable' proof (2 minutes). Aging + Approvals + Audit log "
            "are the 'engine has the daily-ops surface' proofs (2 minutes). "
            "Leaves 2 minutes for Thomas's questions.",
            st, color=BRAND_LIGHT, border_color=BRAND,
        ),
    ]

    def page_footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(GRAY_500)
        canvas.drawCentredString(
            letter[0] / 2, 0.5 * inch,
            f"Beakon — Demo Guide for Thomas · Page {doc.page}",
        )
        canvas.restoreState()

    doc.build(story, onFirstPage=page_footer, onLaterPages=page_footer)


if __name__ == "__main__":
    build()
    size = PDF_PATH.stat().st_size
    print(f"Wrote {PDF_PATH}  ({size:,} bytes)")
