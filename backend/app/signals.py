"""Tier 0 — the deterministic signal engine (expanded).

Still PURE: no network, DB, or AI; plain candle dicts in, labels/series out.
That's what keeps it the trustworthy floor (can't hallucinate, always works,
trivially testable). The AI tiers narrate these; they never replace them.

Two kinds of output, by what they MEAN visually:

  • OVERLAY LINES (price scale) — things that live on the price axis and make
    sense drawn over candles: moving averages, Bollinger bands, 52-week
    high/low. Returned as time/value series for the chart.

  • SUMMARY METRICS — oscillators / volatility that do NOT belong on the
    price axis (RSI is 0–100, ATR is a distance). Returned as scalars + a
    plain-language zone, shown as text chips, not lines. Putting these on the
    price scale would be misleading — a deliberate design choice.

Every function returns None when data is too short, instead of guessing.
"""
from __future__ import annotations

import math

MA_PERIODS = (20, 50, 100)        # short / medium / long trend horizons
BB_PERIOD = 20                    # Bollinger: middle band = 20-MA
BB_K = 2.0                        # band width = mean ± 2 standard deviations
RSI_PERIOD = 14
ATR_PERIOD = 14
WINDOW_52W = 252                  # ~252 trading days ≈ 52 weeks
VOL_LOOKBACK = 20
VOL_SPIKE_RATIO = 1.5

# The "long" MA used for the trend label (short vs long cross).
TREND_SHORT, TREND_LONG = 20, 50


def _closes(c: list[dict]) -> list[float]:
    return [x["close"] for x in c]


# ── moving averages ──────────────────────────────────────────────────────
def latest_sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def sma_series(candles: list[dict], period: int) -> list[dict]:
    closes = _closes(candles)
    out = []
    for i in range(period - 1, len(closes)):
        out.append(
            {
                "time": candles[i]["time"],
                "value": sum(closes[i - period + 1 : i + 1]) / period,
            }
        )
    return out


# ── Bollinger Bands: volatility envelope around the 20-MA ─────────────────
# Wide bands = volatile; price riding/poking a band = stretched move.
def bollinger_series(
    candles: list[dict], period: int = BB_PERIOD, k: float = BB_K
) -> tuple[list[dict], list[dict]]:
    closes = _closes(candles)
    upper, lower = [], []
    for i in range(period - 1, len(closes)):
        window = closes[i - period + 1 : i + 1]
        mean = sum(window) / period
        var = sum((v - mean) ** 2 for v in window) / period
        sd = math.sqrt(var)
        t = candles[i]["time"]
        upper.append({"time": t, "value": mean + k * sd})
        lower.append({"time": t, "value": mean - k * sd})
    return upper, lower


# ── rolling 52-week high / low (context: extremes, breakouts, support) ────
def rolling_extreme_series(
    candles: list[dict], window: int, kind: str
) -> list[dict]:
    out = []
    for i in range(len(candles)):
        lo = max(0, i - window + 1)
        seg = candles[lo : i + 1]
        val = (
            max(x["high"] for x in seg)
            if kind == "high"
            else min(x["low"] for x in seg)
        )
        out.append({"time": candles[i]["time"], "value": val})
    return out


# ── momentum: RSI(14), Wilder's smoothing ────────────────────────────────
# >70 = overbought (stretched up), <30 = oversold (stretched down).
def rsi(candles: list[dict], period: int = RSI_PERIOD) -> float | None:
    closes = _closes(candles)
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):  # Wilder smoothing
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 1)


def rsi_zone(value: float | None) -> str | None:
    if value is None:
        return None
    if value >= 70:
        return "overbought"
    if value <= 30:
        return "oversold"
    return "neutral"


# ── volatility: ATR(14) as % of price ────────────────────────────────────
def atr_pct(candles: list[dict], period: int = ATR_PERIOD) -> float | None:
    if len(candles) < period + 1:
        return None
    trs = []
    for i in range(1, len(candles)):
        h, l, pc = (
            candles[i]["high"],
            candles[i]["low"],
            candles[i - 1]["close"],
        )
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    atr = sum(trs[-period:]) / period
    last = candles[-1]["close"]
    return round(atr / last * 100, 2) if last else None


# ── basics ───────────────────────────────────────────────────────────────
def pct_change(candles: list[dict]) -> float | None:
    cl = _closes(candles)
    if len(cl) < 2 or cl[-2] == 0:
        return None
    return (cl[-1] - cl[-2]) / cl[-2] * 100.0


def trend(candles: list[dict]) -> str | None:
    cl = _closes(candles)
    s, lng = latest_sma(cl, TREND_SHORT), latest_sma(cl, TREND_LONG)
    if s is None or lng is None:
        return None
    return "up" if s > lng else "down" if s < lng else "flat"


def volume_flag(candles: list[dict]) -> str | None:
    vols = [c["volume"] for c in candles]
    if len(vols) < VOL_LOOKBACK + 1:
        return None
    today = vols[-1]
    avg = sum(vols[-(VOL_LOOKBACK + 1) : -1]) / VOL_LOOKBACK
    if avg == 0:
        return None
    if today >= avg * VOL_SPIKE_RATIO:
        return "spike"
    if today <= avg * 0.5:
        return "thin"
    return "normal"


def classify_vix(v: float | None) -> str | None:
    if v is None:
        return None
    if v < 15:
        return "calm"
    if v < 20:
        return "normal"
    if v < 30:
        return "elevated"
    return "stress"


def dist_from_extreme_pct(candles: list[dict], kind: str) -> float | None:
    if not candles:
        return None
    seg = candles[-WINDOW_52W:]
    last = candles[-1]["close"]
    if kind == "high":
        ref = max(x["high"] for x in seg)
    else:
        ref = min(x["low"] for x in seg)
    return round((last - ref) / ref * 100, 2) if ref else None


def status_label(tr: str | None, pct: float | None) -> str:
    if tr == "up" and (pct or 0) >= 0:
        return "bullish"
    if tr == "down" and (pct or 0) <= 0:
        return "bearish"
    if tr is None:
        return "insufficient-data"
    return "mixed"


# ── public API ───────────────────────────────────────────────────────────
def compute(candles: list[dict], vix_regime: str | None) -> dict:
    """Scalar summary for one asset (sidebar + header chips). Pure."""
    tr = trend(candles)
    pct = pct_change(candles)
    r = rsi(candles)
    return {
        "trend": tr,
        "pct_change": round(pct, 2) if pct is not None else None,
        "volume_flag": volume_flag(candles),
        "vix_regime": vix_regime,
        "status": status_label(tr, pct),
        "last_close": round(candles[-1]["close"], 4) if candles else None,
        "rsi": r,
        "rsi_zone": rsi_zone(r),
        "atr_pct": atr_pct(candles),
        "dist_high_pct": dist_from_extreme_pct(candles, "high"),
        "dist_low_pct": dist_from_extreme_pct(candles, "low"),
    }


def return_over(candles: list[dict], n: int) -> float | None:
    """% change of close over the last n sessions. None if too short."""
    cl = _closes(candles)
    if len(cl) < n + 1 or cl[-1 - n] == 0:
        return None
    return round((cl[-1] - cl[-1 - n]) / cl[-1 - n] * 100, 2)


def ma_cross_state(candles: list[dict], lookback: int = 3) -> str | None:
    """Did the 20/50 MA relationship FLIP in the last `lookback` sessions?
    Deterministic: we compare the sign of (MA20-MA50) now vs `lookback` bars
    ago over the aligned region. 'fresh' = a recent regime change worth a
    flag; otherwise just the steady state."""
    cl = _closes(candles)
    if len(cl) < TREND_LONG + lookback:
        return None

    def diff_at(i: int) -> float:
        s = sum(cl[i - TREND_SHORT + 1 : i + 1]) / TREND_SHORT
        l = sum(cl[i - TREND_LONG + 1 : i + 1]) / TREND_LONG
        return s - l

    now = diff_at(len(cl) - 1)
    then = diff_at(len(cl) - 1 - lookback)
    if now >= 0 and then < 0:
        return "fresh-bull-cross"
    if now < 0 and then >= 0:
        return "fresh-bear-cross"
    return "bull" if now >= 0 else "bear"


def compute_flags(candles: list[dict], summary: dict) -> list[str]:
    """Deterministic notable conditions. Pure: derived only from numbers
    already computed. This list also powers the 'Signals to watch' section,
    which is rendered WITHOUT the LLM — so it can never be hallucinated."""
    flags: list[str] = []
    rsi_v = summary.get("rsi")
    if rsi_v is not None and rsi_v >= 70:
        flags.append("overbought")
    if rsi_v is not None and rsi_v <= 30:
        flags.append("oversold")

    dh = summary.get("dist_high_pct")
    dl = summary.get("dist_low_pct")
    if dh is not None and dh >= -2:
        flags.append("near 52w high")
    if dl is not None and dl <= 2:
        flags.append("near 52w low")

    vf = summary.get("volume_flag")
    if vf == "spike":
        flags.append("volume spike")
    if vf == "thin":
        flags.append("thin volume")

    cross = ma_cross_state(candles)
    if cross == "fresh-bull-cross":
        flags.append("fresh bullish MA cross")
    if cross == "fresh-bear-cross":
        flags.append("fresh bearish MA cross")

    # Bollinger breach: last close vs the latest 20/2σ band.
    up, lo = bollinger_series(candles)
    if up and lo and candles:
        c = candles[-1]["close"]
        if c >= up[-1]["value"]:
            flags.append("above upper Bollinger")
        elif c <= lo[-1]["value"]:
            flags.append("below lower Bollinger")
    return flags


def build_lines(candles: list[dict]) -> dict[str, list[dict]]:
    """All toggleable overlay series, keyed. The frontend maps key → color +
    label (one place), so adding an overlay later is data, not new plumbing."""
    bb_u, bb_l = bollinger_series(candles)
    return {
        "ma20": sma_series(candles, 20),
        "ma50": sma_series(candles, 50),
        "ma100": sma_series(candles, 100),
        "bb_upper": bb_u,
        "bb_lower": bb_l,
        "hi_252": rolling_extreme_series(candles, WINDOW_52W, "high"),
        "lo_252": rolling_extreme_series(candles, WINDOW_52W, "low"),
    }
