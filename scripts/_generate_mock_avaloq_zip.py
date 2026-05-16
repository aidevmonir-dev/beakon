"""Generate a mock Avaloq daily zip for demo / development.

The real bank has not yet shared sample files, so we emit five CSVs in
a believable shape and let the parser column-mapper translate to our
internal schema. When real samples land, only the column-mapper needs
to change — file detection, dispatch, and downstream models stay the
same.

Files produced inside the zip (filenames match the bank's
`XXX_<type>` naming convention from their setup brief):

    <PORTFOLIO>_cash.csv
    <PORTFOLIO>_securities.csv
    <PORTFOLIO>_orderbook.csv
    <PORTFOLIO>_positions.csv
    <PORTFOLIO>_perf.csv

Usage:

    python scripts/_generate_mock_avaloq_zip.py
    python scripts/_generate_mock_avaloq_zip.py --portfolio BEAKON-DEMO-001
    python scripts/_generate_mock_avaloq_zip.py --business-date 2026-05-08
    python scripts/_generate_mock_avaloq_zip.py --output-dir D:\\bookkeeper\\incoming

Outputs `<PORTFOLIO>_<DATE>.zip` in the chosen directory.
"""
from __future__ import annotations

import argparse
import csv
import io
import zipfile
from datetime import date, timedelta
from pathlib import Path


# ── Mock catalogues ────────────────────────────────────────────────

# Real ISINs so the demo looks credible; quantities and prices are
# plausible but invented.
INSTRUMENTS = [
    # ISIN,            name,                   currency
    ("US0378331005",  "APPLE INC",             "USD"),
    ("US5949181045",  "MICROSOFT CORP",        "USD"),
    ("US02079K3059",  "ALPHABET INC CL A",     "USD"),
    ("US88160R1014",  "TESLA INC",             "USD"),
    ("US67066G1040",  "NVIDIA CORP",           "USD"),
    ("US0231351067",  "AMAZON.COM INC",        "USD"),
    ("CH0012032048",  "ROCHE HOLDING AG",      "CHF"),
    ("CH0038863350",  "NESTLE SA",             "CHF"),
    ("DE0007164600",  "SAP SE",                "EUR"),
    ("FR0000133308",  "ORANGE SA",             "EUR"),
]

CASH_DESCRIPTIONS = [
    ("DIVIDEND APPLE INC",                   128.50,  "USD"),
    ("DIVIDEND ROCHE HOLDING AG",            340.00,  "CHF"),
    ("WIRE OUT - VENDOR PAYMENT",          -2500.00,  "USD"),
    ("FX BUY EUR SELL USD",               -12500.00,  "USD"),
    ("FX SELL EUR BUY USD",                12450.00,  "EUR"),
    ("BANK FEE - CUSTODY Q2",               -450.00,  "USD"),
    ("INTEREST CREDIT MARGIN ACCOUNT",        87.20,  "USD"),
    ("STAMP DUTY SWITZERLAND",                -8.50,  "CHF"),
    ("CASH DEPOSIT FROM CLIENT",          250000.00,  "USD"),
    ("MANAGEMENT FEE Q2 2026",             -1875.00,  "USD"),
]


# ── Generators ─────────────────────────────────────────────────────


def gen_cash(portfolio_id: str, business_date: date) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["date", "description", "amount", "currency",
                "balance_after", "external_id"])
    balance = 50_000.00
    for i, (desc, amount, ccy) in enumerate(CASH_DESCRIPTIONS, start=1):
        balance += amount if ccy == "USD" else 0  # rough running USD balance
        w.writerow([
            business_date.isoformat(),
            desc,
            f"{amount:.2f}",
            ccy,
            f"{balance:.2f}",
            f"CASH-{business_date.isoformat()}-{i:03d}",
        ])
    return out.getvalue()


def gen_securities(portfolio_id: str, business_date: date) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow([
        "trade_date", "settlement_date", "external_trade_id",
        "isin", "instrument_name", "side",
        "quantity", "price", "gross_amount", "net_amount", "fees",
        "currency",
    ])
    settle = business_date + timedelta(days=2)
    trades = [
        ("US0378331005", "APPLE INC",          "BUY",   50, 182.34, "USD"),
        ("US5949181045", "MICROSOFT CORP",     "SELL",  30, 415.20, "USD"),
        ("CH0012032048", "ROCHE HOLDING AG",   "BUY",   12, 275.50, "CHF"),
        ("US67066G1040", "NVIDIA CORP",        "BUY",    8, 920.00, "USD"),
    ]
    for i, (isin, name, side, qty, price, ccy) in enumerate(trades, start=1):
        gross = qty * price
        fees = round(gross * 0.0005, 2)
        net = gross + fees if side == "BUY" else gross - fees
        w.writerow([
            business_date.isoformat(),
            settle.isoformat(),
            f"TRD-{business_date.isoformat()}-{i:03d}",
            isin, name, side,
            qty, f"{price:.4f}", f"{gross:.2f}", f"{net:.2f}", f"{fees:.2f}",
            ccy,
        ])
    return out.getvalue()


def gen_positions(portfolio_id: str, business_date: date) -> str:
    """Position snapshot. Note: deliberately *omits* one ISIN that
    Beakon's TaxLot table will know about, so the demo shows a real
    reconciliation break."""
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["as_of", "isin", "instrument_name", "quantity",
                "market_value", "average_cost", "currency"])
    positions = [
        ("US0378331005", "APPLE INC",          150, 27351.00, 178.20, "USD"),
        ("US5949181045", "MICROSOFT CORP",      70, 29064.00, 402.10, "USD"),
        ("US02079K3059", "ALPHABET INC CL A",   40,  7128.00, 165.80, "USD"),
        # ROCHE intentionally left out (mismatch vs TaxLot for the demo)
        ("US67066G1040", "NVIDIA CORP",         28, 25760.00, 905.00, "USD"),
        ("CH0038863350", "NESTLE SA",           80,  7920.00,  98.40, "CHF"),
    ]
    for isin, name, qty, mv, avg, ccy in positions:
        w.writerow([
            business_date.isoformat(),
            isin, name, qty,
            f"{mv:.2f}", f"{avg:.4f}",
            ccy,
        ])
    return out.getvalue()


def gen_performance(portfolio_id: str, business_date: date) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["as_of", "period", "return_pct", "return_amount", "currency"])
    for period, pct, amt in [
        ("DTD",  0.4500,    392.45),
        ("MTD",  1.2300,   1075.20),
        ("YTD",  8.7500,   7642.30),
        ("ITD", 42.3000,  36912.00),
    ]:
        w.writerow([
            business_date.isoformat(), period,
            f"{pct:.4f}", f"{amt:.2f}", "USD",
        ])
    return out.getvalue()


def gen_orderbook(portfolio_id: str, business_date: date) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["order_date", "external_order_id", "isin", "instrument_name",
                "side", "quantity", "limit_price", "currency", "order_status"])
    orders = [
        (business_date - timedelta(days=1), "US67066G1040", "NVIDIA CORP",
         "BUY", 20, 925.00, "USD", "OPEN"),
        (business_date,                     "US0231351067", "AMAZON.COM INC",
         "SELL", 10, None,    "USD", "OPEN"),
        (business_date,                     "DE0007164600", "SAP SE",
         "BUY", 50, 152.30,  "EUR", "PARTIAL"),
    ]
    for d, isin, name, side, qty, limit, ccy, status in orders:
        w.writerow([
            d.isoformat(),
            f"ORD-{d.isoformat()}-{isin[-3:]}",
            isin, name, side, qty,
            f"{limit:.2f}" if limit is not None else "",
            ccy, status,
        ])
    return out.getvalue()


# ── Bundler ────────────────────────────────────────────────────────


def build_zip(portfolio_id: str, business_date: date, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    zip_name = f"{portfolio_id}_{business_date.isoformat()}.zip"
    zip_path = output_dir / zip_name

    files = {
        f"{portfolio_id}_cash.csv":       gen_cash(portfolio_id, business_date),
        f"{portfolio_id}_securities.csv": gen_securities(portfolio_id, business_date),
        f"{portfolio_id}_orderbook.csv":  gen_orderbook(portfolio_id, business_date),
        f"{portfolio_id}_positions.csv":  gen_positions(portfolio_id, business_date),
        f"{portfolio_id}_perf.csv":       gen_performance(portfolio_id, business_date),
    }

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, payload in files.items():
            zf.writestr(name, payload)

    return zip_path


# ── CLI ────────────────────────────────────────────────────────────


def main() -> int:
    p = argparse.ArgumentParser(description="Generate a mock Avaloq daily zip.")
    p.add_argument("--portfolio", default="BEAKON-DEMO-001",
                   help="Portfolio prefix used in filenames (default: BEAKON-DEMO-001).")
    p.add_argument("--business-date", default=None,
                   help="Reporting date (YYYY-MM-DD). Default: today.")
    p.add_argument("--output-dir", default="incoming",
                   help="Where to write the zip (default: ./incoming).")
    args = p.parse_args()

    bd = (date.fromisoformat(args.business_date)
          if args.business_date else date.today())
    out = Path(args.output_dir).resolve()
    zip_path = build_zip(args.portfolio, bd, out)
    size_kb = zip_path.stat().st_size / 1024
    print(f"Wrote {zip_path} ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
