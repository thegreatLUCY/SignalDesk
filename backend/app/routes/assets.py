"""/assets — read the asset registry.

This is the whole point of "assets are data": the watchlist is rows, and
every later feature (charts, signals, briefings) will iterate this list
instead of hard-coding symbols.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import (
    add_asset_analysis,
    get_asset_analysis_by_symbol,
    list_assets,
)
from app.models import Asset, AssetAnalysisItem, AssetSignals, OHLCResponse
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


@router.get("/{symbol}/analysis", response_model=list[AssetAnalysisItem])
def get_asset_analysis(symbol: str):
    """All notes for an asset — Tier-1 auto + Tier-2 deep-dives. Used by the
    MCP server (so the strong model can read prior context) and the UI."""
    return get_asset_analysis_by_symbol(symbol)


class AssetAnalysisIn(BaseModel):
    body: str
    provider: str = "manual"  # MCP sets 'claude' / 'codex'
    model: str = "manual"


@router.post("/{symbol}/analysis", response_model=AssetAnalysisItem)
def post_asset_analysis(symbol: str, a: AssetAnalysisIn):
    """Append a Tier-2 deep-dive (the MCP write path). Append-only — never
    touches the Tier-1 auto-note."""
    res = add_asset_analysis(
        symbol,
        a.body,
        {"tier": 2, "provider": a.provider, "model": a.model},
    )
    if res is None:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol}")
    return res
