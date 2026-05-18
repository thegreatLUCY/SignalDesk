"""Tier 1 — the automatic daily briefing (enriched, actionable).

Structure of every stored briefing body:

    **Risk stance: <CALL>** — <deterministic rationale>     ← computed, always
    <AI narrative, segmented>  (or templated fallback)       ← narrates facts
    ### Signals to watch
    <deterministic flag list>                                ← computed, always

No-hallucination contract: the LLM only ever receives DETERMINISTIC Tier-0
facts, and the risk call + signals-to-watch are rendered WITHOUT the LLM.
The model explains the call; it never makes it, and it never sees a raw
price or invents a number.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app import llm
from app.db import (
    get_briefing,
    list_assets,
    replace_tier1_asset_note,
    upsert_briefing,
)
from app.signal_service import enriched_watchlist


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _seg(rows: list[dict]) -> dict[str, list[dict]]:
    return {
        "equities": [r for r in rows if r["asset_class"] in ("equity", "index")],
        "crypto": [r for r in rows if r["asset_class"] == "crypto"],
    }


def _fmt(r: dict) -> str:
    def n(v, suf="%"):
        return "n/a" if v is None else f"{v:+.2f}{suf}" if suf == "%" else v

    rsi = "n/a" if r["rsi"] is None else f"{r['rsi']}({r['rsi_zone']})"
    rel = "n/a" if r["rel_21d"] is None else f"{r['rel_21d']:+.2f}%"
    flags = ", ".join(r["flags"]) if r["flags"] else "none"
    return (
        f"{r['symbol']}: 1d {n(r['pct_change'])}, 5d {n(r['ret_5d'])}, "
        f"21d {n(r['ret_21d'])} (rel-benchmark {rel}), trend={r['trend'] or 'n/a'}, "
        f"RSI={rsi}, ATR={n(r['atr_pct'])}, 52wHi={n(r['dist_high_pct'])}, "
        f"vol={r['volume_flag'] or 'n/a'}, status={r['status']}, "
        f"flags=[{flags}], Δsince-last: {r['delta']}"
    )


def _signals_to_watch(rows: list[dict]) -> str:
    """Deterministic — built ONLY from computed flags. Trustworthy even on
    the templated/no-key path, because no LLM touches it."""
    flagged = [r for r in rows if r["flags"]]
    if not flagged:
        return "_Nothing notable flagged today._"
    return "\n".join(f"- **{r['symbol']}** — {', '.join(r['flags'])}" for r in flagged)


# ── deterministic fallback narrative (no AI, no network) ─────────────────
def _templated(date: str, seg: dict, vix: str | None) -> str:
    def block(title: str, rs: list[dict], frame: str) -> str:
        if not rs:
            return f"### {title}\n_No assets._\n"
        return f"### {title} ({frame})\n" + "\n".join(
            f"- {_fmt(r)}" for r in rs
        ) + "\n"

    return (
        block("Equities & Indices", seg["equities"], "today / since the open")
        + "\n"
        + block("Crypto", seg["crypto"], "last 24h")
        + f"\n### Macro context\n- VIX regime: **{vix or 'n/a'}**.\n"
    )


_SYSTEM = (
    "You are a markets research assistant. You ONLY narrate the structured, "
    "already-computed signal data provided. You NEVER predict prices, NEVER "
    "invent or infer numbers, and NEVER change the risk stance (it is "
    "decided deterministically and given to you — your job is to EXPLAIN it "
    "using the provided facts). Treat Equities & Indices and Crypto as "
    "separate markets (equities: today/since the open; crypto: last 24h). "
    "Be concrete and prioritise what is unusual. Output Markdown with "
    "sections exactly: 'Risk read', 'Notable movers & anomalies', "
    "'What changed since yesterday', 'What to watch'. Call out divergences "
    "explicitly (e.g. price up while RSI falling)."
)


def _digest_prompt(date: str, seg: dict, stance: dict, vix: str | None) -> str:
    eq = "\n".join(_fmt(r) for r in seg["equities"]) or "(none)"
    cr = "\n".join(_fmt(r) for r in seg["crypto"]) or "(none)"
    return (
        f"Date: {date}\n"
        f"DETERMINISTIC RISK STANCE (do not change): {stance['call'].upper()} "
        f"— basis: {stance['rationale']}\n"
        f"Market regime (VIX): {vix or 'n/a'}\n\n"
        f"EQUITIES & INDICES:\n{eq}\n\nCRYPTO:\n{cr}\n\n"
        "Write the briefing. In 'Risk read', explain WHY the given stance "
        "holds using the breadth/VIX/move facts. Everywhere, ground every "
        "statement in the data above; do not speculate on direction."
    )


_ASSET_SYSTEM = (
    "You write ONE concise, decision-oriented watchlist note: plain prose, "
    "2–3 sentences, NO headings, NO bullets, NO price prediction, NO invented "
    "numbers. State the current setup and what specifically to watch, using "
    "ONLY the provided computed facts/flags."
)


def _asset_prompt(r: dict) -> str:
    return "Asset facts:\n" + _fmt(r) + "\nWrite the note."


def _asset_template(r: dict) -> str:
    return f"Auto-note: {_fmt(r)}"


def generate(date: str | None = None, force: bool = False) -> dict:
    date = date or _today()
    existing = get_briefing(date)
    if existing and not force:
        return existing

    rows, stance, vix = enriched_watchlist()
    seg = _seg(rows)

    ai = llm.narrate(_SYSTEM, _digest_prompt(date, seg, stance, vix))
    if ai:
        narrative = ai["text"]
        provenance = {"tier": 1, "provider": ai["provider"], "model": ai["model"]}
    else:
        narrative = _templated(date, seg, vix)
        provenance = {"tier": 1, "provider": "template", "model": "none"}

    # Deterministic top line + bottom section wrap the narrative. These are
    # always accurate regardless of AI vs fallback.
    body = (
        f"**Risk stance: {stance['call'].upper()}** — {stance['rationale']}\n\n"
        f"{narrative}\n\n---\n### Signals to watch\n"
        f"{_signals_to_watch(rows)}\n"
    )

    provenance.update(
        {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "risk_stance": stance["call"],
            "vix_regime": vix,
            "snapshot": [
                {"symbol": r["symbol"], "pct": r["pct_change"], "trend": r["trend"]}
                for r in rows
            ],
        }
    )
    upsert_briefing(date, body, provenance)

    id_by_symbol = {a["symbol"]: a["id"] for a in list_assets()}
    for r in rows:
        aid = id_by_symbol.get(r["symbol"])
        if aid is None:
            continue
        note = llm.narrate(_ASSET_SYSTEM, _asset_prompt(r))
        if note:
            n_body = note["text"]
            n_prov = {"tier": 1, "provider": note["provider"], "model": note["model"]}
        else:
            n_body = _asset_template(r)
            n_prov = {"tier": 1, "provider": "template", "model": "none"}
        n_prov["generated_at"] = datetime.now(timezone.utc).isoformat()
        replace_tier1_asset_note(aid, date, n_body, n_prov)

    return get_briefing(date)
