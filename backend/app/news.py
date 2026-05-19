"""Market news via free public RSS — no API, no key, no paid tier.

Teaching point: an RSS/Atom feed is just XML. We parse it with the standard
library (`xml.etree.ElementTree`) instead of adding a `feedparser`
dependency — fewer moving parts, and it makes the feed structure visible:
  • RSS 2.0:  <rss><channel><item><title/><link/><pubDate/>
  • Atom:     <feed><entry><title/><link href=…/><updated/>
We tolerate both so a feed switching format doesn't silently break us.

Same read-through-cache idea as prices/macro: the freshest `news.saved_at`
is our "when did we last pull" clock; the route applies the TTL. The LLM
brief is DESCRIPTIVE ONLY — it summarises the headlines we actually fetched
(shown right beside it) and is structurally walled off from the
deterministic risk stance (it never enters signal/briefing computation).
"""
from __future__ import annotations

import urllib.error
import urllib.request
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

from app import llm
from app.db import get_news, upsert_news

# (source label, feed URL). Free, keyless, verified-reliable (MarketWatch
# was dropped — it 301-redirects to a stub). Diverse on purpose: market
# news (CNBC, WSJ) + policy (Fed).
FEEDS: list[tuple[str, str]] = [
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("WSJ Markets", "https://feeds.a.dj.com/rss/RSSMarketsMain.xml"),
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"),
]

_ATOM = "{http://www.w3.org/2005/Atom}"


def _text(el) -> str:
    return (el.text or "").strip() if el is not None else ""


def _parse(xml: bytes, source: str) -> list[dict]:
    """Extract (title, url, source) from RSS *or* Atom. Returns [] on a
    malformed feed rather than raising — one bad feed must not sink news."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    items: list[dict] = []

    # RSS 2.0
    for it in root.iter("item"):
        title = _text(it.find("title"))
        link = _text(it.find("link"))
        if title and link:
            items.append({"title": title, "url": link, "source": source})

    # Atom (only if RSS yielded nothing — avoids double-counting)
    if not items:
        for e in root.iter(f"{_ATOM}entry"):
            title = _text(e.find(f"{_ATOM}title"))
            link_el = e.find(f"{_ATOM}link")
            link = link_el.get("href") if link_el is not None else ""
            if title and link:
                items.append({"title": title, "url": link, "source": source})
    return items


def refresh() -> int:
    """Fetch every feed, store new headlines (deduped by URL in the db
    layer). Returns count of newly-saved items. A failing feed is skipped,
    not fatal."""
    now = datetime.now(timezone.utc).isoformat()
    collected: list[dict] = []
    for source, url in FEEDS:
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "SignalDesk/1.0 (local)"}
            )
            with urllib.request.urlopen(req, timeout=15) as r:
                xml = r.read()
        except (urllib.error.URLError, TimeoutError):
            continue
        for it in _parse(xml, source)[:25]:  # cap per feed
            it["saved_at"] = now
            collected.append(it)
    return upsert_news(collected)


_DESC_SYSTEM = (
    "You are a neutral news desk. Summarise ONLY the headlines provided — "
    "do NOT add facts, do NOT predict prices or markets, do NOT give a "
    "buy/sell/risk opinion. 3–5 short bullets grouping the headlines by "
    "theme, plainly factual. If headlines conflict, say so neutrally."
)


def _templated_brief(items: list[dict]) -> str:
    """Non-AI fallback: just the headlines, grouped by source. Always works,
    never fabricates — same contract as the briefing's templated path."""
    by_src: dict[str, list[str]] = {}
    for i in items:
        by_src.setdefault(i["source"], []).append(i["title"])
    out = []
    for src, titles in by_src.items():
        out.append(f"**{src}**")
        out += [f"- {t}" for t in titles[:8]]
    return "\n".join(out) if out else "_No headlines available._"


def brief() -> dict:
    """Descriptive summary of the CURRENT headlines. provider/model in the
    return so the UI badges provenance (emerald AI / amber templated),
    identical to the briefing's contract. Caller decides when to spend the
    Groq call (on-demand button), so quota is never burned silently."""
    items = get_news(limit=30)
    if not items:
        return {"body": "_No news fetched yet._", "provider": "none",
                "model": "none"}
    headlines = "\n".join(f"- [{i['source']}] {i['title']}" for i in items)
    ai = llm.narrate(_DESC_SYSTEM, f"Headlines:\n{headlines}\n\nSummarise.")
    if ai:
        return {"body": ai["text"], "provider": ai["provider"],
                "model": ai["model"]}
    return {"body": _templated_brief(items), "provider": "template",
            "model": "none"}
