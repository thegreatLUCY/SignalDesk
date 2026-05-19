"""Macro context from FRED (Federal Reserve Economic Data).

Same read-through-cache discipline as prices.py: we cache on OUR fetch time
(`macro.fetched_at`), not the data's own observation date — macro series
publish on irregular calendars (daily yields, monthly CPI), so "is the
newest observation today?" is the wrong staleness question. TTL is long
(macro barely moves intraday).

NO-GARBAGE rule, kept: every number here is fetched verbatim from FRED. The
one derived figure (CPI YoY) is plain deterministic arithmetic over two real
observations, and is OMITTED (never guessed) if either point is missing —
exactly how Tier-0 returns None on thin data.

Best-effort by contract: if the key is absent or FRED is down, callers get
whatever is cached (possibly nothing). It must NEVER raise into the briefing
— macro is enrichment, not a dependency.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from app.db import get_macro, replace_macro_series

FRED_API_KEY = os.environ.get("FRED_API_KEY", "").strip()
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

# How long a cached macro snapshot is "fresh enough". 6h: yields update once
# daily, CPI monthly — re-pulling more often would just waste calls.
CACHE_TTL = timedelta(hours=6)

# (FRED series id, human label, unit). Order = display order.
SERIES: list[tuple[str, str, str]] = [
    ("DGS10", "10Y Treasury", "%"),
    ("DGS2", "2Y Treasury", "%"),
    ("T10Y2Y", "10Y–2Y Spread", "pp"),   # FRED's own spread → fetched, not computed
    ("DFF", "Fed Funds", "%"),
    ("UNRATE", "Unemployment", "%"),
    ("CPI_YOY", "CPI YoY", "%"),         # derived from CPIAUCSL (see below)
]


def _fred(series_id: str, limit: int) -> list[dict]:
    """Newest `limit` observations for a FRED series, newest first.
    Returns [] on any failure — callers degrade gracefully."""
    if not FRED_API_KEY:
        return []
    url = (
        f"{FRED_BASE}?series_id={series_id}&api_key={FRED_API_KEY}"
        f"&file_type=json&sort_order=desc&limit={limit}"
    )
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.loads(r.read())
        return data.get("observations", [])
    except (urllib.error.URLError, ValueError, TimeoutError):
        return []


def _latest_valid(obs: list[dict]) -> tuple[float, str] | None:
    """First observation with a real numeric value. FRED encodes 'missing'
    as the string '.', which we must skip, not coerce to 0."""
    for o in obs:
        v = o.get("value", ".")
        if v not in (".", "", None):
            try:
                return float(v), o.get("date", "")
            except ValueError:
                continue
    return None


def _cpi_yoy() -> tuple[float, str] | None:
    """CPI YoY % from CPIAUCSL: (latest / value≈12 months earlier − 1)·100.
    13 monthly points = latest + the same month last year. Deterministic
    arithmetic over two REAL observations; None if we can't get both."""
    obs = _fred("CPIAUCSL", 13)
    if len(obs) < 13:
        return None
    cur = _latest_valid(obs[:1])
    prior = _latest_valid(obs[12:13])
    if not cur or not prior or prior[0] == 0:
        return None
    return round((cur[0] / prior[0] - 1.0) * 100.0, 2), cur[1]


def _stale(rows: list[dict]) -> bool:
    if not rows:
        return True
    newest = max((r["fetched_at"] for r in rows), default=None)
    if not newest:
        return True
    age = datetime.now(timezone.utc) - datetime.fromisoformat(newest)
    return age > CACHE_TTL


def refresh() -> None:
    """Pull every series from FRED and replace the cached rows. Silent on
    failure for any single series (that series just keeps its old value)."""
    now = datetime.now(timezone.utc).isoformat()
    for sid, _label, _unit in SERIES:
        if sid == "CPI_YOY":
            res = _cpi_yoy()
        else:
            res = _latest_valid(_fred(sid, 1))
        if res is not None:
            replace_macro_series(sid, res[0], res[1], now)


def get_snapshot() -> list[dict]:
    """Read-through: refresh if our last pull is older than the TTL, then
    return the cached series in display order with labels/units attached."""
    rows = get_macro()
    if _stale(rows):
        refresh()
        rows = get_macro()
    by_id = {r["series"]: r for r in rows}
    out = []
    for sid, label, unit in SERIES:
        r = by_id.get(sid)
        out.append(
            {
                "series": sid,
                "label": label,
                "unit": unit,
                "value": r["value"] if r else None,
                "observed_at": r["observed_at"] if r else None,
                "fetched_at": r["fetched_at"] if r else None,
            }
        )
    return out


def macro_facts_line() -> str:
    """A single deterministic line for the briefing PROMPT — real numbers the
    LLM may narrate but never invent. Empty string if we have nothing (so
    the briefing simply omits macro rather than fabricating it)."""
    snap = [s for s in get_snapshot() if s["value"] is not None]
    if not snap:
        return ""
    parts = []
    for s in snap:
        v = s["value"]
        tag = ""
        if s["series"] == "T10Y2Y":
            tag = " (inverted)" if v < 0 else " (normal)"
        parts.append(f"{s['label']} {v}{s['unit']}{tag}")
    return "MACRO (FRED, deterministic): " + "; ".join(parts)
