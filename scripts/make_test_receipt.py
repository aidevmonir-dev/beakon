"""Generate two synthetic vendor bills for OCR smoke-testing.

Outputs (in test_data/ at the project root):
    receipt.pdf  — text-PDF, exercises the TEXT path (uses OLLAMA_TEXT_MODEL)
    receipt.png  — image,    exercises the VISION path (uses OLLAMA_VISION_MODEL)

Both encode the SAME bill so you can verify the model returns the same
extraction in either mode.

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


if __name__ == "__main__":
    pdf_path = OUT_DIR / "receipt.pdf"
    png_path = OUT_DIR / "receipt.png"
    make_pdf(pdf_path)
    make_png(png_path)
    print(f"PDF written: {pdf_path}  ({pdf_path.stat().st_size:,} bytes)")
    print(f"PNG written: {png_path}  ({png_path.stat().st_size:,} bytes)")
    print()
    print(f"Expected extraction: vendor='{VENDOR}', invoice_number='{INVOICE_NUMBER}',")
    print(f"  invoice_date='{INVOICE_DATE}', total='{TOTAL}', currency='{CURRENCY_CODE}'")
