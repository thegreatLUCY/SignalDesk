"""The DataSource abstraction — the heart of the data layer.

`Protocol` defines a *contract*: "anything with a get_ohlc(ticker, days)
method that returns list[Candle] is a DataSource." The signal engine, charts,
and briefing code depend on THIS, never on yfinance or Binance directly. That
is the Dependency Inversion principle: high-level code depends on an
abstraction, not on concrete libraries. Adding the future Binance *websocket*
later = one new class satisfying this Protocol; nothing else changes.
"""
from typing import Protocol

from app.models import Candle


class DataSource(Protocol):
    name: str

    def get_ohlc(self, ticker: str, days: int) -> list[Candle]:
        """Return up to `days` of daily candles, oldest first."""
        ...
