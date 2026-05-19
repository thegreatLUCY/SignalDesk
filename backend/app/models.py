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


class BriefingDetail(Briefing):
    # The Tier-1 draft PLUS its Tier-2 annotations layered on top. The draft
    # is never mutated; annotations are append-only rows (the git-like rule).
    annotations: list[Annotation]


# ── Phase 9: journal ────────────────────────────────────────────────────────


class JournalEntry(BaseModel):
    id: int
    kind: str                       # 'real' | 'paper' | 'observation'
    symbol: str | None
    side: str | None                # 'long' | 'short' | None
    entry: float | None
    exit: float | None
    size: float | None
    status: str                     # 'open' | 'closed'
    thesis: str | None              # why I entered
    outcome: str | None             # the lesson, filled on close
    opened_at: str | None
    closed_at: str | None
    created_at: str | None
    updated_at: str | None
    # DERIVED, never sent by the client — the deterministic conclusion.
    pl_abs: float | None
    pl_pct: float | None


class JournalIn(BaseModel):
    kind: str = "observation"
    symbol: str | None = None
    side: str | None = None
    entry: float | None = None
    exit: float | None = None
    size: float | None = None
    status: str = "open"
    thesis: str | None = None
    outcome: str | None = None
    opened_at: str | None = None
    closed_at: str | None = None


class JournalPatch(BaseModel):
    # All optional: PATCH only touches the keys you send (the db layer
    # whitelists them anyway — defence in depth).
    kind: str | None = None
    symbol: str | None = None
    side: str | None = None
    entry: float | None = None
    exit: float | None = None
    size: float | None = None
    status: str | None = None
    thesis: str | None = None
    outcome: str | None = None
    opened_at: str | None = None
    closed_at: str | None = None


# ── Phase 9: notes ──────────────────────────────────────────────────────────


class Note(BaseModel):
    id: int
    symbol: str | None              # resolved from asset_id via JOIN
    title: str | None
    body: str | None
    pinned: bool
    created_at: str | None
    updated_at: str | None


class NoteIn(BaseModel):
    title: str = "Untitled"
    body: str = ""
    symbol: str | None = None


class NotePatch(BaseModel):
    title: str | None = None
    body: str | None = None
    symbol: str | None = None
    pinned: bool | None = None


# ── Phase 10: macro + news ──────────────────────────────────────────────────


class MacroPoint(BaseModel):
    series: str
    label: str
    unit: str
    value: float | None          # None = FRED gave us nothing (never guessed)
    observed_at: str | None      # the data's own date
    fetched_at: str | None       # when WE pulled it (the cache clock)


class NewsItem(BaseModel):
    id: int
    title: str
    url: str
    source: str
    saved_at: str


class NewsBrief(BaseModel):
    # Descriptive-only summary of fetched headlines. Provenance badged like
    # the briefing; deliberately NOT part of any signal/risk computation.
    body: str
    provider: str                # 'groq' | 'openrouter' | 'template' | 'none'
    model: str
    generated_at: str | None = None
