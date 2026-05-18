"""Orchestrates Tier 0: pull cached prices → run the PURE signals engine →
persist → shape the response.

Note the separation: `signals.py` is pure math and knows nothing about the
DB or network. THIS module does the I/O and calls into it. That boundary is
the whole reason Tier 0 is trustworthy and testable.
"""
from datetime import datetime, timezone

from app import signals
from app.db import (
    get_asset_by_symbol,
    get_previous_signal,
    list_assets,
    upsert_signal,
)
from app.prices import get_ohlc


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _market_vix_regime() -> str | None:
    """Compute the market-wide VIX regime ONCE (not per asset)."""
    try:
        v = get_ohlc("VIX")
        candles = v["candles"]
        last = candles[-1]["close"] if candles else None
        return signals.classify_vix(last)
    except Exception:
        return None  # VIX missing must not break everyone else's signals


def signals_for_symbol(symbol: str, days: int = 180) -> dict:
    asset = get_asset_by_symbol(symbol)
    if asset is None:
        raise KeyError(symbol)

    candles = get_ohlc(symbol, days)["candles"]
    regime = _market_vix_regime()
    summary = signals.compute(candles, regime)

    upsert_signal(asset["id"], _today(), summary)

    return {
        "symbol": asset["symbol"],
        "computed_at": _today(),
        **summary,
        "lines": signals.build_lines(candles),
    }


def _delta(prev: dict | None, cur: dict) -> str:
    """Deterministic 'what changed since the last observation'. Pure text
    built from two persisted summaries — no inference, no LLM."""
    if prev is None:
        return "first observation (no prior signal to compare)"
    parts: list[str] = []
    if prev.get("trend") != cur.get("trend"):
        parts.append(f"trend {prev.get('trend')}→{cur.get('trend')}")
    if prev.get("status") != cur.get("status"):
        parts.append(f"status {prev.get('status')}→{cur.get('status')}")
    pr, cr = prev.get("rsi"), cur.get("rsi")
    if pr is not None and cr is not None and abs(cr - pr) >= 5:
        parts.append(f"RSI {pr}→{cr}")
    return "; ".join(parts) if parts else "no material change"


def risk_stance(rows: list[dict], vix: str | None) -> dict:
    """DETERMINISTIC market risk-on/off call. The LLM never decides this —
    it only explains it. Score from three hard inputs: VIX regime, trend
    breadth, average move. Returns the call + the exact factual rationale."""
    score = {"calm": 2, "normal": 1, "elevated": -1, "stress": -2}.get(
        vix or "", 0
    )
    trends = [r["trend"] for r in rows if r["trend"]]
    up_ratio = (
        sum(1 for t in trends if t == "up") / len(trends) if trends else 0.0
    )
    pcts = [r["pct_change"] for r in rows if r["pct_change"] is not None]
    avg_pct = sum(pcts) / len(pcts) if pcts else 0.0

    score += 1 if up_ratio >= 0.6 else -1 if up_ratio <= 0.4 else 0
    score += 1 if avg_pct > 0.1 else -1 if avg_pct < -0.1 else 0

    call = "risk-on" if score >= 2 else "risk-off" if score <= -2 else "neutral"
    rationale = (
        f"VIX regime={vix or 'n/a'}; trend breadth="
        f"{up_ratio*100:.0f}% up; avg move={avg_pct:+.2f}%; score={score}"
    )
    return {"call": call, "rationale": rationale}


def enriched_watchlist() -> tuple[list[dict], dict, str | None]:
    """Briefing input builder: every asset with its Tier-0 summary PLUS
    deterministic context (multi-horizon returns, relative vs benchmark,
    flags, day-over-day delta). Persists today's base summary so tomorrow's
    delta works. Everything here is computed — nothing for the LLM to invent.
    """
    today = _today()
    regime = _market_vix_regime()
    spy = get_ohlc("SPY")["candles"]
    btc = get_ohlc("BTC-USD")["candles"]
    spy21 = signals.return_over(spy, 21)
    btc21 = signals.return_over(btc, 21)

    rows: list[dict] = []
    for a in list_assets(enabled_only=True):
        try:
            candles = get_ohlc(a["symbol"])["candles"]
        except Exception:
            continue
        s = signals.compute(candles, regime)
        prev = get_previous_signal(a["id"], today)
        upsert_signal(a["id"], today, s)  # persist base for tomorrow's delta

        ret21 = signals.return_over(candles, 21)
        bench = btc21 if a["asset_class"] == "crypto" else spy21
        rel21 = (
            None
            if ret21 is None or bench is None
            else round(ret21 - bench, 2)
        )
        rows.append(
            {
                "symbol": a["symbol"],
                "asset_class": a["asset_class"],
                **s,
                "ret_5d": signals.return_over(candles, 5),
                "ret_21d": ret21,
                "rel_21d": rel21,
                "flags": signals.compute_flags(candles, s),
                "delta": _delta(prev, s),
            }
        )
    return rows, risk_stance(rows, regime), regime


def signals_for_watchlist() -> list[dict]:
    """Latest summary for every enabled asset — feeds the sidebar columns.
    Computes the VIX regime once and reuses it for all rows."""
    regime = _market_vix_regime()
    out: list[dict] = []
    for a in list_assets(enabled_only=True):
        try:
            candles = get_ohlc(a["symbol"])["candles"]
            summary = signals.compute(candles, regime)
            upsert_signal(a["id"], _today(), summary)
            out.append(
                {
                    "symbol": a["symbol"],
                    "asset_class": a["asset_class"],
                    "computed_at": _today(),
                    **summary,
                }
            )
        except Exception:
            # One bad asset shouldn't blank the whole watchlist.
            continue
    return out
