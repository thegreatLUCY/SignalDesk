"""Read-through cache: serve candles from SQLite; only hit the network when
the cache is missing or older than a TTL.

Why a cache at all: yfinance is fragile and rate-limited. If every dashboard
load called it, you'd get throttled and the UI would be slow. Instead the
`prices` table is what the API reads; the network is touched only to *fill*
it. A network hiccup then degrades to slightly-stale data, not a broken page.

Freshness rule (the lesson from the Phase 3 bug): staleness is measured by
WHEN WE LAST FETCHED, not by the data's own date. Market data legitimately
lags real time (weekends, holidays, pre-close, yfinance's ~15-min delay), so
a rule like "newest candle older than today" would report stale forever and
never cache. We use a TTL on our own fetch timestamp instead.
"""
from datetime import datetime, timedelta, timezone

from app.datasources import source_for
from app.db import (
    get_asset_by_symbol,
    get_last_fetch,
    read_prices,
    set_last_fetch,
    upsert_prices,
)

# 15 min ≈ yfinance's own delay for equities — fetching more often than the
# upstream even updates would be pointless load.
CACHE_TTL = timedelta(minutes=15)


def _is_stale(asset_id: int, cached: list[dict]) -> bool:
    if not cached:
        return True
    last = get_last_fetch(asset_id)
    if last is None:
        return True
    age = datetime.now(timezone.utc) - datetime.fromisoformat(last)
    return age > CACHE_TTL


def get_ohlc(symbol: str, days: int = 180) -> dict:
    """Return OHLC for a symbol/alias via the cache, with metadata about
    where it came from (source adapter + whether it was a cache hit)."""
    asset = get_asset_by_symbol(symbol)
    if asset is None:
        raise KeyError(symbol)

    source = source_for(asset["asset_class"])
    cached = read_prices(asset["id"], days)
    served_from_cache = True

    if _is_stale(asset["id"], cached):
        # yfinance wants the yf_ticker (^VIX); Binance maps from the symbol.
        ticker = (
            asset["symbol"]
            if asset["asset_class"] == "crypto"
            else (asset["yf_ticker"] or asset["symbol"])
        )
        try:
            fresh = source.get_ohlc(ticker, days)
            if fresh:
                upsert_prices(asset["id"], [c.model_dump() for c in fresh])
                set_last_fetch(
                    asset["id"], datetime.now(timezone.utc).isoformat()
                )
                cached = read_prices(asset["id"], days)
                served_from_cache = False
        except Exception:
            # Network/source failure → fall back to whatever we cached before.
            # Graceful degradation applied to the data layer: the dashboard
            # stays usable on stale data rather than erroring.
            if not cached:
                raise

    return {
        "symbol": asset["symbol"],
        "asset_class": asset["asset_class"],
        "source": source.name,
        "cached": served_from_cache,
        "candles": cached,
    }
