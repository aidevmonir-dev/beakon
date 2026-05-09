"""Generate synthetic bills + invoices for OCR smoke-testing.

Bills (AP — vendor → us, expense side):
    receipt.pdf               — text-PDF, exercises the TEXT path
    receipt.png               — image, exercises the VISION path
    receipt_scanned.pdf       — image-only PDF, exercises pypdfium2 render
    bill_eur_subscription.pdf — EUR + VAT + multi-period service window

Invoices (AR — us → customer, revenue side):
    invoice_consulting_usd.pdf — consulting services invoice we issued in
                                  USD; tests revenue-account suggestion,
                                  customer matching, and the AR-side
                                  document_type="invoice" code path.

Run:
    venv\\Scripts\\python.exe scripts\\make_test_receipt.py
"""
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw, ImageFont


OUT_DIR = Path(__file__).resolve().parent.parent / "test_data"
OUT_DIR.mkdir(exist_ok=True)


# ── The bill content (single source of truth) ───────────────────────────
VENDOR = "BlueSpruce Office Supplies, Inc."
ADDRESS = "118 Pine St · Portland, OR 97204 · USA"
INVOICE_NUMBER = "INV-2026-04812"
INVOICE_DATE = "2026-04-15"
DUE_DATE = "2026-05-15"

LINE_ITEMS = [
    ("Premium printer paper, 5 reams",  "62.50"),
    ("Black ink cartridge (2 pack)",   "84.00"),
    ("Ergonomic mouse",                 "39.99"),
    ("Standing desk mat",               "55.00"),
]
SUBTOTAL = "241.49"
TAX_LABEL = "Sales tax (7%)"
TAX_AMOUNT = "16.90"
TOTAL = "258.39"
CURRENCY_SYMBOL = "$"
CURRENCY_CODE = "USD"

PAID_TO_NAME = "Beakon HoldCo"
TERMS = "Net 30 — bill"


# ── PDF generation (text-extractable) ───────────────────────────────────

def make_pdf(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=letter)
    w, h = letter
    y = h - 0.75 * inch

    c.setFont("Helvetica-Bold", 18)
    c.drawString(0.75 * inch, y, VENDOR)
    y -= 18
    c.setFont("Helvetica", 9)
    c.drawString(0.75 * inch, y, ADDRESS)
    y -= 0.4 * inch

    c.setFont("Helvetica-Bold", 12)
    c.drawString(0.75 * inch, y, "INVOICE")
    c.setFont("Helvetica", 10)
    c.drawString(4.5 * inch, y, f"Number: {INVOICE_NUMBER}")
    y -= 14
    c.drawString(4.5 * inch, y, f"Date: {INVOICE_DATE}")
    y -= 14
    c.drawString(4.5 * inch, y, f"Due:  {DUE_DATE}")
    y -= 0.3 * inch

    c.drawString(0.75 * inch, y, f"Bill to: {PAID_TO_NAME}")
    y -= 0.4 * inch

    # Items table header
    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.75 * inch, y, "Description")
    c.drawRightString(7.5 * inch, y, f"Amount ({CURRENCY_CODE})")
    y -= 6
    c.line(0.75 * inch, y, 7.5 * inch, y)
    y -= 14

    c.setFont("Helvetica", 10)
    for desc, amount in LINE_ITEMS:
        c.drawString(0.75 * inch, y, desc)
        c.drawRightString(7.5 * inch, y, f"{CURRENCY_SYMBOL}{amount}")
        y -= 14

    y -= 6
    c.line(4 * inch, y, 7.5 * inch, y)
    y -= 14
    c.drawString(4 * inch, y, "Subtotal")
    c.drawRightString(7.5 * inch, y, f"{CURRENCY_SYMBOL}{SUBTOTAL}")
    y -= 14
    c.drawString(4 * inch, y, TAX_LABEL)
    c.drawRightString(7.5 * inch, y, f"{CURRENCY_SYMBOL}{TAX_AMOUNT}")
    y -= 6
    c.line(4 * inch, y, 7.5 * inch, y)
    y -= 16
    c.setFont("Helvetica-Bold", 12)
    c.drawString(4 * inch, y, "TOTAL DUE")
    c.drawRightString(7.5 * inch, y, f"{CURRENCY_SYMBOL}{TOTAL} {CURRENCY_CODE}")

    y -= 0.6 * inch
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(0.75 * inch, y, f"Terms: {TERMS}. Thank you for your business.")
    c.showPage()
    c.save()


# ── PNG generation (image — exercises vision model) ─────────────────────

def make_png(path: Path) -> None:
    W, H = 800, 1100
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)

    def font(size: int, bold: bool = False, italic: bool = False):
        # Try common Windows fonts; fall back to PIL default if missing.
        for name in (
            "arialbd.ttf" if bold else "arial.ttf",
            "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
        ):
            try:
                return ImageFont.truetype(name, size)
            except (OSError, IOError):
                continue
        return ImageFont.load_default()

    y = 50

    d.text((50, y), VENDOR, fill="black", font=font(28, bold=True)); y += 36
    d.text((50, y), ADDRESS, fill="#444", font=font(13));            y += 32

    d.text((50, y), "INVOICE", fill="black", font=font(16, bold=True))
    d.text((460, y),     f"Number: {INVOICE_NUMBER}", fill="black", font=font(13)); y += 22
    d.text((460, y - 22), "")  # spacer kept simple
    d.text((460, y), f"Date:  {INVOICE_DATE}",       fill="black", font=font(13)); y += 20
    d.text((460, y), f"Due:   {DUE_DATE}",           fill="black", font=font(13)); y += 32

    d.text((50, y), f"Bill to: {PAID_TO_NAME}", fill="black", font=font(13));   y += 32

    # Items header
    d.text((50, y),  "Description",                fill="black", font=font(13, bold=True))
    d.text((620, y), f"Amount ({CURRENCY_CODE})",  fill="black", font=font(13, bold=True))
    y += 18
    d.line((50, y, 750, y), fill="#888", width=1); y += 8

    for desc, amount in LINE_ITEMS:
        d.text((50, y),  desc,                              fill="black", font=font(13))
        d.text((620, y), f"{CURRENCY_SYMBOL}{amount}",      fill="black", font=font(13))
        y += 22

    y += 8
    d.line((400, y, 750, y), fill="#888", width=1); y += 8

    d.text((400, y), "Subtotal",                          fill="black", font=font(13))
    d.text((620, y), f"{CURRENCY_SYMBOL}{SUBTOTAL}",      fill="black", font=font(13)); y += 22
    d.text((400, y), TAX_LABEL,                           fill="black", font=font(13))
    d.text((620, y), f"{CURRENCY_SYMBOL}{TAX_AMOUNT}",    fill="black", font=font(13)); y += 8
    d.line((400, y, 750, y), fill="black", width=2); y += 12
    d.text((400, y), "TOTAL DUE",                         fill="black", font=font(16, bold=True))
    d.text((600, y), f"{CURRENCY_SYMBOL}{TOTAL} {CURRENCY_CODE}", fill="black", font=font(16, bold=True))
    y += 50

    d.text((50, y), f"Terms: {TERMS}. Thank you for your business.",
           fill="#444", font=font(12))

    img.save(path, "PNG")


# ── Scanned PDF (image-only, NO text layer) ─────────────────────────────
# This is what you get when someone scans a paper bill or photocopies it.
# pypdf can't extract text, so the OCR pipeline falls into the new
# pypdfium2 render → vision branch we added in beakon_core/services/ocr.py.

def make_scanned_pdf(path: Path, source_png: Path) -> None:
    """Wrap an existing PNG into a PDF with no text layer."""
    if not source_png.exists():
        make_png(source_png)
    img = Image.open(source_png).convert("RGB")
    # PIL's PDF writer produces an image-only PDF (no embedded text),
    # which is exactly what scanned bills look like in the wild.
    img.save(path, "PDF", resolution=200)


# ── EUR subscription bill with VAT and multi-period service window ──────
# Tests three things at once:
#   - currency detection (EUR, "€" symbol)
#   - VAT extraction (German Mehrwertsteuer at 19 %)
#   - service period spanning multiple accounting periods, which should
#     trip the AIBillDraftingService multi-period warning so the
#     reviewer applies the correct deferral / amortisation treatment

EUR_VENDOR = "Müller Cloud GmbH"
EUR_ADDRESS = "Hauptstraße 42 · 80331 München · Deutschland"
EUR_INVOICE_NUMBER = "RE-2026-1042"
EUR_INVOICE_DATE = "2026-10-30"
EUR_DUE_DATE = "2026-11-30"
EUR_SERVICE_START = "2026-11-01"
EUR_SERVICE_END = "2027-04-30"
EUR_DESCRIPTION = "Cloud platform — semi-annual subscription"
EUR_NET = "1000.00"
EUR_VAT_RATE = "19"
EUR_VAT = "190.00"
EUR_TOTAL = "1190.00"


def make_eur_subscription_pdf(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=letter)
    w, h = letter
    y = h - 0.75 * inch

    c.setFont("Helvetica-Bold", 18)
    c.drawString(0.75 * inch, y, EUR_VENDOR)
    y -= 18
    c.setFont("Helvetica", 9)
    c.drawString(0.75 * inch, y, EUR_ADDRESS)
    y -= 0.4 * inch

    c.setFont("Helvetica-Bold", 12)
    c.drawString(0.75 * inch, y, "RECHNUNG / INVOICE")
    c.setFont("Helvetica", 10)
    c.drawString(4.5 * inch, y, f"Number: {EUR_INVOICE_NUMBER}")
    y -= 14
    c.drawString(4.5 * inch, y, f"Date:   {EUR_INVOICE_DATE}")
    y -= 14
    c.drawString(4.5 * inch, y, f"Due:    {EUR_DUE_DATE}")
    y -= 0.3 * inch

    c.drawString(0.75 * inch, y, "Bill to: Beakon HoldCo")
    y -= 18
    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.75 * inch, y, "Service period:")
    c.setFont("Helvetica", 10)
    c.drawString(2.0 * inch, y, f"{EUR_SERVICE_START}  to  {EUR_SERVICE_END}  (6 months)")
    y -= 0.4 * inch

    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.75 * inch, y, "Description")
    c.drawRightString(7.5 * inch, y, "Amount (EUR)")
    y -= 6
    c.line(0.75 * inch, y, 7.5 * inch, y)
    y -= 14

    c.setFont("Helvetica", 10)
    c.drawString(0.75 * inch, y, EUR_DESCRIPTION)
    c.drawRightString(7.5 * inch, y, f"€{EUR_NET}")
    y -= 24

    c.line(4 * inch, y, 7.5 * inch, y)
    y -= 14
    c.drawString(4 * inch, y, "Net")
    c.drawRightString(7.5 * inch, y, f"€{EUR_NET}")
    y -= 14
    c.drawString(4 * inch, y, f"VAT (Mehrwertsteuer {EUR_VAT_RATE}%)")
    c.drawRightString(7.5 * inch, y, f"€{EUR_VAT}")
    y -= 6
    c.line(4 * inch, y, 7.5 * inch, y)
    y -= 16
    c.setFont("Helvetica-Bold", 12)
    c.drawString(4 * inch, y, "TOTAL DUE")
    c.drawRightString(7.5 * inch, y, f"€{EUR_TOTAL} EUR")

    y -= 0.6 * inch
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(0.75 * inch, y,
                 "Terms: Net 30. Payment in EUR via SEPA. "
                 "Subscription covers November 2026 through April 2027.")
    c.showPage()
    c.save()


# ── AR-side: a customer invoice WE issued ───────────────────────────────
# Tests the new ``document_type="invoice"`` code path: AI should suggest
# a REVENUE account (not expense), match the customer name, and prefill
# the Invoices drawer for human review.
#
# Issuer is the family-office holding co (us). Recipient is a fictional
# advisory client. Services are consulting fees — the bread-and-butter
# revenue line for a family-office-as-a-service vendor like Beakon.

INV_ISSUER_NAME = "Thomas Family Office"
INV_ISSUER_ADDRESS = "Bahnhofstrasse 1 · 8001 Zürich · Switzerland"
INV_CUSTOMER_NAME = "Sterling Wealth Partners, LLC"
INV_CUSTOMER_ADDRESS = "789 Park Avenue · New York, NY 10021 · USA"
INV_INVOICE_NUMBER = "INV-2026-Q2-0042"
INV_INVOICE_DATE = "2026-04-30"
INV_DUE_DATE = "2026-05-30"

INV_LINE_ITEMS = [
    ("Investment advisory — Q2 2026",        "5000.00"),
    ("Quarterly portfolio review",           "1500.00"),
    ("Tax-loss harvesting analysis",          "750.00"),
]
INV_SUBTOTAL = "7250.00"
INV_TAX_LABEL = "Sales tax (0% — exempt services)"
INV_TAX_AMOUNT = "0.00"
INV_TOTAL = "7250.00"
INV_CURRENCY_SYMBOL = "$"
INV_CURRENCY_CODE = "USD"


def make_invoice_pdf(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=letter)
    w, h = letter
    y = h - 0.75 * inch

    # Issuer (us) — top-left, like a real invoice
    c.setFont("Helvetica-Bold", 18)
    c.drawString(0.75 * inch, y, INV_ISSUER_NAME)
    y -= 18
    c.setFont("Helvetica", 9)
    c.drawString(0.75 * inch, y, INV_ISSUER_ADDRESS)
    y -= 0.4 * inch

    # Invoice metadata — top-right
    c.setFont("Helvetica-Bold", 12)
    c.drawString(0.75 * inch, y, "INVOICE")
    c.setFont("Helvetica", 10)
    c.drawString(4.5 * inch, y, f"Number: {INV_INVOICE_NUMBER}")
    y -= 14
    c.drawString(4.5 * inch, y, f"Date:   {INV_INVOICE_DATE}")
    y -= 14
    c.drawString(4.5 * inch, y, f"Due:    {INV_DUE_DATE}")
    y -= 0.3 * inch

    # Bill-to (customer) — left side, prominent so the AI grabs the
    # right name into vendor_name (which is REUSED as customer name in
    # invoice mode, per _SYSTEM_RULES_INVOICE).
    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.75 * inch, y, "Bill to:")
    c.setFont("Helvetica", 10)
    c.drawString(1.5 * inch, y, INV_CUSTOMER_NAME)
    y -= 14
    c.drawString(1.5 * inch, y, INV_CUSTOMER_ADDRESS)
    y -= 0.4 * inch

    # Items table
    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.75 * inch, y, "Description")
    c.drawRightString(7.5 * inch, y, f"Amount ({INV_CURRENCY_CODE})")
    y -= 6
    c.line(0.75 * inch, y, 7.5 * inch, y)
    y -= 14

    c.setFont("Helvetica", 10)
    for desc, amount in INV_LINE_ITEMS:
        c.drawString(0.75 * inch, y, desc)
        c.drawRightString(7.5 * inch, y, f"{INV_CURRENCY_SYMBOL}{amount}")
        y -= 14

    y -= 6
    c.line(4 * inch, y, 7.5 * inch, y)
    y -= 14
    c.drawString(4 * inch, y, "Subtotal")
    c.drawRightString(7.5 * inch, y, f"{INV_CURRENCY_SYMBOL}{INV_SUBTOTAL}")
    y -= 14
    c.drawString(4 * inch, y, INV_TAX_LABEL)
    c.drawRightString(7.5 * inch, y, f"{INV_CURRENCY_SYMBOL}{INV_TAX_AMOUNT}")
    y -= 6
    c.line(4 * inch, y, 7.5 * inch, y)
    y -= 16
    c.setFont("Helvetica-Bold", 12)
    c.drawString(4 * inch, y, "TOTAL DUE")
    c.drawRightString(7.5 * inch, y, f"{INV_CURRENCY_SYMBOL}{INV_TOTAL} {INV_CURRENCY_CODE}")

    y -= 0.6 * inch
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(0.75 * inch, y,
                 "Terms: Net 30. Wire to IBAN CH00 0000 0000 0000 0. "
                 "Thank you for your business.")
    c.showPage()
    c.save()


if __name__ == "__main__":
    pdf_path = OUT_DIR / "receipt.pdf"
    png_path = OUT_DIR / "receipt.png"
    scanned_pdf_path = OUT_DIR / "receipt_scanned.pdf"
    eur_pdf_path = OUT_DIR / "bill_eur_subscription.pdf"
    invoice_pdf_path = OUT_DIR / "invoice_consulting_usd.pdf"

    make_pdf(pdf_path)
    make_png(png_path)
    make_scanned_pdf(scanned_pdf_path, source_png=png_path)
    make_eur_subscription_pdf(eur_pdf_path)
    make_invoice_pdf(invoice_pdf_path)

    for p in (pdf_path, png_path, scanned_pdf_path, eur_pdf_path, invoice_pdf_path):
        print(f"  {p.name:<32} {p.stat().st_size:>9,} bytes  ->  {p}")
    print()
    print("Bill (AP) test cases — upload via Bills > New Bill > Choose file:")
    print(f"  receipt.pdf                digital PDF (text path)            "
          f"vendor='{VENDOR}', total={TOTAL} {CURRENCY_CODE}")
    print(f"  receipt.png                image (RapidOCR -> text)           "
          f"same content as receipt.pdf")
    print(f"  receipt_scanned.pdf        image-only PDF (render -> OCR)     "
          f"same content; tests scanned-PDF path")
    print(f"  bill_eur_subscription.pdf  EUR + VAT + 6-month service        "
          f"vendor='{EUR_VENDOR}', total={EUR_TOTAL} EUR")
    print()
    print("Invoice (AR) test case — upload via Invoices > New Invoice > Choose file:")
    print(f"  invoice_consulting_usd.pdf consulting services we issued      "
          f"customer='{INV_CUSTOMER_NAME}',")
    print(f"                                                                "
          f"total={INV_TOTAL} {INV_CURRENCY_CODE}, suggests revenue account")
