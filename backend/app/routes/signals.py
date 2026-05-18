"""/signals — latest Tier 0 summary for the whole watchlist (sidebar columns)."""
from fastapi import APIRouter

from app.models import WatchlistSignal
from app.signal_service import signals_for_watchlist

router = APIRouter(prefix="/signals", tags=["signals"])


@router.get("", response_model=list[WatchlistSignal])
def get_watchlist_signals():
    return signals_for_watchlist()
