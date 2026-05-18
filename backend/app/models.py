"""Pydantic models = the shape of data the API speaks.

Defining the shape once gives us validation + JSON serialization + it shows
up in the auto-generated /docs. The DB, the API, and (later) the MCP tools
all speak this same `Asset` contract.
"""
from pydantic import BaseModel


class Asset(BaseModel):
    id: int
    symbol: str
    yf_ticker: str | None
    asset_class: str          # 'equity' | 'index' | 'crypto'
    aliases: list[str]
    enabled: bool


class Candle(BaseModel):
    # `time` is a plain 'YYYY-MM-DD' string on purpose: that's exactly the
    # format TradingView lightweight-charts wants for daily candles (Phase 4),
    # so the API output drops straight into the chart with no reshaping.
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class OHLCResponse(BaseModel):
    symbol: str
    asset_class: str
    source: str               # which adapter served it: 'yfinance' | 'binance'
    cached: bool              # True = served from SQLite, no network hit
    candles: list[Candle]


class MAPoint(BaseModel):
    time: str
    value: float


class SignalSummary(BaseModel):
    # All optional: Tier 0 returns None when data is insufficient rather than
    # guessing. The UI must handle nulls (shows "—").
    trend: str | None
    pct_change: float | None
    volume_flag: str | None
    vix_regime: str | None
    status: str
    last_close: float | None
    rsi: float | None
    rsi_zone: str | None
    atr_pct: float | None
    dist_high_pct: float | None
    dist_low_pct: float | None


class WatchlistSignal(SignalSummary):
    symbol: str
    asset_class: str
    computed_at: str


class AssetSignals(SignalSummary):
    symbol: str
    computed_at: str
    # Keyed overlay series; frontend maps key → color+label in one place.
    lines: dict[str, list[MAPoint]]


class Briefing(BaseModel):
    id: int
    date: str
    body: str
    # provenance is free-form JSON: who wrote it (tier/provider/model), when,
    # and the signal snapshot it was based on. The UI badges this so you
    # always know if it was the free model or the templated fallback.
    provenance: dict
    created_at: str


class Annotation(BaseModel):
    id: int
    briefing_id: int
    body: str
    provenance: dict  # {tier:2, provider:'claude'|'manual', model, ...}
    created_at: str


class BriefingListItem(BaseModel):
    # Lightweight row for the date browser — no body, just enough to label it.
    date: str
    provider: str
    model: str
    risk_stance: str | None
    created_at: str


class AssetAnalysisItem(BaseModel):
    id: int
    symbol: str
    date: str
    body: str
    provenance: dict  # tier 1 (auto) or tier 2 (deep-dive) + provider/model
    created_at: str


class BriefingDetail(Briefing):
    # The Tier-1 draft PLUS its Tier-2 annotations layered on top. The draft
    # is never mutated; annotations are append-only rows (the git-like rule).
    annotations: list[Annotation]
