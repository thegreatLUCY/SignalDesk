"""Binance adapter — crypto (BTC-USD, ETH-USD, SOL-USD).

Uses Binance's free PUBLIC REST endpoint /api/v3/klines — no API key, no
account. This is the "REST polling a better source" idea: not the deferred
websocket, just a cleaner HTTP call than yfinance for crypto. Same Candle
contract as the yfinance adapter, so callers can't tell which one they got.
"""
from datetime import datetime, timezone

import requests

from app.models import Candle

BINANCE_KLINES = "https://api.binance.com/api/v3/klines"


class BinanceSource:
    name = "binance"

    def _pair(self, ticker: str) -> str:
        # Our registry uses "BTC-USD"; Binance trades against USDT ("BTCUSDT").
        base = ticker.split("-")[0].upper()
        return f"{base}USDT"

    def get_ohlc(self, ticker: str, days: int) -> list[Candle]:
        resp = requests.get(
            BINANCE_KLINES,
            params={
                "symbol": self._pair(ticker),
                "interval": "1d",
                "limit": min(days, 1000),  # Binance caps a single call at 1000
            },
            timeout=10,
        )
        resp.raise_for_status()
        candles: list[Candle] = []
        # Each kline: [openTime(ms), open, high, low, close, volume, ...]
        for k in resp.json():
            day = datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc).date()
            candles.append(
                Candle(
                    time=day.isoformat(),
                    open=float(k[1]),
                    high=float(k[2]),
                    low=float(k[3]),
                    close=float(k[4]),
                    volume=float(k[5]),
                )
            )
        return candles
