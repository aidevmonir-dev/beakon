"""Process-local rate-limit guard for Anthropic Claude calls.

Anthropic's default tier caps Haiku at 5 requests/minute *per organization*
— that ceiling is shared across every feature in this app (bank
categorization, OCR, AI drafting, narrative, ask, CoA import). Without a
shared throttle, three of those features running concurrently can each
fire their own request and trip the 429 even if no single feature is
"busy".

This module centralises the throttle so all Claude callers go through one
counter. Process-local (``threading.Lock``) — for multi-worker deploys
swap in a Redis-backed limiter, but for dev / single-tenant family-office
use this prevents the 429 cascade on rapid clicks.

Usage:

    from beakon_core.services.anthropic_throttle import claude_throttle, raise_friendly_rate_limit

    claude_throttle()  # blocks if needed
    try:
        message = client.messages.create(**kwargs)
    except anthropic.RateLimitError as e:
        raise_friendly_rate_limit(e, code="BNK010_RATE_LIMIT")
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import NoReturn

from beakon_core.exceptions import ValidationError


# Leave one slot of headroom for retries / unexpected concurrency.
RPM_LIMIT = 4
WINDOW_SECONDS = 60.0

_call_times: "deque[float]" = deque()
_lock = threading.Lock()


def claude_throttle() -> None:
    """Block until making a Claude call would stay under the RPM limit."""
    with _lock:
        now = time.monotonic()
        while _call_times and now - _call_times[0] >= WINDOW_SECONDS:
            _call_times.popleft()
        if len(_call_times) >= RPM_LIMIT:
            wait = WINDOW_SECONDS - (now - _call_times[0]) + 0.25
            if wait > 0:
                time.sleep(wait)
            now = time.monotonic()
            while _call_times and now - _call_times[0] >= WINDOW_SECONDS:
                _call_times.popleft()
        _call_times.append(time.monotonic())


def raise_friendly_rate_limit(error, *, code: str) -> NoReturn:
    """Convert an anthropic.RateLimitError into a clean ValidationError.

    Reads ``Retry-After`` (seconds) from the response headers when present
    so the UI can tell the user how long to wait without leaking the raw
    Anthropic JSON.
    """
    retry_after: int | None = None
    try:
        retry_after = int(error.response.headers.get("retry-after", "0")) or None
    except (AttributeError, ValueError, TypeError):
        retry_after = None
    wait_msg = (
        f"Try again in ~{retry_after}s."
        if retry_after else "Try again shortly."
    )
    raise ValidationError(
        f"Claude rate limit reached (5 requests/minute per org). {wait_msg} "
        "Tip: set OCR_BACKEND=ollama to fall back to the local model.",
        code=code,
        details={"retry_after": retry_after},
    )
