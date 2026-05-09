"""Generate realistic demo CHF bank statement PDFs (one per Thomas entity)
+ a CSV variant — for testing the AI bank-statement import end-to-end.

Output: D:/bookkeeper/demo_statements/
    UBS_THOMAS-HOLD_May2026.pdf      (Holding company)
    UBS_THOMAS-FOUND_May2026.pdf     (Foundation)
    UBS_THOMAS-TRUST_May2026.pdf     (Family Trust)
    UBS_THOMAS-MR_May2026.pdf        (Personal)
    UBS_THOMAS-MRS_May2026.pdf       (Personal)
    UBS_THOMAS-HOLD_May2026.csv      (CSV variant of THOMAS-HOLD)

Each PDF mimics a UBS statement: header (entity, IBAN, period, opening
balance), tabular transactions (Date / Description / Debit / Credit /
Balance), closing balance footer.

Run:
    python scripts/_generate_demo_bank_statements.py
"""
from __future__ import annotations

import csv
from datetime import date
from decimal import Decimal
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
)


OUT_DIR = Path(r"D:\bookkeeper\demo_statements")
OPENING_DATE = date(2026, 5, 1)
CLOSING_DATE = date(2026, 5, 31)


# ── Per-entity configuration ─────────────────────────────────────────────

# (date_day, description, signed_amount_chf)
HOLD_TXNS = [
    (2,  "MANAGEMENT FEE - OPCO-A SA",                Decimal("125000.00")),   # in
    (5,  "PROFESSIONAL FEES - PWC ZURICH",            Decimal("-18500.00")),
    (8,  "DIVIDEND - FAM-INV-LTD Q1 2026",            Decimal("85000.00")),
    (12, "SALARY - DIRECTOR PAYROLL APR 2026",        Decimal("-22500.00")),
    (15, "BANK CHARGES",                              Decimal("-450.00")),
    (19, "INTERCOMPANY LOAN INT - CR-SPV-1",          Decimal("12500.00")),
    (22, "RENT - BAHNHOFSTRASSE OFFICE",              Decimal("-9800.00")),
    (26, "AUDIT FEE Q1 2026 - KPMG",                  Decimal("-15000.00")),
    (29, "FX GAIN ON USD CONVERSION",                 Decimal("3200.00")),
]

FOUND_TXNS = [
    (3,  "DONATION - PRIVATE BENEFACTOR",             Decimal("250000.00")),
    (7,  "GRANT DISBURSEMENT - SCHOOL ZUG",           Decimal("-45000.00")),
    (10, "ADMIN FEE - FOUNDATION COUNCIL",            Decimal("-3500.00")),
    (14, "INVESTMENT INCOME - PORTFOLIO",             Decimal("18750.00")),
    (18, "GRANT DISBURSEMENT - REFUGEE AID",          Decimal("-30000.00")),
    (23, "BANK INTEREST",                             Decimal("125.50")),
    (27, "GRANT DISBURSEMENT - MEDICAL RESEARCH",     Decimal("-50000.00")),
]

TRUST_TXNS = [
    (4,  "INVESTMENT INCOME - DIVIDENDS Q1",          Decimal("78000.00")),
    (6,  "DISTRIBUTION TO BENEFICIARY MR",            Decimal("-25000.00")),
    (6,  "DISTRIBUTION TO BENEFICIARY MRS",           Decimal("-25000.00")),
    (11, "TRUSTEE FEE - PROVIDA TRUST AG",            Decimal("-8500.00")),
    (15, "PROPERTY MGMT INCOME - LAUSANNE",           Decimal("4200.00")),
    (20, "BOND COUPON - SWISS GOVT 2030",             Decimal("12500.00")),
    (24, "DISTRIBUTION TO BENEFICIARY CHILD-B",       Decimal("-15000.00")),
    (28, "PROFESSIONAL FEES - LEGAL ADVISORY",        Decimal("-7800.00")),
]

MR_TXNS = [
    (1,  "SALARY APRIL 2026 - THOMAS HOLDINGS LTD",   Decimal("18500.00")),
    (3,  "SWISSCOM MOBILE PLAN",                      Decimal("-89.00")),
    (5,  "MIGROS GROCERIES",                          Decimal("-185.40")),
    (8,  "RENT - APARTMENT ZURICH",                   Decimal("-4800.00")),
    (10, "DENNER",                                    Decimal("-67.20")),
    (13, "RESTAURANT KRONENHALLE",                    Decimal("-220.00")),
    (16, "EWZ ELECTRICITY",                           Decimal("-145.50")),
    (18, "COOP",                                      Decimal("-92.10")),
    (22, "DIVIDEND DISTRIBUTION - THOMAS TRUST",      Decimal("25000.00")),
    (24, "SBB TRAVEL CARD",                           Decimal("-3650.00")),
    (27, "AMAZON.CH",                                 Decimal("-289.00")),
    (29, "MIGROS GROCERIES",                          Decimal("-201.30")),
]

MRS_TXNS = [
    (2,  "DIVIDEND - FAM-INV-LTD",                    Decimal("12000.00")),
    (4,  "GLOBUS DEPARTMENT STORE",                   Decimal("-450.00")),
    (7,  "RENT CONTRIBUTION",                         Decimal("-2400.00")),
    (9,  "MIGROS",                                    Decimal("-138.60")),
    (12, "GIM PILATES STUDIO",                        Decimal("-180.00")),
    (15, "EYEGLASSES - FIELMANN",                     Decimal("-650.00")),
    (18, "RESTAURANT WIDDER",                         Decimal("-285.00")),
    (22, "DIVIDEND DISTRIBUTION - THOMAS TRUST",      Decimal("25000.00")),
    (25, "COOP",                                      Decimal("-72.40")),
    (28, "JELMOLI",                                   Decimal("-380.00")),
]


# Per-entity meta — name, IBAN, opening balance (matches the seeded JE)
ENTITIES = [
    {
        "code": "THOMAS-HOLD",
        "name": "Thomas Holdings Ltd",
        "iban": "CH82 0024 0240 1234 5678 9",
        "opening": Decimal("5000000.00"),
        "txns": HOLD_TXNS,
    },
    {
        "code": "THOMAS-FOUND",
        "name": "Thomas Foundation",
        "iban": "CH53 0024 0240 4001 1122 3",
        "opening": Decimal("1500000.00"),
        "txns": FOUND_TXNS,
    },
    {
        "code": "THOMAS-TRUST",
        "name": "Thomas Family Trust",
        "iban": "CH71 0024 0240 5005 6677 8",
        "opening": Decimal("3000000.00"),
        "txns": TRUST_TXNS,
    },
    {
        "code": "THOMAS-MR",
        "name": "Mr. Thomas (Personal)",
        "iban": "CH92 0024 0240 9988 7766 5",
        "opening": Decimal("750000.00"),
        "txns": MR_TXNS,
    },
    {
        "code": "THOMAS-MRS",
        "name": "Mrs. Thomas (Personal)",
        "iban": "CH04 0024 0240 5544 3322 1",
        "opening": Decimal("500000.00"),
        "txns": MRS_TXNS,
    },
]


def _money(d: Decimal) -> str:
    s = f"{abs(d):,.2f}".replace(",", "'")  # Swiss thousands separator
    return s


def _build_pdf(entity: dict, path: Path) -> None:
    doc = SimpleDocTemplate(
        str(path), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"UBS Bank Statement — {entity['name']}",
    )
    styles = getSampleStyleSheet()
    h_style = ParagraphStyle(
        "ubsHeader", parent=styles["Title"],
        fontName="Helvetica-Bold", fontSize=18, leading=22,
        textColor=colors.HexColor("#cc0000"), spaceAfter=2,
    )
    sub_style = ParagraphStyle(
        "ubsSub", parent=styles["Normal"],
        fontName="Helvetica", fontSize=9, textColor=colors.HexColor("#444444"),
        spaceAfter=12,
    )
    meta_style = ParagraphStyle(
        "meta", parent=styles["Normal"],
        fontName="Helvetica", fontSize=10, leading=14,
    )

    story = []
    story.append(Paragraph("UBS", h_style))
    story.append(Paragraph(
        "UBS Switzerland AG · Bahnhofstrasse 45 · 8001 Z&#252;rich",
        sub_style,
    ))
    story.append(Paragraph(
        f"<b>Account holder:</b> {entity['name']}<br/>"
        f"<b>IBAN:</b> {entity['iban']}<br/>"
        f"<b>Currency:</b> CHF<br/>"
        f"<b>Statement period:</b> {OPENING_DATE.strftime('%d %b %Y')} &#8211; {CLOSING_DATE.strftime('%d %b %Y')}<br/>"
        f"<b>Opening balance:</b> CHF {_money(entity['opening'])}",
        meta_style,
    ))
    story.append(Spacer(1, 8))

    # Build the running balance + table rows
    running = entity["opening"]
    rows = [["Date", "Description", "Debit", "Credit", "Balance CHF"]]
    sorted_txns = sorted(entity["txns"], key=lambda t: t[0])
    total_debit = Decimal("0")
    total_credit = Decimal("0")
    for day, desc, amt in sorted_txns:
        d = date(2026, 5, day)
        running += amt
        if amt < 0:
            debit, credit = _money(amt), ""
            total_debit += -amt
        else:
            debit, credit = "", _money(amt)
            total_credit += amt
        rows.append([
            d.strftime("%d.%m.%Y"),
            desc,
            debit,
            credit,
            _money(running),
        ])
    rows.append(["", "Closing balance", "", "", _money(running)])

    tbl = Table(
        rows,
        colWidths=[24 * mm, 78 * mm, 24 * mm, 24 * mm, 28 * mm],
        repeatRows=1,
    )
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f4f4f4")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#222")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("ALIGN", (2, 0), (4, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor("#888")),
        ("LINEABOVE", (0, -1), (-1, -1), 0.6, colors.HexColor("#888")),
        ("FONTNAME", (1, -1), (-1, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 10))

    summary_style = ParagraphStyle(
        "summary", parent=styles["Normal"],
        fontName="Helvetica", fontSize=9, textColor=colors.HexColor("#555"),
    )
    story.append(Paragraph(
        f"Total debits: CHF {_money(total_debit)} &#160;&#160; "
        f"Total credits: CHF {_money(total_credit)} &#160;&#160; "
        f"Net change: CHF {_money(total_credit - total_debit)}",
        summary_style,
    ))
    story.append(Spacer(1, 16))
    story.append(Paragraph(
        "<i>This statement is issued for testing purposes only. UBS&#160;Switzerland&#160;AG is a registered "
        "trademark; this is a synthetic document generated by Beakon for the accounting-engine demo.</i>",
        ParagraphStyle("disclaimer", parent=styles["Normal"],
                       fontName="Helvetica-Oblique", fontSize=8,
                       textColor=colors.HexColor("#999")),
    ))
    doc.build(story)


def _build_csv(entity: dict, path: Path) -> None:
    """CSV mirror of the same statement so users can demo CSV import too."""
    running = entity["opening"]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Date", "Description", "Amount CHF", "Balance CHF"])
        for day, desc, amt in sorted(entity["txns"], key=lambda t: t[0]):
            running += amt
            w.writerow([
                date(2026, 5, day).strftime("%Y-%m-%d"),
                desc,
                f"{amt:.2f}",
                f"{running:.2f}",
            ])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Writing demo statements to {OUT_DIR}\n")
    for ent in ENTITIES:
        pdf_path = OUT_DIR / f"UBS_{ent['code']}_May2026.pdf"
        _build_pdf(ent, pdf_path)
        size = pdf_path.stat().st_size
        print(f"  PDF  {pdf_path.name:<40} {size:>7,} bytes  ({len(ent['txns'])} txns)")

    # CSV mirror of THOMAS-HOLD for the CSV-import side of the demo
    csv_path = OUT_DIR / "UBS_THOMAS-HOLD_May2026.csv"
    _build_csv(ENTITIES[0], csv_path)
    size = csv_path.stat().st_size
    print(f"  CSV  {csv_path.name:<40} {size:>7,} bytes  ({len(ENTITIES[0]['txns'])} txns)")

    print(f"\nDone. {len(ENTITIES) + 1} files generated.")


if __name__ == "__main__":
    main()
