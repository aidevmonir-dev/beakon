"""Portfolio domain models populated by custodian SFTP feeds.

These mirror the four non-cash files in the Avaloq daily zip:

  - PortfolioTrade       ← XXX_securities  (yesterday's securities trades)
  - PositionSnapshot     ← XXX_positions   (daily position snapshot, container-level)
  - PerformanceSnapshot  ← XXX_perf        (daily P&L per container/period)
  - OpenOrder            ← XXX_orderbook   (current open orders)

Cash movements (XXX_cash) flow into ``beakon_banking.BankTransaction``
through the existing FeedImport dedup pipeline.

All four models FK back to ``beakon_banking.AvaloqFeedDrop`` so we can
trace any row to the zip it came from. They are *snapshots / events* —
positions and performance are written fresh for every (as_of, ...)
key; trades and orders are append-only with idempotency on the bank's
external id.

The format the bank ships is preliminary (mock CSV) until we get real
samples. Schema-level fields below are stable; the parser-level column
mapping isolates the format-specific work.
"""
from __future__ import annotations

from django.db import models

from organizations.models import Organization


# Side of a securities trade or order
SIDE_BUY = "BUY"
SIDE_SELL = "SELL"
SIDE_CHOICES = [
    (SIDE_BUY, "Buy"),
    (SIDE_SELL, "Sell"),
]


# Performance reporting periods
PERF_DTD = "DTD"     # day-to-date (today's P&L)
PERF_MTD = "MTD"     # month-to-date
PERF_YTD = "YTD"     # year-to-date
PERF_ITD = "ITD"     # inception-to-date
PERF_PERIOD_CHOICES = [
    (PERF_DTD, "Day-to-date"),
    (PERF_MTD, "Month-to-date"),
    (PERF_YTD, "Year-to-date"),
    (PERF_ITD, "Inception-to-date"),
]


# Open-order status
ORDER_OPEN = "OPEN"
ORDER_PARTIAL = "PARTIAL"
ORDER_CANCELLED = "CANCELLED"
ORDER_FILLED = "FILLED"
ORDER_STATUS_CHOICES = [
    (ORDER_OPEN, "Open"),
    (ORDER_PARTIAL, "Partially filled"),
    (ORDER_CANCELLED, "Cancelled"),
    (ORDER_FILLED, "Filled"),
]


class PortfolioTrade(models.Model):
    """A securities buy/sell as reported by the custodian feed."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_portfolio_trades",
    )
    portfolio = models.ForeignKey(
        "Portfolio", on_delete=models.PROTECT,
        related_name="trades",
    )
    custodian = models.ForeignKey(
        "Custodian", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="trades",
    )
    drop = models.ForeignKey(
        "beakon_banking.AvaloqFeedDrop", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="portfolio_trades",
    )

    external_trade_id = models.CharField(
        max_length=80,
        help_text="Bank's stable trade reference. Idempotency key.",
    )
    trade_date = models.DateField()
    settlement_date = models.DateField(null=True, blank=True)

    isin = models.CharField(max_length=24)
    instrument_name = models.CharField(max_length=255, blank=True)
    side = models.CharField(max_length=4, choices=SIDE_CHOICES)
    quantity = models.DecimalField(max_digits=20, decimal_places=6)
    price = models.DecimalField(max_digits=20, decimal_places=6)
    gross_amount = models.DecimalField(max_digits=20, decimal_places=4)
    net_amount = models.DecimalField(max_digits=20, decimal_places=4)
    fees = models.DecimalField(max_digits=20, decimal_places=4, default=0)
    currency = models.CharField(max_length=3)

    raw_row = models.JSONField(
        default=dict, blank=True,
        help_text="Verbatim CSV row for audit / re-parse.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "beakon_portfolio_trade"
        ordering = ["-trade_date", "-id"]
        unique_together = ("organization", "external_trade_id")
        indexes = [
            models.Index(fields=["organization", "portfolio", "trade_date"]),
            models.Index(fields=["organization", "isin"]),
            models.Index(fields=["drop"]),
        ]

    def __str__(self):
        return f"{self.trade_date} {self.side} {self.quantity} {self.isin} @ {self.price}"


class PositionSnapshot(models.Model):
    """Per-ISIN holdings as of a date — the reconciliation anchor.

    The bank's snapshot is the authoritative truth. Beakon's running
    TaxLot view should reconcile to this; disagreements raise a
    ``ReconciliationBreak``.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_position_snapshots",
    )
    portfolio = models.ForeignKey(
        "Portfolio", on_delete=models.PROTECT,
        related_name="position_snapshots",
    )
    drop = models.ForeignKey(
        "beakon_banking.AvaloqFeedDrop", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="position_snapshots",
    )

    as_of = models.DateField()
    isin = models.CharField(max_length=24)
    instrument_name = models.CharField(max_length=255, blank=True)
    quantity = models.DecimalField(max_digits=20, decimal_places=6)
    market_value = models.DecimalField(max_digits=20, decimal_places=4)
    average_cost = models.DecimalField(
        max_digits=20, decimal_places=6, null=True, blank=True,
    )
    currency = models.CharField(max_length=3)

    raw_row = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "beakon_position_snapshot"
        ordering = ["-as_of", "isin"]
        unique_together = ("organization", "portfolio", "as_of", "isin")
        indexes = [
            models.Index(fields=["organization", "portfolio", "as_of"]),
            models.Index(fields=["organization", "isin", "as_of"]),
            models.Index(fields=["drop"]),
        ]

    def __str__(self):
        return f"{self.as_of} {self.portfolio_id} {self.isin} qty={self.quantity}"


class PerformanceSnapshot(models.Model):
    """Daily P&L per container × period."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_performance_snapshots",
    )
    portfolio = models.ForeignKey(
        "Portfolio", on_delete=models.PROTECT,
        related_name="performance_snapshots",
    )
    drop = models.ForeignKey(
        "beakon_banking.AvaloqFeedDrop", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="performance_snapshots",
    )

    as_of = models.DateField()
    period = models.CharField(max_length=4, choices=PERF_PERIOD_CHOICES)
    return_pct = models.DecimalField(
        max_digits=10, decimal_places=4,
        help_text="Period return in percent, e.g. 1.2500 = +1.25%.",
    )
    return_amount = models.DecimalField(
        max_digits=20, decimal_places=4, null=True, blank=True,
        help_text="Absolute P&L in the portfolio's reporting currency.",
    )
    currency = models.CharField(max_length=3, blank=True)

    raw_row = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "beakon_performance_snapshot"
        ordering = ["-as_of", "portfolio_id", "period"]
        unique_together = ("organization", "portfolio", "as_of", "period")
        indexes = [
            models.Index(fields=["organization", "portfolio", "as_of"]),
            models.Index(fields=["drop"]),
        ]

    def __str__(self):
        return f"{self.as_of} {self.portfolio_id} {self.period}={self.return_pct}%"


class OpenOrder(models.Model):
    """Open / pending order at the custodian.

    Informational only — open orders are not bookkeeping events. Useful
    for the dashboard and for sanity-checking that an unexpected next-day
    trade was actually a known pending order.
    """

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="beakon_open_orders",
    )
    portfolio = models.ForeignKey(
        "Portfolio", on_delete=models.PROTECT,
        related_name="open_orders",
    )
    drop = models.ForeignKey(
        "beakon_banking.AvaloqFeedDrop", on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="open_orders",
    )

    external_order_id = models.CharField(max_length=80)
    order_date = models.DateField()
    isin = models.CharField(max_length=24)
    instrument_name = models.CharField(max_length=255, blank=True)
    side = models.CharField(max_length=4, choices=SIDE_CHOICES)
    quantity = models.DecimalField(max_digits=20, decimal_places=6)
    limit_price = models.DecimalField(
        max_digits=20, decimal_places=6, null=True, blank=True,
        help_text="Null for market orders.",
    )
    currency = models.CharField(max_length=3)
    order_status = models.CharField(
        max_length=12, choices=ORDER_STATUS_CHOICES, default=ORDER_OPEN,
    )

    raw_row = models.JSONField(default=dict, blank=True)
    last_seen_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "beakon_open_order"
        ordering = ["-order_date", "-id"]
        unique_together = ("organization", "external_order_id")
        indexes = [
            models.Index(fields=["organization", "portfolio", "order_status"]),
            models.Index(fields=["drop"]),
        ]

    def __str__(self):
        return f"{self.order_date} {self.side} {self.quantity} {self.isin} ({self.order_status})"
