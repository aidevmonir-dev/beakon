"""FX rate resolution.

Rates live in ``FXRate`` as (from, to, as_of) rows. For a given JE date
we pick the most recent rate on or before the date. Same-currency lookups
short-circuit to 1.0.
"""
from decimal import Decimal
from datetime import date as dt_date

from django.db.models import Q

from .. import constants as c
from ..exceptions import FXRateMissing
from ..models import FXRate


ONE = Decimal("1")


class FXService:
    @staticmethod
    def rate(*, from_currency: str, to_currency: str, as_of: dt_date) -> Decimal:
        """Return the exchange rate from ``from_currency`` to ``to_currency``
        on ``as_of``. Uses the most recent rate on or before the date.

        Raises FXRateMissing if no rate exists. Same-currency returns 1.0.
        """
        if from_currency == to_currency:
            return ONE

        row = (
            FXRate.objects
            .filter(
                from_currency=from_currency,
                to_currency=to_currency,
                as_of__lte=as_of,
            )
            .order_by("-as_of").first()
        )
        if row:
            return row.rate

        # Try the inverse rate
        inverse = (
            FXRate.objects
            .filter(
                from_currency=to_currency,
                to_currency=from_currency,
                as_of__lte=as_of,
            )
            .order_by("-as_of").first()
        )
        if inverse and inverse.rate > 0:
            return ONE / inverse.rate

        raise FXRateMissing(
            f"No FX rate for {from_currency} → {to_currency} on or before {as_of}.",
            code=c.ERR_FX_RATE_MISSING,
            details={"from": from_currency, "to": to_currency, "as_of": str(as_of)},
        )

    @staticmethod
    def convert(amount: Decimal, *, from_currency: str, to_currency: str, as_of: dt_date) -> Decimal:
        """Convert amount from one currency to another as of ``as_of``.
        Rounds to 4 decimals (kernel precision)."""
        rate = FXService.rate(
            from_currency=from_currency, to_currency=to_currency, as_of=as_of,
        )
        return (amount * rate).quantize(Decimal("0.0001"))
