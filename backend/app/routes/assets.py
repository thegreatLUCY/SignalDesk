"""/assets — read the asset registry.

This is the whole point of "assets are data": the watchlist is rows, and
every later feature (charts, signals, briefings) will iterate this list
instead of hard-coding symbols.
"""
from fastapi import APIRouter, HTTPException

from app.db import list_assets
from app.models import Asset, AssetSignals, OHLCResponse
from app.prices import get_ohlc
from app.signal_service import signals_for_symbol

router = APIRouter(prefix="/assets", tags=["assets"])


@router.get("", response_model=list[Asset])
def get_assets(include_disabled: bool = False):
    """Return the watchlist. `?include_disabled=true` shows soft-removed ones."""
    return list_assets(enabled_only=not include_disabled)


@router.get("/{symbol}/ohlc", response_model=OHLCResponse)
def get_asset_ohlc(symbol: str, days: int = 180):
    """Daily candles for a symbol or alias (e.g. AAPL, BTC-USD, VIX, PFIZER).

    Read-through cached: first call fetches+stores, later calls serve from
    SQLite until the data is a day stale.
    """
    try:
        return get_ohlc(symbol, days=days)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol}")


@router.get("/{symbol}/signals", response_model=AssetSignals)
def get_asset_signals(symbol: str, days: int = 180):
    """Tier 0 signal summary + MA series for the chart overlay."""
    try:
        return signals_for_symbol(symbol, days=days)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol}")


# Per-asset notes (the old `asset_analysis` path) were removed: Tier-2 now
# lives ONLY as consolidated annotations on the daily briefing
# (/briefings/{date}/annotations). One Tier-2 surface, no duplication.
