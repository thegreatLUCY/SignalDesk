"""Factory: pick the adapter from an asset's class.

This is the ONE place the crypto/equity decision lives. Everywhere else just
calls source.get_ohlc(...) and stays ignorant of which source it is — that's
the payoff of the Protocol in base.py.
"""
from app.datasources.base import DataSource
from app.datasources.binance_src import BinanceSource
from app.datasources.yfinance_src import YFinanceSource

_YF = YFinanceSource()
_BINANCE = BinanceSource()


def source_for(asset_class: str) -> DataSource:
    if asset_class == "crypto":
        return _BINANCE
    return _YF  # equity, index, anything else → yfinance


def crypto_fallback() -> DataSource:
    """yfinance, used by prices.get_ohlc when the primary crypto source
    (Binance) doesn't list a symbol — e.g. privacy coins like XMR that
    Binance delisted but Yahoo still publishes."""
    return _YF
