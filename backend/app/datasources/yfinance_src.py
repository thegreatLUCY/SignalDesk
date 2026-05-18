"""yfinance adapter — equities & index (e.g. AAPL, SPY, ^VIX).

Technical note on what yfinance actually is: NOT an official Yahoo API. It
queries Yahoo Finance's internal JSON endpoints and hands back a pandas
DataFrame. Consequences we design around: no SLA (can rate-limit/break), and
equity quotes are typically ~15 min delayed. That fragility is exactly why
the layer above this caches results in SQLite instead of calling it on every
page load.
"""
import yfinance as yf

from app.models import Candle


class YFinanceSource:
    name = "yfinance"

    def get_ohlc(self, ticker: str, days: int) -> list[Candle]:
        # period like "180d"; interval 1d = one candle per trading day.
        # auto_adjust=True gives split/dividend-adjusted prices (what a chart
        # should show). yfinance skips weekends/holidays automatically.
        df = yf.Ticker(ticker).history(
            period=f"{days}d", interval="1d", auto_adjust=True
        )
        candles: list[Candle] = []
        for ts, row in df.iterrows():
            candles.append(
                Candle(
                    time=ts.date().isoformat(),
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    volume=float(row["Volume"]),
                )
            )
        return candles
