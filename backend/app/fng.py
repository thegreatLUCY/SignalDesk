"""Crypto Fear & Greed Index — `alternative.me/fng`.

Free public endpoint, no API key, no paid tier — fits the project's rules.
The number is computed by alternative.me from multiple inputs (volatility,
momentum, volume, social, dominance, trends). We display it verbatim. That
keeps the "no garbage in" contract: we narrate someone else's deterministic
number, we don't synthesise one.

Read-through cache pattern reused for the third time (prices, macro, news
were the others): the index publishes once a day, so 6h TTL is generous and
keeps us off the wire on every page load. The cache is in-memory because
it's a tiny derivative — one row, refresh on miss; no table needed.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

_URL = "https://api.alternative.me/fng/?limit=1"
_TTL = timedelta(hours=6)

# Single-cell in-memory cache: { "value": int, "label": str, "ts": str,
# "fetched_at": datetime } or None until first refresh.
_cache: dict | None = None


def _fetch() -> dict | None:
    """One call to alternative.me. Returns the normalised payload, or None
    on any failure — callers degrade to whatever was cached (possibly
    nothing). Never raises into the route."""
    try:
        with urllib.request.urlopen(_URL, timeout=10) as r:
            payload = json.loads(r.read())
    except (urllib.error.URLError, ValueError, TimeoutError):
        return None
    rows = payload.get("data") or []
    if not rows:
        return None
    row = rows[0]
    try:
        value = int(row.get("value"))
    except (TypeError, ValueError):
        return None
    # The API returns a Unix epoch as a string — convert to ISO so the UI
    # can format it however it likes.
    try:
        ts = datetime.fromtimestamp(int(row["timestamp"]), tz=timezone.utc)
        observed_at = ts.isoformat()
    except Exception:
        observed_at = None
    return {
        "value": value,
        "label": row.get("value_classification") or _classify(value),
        "observed_at": observed_at,
    }


def _classify(value: int) -> str:
    """Fallback label if the API didn't send one — matches alternative.me's
    own bands so the UI looks the same either way."""
    if value < 25:
        return "Extreme Fear"
    if value < 45:
        return "Fear"
    if value < 55:
        return "Neutral"
    if value < 75:
        return "Greed"
    return "Extreme Greed"


def get_snapshot() -> dict | None:
    """Read-through: serve the cached value if fresh, otherwise refresh.
    Returns None only if there's no cached value AND the fetch failed
    (e.g. first-ever call with no network) — the route returns null and
    the UI shows a graceful empty state."""
    global _cache
    now = datetime.now(timezone.utc)
    if _cache and now - _cache["fetched_at"] < _TTL:
        return {k: v for k, v in _cache.items() if k != "fetched_at"}
    fresh = _fetch()
    if fresh is None:
        if _cache is None:
            return None
        return {k: v for k, v in _cache.items() if k != "fetched_at"}
    fresh["fetched_at"] = now
    _cache = fresh
    return {k: v for k, v in fresh.items() if k != "fetched_at"}
